#!/usr/bin/env node

var amqp = require('amqplib/callback_api');
var basename = require('path').basename;
var uuid = require('node-uuid');

var n;
try {
  if (process.argv.length < 3) throw Error('Too few args');
  n = parseInt(process.argv[2]);
}
catch (e) {
  console.error(e);
  console.warn('Usage: %s number', basename(process.argv[1]));
  process.exit(1);
}

function on_connect(err, conn) {
  if (err !== null) return console.error(err);
  conn.createChannel(function(err, ch) {
    if (err !== null) return console.error(err);

    var correlationId = uuid();
    function maybeAnswer(msg) {
      if (msg.properties.correlationId === correlationId) {
        console.log(' [.] Got %d', msg.content.toString());
      }
      ch.close(function() { conn.close(); });
    }

    ch.assertQueue('', {exclusive: true}, function(err, ok) {
      if (err !== null) return console.error(err);
      var queue = ok.queue;
      ch.consume(queue, maybeAnswer, {noAck:true});
      console.log(' [x] Requesting fib(%d)', n);
      ch.sendToQueue('rpc_queue', new Buffer(n.toString()), {
        replyTo: queue, correlationId: correlationId
      });
    });
  });
}

amqp.connect(on_connect);
