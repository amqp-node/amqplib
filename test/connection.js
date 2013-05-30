var assert = require('assert');
var defs = require('../lib/defs');
var Connection = require('../lib/connection').Connection;
var mock = require('./mocknet');
var succeed = mock.succeed, fail = mock.fail;

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
module.exports.open_handshake = happy_open;

function connectionTest(client, server) {
  return function(done) {
    var pair = mock.socketPair();
    var c = new Connection(pair.client);
    client(c, done);

    // NB only not a race here because the writes are synchronous
    var protocolHeader = pair.server.read(8);
    assert.deepEqual(new Buffer("AMQP" + String.fromCharCode(0,0,9,1)),
                     protocolHeader);

    var s = mock.runServer(pair.server, function(send, await) {
      server(send, await, done);
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
    // bad server! bad!
    send(defs.ConnectionTune,
         {channelMax: 0,
          heartbeat: 0,
          frameMax: 0});
  }));

});

suite("Connection close", function() {

test("happy", connectionTest(
  function(c, done) {
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
  function(c, done) {
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
  function(c, done) {
    c.on('error', succeed(done));
    c.on('close', fail(done));
    c.open(OPEN_OPTS).then(function() {
    });
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
