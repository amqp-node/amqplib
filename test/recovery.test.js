

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

  describe('waitForConnect: false', () => {
    function watchUnhandledRejections(t) {
      const rejections = [];
      const onRejection = (err) => rejections.push(err);
      process.on('unhandledRejection', onRejection);
      t.after(() => process.removeListener('unhandledRejection', onRejection));
      return rejections;
    }

    it('promise connect resolves before the first connection and later emits connect', async () => {
      let opened = 0;

      function openModel() {
        return Promise.resolve(new FakePromiseModel(++opened));
      }

      const client = await recovery.connectWithRecoveryPromise(openModel, {waitForConnect: false});

      assert.equal(0, opened);

      const model = await new Promise((resolve) => client.once('connect', resolve));
      assert.equal(1, model.id);
      assert.equal(1, opened);

      await client.close();
    });

    it('listeners attached after connect observe a failed first attempt', async () => {
      let attempts = 0;

      function openModel() {
        attempts++;
        return attempts === 1 ? Promise.reject(new Error('broker unavailable')) : Promise.resolve(new FakePromiseModel(attempts));
      }

      const client = await recovery.connectWithRecoveryPromise(openModel, {
        initialDelay: 1,
        maxDelay: 1,
        jitter: 0,
        waitForConnect: false,
      });

      const failures = [];
      const scheduled = [];
      client.on('connect-failed', (err) => failures.push(err));
      client.on('reconnect-scheduled', (info) => scheduled.push(info));

      await client.waitForConnect();

      assert.equal(1, failures.length);
      assert.equal('broker unavailable', failures[0].message);
      assert.equal(1, scheduled.length);
      assert.equal(1, scheduled[0].attempt);
      assert.strictEqual(failures[0], scheduled[0].error);
      assert.equal(2, attempts);

      await client.close();
    });

    it('waitForConnect resolves with the recovering model once connected', async () => {
      function openModel() {
        return Promise.resolve(new FakePromiseModel(1));
      }

      const client = await recovery.connectWithRecoveryPromise(openModel, {waitForConnect: false});
      const connected = await client.waitForConnect();

      assert.strictEqual(client, connected);
      const ch = await client.createChannel();
      assert.equal(1, ch.id);

      await client.close();
    });

    it('close before the first connection cancels it without an unhandled rejection', async (t) => {
      const rejections = watchUnhandledRejections(t);
      let setupCalls = 0;
      let closeCalls = 0;
      let releaseOpen;

      function openModel() {
        return new Promise((resolve) => {
          const model = new FakePromiseModel(1);
          model.close = () => {
            closeCalls++;
            return Promise.resolve();
          };
          releaseOpen = () => resolve(model);
        });
      }

      const client = await recovery.connectWithRecoveryPromise(openModel, {
        waitForConnect: false,
        setup() {
          setupCalls++;
        },
      });

      let connected = false;
      client.on('connect', () => {
        connected = true;
      });

      const pendingChannel = client.createChannel();
      await new Promise((resolve) => setImmediate(resolve));
      assert(releaseOpen, 'open should be in flight');

      await client.close();

      await assert.rejects(pendingChannel, {message: 'Connection closed'});
      await assert.rejects(client.waitForConnect(), {message: 'Connection closed'});

      releaseOpen();
      await new Promise((resolve) => setImmediate(resolve));

      assert.equal(0, setupCalls);
      assert.equal(1, closeCalls);
      assert.equal(false, connected);
      assert.deepEqual([], rejections);
    });

    it('exhausting retries emits reconnect-failed without an unhandled rejection', async (t) => {
      const rejections = watchUnhandledRejections(t);
      let attempts = 0;

      function openModel() {
        attempts++;
        return Promise.reject(new Error('connect failed'));
      }

      const client = await recovery.connectWithRecoveryPromise(openModel, {
        initialDelay: 1,
        maxDelay: 1,
        jitter: 0,
        maxRetries: 1,
        waitForConnect: false,
      });

      const err = await new Promise((resolve) => client.once('reconnect-failed', resolve));
      assert.equal('connect failed', err.message);
      assert.equal(2, attempts);

      await assert.rejects(client.waitForConnect(), {message: 'connect failed'});
      await new Promise((resolve) => setImmediate(resolve));
      assert.deepEqual([], rejections);

      await client.close();
    });

    it('callback connect invokes the callback before the first connection', (_t, done) => {
      let opened = 0;

      function openModel() {
        return Promise.resolve(new FakeCallbackModel(++opened));
      }

      const failures = [];
      const client = recovery.connectWithRecoveryCallback(openModel, {waitForConnect: false}, (err, c) => {
        if (err) return done(err);
        assert.strictEqual(client, c);
        assert.equal(0, opened);

        c.on('connect-failed', (failure) => failures.push(failure));
        c.waitForConnect((waitErr, connected) => {
          if (waitErr) return done(waitErr);
          assert.strictEqual(client, connected);
          assert.equal(1, opened);
          assert.deepEqual([], failures);
          c.close(done);
        });
      });

      assert(client);
    });
  });
});
