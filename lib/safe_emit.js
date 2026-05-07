function safeEmit(emitter, event, ...args) {
  try {
    emitter.emit(event, ...args);
  } catch (e) {
    if (emitter.listenerCount('handler-error') > 0) {
      setImmediate(() => emitter.emit('handler-error', e, event));
    } else {
      throw e;
    }
  }
}

module.exports = safeEmit;
