#!/usr/bin/env node

var amqp = require('amqplib/callback_api');

function on_connect(err, conn) {
  if (err !== null) return console.error(err);

  process.once('SIGINT', function() { conn.close(); });
  var ex = 'logs';
  
  function on_channel_open(err, ch) {
    if (err !== null) return console.error(err);
    ch.assertQueue('', {exclusive: true}, function(err, ok) {
      var q = ok.queue;
      ch.bindQueue(q, ex, '');
      ch.consume(q, logMessage, {noAck: true}, function(err, ok) {
        if (err !== null) return console.error(err);
        console.log(" [*] Waiting for logs. To exit press CTRL+C.");
      });
    });
  }

  function logMessage(msg) {
    if (msg)
      console.log(" [x] '%s'", msg.content.toString());
  }

  conn.createChannel(on_channel_open);
}

amqp.connect(on_connect);
