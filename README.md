# AMQP 0-9-1 library and client for Node.JS

[![Build Status](https://travis-ci.org/squaremo/amqp.node.png)](https://travis-ci.org/squaremo/amqp.node)

    npm install amqplib

 * [Change log][changelog]
 * [GitHub pages][gh-pages]
 * [API reference][gh-pages-apiref]
 * [Examples from RabbitMQ tutorials][tutes]

A library for making AMQP 0-9-1 clients for Node.JS, and an AMQP 0-9-1
client for Node.JS v0.8-0.12, v4-v14, and the intervening io.js
releases.

This library does not implement [AMQP
1.0](https://github.com/squaremo/amqp.node/issues/63) or [AMQP
0-10](https://github.com/squaremo/amqp.node/issues/94).

Project status:

 - Expected to work
 - Complete high-level and low-level APIs (i.e., all bits of the protocol)
 - Stable APIs
 - A fair few tests
 - Measured test coverage
 - Ports of the [RabbitMQ tutorials][rabbitmq-tutes] as [examples][tutes]
 - Used in production

Still working on:

 - Getting to 100% (or very close to 100%) test coverage

## Callback API example

```javascript
var q = 'tasks';

function bail(err) {
  console.error(err);
  process.exit(1);
}

// Publisher
function publisher(conn) {
  conn.createChannel(on_open);
  function on_open(err, ch) {
    if (err != null) bail(err);
    ch.assertQueue(q);
    ch.sendToQueue(q, Buffer.from('something to do'));
  }
}

// Consumer
function consumer(conn) {
  var ok = conn.createChannel(on_open);
  function on_open(err, ch) {
    if (err != null) bail(err);
    ch.assertQueue(q);
    ch.consume(q, function(msg) {
      if (msg !== null) {
        console.log(msg.content.toString());
        ch.ack(msg);
      }
    });
  }
}

require('amqplib/callback_api')
  .connect('amqp://localhost', function(err, conn) {
    if (err != null) bail(err);
    consumer(conn);
    publisher(conn);
  });
```

## Promise API example

```javascript
var q = 'tasks';

var open = require('amqplib').connect('amqp://localhost');

// Publisher
open.then(function(conn) {
  return conn.createChannel();
}).then(function(ch) {
  return ch.assertQueue(q).then(function(ok) {
    return ch.sendToQueue(q, Buffer.from('something to do'));
  });
}).catch(console.warn);

// Consumer
open.then(function(conn) {
  return conn.createChannel();
}).then(function(ch) {
  return ch.assertQueue(q).then(function(ok) {
    return ch.consume(q, function(msg) {
      if (msg !== null) {
        console.log(msg.content.toString());
        ch.ack(msg);
      }
    });
  });
}).catch(console.warn);
```

## Running tests

    npm test

To run the tests RabbitMQ is required. Either install it with your package
manager, or use [docker][] to run a RabbitMQ instance.

    docker run -d --name amqp.test -p 5672:5672 rabbitmq

If prefer not to run RabbitMQ locally it is also possible to use a
instance of RabbitMQ hosted elsewhere. Use the `URL` environment
variable to configure a different amqp host to connect to. You may
also need to do this if docker is not on localhost; e.g., if it's
running in docker-machine.

One public host is dev.rabbitmq.com:

    URL=amqp://dev.rabbitmq.com npm test

**NB** You may experience test failures due to timeouts if using the
dev.rabbitmq.com instance.

You can run it under different versions of Node.JS using [nave][]:

    nave use 0.8 npm test

or run the tests on all supported versions of Node.JS in one go:

    make test-all-nodejs

(which also needs `nave` installed, of course).

Lastly, setting the environment variable `LOG_ERRORS` will cause the
tests to output error messages encountered, to the console; this is
really only useful for checking the kind and formatting of the errors.

    LOG_ERRORS=true npm test

## Test coverage

    make coverage
    open file://`pwd`/coverage/lcov-report/index.html

[gh-pages]: http://squaremo.github.com/amqp.node/
[gh-pages-apiref]: http://squaremo.github.com/amqp.node/channel_api.html
[nave]: https://github.com/isaacs/nave
[tutes]: https://github.com/squaremo/amqp.node/tree/master/examples/tutorials
[rabbitmq-tutes]: http://www.rabbitmq.com/getstarted.html
[changelog]: https://github.com/squaremo/amqp.node/blob/master/CHANGELOG.md
[docker]: https://www.docker.com/
