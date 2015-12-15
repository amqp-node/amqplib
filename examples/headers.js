#!/usr/bin/env node

// Example of using a headers exchange

var amqp = require('../')

amqp.connect().then(function(conn) {
  return conn.createChannel().then(withChannel);
}, console.error);

function withChannel(ch) {
  // NB the type of the exchange is 'headers'
  ch.assertExchange('matching exchange', 'headers').then(function(ex) {
    ch.assertQueue().then(function(q) {
      bindAndConsume(ch, ex, q).then(function() {
        send(ch, ex);
      });
    });
  });
}

function bindAndConsume(ch, ex, q) {
  // When using a headers exchange, the headers to be matched go in
  // the binding arguments. The routing key is ignore, so best left
  // empty.

  // 'x-match' is 'all' or 'any', meaning "all fields must match" or
  // "at least one field must match", respectively. The values to be
  // matched go in subsequent fields.
  ch.bindQueue(q.queue, ex.exchange, '', {'x-match': 'any',
                                          'foo': 'bar',
                                          'baz': 'boo'});
  return ch.consume(q.queue, function(msg) {
    console.log(msg.content.toString());
  }, {noAck: true});
}

function send(ch, ex) {
  // The headers for a message are given as an option to `publish`:
  ch.publish(ex.exchange, '', new Buffer('hello'), {headers: {baz: 'boo'}});
  ch.publish(ex.exchange, '', new Buffer('world'), {headers: {foo: 'bar'}});
}
