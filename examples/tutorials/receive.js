#!/usr/bin/env node

var amqp = require('amqplib');
var connection;

amqp.connect(['amqp://localhost', 'amqp://localhost:5673']
  ,
  {recover: true, recoverOnServerClose: true, recoverRetries: 5, recoverTimeout: 100, recoverAfter: 100}
  ).then(function(conn) {
    connection = conn;
  process.once('SIGINT', function() {
    console.log("SIGINT received");
    conn.close(); });
  return conn.createConfirmChannel().then(function(ch) {
    var ok = ch.prefetch(10, false);
    var qname = '';

    ok = ok.then(function() {
      return ch.assertQueue('hello', {durable: false});
    });

    // ok = ok.then(function() {
    //   return ch.assertQueue('hello', {durable: true});
    // });

    ok = ok.then(function(){
      return ch.assertExchange('hello', 'direct', {alternateExchange: 'bar'});
    });

    ok = ok.then(function(){
      return ch.bindQueue('hello', 'hello', 'hello');
    });

    // Anonymous queue
    ok = ok.then(function(){
      return ch.assertQueue(qname, {durable: false});
    }).then(function(qok){
      qname = qok.queue;
      return qok;
    });

    ok = ok.then(function(){
      return ch.bindQueue('hello', 'hello', 'auto');
    });

    ok = ok.then(function() {
      // Subscribe to the anonymous queue.
      return ch.consume('hello', function(msg) {
        if(msg == null){
          console.log("Received cancel");
        } else {
          console.log(" [x] Received '%s' " + msg.fields.deliveryTag, msg.content.toString());
          setTimeout(function(){
            console.log(" [-] Ack message " + msg.fields.deliveryTag);
            ch.ack(msg);
          }, 5000);
        }
      }, {noAck: false});
    });

    ok = ok.then(function(_consumeOk) {
      console.log(' [*] Waiting for messages. To exit press CTRL+C');
    });

    for(var i = 0; i < 1000; i ++) {
      ok = ok.delay(5000).then(function(){
        ch.publish('hello', 'hello', Buffer.from('message'));
      });
    }

    return ok;
  });
}).then(function(){
  console.log(" Channel created ");
}).catch(console.warn);



// var amqp = require('amqplib/callback_api');

// amqp.connect('amqp://localhost',{recover: false, recoverRetries: 10, recoverTimeout: 10000, recoverTopology: true, recoverOnServerClose: true}, function(err, conn) {
//   conn.on('error', function(){
//     console.log("Error emitted");
//   });
//   process.once('SIGINT', function() {
//     console.log("SIGINT received");
//     conn.close(); });
//   return conn.createConfirmChannel(function(err, ch) {
//     var ok = ch.prefetch(10, false,
//       function(err){
//         ch.assertExchange('hello', 'direct', {}, function(){
//           ch.assertQueue('', {durable: false}, function(err, declareok) {
//             var qname = declareok.queue;
//             ch.bindQueue(qname, 'hello', 'auto', {}, function() {
//               ch.consume(qname, function(msg) {
//                 console.log(" [x] Received '%s'", msg.content.toString());
//               }, {noAck: true}, function() {
//                   console.log(' [*] Waiting for messages. To exit press CTRL+C');
//                 });
//             });
//           });
//         });
//       });
//   });
// });