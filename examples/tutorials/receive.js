#!/usr/bin/env node

var api = require('amqplib');

api.connect('amqp://localhost').then(function(c) {
  process.on('SIGINT', c.close.bind(c));
  return c.createChannel().then(function(ch) {
    
    var ok = ch.assertQueue('hello');
    
    ok = ok.then(function() {
      var log = console.log.bind(null, '[x] Received ');
      return ch.consume('hello', function(msg) {
        log(msg.content.toString());
      }, {noAck: true}); });
    
    return ok.then(function() {
      console.log('[x] Waiting for messages. Press Ctrl-C to exit');
    });
  });
}).then(null, console.warn);
