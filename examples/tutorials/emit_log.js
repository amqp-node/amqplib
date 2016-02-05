#!/usr/bin/env node

var amqp = require('amqplib');
var when = require('when');

amqp.connect('amqp://localhost').then(function(conn) {
  return when(conn.createChannel().then(function(ch) {
    var ex = 'logs';
    var ok = ch.assertExchange(ex, 'fanout', {durable: false})

    var message = process.argv.slice(2).join(' ') ||
      'info: Hello World!';

    return ok.then(function() {
      ch.publish(ex, '', new Buffer(message));
      // when publish returns false the buffer is full see the "drain" event
      // of the channel how to handle this
      console.log(" [x] Sent '%s'", message);
      return ch.close();
    });
  })).ensure(function() { conn.close(); });
}).then(null, console.warn);
