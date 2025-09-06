const assert = require('node:assert');
const api = require('../channel_api');
const util = require('./util');
const succeed = util.succeed;
const fail = util.fail;
const schedule = util.schedule;
const randomString = util.randomString;
const promisify = require('node:util').promisify;

const URL = process.env.URL || 'amqp://localhost';

function connect() {
  return api.connect(URL);
}

// Expect this promise to fail, and flip the results accordingly.
function expectFail(promise) {
  return new Promise((resolve, reject) => promise.then(reject).catch(resolve));
}

// I'll rely on operations being rejected, rather than the channel
// close error, to detect failure.
function ignore() {}
function ignoreErrors(c) {
  c.on('error', ignore);
  return c;
}
function logErrors(c) {
  c.on('error', console.warn);
  return c;
}

// Run a test with `name`, given a function that takes an open
// channel, and returns a promise that is resolved on test success or
// rejected on test failure.
function channel_test(chmethod, name, chfun) {
  test(name, (done) => {
    connect(URL)
      .then(logErrors)
      .then((c) => {
        c[chmethod]()
          .then(ignoreErrors)
          .then(chfun)
          .then(succeed(done), fail(done))
          // close the connection regardless of what happens with the test
          .finally(() => {
            c.close();
          });
      });
  });
}

const chtest = channel_test.bind(null, 'createChannel');

suite('connect', () => {
  test('at all', (done) => {
    connect(URL)
      .then((c) => c.close())
      .then(succeed(done), fail(done));
  });

  chtest('create channel', ignore); // i.e., just don't bork
});

suite('updateSecret', () => {
  test('updateSecret', (done) => {
    connect().then((c) => {
      c.updateSecret(Buffer.from('new secret'), 'no reason')
        .then(succeed(done), fail(done))
        .finally(() => {
          c.close();
        });
    });
  });
});

const QUEUE_OPTS = {durable: false};
const EX_OPTS = {durable: false};

suite('assert, check, delete', () => {
  chtest('assert and check queue', (ch) =>
    ch.assertQueue('test.check-queue', QUEUE_OPTS).then((_qok) => ch.checkQueue('test.check-queue')),
  );

  chtest('assert and check exchange', (ch) =>
    ch.assertExchange('test.check-exchange', 'direct', EX_OPTS).then((eok) => {
      assert.equal('test.check-exchange', eok.exchange);
      return ch.checkExchange('test.check-exchange');
    }),
  );

  chtest('fail on reasserting queue with different options', (ch) => {
    const q = 'test.reassert-queue';
    return ch.assertQueue(q, {durable: false, autoDelete: true})
      .then(() => expectFail(ch.assertQueue(q, {durable: false, autoDelete: false})));
  });

  chtest("fail on checking a queue that's not there", (ch) => expectFail(ch.checkQueue(`test.random-${randomString()}`)));

  chtest("fail on checking an exchange that's not there", (ch) => expectFail(ch.checkExchange(`test.random-${randomString()}`)));

  chtest('fail on reasserting exchange with different type', (ch) => {
    const ex = 'test.reassert-ex';
    return ch.assertExchange(ex, 'fanout', EX_OPTS).then(() => expectFail(ch.assertExchange(ex, 'direct', EX_OPTS)));
  });

  chtest('channel break on publishing to non-exchange', (ch) => new Promise((resolve) => {
    ch.on('error', resolve);
    ch.publish(randomString(), '', Buffer.from('foobar'));
  }));

  chtest('delete queue', (ch) => {
    const q = 'test.delete-queue';
    return Promise.all([ch.assertQueue(q, QUEUE_OPTS), ch.checkQueue(q)])
      .then(() => ch.deleteQueue(q))
      .then(() => expectFail(ch.checkQueue(q)));
  });

  chtest('delete exchange', (ch) => {
    const ex = 'test.delete-exchange';
    return Promise.all([ch.assertExchange(ex, 'fanout', EX_OPTS), ch.checkExchange(ex)])
      .then(() => ch.deleteExchange(ex))
      .then(() => expectFail(ch.checkExchange(ex)));
  });
});

// Wait for the queue to meet the condition; useful for waiting for
// messages to arrive, for example.
function waitForQueue(q, condition) {
  return connect(URL).then((c) =>
    c.createChannel().then((ch) =>
      ch.checkQueue(q).then((_qok) => {
        function check() {
          return ch.checkQueue(q).then((qok) => {
            if (condition(qok)) {
              c.close();
              return qok;
            } else schedule(check);
          });
        }
        return check();
      }),
    ),
  );
}

// Return a promise that resolves when the queue has at least `num`
// messages. If num is not supplied its assumed to be 1.
function waitForMessages(q, num) {
  const min = num === undefined ? 1 : num;
  return waitForQueue(q, (qok) => qok.messageCount >= min);
}

suite('sendMessage', () => {
  // publish different size messages
  chtest('send to queue and get from queue', (ch) => {
    const q = 'test.send-to-q';
    const msg = randomString();
    return Promise.all([ch.assertQueue(q, QUEUE_OPTS), ch.purgeQueue(q)])
      .then(() => {
        ch.sendToQueue(q, Buffer.from(msg));
        return waitForMessages(q);
      })
      .then(() => ch.get(q, {noAck: true}))
      .then((m) => {
        assert(m);
        assert.equal(msg, m.content.toString());
      });
  });

  chtest('send (and get) zero content to queue', (ch) => {
    const q = 'test.send-to-q';
    const msg = Buffer.alloc(0);
    return Promise.all([ch.assertQueue(q, QUEUE_OPTS), ch.purgeQueue(q)])
      .then(() => {
        ch.sendToQueue(q, msg);
        return waitForMessages(q);
      })
      .then(() => ch.get(q, {noAck: true}))
      .then((m) => {
        assert(m);
        assert.deepEqual(msg, m.content);
      });
  });
});

suite('binding, consuming', () => {
  // bind, publish, get
  chtest('route message', (ch) => {
    const ex = 'test.route-message';
    const q = 'test.route-message-q';
    const msg = randomString();

    return Promise.all([
      ch.assertExchange(ex, 'fanout', EX_OPTS),
      ch.assertQueue(q, QUEUE_OPTS),
      ch.purgeQueue(q),
      ch.bindQueue(q, ex, '', {}),
    ])
      .then(() => {
        ch.publish(ex, '', Buffer.from(msg));
        return waitForMessages(q);
      })
      .then(() => ch.get(q, {noAck: true}))
      .then((m) => {
        assert(m);
        assert.equal(msg, m.content.toString());
      });
  });

  // send to queue, purge, get-empty
  chtest('purge queue', (ch) => {
    const q = 'test.purge-queue';
    return ch
      .assertQueue(q, {durable: false})
      .then(() => {
        ch.sendToQueue(q, Buffer.from('foobar'));
        return waitForMessages(q);
      })
      .then(() => {
        ch.purgeQueue(q);
        return ch.get(q, {noAck: true});
      })
      .then((m) => {
        assert(!m); // get-empty
      });
  });

  // bind again, unbind, publish, get-empty
  chtest('unbind queue', (ch) => {
    const ex = 'test.unbind-queue-ex';
    const q = 'test.unbind-queue';
    const viabinding = randomString();
    const direct = randomString();

    return Promise.all([
      ch.assertExchange(ex, 'fanout', EX_OPTS),
      ch.assertQueue(q, QUEUE_OPTS),
      ch.purgeQueue(q),
      ch.bindQueue(q, ex, '', {}),
    ])
      .then(() => {
        ch.publish(ex, '', Buffer.from('foobar'));
        return waitForMessages(q);
      })
      .then(() => {
        // message got through!
        return ch.get(q, {noAck: true}).then((m) => {
          assert(m);
        });
      })
      .then(() => ch.unbindQueue(q, ex, '', {}))
      .then(() => {
        // via the no-longer-existing binding
        ch.publish(ex, '', Buffer.from(viabinding));
        // direct to the queue
        ch.sendToQueue(q, Buffer.from(direct));
        return waitForMessages(q);
      })
      .then(() => ch.get(q))
      .then((m) => {
        // the direct to queue message got through, the via-binding
        // message (sent first) did not
        assert.equal(direct, m.content.toString());
      });
  });

  // To some extent this is now just testing semantics of the server,
  // but we can at least try out a few settings, and consume.
  chtest('consume via exchange-exchange binding', (ch) => {
    const ex1 = 'test.ex-ex-binding1';
    const ex2 = 'test.ex-ex-binding2';
    const q = 'test.ex-ex-binding-q';
    const rk = 'test.routing.key';
    const msg = randomString();
    return Promise.all([
      ch.assertExchange(ex1, 'direct', EX_OPTS),
      ch.assertExchange(ex2, 'fanout', {durable: false, internal: true}),
      ch.assertQueue(q, QUEUE_OPTS),
      ch.purgeQueue(q),
      ch.bindExchange(ex2, ex1, rk, {}),
      ch.bindQueue(q, ex2, '', {}),
    ]).then(
      () =>
        new Promise((resolve, reject) => {
          function delivery(m) {
            if (m.content.toString() === msg) resolve();
            else reject(new Error('Wrong message'));
          }
          ch.consume(q, delivery, {noAck: true}).then(() => {
            ch.publish(ex1, rk, Buffer.from(msg));
          });
        }),
    );
  });

  // bind again, unbind, publish, get-empty
  chtest('unbind exchange', (ch) => {
    const source = 'test.unbind-ex-source';
    const dest = 'test.unbind-ex-dest';
    const q = 'test.unbind-ex-queue';
    const viabinding = randomString();
    const direct = randomString();

    return Promise.all([
      ch.assertExchange(source, 'fanout', EX_OPTS),
      ch.assertExchange(dest, 'fanout', EX_OPTS),
      ch.assertQueue(q, QUEUE_OPTS),
      ch.purgeQueue(q),
      ch.bindExchange(dest, source, '', {}),
      ch.bindQueue(q, dest, '', {}),
    ])
      .then(() => {
        ch.publish(source, '', Buffer.from('foobar'));
        return waitForMessages(q);
      })
      .then(() => {
        // message got through!
        return ch.get(q, {noAck: true}).then((m) => {
          assert(m);
        });
      })
      .then(() => ch.unbindExchange(dest, source, '', {}))
      .then(() => {
        // via the no-longer-existing binding
        ch.publish(source, '', Buffer.from(viabinding));
        // direct to the queue
        ch.sendToQueue(q, Buffer.from(direct));
        return waitForMessages(q);
      })
      .then(() => ch.get(q))
      .then((m) => {
        // the direct to queue message got through, the via-binding
        // message (sent first) did not
        assert.equal(direct, m.content.toString());
      });
  });

  // This is a bit convoluted. Sorry.
  chtest('cancel consumer', (ch) => {
    const q = 'test.consumer-cancel';
    let ctag;
    const recv1 = new Promise((resolve, _reject) => {
      Promise.all([
        ch.assertQueue(q, QUEUE_OPTS),
        ch.purgeQueue(q),
        // My callback is 'resolve the promise in `arrived`'
        ch
          .consume(q, resolve, {noAck: true})
          .then((ok) => {
            ctag = ok.consumerTag;
            ch.sendToQueue(q, Buffer.from('foo'));
          }),
      ]);
    });

    // A message should arrive because of the consume
    return recv1.then(() => {
      const recv2 = Promise.all([
        ch.cancel(ctag).then(() => ch.sendToQueue(q, Buffer.from('bar'))),
        // but check a message did arrive in the queue
        waitForMessages(q),
      ])
        .then(() => ch.get(q, {noAck: true}))
        .then((m) => {
          // I'm going to reject it, because I flip succeed/fail
          // just below
          if (m.content.toString() === 'bar') {
            throw new Error();
          }
        });

      return expectFail(recv2);
    });
  });

  chtest('cancelled consumer', (ch) => {
    const q = 'test.cancelled-consumer';
    return new Promise((resolve, reject) =>
      Promise.all([
        ch.assertQueue(q),
        ch.purgeQueue(q),
        ch.consume(q, (msg) => {
          if (msg === null) resolve();
          else reject(new Error('Message not expected'));
        }),
      ]).then(() => ch.deleteQueue(q)),
    );
  });

  // ack, by default, removes a single message from the queue
  chtest('ack', (ch) => {
    const q = 'test.ack';
    const msg1 = randomString();
    const msg2 = randomString();

    return Promise.all([ch.assertQueue(q, QUEUE_OPTS), ch.purgeQueue(q)])
      .then(() => {
        ch.sendToQueue(q, Buffer.from(msg1));
        ch.sendToQueue(q, Buffer.from(msg2));
        return waitForMessages(q, 2);
      })
      .then(() => ch.get(q, {noAck: false}))
      .then((m) => {
        assert.equal(msg1, m.content.toString());
        ch.ack(m);
        // %%% is there a race here? may depend on
        // rabbitmq-sepcific semantics
        return ch.get(q);
      })
      .then((m) => {
        assert(m);
        assert.equal(msg2, m.content.toString());
      });
  });

  // Nack, by default, puts a message back on the queue (where in the
  // queue is up to the server)
  chtest('nack', (ch) => {
    const q = 'test.nack';
    const msg1 = randomString();

    return Promise.all([ch.assertQueue(q, QUEUE_OPTS), ch.purgeQueue(q)])
      .then(() => {
        ch.sendToQueue(q, Buffer.from(msg1));
        return waitForMessages(q);
      })
      .then(() => ch.get(q, {noAck: false}))
      .then((m) => {
        assert.equal(msg1, m.content.toString());
        ch.nack(m);
        return waitForMessages(q);
      })
      .then(() => ch.get(q))
      .then((m) => {
        assert(m);
        assert.equal(msg1, m.content.toString());
      });
  });

  // reject is a near-synonym for nack, the latter of which is not
  // available in earlier RabbitMQ (or in AMQP proper).
  chtest('reject', (ch) => {
    const q = 'test.reject';
    const msg1 = randomString();

    return Promise.all([ch.assertQueue(q, QUEUE_OPTS), ch.purgeQueue(q)])
      .then(() => {
        ch.sendToQueue(q, Buffer.from(msg1));
        return waitForMessages(q);
      })
      .then(() => ch.get(q, {noAck: false}))
      .then((m) => {
        assert.equal(msg1, m.content.toString());
        ch.reject(m);
        return waitForMessages(q);
      })
      .then(() => ch.get(q))
      .then((m) => {
        assert(m);
        assert.equal(msg1, m.content.toString());
      });
  });

  chtest('prefetch', (ch) => {
    const q = 'test.prefetch';
    return Promise.all([ch.assertQueue(q, QUEUE_OPTS), ch.purgeQueue(q), ch.prefetch(1)])
      .then(() => {
        ch.sendToQueue(q, Buffer.from('foobar'));
        ch.sendToQueue(q, Buffer.from('foobar'));
        return waitForMessages(q, 2);
      })
      .then(
        () =>
          new Promise((resolve) => {
            let messageCount = 0;
            function receive(msg) {
              ch.ack(msg);
              if (++messageCount > 1) {
                resolve(messageCount);
              }
            }
            return ch.consume(q, receive, {noAck: false});
          }),
      )
      .then((c) => assert.equal(2, c));
  });

  chtest('close', (ch) => {
    // Resolving promise guarantees
    // channel is closed
    return ch.close();
  });
});

const confirmtest = channel_test.bind(null, 'createConfirmChannel');

suite('confirms', () => {
  confirmtest('message is confirmed', (ch) => {
    const q = 'test.confirm-message';
    return Promise.all([ch.assertQueue(q, QUEUE_OPTS), ch.purgeQueue(q)]).then(() => ch.sendToQueue(q, Buffer.from('bleep')));
  });

  // Usually one can provoke the server into confirming more than one
  // message in an ack by simply sending a few messages in quick
  // succession; a bit unscientific I know. Luckily we can eavesdrop on
  // the acknowledgements coming through to see if we really did get a
  // multi-ack.
  confirmtest('multiple confirms', (ch) => {
    const q = 'test.multiple-confirms';
    return Promise.all([ch.assertQueue(q, QUEUE_OPTS), ch.purgeQueue(q)]).then(() => {
      let multipleRainbows = false;
      ch.on('ack', (a) => {
        if (a.multiple) multipleRainbows = true;
      });

      function prod(num) {
        const cs = [];

        function sendAndPushPromise() {
          const conf = promisify((cb) => ch.sendToQueue(q, Buffer.from('bleep'), {}, cb))();
          cs.push(conf);
        }

        for (let i = 0; i < num; i++) sendAndPushPromise();

        return Promise.all(cs).then(() => {
          if (multipleRainbows) return true;
          else if (num > 500) throw new Error(`Couldn't provoke the server into multi-acking with ${num} messages; giving up`);
          else {
            //console.warn("Failed with " + num + "; trying " + num * 2);
            return prod(num * 2);
          }
        });
      }
      return prod(5);
    });
  });

  confirmtest('wait for confirms', (ch) => {
    for (let i = 0; i < 1000; i++) {
      ch.publish('', '', Buffer.from('foobar'), {});
    }
    return ch.waitForConfirms();
  });

  confirmtest('works when channel is closed', (ch) => {
    for (let i = 0; i < 1000; i++) {
      ch.publish('', '', Buffer.from('foobar'), {});
    }
    return ch
      .close()
      .then(() => ch.waitForConfirms())
      .then(
        () => {
          assert.strictEqual(true, false, 'Wait should have failed.');
        },
        (e) => {
          assert.strictEqual(e.message, 'channel closed');
        },
      );
  });
});
