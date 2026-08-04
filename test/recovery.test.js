

const { describe, it } = require('node:test');
const assert = require('node:assert');
const EventEmitter = require('node:events');
const recovery = require('../lib/recovery');

class FakePromiseModel extends EventEmitter {
  constructor(id) {
    super();
    this.id = id;
  }

  close() {
    return Promise.resolve();
  }

  createChannel(options) {
    return Promise.resolve({kind: 'channel', id: this.id, options});
  }

  createConfirmChannel(options) {
    return Promise.resolve({kind: 'confirm', id: this.id, options});
  }

  updateSecret(_newSecret, _reason) {
    return Promise.resolve();
  }
}

class FakeCallbackModel extends EventEmitter {
  constructor(id) {
    super();
    this.id = id;
  }

  close(cb) {
    cb && cb(null);
  }

  createChannel(options, cb) {
    if (typeof options === 'function') {
      cb = options;
      options = undefined;
    }
    cb && cb(null, {kind: 'channel', id: this.id, options});
  }

  createConfirmChannel(options, cb) {
    if (typeof options === 'function') {
      cb = options;
      options = undefined;
    }
    cb && cb(null, {kind: 'confirm', id: this.id, options});
  }

  updateSecret(_newSecret, _reason, cb) {
    cb && cb(null);
  }
}

describe('recovery', () => {
  it('promise recovery reconnects after close', async () => {
    const models = [];
    let opened = 0;

    function openModel() {
      const model = new FakePromiseModel(++opened);
      models.push(model);
      return Promise.resolve(model);
    }

    const client = await recovery.connectWithRecoveryPromise(openModel, {
      initialDelay: 1,
      maxDelay: 1,
      jitter: 0,
      maxRetries: 3,
    });

    assert.equal(1, opened);

    await new Promise((resolve) => {
      client.once('connect', () => {
        assert.equal(2, opened);
        resolve();
      });

      models[0].emit('close', new Error('socket closed'));
    });

    await client.close();
  });

  it('promise recovery runs setup on every connect', async () => {
    const models = [];
    let setupCalls = 0;
    let opened = 0;

    function openModel() {
      const model = new FakePromiseModel(++opened);
      models.push(model);
      return Promise.resolve(model);
    }

    const client = await recovery.connectWithRecoveryPromise(openModel, {
      initialDelay: 1,
      maxDelay: 1,
      jitter: 0,
      maxRetries: 3,
      setup() {
        setupCalls++;
      },
    });

    assert.equal(1, setupCalls);

    await new Promise((resolve) => {
      client.once('connect', () => {
        assert.equal(2, setupCalls);
        resolve();
      });

      models[0].emit('close', new Error('socket closed'));
    });

    await client.close();
  });

  it('callback recovery reconnects and creates channels after reconnect', (done) => {
    const models = [];
    let opened = 0;

    function openModel() {
      const model = new FakeCallbackModel(++opened);
      models.push(model);
      return Promise.resolve(model);
    }

    const client = recovery.connectWithRecoveryCallback(
      openModel,
      {
        initialDelay: 1,
        maxDelay: 1,
        jitter: 0,
        maxRetries: 3,
      },
      (err, c) => {
        if (err) return done(err);

        c.createChannel((createErr, ch) => {
          if (createErr) return done(createErr);
          assert.equal(1, ch.id);

          c.once('connect', () => {
            c.createChannel((reconnectErr, reconnectedChannel) => {
              if (reconnectErr) return done(reconnectErr);
              assert.equal(2, reconnectedChannel.id);
              c.close(done);
            });
          });

          models[0].emit('close', new Error('socket closed'));
        });
      },
    );

    assert(client);
  });

  it('handler-error from underlying model is forwarded to recovery wrapper', async () => {
    const models = [];
    let opened = 0;

    function openModel() {
      const model = new FakePromiseModel(++opened);
      models.push(model);
      return Promise.resolve(model);
    }

    const client = await recovery.connectWithRecoveryPromise(openModel, {
      initialDelay: 1,
      maxDelay: 1,
      jitter: 0,
    });

    const expectedErr = new Error('user close handler explodes');

    await new Promise((resolve) => {
      client.on('handler-error', (err, event) => {
        assert.strictEqual(err, expectedErr);
        assert.strictEqual(event, 'close');
        resolve();
      });

      // Simulate a handler throwing in a 'close' listener on the underlying model
      models[0].emit('handler-error', expectedErr, 'close');
    });

    await client.close();
  });

  it('built-in delay never exceeds maxDelay even at full jitter', async () => {
    const models = [];
    let opened = 0;

    function openModel() {
      const model = new FakePromiseModel(++opened);
      models.push(model);
      return Promise.resolve(model);
    }

    const client = await recovery.connectWithRecoveryPromise(openModel, {
      initialDelay: 5,
      maxDelay: 5,
      factor: 1,
      jitter: 1,
      maxRetries: Infinity,
    });

    const originalRandom = Math.random;
    let delay;

    try {
      // Force the maximum positive jitter. Without the final clamp,
      // base + offset would be 10, exceeding maxDelay.
      Math.random = () => 1;

      delay = await new Promise((resolve) => {
        client.once('reconnect-scheduled', (info) => resolve(info.delay));
        models[models.length - 1].emit('close', new Error('socket closed'));
      });
    } finally {
      Math.random = originalRandom;
      await client.close();
    }

    assert.equal(delay, 5);
  });

  it('uses a custom calculateDelay strategy when provided', async () => {
    const models = [];
    let opened = 0;
    const attemptsSeen = [];

    function openModel() {
      const model = new FakePromiseModel(++opened);
      models.push(model);
      return Promise.resolve(model);
    }

    const client = await recovery.connectWithRecoveryPromise(openModel, {
      initialDelay: 1,
      maxDelay: 1,
      jitter: 0,
      maxRetries: 3,
      calculateDelay(attempt) {
        attemptsSeen.push(attempt);
        return attempt * 1000;
      },
    });

    await new Promise((resolve) => {
      client.once('reconnect-scheduled', ({attempt, delay}) => {
        assert.equal(1, attempt);
        assert.equal(1000, delay);
        resolve();
      });

      models[0].emit('close', new Error('socket closed'));
    });

    assert.deepEqual([1], attemptsSeen);

    await client.close();
  });

  it('falls back to the built-in strategy when calculateDelay throws, and reports it via handler-error', async () => {
    const models = [];
    let opened = 0;

    function openModel() {
      const model = new FakePromiseModel(++opened);
      models.push(model);
      return Promise.resolve(model);
    }

    const client = await recovery.connectWithRecoveryPromise(openModel, {
      initialDelay: 5,
      maxDelay: 5,
      jitter: 0,
      maxRetries: 3,
      calculateDelay() {
        throw new Error('calculateDelay is broken');
      },
    });

    const handlerError = new Promise((resolve) => {
      client.once('handler-error', (err, event) => {
        assert.equal('calculateDelay is broken', err.message);
        assert.equal('calculateDelay', event);
        resolve();
      });
    });

    const scheduled = new Promise((resolve) => {
      client.once('reconnect-scheduled', ({delay}) => {
        // falls back to the built-in strategy (initialDelay=5, jitter=0)
        assert.equal(5, delay);
        resolve();
      });
    });

    models[0].emit('close', new Error('socket closed'));
    await Promise.all([handlerError, scheduled]);

    await client.close();
  });

  it('handles a circular-reference return value from calculateDelay without throwing a JSON error instead', async () => {
    const models = [];
    let opened = 0;

    function openModel() {
      const model = new FakePromiseModel(++opened);
      models.push(model);
      return Promise.resolve(model);
    }

    const client = await recovery.connectWithRecoveryPromise(openModel, {
      initialDelay: 5,
      maxDelay: 5,
      jitter: 0,
      maxRetries: 3,
      calculateDelay() {
        const circular = {};
        circular.self = circular;
        return circular;
      },
    });

    const handlerError = new Promise((resolve) => {
      client.once('handler-error', (err, event) => {
        // Must be our own validation error, not a JSON.stringify TypeError
        // from trying to serialize the circular value into the message.
        assert.match(err.message, /calculateDelay must return a finite, non-negative number/);
        assert.equal('calculateDelay', event);
        resolve();
      });
    });

    const scheduled = new Promise((resolve) => {
      client.once('reconnect-scheduled', ({delay}) => {
        assert.equal(5, delay);
        resolve();
      });
    });

    models[0].emit('close', new Error('socket closed'));
    await Promise.all([handlerError, scheduled]);

    await client.close();
  });

  it('falls back to the built-in strategy when calculateDelay returns an invalid value', async () => {
    const models = [];
    let opened = 0;

    function openModel() {
      const model = new FakePromiseModel(++opened);
      models.push(model);
      return Promise.resolve(model);
    }

    const client = await recovery.connectWithRecoveryPromise(openModel, {
      initialDelay: 5,
      maxDelay: 5,
      jitter: 0,
      maxRetries: 3,
      calculateDelay() {
        return -1;
      },
    });

    await new Promise((resolve) => {
      client.once('reconnect-scheduled', ({delay}) => {
        assert.equal(5, delay);
        resolve();
      });

      models[0].emit('close', new Error('socket closed'));
    });

    await client.close();
  });

  it('does not coerce non-number calculateDelay return values', async () => {
    const models = [];
    let opened = 0;

    function openModel() {
      const model = new FakePromiseModel(++opened);
      models.push(model);
      return Promise.resolve(model);
    }

    const client = await recovery.connectWithRecoveryPromise(openModel, {
      initialDelay: 5,
      maxDelay: 5,
      jitter: 0,
      maxRetries: 3,
      calculateDelay() {
        return '1000'; // a string, not a number - must not be accepted as-is
      },
    });

    const handlerError = new Promise((resolve) => {
      client.once('handler-error', (err, event) => {
        assert.match(err.message, /calculateDelay must return a finite, non-negative number/);
        assert.equal('calculateDelay', event);
        resolve();
      });
    });

    const scheduled = new Promise((resolve) => {
      client.once('reconnect-scheduled', ({delay}) => {
        // falls back to the built-in strategy (initialDelay=5, jitter=0),
        // not `1000` (which is what Number('1000') would have produced).
        assert.equal(5, delay);
        resolve();
      });
    });

    models[0].emit('close', new Error('socket closed'));
    await Promise.all([handlerError, scheduled]);

    await client.close();
  });

  it('does not throw when calculateDelay is broken and no handler-error listener is registered', async () => {
    const models = [];
    let opened = 0;

    function openModel() {
      const model = new FakePromiseModel(++opened);
      models.push(model);
      return Promise.resolve(model);
    }

    const client = await recovery.connectWithRecoveryPromise(openModel, {
      initialDelay: 1,
      maxDelay: 1,
      jitter: 0,
      maxRetries: 3,
      calculateDelay() {
        throw new Error('calculateDelay is broken');
      },
    });

    // No handler-error listener registered - reconnection must still proceed.
    await new Promise((resolve) => {
      client.once('connect', () => {
        assert.equal(2, opened);
        resolve();
      });

      models[0].emit('close', new Error('socket closed'));
    });

    await client.close();
  });

  it('promise recovery fails after max retries', async () => {
    let attempts = 0;

    function openModel() {
      attempts++;
      return Promise.reject(new Error('connect failed'));
    }

    let failed = false;
    try {
      await recovery.connectWithRecoveryPromise(openModel, {
        initialDelay: 1,
        maxDelay: 1,
        jitter: 0,
        maxRetries: 1,
      });
    } catch (err) {
      failed = true;
      assert.equal('connect failed', err.message);
    }

    assert(failed);
    assert.equal(2, attempts);
  });
});
