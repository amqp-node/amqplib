#!/usr/bin/env node

var amqp = require('amqplib/callback_api');

var args = process.argv.slice(2);
var severity = (args.length > 0) ? args[0] : 'info';
var message = args.slice(1).join(' ') || 'Hello World!';

function on_connect(err, conn) {
  if (err !== null) return console.error(err);
  var ex = 'direct_logs';
  var exopts = {durable: false};
  
  function on_channel_open(err, ch) {
    if (err !== null) return console.error(err);
    ch.assertExchange(ex, 'direct', exopts, function(err, ok) {
      ch.publish(ex, severity, new Buffer(message));
      ch.close(function() { conn.close(); });
    });
  }
  conn.createChannel(on_channel_open);
}

amqp.connect(on_connect);
