#!/usr/bin/env node

var amqp = require('amqplib/callback_api');

function fib(n) {
  var a = 0, b = 1;
  for (var i=0; i < n; i++) {
    var c = a + b;
    a = b; b = c;
  }
  return a;
}

function bail(err, conn) {
  console.error(err);
  if (conn) conn.close(function() { process.exit(1); });
}

function on_connect(err, conn) {
  if (err !== null) return bail(err);

  process.once('SIGINT', function() { conn.close(); });

  var q = 'rpc_queue';

  conn.createChannel(function(err, ch) {
    ch.assertQueue(q, {durable: false});
    ch.prefetch(1);
    ch.consume(q, reply, {noAck:false}, function(err) {
      if (err !== null) return bail(err, conn);
      console.log(' [x] Awaiting RPC requests');
    });

    function reply(msg) {
      var n = parseInt(msg.content.toString());
      console.log(' [.] fib(%d)', n);
      ch.sendToQueue(msg.properties.replyTo,
                     new Buffer(fib(n).toString()),
                     {correlationId: msg.properties.correlationId});
      ch.ack(msg);
    }
  });
}

amqp.connect(on_connect);
