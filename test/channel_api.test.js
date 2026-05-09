const { describe, it } = require('node:test');
const assert = require('node:assert');
const api = require('../channel_api');
const util = require('./lib/util');
const schedule = util.schedule;
const randomString = util.randomString;
const promisify = require('node:util').promisify;

const URL = process.env.URL || 'amqp://localhost';
const QUEUE_OPTS = { durable: false };
const EX_OPTS = { durable: false };

function ignore() {}

describe('connect', () => {
  it('at all', () => connect().then((c) => c.close()));

  it('create channel', () => withChannel(ignore));
});

describe('updateSecret', () => {
  it('updateSecret', () => {
    return connect().then((c) =>
      c.updateSecret(Buffer.from('new secret'), 'no reason')
        .finally(() => c.close())
    );
  });

  it('emits update-secret-ok event', () => {
    return connect().then((c) =>
      new Promise((resolve, reject) => {
        c.on('update-secret-ok', resolve);
        c.updateSecret(Buffer.from('new secret'), 'no reason').catch(reject);
      }).finally(() => c.close())
    );
  });
});

describe('assert, check, delete', () => {
  it('assert and check queue', () => {
    return withChannel((ch) => {
      return ch.assertQueue('test.check-queue', QUEUE_OPTS)
        .then((qok) => assert.strictEqual(qok.queue, 'test.check-queue'))
        .then(() => ch.checkQueue('test.check-queue'))
        .then((qok) => assert.strictEqual(qok.queue, 'test.check-queue'))
    });
  });

  it('assert and check exchange', () => {
    return withChannel((ch) => {
      return ch.assertExchange('test.check-exchange', 'direct', EX_OPTS)
        .then((eok) => assert.strictEqual(eok.exchange, 'test.check-exchange'))
        .then(() => ch.checkExchange('test.check-exchange'))
        .then((eok) => assert.ok(eok));
    });
  });

  it('fail on reasserting queue with different options', () => {
    return withChannel((ch) => {
      ch.once('error', ignore);
      return ch.assertQueue('test.reassert-queue', { durable: false, autoDelete: true })
        .then(() => assert.rejects(() => ch.assertQueue('test.reassert-queue', { durable: false, autoDelete: false }), (err) => {
          assert.match(err.message, /PRECONDITION_FAILED/);
          assert.strictEqual(406, err.code);
          assert.strictEqual(50, err.classId);
          assert.strictEqual(10, err.methodId);
          return true;
        }));
    });
  });

  it("fail on checking a queue that's not there", () => {
    return withChannel((ch) => {
      ch.once('error', ignore);
      return assert.rejects(() => ch.checkQueue(`test.random-${randomString()}`), (err) => {
        assert.match(err.message, /NOT_FOUND/);
        assert.strictEqual(404, err.code);
        assert.strictEqual(50, err.classId);
        assert.strictEqual(10, err.methodId);
        return true;
      });
    });
  });

  it("fail on checking an exchange that's not there", () => {
    return withChannel((ch) => {
      ch.once('error', ignore);
      return assert.rejects(() => ch.checkExchange(`test.random-${randomString()}`), (err) => {
        assert.match(err.message, /NOT_FOUND/);
        assert.strictEqual(404, err.code);
        return true;
      });
    });
  });

  it('fail on reasserting exchange with different type', () => {
    return withChannel((ch) => {
      ch.once('error', ignore);
      const ex = 'test.reassert-ex';
      return ch.assertExchange(ex, 'fanout', EX_OPTS)
        .then(() => assert.rejects(() => ch.assertExchange(ex, 'direct', EX_OPTS), (err) => {
          assert.match(err.message, /PRECONDITION_FAILED/);
          assert.strictEqual(406, err.code);
          return true;
        }));
    });
  });

  it('channel break on publishing to non-exchange', () => {
    return withChannel((ch) =>
      new Promise((resolve) => {
        ch.once('error', (err) => {
          assert.match(err.message, /NOT_FOUND/);
          assert.strictEqual(404, err.code);
          resolve();
        });
        ch.publish(randomString(), '', Buffer.from('foobar'));
      })
    );
  });

  it('delete queue', () => {
    return withChannel((ch) => {
      return ch.assertQueue('test.delete-queue', QUEUE_OPTS)
        .then(() => ch.deleteQueue('test.delete-queue'))
        .then(() => {
          ch.once('error', ignore);
          return assert.rejects(() => ch.checkQueue('test.delete-queue'), (err) => {
            assert.match(err.message, /NOT_FOUND/);
            assert.strictEqual(404, err.code);
            return true;
          });
        });
    });
  });

  it('delete exchange', () => {
    return withChannel((ch) => {
      return ch.assertExchange('test.delete-exchange', 'fanout', EX_OPTS)
        .then(() => ch.deleteExchange('test.delete-exchange'))
        .then(() => {
          ch.once('error', ignore);
          return assert.rejects(() => ch.checkExchange('test.delete-exchange'), (err) => {
            assert.match(err.message, /NOT_FOUND/);
            assert.strictEqual(404, err.code);
            return true;
          });
        });
    });
  });
});

describe('sendMessage', () => {
  it('send to queue and get from queue', () => {
    const msg = randomString();
    return withChannel((ch) =>
      ch.assertQueue('test.send-to-q', QUEUE_OPTS)
        .then(() => ch.purgeQueue('test.send-to-q'))
        .then(() => {
          ch.sendToQueue('test.send-to-q', Buffer.from(msg));
          return waitForMessages('test.send-to-q');
        })
        .then(() => ch.get('test.send-to-q', { noAck: true }))
        .then((m) => {
          assert(m);
          assert.equal(msg, m.content.toString());
        })
    );
  });

  it('send (and get) zero content to queue', () => {
    return withChannel((ch) =>
      ch.assertQueue('test.send-to-q', QUEUE_OPTS)
        .then(() => ch.purgeQueue('test.send-to-q'))
        .then(() => {
          ch.sendToQueue('test.send-to-q', Buffer.alloc(0));
          return waitForMessages('test.send-to-q');
        })
        .then(() => ch.get('test.send-to-q', { noAck: true }))
        .then((m) => {
          assert(m);
          assert.deepEqual(Buffer.alloc(0), m.content);
        })
    );
  });
});

describe('get', () => {
  it('returns false when queue is empty', () => {
    return withChannel((ch) =>
      ch.assertQueue('test.get-empty', QUEUE_OPTS)
        .then(() => ch.purgeQueue('test.get-empty'))
        .then(() => ch.get('test.get-empty', { noAck: true }))
        .then((m) => assert.strictEqual(false, m))
    );
  });

  it('returns a message when queue has messages', () => {
    const msg = randomString();
    return withChannel((ch) =>
      ch.assertQueue('test.get-message', QUEUE_OPTS)
        .then(() => ch.purgeQueue('test.get-message'))
        .then(() => {
          ch.sendToQueue('test.get-message', Buffer.from(msg));
          return waitForMessages('test.get-message');
        })
        .then(() => ch.get('test.get-message', { noAck: true }))
        .then((m) => {
          assert(m);
          assert.equal(msg, m.content.toString());
        })
    );
  });

  it('rejects with a proper error when queue does not exist', () => {
    return withChannel((ch) => {
      ch.once('error', ignore);
      return assert.rejects(() => ch.get('', {}), (err) => {
        assert(err instanceof Error);
        assert.match(err.message, /NOT_FOUND/);
        assert.strictEqual(404, err.code);
        assert.strictEqual(60, err.classId);
        assert.strictEqual(70, err.methodId);
        return true;
      });
    });
  });
});

describe('binding, consuming', () => {
  // bind, publish, get
  it('route message', () => {
    const msg = randomString();
    return withChannel((ch) =>
      ch.assertExchange('test.route-message', 'fanout', EX_OPTS)
        .then(() => ch.assertQueue('test.route-message-q', QUEUE_OPTS))
        .then(() => ch.purgeQueue('test.route-message-q'))
        .then(() => ch.bindQueue('test.route-message-q', 'test.route-message', '', {}))
        .then(() => {
          ch.publish('test.route-message', '', Buffer.from(msg));
          return waitForMessages('test.route-message-q');
        })
        .then(() => ch.get('test.route-message-q', { noAck: true }))
        .then((m) => {
          assert(m);
          assert.equal(msg, m.content.toString());
        })
    );
  });

  // send to queue, purge, get-empty
  it('purge queue', () => {
    return withChannel((ch) =>
      ch.assertQueue('test.purge-queue', QUEUE_OPTS)
        .then(() => {
          ch.sendToQueue('test.purge-queue', Buffer.from('foobar'));
          return waitForMessages('test.purge-queue');
        })
        .then(() => ch.purgeQueue('test.purge-queue'))
        .then(() => ch.get('test.purge-queue', { noAck: true }))
        .then((m) => {
          assert(!m); // get-empty
        })
    );
  });

  // bind again, unbind, publish, get-empty
  it('unbind queue', () => {
    const viabinding = randomString();
    const direct = randomString();
    return withChannel((ch) =>
      ch.assertExchange('test.unbind-queue-ex', 'fanout', EX_OPTS)
        .then(() => ch.assertQueue('test.unbind-queue', QUEUE_OPTS))
        .then(() => ch.purgeQueue('test.unbind-queue'))
        .then(() => ch.bindQueue('test.unbind-queue', 'test.unbind-queue-ex', '', {}))
        .then(() => {
          ch.publish('test.unbind-queue-ex', '', Buffer.from('foobar'));
          return waitForMessages('test.unbind-queue');
        })
        .then(() => ch.get('test.unbind-queue', { noAck: true }))
        .then((m) => assert(m)) // message got through!
        .then(() => ch.unbindQueue('test.unbind-queue', 'test.unbind-queue-ex', '', {}))
        .then(() => {
          // via the no-longer-existing binding
          ch.publish('test.unbind-queue-ex', '', Buffer.from(viabinding));
          // direct to the queue
          ch.sendToQueue('test.unbind-queue', Buffer.from(direct));
          return waitForMessages('test.unbind-queue');
        })
        .then(() => ch.get('test.unbind-queue'))
        .then((m) => {
          // the direct to queue message got through, the via-binding message (sent first) did not
          assert.equal(direct, m.content.toString());
        })
    );
  });

  // To some extent this is now just testing semantics of the server,
  // but we can at least try out a few settings, and consume.
  it('consume via exchange-exchange binding', () => {
    const msg = randomString();
    return withChannel((ch) =>
      ch.assertExchange('test.ex-ex-binding1', 'direct', EX_OPTS)
        .then(() => ch.assertExchange('test.ex-ex-binding2', 'fanout', { durable: false, internal: true }))
        .then(() => ch.assertQueue('test.ex-ex-binding-q', QUEUE_OPTS))
        .then(() => ch.purgeQueue('test.ex-ex-binding-q'))
        .then(() => ch.bindExchange('test.ex-ex-binding2', 'test.ex-ex-binding1', 'test.routing.key', {}))
        .then(() => ch.bindQueue('test.ex-ex-binding-q', 'test.ex-ex-binding2', '', {}))
        .then(() => new Promise((resolve, reject) => {
          ch.consume('test.ex-ex-binding-q', (m) => {
            if (m.content.toString() === msg) resolve();
            else reject(new Error('Wrong message'));
          }, { noAck: true }).then(() => {
            ch.publish('test.ex-ex-binding1', 'test.routing.key', Buffer.from(msg));
          });
        }))
    );
  });

  // bind again, unbind, publish, get-empty
  it('unbind exchange', () => {
    const viabinding = randomString();
    const direct = randomString();
    return withChannel((ch) =>
      ch.assertExchange('test.unbind-ex-source', 'fanout', EX_OPTS)
        .then(() => ch.assertExchange('test.unbind-ex-dest', 'fanout', EX_OPTS))
        .then(() => ch.assertQueue('test.unbind-ex-queue', QUEUE_OPTS))
        .then(() => ch.purgeQueue('test.unbind-ex-queue'))
        .then(() => ch.bindExchange('test.unbind-ex-dest', 'test.unbind-ex-source', '', {}))
        .then(() => ch.bindQueue('test.unbind-ex-queue', 'test.unbind-ex-dest', '', {}))
        .then(() => {
          ch.publish('test.unbind-ex-source', '', Buffer.from('foobar'));
          return waitForMessages('test.unbind-ex-queue');
        })
        .then(() => ch.get('test.unbind-ex-queue', { noAck: true }))
        .then((m) => assert(m)) // message got through!
        .then(() => ch.unbindExchange('test.unbind-ex-dest', 'test.unbind-ex-source', '', {}))
        .then(() => {
          // via the no-longer-existing binding
          ch.publish('test.unbind-ex-source', '', Buffer.from(viabinding));
          // direct to the queue
          ch.sendToQueue('test.unbind-ex-queue', Buffer.from(direct));
          return waitForMessages('test.unbind-ex-queue');
        })
        .then(() => ch.get('test.unbind-ex-queue'))
        .then((m) => {
          // the direct to queue message got through, the via-binding message (sent first) did not
          assert.equal(direct, m.content.toString());
        })
    );
  });

  it('cancel consumer', () => {
    let ctag;
    return withChannel((ch) =>
      ch.assertQueue('test.consumer-cancel', QUEUE_OPTS)
        .then(() => ch.purgeQueue('test.consumer-cancel'))
        .then(() => new Promise((resolve) => {
          ch.consume('test.consumer-cancel', resolve, { noAck: true })
            .then((ok) => {
              ctag = ok.consumerTag;
              ch.sendToQueue('test.consumer-cancel', Buffer.from('foo'));
            });
        }))
        // first message arrived via consumer
        .then(() => ch.cancel(ctag))
        .then(() => {
          ch.sendToQueue('test.consumer-cancel', Buffer.from('bar'));
          return waitForMessages('test.consumer-cancel');
        })
        .then(() => ch.get('test.consumer-cancel', { noAck: true }))
        .then((m) => {
          // message arrived in queue but NOT via the cancelled consumer
          assert.equal('bar', m.content.toString());
        })
    );
  });

  it('cancelled consumer', () => {
    return withChannel((ch) =>
      ch.assertQueue('test.cancelled-consumer')
        .then(() => ch.purgeQueue('test.cancelled-consumer'))
        .then(() => new Promise((resolve, reject) => {
          ch.consume('test.cancelled-consumer', (msg) => {
            if (msg === null) resolve();
            else reject(new Error('Message not expected'));
          }).then(() => ch.deleteQueue('test.cancelled-consumer'));
        }))
    );
  });

  // ack, by default, removes a single message from the queue
  it('ack', () => {
    const msg1 = randomString();
    const msg2 = randomString();
    return withChannel((ch) =>
      ch.assertQueue('test.ack', QUEUE_OPTS)
        .then(() => ch.purgeQueue('test.ack'))
        .then(() => {
          ch.sendToQueue('test.ack', Buffer.from(msg1));
          ch.sendToQueue('test.ack', Buffer.from(msg2));
          return waitForMessages('test.ack', 2);
        })
        .then(() => ch.get('test.ack', { noAck: false }))
        .then((m) => {
          assert.equal(msg1, m.content.toString());
          ch.ack(m);
          // %%% is there a race here? may depend on rabbitmq-specific semantics
          return ch.get('test.ack');
        })
        .then((m) => {
          assert(m);
          assert.equal(msg2, m.content.toString());
        })
    );
  });

  // Nack, by default, puts a message back on the queue (where in the queue is up to the server)
  it('nack', () => {
    const msg1 = randomString();
    return withChannel((ch) =>
      ch.assertQueue('test.nack', QUEUE_OPTS)
        .then(() => ch.purgeQueue('test.nack'))
        .then(() => {
          ch.sendToQueue('test.nack', Buffer.from(msg1));
          return waitForMessages('test.nack');
        })
        .then(() => ch.get('test.nack', { noAck: false }))
        .then((m) => {
          assert.equal(msg1, m.content.toString());
          ch.nack(m);
          return waitForMessages('test.nack');
        })
        .then(() => ch.get('test.nack'))
        .then((m) => {
          assert(m);
          assert.equal(msg1, m.content.toString());
        })
    );
  });

  // reject is a near-synonym for nack, the latter of which is not available in earlier RabbitMQ (or in AMQP proper).
  it('reject', () => {
    const msg1 = randomString();
    return withChannel((ch) =>
      ch.assertQueue('test.reject', QUEUE_OPTS)
        .then(() => ch.purgeQueue('test.reject'))
        .then(() => {
          ch.sendToQueue('test.reject', Buffer.from(msg1));
          return waitForMessages('test.reject');
        })
        .then(() => ch.get('test.reject', { noAck: false }))
        .then((m) => {
          assert.equal(msg1, m.content.toString());
          ch.reject(m);
          return waitForMessages('test.reject');
        })
        .then(() => ch.get('test.reject'))
        .then((m) => {
          assert(m);
          assert.equal(msg1, m.content.toString());
        })
    );
  });

  it('prefetch', () => {
    return withChannel((ch) =>
      ch.assertQueue('test.prefetch', QUEUE_OPTS)
        .then(() => ch.purgeQueue('test.prefetch'))
        .then(() => ch.prefetch(1))
        .then(() => {
          ch.sendToQueue('test.prefetch', Buffer.from('foobar'));
          ch.sendToQueue('test.prefetch', Buffer.from('foobar'));
          return waitForMessages('test.prefetch', 2);
        })
        .then(() => new Promise((resolve) => {
          let messageCount = 0;
          ch.consume('test.prefetch', (msg) => {
            ch.ack(msg);
            if (++messageCount > 1) resolve(messageCount);
          }, { noAck: false });
        }))
        .then((c) => assert.equal(2, c))
    );
  });

  it('close', () => {
    return withChannel((ch) => ch.close());
  });
});

describe('confirms', () => {
  it('message is confirmed', () => {
    return withConfirmChannel((ch) =>
      ch.assertQueue('test.confirm-message', QUEUE_OPTS)
        .then(() => ch.purgeQueue('test.confirm-message'))
        .then(() => ch.sendToQueue('test.confirm-message', Buffer.from('bleep')))
    );
  });

  // Usually one can provoke the server into confirming more than one
  // message in an ack by simply sending a few messages in quick
  // succession; a bit unscientific I know. Luckily we can eavesdrop on
  // the acknowledgements coming through to see if we really did get a
  // multi-ack.
  it('multiple confirms', () => {
    return withConfirmChannel((ch) =>
      ch.assertQueue('test.multiple-confirms', QUEUE_OPTS)
        .then(() => ch.purgeQueue('test.multiple-confirms'))
        .then(() => {
          let multipleRainbows = false;
          ch.on('ack', (a) => {
            if (a.multiple) multipleRainbows = true;
          });

          function prod(num) {
            const cs = [];
            for (let i = 0; i < num; i++) {
              cs.push(promisify((cb) => ch.sendToQueue('test.multiple-confirms', Buffer.from('bleep'), {}, cb))());
            }
            return Promise.all(cs).then(() => {
              if (multipleRainbows) return true;
              else if (num > 500) throw new Error(`Couldn't provoke the server into multi-acking with ${num} messages; giving up`);
              else return prod(num * 2);
            });
          }
          return prod(5);
        })
    );
  });

  it('wait for confirms', () => {
    return withConfirmChannel((ch) => {
      for (let i = 0; i < 1000; i++) {
        ch.publish('', '', Buffer.from('foobar'), {});
      }
      return ch.waitForConfirms();
    });
  });

  it('works when channel is closed', () => {
    return withConfirmChannel((ch) => {
      for (let i = 0; i < 1000; i++) {
        ch.publish('', '', Buffer.from('foobar'), {});
      }
      return ch.close()
        .then(() => assert.rejects(() => ch.waitForConfirms(), (e) => {
          assert.strictEqual(e.message, 'channel closed');
          return true;
        }));
    });
  });

  it('publish on closed channel does not leak callbacks', () => {
    return withConfirmChannel((ch) => {
      return ch.close().then(() => {
        for (let i = 0; i < 10; i++) {
          try { ch.publish('', '', Buffer.from('x'), {}, () => {}); } catch (_) {}
        }
        assert.strictEqual(ch.unconfirmed.length, 0);
      });
    });
  });
});

function connect() {
  return api.connect(URL);
}

function withChannel(cb) {
  return connect().then((c) => c.createChannel().then(cb).finally(() => c.close()));
}

function withConfirmChannel(cb) {
  return connect().then((c) => c.createConfirmChannel().then(cb).finally(() => c.close()));
}

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

function waitForMessages(q, num) {
  const min = num === undefined ? 1 : num;
  return waitForQueue(q, (qok) => qok.messageCount >= min);
}
