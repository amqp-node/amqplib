# AMQP 0-9-1 library and client for Node.JS

[![NPM version](https://img.shields.io/npm/v/amqplib.svg?style=flat-square)](https://www.npmjs.com/package/amqplib)
[![NPM downloads](https://img.shields.io/npm/dm/amqplib.svg?style=flat-square)](https://www.npmjs.com/package/amqplib)
[![Node.js CI](https://github.com/amqp-node/amqplib/workflows/Node.js%20CI/badge.svg)](https://github.com/amqp-node/amqplib/actions?query=workflow%3A%22Node.js+CI%22)
[![amqplib](https://snyk.io/advisor/npm-package/amqplib/badge.svg)](https://snyk.io/advisor/npm-package/amqplib)

    npm install amqplib

 * [Change log][changelog]
 * [GitHub pages][gh-pages]
 * [API reference][gh-pages-apiref]
 * [Troubleshooting][gh-pages-trouble]
 * [Examples from RabbitMQ tutorials][tutes]


A library for making AMQP 0-9-1 clients for Node.JS, and an AMQP 0-9-1 client for Node.JS v10+.

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

## Promise/Async API example

```javascript
const amqplib = require('amqplib');

(async () => {
  const conn = await amqplib.connect('amqp://localhost');
  const ch = await conn.createChannel();

  const queue = 'tasks';
  
  await ch.assertQueue(queue);

  // Listener
  ch.consume(queue, function(msg) {
    if (msg !== null) {
      console.log('Recieved:', msg.content.toString());
      ch.ack(msg);
    }
  });

  // Sender
  setInterval(async () => {
    await ch.sendToQueue(queue, Buffer.from('something to do'));
  }, 1000);
})()

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

[gh-pages]: https://amqp-node.github.io/amqplib/
[gh-pages-apiref]: https://amqp-node.github.io/amqplib/channel_api.html
[gh-pages-trouble]: https://amqp-node.github.io/amqplib/#troubleshooting
[nave]: https://github.com/isaacs/nave
[tutes]: https://github.com/amqp-node/amqplib/tree/main/examples/tutorials
[rabbitmq-tutes]: http://www.rabbitmq.com/getstarted.html
[changelog]: https://github.com/amqp-node/amqplib/blob/main/CHANGELOG.md
[docker]: https://www.docker.com/
