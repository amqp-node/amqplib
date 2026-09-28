# AMQP 0-9-1 library and client for Node.JS

[![NPM version](https://img.shields.io/npm/v/amqplib.svg?style=flat-square)](https://www.npmjs.com/package/amqplib)
[![NPM downloads](https://img.shields.io/npm/dm/amqplib.svg?style=flat-square)](https://www.npmjs.com/package/amqplib)
[![Node.js CI](https://github.com/amqp-node/amqplib/workflows/Node.js%20CI/badge.svg)](https://github.com/amqp-node/amqplib/actions?query=workflow%3A%22Node.js+CI%22)
[![amqplib](https://snyk.io/advisor/npm-package/amqplib/badge.svg)](https://snyk.io/advisor/npm-package/amqplib)

A library for making AMQP 0-9-1 clients for Node.JS, and an AMQP 0-9-1 client for Node.JS v18+. This library does not implement [AMQP1.0](https://github.com/amqp-node/amqplib/issues/63) or [AMQP0-10](https://github.com/amqp-node/amqplib/issues/94).

    npm install amqplib

## RabbitMQ Compatibility

Only `0.10.7` and later versions of this library are compatible with RabbitMQ 4.1.0 (and later releases).

## Links
 * [Change log][changelog]
 * [GitHub pages][gh-pages]
 * [API reference][gh-pages-apiref]
 * [Troubleshooting][gh-pages-trouble]
 * [Examples from RabbitMQ tutorials][tutes]

## Project status

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
const amqplib = require('amqplib/callback_api');
const queue = 'tasks';

amqplib.connect('amqp://localhost', (err, conn) => {
  if (err) throw err;

  conn.on('error', (err) => { console.error('Connection error:', err); });
  conn.on('handler-error', (err, event) => { console.error(`Uncaught exception in connection ${event} listener:`, err); });

  // Listener
  conn.createChannel((err, ch2) => {
    if (err) throw err;

    ch2.on('error', (err) => { console.error('Channel error:', err); });
    ch2.on('handler-error', (err, event) => { console.error(`Uncaught exception in channel ${event} listener:`, err); });

    ch2.assertQueue(queue);

    ch2.consume(queue, (msg) => {
      if (msg !== null) {
        console.log(msg.content.toString());
        ch2.ack(msg);
      } else {
        console.log('Consumer cancelled by server');
      }
    });
  });

  // Sender
  conn.createChannel((err, ch1) => {
    if (err) throw err;

    ch1.on('error', (err) => { console.error('Channel error:', err); });
    ch1.on('handler-error', (err, event) => { console.error(`Uncaught exception in channel ${event} listener:`, err); });
    ch1.assertQueue(queue);

    setInterval(() => {
      ch1.sendToQueue(queue, Buffer.from('something to do'));
    }, 1000);
  });
});
```

## Promise/Async API example

```javascript
const amqplib = require('amqplib');

(async () => {
  const queue = 'tasks';
  const conn = await amqplib.connect('amqp://localhost');
  conn.on('error', (err) => { console.error('Connection error:', err); });
  conn.on('handler-error', (err, event) => { console.error(`Uncaught exception in connection ${event} listener:`, err); });

  const ch1 = await conn.createChannel();
  ch1.on('error', (err) => { console.error('Channel error:', err); });
  ch1.on('handler-error', (err, event) => { console.error(`Uncaught exception in channel ${event} listener:`, err); });
  await ch1.assertQueue(queue);

  // Listener
  ch1.consume(queue, (msg) => {
    if (msg !== null) {
      console.log('Received:', msg.content.toString());
      ch1.ack(msg);
    } else {
      console.log('Consumer cancelled by server');
    }
  });

  // Sender
  const ch2 = await conn.createChannel();
  ch2.on('error', (err) => { console.error('Channel error:', err); });
  ch2.on('handler-error', (err, event) => { console.error(`Uncaught exception in channel ${event} listener:`, err); });

  setInterval(() => {
    ch2.sendToQueue(queue, Buffer.from('something to do'));
  }, 1000);
})();

```

## Opt-in recovery

Automatic recovery is available as an opt-in feature through `connect` options:

```javascript
const amqplib = require('amqplib');

const connection = await amqplib.connect('amqp://localhost', {
  recovery: {
    initialDelay: 200, // ms
    maxDelay: 5000, // ms
    factor: 2,
    jitter: 0.2,
    maxRetries: Infinity,
    async setup(model) {
      // Called after every successful (re)connect.
      // Recreate topology/consumers here.
      const ch = await model.createChannel();
      await ch.assertQueue('tasks', {durable: true});
    },
  },
});

connection.on('connect', () => {
  console.log('connected');
});

connection.on('disconnect', (err) => {
  console.warn('disconnected', err.message);
});
```

Callback API supports the same option:

```javascript
const amqplib = require('amqplib/callback_api');

amqplib.connect(
  'amqp://localhost',
  {
    recovery: {
      initialDelay: 200,
      maxDelay: 5000,
      setup(model, done) {
        model.createChannel((err, ch) => {
          if (err) return done(err);
          ch.assertQueue('tasks', {durable: true}, done);
        });
      },
    },
  },
  (err, conn) => {
    if (err) throw err;
    conn.on('connect', () => console.log('connected'));
  },
);
```

Without `recovery` options, behavior is unchanged.

### Attaching listeners before the first connection

By default `connect` waits for the first successful connection before
resolving (or invoking the callback), so events emitted during the initial
attempt such as `connect-failed` and `reconnect-scheduled` cannot be observed.
Set `waitForConnect: false` to get the connection handle immediately. You can
then attach listeners, call `waitForConnect()` to await the first connection,
or call `close()` to cancel the initial attempt. Channel operations wait for a
connection internally, so `createChannel()` can be called straight away.

```javascript
const connection = await amqplib.connect('amqp://localhost', {
  recovery: { waitForConnect: false },
});

connection.on('connect-failed', (err) => {
  console.warn('connection attempt failed', err.message);
});

connection.on('reconnect-scheduled', ({ attempt, delay }) => {
  console.log(`retrying (attempt ${attempt}) in ${delay}ms`);
});

await connection.waitForConnect();
```

The callback API returns the connection handle synchronously, so listeners can
always be attached before the first attempt. With `waitForConnect: false` the
callback is invoked immediately with the handle instead of after the first
connection, and `waitForConnect(callback)` can be used to be notified once
connected.

### Custom delay strategy

By default, reconnect delays follow an exponential backoff with jitter,
controlled by `initialDelay`, `maxDelay`, `factor` and `jitter`. To use a
different strategy entirely (full jitter, decorrelated jitter, a fixed step
schedule, etc.), provide a `calculateDelay` function instead:

```javascript
const connection = await amqplib.connect('amqp://localhost', {
  recovery: {
    maxRetries: Infinity,
    // Called with the reconnect attempt number, starting at 1.
    // Must return the delay in milliseconds.
    calculateDelay(attempt) {
      return Math.min(30000, 100 * 2 ** (attempt - 1));
    },
  },
});
```

`maxDelay` only bounds the built-in strategy. Once you provide `calculateDelay`,
amqplib does not cap its return value - you're responsible for enforcing your
own maximum, as the example above does with `Math.min`.

When `calculateDelay` is absent, the built-in strategy is used. If it throws,
or returns something other than a finite, non-negative number, amqplib does
not fall back to the built-in strategy. Instead recovery gives up as if
`maxRetries` had been exhausted: the initial `connect` rejects (or the
callback receives the error), pending channel operations reject, and
`reconnect-failed` is emitted with the error. A broken `calculateDelay` is a
bug in caller-supplied code, so it is surfaced rather than papered over.

## Error handling in event handlers

If a user-supplied event handler throws a synchronous error, the throw will
propagate into amqplib internals. Depending on where in the call stack it
escapes, this can silently swallow the error, or close the channel or
connection.

To avoid this, register a `handler-error` listener on the connection and on
each channel. If a listener is present, amqplib will catch any throw from a
user event handler and deliver it there instead of letting it propagate
internally. The listener receives the thrown error and the name of the event
whose handler threw.

Note that `handler-error` is not a replacement for the `error` event.
The `error` event is emitted by amqplib itself when the connection or channel
encounters a protocol-level error. The `handler-error` event is only emitted
when *your own* event listener throws.

```js
const connection = await amqp.connect('amqp://localhost');

connection.on('error', (err) => { /* handle protocol errors */ });
connection.on('handler-error', (err, event) => {
  console.error(`Uncaught exception in connection ${event} listener:`, err);
});

const channel = await connection.createChannel();

channel.on('error', (err) => { /* handle protocol errors */ });
channel.on('handler-error', (err, event) => {
  console.error(`Uncaught exception in channel ${event} listener:`, err);
});
```

If no `handler-error` listener is registered, behaviour is unchanged from
previous versions.

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

    nave use 10 npm test

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
