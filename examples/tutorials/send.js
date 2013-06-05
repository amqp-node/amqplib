#!/usr/bin/env node

var api = require('amqplib');
api.connect('amqp://localhost').then(function(c) {
  c.createChannel().then(function(ch) {
    return ch.assertQueue('hello')
      .then(function() {
        ch.sendToQueue('hello', new Buffer('Hello World!'));
        console.log("[x] Sent 'Hello World!'");
      });
  }).then(function() { c.close(); });
}).then(null, console.warn);
