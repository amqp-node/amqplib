#!/usr/bin/env node

var amqp = require('amqplib/callback_api');

function on_connect(err, conn) {
  if (err !== null) return console.error(err);
  process.once('SIGINT', function() { conn.close(); });
  
  var q = 'task_queue';

  function on_channel_open(err, ch) {
    if (err !== null) return console.error(err);
    ch.assertQueue(q, {durable: true}, function(err, _ok) {
      ch.consume(q, doWork, {no_ack: false});
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
  }

  conn.createChannel(on_channel_open);
}

amqp.connect(on_connect);
