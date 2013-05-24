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


function runServer(frames, machine) {

  function send(id, fields) {
    frames.sendMethod(0, id, fields);
  }

  function await() {
    var d = defer();
    frames.accept = d.resolve.bind(d);
    frames.step();
    return d.promise;
  }

  return machine(send, await);
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

test("Connection open happy", function(done) {
  var pair = socketPair();
  var server = pair.server;

  var c = new Connection(pair.client);
  c.open(OPEN_OPTS).then(function(_ok) { done(); }, assert.fail);

  var protocolHeader = server.read(8);
  assert.deepEqual(new Buffer("AMQP" + String.fromCharCode(0,0,9,1)),
                   protocolHeader);

  var frames = new Frames(server);
  runServer(frames, function(send, await) {
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
      }, assert.fail);
  });
});
