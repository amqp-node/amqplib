#!/usr/bin/env node

var api = require('amqplib');

api.connect('amqp://localhost').then(function(conn) {
  process.on('SIGINT', function() { conn.close(); });
  return conn.createChannel().then(function(ch) {
    
    var ok = ch.assertQueue('hello', {durable: false});
    
    ok = ok.then(function(_qok) {
      return ch.consume('hello', function(msg) {
        console.log("[x] Received '%s'", msg.content.toString());
      }, {noAck: true});
    });
    
    return ok.then(function(_consumeOk) {
      console.log('[*] Waiting for messages. Press CTRL-C to exit');
    });
  });
}).then(null, console.warn);
