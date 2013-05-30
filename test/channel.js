// Test the channel model API

var assert = require('assert');
var Channel = require('../lib/channel').Channel;
var Connection = require('../lib/connection').Connection;
var mock = require('./mocknet');
var succeed = mock.succeed, fail = mock.fail;
var defs = require('../lib/defs');
var conn_handshake = require('./connection').open_handshake;
var OPEN_OPTS = require('./connection').OPEN_OPTS;

test("channel open", function(done) {
  var pair = mock.socketPair();
  var c = new Connection(pair.client);
  c.open(OPEN_OPTS).then(function() {
    var ch = new Channel(c);
    ch.open().then(succeed(done), fail(done));
  });

  pair.server.read(8); // throw away the protocol header

  var s = mock.runServer(pair.server, function(send, await) {
    conn_handshake(send, await)
      .then(await(defs.ChannelOpen))
      .then(function(f) {
        assert.notEqual(0, f.channel);
        send(defs.ChannelOpenOk, {channelId: new Buffer('')}, f.channel);
      }).then(null, fail(done));
    });
});
