const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert');
const api = require('../callback_api');
const util = require('./util');
const schedule = util.schedule;
const randomString = util.randomString;
const domain = require('node:domain');

const URL = process.env.URL || 'amqp://localhost';

function connect(cb) {
  api.connect(URL, {}, cb);
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

function waitForMessages(ch, q, cb) {
  ch.checkQueue(q, (e, ok) => {
    if (e != null) return cb(e);
    else if (ok.messageCount > 0) return cb(null, ok);
    else schedule(waitForMessages.bind(null, ch, q, cb));
  });
}

describe('connect', () => {
  it('at all', (_t, done) => {
    connect((err, c) => {
      assert.ifError(err);
      c.close(done);
    });
  });
});

describe('updateSecret', () => {

  let c;

  afterEach((_t, done) => {
    c?.close(done);
  });

  it('updateSecret', (_t, done) => {
    connect((err, _c) => {
      assert.ifError(err);
      c = _c;
      c.updateSecret(Buffer.from('new secret'), 'no reason', (err) => {
        assert.ifError(err);
        done();
      });
    });
  });
});

const channel_test_fn = (method) => {
  return (name, options, chfun) => {
    if (typeof options === 'function') {
      chfun = options;
      options = {};
    }
    it(name, (_t, done) => {
      connect((err, c) => {
        assert.ifError(err);
        c[method](options, ((err, ch) => {
          assert.ifError(err);
          chfun(ch, done);
        }));
      });
    });
  };
};
const channel_test = channel_test_fn('createChannel');
const confirm_channel_test = channel_test_fn('createConfirmChannel');

describe('channel open', () => {
  channel_test('at all', (ch, done) => {
    ch.connection.close(done);
  });

  channel_test('open and close', (ch, done) => {
    ch.close((err) => {
      assert.ifError(err);
      ch.connection.close(done);
    });
  });
});

describe('assert, check, delete', () => {

  let ch;

  afterEach((_t, done) => {
    ch?.connection?.close(done);
  });

  channel_test('assert, check, delete queue', (_ch, done) => {
    ch = _ch;
    ch.assertQueue('test.cb.queue', {}, (err, { queue }) => {
      assert.ifError(err);
      assert.strictEqual(queue, 'test.cb.queue');
      ch.checkQueue('test.cb.queue', (err, ok) => {
        assert.ifError(err);
        assert.ok(ok);
        ch.deleteQueue('test.cb.queue', {}, done);
      })
    });
  });

  channel_test('assert, check, delete exchange', (_ch, done) => {
    ch = _ch;
    ch.assertExchange('test.cb.exchange', 'topic', {}, (err, { exchange }) => {
      assert.ifError(err);
      assert.strictEqual(exchange, 'test.cb.exchange');
      ch.checkExchange('test.cb.exchange', (err, _ok) => {
        assert.ifError(err);
        ch.deleteExchange('test.cb.exchange', {}, done);
      });
    });
  });

  channel_test('fail on check non-queue', (_ch, done) => {
    ch = _ch;
    const both = twice(done);
    ch.on('error', (err) => {
      assert.match(err.message, /Channel closed by server/)
      both.first()
    });
    ch.checkQueue('test.cb.nothere', (err) => {
      assert.match(err.message, /QueueDeclare; 404 \(NOT-FOUND\)/);
      both.second();
    });
  });

  channel_test('fail on check non-exchange', (_ch, done) => {
    ch = _ch;
    const both = twice(done);
    ch.on('error', (err) => {
      assert.match(err.message, /Channel closed by server/)
      both.first()
    });
    ch.checkExchange('test.cb.nothere', (err) => {
      assert.match(err.message, /ExchangeDeclare; 404 \(NOT-FOUND\)/);
      both.second();
    });
  });
});

describe('bindings', () => {

  let ch;

  afterEach((_t, done) => {
    ch?.connection?.close(done);
  });

  channel_test('bind queue', (_ch, done) => {
    ch = _ch;
    ch.assertQueue('test.cb.bindq', {}, (err, q) => {
      assert.ifError(err);
      ch.assertExchange('test.cb.bindex', 'fanout', {}, (err, ex) => {
        assert.ifError(err);
        ch.bindQueue(q.queue, ex.exchange, '', {}, done);
      });
    });
  });

  channel_test('bind exchange', (_ch, done) => {
    ch = _ch;
    ch.assertExchange('test.cb.bindex1', 'fanout', {}, (err, ex1) => {
      assert.ifError(err);
      ch.assertExchange('test.cb.bindex2', 'fanout', {}, (err, ex2) => {
        assert.ifError(err);
        ch.bindExchange(ex1.exchange, ex2.exchange, '', {}, done);
      });
    });
  });
});

describe('sending messages', () => {

  let ch;

  afterEach((_t, done) => {
    ch?.connection?.close(done);
  });

  channel_test('send to queue and consume noAck', (_ch, done) => {
    ch = _ch;
    const msg = randomString();
    ch.assertQueue('', { exclusive: true }, (err, { queue }) => {
      assert.ifError(err);
      ch.consume(queue, (m) => {
        assert.strictEqual(m.content.toString(), msg);
        done();
      }, { noAck: true, exclusive: true });
      ch.sendToQueue(queue, Buffer.from(msg));
    });
  });

  channel_test('send to queue and consume ack', (_ch, done) => {
    ch = _ch;
    const msg = randomString();
    ch.assertQueue('', { exclusive: true }, (err, { queue }) => {
      assert.ifError(err);
      ch.consume(queue, (m) => {
        assert.strictEqual(m.content.toString(), msg);
        ch.ack(m);
        done();
      }, { noAck: false, exclusive: true });
      ch.sendToQueue(queue, Buffer.from(msg));
    });
  });

  channel_test('send to and get from queue', (_ch, done) => {
    ch = _ch;
    ch.assertQueue('', { exclusive: true }, (err, { queue }) => {
      assert.ifError(err);
      const msg = randomString();
      ch.sendToQueue(queue, Buffer.from(msg));
      waitForMessages(ch, queue, (err, _) => {
        assert.ifError(err);
        ch.get(queue, { noAck: true }, (err, m) => {
          assert.ifError(err);
          assert.ok(m, 'Expected message, got empty/false');
          assert.strictEqual(m.content.toString(), msg);
          done();
        });
      });
    });
  });

  const channelOptions = {};

  channel_test('find high watermark', (_ch, done) => {
    ch = _ch;
    const msg = randomString();
    let baseline = 0;
    ch.assertQueue('', { exclusive: true }, (err, { queue }) => {
      assert.ifError(err);
      while (ch.sendToQueue(queue, Buffer.from(msg))) {
        baseline++;
      }
      channelOptions.highWaterMark = baseline * 2;
      done();
    });
  });

  channel_test('set high watermark', channelOptions, (_ch, done) => {
    ch = _ch;
    const msg = randomString();
    ch.assertQueue('', { exclusive: true }, (err, { queue }) => {
      assert.ifError(err);
      let ok;
      for (let i = 0; i < channelOptions.highWaterMark; i++) {
        ok = ch.sendToQueue(queue, Buffer.from(msg));
        assert.equal(ok, true);
      }
      done();
    });
  });
});

describe('ConfirmChannel', () => {

  let ch;

  afterEach((_t, done) => {
    ch?.connection?.close(done);
  });

  confirm_channel_test('Receive confirmation', (_ch, done) => {
    ch = _ch;
    // An unroutable message, on the basis that you're not allowed a
    // queue with an empty name, and you can't make bindings to the
    // default exchange. Tricky eh?
    ch.publish('', '', Buffer.from('foo'), {}, done);
  });

  confirm_channel_test('Wait for confirms', (_ch, done) => {
    ch = _ch;
    for (let i = 0; i < 1000; i++) {
      ch.publish('', '', Buffer.from('foo'), {});
    }
    ch.waitForConfirms(done);
  });

  const channelOptions = {};

  confirm_channel_test('find high watermark', (_ch, done) => {
    ch = _ch;
    const msg = randomString();
    let baseline = 0;
    ch.assertQueue('', { exclusive: true }, (err, { queue }) => {
      assert.ifError(err);
      while (ch.sendToQueue(queue, Buffer.from(msg))) {
        baseline++;
      }
      channelOptions.highWaterMark = baseline * 2;
      done();
    });
  });

  confirm_channel_test('set high watermark', channelOptions, (_ch, done) => {
    ch = _ch;
    const msg = randomString();
    ch.assertQueue('', { exclusive: true }, (err, { queue }) => {
      assert.ifError(err);
      let ok;
      for (let i = 0; i < channelOptions.highWaterMark; i++) {
        ok = ch.sendToQueue(queue, Buffer.from(msg));
        assert.equal(ok, true);
      }
      done();
    });
  });
});

describe('Error handling', () => {

  let c;

  afterEach((_t, done) => {
    c?.close(() => done());
  })

  it('Throw error in connection open callback', (_t, done) => {
    const dom = domain.createDomain();
    dom.on('error', (err) => {
      assert.match(err.message, /Spurious connection open callback error/);
      done();
    });
    connect(dom.bind((_err, _c) => {
      c = _c;
      throw new Error('Spurious connection open callback error');
    }));
  });

  function error_test(name, fun) {
    it(name, (_t, done) => {
      const dom = domain.createDomain();
      dom.run(() => {
        connect((err, _c) => {
          assert.ifError(err);
          c = _c;
          // Seems like there were some unironed wrinkles in 0.8's
          // implementation of domains; explicitly adding the connection
          // to the domain makes sure any exception thrown in the course
          // of processing frames is handled by the domain. For other
          // versions of Node.JS, this ends up being belt-and-braces.
          dom.add(c);
          c.createChannel((_err, ch) => {
            fun(ch, done, dom);
          });
        });
      });
    });
  }

  error_test('Channel open callback throws an error', (_ch, done, dom) => {
    dom.on('error', (err) => {
      assert.match(err.message, /Error in open callback/)
      done();
    });
    throw new Error('Error in open callback');
  });

  error_test('RPC callback throws error', (ch, done, dom) => {
    dom.on('error', (err) => {
      assert.match(err.message, /Spurious callback error/)
      done();
    });
    ch.prefetch(0, false, (_err, _ok) => {
      throw new Error('Spurious callback error');
    });
  });

  error_test('Get callback throws error', (ch, done, dom) => {
    dom.on('error', (err) => {
      assert.match(err.message, /Spurious callback error/)
      done();
    });
    ch.assertQueue('test.cb.get-with-error', {}, (_err, _ok) => {
      ch.get('test.cb.get-with-error', { noAck: true }, () => {
        throw new Error('Spurious callback error');
      });
    });
  });

  error_test('Consume callback throws error', (ch, done, dom) => {
    dom.on('error', (err) => {
      assert.match(err.message, /Spurious callback error/)
      done();
    });
    ch.assertQueue('test.cb.consume-with-error', {}, (_err, _ok) => {
      ch.consume('test.cb.consume-with-error', ignore, { noAck: true }, () => {
        throw new Error('Spurious callback error');
      });
    });
  });

  /*
  When this test was refactored as part of the move to the node test framework
  it failed because only the domain error handler was ever invoked and not the
  channel.get error callback.

  The original test passed because twice.first short circuits on error rather
  than waiting for twice.second to be invoked. I have verified that the pre-refactored
  amqplib does not invoke the channel.get callback when the queue does not exist.
  See lib/callback_model.js
  */
  error_test('Get from non-queue invokes error', (ch, done, dom) => {
    const both = twice(() => done());
    dom.on('error', (err) => {
      assert.match(err.message, /404 \(NOT-FOUND\)/);
      both.first(err);
    });
    ch.get('', {}, (err) => {
      assert.match(err.message, /404 \(NOT-FOUND\)/)
      both.second(err)
    });
  });

  /*
  When this test was refactored as part of the move to the node test framework
  it failed because only the domain error handler was ever invoked and not the
  channel.consume error callback. Unlike the above channel.get test,
  channel.consume does invoke the channel.consume callback with an error, but
  the original test did not supply one, mistakenly providing a message handler
  function instead.

  The original test passed because twice.first short circuits on error
  rather than waiting for twice.second to be invoked.
  */
  error_test('Consume from non-queue invokes error', (ch, done, dom) => {
    const both = twice((_err) => done());
    dom.on('error', (err) => {
      assert.match(err.message, /404 \(NOT-FOUND\)/);
      both.first(err);
    });
    ch.consume('', () => { }, {}, (err) => {
      assert.match(err.message, /404 \(NOT-FOUND\)/)
      both.second(err)
    });
  });
});
