#!/usr/bin/env node

var api = require('amqplib');

api.connect('amqp://localhost').then(function(conn) {
  return conn.createChannel().then(function(ch) {
    var msg = 'Hello World!';

    var ok = ch.assertQueue('hello', {durable: false});
    
    return ok.then(function(_qok) {
      ch.sendToQueue('hello', new Buffer(msg));
      console.log("[x] Sent '%s'", msg);
    }).then(function() { conn.close(); });
  });
}).then(null, console.warn);
