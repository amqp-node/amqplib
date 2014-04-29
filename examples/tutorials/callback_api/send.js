#!/usr/bin/env node

var amqp = require('amqplib/callback_api');

function on_connect(err, conn) {
  if (err !== null) return console.error(err);

  var q = 'hello';
  var msg = 'Hello World!';

  function on_channel_open(err, ch) {
    if (err !== null) return console.error(err);
    ch.assertQueue(q, {durable: false}, function(e, ok) {
      if (e !== null) return console.error(err);
      ch.sendToQueue(q, new Buffer(msg));
      console.log(" [x] Sent '%s'", msg);
      ch.close(function() { conn.close(); });
    });
  }

  conn.createChannel(on_channel_open);
}

amqp.connect(on_connect);
