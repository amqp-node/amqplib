#!/usr/bin/env node
var recoverable = require('amqplib/recoverable_connection');

// This function should supply a normal callback
// It cannot be promisified, because the callback
// might be called multiple times during recovery
recoverable.recoverableConnection('amqp://localhost', {},
                                  {recover_forced: true},
  function(err, conn){
    if(err) {
      console.warn(err);
      throw err;
    } else {
      return conn.createChannel().then(function(ch) {

        var ok = ch.assertQueue('hello', {durable: false});

        ok = ok.then(function(_qok) {
          return ch.consume('hello', function(msg, ch) {
            console.log(" [x] Received '%s'", msg.content.toString());
            ch.ack(msg);
          });
        });

        return ok.then(function(_consumeOk) {
          console.log(' [*] Waiting for messages. To exit press CTRL+C');
        });
      });
    }
  });