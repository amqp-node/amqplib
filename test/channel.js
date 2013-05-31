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

suite("channel open and close", function() {

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

suite("channel machinery", function() {

test("RPC", channelTest(
  function(conn, done) {
    var ch = new Channel(conn);
    ch.open().then(function() {
      var rpcLatch = latch(3, done);
      var whee = succeed(rpcLatch);
      var boom = fail(rpcLatch);
      var fields = {
        prefetchCount: 10,
        prefetchSize: 0,
        global: false
      };

      ch.rpc(defs.BasicQos, fields, defs.BasicQosOk).then(whee, boom);
      ch.rpc(defs.BasicQos, fields, defs.BasicQosOk).then(whee, boom);
      ch.rpc(defs.BasicQos, fields, defs.BasicQosOk).then(whee, boom);
    }).then(null, fail(done));
  },
  function(send, await, done) {
    function sendOk(f) {
      send(defs.BasicQosOk, {}, f.channel);
    }

    channel_handshake(send, await)
      .then(await(defs.BasicQos))
      .then(sendOk)
      .then(await(defs.BasicQos))
      .then(sendOk)
      .then(await(defs.BasicQos))
      .then(sendOk)
      .then(null, fail(done));
  }));

test("Content", channelTest(
  function(conn, done) {
    var ch = new Channel(conn);
    ch.open()
      .then(function() {
        ch.sendMessage({
          exchange: 'foo', routingKey: 'bar',
          mandatory: false, immediate: false, ticket: 0
        }, {}, new Buffer('foobar'));
      })
      .then(null, fail(done));
  },
  function(send, await, done) {
    channel_handshake(send, await)
      .then(await(defs.BasicPublish))
      .then(await(defs.BasicProperties))
      .then(await(undefined)) // content frame
      .then(function(f) {
        assert.equal('foobar', f.content.toString());
      }).then(succeed(done), fail(done));
  }));

test("delivery", channelTest(
  function(conn, done) {
    var ch = new Channel(conn);
    ch.open();
    ch.on('delivery', function(m) {
      assert.equal('barfoo', m.content.toString());
      done();
    });
  },
  function(send, await, done) {
    channel_handshake(send, await)
      .then(function(ch) {
        send(defs.BasicDeliver, {
          consumerTag: 'fake',
          deliveryTag: 1,
          redelivered: false,
          exchange: 'foo',
          routingKey: 'bar'
        }, ch, new Buffer('barfoo'));
      })
      .then(null, fail(done));
  }));

test("return", channelTest(
  function(conn, done) {
    var ch = new Channel(conn);
    ch.open();
    ch.on('return', function(m) {
      assert.equal('barfoo', m.content.toString());
      done();
    });
  },
  function(send, await, done) {
    channel_handshake(send, await)
      .then(function(ch) {
        send(defs.BasicReturn, {
          replyCode: defs.constants.NO_ROUTE,
          replyText: 'derp',
          exchange: 'foo',
          routingKey: 'bar'
        }, ch, new Buffer('barfoo'));
      })
      .then(null, fail(done));
  }));

function confirmTest(variety, Method) {
  return test('confirm ' + variety, channelTest(
    function(conn, done) {
      var ch = new Channel(conn);
      ch.on(variety, function(f) {
        assert.equal(1, f.fields.deliveryTag);
        done();
      });
      ch.open();
    },
    function(send, await, done) {
      channel_handshake(send, await)
        .then(function(ch) {
          send(Method, {
            deliveryTag: 1,
            multiple: false
          }, ch);
        }).then(null, fail(done));
    }));
}

confirmTest("ack", defs.BasicAck);
confirmTest("nack", defs.BasicNack);

});
