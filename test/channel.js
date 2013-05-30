// Test the channel model API

var assert = require('assert');
var Channel = require('../lib/channel').Channel;
var Connection = require('../lib/connection').Connection;
var mock = require('./mocknet');
var succeed = mock.succeed, fail = mock.fail, latch = mock.latch;
var defs = require('../lib/defs');
var conn_handshake = require('./connection').open_handshake;
var OPEN_OPTS = require('./connection').OPEN_OPTS;

function channelTest(client, server) {
  return function(done) {
    var pair = mock.socketPair();
    var c = new Connection(pair.client);
    c.open(OPEN_OPTS).then(function() {
      client(c, done);
    }, fail(done));

    pair.server.read(8); // throw away the protocol header
    var s = mock.runServer(pair.server, function(send, await) {
      conn_handshake(send, await)
        .then(function() {
          server(send, await, done);
        }, fail(done));
    });
  };
}

function channel_handshake(send, await) {
  return await(defs.ChannelOpen)()
    .then(function(open) {
      assert.notEqual(0, open.channel);
      send(defs.ChannelOpenOk, {channelId: new Buffer('')}, open.channel);
      return open.channel;
    });
}

suite("channel", function() {

test("open", channelTest(
  function(c, done) {
    var ch = new Channel(c);
    ch.open().then(succeed(done), fail(done));
  },
  function(send, await, done) {
    channel_handshake(send, await).then(null, fail(done));
  }));

test("open, close", channelTest(
  function(conn, done) {
    var ch = new Channel(conn);
    ch.open()
      .then(function() {
        return ch.close();
      })
      .then(succeed(done), fail(done));
  },
  function(send, await, done) {
    channel_handshake(send, await)
      .then(await(defs.ChannelClose))
      .then(function(close) {
        send(defs.ChannelCloseOk, {}, close.channel);
      }).then(null, fail(done));
  }));

test("server close", function(done0) {
  var doneLatch = latch(2, done0);

  channelTest(
    function(conn, done) {
      var ch = new Channel(conn);
      ch.on('error', succeed(done));
      ch.open();
    },
    function(send, await, done) {
      channel_handshake(send, await)
        .then(function(num) {
          send(defs.ChannelClose, {
            replyText: 'Forced close',
            replyCode: defs.constants.CHANNEL_ERROR,
            classId: 0, methodId: 0
          }, num);
        })
        .then(await(defs.ChannelCloseOk))
        .then(succeed(done), fail(done));
    })(doneLatch);
});

}); //suite
