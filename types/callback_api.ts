// Type-level tests for the callback API.
// These are checked by `tsc --noEmit` but never executed at runtime.

import * as amqp from '../callback_api';
import { Options, SocketOptions } from '../lib/properties';

function testConnectOverloads() {
  // Overload 1: connect(callback)
  amqp.connect((err, conn) => {
    if (err) return;
    const _conn: amqp.Connection = conn;
  });

  // Overload 2: connect(url, callback)
  amqp.connect('amqp://localhost', (err, conn) => {
    if (err) return;
    const _conn: amqp.Connection = conn;
  });

  // Overload 2 with Options.Connect object
  const opts: Options.Connect = { hostname: 'localhost', port: 5672 };
  amqp.connect(opts, (err, conn) => {
    if (err) return;
    const _conn: amqp.Connection = conn;
  });

  // Overload 3: connect(url, socketOptions, callback)
  const sockOpts: SocketOptions = {
    noDelay: true,
    rejectUnauthorized: false,
  };
  amqp.connect('amqps://localhost', sockOpts, (err, conn) => {
    if (err) return;
    const _conn: amqp.Connection = conn;
  });
}

function testConnection(conn: amqp.Connection) {
  // serverProperties lives on conn.connection.serverProperties
  const _serverProps: amqp.ServerProperties = conn.connection.serverProperties;

  // createChannel — callback only
  conn.createChannel((err, ch) => {
    if (err) return;
    const _ch: amqp.Channel = ch;
  });

  // createChannel — with options
  conn.createChannel({ highWaterMark: 1024 }, (err, ch) => {
    if (err) return;
    const _ch: amqp.Channel = ch;
  });

  // createConfirmChannel — callback only
  conn.createConfirmChannel((err, ch) => {
    if (err) return;
    const _ch: amqp.ConfirmChannel = ch;
  });

  // createConfirmChannel — with options
  conn.createConfirmChannel({ highWaterMark: 512 }, (err, ch) => {
    if (err) return;
    const _ch: amqp.ConfirmChannel = ch;
  });

  conn.updateSecret(Buffer.from('newsecret'), 'rotation');
  conn.close();
  conn.close((err) => { void err; });
}

function testChannel(ch: amqp.Channel) {
  // assertQueue — queue name is optional (server-named queues)
  ch.assertQueue();
  ch.assertQueue('');
  ch.assertQueue('myqueue', { durable: true });
  ch.assertQueue('myqueue', { durable: true }, (err, ok) => {
    if (err) return;
    const _name: string = ok.queue;
    const _count: number = ok.messageCount;
  });

  // overflow and queueMode options
  ch.assertQueue('q', { overflow: 'reject-publish', queueMode: 'lazy' });

  ch.checkQueue('q', (err, ok) => {
    if (err) return;
    const _name: string = ok.queue;
  });

  ch.deleteQueue('q', {}, (err, ok) => {
    if (err) return;
    const _count: number = ok.messageCount;
  });

  ch.purgeQueue('q', (err, ok) => {
    if (err) return;
    const _count: number = ok.messageCount;
  });

  ch.bindQueue('q', 'ex', 'rk');
  ch.unbindQueue('q', 'ex', 'rk');

  ch.assertExchange('ex', 'direct', { durable: true }, (err, ok) => {
    if (err) return;
    const _name: string = ok.exchange;
  });
  ch.assertExchange('ex', 'topic');
  ch.assertExchange('ex', 'x-custom'); // still valid via `string`

  ch.checkExchange('ex');
  ch.deleteExchange('ex', { ifUnused: false });

  ch.bindExchange('dest', 'src', 'rk');
  ch.unbindExchange('dest', 'src', 'rk');

  // publish / sendToQueue
  const _pub: boolean = ch.publish('ex', 'rk', Buffer.from('hello'), { persistent: true });
  const _sent: boolean = ch.sendToQueue('q', Buffer.from('hi'));

  // consume
  ch.consume('q', (msg) => {
    if (msg !== null) {
      const _content: Buffer = msg.content;
      const _tag: string = msg.fields.consumerTag;
      ch.ack(msg);
    }
  }, { noAck: false }, (err, ok) => {
    if (err) return;
    const _tag: string = ok.consumerTag;
  });

  ch.cancel('tag');
  ch.cancel('tag', (err, ok) => {
    void [err, ok];
  });

  // get
  ch.get('q', { noAck: false }, (err, msg) => {
    if (err) return;
    if (msg !== false) {
      const _content: Buffer = msg.content;
      const _count: number = msg.fields.messageCount;
    }
  });

  const fakeMsg = {} as amqp.Message;
  ch.ack(fakeMsg);
  ch.ackAll();
  ch.nack(fakeMsg, false, true);
  ch.nackAll(true);
  ch.reject(fakeMsg, false);

  ch.prefetch(10);
  ch.prefetch(10, false, (err, ok) => { void [err, ok]; });
  ch.recover();
  ch.recover((err, ok) => { void [err, ok]; });

  ch.close();
}

function testConfirmChannel(ch: amqp.ConfirmChannel) {
  ch.publish('ex', 'rk', Buffer.from('hello'), {}, (err, _ok) => {
    if (err) console.error(err);
  });
  ch.sendToQueue('q', Buffer.from('hello'), {}, (err, _ok) => {
    if (err) console.error(err);
  });
  ch.waitForConfirms();
  ch.waitForConfirms((err) => { void err; });
}

function testCredentials() {
  const plain = amqp.credentials.plain('user', 'pass');
  const _mech: string = plain.mechanism;
  const _resp: Buffer = plain.response();

  const external = amqp.credentials.external();
  const _mech2: string = external.mechanism;
}

function testIllegalOperationError() {
  const err = new amqp.IllegalOperationError('channel closed');
  const _name: 'IllegalOperationError' = err.name;
  const _stack: string | undefined = err.stackAtStateChange;
}

function testConnectionEvents(conn: amqp.Connection) {
  conn.on('close', () => {});
  conn.on('close', (err) => { const _e: Error | undefined = err; });
  conn.on('error', (err) => { const _e: Error = err; });
  conn.on('blocked', (reason) => { const _r: string = reason; });
  conn.on('unblocked', () => {});
  conn.on('update-secret-ok', () => {});
  conn.on('handler-error', (err, eventName) => {
    const _e: Error = err;
    const _n: string = eventName;
  });
}

function testChannelEvents(ch: amqp.Channel) {
  ch.on('close', () => {});
  ch.on('error', (err) => { const _e: Error = err; });
  ch.on('drain', () => {});
  ch.on('ack', (fields) => {
    const _tag: number = fields.deliveryTag;
    const _multiple: boolean = fields.multiple;
  });
  ch.on('nack', (fields) => {
    const _tag: number = fields.deliveryTag;
    const _multiple: boolean = fields.multiple;
    const _requeue: boolean = fields.requeue;
  });
  ch.on('cancel', (fields) => { const _tag: string = fields.consumerTag; });
  ch.on('delivery', (msg) => { const _content: Buffer = msg.content; });
  ch.on('return', (msg) => { const _content: Buffer = msg.content; });
  ch.on('handler-error', (err, eventName) => {
    const _e: Error = err;
    const _n: string = eventName;
  });
}

function testRecovery() {
  const recoveryOpts: amqp.RecoveryOptions = {
    initialDelay: 100,
    maxDelay: 30000,
    factor: 2,
    jitter: 0.2,
    maxRetries: 10,
    setup: (model, done) => {
      model.createChannel((err, _ch) => done(err ?? undefined));
    },
  };

  const sockOpts: SocketOptions = { noDelay: true };

  // connect with recovery enabled via boolean
  const conn1: amqp.RecoveringConnection = amqp.connect('amqp://localhost', {
    ...sockOpts,
    recovery: true,
  }, (err, conn) => {
    if (err) return;
    const _conn: amqp.RecoveringConnection = conn;
  });

  // connect with recovery options
  const conn2: amqp.RecoveringConnection = amqp.connect('amqp://localhost', {
    ...sockOpts,
    recovery: recoveryOpts,
  }, (err, conn) => {
    if (err) return;
    const _conn: amqp.RecoveringConnection = conn;
  });

  // RecoveringConnection supports same channel operations
  conn1.createChannel((err, ch) => {
    if (err) return;
    const _ch: amqp.Channel = ch;
  });
  conn1.createConfirmChannel((err, ch) => {
    if (err) return;
    const _ch: amqp.ConfirmChannel = ch;
  });
  conn1.updateSecret(Buffer.from('secret'), 'rotation');
  conn1.close();

  // Recovery-specific events
  conn2.on('connect', (model) => { const _m: amqp.Connection = model; });
  conn2.on('disconnect', (err) => { const _e: Error = err; });
  conn2.on('connect-failed', (err) => { const _e: Error = err; });
  conn2.on('reconnect-scheduled', (info) => {
    const _attempt: number = info.attempt;
    const _delay: number = info.delay;
    const _err: Error = info.error;
  });
  conn2.on('reconnect-failed', (err) => { const _e: Error = err; });
  conn2.on('blocked', (reason) => { const _r: string = reason; });
  conn2.on('unblocked', () => {});
  conn2.on('error', (err) => { const _e: Error = err; });
  conn2.on('update-secret-ok', () => {});

  void [conn1, conn2];
}
