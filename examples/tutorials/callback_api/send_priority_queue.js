#!/usr/bin/env node

var amqp = require('amqplib/callback_api');

function bail(err, conn) {
  console.error(err);
  if (conn) conn.close(function() { process.exit(1); });
}

function on_connect(err, conn) {
  if (err !== null) return bail(err);

  var q = 'hello';
  var message = '';
  var priorityValue = 0;

  function on_channel_open(err, ch) {
    if (err !== null) return bail(err, conn);
    ch.assertQueue(q, {durable: false, maxPriority: 10}, function(err, ok) {
      if (err !== null) return bail(err, conn);

      for(var index=1; index<=50; index++) {
        priorityValue = Math.floor((Math.random() * 10));
        // index refers to message number. Lower is the index value, earlier is the message pushed into the queue.
        message = 'Message index = ' + index + ' and Priority Value = ' + priorityValue;
        ch.sendToQueue(q, new Buffer(message), {priority: priorityValue});
        console.log(" [x] Sent '%s'", message);
      }
      ch.close(function() { conn.close(); });
    });
  }

  conn.createChannel(on_channel_open);
}

amqp.connect(on_connect);
