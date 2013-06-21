# AMQP 0-9-1 library and client for Node.JS

[![Build Status](https://travis-ci.org/squaremo/amqp.node.png)](https://travis-ci.org/squaremo/amqp.node)

 * [GitHub pages][gh-pages]
 * [API reference][gh-pages-apiref]
 * [Examples from RabbitMQ tutorials][tutes]

A library for making AMQP 0-9-1 clients for Node.JS, and an AMQP 0-9-1
client for Node.JS v0.8 and v0.10.

Project status:

 - Expected to work
 - A fair few tests
 - Ports of the [RabbitMQ tutorials][rabbitmq-tutes] as examples

Not yet:
 - Measured test coverage
 - Comprehensive documentation
 - Known to be used in production

## Client API example

```javascript
var q = 'tasks';

// Publisher
var open = require('amqplib').connect('amqp://localhost');
open.then(function(conn) {
  var ok = conn.createChannel();
  ok = ok.then(function(ch) {
    ch.assertQueue(q);
    ch.sendToQueue(q, new Buffer('something to do'));
  });
  return ok;
}).then(null, console.warn);

// Consumer
open.then(function(conn) {
  var ok = conn.createChannel();
  ok = ok.then(function(ch) {
    ch.assertQueue(q);
    ch.consume(q, function(msg) {
      console.log(msg.content.toString());
      ch.ack(msg);
    });
  });
  return ok;
}).then(null, console.warn);
```

## Running tests

    npm test

Best run with a locally-installed RabbitMQ, but you can point it at
another using the environment variable `URL`; e.g.,

    URL=amqp://dev.rabbitmq.com npm test

(NB You may experience test failures due to timeouts if using the
dev.rabbitmq.com instance)

You can run it under different versions of Node.JS using [nave][]:

    nave use 0.8 npm test

Lastly, setting the environment variable `LOG_ERRORS` will cause the
tests to output error messages encountered, to the console; this is
really only useful for checking the kind and formatting of the errors.

    LOG_ERRORS=true npm test

[gh-pages]: http://squaremo.github.com/amqp.node/
[gh-pages-apiref]: http://squaremo.github.com/amqp.node/doc/channel_api.html
[nave]: https://github.com/isaacs/nave
[tutes]: https://github.com/squaremo/amqp.node/tree/master/examples/tutorials
[rabbitmq-tutes]: http://www.rabbitmq.com/getstarted.html
