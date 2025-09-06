const assert = require('node:assert');
const api = require('../callback_api');
const util = require('./util');
const schedule = util.schedule;
const randomString = util.randomString;
const kCallback = util.kCallback;
const domain = require('node:domain');

const URL = process.env.URL || 'amqp://localhost';

function connect(cb) {
  api.connect(URL, {}, cb);
}

// Construct a node-style callback from a `done` function
function doneCallback(done) {
  return (err, _) => {
    if (err == null) done();
    else done(err);
  };
}

function ignore() {}

function twice(done) {
  let first = (err) => {
    if (err === undefined) second = done;
    else {
      second = ignore;
      done(err);
    }
  };
  let second = (err) => {
    if (err === undefined) first = done;
    else {
      first = ignore;
      done(err);
    }
  };
  return {
    first: (err) => {
      first(err);
    },
    second: (err) => {
      second(err);
    },
  };
}

// Adapt 'done' to a callback that's expected to fail
function failCallback(done) {
  return (err, _) => {
    if (err == null) done(new Error(`Expected failure, got ${val}`));
    else done();
  };
}

function waitForMessages(ch, q, k) {
  ch.checkQueue(q, (e, ok) => {
    if (e != null) return k(e);
    else if (ok.messageCount > 0) return k(null, ok);
    else schedule(waitForMessages.bind(null, ch, q, k));
  });
}

suite('connect', () => {
  test('at all', (done) => {
    connect(doneCallback(done));
  });
});

suite('updateSecret', () => {
  test('updateSecret', (done) => {
    connect(
      kCallback((c) => {
        c.updateSecret(Buffer.from('new secret'), 'no reason', doneCallback(done));
      }),
    );
  });
});

const channel_test_fn = (method) => {
  return (name, options, chfun) => {
    if (typeof options === 'function') {
      chfun = options;
      options = {};
    }
    test(name, (done) => {
      connect(
        kCallback((c) => {
          c[method](
            options,
            kCallback((ch) => {
              chfun(ch, done);
            }, done),
          );
        }, done),
      );
    });
  };
};
const channel_test = channel_test_fn('createChannel');
const confirm_channel_test = channel_test_fn('createConfirmChannel');

suite('channel open', () => {
  channel_test('at all', (_ch, done) => {
    done();
  });

  channel_test('open and close', (ch, done) => {
    ch.close(doneCallback(done));
  });
});

suite('assert, check, delete', () => {
  channel_test('assert, check, delete queue', (ch, done) => {
    ch.assertQueue(
      'test.cb.queue',
      {},
      kCallback((_q) => {
        ch.checkQueue(
          'test.cb.queue',
          kCallback((_ok) => {
            ch.deleteQueue('test.cb.queue', {}, doneCallback(done));
          }, done),
        );
      }, done),
    );
  });

  channel_test('assert, check, delete exchange', (ch, done) => {
    ch.assertExchange(
      'test.cb.exchange',
      'topic',
      {},
      kCallback((_ex) => {
        ch.checkExchange(
          'test.cb.exchange',
          kCallback((_ok) => {
            ch.deleteExchange('test.cb.exchange', {}, doneCallback(done));
          }, done),
        );
      }, done),
    );
  });

  channel_test('fail on check non-queue', (ch, done) => {
    const both = twice(done);
    ch.on('error', failCallback(both.first));
    ch.checkQueue('test.cb.nothere', failCallback(both.second));
  });

  channel_test('fail on check non-exchange', (ch, done) => {
    const both = twice(done);
    ch.on('error', failCallback(both.first));
    ch.checkExchange('test.cb.nothere', failCallback(both.second));
  });
});

suite('bindings', () => {
  channel_test('bind queue', (ch, done) => {
    ch.assertQueue(
      'test.cb.bindq',
      {},
      kCallback((q) => {
        ch.assertExchange(
          'test.cb.bindex',
          'fanout',
          {},
          kCallback((ex) => {
            ch.bindQueue(q.queue, ex.exchange, '', {}, doneCallback(done));
          }, done),
        );
      }, done),
    );
  });

  channel_test('bind exchange', (ch, done) => {
    ch.assertExchange(
      'test.cb.bindex1',
      'fanout',
      {},
      kCallback((ex1) => {
        ch.assertExchange(
          'test.cb.bindex2',
          'fanout',
          {},
          kCallback((ex2) => {
            ch.bindExchange(ex1.exchange, ex2.exchange, '', {}, doneCallback(done));
          }, done),
        );
      }, done),
    );
  });
});

suite('sending messages', () => {
  channel_test('send to queue and consume noAck', (ch, done) => {
    const msg = randomString();
    ch.assertQueue('', {exclusive: true}, (e, q) => {
      if (e !== null) return done(e);
      ch.consume(
        q.queue,
        (m) => {
          if (m.content.toString() === msg) done();
          else done(new Error(`message content doesn't match:${msg} =/= ${m.content.toString()}`));
        },
        {noAck: true, exclusive: true},
      );
      ch.sendToQueue(q.queue, Buffer.from(msg));
    });
  });

  channel_test('send to queue and consume ack', (ch, done) => {
    const msg = randomString();
    ch.assertQueue('', {exclusive: true}, (e, q) => {
      if (e !== null) return done(e);
      ch.consume(
        q.queue,
        (m) => {
          if (m.content.toString() === msg) {
            ch.ack(m);
            done();
          } else done(new Error(`message content doesn't match:${msg} =/= ${m.content.toString()}`));
        },
        {noAck: false, exclusive: true},
      );
      ch.sendToQueue(q.queue, Buffer.from(msg));
    });
  });

  channel_test('send to and get from queue', (ch, done) => {
    ch.assertQueue('', {exclusive: true}, (e, q) => {
      if (e != null) return done(e);
      const msg = randomString();
      ch.sendToQueue(q.queue, Buffer.from(msg));
      waitForMessages(ch, q.queue, (e, _) => {
        if (e != null) return done(e);
        ch.get(q.queue, {noAck: true}, (e, m) => {
          if (e != null) return done(e);
          else if (!m) return done(new Error('Empty (false) not expected'));
          else if (m.content.toString() === msg) return done();
          else return done(new Error(`Messages do not match: ${msg} =/= ${m.content.toString()}`));
        });
      });
    });
  });

  const channelOptions = {};

  channel_test('find high watermark', (ch, done) => {
    const msg = randomString();
    let baseline = 0;
    ch.assertQueue('', {exclusive: true}, (e, q) => {
      if (e !== null) return done(e);
      while (ch.sendToQueue(q.queue, Buffer.from(msg))) {
        baseline++;
      }
      channelOptions.highWaterMark = baseline * 2;
      done();
    });
  });

  channel_test('set high watermark', channelOptions, (ch, done) => {
    const msg = randomString();
    ch.assertQueue('', {exclusive: true}, (e, q) => {
      if (e !== null) return done(e);
      let ok;
      for (let i = 0; i < channelOptions.highWaterMark; i++) {
        ok = ch.sendToQueue(q.queue, Buffer.from(msg));
        assert.equal(ok, true);
      }
      done();
    });
  });
});

suite('ConfirmChannel', () => {
  confirm_channel_test('Receive confirmation', (ch, done) => {
    // An unroutable message, on the basis that you're not allowed a
    // queue with an empty name, and you can't make bindings to the
    // default exchange. Tricky eh?
    ch.publish('', '', Buffer.from('foo'), {}, done);
  });

  confirm_channel_test('Wait for confirms', (ch, done) => {
    for (let i = 0; i < 1000; i++) {
      ch.publish('', '', Buffer.from('foo'), {});
    }
    ch.waitForConfirms(done);
  });

  const channelOptions = {};

  confirm_channel_test('find high watermark', (ch, done) => {
    const msg = randomString();
    let baseline = 0;
    ch.assertQueue('', {exclusive: true}, (e, q) => {
      if (e !== null) return done(e);
      while (ch.sendToQueue(q.queue, Buffer.from(msg))) {
        baseline++;
      }
      channelOptions.highWaterMark = baseline * 2;
      done();
    });
  });

  confirm_channel_test('set high watermark', channelOptions, (ch, done) => {
    const msg = randomString();
    ch.assertQueue('', {exclusive: true}, (e, q) => {
      if (e !== null) return done(e);
      let ok;
      for (let i = 0; i < channelOptions.highWaterMark; i++) {
        ok = ch.sendToQueue(q.queue, Buffer.from(msg));
        assert.equal(ok, true);
      }
      done();
    });
  });
});

suite('Error handling', () => {
  /*
  I don't like having to do this, but there appears to be something
  broken about domains in Node.JS v0.8 and mocha. Apparently it has to
  do with how mocha and domains hook into error propogation:
  https://github.com/visionmedia/mocha/issues/513 (summary: domains in
  Node.JS v0.8 don't prevent uncaughtException from firing, and that's
  what mocha uses to detect .. an uncaught exception).

  Using domains with amqplib *does* work in practice in Node.JS v0.8:
  that is, it's possible to throw an exception in a callback and deal
  with it in the active domain, and thereby avoid it crashing the
  program.
   */
  if (util.versionGreaterThan(process.versions.node, '0.8')) {
    test('Throw error in connection open callback', (done) => {
      const dom = domain.createDomain();
      dom.on('error', failCallback(done));
      connect(
        dom.bind((_err, _conn) => {
          throw new Error('Spurious connection open callback error');
        }),
      );
    });
  }

  // TODO: refactor {error_test, channel_test}
  function error_test(name, fun) {
    test(name, (done) => {
      const dom = domain.createDomain();
      dom.run(() => {
        connect(
          kCallback((c) => {
            // Seems like there were some unironed wrinkles in 0.8's
            // implementation of domains; explicitly adding the connection
            // to the domain makes sure any exception thrown in the course
            // of processing frames is handled by the domain. For other
            // versions of Node.JS, this ends up being belt-and-braces.
            dom.add(c);
            c.createChannel(
              kCallback((ch) => {
                fun(ch, done, dom);
              }, done),
            );
          }, done),
        );
      });
    });
  }

  error_test('Channel open callback throws an error', (_ch, done, dom) => {
    dom.on('error', failCallback(done));
    throw new Error('Error in open callback');
  });

  error_test('RPC callback throws error', (ch, done, dom) => {
    dom.on('error', failCallback(done));
    ch.prefetch(0, false, (_err, _ok) => {
      throw new Error('Spurious callback error');
    });
  });

  error_test('Get callback throws error', (ch, done, dom) => {
    dom.on('error', failCallback(done));
    ch.assertQueue('test.cb.get-with-error', {}, (_err, _ok) => {
      ch.get('test.cb.get-with-error', {noAck: true}, () => {
        throw new Error('Spurious callback error');
      });
    });
  });

  error_test('Consume callback throws error', (ch, done, dom) => {
    dom.on('error', failCallback(done));
    ch.assertQueue('test.cb.consume-with-error', {}, (_err, _ok) => {
      ch.consume('test.cb.consume-with-error', ignore, {noAck: true}, () => {
        throw new Error('Spurious callback error');
      });
    });
  });

  error_test('Get from non-queue invokes error k', (ch, done, dom) => {
    const both = twice(failCallback(done));
    dom.on('error', both.first);
    ch.get('', {}, both.second);
  });

  error_test('Consume from non-queue invokes error k', (ch, done, dom) => {
    const both = twice(failCallback(done));
    dom.on('error', both.first);
    ch.consume('', both.second);
  });
});
