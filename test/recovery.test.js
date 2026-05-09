

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
