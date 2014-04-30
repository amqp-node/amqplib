#!/usr/bin/env node

var amqp = require('amqplib/callback_api');

function on_connect(err, conn) {
  if (err !== null) return console.error(err);

  var q = 'task_queue';
  
  function on_channel_open(err, ch) {
    if (err !== null) return console.error(err);
    ch.assertQueue(q, {durable: true}, function(err, _ok) {
      var msg = process.argv.slice(2).join(' ') || "Hello World!";
      ch.sendToQueue(q, new Buffer(msg), {persistent: true});
      console.log(" [x] Sent '%s'", msg);
      ch.close(function() { conn.close(); });
    });
  }

  conn.createChannel(on_channel_open);
}

amqp.connect(on_connect);
