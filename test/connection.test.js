const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const defs = require('../lib/defs');
const Connection = require('../lib/connection').Connection;
const HEARTBEAT = require('../lib/frame').HEARTBEAT;
const HB_BUF = require('../lib/frame').HEARTBEAT_BUF;
const OPEN_OPTS = require('./lib/data').OPEN_OPTS;
const heartbeat = require('../lib/heartbeat');
const { latch, handshake, runServer, socketPair } = require('./lib/util');

const LOG_ERRORS = process.env.LOG_ERRORS;

function connectionTest(client, server) {
  return (_t, done) => {
    const decrementLatch = latch(2, done);
    const pair = socketPair();
    const c = new Connection(pair.client);
    if (LOG_ERRORS) c.on('error', console.warn);
    client(c, decrementLatch);

    // NB only not a race here because the writes are synchronous
    const protocolHeader = pair.server.read(8);
    assert.deepEqual(Buffer.from(`AMQP${String.fromCharCode(0, 0, 9, 1)}`), protocolHeader);

    runServer(pair.server, (send, wait) => {
      server(send, wait, decrementLatch, pair.server);
    });
  };
}

describe('Connection', () => {

  describe('Connection errors', () => {
    it('socket close during open', (_t, done) => {
      // RabbitMQ itself will take at least 3 seconds to close the socket
      // in the event of a handshake problem. Instead of using a live
      // connection, I'm just going to pretend.
      const pair = socketPair();
      const conn = new Connection(pair.client);
      pair.server.on('readable', () => pair.server.end());
      conn.open({}, (err) => {
        assert.ok(err);
        assert.match(err.message, /Socket closed abruptly during opening handshake/);
        done();
      });
    });

    it('bad frame during open', (_t, done) => {
      const ss = socketPair();
      const conn = new (require('../lib/connection').Connection)(ss.client);
      ss.server.on('readable', () => {
        ss.server.write(Buffer.from([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]));
      });
      conn.open({}, (err) => {
        assert.ok(err);
        assert.match(err.message, /Invalid frame/);
        done();
      });
    });
  });

  describe('Connection open', () => {
    it('happy', connectionTest((c, cb) => {
      c.open(OPEN_OPTS, (err) => {
        assert.ifError(err);
        cb();
      })
    }, (send, wait, cb) => {
      handshake(send, wait)
        .then(cb, cb);
    }));

    it('wrong first frame', connectionTest((c, cb) => {
      c.open(OPEN_OPTS, (err) => {
        assert.ok(err);
        assert.match(err.message, /Expected ConnectionStart; got <ConnectionTune channel:0/);
        cb()
      });
    }, (send, _wait, cb) => {
      // bad server! bad! whatever were you thinking?
      send(defs.ConnectionTune, { channelMax: 0, heartbeat: 0, frameMax: 0 })
      cb();
    }));

    it('unexpected socket close', connectionTest((c, cb) => {
      c.open(OPEN_OPTS, (err) => {
        assert.ok(err);
        assert.match(err.message, /Socket closed abruptly during opening handshake/);
        cb();
      });
    }, (send, wait, cb, socket) => {
      send(defs.ConnectionStart, {
        versionMajor: 0,
        versionMinor: 9,
        serverProperties: {},
        mechanisms: Buffer.from('PLAIN'),
        locales: Buffer.from('en_US'),
      });
      return wait(defs.ConnectionStartOk)()
        .then(() => socket.end())
        .then(cb, cb);
    }));
  });

  describe('Connection running', () => {
    it('wrong frame on channel 0', connectionTest((c, cb) => {
      c.once('error', (err) => {
        assert.match(err.message, /Unexpected frame on channel 0/);
        cb()
      });
      c.open(OPEN_OPTS);
    }, (send, wait, cb) => {
      handshake(send, wait)
        // there's actually nothing that would plausibly be sent to a
        // just opened connection, so this is violating more than one
        // rule. Nonetheless.
        .then(() => send(defs.ChannelOpenOk, { channelId: Buffer.from('') }, 0))
        .then(wait(defs.ConnectionClose))
        .then((_close) => send(defs.ConnectionCloseOk, {}, 0))
        .then(cb, cb);
    }));

    it('unopened channel', connectionTest((c, cb) => {
      c.once('error', (err) => {
        assert.match(err.message, /Frame on unknown channel/);
        cb();
      });
      c.open(OPEN_OPTS);
    }, (send, wait, cb) => {
      handshake(send, wait)
        // there's actually nothing that would plausibly be sent to a
        // just opened connection, so this is violating more than one
        // rule. Nonetheless.
        .then(() => send(defs.ChannelOpenOk, { channelId: Buffer.from('') }, 3))
        .then(wait(defs.ConnectionClose))
        .then((_close) => send(defs.ConnectionCloseOk, {}, 0))
        .then(cb, cb);
    }));

    it('unexpected socket close', connectionTest((c, cb) => {
      const decrementLatch = latch(2, cb);
      c.on('error', (err) => {
        assert.match(err.message, /Unexpected close/);
        decrementLatch();
      });
      c.on('close', (err) => {
        assert.match(err.message, /Unexpected close/);
        decrementLatch();
      });
      c.open(OPEN_OPTS, (err) => {
        assert.ifError(err);
        c.sendHeartbeat();
      });
    }, (send, wait, cb, socket) => {
      handshake(send, wait)
        .then(wait())
        .then(() => socket.end())
        .then(cb, cb);
    }));

    it('connection.blocked', connectionTest((c, cb) => {
      c.on('blocked', (reason) => {
        assert.strictEqual(reason, 'felt like it');
        cb();
      });
      c.open(OPEN_OPTS);
    }, (send, wait, cb, _socket) => {
      handshake(send, wait)
        .then(() => send(defs.ConnectionBlocked, { reason: 'felt like it' }, 0))
        .then(cb, cb);
    }));

    it('connection.unblocked', connectionTest((c, cb) => {
      c.on('unblocked', () => cb());
      c.open(OPEN_OPTS);
    }, (send, wait, cb, _socket) => {
      handshake(send, wait)
        .then(() => send(defs.ConnectionUnblocked, {}, 0))
        .then(cb, cb);
    }));
  });

  describe('Connection close', () => {
    it('happy', connectionTest((c, cb) => {
      const decrementLatch = latch(2, cb);
      c.on('close', () => decrementLatch());
      c.open(OPEN_OPTS, (err) => {
        assert.ifError(err);
        c.close((err) => {
          assert.ifError(err);
          decrementLatch();
        });
      });
    }, (send, wait, cb) => {
      handshake(send, wait)
        .then(wait(defs.ConnectionClose))
        .then((_close) => send(defs.ConnectionCloseOk, {}))
        .then(cb, cb);
    }));

    it('interleaved close frames', connectionTest((c, cb) => {
      const decrementLatch = latch(2, cb);
      c.on('close', () => decrementLatch());
      c.open(OPEN_OPTS, (err) => {
        assert.ifError(err);
        c.close((err) => {
          assert.ifError(err);
          decrementLatch();
        });
      });
    }, (send, wait, cb) => {
      handshake(send, wait)
        .then(wait(defs.ConnectionClose))
        .then(() => send(defs.ConnectionClose, {
          replyText: 'Ha!',
          replyCode: defs.constants.REPLY_SUCCESS,
          methodId: 0,
          classId: 0,
        }))
        .then(wait(defs.ConnectionCloseOk))
        .then(() => send(defs.ConnectionCloseOk, {}))
        .then(cb, cb);
    }));

    it('server error close', connectionTest((c, cb) => {
      const decrementLatch = latch(2, cb);
      c.once('close', (err) => {
        assert.match(err.message, /Connection closed: 541 \(INTERNAL-ERROR\) with message "Begone"/);
        decrementLatch();
      });
      c.once('error', (err) => {
        assert.match(err.message, /Connection closed: 541 \(INTERNAL-ERROR\) with message "Begone"/);
        decrementLatch();
      });
      c.open(OPEN_OPTS);
    }, (send, wait, cb) => {
      handshake(send, wait)
        .then(() => send(defs.ConnectionClose, {
          replyText: 'Begone',
          replyCode: defs.constants.INTERNAL_ERROR,
          methodId: 0,
          classId: 0,
        }))
        .then(wait(defs.ConnectionCloseOk))
        .then(cb, cb);
    }));

    it('operator-intiated close', connectionTest((c, cb) => {
      c.once('close', (err) => {
        assert.match(err.message, /Connection closed: 320 \(CONNECTION-FORCED\) with message "Begone"/);
        cb();
      });
      c.once('error', (err) => assert.fail(`Unexepcted error: ${err.message}`));
      c.open(OPEN_OPTS);
    }, (send, wait, cb) => {
      handshake(send, wait)
        .then(() => send(defs.ConnectionClose, {
          replyText: 'Begone',
          replyCode: defs.constants.CONNECTION_FORCED,
          methodId: 0,
          classId: 0,
        }))
        .then(wait(defs.ConnectionCloseOk))
        .then(cb, cb);
    }));

    it('double close', connectionTest((c, cb) => {
      c.open(OPEN_OPTS, (err) => {
        assert.ifError(err);
        c.close();
        // NB no synchronisation, we do this straight away
        assert.throws(() => c.close());
        cb();
      });
    }, (send, wait, cb) => {
      handshake(send, wait)
        .then(wait(defs.ConnectionClose))
        .then(() => send(defs.ConnectionCloseOk, {}))
        .then(cb, cb);
    }));

    it('close while blocked closes immediately', connectionTest((c, cb) => {
      const decrementLatch = latch(2, cb);
      c.on('close', () => decrementLatch());
      c.open(OPEN_OPTS, (err) => {
        assert.ifError(err);
        c.once('blocked', () => {
          c.close((err) => {
            assert.ifError(err);
            decrementLatch();
          });
        });
      });
    }, (send, wait, cb) => {
      handshake(send, wait)
        .then(() => send(defs.ConnectionBlocked, { reason: 'memory' }, 0))
        .then(wait(defs.ConnectionClose))
        // deliberately do NOT send ConnectionCloseOk — client must close anyway
        .then(cb, cb);
    }));
  });

  describe('heartbeats', () => {

    beforeEach(() => {
      heartbeat.UNITS_TO_MS = 20;
    });

    afterEach(() => {
      heartbeat.UNITS_TO_MS = 1000;
    });

    it('send heartbeat after open', connectionTest((c, cb) => {
      const opts = Object.create(OPEN_OPTS);
      opts.heartbeat = 1;
      // Don't leave the error waiting to happen for the next test
      c.on('error', (err) => {
        assert.match(err.message, /Heartbeat timeout/)
      });
      c.open(opts);
      cb()
    }, (send, wait, cb, socket) => {
      let timer;
      handshake(send, wait)
        .then(() => {
          timer = setInterval(() => socket.write(HB_BUF), heartbeat.UNITS_TO_MS);
        })
        .then(wait())
        .then((hb) => {
          assert.strictEqual(hb, HEARTBEAT);
          cb();
        }).finally(() => clearInterval(timer));
    }));

    it('detect lack of heartbeats', connectionTest((c, cb) => {
      const opts = Object.create(OPEN_OPTS);
      opts.heartbeat = 1;
      c.once('error', (err) => {
        assert.match(err.message, /Heartbeat timeout/)
        cb();
      });
      c.open(opts);
    }, (send, wait, cb, _socket) => {
      handshake(send, wait)
        .then(cb, cb);
      // conspicuously not sending anything ...
    }));
  });

});
