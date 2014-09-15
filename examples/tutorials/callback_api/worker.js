#!/usr/bin/env node

var amqp = require('amqplib/callback_api');

function bail(err, conn) {
  console.error(err);
  if (conn) conn.close(function() { process.exit(1); });
}

function on_connect(err, conn) {
  if (err !== null) return bail(err);
  process.once('SIGINT', function() { conn.close(); });
  
  var q = 'task_queue';

  conn.createChannel(function(err, ch) {
    if (err !== null) return bail(err, conn);
    ch.assertQueue(q, {durable: true}, function(err, _ok) {
      ch.consume(q, doWork, {noAck: false});
      console.log(" [*] Waiting for messages. To exit press CTRL+C");
    });

    function doWork(msg) {
      var body = msg.content.toString();
      console.log(" [x] Received '%s'", body);
      var secs = body.split('.').length - 1;
      setTimeout(function() {
        console.log(" [x] Done");
        ch.ack(msg);
      }, secs * 1000);
    }
  });
}

amqp.connect(on_connect);
