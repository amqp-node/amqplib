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


function runServer(socket, prepare) {
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

  prepare(send, await);
  return frames;
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

suite("Connection open", function() {

function openTest(client, server) {
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
  // nothing to check about the server...
  };
}

test("Connection open happy", openTest(
  function(c, done) {
    c.open(OPEN_OPTS).then(function(_ok) { done(); }, done);
  },
  function(send, await, done) {
    // kick it off
    send(defs.ConnectionStart,
         {versionMajor: 0,
          versionMinor: 9,
          serverProperties: {},
          mechanisms: new Buffer('PLAIN'),
          locales: new Buffer('en_US')});
    await()
      .then(function(_f) {
        send(defs.ConnectionTune,
             {channelMax: 0,
              heartbeat: 0,
              frameMax: 0});
        return await();
      })
      .then(function(_f) {
        send(defs.ConnectionOpenOk,
             {knownHosts: ''});
      }, done);
  }));

test("Connection open: wrong first frame", openTest(
  function(c, done) {
    c.open(OPEN_OPTS).then(function() {
      done(new Error("Not expected to succeed opening"));
    }, function(err) { done(); });
  },
  function(send, await, done) {
    // bad server! bad!
    send(defs.ConnectionTune,
         {channelMax: 0,
          heartbeat: 0,
          frameMax: 0});
  }));

});
