#!/usr/bin/env node

var amqp = require('amqplib');

amqp.connect('amqp://localhost').then(function(conn) {
  return conn.createChannel().then(function(ch) {
    var ok = ch.assertExchange('logs', 'fanout', {durable: false})

    var message = process.argv.slice(2).join(' ') ||
      'info: Hello World!';

    ok = ok.then(function() {
      ch.publish('logs', '', new Buffer(message));
      console.log(" [x] Sent '%s'", message);
    });
    return ok.then(function() { conn.close(); });
  });
}).then(null, console.warn);
