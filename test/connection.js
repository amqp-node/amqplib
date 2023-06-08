
import assert from 'assert';
import * as defs from '../lib/defs.js';
import { Connection } from '../lib/connection.js';
import { HEARTBEAT } from '../lib/frame.js';
import { HEARTBEAT_BUF as HB_BUF } from '../lib/frame.js';
import * as util from './util.js';
import * as heartbeat from '../lib/heartbeat.js';
let UNITS_TO_MS = heartbeat.UNITS_TO_MS
const succeed = util.succeed, fail = util.fail, latch = util.latch;
const completes = util.completes;
const kCallback = util.kCallback;

const LOG_ERRORS = process.env.LOG_ERRORS;

export const  OPEN_OPTS = {
  // start-ok
  'clientProperties': {},
  'mechanism': 'PLAIN',
  'response': Buffer.from(['', 'guest', 'guest'].join(String.fromCharCode(0))),
  'locale': 'en_US',

  // tune-ok
  'channelMax': 0,
  'frameMax': 0,
  'heartbeat': 0,

  // open
  'virtualHost': '/',
  'capabilities': '',
  'insist': 0
};

export function happy_open(send, wait) {
  // kick it off
  send(defs.ConnectionStart,
       {versionMajor: 0,
        versionMinor: 9,
        serverProperties: {},
        mechanisms: Buffer.from('PLAIN'),
        locales: Buffer.from('en_US')});
  return wait(defs.ConnectionStartOk)()
    .then(function(f) {
      send(defs.ConnectionTune,
           {channelMax: 0,
            heartbeat: 0,
            frameMax: 0});
    })
    .then(wait(defs.ConnectionTuneOk))
    .then(wait(defs.ConnectionOpen))
    .then(function(f) {
      send(defs.ConnectionOpenOk,
           {knownHosts: ''});
    });
}

function connectionTest(client, server) {
  return function(done) {
    const bothDone = latch(2, done);
    const pair = util.socketPair();
    const c = new Connection(pair.client);
    if (LOG_ERRORS) c.on('error', console.warn);
    client(c, bothDone);

    // NB only not a race here because the writes are synchronous
    const protocolHeader = pair.server.read(8);
    assert.deepEqual(Buffer.from("AMQP" + String.fromCharCode(0,0,9,1)),
                     protocolHeader);

    const s = util.runServer(pair.server, function(send, wait) {
      server(send, wait, bothDone, pair.server);
    });
  };
}

suite("Connection errors", () => {

  test("socket close during open", function(done) {
    // RabbitMQ itself will take at least 3 seconds to close the socket
    // in the event of a handshake problem. Instead of using a live
    // connection, I'm just going to pretend.
    const pair = util.socketPair();
    const conn = new Connection(pair.client);
    pair.server.on('readable', () => {
      pair.server.end();
    });
    conn.open({}, kCallback(fail(done), succeed(done)));
  });

  test("bad frame during open", function(done) {
    const ss = util.socketPair();
    const conn = new Connection(ss.client);
    ss.server.on('readable', () => {
      ss.server.write(Buffer.from([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]));
    });
    conn.open({}, kCallback(fail(done), succeed(done)));
  });

});

suite("Connection open", () => {

test("happy", connectionTest(
  function(c, done) {
    c.open(OPEN_OPTS, kCallback(succeed(done), fail(done)));
  },
  function(send, wait, done) {
    happy_open(send, wait).then(succeed(done), fail(done));
  }));

test("wrong first frame", connectionTest(
  function(c, done) {
    c.open(OPEN_OPTS, kCallback(fail(done), succeed(done)));
  },
  function(send, wait, done) {
    // bad server! bad! whatever were you thinking?
    completes(() => {
      send(defs.ConnectionTune,
           {channelMax: 0,
            heartbeat: 0,
            frameMax: 0});
    }, done);
  }));

test("unexpected socket close", connectionTest(
  function(c, done) {
    c.open(OPEN_OPTS, kCallback(fail(done), succeed(done)));
  },
  function(send, wait, done, socket) {
    send(defs.ConnectionStart,
         {versionMajor: 0,
          versionMinor: 9,
          serverProperties: {},
          mechanisms: Buffer.from('PLAIN'),
          locales: Buffer.from('en_US')});
    return wait(defs.ConnectionStartOk)()
      .then(() => {
        socket.end();
      })
      .then(succeed(done), fail(done));
  }));

});

suite("Connection running", () => {

test("wrong frame on channel 0", connectionTest(
  function(c, done) {
    c.on('error', succeed(done));
    c.open(OPEN_OPTS);
  },
  function(send, wait, done) {
    happy_open(send, wait)
      .then(() => {
        // there's actually nothing that would plausibly be sent to a
        // just opened connection, so this is violating more than one
        // rule. Nonetheless.
        send(defs.ChannelOpenOk, {channelId: Buffer.from('')}, 0);
      })
      .then(wait(defs.ConnectionClose))
      .then(function(close) {
        send(defs.ConnectionCloseOk, {}, 0);
      }).then(succeed(done), fail(done));
  }));

test("unopened channel",  connectionTest(
  function(c, done) {
    c.on('error', succeed(done));
    c.open(OPEN_OPTS);
  },
  function(send, wait, done) {
    happy_open(send, wait)
      .then(() => {
        // there's actually nothing that would plausibly be sent to a
        // just opened connection, so this is violating more than one
        // rule. Nonetheless.
        send(defs.ChannelOpenOk, {channelId: Buffer.from('')}, 3);
      })
      .then(wait(defs.ConnectionClose))
      .then(function(close) {
        send(defs.ConnectionCloseOk, {}, 0);
      }).then(succeed(done), fail(done));
  }));

test("unexpected socket close", connectionTest(
  function(c, done) {
    const errorAndClosed = latch(2, done);
    c.on('error', succeed(errorAndClosed));
    c.on('close', succeed(errorAndClosed));
    c.open(OPEN_OPTS, kCallback(() => {
      c.sendHeartbeat();
    }, fail(errorAndClosed)));
  },
  function(send, wait, done, socket) {
    happy_open(send, wait)
      .then(wait())
      .then(() => {
        socket.end();
      }).then(succeed(done));
  }));

test("connection.blocked", connectionTest(
  function(c, done) {
    c.on('blocked', succeed(done));
    c.open(OPEN_OPTS);
  },
  function(send, wait, done, socket) {
    happy_open(send, wait)
      .then(() => {
        send(defs.ConnectionBlocked, {reason: 'felt like it'}, 0);
      })
      .then(succeed(done));
  }));

test("connection.unblocked", connectionTest(
  function(c, done) {
    c.on('unblocked', succeed(done));
    c.open(OPEN_OPTS);
  },
  function(send, wait, done, socket) {
    happy_open(send, wait)
      .then(() => {
        send(defs.ConnectionUnblocked, {}, 0);
      })
      .then(succeed(done));
  }));


});

suite("Connection close", () => {

test("happy", connectionTest(
  function(c, done0) {
    const done = latch(2, done0);
    c.on('close', done);
    c.open(OPEN_OPTS, kCallback(function(_ok) {
      c.close(kCallback(succeed(done), fail(done)));
    }, () => {}));
  },
  function(send, wait, done) {
    happy_open(send, wait)
      .then(wait(defs.ConnectionClose))
      .then(function(close) {
        send(defs.ConnectionCloseOk, {});
      })
      .then(succeed(done), fail(done));
  }));

test("interleaved close frames", connectionTest(
  function(c, done0) {
    const done = latch(2, done0);
    c.on('close', done);
    c.open(OPEN_OPTS, kCallback(function(_ok) {
      c.close(kCallback(succeed(done), fail(done)));
    }, done));
  },
  function(send, wait, done) {
    happy_open(send, wait)
      .then(wait(defs.ConnectionClose))
      .then(function(f) {
        send(defs.ConnectionClose, {
          replyText: "Ha!",
          replyCode: defs.constants.REPLY_SUCCESS,
          methodId: 0, classId: 0
        });
      })
      .then(wait(defs.ConnectionCloseOk))
      .then(function(f) {
        send(defs.ConnectionCloseOk, {});
      })
      .then(succeed(done), fail(done));
  }));

test("server error close", connectionTest(
  function(c, done0) {
    const done = latch(2, done0);
    c.on('close', succeed(done));
    c.on('error', succeed(done));
    c.open(OPEN_OPTS);
  },
  function(send, wait, done) {
    happy_open(send, wait)
      .then(function(f) {
        send(defs.ConnectionClose, {
          replyText: "Begone",
          replyCode: defs.constants.INTERNAL_ERROR,
          methodId: 0, classId: 0
        });
      })
      .then(wait(defs.ConnectionCloseOk))
      .then(succeed(done), fail(done));
  }));

test("operator-intiated close", connectionTest(
  function(c, done) {
    c.on('close', succeed(done));
    c.on('error', fail(done));
    c.open(OPEN_OPTS);
  },
  function(send, wait, done) {
    happy_open(send, wait)
      .then(function(f) {
        send(defs.ConnectionClose, {
          replyText: "Begone",
          replyCode: defs.constants.CONNECTION_FORCED,
          methodId: 0, classId: 0
        });
      })
      .then(wait(defs.ConnectionCloseOk))
      .then(succeed(done), fail(done));
  }));


test("double close", connectionTest(
  function(c, done) {
    c.open(OPEN_OPTS, kCallback(() => {
      c.close();
      // NB no synchronisation, we do this straight away
      assert.throws(() => {
        c.close();
      });
      done();
    }, done));
  },
  function(send, wait, done) {
    happy_open(send, wait)
      .then(wait(defs.ConnectionClose))
      .then(() => {
        send(defs.ConnectionCloseOk, {});
      })
      .then(succeed(done), fail(done));
  }));

});

suite("heartbeats", () => {

setup(() => UNITS_TO_MS = 20);

teardown(() => UNITS_TO_MS = 1000);

test("send heartbeat after open", connectionTest(
  function(c, done) {
    completes(() => {
      const opts = Object.create(OPEN_OPTS);
      opts.heartbeat = 1;
      // Don't leave the error waiting to happen for the next test, this
      // confuses mocha awfully
      c.on('error', () => {});
      c.open(opts);
    }, done);
  },
  function(send, wait, done, socket) {
    let timer;
    happy_open(send, wait)
      .then(() => {
        timer = setInterval(() => {
          socket.write(HB_BUF);
        }, UNITS_TO_MS);
      })
      .then(wait())
      .then(function(hb) {
        if (hb === HEARTBEAT) done();
        else done("Next frame after silence not a heartbeat");
        clearInterval(timer);
      });
  }));

test("detect lack of heartbeats", connectionTest(
  function(c, done) {
    const opts = Object.create(OPEN_OPTS);
    opts.heartbeat = 1;
    c.on('error', succeed(done));
    c.open(opts);
  },
  function(send, wait, done, socket) {
    happy_open(send, wait)
      .then(succeed(done), fail(done));
    // conspicuously not sending anything ...
  }));

});
