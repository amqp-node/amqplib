#!/usr/bin/env node

var amqp = require('amqplib/callback_api');

var args = process.argv.slice(2);
var key = (args.length > 0) ? args[0] : 'info';
var message = args.slice(1).join(' ') || 'Hello World!';

function on_connect(err, conn) {
  if (err !== null) return console.error(err);
  var ex = 'topic_logs', exopts = {durable: false};
  conn.createChannel(function(err, ch) {
    ch.assertExchange(ex, 'topic', exopts, function(err, ok) {
      if (err !== null) return console.error(err);
      ch.publish(ex, key, new Buffer(message));
      console.log(" [x] Sent %s:'%s'", key, message);
      ch.close(function() { conn.close(); });
    });
  });
}

amqp.connect(on_connect);
