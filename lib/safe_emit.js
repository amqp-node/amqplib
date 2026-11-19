function safeEmit(emitter, event, ...args) {
  const isErrorWithoutListener = event === 'error' && emitter.listenerCount('error') === 0;
  if (isErrorWithoutListener) {
    emitter.emit(event, ...args);
    return;
  }

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
