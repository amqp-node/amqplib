const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const promisify = require('node:util').promisify;
const Channel = require('../lib/channel').Channel;
const Connection = require('../lib/connection').Connection;
const util = require('./lib/util');
const latch = util.latch;
const completes = util.completes;
const handshake = util.handshake;
const defs = require('../lib/defs');
const OPEN_OPTS = require('./lib/data').OPEN_OPTS;

const LOG_ERRORS = process.env.LOG_ERRORS;

function baseChannelTest(client, server) {
  return (_t, done) => {
    const decrementLatch = latch(2, done);
    const pair = util.socketPair();
    const c = new Connection(pair.client);

    if (LOG_ERRORS) c.on('error', console.warn);

    c.open(OPEN_OPTS, (err, _ok) => {
      if (err === null) client(c, decrementLatch);
      else decrementLatch(err);
    });

    pair.server.read(8); // discard the protocol header
    util.runServer(pair.server, (send, wait) => {
      handshake(send, wait).then(() => {
        server(send, wait, decrementLatch);
      }, decrementLatch);
    });
  };
}

function channelTest(client, server) {
  return baseChannelTest(
    (conn, done) => {
      const ch = new Channel(conn);
      if (LOG_ERRORS) ch.on('error', console.warn);
      client(ch, done, conn);
    },
    (send, wait, done) => {
      channel_handshake(send, wait)
        .then((ch) => server(send, wait, done, ch))
        .then(null, done); // so you can return a promise to let
      // errors bubble out
    },
  );
}

function channel_handshake(send, wait) {
  return wait(defs.ChannelOpen)().then((open) => {
    assert.notEqual(0, open.channel);
    send(defs.ChannelOpenOk, { channelId: Buffer.from('') }, open.channel);
    return open.channel;
  });
}

// fields for deliver and publish and get-ok
const DELIVER_FIELDS = {
  consumerTag: 'fake',
  deliveryTag: 1,
  redelivered: false,
  exchange: 'foo',
  routingKey: 'bar',
  replyCode: defs.constants.NO_ROUTE,
  replyText: 'derp',
};

function open(ch) {
  ch.allocate();
  return promisify((cb) => {
    ch._rpc(defs.ChannelOpen, { outOfBand: '' }, defs.ChannelOpenOk, cb);
  })();
}

describe('Channel', () => {

  describe('channel open and close', () => {
    it('open', channelTest(
      (ch, cb) => open(ch).then((ok) => {
        assert.equal(ok.id, defs.ChannelOpenOk);
        cb();
      }),
      (_send, _wait, cb) => cb()
    ));

    it('bad server', baseChannelTest(
      (c, cb) => {
        const ch = new Channel(c);
        assert.rejects(() => open(ch), (err) => {
          assert.match(err.message, /Expected ChannelOpenOk; got <ChannelCloseOk channel:1>/);
          return true;
        }).then(() => cb());
      }, (send, wait, cb) =>
        wait(defs.ChannelOpen)()
          .then((open) => send(defs.ChannelCloseOk, {}, open.channel))
          .then(cb)
      )
    );

    it('open, close', channelTest(
      (ch, cb) => {
        open(ch)
          .then(() => new Promise((resolve) => {
            ch.closeBecause('Bye', defs.constants.REPLY_SUCCESS, resolve);
          }))
          .then(cb);
      }, (send, wait, cb, ch) =>
        wait(defs.ChannelClose)()
          .then((_close) => send(defs.ChannelCloseOk, {}, ch))
        .then(cb)
      )
    );

    it('server close', channelTest(
      (ch, cb) => {
        ch.once('error', (err) => {
          assert.match(err.message, /Channel closed by server: 504 \(CHANNEL-ERROR\)/);
          assert.strictEqual(504, err.code);
          assert.strictEqual(0, err.classId);
          assert.strictEqual(0, err.methodId);
          cb();
        });
        open(ch);
    }, (send, wait, cb, ch) => {
      send(defs.ChannelClose, {
        replyText: 'Forced close',
        replyCode: defs.constants.CHANNEL_ERROR,
        classId: 0,
        methodId: 0,
      }, ch);
      wait(defs.ChannelCloseOk)().then(cb);
    }));

    it('overlapping channel/server close', channelTest(
      (ch, cb, conn) => {
        const decrementLatch = latch(2, cb);
        conn.once('error', (err) => {
          assert.match(err.message, /Connection closed: 541 \(INTERNAL-ERROR\)/);
          decrementLatch();
        });
        ch.on('close', (err) => {
          assert.ifError(err);
          decrementLatch();
        });
        open(ch)
          .then(() => ch.closeBecause('Bye', defs.constants.REPLY_SUCCESS));
      }, (send, wait, cb, _ch) => {
        wait(defs.ChannelClose)()
          .then(() => send(defs.ConnectionClose, {
              replyText: 'Got there first',
              replyCode: defs.constants.INTERNAL_ERROR,
              classId: 0,
              methodId: 0,
            }, 0)
          )
          .then(wait(defs.ConnectionCloseOk))
          .then(cb);
    }));

    it('double close', channelTest((ch, cb) => {
      open(ch)
        .then(() => {
          ch.closeBecause('First close', defs.constants.REPLY_SUCCESS);
          // NB no synchronisation, we do this straight away
          assert.throws(() => {
            ch.closeBecause('Second close', defs.constants.REPLY_SUCCESS);
          }, (err) => {
            assert.match(err.message, /Channel closing/);
            return true;
          });
        })
        .then(cb);
    }, (send, wait, cb, ch) => {
      wait(defs.ChannelClose)()
      .then(() => send(defs.ChannelCloseOk, {}, ch))
      .then(cb);
    }));
  });

  describe('channel machinery', () => {
    it('RPC', channelTest((ch, cb) => {
      const decrementLatch = latch(3, cb);
      open(ch)
        .then(() => {
          const fields = { prefetchCount: 10, prefetchSize: 0, global: false };
          ch._rpc(defs.BasicQos, fields, defs.BasicQosOk, decrementLatch);
          ch._rpc(defs.BasicQos, fields, defs.BasicQosOk, decrementLatch);
          ch._rpc(defs.BasicQos, fields, defs.BasicQosOk, decrementLatch);
        })
      }, (send, wait, cb, ch) => {
        function sendOk() {
          send(defs.BasicQosOk, {}, ch);
        }

        return wait(defs.BasicQos)()
          .then(sendOk)
          .then(wait(defs.BasicQos))
          .then(sendOk)
          .then(wait(defs.BasicQos))
          .then(sendOk)
          .then(cb);
    }));

    it('Bad RPC', channelTest(
      (ch, cb) => {
        // We want to see the RPC rejected and the channel closed (with an error)
        const decrementLatch = latch(2, cb);
        ch.once('error', (err) => {
          assert.match(err.message, /Expected BasicRecoverOk; got <BasicGetEmpty channel:1>/);
          assert.strictEqual(505, err.code);
          assert.strictEqual(60, err.classId);
          assert.strictEqual(72, err.methodId);
          decrementLatch();
        });

        open(ch).then(() => {
          ch._rpc(defs.BasicRecover, { requeue: true }, defs.BasicRecoverOk, (err) => {
            assert.match(err.message, /Expected BasicRecoverOk; got <BasicGetEmpty channel:1>/);
            decrementLatch();
          });
        }, decrementLatch);
      },
      (send, wait, cb, ch) =>
        wait()()
          .then(() => send(defs.BasicGetEmpty, { clusterId: '' }, ch))
          // oh wait! that was wrong! expect a channel close
          .then(wait(defs.ChannelClose))
          .then(() => send(defs.ChannelCloseOk, {}, ch))
          .then(cb),
    ));

    it('RPC on closed channel', channelTest(
      (ch, cb) => {
        open(ch);

        const close = new Promise((resolve) => {
          ch.once('error', (err) => {
            assert.match(err.message, /Channel closed by server: 504 \(CHANNEL-ERROR\)/);
            assert.strictEqual(504, err.code);
            assert.strictEqual(0, err.classId);
            assert.strictEqual(0, err.methodId);
            resolve();
          });
        });

        function failureCb(resolve, reject) {
          return (err) => {
            if (err !== null) resolve();
            else reject();
          };
        }

        const fail1 = new Promise((resolve, reject) =>
          ch._rpc(defs.BasicRecover, { requeue: true }, defs.BasicRecoverOk, failureCb(resolve, reject)),
        );

        const fail2 = new Promise((resolve, reject) =>
          ch._rpc(defs.BasicRecover, { requeue: true }, defs.BasicRecoverOk, failureCb(resolve, reject)),
        );

        Promise.all([close, fail1, fail2]).then(cb);
      },
      (send, wait, cb, ch) => {
        wait(defs.BasicRecover)()
          .then(() => {
            send(defs.ChannelClose, {
              replyText: 'Nuh-uh!',
              replyCode: defs.constants.CHANNEL_ERROR,
              methodId: 0,
              classId: 0,
            }, ch);
            return wait(defs.ChannelCloseOk);
          })
          .then(cb);
      },
    ));

    it('publish all < single chunk threshold', channelTest(
      (ch, cb) => {
        open(ch)
          .then(() => {
            ch.sendMessage({
              exchange: 'foo',
              routingKey: 'bar',
              mandatory: false,
              immediate: false,
              ticket: 0,
            }, {}, Buffer.from('foobar'));
          })
          .then(cb);
      },
      (_send, wait, cb, _ch) => {
        wait(defs.BasicPublish)()
          .then(wait(defs.BasicProperties))
          .then(wait()) // content frame
          .then((f) => {
            assert.equal('foobar', f.content.toString());
          })
          .then(cb);
      },
    ));

    it('publish content > single chunk threshold', channelTest(
      (ch, cb) => {
        open(ch);
        completes(() => {
          ch.sendMessage(
            {
              exchange: 'foo',
              routingKey: 'bar',
              mandatory: false,
              immediate: false,
              ticket: 0,
            },
            {},
            Buffer.alloc(3000),
          );
        }, cb);
      }, (_send, wait, cb, _ch) => {
        wait(defs.BasicPublish)()
          .then(wait(defs.BasicProperties))
          .then(wait()) // content frame
          .then((f) => {
            assert.equal(3000, f.content.length);
          })
          .then(cb);
      }
    ));

    it('publish method & headers > threshold', channelTest(
      (ch, cb) => {
        open(ch);
        completes(() => {
          ch.sendMessage({
            exchange: 'foo',
            routingKey: 'bar',
            mandatory: false,
            immediate: false,
            ticket: 0,
          }, {
            headers: { foo: Buffer.alloc(3000) },
          }, Buffer.from('foobar'));
        }, cb);
      }, (_send, wait, cb, _ch) => {
        wait(defs.BasicPublish)()
          .then(wait(defs.BasicProperties))
          .then(wait()) // content frame
          .then((f) => {
            assert.equal('foobar', f.content.toString());
          })
          .then(cb);
      }
    ));

    it('publish zero-length message', channelTest((ch, cb) => {
      open(ch);
      completes(() => {
        ch.sendMessage({
          exchange: 'foo',
          routingKey: 'bar',
          mandatory: false,
          immediate: false,
          ticket: 0,
        }, {}, Buffer.alloc(0));
        ch.sendMessage({
          exchange: 'foo',
          routingKey: 'bar',
          mandatory: false,
          immediate: false,
          ticket: 0,
        }, {}, Buffer.alloc(0));
      }, cb);
    }, (_send, wait, cb, _ch) => {
      wait(defs.BasicPublish)()
        .then(wait(defs.BasicProperties))
        // no content frame for a zero-length message
        .then(wait(defs.BasicPublish))
        .then(cb);
    }));

    it('delivery', channelTest((ch, cb) => {
      open(ch);
      ch.on('delivery', (m) => {
        completes(() => {
          assert.equal('barfoo', m.content.toString());
        }, cb);
      });
    }, (send, _wait, cb, ch) => {
      completes(() => {
        send(defs.BasicDeliver, DELIVER_FIELDS, ch, Buffer.from('barfoo'));
      }, cb);
    }));

    it('zero byte msg', channelTest(
      (ch, cb) => {
        open(ch);
        ch.on('delivery', (m) => {
          completes(() => {
            assert.deepEqual(Buffer.alloc(0), m.content);
          }, cb);
        });
      },
      (send, _wait, cb, ch) => {
        completes(() => {
          send(defs.BasicDeliver, DELIVER_FIELDS, ch, Buffer.from(''));
        }, cb);
      }
    ));

    it('bad delivery', channelTest((ch, cb) => {
      const decrementLatch = latch(2, cb);
      ch.on('error', (err) => {
        assert.match(err.message, /Expected headers frame after delivery/);
        assert.strictEqual(505, err.code);
        assert.strictEqual(60, err.classId);
        assert.strictEqual(60, err.methodId);
        decrementLatch();
      });
      ch.on('close', decrementLatch);
      open(ch);
    }, (send, wait, cb, ch) => {
      send(defs.BasicDeliver, DELIVER_FIELDS, ch);
      // now send another deliver without having sent the content
      send(defs.BasicDeliver, DELIVER_FIELDS, ch);
      return wait(defs.ChannelClose)()
        .then(() => send(defs.ChannelCloseOk, {}, ch))
        .then(cb);
    }));

    it('bad content send', channelTest((ch, cb) => {
      completes(() => {
        open(ch);
        assert.throws(() => {
          ch.sendMessage({ routingKey: 'foo', exchange: 'amq.direct' }, {}, null);
        }, (err) => {
          assert.match(err.message, /content is not a buffer/);
          return true;
        });
      }, cb);
    }, (_send, _wait, cb, _ch) => cb()));

    it('bad properties send', channelTest((ch, cb) => {
      completes(() => {
        open(ch);
        assert.throws(() => {
          ch.sendMessage({ routingKey: 'foo', exchange: 'amq.direct' }, { contentEncoding: 7 }, Buffer.from('foobar'));
        }, (err) => {
          assert.match(err.message, /Field 'contentEncoding' is the wrong type/);
          return true;
        });
      }, cb);
    }, (_send, _wait, cb, _ch) => cb()));

    it('bad consumer', channelTest((ch, cb) => {
      const decrementLatch = latch(2, cb);
      ch.on('delivery', () => {
        throw new Error('I am a bad consumer');
      });
      ch.on('error', (err) => {
        assert.match(err.message, /I am a bad consumer/);
        assert.strictEqual(541, err.code);
        assert.strictEqual(undefined, err.classId);
        assert.strictEqual(undefined, err.methodId);
        decrementLatch();
      });
      ch.on('close', decrementLatch);
      open(ch);
    }, (send, wait, cb, ch) => {
      send(defs.BasicDeliver, DELIVER_FIELDS, ch, Buffer.from('barfoo'));
      return wait(defs.ChannelClose)()
        .then(() => send(defs.ChannelCloseOk, {}, ch))
        .then(cb);
    }));

    it('bad send in consumer', channelTest((ch, cb) => {
      const decrementLatch = latch(2, cb);
      ch.on('delivery', () => {
        ch.sendMessage({ routingKey: 'foo', exchange: 'amq.direct' }, {}, null); // can't send null
      });
      ch.on('error', (err) => {
        assert.match(err.message, /content is not a buffer/);
        assert.strictEqual(541, err.code);
        assert.strictEqual(undefined, err.classId);
        assert.strictEqual(undefined, err.methodId);
        decrementLatch();
      });
      ch.on('close', decrementLatch);
      open(ch);
    }, (send, wait, cb, ch) => {
      const decrementLatch = latch(2, cb);
      completes(() => {
        send(defs.BasicDeliver, DELIVER_FIELDS, ch, Buffer.from('barfoo'));
      }, decrementLatch);
      return wait(defs.ChannelClose)()
        .then(() => send(defs.ChannelCloseOk, {}, ch))
        .then(decrementLatch);
    }));

    it('return', channelTest((ch, cb) => {
      ch.on('return', (m) => {
        completes(() => {
          assert.equal('barfoo', m.content.toString());
        }, cb);
      });
      open(ch);
    }, (send, _wait, cb, ch) => {
      completes(() => {
        send(defs.BasicReturn, DELIVER_FIELDS, ch, Buffer.from('barfoo'));
      }, cb);
    }));

    it('cancel', channelTest((ch, cb) => {
      ch.on('cancel', (f) => {
        completes(() => {
          assert.equal('product of society', f.consumerTag);
        }, cb);
      });
      open(ch);
    }, (send, _wait, cb, ch) => {
      completes(() => {
        send(defs.BasicCancel, {
          consumerTag: 'product of society',
          nowait: false,
        }, ch);
      }, cb);
    }));

    function confirmTest(variety, method) {
      return it(`confirm ${variety}`, channelTest((ch, done) => {
        ch.on(variety, (f) => {
          completes(() => {
            assert.equal(1, f.deliveryTag);
          }, done);
        });
        open(ch);
      }, (send, _wait, done, ch) => {
        completes(() => {
          send(method, {
            deliveryTag: 1,
            multiple: false,
          }, ch);
        }, done);
      }));
    }

    confirmTest('ack', defs.BasicAck);
    confirmTest('nack', defs.BasicNack);

    it('out-of-order acks', channelTest((ch, cb) => {
      const decrementLatch = latch(3, () => {
        completes(() => {
          assert.equal(0, ch.unconfirmed.length);
          assert.equal(4, ch.lwm);
        }, cb);
      });
      ch.pushConfirmCallback(decrementLatch);
      ch.pushConfirmCallback(decrementLatch);
      ch.pushConfirmCallback(decrementLatch);
      open(ch);
    }, (send, _wait, cb, ch) => {
      completes(() => {
        send(defs.BasicAck, { deliveryTag: 2, multiple: false }, ch);
        send(defs.BasicAck, { deliveryTag: 3, multiple: false }, ch);
        send(defs.BasicAck, { deliveryTag: 1, multiple: false }, ch);
      }, cb);
    }));

    it('not all out-of-order acks', channelTest((ch, cb) => {
      const decrementLatch = latch(2, () => {
        completes(() => {
          assert.equal(1, ch.unconfirmed.length);
          assert.equal(3, ch.lwm);
        }, cb);
      });
      ch.pushConfirmCallback(decrementLatch); // tag = 1
      ch.pushConfirmCallback(decrementLatch); // tag = 2
      ch.pushConfirmCallback(() => {
        assert.fail('Confirm callback should not be called');
      });
      open(ch);
    }, (send, _wait, cb, ch) => {
      completes(() => {
        send(defs.BasicAck, { deliveryTag: 2, multiple: false }, ch);
        send(defs.BasicAck, { deliveryTag: 1, multiple: false }, ch);
      }, cb);
    }));

    // Regression test for https://github.com/amqp-node/amqplib/issues/191
    // pushConfirmCallback stores `false` for publishes with no callback.
    // The close drain used `while (cb)` which stops at the first `false`,
    // silently dropping all callbacks that follow it.
    it('invokes all pending callbacks on close even when some publishes had no callback', channelTest((ch, cb) => {
      let called = 0;
      const countErr = (err) => { if (err) called++; };
      ch.pushConfirmCallback(countErr); // tag = 1 — has callback
      ch.pushConfirmCallback(null);     // tag = 2 — no callback, stored as `false`
      ch.pushConfirmCallback(countErr); // tag = 3 — has callback, dropped by while(cb) bug
      open(ch).then(() => {
        ch.toClosed('test close');
        completes(() => {
          assert.equal(2, called);
        }, cb);
      }, cb);
    }, (_send, _wait, cb) => {
      cb();
    }));
  });

  describe('Event handler errors - without handler-error listener', () => {
    let prevUncaughtExceptionListeners;

    beforeEach(() => {
      prevUncaughtExceptionListeners = process.rawListeners('uncaughtException').slice();
      process.removeAllListeners('uncaughtException');
    });

    afterEach(() => {
      prevUncaughtExceptionListeners.forEach((h) => process.on('uncaughtException', h));
    });

    it('throw in close handler kills the connection without handler-error listener', channelTest((ch, cb, conn) => {
      const expectedErr = new Error('user close handler explodes');
      let connErrorSeen = false;
      // The throw propagates to acceptLoop → frameError → onSocketError → connection.emit('error')
      conn.on('error', (err) => {
        assert.strictEqual(err, expectedErr);
        connErrorSeen = true;
      });
      // The ChannelCloseOk buffered before the kill is flushed by the mux after the
      // stream is ended, producing ERR_STREAM_PUSH_AFTER_EOF. Absorb it and use it
      // as the signal to end the test, since it fires after the conn error.
      process.once('uncaughtException', (err) => {
        assert.strictEqual(err.code, 'ERR_STREAM_PUSH_AFTER_EOF');
        assert.ok(connErrorSeen);
        cb();
      });
      ch.once('error', (err) => { assert.match(err.message, /Channel closed by server/); });
      ch.on('close', () => { throw expectedErr; });
      open(ch);
    }, (send, _wait, cb, ch) => {
      completes(() => {
        send(defs.ChannelClose, {
          replyText: 'Forced close',
          replyCode: defs.constants.CHANNEL_ERROR,
          classId: 0,
          methodId: 0,
        }, ch);
      }, cb);
    }));

    it('throw in error handler becomes uncaught exception', channelTest((ch, cb) => {
      const expectedErr = new Error('user error handler explodes');
      process.once('uncaughtException', (err) => {
        assert.strictEqual(err, expectedErr);
        cb();
      });
      ch.on('error', () => { throw expectedErr; });
      open(ch);
    }, (send, wait, cb, ch) => {
      send(defs.ChannelClose, {
        replyText: 'Forced close',
        replyCode: defs.constants.CHANNEL_ERROR,
        classId: 0,
        methodId: 0,
      }, ch);
      wait(defs.ChannelCloseOk)().then(cb, cb);
    }));

    it('throw in drain handler becomes uncaught exception', channelTest((ch, cb) => {
      const expectedErr = new Error('user drain handler explodes');
      process.once('uncaughtException', (err) => {
        assert.strictEqual(err, expectedErr);
        cb();
      });
      ch.on('drain', () => { throw expectedErr; });
      // Call outside a Promise chain so the throw becomes an uncaughtException
      open(ch).then(() => setImmediate(() => ch.onBufferDrain()));
    }, (_send, _wait, cb) => { cb(); }));

    it('throw in ack handler becomes uncaught exception', channelTest((ch, cb) => {
      const expectedErr = new Error('user ack handler explodes');
      process.once('uncaughtException', (err) => {
        assert.strictEqual(err, expectedErr);
        cb();
      });
      ch.on('ack', () => { throw expectedErr; });
      open(ch);
    }, (send, _wait, cb, ch) => {
      completes(() => {
        send(defs.BasicAck, { deliveryTag: 1, multiple: false }, ch);
      }, cb);
    }));

    it('throw in nack handler becomes uncaught exception', channelTest((ch, cb) => {
      const expectedErr = new Error('user nack handler explodes');
      process.once('uncaughtException', (err) => {
        assert.strictEqual(err, expectedErr);
        cb();
      });
      ch.on('nack', () => { throw expectedErr; });
      open(ch);
    }, (send, _wait, cb, ch) => {
      completes(() => {
        send(defs.BasicNack, { deliveryTag: 1, multiple: false, requeue: false }, ch);
      }, cb);
    }));

    it('throw in cancel handler becomes uncaught exception', channelTest((ch, cb) => {
      const expectedErr = new Error('user cancel handler explodes');
      process.once('uncaughtException', (err) => {
        assert.strictEqual(err, expectedErr);
        cb();
      });
      ch.on('cancel', () => { throw expectedErr; });
      open(ch);
    }, (send, _wait, cb, ch) => {
      completes(() => {
        send(defs.BasicCancel, { consumerTag: 'tag', nowait: false }, ch);
      }, cb);
    }));

    it('throw in delivery handler closes channel with error', channelTest((ch, cb) => {
      // acceptMessageFrame catches the throw and routes it to closeWithError,
      // which fires channel 'error' then 'close' — it does NOT become an uncaughtException.
      const expectedErr = new Error('user delivery handler explodes');
      const decrementLatch = latch(2, cb);
      ch.on('error', (err) => {
        assert.strictEqual(err, expectedErr);
        decrementLatch();
      });
      ch.on('close', decrementLatch);
      ch.on('delivery', () => { throw expectedErr; });
      open(ch);
    }, (send, wait, cb, ch) => {
      send(defs.BasicDeliver, DELIVER_FIELDS, ch, Buffer.from('hello'));
      wait(defs.ChannelClose)()
        .then(() => send(defs.ChannelCloseOk, {}, ch))
        .then(cb, cb);
    }));

    it('throw in return handler closes channel with error', channelTest((ch, cb) => {
      // acceptMessageFrame catches the throw and routes it to closeWithError.
      const expectedErr = new Error('user return handler explodes');
      const decrementLatch = latch(2, cb);
      ch.on('error', (err) => {
        assert.strictEqual(err, expectedErr);
        decrementLatch();
      });
      ch.on('close', decrementLatch);
      ch.on('return', () => { throw expectedErr; });
      open(ch);
    }, (send, wait, cb, ch) => {
      send(defs.BasicReturn, DELIVER_FIELDS, ch, Buffer.from('hello'));
      wait(defs.ChannelClose)()
        .then(() => send(defs.ChannelCloseOk, {}, ch))
        .then(cb, cb);
    }));
  });

  describe('Event handler errors - with handler-error listener', () => {
    let prevUncaughtExceptionListeners;

    beforeEach(() => {
      prevUncaughtExceptionListeners = process.rawListeners('uncaughtException').slice();
      process.removeAllListeners('uncaughtException');
    });

    afterEach(() => {
      prevUncaughtExceptionListeners.forEach((h) => process.on('uncaughtException', h));
    });

    it('throw in close handler is delivered via handler-error event', channelTest((ch, cb) => {
      const expectedErr = new Error('user close handler explodes');
      ch.on('handler-error', (err, event) => {
        assert.strictEqual(err, expectedErr);
        assert.strictEqual(event, 'close');
        cb();
      });
      // A server-initiated ChannelClose always fires 'error' before 'close' (line 291 in channel.js).
      // Handle it so only the throw from the close handler reaches handler-error.
      ch.once('error', (err) => { assert.match(err.message, /Channel closed by server/); });
      ch.on('close', () => { throw expectedErr; });
      open(ch);
    }, (send, wait, cb, ch) => {
      send(defs.ChannelClose, {
        replyText: 'Forced close',
        replyCode: defs.constants.CHANNEL_ERROR,
        classId: 0,
        methodId: 0,
      }, ch);
      wait(defs.ChannelCloseOk)().then(cb, cb);
    }));

    it('throw in error handler is delivered via handler-error event', channelTest((ch, cb) => {
      const expectedErr = new Error('user error handler explodes');
      ch.on('handler-error', (err, event) => {
        assert.strictEqual(err, expectedErr);
        assert.strictEqual(event, 'error');
        cb();
      });
      ch.on('error', () => { throw expectedErr; });
      open(ch);
    }, (send, wait, cb, ch) => {
      send(defs.ChannelClose, {
        replyText: 'Forced close',
        replyCode: defs.constants.CHANNEL_ERROR,
        classId: 0,
        methodId: 0,
      }, ch);
      wait(defs.ChannelCloseOk)().then(cb, cb);
    }));

    it('throw in drain handler is delivered via handler-error event', channelTest((ch, cb) => {
      const expectedErr = new Error('user drain handler explodes');
      ch.on('handler-error', (err, event) => {
        assert.strictEqual(err, expectedErr);
        assert.strictEqual(event, 'drain');
        cb();
      });
      ch.on('drain', () => { throw expectedErr; });
      open(ch).then(() => setImmediate(() => ch.onBufferDrain()));
    }, (_send, _wait, cb) => { cb(); }));

    it('throw in ack handler is delivered via handler-error event', channelTest((ch, cb) => {
      const expectedErr = new Error('user ack handler explodes');
      ch.on('handler-error', (err, event) => {
        assert.strictEqual(err, expectedErr);
        assert.strictEqual(event, 'ack');
        cb();
      });
      ch.on('ack', () => { throw expectedErr; });
      open(ch);
    }, (send, _wait, cb, ch) => {
      completes(() => {
        send(defs.BasicAck, { deliveryTag: 1, multiple: false }, ch);
      }, cb);
    }));

    it('throw in nack handler is delivered via handler-error event', channelTest((ch, cb) => {
      const expectedErr = new Error('user nack handler explodes');
      ch.on('handler-error', (err, event) => {
        assert.strictEqual(err, expectedErr);
        assert.strictEqual(event, 'nack');
        cb();
      });
      ch.on('nack', () => { throw expectedErr; });
      open(ch);
    }, (send, _wait, cb, ch) => {
      completes(() => {
        send(defs.BasicNack, { deliveryTag: 1, multiple: false, requeue: false }, ch);
      }, cb);
    }));

    it('throw in cancel handler is delivered via handler-error event', channelTest((ch, cb) => {
      const expectedErr = new Error('user cancel handler explodes');
      ch.on('handler-error', (err, event) => {
        assert.strictEqual(err, expectedErr);
        assert.strictEqual(event, 'cancel');
        cb();
      });
      ch.on('cancel', () => { throw expectedErr; });
      open(ch);
    }, (send, _wait, cb, ch) => {
      completes(() => {
        send(defs.BasicCancel, { consumerTag: 'tag', nowait: false }, ch);
      }, cb);
    }));

    it('throw in delivery handler is delivered via handler-error event', channelTest((ch, cb) => {
      const expectedErr = new Error('user delivery handler explodes');
      ch.on('handler-error', (err, event) => {
        assert.strictEqual(err, expectedErr);
        assert.strictEqual(event, 'delivery');
        cb();
      });
      ch.on('delivery', () => { throw expectedErr; });
      open(ch);
    }, (send, _wait, cb, ch) => {
      completes(() => {
        send(defs.BasicDeliver, DELIVER_FIELDS, ch, Buffer.from('hello'));
      }, cb);
    }));

    it('throw in return handler is delivered via handler-error event', channelTest((ch, cb) => {
      const expectedErr = new Error('user return handler explodes');
      ch.on('handler-error', (err, event) => {
        assert.strictEqual(err, expectedErr);
        assert.strictEqual(event, 'return');
        cb();
      });
      ch.on('return', () => { throw expectedErr; });
      open(ch);
    }, (send, _wait, cb, ch) => {
      completes(() => {
        send(defs.BasicReturn, DELIVER_FIELDS, ch, Buffer.from('hello'));
      }, cb);
    }));

    it('throw in handler-error handler becomes uncaught exception', channelTest((ch, cb) => {
      const expectedErr = new Error('handler-error handler explodes');
      process.once('uncaughtException', (err) => {
        assert.strictEqual(err, expectedErr);
        cb();
      });
      ch.on('handler-error', () => { throw expectedErr; });
      ch.on('ack', () => { throw new Error('user ack handler explodes'); });
      open(ch);
    }, (send, _wait, cb, ch) => {
      completes(() => {
        send(defs.BasicAck, { deliveryTag: 1, multiple: false }, ch);
      }, cb);
    }));
  });
});
