#!/usr/bin/env node

var amqp = require('amqplib');
var when = require('when');

var args = process.argv.slice(2);
var key = (args.length > 0) ? args[0] : 'info';
var message = args.slice(1).join(' ') || 'Hello World!';

amqp.connect('amqp://localhost').then(function(conn) {
  return when(conn.createChannel().then(function(ch) {
    var ex = 'topic_logs';
    var ok = ch.assertExchange(ex, 'topic', {durable: false});
    return ok.then(function() {
      ch.publish(ex, key, new Buffer(message));
      // when publish returns false the buffer is full see the "drain" event
      // of the channel how to handle this
      console.log(" [x] Sent %s:'%s'", key, message);
      return ch.close();
    });
  })).ensure(function() { conn.close(); })
}).then(null, console.log);
