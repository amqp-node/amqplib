var assert = require('assert');
var crypto = require('crypto');
var api = require('../lib/channel_api');
var mock = require('./mocknet');
var succeed = mock.succeed, fail = mock.fail;
var defer = require('when').defer;

// Expect this promise to fail, and flip the results accordingly.
function expectFail(promise) {
  var rev = defer();
  promise.then(rev.reject.bind(rev), rev.resolve.bind(rev));
  return rev.promise;
}

function ignore() {}

function randomString() {
  var hash = crypto.createHash('sha1');
  hash.update(crypto.randomBytes(64));
  return hash.digest('hex');
}

test("connect local", function(done) {
  api.connect().then(function(c) {
    return c.close();
  }).then(succeed(done), fail(done));
});

var QUEUE_OPTS = {durable: false};
var EX_OPTS = {durable: false};

// Run a test with `name`, given a function that takes an open
// channel, and returns a promise that is resolved on test success or
// rejected on test failure.
function chtest(name, chfun) {
  test(name, function(done) {
    var c;
    api.connect().then(function(c1) {
      c = c1;
      return c.createChannel().then(function(ch) {
        return chfun(ch);
      });
    }).then(succeed(done), fail(done))
      .then(function() { // do regardless
        c.close();
      });
  });
}

chtest("create channel", function(ch) {
  return true;
});

chtest("assert and check queue", function(ch) {
  return ch.assertQueue('test.check-queue', QUEUE_OPTS)
    .then(function(qok) {
      return ch.checkQueue('test.check-queue');
    });
});

chtest("assert and check exchange", function(ch) {
  return ch.assertExchange('test.check-exchange', 'direct', EX_OPTS)
    .then(function(eok) {
      return ch.checkExchange('test.check-exchange');
    });
});

chtest("delete queue", function(ch) {
  ch.assertQueue('test.delete-queue', QUEUE_OPTS);
  return ch.checkQueue('test.delete-queue')
    .then(function() {
      return ch.deleteQueue('test.delete-queue');
    })
    .then(function() {
      ch.on('error', ignore);
      return expectFail(ch.checkQueue('test.delete-queue'));
    });
});

chtest("delete exchange", function(ch) {
  ch.assertExchange('test.delete-exchange', 'fanout', EX_OPTS);
  return ch.checkExchange('test.delete-exchange')
    .then(function() {
      return ch.deleteExchange('test.delete-exchange');
    })
    .then(function() {
      ch.on('error', ignore);
      return expectFail(ch.checkExchange('test.delete-exchange'));
    });
});


// Wait for the queue to meet the condition; useful for waiting for
// messages to arrive, for example.
function waitForQueue(q, condition) {
  var done = defer(),  conn;
  api.connect().then(function(c) {
    conn = c;
    return c.createChannel();
  }).then(function(ch) {
    function check() {
      ch.checkQueue(q).then(function(qok) {
        if (condition(qok)) {
          conn.close();
          done.resolve(qok);
        }
        else setImmediate(check);
      });
    }
    check();
  });
  return done.promise;
}

// return a promise that resolves when the queue has at least `num`
// messages. If num is not supplied, waits for the queue to have any
// messages at all.
function waitForMessages(q, num) {
  var cond;
  if (num === undefined) {
    cond = function(qok) { return qok.fields.messageCount > 0; };
  }
  else {
    cond = function(qok) { return qok.fields.messageCount >= num; };
  }
  return waitForQueue(q, cond);
}


// bind, publish, get
chtest("route message", function(ch) {
  var ex = 'test.route-message';
  var q = 'test.route-message-q';
  var msg = randomString();

  ch.assertExchange(ex, 'fanout', EX_OPTS);
  ch.assertQueue(q, QUEUE_OPTS);
  ch.purgeQueue(q);
  return ch.bindQueue(q, ex, '', {})
    .then(function() {
      ch.publish({exchange: ex, routingKey: ''}, new Buffer(msg));
      return waitForMessages(q, 1);
    })
    .then(function() {
      return ch.get(q, {noAck: true})
        .then(function(m) {
          assert(m);
          assert.equal(msg, m.content.toString());
        });
    });
});

// publish to default exchange, purge, get-empty
chtest("purge queue", function(ch) {
  var q = 'test.purge-queue';
  return ch.assertQueue(q, {durable: false})
    .then(function() {
      ch.publish({exchange: '', routingKey: q}, new Buffer('foobar'));
      return waitForMessages(q);
    })
    .then(function(qok) {
      assert(qok.fields.messageCount > 0);
      ch.purgeQueue(q);
      return ch.get(q, {noAck: true})
        .then(function(m) {
          assert(!m); // get-empty
        });
    });
});

// bind again, unbind, publish, get-empty
chtest("unbind queue", function(ch) {
  var ex = 'test.unbind-queue-ex';
  var q = 'test.unbind-queue';
  var viabinding = randomString();
  var direct = randomString();

  ch.assertExchange(ex, 'fanout', EX_OPTS);
  ch.assertQueue(q, QUEUE_OPTS);
  ch.purgeQueue(q);
  return ch.bindQueue(q, ex, '', {})
    .then(function() {
      ch.publish({exchange: ex, routingKey: ''}, new Buffer('foobar'));
      return waitForMessages(q);
    })
    .then(function() { // message got through!
      return ch.get(q, {noAck:true})
        .then(function(m) {
          assert(m);
        });
    })
    .then(function() {
      return ch.unbindQueue(q, ex, '', {});
    })
    .then(function() {
      // via the no-longer-existing binding
      ch.publish({exchange: ex, routingKey: ''}, new Buffer(viabinding));
      // direct to the queue
      ch.publish({exchange: '', routingKey: q}, new Buffer(direct));
      return waitForMessages(q);
    })
  .then(function() {
    return ch.get(q)
      .then(function(m) {
        // the direct to queue message got through, the via-binding
        // message (sent first) did not
        assert.equal(direct, m.content.toString());
      });
    });
});

// To some extent this is now just testing semantics of the server,
// but we can at least try out a few settings, and consume.
chtest("consume via exchange-exchange binding", function(ch) {
  var ex1 = 'test.ex-ex-binding1', ex2 = 'test.ex-ex-binding2';
  var q = 'test.ex-ex-binding-q';
  var rk = 'test.routing.key', msg = randomString();
  ch.assertExchange(ex1, 'direct', EX_OPTS);
  ch.assertExchange(ex2, 'fanout', {durable: false, internal: true});
  ch.assertQueue(q, QUEUE_OPTS);
  ch.purgeQueue(q);
  ch.bindExchange(ex2, ex1, rk, {});
  return ch.bindQueue(q, ex2, '', {})
    .then(function() {
      var arrived = defer();
      function delivery(m) {
        if (m.content.toString() === msg) arrived.resolve();
        else arrived.reject(new Error("Wrong message"));
      }
      ch.consume(q, delivery, {noAck: true}).then(function() {
        ch.publish({exchange: ex1, routingKey: rk}, new Buffer(msg));
      });
      return arrived.promise;
    });
});

// This is convoluted. Sorry.
chtest("cancel consumer", function(ch) {
  var q = 'test.consumer-cancel';
  var arrived = defer();
  var ctag;

  ch.assertQueue(q, QUEUE_OPTS);
  ch.purgeQueue(q);
  // My callback is 'resolve the promise in `arrived`'
  ch.consume(q, function() { arrived.resolve(); }, {noAck:true})
    .then(function(ok) {
      ctag = ok.fields.consumerTag;
      ch.publish({exchange: '', routingKey: q}, new Buffer('foo'));
    });
  // A message should arrive because of the consume
  return arrived.promise.then(function() {
    // replace the promise resolved by the consume callback
    arrived = defer();
    
    ch.cancel(ctag).then(function() {
      ch.publish({exchange: '', routingKey: q}, new Buffer('bar'));
    }, console.warn);

    // but check a message did arrive in the queue
    return waitForMessages(q)
      .then(function() {
        ch.get(q, {noAck:true})
          .then(function(m) {
            // I'm going to reject it, because I flip succeed/fail just
            // below
            if (m.content.toString() === 'bar')
              arrived.reject();
          });
        return expectFail(arrived.promise);
        // i.e., fail on delivery, succeed on get-ok
      });
  });
});

// ack, by default, removes a single message from the queue
chtest("ack", function(ch) {
  var q = 'test.ack';
  var msg1 = randomString(), msg2 = randomString();

  ch.assertQueue(q, QUEUE_OPTS);
  return ch.purgeQueue(q)
    .then(function() {
      ch.publish({exchange: '', routingKey: q}, new Buffer(msg1));
      ch.publish({exchange: '', routingKey: q}, new Buffer(msg2));
      return waitForMessages(q, 2);
    })
    .then(function() {
      return ch.get(q, {noAck: false})
    })
    .then(function(m) {
      assert.equal(msg1, m.content.toString());
      ch.ack(m);
      // %%% is there a race here? may depend on
      // rabbitmq-sepcific semantics
      return ch.get(q);
    })
    .then(function(m) {
      assert(m);
      assert.equal(msg2, m.content.toString());
    });
});

// Nack, by default, puts a message back on the queue (where in the
// queue is up to the server)
chtest("nack", function(ch) {
  var q = 'test.nack';
  var msg1 = randomString();

  ch.assertQueue(q, QUEUE_OPTS);
  return ch.purgeQueue(q)
    .then(function() {
      ch.publish({exchange: '', routingKey: q}, new Buffer(msg1));
      return waitForMessages(q, 1);
    })
    .then(function() {
      return ch.get(q, {noAck: false})
    })
    .then(function(m) {
      assert.equal(msg1, m.content.toString());
      ch.nack(m);
      return waitForMessages(q, 1);
    })
    .then(function(qok) {
      assert.equal(1, qok.fields.messageCount);
      return ch.get(q);
    })
    .then(function(m) {
      assert(m);
      assert.equal(msg1, m.content.toString());
    });
});
