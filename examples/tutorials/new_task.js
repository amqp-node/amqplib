#!/usr/bin/env node
// Post a new task to the work queue

var amqp = require('amqplib');

amqp.connect('amqp://localhost').then(function(conn) {
  return conn.createChannel().then(function(ch) {
    var ok = ch.assertQueue('task_queue', {durable: true});
    
    ok.then(function() {
      var msg = process.argv.slice(2).join(' ') || "Hello World!"
      ch.sendToQueue('task_queue', new Buffer(msg),
                     {deliveryMode: true});
      console.log("[x] Sent '%s'", msg);
    });
    return ok;
  }).then(function() { conn.close(); });
}).then(null, console.warn);
