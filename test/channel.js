const assert = require('node:assert');
const promisify = require('node:util').promisify;
const Channel = require('../lib/channel').Channel;
const Connection = require('../lib/connection').Connection;
const util = require('./util');
const succeed = util.succeed;
const fail = util.fail;
const latch = util.latch;
const completes = util.completes;
const defs = require('../lib/defs');
const conn_handshake = require('./connection').connection_handshake;
const OPEN_OPTS = require('./connection').OPEN_OPTS;

const LOG_ERRORS = process.env.LOG_ERRORS;

function baseChannelTest(client, server) {
  return (done) => {
    const bothDone = latch(2, done);
    const pair = util.socketPair();
    const c = new Connection(pair.client);

    if (LOG_ERRORS) c.on('error', console.warn);

    c.open(OPEN_OPTS, (err, _ok) => {
      if (err === null) client(c, bothDone);
      else fail(bothDone);
    });

    pair.server.read(8); // discard the protocol header
    util.runServer(pair.server, (send, wait) => {
      conn_handshake(send, wait).then(() => {
        server(send, wait, bothDone);
      }, fail(bothDone));
    });
  };
}

function channelTest(client, server) {
  return baseChannelTest(
    (conn, done) => {
      const ch = new Channel(conn);
      if (LOG_ERRORS) ch.on('error', console.warn);
      client(ch, done, conn);
    },
    (send, wait, done) => {
      channel_handshake(send, wait)
        .then((ch) => server(send, wait, done, ch))
        .then(null, fail(done)); // so you can return a promise to let
      // errors bubble out
    },
  );
}

function channel_handshake(send, wait) {
  return wait(defs.ChannelOpen)().then((open) => {
    assert.notEqual(0, open.channel);
    send(defs.ChannelOpenOk, { channelId: Buffer.from('') }, open.channel);
    return open.channel;
  });
}

// fields for deliver and publish and get-ok
const DELIVER_FIELDS = {
  consumerTag: 'fake',
  deliveryTag: 1,
  redelivered: false,
  exchange: 'foo',
  routingKey: 'bar',
  replyCode: defs.constants.NO_ROUTE,
  replyText: 'derp',
};

function open(ch) {
  ch.allocate();
  return promisify((cb) => {
    ch._rpc(defs.ChannelOpen, { outOfBand: '' }, defs.ChannelOpenOk, cb);
  })();
}

describe('channel open and close', () => {
  it('open', channelTest(
    (ch, done) => {
      open(ch).then(succeed(done), fail(done));
    },
    (_send, _wait, done) => {
      done();
    }
  ));

  it('bad server', baseChannelTest((c, done) => {
    const ch = new Channel(c);
    open(ch).then(fail(done), succeed(done));
  }, (send, wait, done) =>
    wait(defs.ChannelOpen)()
      .then((open) => {
        send(defs.ChannelCloseOk, {}, open.channel);
      })
      .then(succeed(done), fail(done)))
  );

  it('open, close', channelTest((ch, done) => {
    open(ch)
      .then(() => new Promise((resolve) => {
        ch.closeBecause('Bye', defs.constants.REPLY_SUCCESS, resolve);
      }))
      .then(succeed(done), fail(done));
  }, (send, wait, done, ch) =>
    wait(defs.ChannelClose)()
      .then((_close) => {
        send(defs.ChannelCloseOk, {}, ch);
      })
      .then(succeed(done), fail(done)))
  );

  it('server close', channelTest((ch, done) => {
    ch.on('error', (error) => {
      assert.strictEqual(504, error.code);
      assert.strictEqual(0, error.classId);
      assert.strictEqual(0, error.methodId);
      succeed(done)();
    });
    open(ch);
  }, (send, wait, done, ch) => {
    send(defs.ChannelClose, {
      replyText: 'Forced close',
      replyCode: defs.constants.CHANNEL_ERROR,
      classId: 0,
      methodId: 0,
    }, ch);
    wait(defs.ChannelCloseOk)().then(succeed(done), fail(done));
  }));

  it('overlapping channel/server close', channelTest(
    (ch, done, conn) => {
      const both = latch(2, done);
      conn.on('error', succeed(both));
      ch.on('close', succeed(both));
      open(ch).then(() => {
        ch.closeBecause('Bye', defs.constants.REPLY_SUCCESS);
      }, fail(both));
    }, (send, wait, done, _ch) => {
      wait(defs.ChannelClose)()
        .then(() => {
          send(defs.ConnectionClose, {
            replyText: 'Got there first',
            replyCode: defs.constants.INTERNAL_ERROR,
            classId: 0,
            methodId: 0,
          }, 0);
        })
        .then(wait(defs.ConnectionCloseOk))
        .then(succeed(done), fail(done));
  }));

  it('double close', channelTest((ch, done) => {
    open(ch)
      .then(() => {
        ch.closeBecause('First close', defs.constants.REPLY_SUCCESS);
        // NB no synchronisation, we do this straight away
        assert.throws(() => {
          ch.closeBecause('Second close', defs.constants.REPLY_SUCCESS);
        });
      })
      .then(succeed(done), fail(done));
  }, (send, wait, done, ch) => {
    wait(defs.ChannelClose)()
    .then(() => {
      send(defs.ChannelCloseOk, {}, ch);
    }).then(succeed(done), fail(done));
  }));
});

describe('channel machinery', () => {
  it('RPC', channelTest((ch, done) => {
    const rpcLatch = latch(3, done);
    open(ch)
      .then(() => {
        function wheeboom(err, _f) {
          if (err !== null) rpcLatch(err);
          else rpcLatch();
        }

        const fields = {
          prefetchCount: 10,
          prefetchSize: 0,
          global: false,
        };

        ch._rpc(defs.BasicQos, fields, defs.BasicQosOk, wheeboom);
        ch._rpc(defs.BasicQos, fields, defs.BasicQosOk, wheeboom);
        ch._rpc(defs.BasicQos, fields, defs.BasicQosOk, wheeboom);
      })
      .then(null, fail(rpcLatch));
    }, (send, wait, done, ch) => {
      function sendOk(_f) {
        send(defs.BasicQosOk, {}, ch);
      }

      return wait(defs.BasicQos)()
        .then(sendOk)
        .then(wait(defs.BasicQos))
        .then(sendOk)
        .then(wait(defs.BasicQos))
        .then(sendOk)
        .then(succeed(done), fail(done));
  }));

  it('Bad RPC', channelTest(
    (ch, done) => {
      // We want to see the RPC rejected and the channel closed (with an
      // error)
      const errLatch = latch(2, done);
      ch.on('error', (error) => {
        assert.strictEqual(505, error.code);
        assert.strictEqual(60, error.classId);
        assert.strictEqual(72, error.methodId);
        succeed(errLatch)();
      });

      open(ch).then(() => {
        ch._rpc(defs.BasicRecover, { requeue: true }, defs.BasicRecoverOk, (err) => {
          if (err !== null) errLatch();
          else errLatch(new Error('Expected RPC failure'));
        });
      }, fail(errLatch));
    },
    (send, wait, done, ch) =>
      wait()()
        .then(() => {
          send(defs.BasicGetEmpty, { clusterId: '' }, ch);
        }) // oh wait! that was wrong! expect a channel close
        .then(wait(defs.ChannelClose))
        .then(() => {
          send(defs.ChannelCloseOk, {}, ch);
        })
        .then(succeed(done), fail(done)),
  ));

  it('RPC on closed channel', channelTest(
    (ch, done) => {
      open(ch);

      const close = new Promise((resolve) => {
        ch.on('error', (error) => {
          assert.strictEqual(504, error.code);
          assert.strictEqual(0, error.classId);
          assert.strictEqual(0, error.methodId);
          resolve();
        });
      });

      function failureCb(resolve, reject) {
        return (err) => {
          if (err !== null) resolve();
          else reject();
        };
      }

      const fail1 = new Promise((resolve, reject) =>
        ch._rpc(defs.BasicRecover, { requeue: true }, defs.BasicRecoverOk, failureCb(resolve, reject)),
      );

      const fail2 = new Promise((resolve, reject) =>
        ch._rpc(defs.BasicRecover, { requeue: true }, defs.BasicRecoverOk, failureCb(resolve, reject)),
      );

      Promise.all([close, fail1, fail2]).then(succeed(done)).catch(fail(done));
    },
    (send, wait, done, ch) => {
      wait(defs.BasicRecover)()
        .then(() => {
          send(defs.ChannelClose, {
            replyText: 'Nuh-uh!',
            replyCode: defs.constants.CHANNEL_ERROR,
            methodId: 0,
            classId: 0,
          }, ch);
          return wait(defs.ChannelCloseOk);
        })
        .then(succeed(done))
        .catch(fail(done));
    },
  ));

  it('publish all < single chunk threshold', channelTest(
    (ch, done) => {
      open(ch)
        .then(() => {
          ch.sendMessage({
            exchange: 'foo',
            routingKey: 'bar',
            mandatory: false,
            immediate: false,
            ticket: 0,
          }, {}, Buffer.from('foobar'));
        })
        .then(succeed(done), fail(done));
    },
    (_send, wait, done, _ch) => {
      wait(defs.BasicPublish)()
        .then(wait(defs.BasicProperties))
        .then(wait(undefined)) // content frame
        .then((f) => {
          assert.equal('foobar', f.content.toString());
        })
        .then(succeed(done), fail(done));
    },
  ));

  it('publish content > single chunk threshold', channelTest(
    (ch, done) => {
      open(ch);
      completes(() => {
        ch.sendMessage(
          {
            exchange: 'foo',
            routingKey: 'bar',
            mandatory: false,
            immediate: false,
            ticket: 0,
          },
          {},
          Buffer.alloc(3000),
        );
      }, done);
    }, (_send, wait, done, _ch) => {
      wait(defs.BasicPublish)()
        .then(wait(defs.BasicProperties))
        .then(wait(undefined)) // content frame
        .then((f) => {
          assert.equal(3000, f.content.length);
        })
        .then(succeed(done), fail(done));
    }
  ));

  it('publish method & headers > threshold', channelTest(
    (ch, done) => {
      open(ch);
      completes(() => {
        ch.sendMessage({
          exchange: 'foo',
          routingKey: 'bar',
          mandatory: false,
          immediate: false,
          ticket: 0,
        }, {
          headers: { foo: Buffer.alloc(3000) },
        }, Buffer.from('foobar'));
      }, done);
    }, (_send, wait, done, _ch) => {
      wait(defs.BasicPublish)()
        .then(wait(defs.BasicProperties))
        .then(wait(undefined)) // content frame
        .then((f) => {
          assert.equal('foobar', f.content.toString());
        })
        .then(succeed(done), fail(done));
    }
  ));

  it('publish zero-length message', channelTest((ch, done) => {
    open(ch);
    completes(() => {
      ch.sendMessage({
        exchange: 'foo',
        routingKey: 'bar',
        mandatory: false,
        immediate: false,
        ticket: 0,
      }, {}, Buffer.alloc(0));
      ch.sendMessage({
        exchange: 'foo',
        routingKey: 'bar',
        mandatory: false,
        immediate: false,
        ticket: 0,
      }, {}, Buffer.alloc(0));
    }, done);
  }, (_send, wait, done, _ch) => {
    wait(defs.BasicPublish)()
      .then(wait(defs.BasicProperties))
      // no content frame for a zero-length message
      .then(wait(defs.BasicPublish))
      .then(succeed(done), fail(done));
  }));

  it('delivery', channelTest((ch, done) => {
    open(ch);
    ch.on('delivery', (m) => {
      completes(() => {
        assert.equal('barfoo', m.content.toString());
      }, done);
    });
  }, (send, _wait, done, ch) => {
    completes(() => {
      send(defs.BasicDeliver, DELIVER_FIELDS, ch, Buffer.from('barfoo'));
    }, done);
  }));

  it('zero byte msg', channelTest(
    (ch, done) => {
      open(ch);
      ch.on('delivery', (m) => {
        completes(() => {
          assert.deepEqual(Buffer.alloc(0), m.content);
        }, done);
      });
    },
    (send, _wait, done, ch) => {
      completes(() => {
        send(defs.BasicDeliver, DELIVER_FIELDS, ch, Buffer.from(''));
      }, done);
    }
  ));

  it('bad delivery', channelTest((ch, done) => {
    const errorAndClose = latch(2, done);
    ch.on('error', (error) => {
      assert.strictEqual(505, error.code);
      assert.strictEqual(60, error.classId);
      assert.strictEqual(60, error.methodId);
      succeed(errorAndClose)();
    });
    ch.on('close', succeed(errorAndClose));
    open(ch);
  }, (send, wait, done, ch) => {
    send(defs.BasicDeliver, DELIVER_FIELDS, ch);
    // now send another deliver without having sent the content
    send(defs.BasicDeliver, DELIVER_FIELDS, ch);
    return wait(defs.ChannelClose)()
      .then(() => {
        send(defs.ChannelCloseOk, {}, ch);
      })
      .then(succeed(done), fail(done));
  }));

  it('bad content send', channelTest((ch, done) => {
    completes(() => {
      open(ch);
      assert.throws(() => {
        ch.sendMessage({ routingKey: 'foo', exchange: 'amq.direct' }, {}, null);
      });
    }, done);
  }, (_send, _wait, done, _ch) => {
    done();
  }));

  it('bad properties send', channelTest(
      (ch, done) => {
        completes(() => {
          open(ch);
          assert.throws(() => {
            ch.sendMessage({ routingKey: 'foo', exchange: 'amq.direct' }, { contentEncoding: 7 }, Buffer.from('foobar'));
          });
        }, done);
      },
      (_send, _wait, done, _ch) => {
        done();
      },
    ),
  );

  it('bad consumer', channelTest((ch, done) => {
    const errorAndClose = latch(2, done);
    ch.on('delivery', () => {
      throw new Error('I am a bad consumer');
    });
    ch.on('error', (error) => {
      assert.strictEqual(541, error.code);
      assert.strictEqual(undefined, error.classId);
      assert.strictEqual(undefined, error.methodId);
      succeed(errorAndClose)();
    });
    ch.on('close', succeed(errorAndClose));
    open(ch);
  }, (send, wait, done, ch) => {
    send(defs.BasicDeliver, DELIVER_FIELDS, ch, Buffer.from('barfoo'));
    return wait(defs.ChannelClose)()
      .then(() => {
        send(defs.ChannelCloseOk, {}, ch);
      })
      .then(succeed(done), fail(done));
  }));

  it('bad send in consumer', channelTest((ch, done) => {
    const errorAndClose = latch(2, done);
    ch.on('close', succeed(errorAndClose));
    ch.on('error', (error) => {
      assert.strictEqual(541, error.code);
      assert.strictEqual(undefined, error.classId);
      assert.strictEqual(undefined, error.methodId);
      succeed(errorAndClose)();
    });

    ch.on('delivery', () => {
      ch.sendMessage({ routingKey: 'foo', exchange: 'amq.direct' }, {}, null); // can't send null
    });

    open(ch);
  }, (send, wait, done, ch) => {
    completes(() => {
      send(defs.BasicDeliver, DELIVER_FIELDS, ch, Buffer.from('barfoo'));
    }, done);
    return wait(defs.ChannelClose)()
      .then(() => {
        send(defs.ChannelCloseOk, {}, ch);
      })
      .then(succeed(done), fail(done));
  }));

  it('return', channelTest((ch, done) => {
    ch.on('return', (m) => {
      completes(() => {
        assert.equal('barfoo', m.content.toString());
      }, done);
    });
    open(ch);
  }, (send, _wait, done, ch) => {
    completes(() => {
      send(defs.BasicReturn, DELIVER_FIELDS, ch, Buffer.from('barfoo'));
    }, done);
  }));

  it('cancel', channelTest((ch, done) => {
    ch.on('cancel', (f) => {
      completes(() => {
        assert.equal('product of society', f.consumerTag);
      }, done);
    });
    open(ch);
  }, (send, _wait, done, ch) => {
    completes(() => {
      send(defs.BasicCancel, {
        consumerTag: 'product of society',
        nowait: false,
      }, ch);
    }, done);
  }));

  function confirmTest(variety, Method) {
    return it(`confirm ${variety}`, channelTest((ch, done) => {
      ch.on(variety, (f) => {
        completes(() => {
          assert.equal(1, f.deliveryTag);
        }, done);
      });
      open(ch);
    }, (send, _wait, done, ch) => {
      completes(() => {
        send(Method, {
          deliveryTag: 1,
          multiple: false,
        }, ch);
      }, done);
    }));
  }

  confirmTest('ack', defs.BasicAck);
  confirmTest('nack', defs.BasicNack);

  it('out-of-order acks', channelTest((ch, done) => {
    const allConfirms = latch(3, () => {
      completes(() => {
        assert.equal(0, ch.unconfirmed.length);
        assert.equal(4, ch.lwm);
      }, done);
    });
    ch.pushConfirmCallback(allConfirms);
    ch.pushConfirmCallback(allConfirms);
    ch.pushConfirmCallback(allConfirms);
    open(ch);
  }, (send, _wait, done, ch) => {
    completes(() => {
      send(defs.BasicAck, { deliveryTag: 2, multiple: false }, ch);
      send(defs.BasicAck, { deliveryTag: 3, multiple: false }, ch);
      send(defs.BasicAck, { deliveryTag: 1, multiple: false }, ch);
    }, done);
  }));

  it('not all out-of-order acks', channelTest((ch, done) => {
    const allConfirms = latch(2, () => {
      completes(() => {
        assert.equal(1, ch.unconfirmed.length);
        assert.equal(3, ch.lwm);
      }, done);
    });
    ch.pushConfirmCallback(allConfirms); // tag = 1
    ch.pushConfirmCallback(allConfirms); // tag = 2
    ch.pushConfirmCallback(() => {
      done(new Error('Confirm callback should not be called'));
    });
    open(ch);
  }, (send, _wait, done, ch) => {
    completes(() => {
      send(defs.BasicAck, { deliveryTag: 2, multiple: false }, ch);
      send(defs.BasicAck, { deliveryTag: 1, multiple: false }, ch);
    }, done);
  }));
});
