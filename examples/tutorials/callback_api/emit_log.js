#!/usr/bin/env node

var amqp = require('amqplib/callback_api');

function bail(err, conn) {
  console.error(err);
  if (conn) conn.close(function() { process.exit(1); });
}

function on_connect(err, conn) {
  if (err !== null) return bail(err);

  var ex = 'logs';

  function on_channel_open(err, ch) {
    if (err !== null) return bail(err, conn);
    ch.assertExchange(ex, 'fanout', {durable: false});
    var msg = process.argv.slice(2).join(' ') ||
      'info: Hello World!';
    ch.publish(ex, '', new Buffer(msg));
    // when publish returns false the buffer is full see the "drain" event
    // of the channel how to handle this
    console.log(" [x] Sent '%s'", msg);
    ch.close(function() { conn.close(); });
  }

  conn.createChannel(on_channel_open);
}

amqp.connect(on_connect);
