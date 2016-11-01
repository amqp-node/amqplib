#!/usr/bin/env node

var amqp = require('amqplib');
var basename = require('path').basename;
var Promise = require('bluebird');
var uuid = require('node-uuid');

// I've departed from the form of the original RPC tutorial, which
// needlessly introduces a class definition, and doesn't even
// parameterise the request.

var n;
try {
  if (process.argv.length < 3) throw Error('Too few args');
  n = parseInt(process.argv[2]);
}
catch (e) {
  console.error(e);
  console.warn('Usage: %s number', basename(process.argv[1]));
  process.exit(1);
}

amqp.connect('amqp://localhost').then(function(conn) {
  return conn.createChannel().then(function(ch) {
    return new Promise(function(resolve) {
      var corrId = uuid();
      function maybeAnswer(msg) {
        if (msg.properties.correlationId === corrId) {
          resolve(msg.content.toString());
        }
      }

      var ok = ch.assertQueue('', {exclusive: true})
        .then(function(qok) { return qok.queue; });

      ok = ok.then(function(queue) {
        return ch.consume(queue, maybeAnswer, {noAck: true})
          .then(function() { return queue; });
      });

      ok = ok.then(function(queue) {
        console.log(' [x] Requesting fib(%d)', n);
        ch.sendToQueue('rpc_queue', new Buffer(n.toString()), {
          correlationId: corrId, replyTo: queue
        });
      });
    });
  })
  .then(function(fibN) {
    console.log(' [.] Got %d', fibN);
  })
  .finally(function() { conn.close(); });
}).catch(console.warn);
