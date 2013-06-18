var assert = require('assert');
var defs = require('../lib/defs');
var Connection = require('../lib/connection').Connection;
var HEARTBEAT = require('../lib/frame').HEARTBEAT;
var mock = require('./mocknet');
var succeed = mock.succeed, fail = mock.fail, latch = mock.latch;

var LOG_ERRORS = process.env.LOG_ERRORS;

var OPEN_OPTS = {
  // start-ok
  'clientProperties': {},
  'mechanism': 'PLAIN',
  'response': new Buffer(['', 'guest', 'guest'].join(String.fromCharCode(0))),
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
module.exports.OPEN_OPTS = OPEN_OPTS;

function happy_open(send, await) {
  // kick it off
  send(defs.ConnectionStart,
       {versionMajor: 0,
        versionMinor: 9,
        serverProperties: {},
        mechanisms: new Buffer('PLAIN'),
        locales: new Buffer('en_US')});
  return await(defs.ConnectionStartOk)()
    .then(function(f) {
      send(defs.ConnectionTune,
           {channelMax: 0,
            heartbeat: 0,
            frameMax: 0});
    })
    .then(await(defs.ConnectionTuneOk))
    .then(await(defs.ConnectionOpen))
    .then(function(f) {
      send(defs.ConnectionOpenOk,
           {knownHosts: ''});
    });
}
module.exports.connection_handshake = happy_open;

function connectionTest(client, server) {
  return function(done) {
    var pair = mock.socketPair();
    var c = new Connection(pair.client);
    if (LOG_ERRORS) c.on('error', console.warn);
    client(c, done);

    // NB only not a race here because the writes are synchronous
    var protocolHeader = pair.server.read(8);
    assert.deepEqual(new Buffer("AMQP" + String.fromCharCode(0,0,9,1)),
                     protocolHeader);

    var s = mock.runServer(pair.server, function(send, await) {
      server(send, await, done, pair.server);
    });
  };
}

suite("Connection open", function() {

test("happy", connectionTest(
  function(c, done) {
    c.open(OPEN_OPTS).then(succeed(done), fail(done));
  },
  function(send, await, done) {
    happy_open(send, await).then(null, fail(done));
  }));

test("wrong first frame", connectionTest(
  function(c, done) {
    c.open(OPEN_OPTS).then(fail(done), succeed(done));
  },
  function(send, await, done) {
    // bad server! bad! whatever were you thinking?
    send(defs.ConnectionTune,
         {channelMax: 0,
          heartbeat: 0,
          frameMax: 0});
  }));

});

suite("Connection running", function() {

test("wrong frame on channel 0", connectionTest(
  function(c, done) {
    c.on('error', succeed(done));
    c.open(OPEN_OPTS);
  },
  function(send, await, done) {
    happy_open(send, await)
      .then(function() {
        // there's actually nothing that would plausibly be sent to a
        // just opened connection, so this is violating more than one
        // rule. Nonetheless.
        send(defs.ChannelOpenOk, {channelId: new Buffer('')}, 0);
      })
      .then(await(defs.ConnectionClose))
      .then(function(close) {
        send(defs.ConnectionCloseOk, {}, 0);
      }).then(null, fail(done));
  }));

test("unopened channel",  connectionTest(
  function(c, done) {
    c.on('error', succeed(done));
    c.open(OPEN_OPTS);
  },
  function(send, await, done) {
    happy_open(send, await)
      .then(function() {
        // there's actually nothing that would plausibly be sent to a
        // just opened connection, so this is violating more than one
        // rule. Nonetheless.
        send(defs.ChannelOpenOk, {channelId: new Buffer('')}, 3);
      })
      .then(await(defs.ConnectionClose))
      .then(function(close) {
        send(defs.ConnectionCloseOk, {}, 0);
      }).then(null, fail(done));
  }));

test("Unexpected socket close", connectionTest(
  function(c, done) {
    var errorAndClosed = latch(2, done);
    c.on('error', succeed(errorAndClosed));
    c.on('close', succeed(errorAndClosed));
    c.open(OPEN_OPTS);
  },
  function(send, await, done, socket) {
    happy_open(send, await)
      .then(function() {
        socket.end();
      })
  }));

});

suite("Connection close", function() {

test("happy", connectionTest(
  function(c, done0) {
    var done = latch(2, done0);
    c.on('close', done);
    c.open(OPEN_OPTS).then(function(_ok) {
      c.close().then(succeed(done), fail(done));
    });
  },
  function(send, await, done) {
    happy_open(send, await)
      .then(await(defs.ConnectionClose))
      .then(function(close) {
        send(defs.ConnectionCloseOk, {});
      })
      .then(null, fail(done));
  }));

test("interleaved close frames", connectionTest(
  function(c, done0) {
    var done = latch(2, done0);
    c.on('close', done);
    c.open(OPEN_OPTS).then(function(_ok) {
      c.close().then(succeed(done), fail(done));
    });
  },
  function(send, await, done) {
    happy_open(send, await)
      .then(await(defs.ConnectionClose))
      .then(function(f) {
        send(defs.ConnectionClose, {
          replyText: "Ha!",
          replyCode: defs.constants.REPLY_SUCCESS,
          methodId: 0, classId: 0
        });
      })
      .then(await(defs.ConnectionCloseOk))
      .then(function(f) {
        send(defs.ConnectionCloseOk, {});
      })
      .then(null, fail(done));
  }));

test("server-initiated close", connectionTest(
  function(c, done0) {
    var done = latch(2, done0);
    c.on('close', succeed(done));
    c.on('error', succeed(done));
    c.open(OPEN_OPTS);
  },
  function(send, await, done) {
    happy_open(send, await)
      .then(function(f) {
        send(defs.ConnectionClose, {
          replyText: "Begone",
          replyCode: defs.constants.INTERNAL_ERROR,
          methodId: 0, classId: 0
        });
      })
      .then(await(defs.ConnectionCloseOk))
      .then(null, fail(done));
  }));
});

suite("heartbeats", function() {

require('../lib/heartbeat').UNITS_TO_MS = 100;

test("sends heartbeat after open", connectionTest(
  function(c, done) {
    var opts = Object.create(OPEN_OPTS);
    opts.heartbeat = 1;
    c.open(opts);
  },
  function(send, await, done, socket) {
    var timer;
    happy_open(send, await)
      .then(function() {
        // %% don't need to do this, the client should send before it
        // %% times out
        socket.write(new Buffer([8, 0, 0, 0, 0, 0, 0, 206]));
      })
      .then(await())
      .then(function(hb) {
        if (hb === HEARTBEAT) done();
        else done("Next frame after silence not a heartbeat");
      }).then(function() { clearInterval(timer); });
  }));

});
