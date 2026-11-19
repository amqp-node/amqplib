const { describe, it } = require('node:test');
const assert = require('node:assert');
const EventEmitter = require('node:events');
const safeEmit = require('../lib/safe_emit');
const { ChannelModel } = require('../lib/channel_model');
const { CallbackModel } = require('../lib/callback_model');
const recovery = require('../lib/recovery');

class FakeConnection extends EventEmitter {
  close(cb) {
    cb();
  }
}

function nextTurnOfTheEventLoop() {
  return new Promise((resolve) => setImmediate(resolve));
}

for (const Model of [ChannelModel, CallbackModel]) {
  describe(`${Model.name} listeners that throw`, () => {
    const listenerBug = new Error('listener bug');

    it('are reported to a handler-error listener on the model', async () => {
      const connection = new FakeConnection();
      const model = new Model(connection);
      const handlerErrors = [];
      model.on('handler-error', (err, event) => handlerErrors.push({ err, event }));
      model.on('blocked', () => {
        throw listenerBug;
      });

      safeEmit(connection, 'blocked', 'low memory');
      await nextTurnOfTheEventLoop();

      assert.deepEqual([{ err: listenerBug, event: 'blocked' }], handlerErrors);
    });

    it('propagate into the connection without a handler-error listener', () => {
      const connection = new FakeConnection();
      const model = new Model(connection);
      model.on('blocked', () => {
        throw listenerBug;
      });

      assert.throws(() => safeEmit(connection, 'blocked', 'low memory'), listenerBug);
    });

    it('do not receive an error event that nothing listens for through handler-error', async () => {
      const connection = new FakeConnection();
      const model = new Model(connection);
      const handlerErrors = [];
      model.on('handler-error', (err, event) => handlerErrors.push({ err, event }));
      const socketError = new Error('socket error');

      assert.throws(() => safeEmit(connection, 'error', socketError), socketError);
      await nextTurnOfTheEventLoop();

      assert.deepEqual([], handlerErrors);
    });
  });
}

describe('safeEmit', () => {
  it('raises an error event that nothing listens for even when there is a handler-error listener', async () => {
    const emitter = new EventEmitter();
    const handlerErrors = [];
    emitter.on('handler-error', (err, event) => handlerErrors.push({ err, event }));
    const protocolError = new Error('protocol error');

    assert.throws(() => safeEmit(emitter, 'error', protocolError), protocolError);
    await nextTurnOfTheEventLoop();

    assert.deepEqual([], handlerErrors);
  });
});

describe('recovering connection over a ChannelModel', () => {
  it('reports a throwing listener to its handler-error listener', async () => {
    const listenerBug = new Error('listener bug');
    const connection = new FakeConnection();
    const client = await recovery.connectWithRecoveryPromise(() => Promise.resolve(new ChannelModel(connection)), {});
    const handlerErrors = [];
    client.on('handler-error', (err, event) => handlerErrors.push({ err, event }));
    client.on('blocked', () => {
      throw listenerBug;
    });

    safeEmit(connection, 'blocked', 'low memory');
    await nextTurnOfTheEventLoop();

    assert.deepEqual([{ err: listenerBug, event: 'blocked' }], handlerErrors);
    await client.close();
  });

  it('reports a throwing listener on the underlying model to its handler-error listener', async () => {
    const listenerBug = new Error('listener bug');
    const connection = new FakeConnection();
    const model = new ChannelModel(connection);
    const client = await recovery.connectWithRecoveryPromise(() => Promise.resolve(model), {});
    const handlerErrors = [];
    client.on('handler-error', (err, event) => handlerErrors.push({ err, event }));
    model.on('blocked', () => {
      throw listenerBug;
    });

    safeEmit(connection, 'blocked', 'low memory');
    await nextTurnOfTheEventLoop();

    assert.deepEqual([{ err: listenerBug, event: 'blocked' }], handlerErrors);
    await client.close();
  });
});
