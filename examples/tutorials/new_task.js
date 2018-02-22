#!/usr/bin/env node
// Post a new task to the work queue

var amqp = require('amqplib');

amqp.connect('amqp://localhost').then(function(conn) {
  return conn.createChannel().then(function(ch) {
    var q = 'task_queue';
    var ok = ch.assertQueue(q, {durable: true});

    return ok.then(function() {
      var msg = process.argv.slice(2).join(' ') || "Hello World!";
      ch.sendToQueue(q, Buffer.from(msg), {deliveryMode: true});
      console.log(" [x] Sent '%s'", msg);
      return ch.close();
    });
  }).finally(function() { conn.close(); });
}).catch(console.warn);
