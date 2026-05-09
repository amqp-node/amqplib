const EventEmitter = require('node:events');

const DEFAULT_RECOVERY = {
  initialDelay: 100,
  maxDelay: 30000,
  factor: 2,
  jitter: 0.2,
  maxRetries: Infinity,
  setup: null,
};

function splitConnectionOptions(connOptions) {
  if (!connOptions || typeof connOptions !== 'object') {
    return {
      connectionOptions: connOptions,
      recovery: null,
    };
  }

  if (!Object.hasOwn(connOptions, 'recovery')) {
    return {
      connectionOptions: connOptions,
      recovery: null,
    };
  }

  const connectionOptions = Object.assign({}, connOptions);
  const recovery = connectionOptions.recovery;
  delete connectionOptions.recovery;

  return { connectionOptions, recovery };
}

function recoveryEnabled(recovery) {
  if (!recovery) return false;
  if (recovery === true) return true;
  return recovery.enabled !== false;
}

function toFiniteNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normaliseRecoveryOptions(recovery) {
  const source = recovery === true ? {} : recovery || {};
  const initialDelay = Math.max(0, toFiniteNumber(source.initialDelay, DEFAULT_RECOVERY.initialDelay));
  const maxDelay = Math.max(initialDelay, toFiniteNumber(source.maxDelay, DEFAULT_RECOVERY.maxDelay));
  const factor = Math.max(1, toFiniteNumber(source.factor, DEFAULT_RECOVERY.factor));
  const jitter = Math.min(1, Math.max(0, toFiniteNumber(source.jitter, DEFAULT_RECOVERY.jitter)));
  const parsedMaxRetries = source.maxRetries == null ? Infinity : toFiniteNumber(source.maxRetries, Infinity);

  return {
    initialDelay,
    maxDelay,
    factor,
    jitter,
    maxRetries: parsedMaxRetries < 0 ? 0 : parsedMaxRetries,
    setup: typeof source.setup === 'function' ? source.setup : null,
  };
}

function toError(err, fallbackMessage) {
  if (err instanceof Error) return err;
  return new Error(err ? String(err) : fallbackMessage);
}

function calculateDelay(recovery, attempt) {
  const base = Math.min(recovery.maxDelay, recovery.initialDelay * recovery.factor ** (attempt - 1));
  const jitterPart = base * recovery.jitter;
  const offset = jitterPart > 0 ? Math.random() * jitterPart * 2 - jitterPart : 0;
  return Math.max(0, Math.round(base + offset));
}

function runSetup(setup, model) {
  if (!setup) return Promise.resolve();

  return new Promise((resolve, reject) => {
    let settled = false;

    function done(err) {
      if (settled) return;
      settled = true;
      if (err) reject(toError(err, 'Recovery setup failed'));
      else resolve();
    }

    try {
      if (setup.length >= 2) {
        setup(model, done);
      } else {
        Promise.resolve(setup(model)).then(() => done(), done);
      }
    } catch (err) {
      done(err);
    }
  });
}

function makeCallback(promise, cb) {
  const callback = typeof cb === 'function' ? cb : () => {};
  promise.then(
    (value) => callback(null, value),
    (err) => callback(toError(err, 'Operation failed')),
  );
}

class RecoveringCore extends EventEmitter {
  constructor(openModel, recovery, adapters) {
    super();
    this._openModel = openModel;
    this._recovery = normaliseRecoveryOptions(recovery);
    this._adapters = adapters;
    this._model = null;
    this._modelListeners = null;
    this._waiters = [];
    this._connecting = false;
    this._stopped = false;
    this._timer = null;
    this._attempt = 0;

    this._initialReady = false;
    this._initialWait = new Promise((resolve, reject) => {
      this._resolveInitial = resolve;
      this._rejectInitial = reject;
    });

    this._connect();
  }

  waitForConnect() {
    return this._initialWait;
  }

  async close() {
    if (this._stopped) return;
    this._stopped = true;

    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }

    const closedError = new Error('Connection closed');
    this._rejectPendingWaiters(closedError);
    this._rejectInitialConnection(closedError);

    if (this._model) {
      const model = this._model;
      this._model = null;
      this._unbindModel();
      await this._closeModelNoThrow(model);
    }
  }

  async createChannel(options) {
    const model = await this._waitForConnection();
    return this._adapters.createChannel(model, options, false);
  }

  async createConfirmChannel(options) {
    const model = await this._waitForConnection();
    return this._adapters.createChannel(model, options, true);
  }

  async updateSecret(newSecret, reason) {
    const model = await this._waitForConnection();
    return this._adapters.updateSecret(model, newSecret, reason);
  }

  _resolveInitialConnection() {
    if (this._initialReady) return;
    this._initialReady = true;
    this._resolveInitial();
  }

  _rejectInitialConnection(err) {
    if (this._initialReady) return;
    this._initialReady = true;
    this._rejectInitial(err);
  }

  _resolvePendingWaiters(model) {
    const waiters = this._waiters.splice(0);
    waiters.forEach((waiter) => {
      waiter.resolve(model);
    });
  }

  _rejectPendingWaiters(err) {
    const waiters = this._waiters.splice(0);
    waiters.forEach((waiter) => {
      waiter.reject(err);
    });
  }

  _waitForConnection() {
    if (this._model) return Promise.resolve(this._model);
    if (this._stopped) return Promise.reject(new Error('Connection closed'));

    return new Promise((resolve, reject) => {
      this._waiters.push({ resolve, reject });
    });
  }

  _bindModel(model) {
    const onClose = (maybeErr) => {
      if (this._model !== model) return;

      this._model = null;
      this._unbindModel();
      if (this._stopped) return;

      const err = toError(maybeErr, 'Connection closed');
      this.emit('disconnect', err);
      this._scheduleReconnect(err);
    };

    const onBlocked = (reason) => this.emit('blocked', reason);
    const onUnblocked = () => this.emit('unblocked');
    const onConnectionError = (err) => this.emit('error', err);
    const onUpdateSecretOk = () => this.emit('update-secret-ok');
    const onHandlerError = (err, event) => this.emit('handler-error', err, event);

    model.on('close', onClose);
    model.on('blocked', onBlocked);
    model.on('unblocked', onUnblocked);
    model.on('error', onConnectionError);
    model.on('update-secret-ok', onUpdateSecretOk);
    model.on('handler-error', onHandlerError);

    this._modelListeners = {
      model,
      onClose,
      onBlocked,
      onUnblocked,
      onConnectionError,
      onUpdateSecretOk,
      onHandlerError,
    };
  }

  _unbindModel() {
    if (!this._modelListeners) return;
    const { model, onClose, onBlocked, onUnblocked, onConnectionError, onUpdateSecretOk, onHandlerError } = this._modelListeners;
    model.removeListener('close', onClose);
    model.removeListener('blocked', onBlocked);
    model.removeListener('unblocked', onUnblocked);
    model.removeListener('error', onConnectionError);
    model.removeListener('update-secret-ok', onUpdateSecretOk);
    model.removeListener('handler-error', onHandlerError);
    model.on('error', () => {});
    this._modelListeners = null;
  }

  async _connect() {
    if (this._stopped || this._connecting) return;
    this._connecting = true;

    let model;
    try {
      model = await this._openModel();
      await runSetup(this._recovery.setup, model);
      if (this._stopped) {
        await this._closeModelNoThrow(model);
        return;
      }

      this._model = model;
      this._attempt = 0;
      this._bindModel(model);
      this._resolveInitialConnection();
      this._resolvePendingWaiters(model);
      this.emit('connect', model);
    } catch (err) {
      const error = toError(err, 'Connection recovery failed');
      if (model) await this._closeModelNoThrow(model);
      this.emit('connect-failed', error);
      this._scheduleReconnect(error);
    } finally {
      this._connecting = false;
    }
  }

  _scheduleReconnect(err) {
    if (this._stopped) return;

    if (this._timer) return;

    if (this._attempt >= this._recovery.maxRetries) {
      this._rejectInitialConnection(err);
      this._rejectPendingWaiters(err);
      this.emit('reconnect-failed', err);
      return;
    }

    const attempt = this._attempt + 1;
    const delay = calculateDelay(this._recovery, attempt);
    this._attempt = attempt;

    this.emit('reconnect-scheduled', { attempt, delay, error: err });
    this._timer = setTimeout(() => {
      this._timer = null;
      this._connect();
    }, delay);
  }

  _closeModelNoThrow(model) {
    return this._adapters.closeModel(model).catch(() => {});
  }
}

const PROMISE_ADAPTERS = {
  closeModel(model) {
    return model.close();
  },
  createChannel(model, options, confirm) {
    return confirm ? model.createConfirmChannel(options) : model.createChannel(options);
  },
  updateSecret(model, newSecret, reason) {
    return model.updateSecret(newSecret, reason);
  },
};

function callbackClose(model) {
  return new Promise((resolve, reject) => {
    model.close((err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

function callbackCreateChannel(model, options, confirm) {
  return new Promise((resolve, reject) => {
    const method = confirm ? 'createConfirmChannel' : 'createChannel';
    const cb = (err, channel) => {
      if (err) reject(err);
      else resolve(channel);
    };

    if (options === undefined) model[method](cb);
    else model[method](options, cb);
  });
}

function callbackUpdateSecret(model, newSecret, reason) {
  return new Promise((resolve, reject) => {
    model.updateSecret(newSecret, reason, (err, ok) => {
      if (err) reject(err);
      else resolve(ok);
    });
  });
}

const CALLBACK_ADAPTERS = {
  closeModel: callbackClose,
  createChannel: callbackCreateChannel,
  updateSecret: callbackUpdateSecret,
};

function wireCommonEvents(source, target) {
  [
    'connect',
    'disconnect',
    'connect-failed',
    'reconnect-scheduled',
    'reconnect-failed',
    'blocked',
    'unblocked',
    'error',
    'update-secret-ok',
    'handler-error',
  ].forEach((eventName) => {
    source.on(eventName, (...args) => target.emit(eventName, ...args));
  });
}

class RecoveringPromiseModel extends EventEmitter {
  constructor(openModel, recovery) {
    super();
    this._core = new RecoveringCore(openModel, recovery, PROMISE_ADAPTERS);
    wireCommonEvents(this._core, this);
  }

  async waitForConnect() {
    await this._core.waitForConnect();
    return this;
  }

  close() {
    return this._core.close();
  }

  createChannel(options) {
    return this._core.createChannel(options);
  }

  createConfirmChannel(options) {
    return this._core.createConfirmChannel(options);
  }

  updateSecret(newSecret, reason) {
    return this._core.updateSecret(newSecret, reason);
  }
}

class RecoveringCallbackModel extends EventEmitter {
  constructor(openModel, recovery) {
    super();
    this._core = new RecoveringCore(openModel, recovery, CALLBACK_ADAPTERS);
    wireCommonEvents(this._core, this);
  }

  waitForConnect(cb) {
    const callback = typeof cb === 'function' ? cb : () => {};
    this._core.waitForConnect().then(
      () => callback(null, this),
      (err) => callback(toError(err, 'Operation failed')),
    );
    return this;
  }

  close(cb) {
    makeCallback(this._core.close(), cb);
    return this;
  }

  updateSecret(newSecret, reason, cb) {
    makeCallback(this._core.updateSecret(newSecret, reason), cb);
    return this;
  }

  createChannel(options, cb) {
    if (typeof options === 'function') {
      cb = options;
      options = undefined;
    }
    makeCallback(this._core.createChannel(options), cb);
    return this;
  }

  createConfirmChannel(options, cb) {
    if (typeof options === 'function') {
      cb = options;
      options = undefined;
    }
    makeCallback(this._core.createConfirmChannel(options), cb);
    return this;
  }
}

function connectWithRecoveryPromise(openModel, recovery) {
  const recovering = new RecoveringPromiseModel(openModel, recovery);
  return recovering.waitForConnect();
}

function connectWithRecoveryCallback(openModel, recovery, cb) {
  const recovering = new RecoveringCallbackModel(openModel, recovery);
  recovering.waitForConnect(cb);
  return recovering;
}

module.exports = {
  splitConnectionOptions,
  recoveryEnabled,
  connectWithRecoveryPromise,
  connectWithRecoveryCallback,
  RecoveringPromiseModel,
  RecoveringCallbackModel,
};
