#!/usr/bin/env node

var amqp = require('amqplib/callback_api');

function bail(err, conn) {
  console.error(err);
  if (conn) conn.close(function() { process.exit(1); });
}

function on_connect(err, conn) {
  if (err !== null) return bail(err);

  var q = 'hello';
  var msg = 'Hello World!';

  function on_channel_open(err, ch) {
    if (err !== null) return bail(err, conn);
    ch.assertQueue(q, {durable: false}, function(err, ok) {
      if (err !== null) return bail(err, conn);
      ch.sendToQueue(q, Buffer.from(msg));
      console.log(" [x] Sent '%s'", msg);
      ch.close(function() { conn.close(); });
    });
  }

  conn.createChannel(on_channel_open);
}

amqp.connect(on_connect);
