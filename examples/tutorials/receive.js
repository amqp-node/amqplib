#!/usr/bin/env node

var api = require('amqplib');
api.connect('amqp://localhost')
  .then(function(c) { return c.createChannel(); })
  .then(function(ch) {
    return ch.assertQueue('hello')
      .then(function() {
        return ch.consume('hello', function(msg) {
          console.log('[x] Received ' + msg.content.toString());
        }, {noAck: true}); })})
  .then(function(ok) {
    console.log('[x] Waiting for messages. Press Ctrl-C to exit');
  }).then(null, console.warn);
