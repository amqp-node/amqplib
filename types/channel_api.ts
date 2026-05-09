// Type-level tests for the promise (channel) API.
// These are checked by `tsc --noEmit` but never executed at runtime.

import * as amqp from '../index';
import { Options, SocketOptions } from '../lib/properties';

async function testConnect() {
  // connect with string URL
  const conn1: amqp.ChannelModel = await amqp.connect('amqp://localhost');

  // connect with Options.Connect object
  const opts: Options.Connect = {
    protocol: 'amqp',
    hostname: 'localhost',
    port: 5672,
    username: 'guest',
    password: 'guest',
    vhost: '/',
    heartbeat: 60,
    frameMax: 131072,
    channelMax: 0,
  };
  const conn2: amqp.ChannelModel = await amqp.connect(opts);

  // connect with SocketOptions including TLS fields
  const sockOpts: SocketOptions = {
    noDelay: true,
    timeout: 5000,
    keepAlive: true,
    keepAliveDelay: 1000,
    clientProperties: { appName: 'test' },
    rejectUnauthorized: false, // tls.ConnectionOptions field
  };
  const conn3: amqp.ChannelModel = await amqp.connect('amqps://localhost', sockOpts);

  return [conn1, conn2, conn3];
}

async function testChannelModel(conn: amqp.ChannelModel) {
  // ChannelModel properties
  const _connection: amqp.Connection = conn.connection;
  const _serverProps: amqp.ServerProperties = conn.connection.serverProperties;

  // create channels
  const ch: amqp.Channel = await conn.createChannel();
  const chWithOpts: amqp.Channel = await conn.createChannel({ highWaterMark: 1024 });
  const confirmCh: amqp.ConfirmChannel = await conn.createConfirmChannel();

  await conn.updateSecret(Buffer.from('newsecret'), 'rotation');
  await conn.close();

  return [ch, chWithOpts, confirmCh];
}

async function testChannel(ch: amqp.Channel) {
  // assertQueue — queue name is optional (server-named queues)
  const q1: amqp.Replies.AssertQueue = await ch.assertQueue();
  const q2: amqp.Replies.AssertQueue = await ch.assertQueue('');
  const q3: amqp.Replies.AssertQueue = await ch.assertQueue('myqueue', {
    durable: true,
    exclusive: false,
    autoDelete: false,
    messageTtl: 60000,
    expires: 300000,
    deadLetterExchange: 'dlx',
    deadLetterRoutingKey: 'dlrk',
    maxLength: 1000,
    maxPriority: 10,
    overflow: 'drop-head',
    queueMode: 'lazy',
  });
  void [q1, q2, q3];

  await ch.checkQueue('myqueue');
  await ch.deleteQueue('myqueue', { ifUnused: true, ifEmpty: true });
  await ch.purgeQueue('myqueue');

  await ch.bindQueue('myqueue', 'myexchange', 'routing.key');
  await ch.unbindQueue('myqueue', 'myexchange', 'routing.key');

  // assertExchange — type literal union
  await ch.assertExchange('myexchange', 'direct', { durable: true });
  await ch.assertExchange('myexchange', 'topic');
  await ch.assertExchange('myexchange', 'fanout');
  await ch.assertExchange('myexchange', 'headers');
  await ch.assertExchange('myexchange', 'x-custom-type'); // still valid via `string`

  await ch.checkExchange('myexchange');
  await ch.deleteExchange('myexchange', { ifUnused: false });

  await ch.bindExchange('dest', 'src', 'pattern');
  await ch.unbindExchange('dest', 'src', 'pattern');

  // publish / sendToQueue
  const published: boolean = ch.publish('ex', 'rk', Buffer.from('hello'), {
    persistent: true,
    contentType: 'application/json',
    headers: { 'x-custom': 'value' },
    correlationId: 'abc',
    replyTo: 'reply-queue',
    messageId: 'msg-1',
    timestamp: Date.now(),
    type: 'event',
    appId: 'myapp',
  });
  const sent: boolean = ch.sendToQueue('q', Buffer.from('hello'));
  void [published, sent];

  // consume
  const consumeReply: amqp.Replies.Consume = await ch.consume('q', (msg) => {
    if (msg !== null) {
      const _content: Buffer = msg.content;
      const _tag: string = msg.fields.consumerTag;
      ch.ack(msg);
    }
  });
  void consumeReply;

  await ch.cancel('consumer-tag');

  // get
  const msg = await ch.get('q', { noAck: false });
  if (msg !== false) {
    const _content: Buffer = msg.content;
    const _count: number = msg.fields.messageCount;
    ch.ack(msg);
  }

  // ack / nack / reject
  const fakeMsg = {} as amqp.Message;
  ch.ack(fakeMsg, false);
  ch.ackAll();
  ch.nack(fakeMsg, false, true);
  ch.nackAll(true);
  ch.reject(fakeMsg, false);

  await ch.prefetch(10);
  await ch.prefetch(10, true);
  await ch.recover();

  await ch.close();
}

async function testConfirmChannel(ch: amqp.ConfirmChannel) {
  ch.publish('ex', 'rk', Buffer.from('hello'), {}, (err, _ok) => {
    if (err) console.error(err);
  });
  ch.sendToQueue('q', Buffer.from('hello'), {}, (err, _ok) => {
    if (err) console.error(err);
  });
  await ch.waitForConfirms();
}

function testCredentials() {
  const plain = amqp.credentials.plain('user', 'pass');
  const _mech1: string = plain.mechanism;
  const _resp1: Buffer = plain.response();
  const _user: string = plain.username;
  const _pass: string = plain.password;

  const amqplain = amqp.credentials.amqplain('user', 'pass');
  const _mech2: string = amqplain.mechanism;

  const external = amqp.credentials.external();
  const _mech3: string = external.mechanism;
  const _resp3: Buffer = external.response();
}

function testIllegalOperationError() {
  const err = new amqp.IllegalOperationError('channel closed');
  const _name: 'IllegalOperationError' = err.name;
  const _stack: string | undefined = err.stackAtStateChange;
  const _msg: string = err.message;
}

// Exercise re-exports from lib/properties
function testReExports() {
  const _opts: Options.Publish = { persistent: true };
  const _getOpts: Options.Get = { noAck: true };
}

function testChannelModelEvents(conn: amqp.ChannelModel) {
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

async function testRecovery() {
  const recoveryOpts: amqp.RecoveryOptions = {
    initialDelay: 100,
    maxDelay: 30000,
    factor: 2,
    jitter: 0.2,
    maxRetries: 10,
    setup: async (model: amqp.ChannelModel) => {
      const _ch: amqp.Channel = await model.createChannel();
    },
  };

  const sockOpts: SocketOptions = { noDelay: true };

  // connect with recovery enabled via boolean (direct object literal)
  const conn1: amqp.RecoveringChannelModel = await amqp.connect('amqp://localhost', {
    noDelay: true,
    recovery: true,
  });

  // connect with recovery options (spread from typed variable)
  const conn2: amqp.RecoveringChannelModel = await amqp.connect('amqp://localhost', {
    ...sockOpts,
    recovery: recoveryOpts,
  });

  // RecoveringChannelModel supports same channel operations
  const ch: amqp.Channel = await conn1.createChannel();
  const confirmCh: amqp.ConfirmChannel = await conn1.createConfirmChannel();
  await conn1.updateSecret(Buffer.from('secret'), 'rotation');
  void [ch, confirmCh];

  // Recovery-specific events
  conn2.on('connect', (model) => { const _m: amqp.ChannelModel = model; });
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

  await conn1.close();
  await conn2.close();
}
