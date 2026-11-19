const { describe, it, beforeEach, afterEach } = require('node:test');
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
    return Promise.resolve({ kind: 'channel', id: this.id, options });
  }

  createConfirmChannel(options) {
    return Promise.resolve({ kind: 'confirm', id: this.id, options });
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
    cb && cb(null, { kind: 'channel', id: this.id, options });
  }

  createConfirmChannel(options, cb) {
    if (typeof options === 'function') {
      cb = options;
      options = undefined;
    }
    cb && cb(null, { kind: 'confirm', id: this.id, options });
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
      // Force the maximum positive jitter. The base is capped at
      // maxDelay / (1 + jitter) = 2.5, so base + offset tops out at
      // exactly maxDelay (5) instead of overshooting it.
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

  it('does not collapse onto maxDelay for every positive jitter draw once the base saturates', async () => {
    const models = [];
    let opened = 0;

    function openModel() {
      const model = new FakePromiseModel(++opened);
      models.push(model);
      return Promise.resolve(model);
    }

    const client = await recovery.connectWithRecoveryPromise(openModel, {
      initialDelay: 100,
      maxDelay: 100,
      factor: 1,
      jitter: 0.2,
      maxRetries: Infinity,
    });

    const originalRandom = Math.random;
    let delay;

    try {
      // Math.random() just above the midpoint gives a small positive
      // offset. Capping base+offset at maxDelay (the old behavior) would
      // collapse this to exactly 100 instead of the slightly lower value
      // this offset actually produces.
      Math.random = () => 0.6;

      delay = await new Promise((resolve) => {
        client.once('reconnect-scheduled', (info) => resolve(info.delay));
        models[models.length - 1].emit('close', new Error('socket closed'));
      });
    } finally {
      Math.random = originalRandom;
      await client.close();
    }

    // base = 100 / 1.2 = 83.33, jitterPart = 16.67,
    // offset = 0.6 * 16.67 * 2 - 16.67 = 3.33, result = round(83.33 + 3.33) = 87
    assert.equal(delay, 87);
    assert.notEqual(delay, 100);
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
      client.once('reconnect-scheduled', ({ attempt, delay }) => {
        assert.equal(1, attempt);
        assert.equal(1000, delay);
        resolve();
      });

      models[0].emit('close', new Error('socket closed'));
    });

    assert.deepEqual([1], attemptsSeen);

    await client.close();
  });

  it('gives up recovery with reconnect-failed when calculateDelay throws', async () => {
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

    const err = await new Promise((resolve) => {
      client.once('reconnect-failed', resolve);
      models[0].emit('close', new Error('socket closed'));
    });
    assert.match(err.message, /calculateDelay is broken/);
    await assert.rejects(client.createChannel(), /calculateDelay is broken/);

    await client.close();
  });

  it('reports a validation error instead of a JSON error for a circular-reference return value', async () => {
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

    // Must be our own validation error, not a JSON.stringify TypeError from
    // trying to serialize the circular value into the message.
    const err = await new Promise((resolve) => {
      client.once('reconnect-failed', resolve);
      models[0].emit('close', new Error('socket closed'));
    });
    assert.match(err.message, /calculateDelay must return a finite, non-negative number/);

    await client.close();
  });

  it('gives up recovery when calculateDelay returns an invalid value', async () => {
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

    const err = await new Promise((resolve) => {
      client.once('reconnect-failed', resolve);
      models[0].emit('close', new Error('socket closed'));
    });
    assert.match(err.message, /calculateDelay must return a finite, non-negative number/);

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

    const err = await new Promise((resolve) => {
      client.once('reconnect-failed', resolve);
      models[0].emit('close', new Error('socket closed'));
    });
    assert.match(err.message, /calculateDelay must return a finite, non-negative number/);

    await client.close();
  });

  it('rejects the initial connection when calculateDelay throws after a failed connect', async (t) => {
    const rejections = [];
    const onRejection = (err) => rejections.push(err);
    process.on('unhandledRejection', onRejection);
    t.after(() => process.removeListener('unhandledRejection', onRejection));

    let attempts = 0;

    function openModel() {
      attempts++;
      return Promise.reject(new Error('connect failed'));
    }

    await assert.rejects(
      recovery.connectWithRecoveryPromise(openModel, {
        maxRetries: Infinity,
        calculateDelay() {
          throw new Error('calculateDelay is broken');
        },
      }),
      /calculateDelay is broken/,
    );

    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(1, attempts);
    assert.deepEqual([], rejections);
  });

  it('channel operations reject with the failure once recovery has given up', async () => {
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

    await assert.rejects(client.createChannel(), { message: 'connect failed' });
    await assert.rejects(client.createConfirmChannel(), { message: 'connect failed' });
    await assert.rejects(client.updateSecret(Buffer.from('x'), 'rotate'), { message: 'connect failed' });

    // Nothing further is attempted and close() is a no-op.
    await client.close();
    assert.equal(2, attempts);
  });

  describe('connection lost while setup runs', () => {
    class FakeModelEmittingCloseWhenClosed extends FakePromiseModel {
      close() {
        this.emit('close');
        return Promise.resolve();
      }
    }

    function deferred() {
      const controls = {};
      controls.promise = new Promise((resolve, reject) => {
        controls.resolve = resolve;
        controls.reject = reject;
      });
      return controls;
    }

    function startRecovery({ Model = FakePromiseModel, settleFirstSetupSynchronously } = {}) {
      const models = [];
      const failures = [];
      const firstSetupStarted = deferred();
      const firstSetupOutcome = deferred();

      function openModel() {
        const model = new Model(models.length + 1);
        models.push(model);
        return Promise.resolve(model);
      }

      function promiseSetup(model) {
        if (model !== models[0]) return Promise.resolve();
        firstSetupStarted.resolve(model);
        return firstSetupOutcome.promise;
      }

      function callbackSetup(model, done) {
        if (model === models[0]) settleFirstSetupSynchronously(model, done);
        else done();
      }

      const connected = recovery
        .connectWithRecoveryPromise(openModel, {
          initialDelay: 1,
          maxDelay: 1,
          jitter: 0,
          maxRetries: 3,
          waitForConnect: false,
          setup: settleFirstSetupSynchronously ? callbackSetup : promiseSetup,
        })
        .then((client) => {
          client.on('connect-failed', (err) => failures.push(err.message));
          return client.waitForConnect();
        });

      return { models, failures, firstSetupStarted: firstSetupStarted.promise, firstSetupOutcome, connected };
    }

    async function assertReconnected({ models, connected }) {
      const client = await connected;
      assert.equal(2, models.length);
      const channel = await client.createChannel();
      assert.equal(2, channel.id);
      return client;
    }

    it('reconnects when the socket drops and setup never settles', async () => {
      const attempt = startRecovery();
      const model = await attempt.firstSetupStarted;
      const err = new Error('Unexpected close');

      model.emit('error', err);
      model.emit('close', err);

      const client = await assertReconnected(attempt);
      assert.deepEqual(['Unexpected close'], attempt.failures);
      await client.close();
    });

    it('reconnects when the connection closes without an error', async () => {
      const attempt = startRecovery();
      const model = await attempt.firstSetupStarted;

      model.emit('close');

      const client = await assertReconnected(attempt);
      assert.deepEqual(['Connection closed'], attempt.failures);
      await client.close();
    });

    it('reconnects when the connection errors and has not closed yet', async () => {
      const attempt = startRecovery();
      const model = await attempt.firstSetupStarted;

      model.emit('error', new Error('Frame error'));

      const client = await assertReconnected(attempt);
      assert.deepEqual(['Frame error'], attempt.failures);
      await client.close();
    });

    it('reports the connection error when the loss makes setup fail first', async () => {
      const attempt = startRecovery({
        settleFirstSetupSynchronously(model, done) {
          done(new Error('Channel ended, no reply will be forthcoming'));
          model.emit('close', new Error('CONNECTION_FORCED'));
        },
      });

      const client = await assertReconnected(attempt);
      assert.deepEqual(['CONNECTION_FORCED'], attempt.failures);
      await client.close();
    });

    it('reconnects when the connection closes straight after setup completes', async () => {
      const attempt = startRecovery({
        settleFirstSetupSynchronously(model, done) {
          done();
          model.emit('close', new Error('CONNECTION_FORCED'));
        },
      });

      const client = await assertReconnected(attempt);
      assert.deepEqual(['CONNECTION_FORCED'], attempt.failures);
      await client.close();
    });

    it('tolerates the connection closing after recovery was stopped while it opened', async () => {
      const opening = deferred();
      const client = await recovery.connectWithRecoveryPromise(() => opening.promise, { waitForConnect: false });
      await new Promise((resolve) => setImmediate(resolve));

      await client.close();
      opening.resolve(new FakeModelEmittingCloseWhenClosed(1));
      await new Promise((resolve) => setImmediate(resolve));
    });

    it('tolerates setup rejecting and the discarded connection erroring after the reconnect', async () => {
      const attempt = startRecovery();
      const model = await attempt.firstSetupStarted;
      model.emit('close', new Error('Unexpected close'));
      const client = await assertReconnected(attempt);

      attempt.firstSetupOutcome.reject(new Error('Channel ended, no reply will be forthcoming'));
      model.emit('error', new Error('Late socket error'));
      await new Promise((resolve) => setImmediate(resolve));

      assert.deepEqual(['Unexpected close'], attempt.failures);
      await client.close();
    });

    it('does not report a failed connect when the connection is lost after recovery was closed', async () => {
      const models = [];
      const failures = [];
      const setupStarted = deferred();

      const client = await recovery.connectWithRecoveryPromise(
        () => {
          const model = new FakePromiseModel(models.length + 1);
          models.push(model);
          return Promise.resolve(model);
        },
        {
          waitForConnect: false,
          setup(model) {
            setupStarted.resolve(model);
            return new Promise(() => {});
          },
        },
      );
      client.on('connect-failed', (err) => failures.push(err.message));
      const model = await setupStarted.promise;

      await client.close();
      model.emit('close', new Error('Unexpected close'));
      await new Promise((resolve) => setImmediate(resolve));

      assert.deepEqual([], failures);
      assert.equal(1, models.length);
    });

    it('reports the setup error when setup fails on a healthy connection', async () => {
      const attempt = startRecovery({ Model: FakeModelEmittingCloseWhenClosed });
      await attempt.firstSetupStarted;

      attempt.firstSetupOutcome.reject(new Error('Queue does not exist'));

      const client = await assertReconnected(attempt);
      assert.deepEqual(['Queue does not exist'], attempt.failures);
      await client.close();
    });

    it('reconnects a callback model whose setup never calls back', async () => {
      const models = [];
      const failures = [];
      const firstSetupStarted = deferred();

      function openModel() {
        const model = new FakeCallbackModel(models.length + 1);
        models.push(model);
        return Promise.resolve(model);
      }

      function setup(model, done) {
        if (model === models[0]) firstSetupStarted.resolve(model);
        else done();
      }

      const client = recovery.connectWithRecoveryCallback(openModel, {
        initialDelay: 1,
        maxDelay: 1,
        jitter: 0,
        maxRetries: 3,
        waitForConnect: false,
        setup,
      });
      client.on('connect-failed', (err) => failures.push(err.message));
      const connected = new Promise((resolve, reject) => {
        client.waitForConnect((err) => (err ? reject(err) : resolve()));
      });

      const model = await firstSetupStarted.promise;
      const err = new Error('Unexpected close');
      model.emit('error', err);
      model.emit('close', err);
      await connected;

      assert.equal(2, models.length);
      assert.deepEqual(['Unexpected close'], failures);
      const channel = await new Promise((resolve, reject) => {
        client.createChannel((channelErr, ch) => (channelErr ? reject(channelErr) : resolve(ch)));
      });
      assert.equal(2, channel.id);
      await new Promise((resolve) => client.close(resolve));
    });
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

  describe('initialMaxRetries', () => {
    it('bounds the initial connection separately from maxRetries', async () => {
      let attempts = 0;

      function openModel() {
        attempts++;
        return Promise.reject(new Error('connect failed'));
      }

      await assert.rejects(
        recovery.connectWithRecoveryPromise(openModel, {
          initialDelay: 1,
          maxDelay: 1,
          jitter: 0,
          initialMaxRetries: 2,
          maxRetries: Infinity,
        }),
        { message: 'connect failed' },
      );

      assert.equal(3, attempts);
    });

    it('stops applying once a connection has been established', async () => {
      const models = [];
      let attempts = 0;

      function openModel() {
        attempts++;
        // Succeed at first, fail twice after the disconnect, then succeed again.
        if (attempts === 2 || attempts === 3) return Promise.reject(new Error('connect failed'));
        const model = new FakePromiseModel(attempts);
        models.push(model);
        return Promise.resolve(model);
      }

      const client = await recovery.connectWithRecoveryPromise(openModel, {
        initialDelay: 1,
        maxDelay: 1,
        jitter: 0,
        initialMaxRetries: 0,
        maxRetries: 3,
      });

      const failures = [];
      client.on('reconnect-failed', (err) => failures.push(err));

      const reconnected = new Promise((resolve) => client.once('connect', resolve));
      models[0].emit('close', new Error('socket closed'));
      await reconnected;

      assert.equal(4, attempts);
      assert.deepEqual([], failures);

      await client.close();
    });

    it('accepts Infinity explicitly even when maxRetries is finite', async () => {
      let attempts = 0;

      function openModel() {
        attempts++;
        if (attempts < 4) return Promise.reject(new Error('connect failed'));
        return Promise.resolve(new FakePromiseModel(attempts));
      }

      const client = await recovery.connectWithRecoveryPromise(openModel, {
        initialDelay: 1,
        maxDelay: 1,
        jitter: 0,
        initialMaxRetries: Infinity,
        maxRetries: 1,
      });

      assert.equal(4, attempts);
      await client.close();
    });

    it('rejects the callback connect once the initial budget is exhausted', (_t, done) => {
      let attempts = 0;

      function openModel() {
        attempts++;
        return Promise.reject(new Error('connect failed'));
      }

      recovery.connectWithRecoveryCallback(
        openModel,
        { initialDelay: 1, maxDelay: 1, jitter: 0, initialMaxRetries: 1, maxRetries: Infinity },
        (err) => {
          try {
            assert.equal('connect failed', err.message);
            assert.equal(2, attempts);
            done();
          } catch (e) {
            done(e);
          }
        },
      );
    });
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

      const client = await recovery.connectWithRecoveryPromise(openModel, { waitForConnect: false });

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

      const client = await recovery.connectWithRecoveryPromise(openModel, { waitForConnect: false });
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

      await assert.rejects(pendingChannel, { message: 'Connection closed' });
      await assert.rejects(client.waitForConnect(), { message: 'Connection closed' });

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

      await assert.rejects(client.waitForConnect(), { message: 'connect failed' });
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
      const client = recovery.connectWithRecoveryCallback(openModel, { waitForConnect: false }, (err, c) => {
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

  describe('listeners that throw', () => {
    const listenerBug = new Error('listener bug');

    function nextTurnOfTheEventLoop() {
      return new Promise((resolve) => setImmediate(resolve));
    }

    function once(emitter, event) {
      return new Promise((resolve) => emitter.once(event, (...args) => resolve(args)));
    }

    async function startRecovery(openModel, options) {
      const client = await recovery.connectWithRecoveryPromise(
        openModel,
        Object.assign({ initialDelay: 1, maxDelay: 1, jitter: 0, waitForConnect: false }, options),
      );
      const handlerErrors = [];
      client.on('handler-error', (err, event) => handlerErrors.push({ err, event }));
      return { client, handlerErrors };
    }

    function openingFakeModels(models) {
      return () => {
        const model = new FakePromiseModel(models.length + 1);
        models.push(model);
        return Promise.resolve(model);
      };
    }

    function failingFirstOpen(models) {
      let attempts = 0;
      return () => {
        if (++attempts === 1) return Promise.reject(new Error('ECONNREFUSED'));
        return openingFakeModels(models)();
      };
    }

    it('keeps the connection when a connect listener throws', async () => {
      const models = [];
      const { client, handlerErrors } = await startRecovery(openingFakeModels(models));
      const events = [];
      for (const event of ['connect-failed', 'disconnect', 'reconnect-scheduled']) {
        client.on(event, () => events.push(event));
      }
      client.on('connect', () => {
        throw listenerBug;
      });

      await client.waitForConnect();
      await nextTurnOfTheEventLoop();
      await new Promise((resolve) => setTimeout(resolve, 10));

      assert.equal(1, models.length);
      assert.deepEqual([], events);
      assert.deepEqual([{ err: listenerBug, event: 'connect' }], handlerErrors);
      const channel = await client.createChannel();
      assert.equal(1, channel.id);
      await client.close();
    });

    it('still reconnects when a connect-failed listener throws', async () => {
      const models = [];
      const { client, handlerErrors } = await startRecovery(failingFirstOpen(models));
      client.on('connect-failed', () => {
        throw listenerBug;
      });

      await client.waitForConnect();
      await nextTurnOfTheEventLoop();

      assert.equal(1, models.length);
      assert.deepEqual([{ err: listenerBug, event: 'connect-failed' }], handlerErrors);
      await client.close();
    });

    for (const event of ['disconnect', 'reconnect-scheduled']) {
      it(`still reconnects when a ${event} listener throws`, async () => {
        const models = [];
        const { client, handlerErrors } = await startRecovery(openingFakeModels(models));
        await client.waitForConnect();
        client.on(event, () => {
          throw listenerBug;
        });
        const reconnected = once(client, 'connect');

        models[0].emit('close', new Error('socket closed'));
        await reconnected;
        await nextTurnOfTheEventLoop();

        assert.equal(2, models.length);
        assert.deepEqual([{ err: listenerBug, event }], handlerErrors);
        await client.close();
      });
    }

    it('reports a throwing reconnect-failed listener after rejecting pending operations', async () => {
      const { client, handlerErrors } = await startRecovery(() => Promise.reject(new Error('ECONNREFUSED')), {
        maxRetries: 0,
      });
      client.on('reconnect-failed', () => {
        throw listenerBug;
      });

      await assert.rejects(client.waitForConnect(), /ECONNREFUSED/);
      await nextTurnOfTheEventLoop();

      assert.deepEqual([{ err: listenerBug, event: 'reconnect-failed' }], handlerErrors);
    });

    it('reports a connection error that nothing listens for to the handler-error listener', async () => {
      const models = [];
      const { client, handlerErrors } = await startRecovery(openingFakeModels(models));
      await client.waitForConnect();
      const socketError = new Error('socket error');

      models[0].emit('error', socketError);
      await nextTurnOfTheEventLoop();

      assert.deepEqual([{ err: socketError, event: 'error' }], handlerErrors);
      await client.close();
    });

    describe('without a handler-error listener', () => {
      let previousUncaughtExceptionListeners;

      beforeEach(() => {
        previousUncaughtExceptionListeners = process.rawListeners('uncaughtException').slice();
        process.removeAllListeners('uncaughtException');
      });

      afterEach(() => {
        process.removeAllListeners('uncaughtException');
        previousUncaughtExceptionListeners.forEach((listener) => process.on('uncaughtException', listener));
      });

      it('raises the throw as an uncaught exception and still reconnects', async () => {
        const models = [];
        const client = await recovery.connectWithRecoveryPromise(openingFakeModels(models), {
          initialDelay: 1,
          maxDelay: 1,
          jitter: 0,
        });
        const uncaught = once(process, 'uncaughtException');
        client.on('disconnect', () => {
          throw listenerBug;
        });
        const reconnected = once(client, 'connect');

        models[0].emit('close', new Error('socket closed'));

        assert.strictEqual(listenerBug, (await uncaught)[0]);
        await reconnected;
        assert.equal(2, models.length);
        await client.close();
      });

      it('raises a connection error that nothing listens for as an uncaught exception', async () => {
        const models = [];
        const client = await recovery.connectWithRecoveryPromise(openingFakeModels(models), {});
        const uncaught = once(process, 'uncaughtException');
        const socketError = new Error('socket error');

        models[0].emit('error', socketError);

        assert.strictEqual(socketError, (await uncaught)[0]);
        await client.close();
      });

      it('raises a model handler-error as an uncaught exception', async () => {
        const models = [];
        const client = await recovery.connectWithRecoveryPromise(openingFakeModels(models), {});
        const uncaught = once(process, 'uncaughtException');

        models[0].emit('handler-error', listenerBug, 'blocked');

        assert.strictEqual(listenerBug, (await uncaught)[0]);
        await client.close();
      });
    });
  });

  describe('close while a connection attempt is in flight', () => {
    function deferred() {
      const controls = {};
      controls.promise = new Promise((resolve, reject) => {
        controls.resolve = resolve;
        controls.reject = reject;
      });
      return controls;
    }

    class FakeModelClosingOnDemand extends FakePromiseModel {
      constructor(id) {
        super(id);
        this.closeRequested = false;
        this.closing = deferred();
      }

      close() {
        this.closeRequested = true;
        return this.closing.promise;
      }
    }

    async function startRecoveryInSetup(setupOutcome) {
      const model = new FakeModelClosingOnDemand(1);
      const setupStarted = deferred();
      const client = await recovery.connectWithRecoveryPromise(() => Promise.resolve(model), {
        waitForConnect: false,
        setup() {
          setupStarted.resolve();
          return setupOutcome;
        },
      });
      await setupStarted.promise;
      return { client, model };
    }

    async function settled(promise) {
      let isSettled = false;
      promise.then(
        () => {
          isSettled = true;
        },
        () => {
          isSettled = true;
        },
      );
      await new Promise((resolve) => setImmediate(resolve));
      return isSettled;
    }

    it('closes the connection even though setup never settles', async () => {
      const { client, model } = await startRecoveryInSetup(new Promise(() => {}));

      const closed = client.close();
      await new Promise((resolve) => setImmediate(resolve));

      assert.equal(true, model.closeRequested);
      model.closing.resolve();
      await closed;
    });

    it('resolves close only once the connection has closed', async () => {
      const { client, model } = await startRecoveryInSetup(new Promise(() => {}));

      const closed = client.close();

      assert.equal(false, await settled(closed));
      model.closing.resolve();
      await closed;
    });

    it('does not wait for a connection that is still opening', async () => {
      const opening = deferred();
      const model = new FakeModelClosingOnDemand(1);
      const client = await recovery.connectWithRecoveryPromise(() => opening.promise, { waitForConnect: false });
      await new Promise((resolve) => setImmediate(resolve));

      await client.close();
      opening.resolve(model);
      await new Promise((resolve) => setImmediate(resolve));

      assert.equal(true, model.closeRequested);
    });
  });

  it('schedules a zero delay rather than NaN when initialDelay is zero and the backoff overflows', async () => {
    const delays = [];
    const client = await recovery.connectWithRecoveryPromise(() => Promise.reject(new Error('ECONNREFUSED')), {
      initialDelay: 0,
      factor: 1e200,
      maxRetries: 3,
      waitForConnect: false,
    });
    client.on('reconnect-scheduled', ({ delay }) => delays.push(delay));

    await assert.rejects(client.waitForConnect(), /ECONNREFUSED/);

    assert.deepEqual([0, 0, 0], delays);
  });
});
