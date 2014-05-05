#!/usr/bin/env node

var amqp = require('amqplib/callback_api');
var basename = require('path').basename;

var keys = process.argv.slice(2);
if (keys.length < 1) {
  console.log('Usage %s pattern [pattern...]',
              basename(process.argv[1]));
  process.exit(1);
}

function bail(err, conn) {
  console.error(err);
  if (conn) conn.close(function() { process.exit(1); });
}

function on_connect(err, conn) {
  if (err !== null) return bail(err);
  process.once('SIGINT', function() { conn.close(); });

  conn.createChannel(function(err, ch) {
    if (err !== null) return bail(err, conn);
    var ex = 'topic_logs', exopts = {durable: false};

    ch.assertExchange(ex, 'topic', exopts);
    ch.assertQueue('', {exclusive: true}, function(err, ok) {
      if (err !== null) return bail(err, conn);

      var queue = ok.queue, i = 0;

      function sub(err) {
        if (err !== null) return bail(err, conn);
        else if (i < keys.length) {
          ch.bindQueue(queue, ex, keys[i], {}, sub);
          i++;
        }
      }

      ch.consume(queue, logMessage, {noAck: true}, function(err) {
        if (err !== null) return bail(err, conn);
        console.log(' [*] Waiting for logs. To exit press CTRL+C.');
        sub(null);
      });
    });
  });
}

function logMessage(msg) {
  console.log(" [x] %s:'%s'",
              msg.fields.routingKey,
              msg.content.toString());
}

amqp.connect(on_connect);
