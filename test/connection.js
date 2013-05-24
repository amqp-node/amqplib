var assert = require('assert');
var defer = require('when').defer;
var defs = require('../lib/defs');
var Connection = require('../lib/connection').Connection;
var Frames = require('../lib/frame');
var PassThrough =
  require('stream').PassThrough ||
  require('readable-stream/passthrough');

// Assume Frames works fine, now test Connection.

// Set up a socket pair {client, server}, such that writes to the
// client are readable from the server, and writes to the server are
// readable at the client.
//
//          +---+      +---+
//          | C |      | S |
// --write->| l |----->| e |--read-->
//          | i |      | r |
// <--read--| e |<-----| v |<-write--
//          | n |      | e |
//          | t |      | r |
//          +---+      +---+

function socketPair() {
  var server = new PassThrough();
  var client = new PassThrough();
  server.write = client.push.bind(client);
  client.write = server.push.bind(server);
  return {client: client, server: server};
}


function runServer(socket, run) {
  var frames = new Frames(socket);

  function send(id, fields) {
    frames.sendMethod(0, id, fields);
  }

  function await() {
    var d = defer();
    frames.accept = d.resolve.bind(d);
    frames.step();
    return d.promise;
  }

  run(send, await);
  return frames;
}

// Produce a callback that will complete the test successfully
function succeed(done) {
  return function() { done(); }
}

// Produce a callback that will fail the test, given either an error
// (to be used as a failure continuation) or any other value (to be
// used as a success continuation when failure is expected)
function fail(done) {
  return function(err) {
    if (err instanceof Error) done(err);
    else done(new Error("Expected to fail, instead got " + err.toString()));
  }
}

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

function happy_open(send, await) {
  // kick it off
  send(defs.ConnectionStart,
       {versionMajor: 0,
        versionMinor: 9,
        serverProperties: {},
        mechanisms: new Buffer('PLAIN'),
        locales: new Buffer('en_US')});
  return await()
    .then(function(f) {
      assert.equal(defs.ConnectionStartOk, f.id);
      send(defs.ConnectionTune,
           {channelMax: 0,
            heartbeat: 0,
            frameMax: 0});
      return await();
    })
    .then(function(f) {
      assert.equal(defs.ConnectionTuneOk, f.id);
      return await();
    })
    .then(function(f) {
      assert.equal(defs.ConnectionOpen, f.id);
      send(defs.ConnectionOpenOk,
           {knownHosts: ''});
    });
}

function connectionTest(client, server) {
  return function(done) {
    var pair = socketPair();
    var c = new Connection(pair.client);
    client(c, done);

    // NB only not a race here because the writes are synchronous
    var protocolHeader = pair.server.read(8);
    assert.deepEqual(new Buffer("AMQP" + String.fromCharCode(0,0,9,1)),
                     protocolHeader);

    var s = runServer(pair.server, function(send, await) {
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
      .then(await)
      .then(function(close) {
        assert.equal(defs.ConnectionClose, close.id);
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
      .then(await)
      .then(function(f) {
        assert.equal(defs.ConnectionClose, f.id);
        send(defs.ConnectionClose, {
          replyText: "Ha!",
          replyCode: defs.constants.REPLY_SUCCESS,
          methodId: 0, classId: 0
        });
        return await();
      })
      .then(function(f) {
        assert.equal(defs.ConnectionCloseOk, f.id);
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
      .then(await)
      .then(function(f) {
        assert.equal(defs.ConnectionCloseOk, f.id);
      })
      .then(null, fail(done));
  }));
});
