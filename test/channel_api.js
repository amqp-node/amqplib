var assert = require('assert');
var crypto = require('crypto');
var api = require('../lib/channel_api');
var mock = require('./mocknet');
var succeed = mock.succeed, fail = mock.fail;
var when = require('when');
var defer = when.defer;

// Expect this promise to fail, and flip the results accordingly.
function expectFail(promise) {
  var rev = defer();
  promise.then(rev.reject.bind(rev), rev.resolve.bind(rev));
  return rev.promise;
}

// Often, even interdependent operations don't need to be explicitly
// chained together with `.then`, since the channel implicitly
// serialises RPCs. Synchronising on the last operation is sufficient,
// provided all the operations are successful. This procedure removes
// some of the `then` noise, while still failing if any of its
// arguments fail.
function doAll(/* promise... */) {
  return when.all(arguments)
    .then(function(results) {
      return results[results.length - 1];
    });
}

// I'll rely on operations being rejected, rather than the channel
// close error, to detect failure.
function ignore() {}
function ignoreErrors(ch) {
  ch.on('error', ignore); return ch;
}

function randomString() {
  var hash = crypto.createHash('sha1');
  hash.update(crypto.randomBytes(64));
  return hash.digest('base64');
}

test("connect local", function(done) {
  api.connect().then(function(c) {
    return c.close()
    ;}).then(succeed(done), fail(done));
});

var QUEUE_OPTS = {durable: false};
var EX_OPTS = {durable: false};

// Run a test with `name`, given a function that takes an open
// channel, and returns a promise that is resolved on test success or
// rejected on test failure.
function chtest(name, chfun) {
  test(name, function(done) {
    api.connect().then(function(c) {
      c.on('error', console.warn);
      c.createChannel().then(ignoreErrors).then(chfun)
        .then(succeed(done), fail(done))
      // close the connection regardless of what happens with the test
        .then(function() {c.close();});
    });
  });
}

chtest("create channel", ignore); // i.e., just don't bork

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
  var q = 'test.delete-queue';
  return doAll(
    ch.assertQueue(q, QUEUE_OPTS),
    ch.checkQueue(q))
    .then(function() {
      return ch.deleteQueue(q);})
    .then(function() {
      return expectFail(ch.checkQueue(q));});
});

chtest("delete exchange", function(ch) {
  var ex = 'test.delete-exchange';
  return doAll(
    ch.assertExchange(ex, 'fanout', EX_OPTS),
    ch.checkExchange(ex))
    .then(function() {
      return ch.deleteExchange(ex);})
    .then(function() {
      return expectFail(ch.checkExchange(ex));});
});

// Wait for the queue to meet the condition; useful for waiting for
// messages to arrive, for example.
function waitForQueue(q, condition) {
  var ready = defer();
  api.connect().then(function(c) {
    return c.createChannel()
      .then(function(ch) {
        function check() {
          ch.checkQueue(q).then(function(qok) {
            if (condition(qok)) {
              c.close();
              ready.resolve(qok);
            }
            else setImmediate(check);
          });
        }
        check();
      });
  });
  return ready.promise;
}

// Return a promise that resolves when the queue has at least `num`
// messages. If num is not supplied its assumed to be 1.
function waitForMessages(q, num) {
  var min = (num === undefined) ? 1 : num;
  return waitForQueue(q, function(qok) {
    return qok.fields.messageCount >= min;
  });
}

// bind, publish, get
chtest("route message", function(ch) {
  var ex = 'test.route-message';
  var q = 'test.route-message-q';
  var msg = randomString();

  return doAll(
    ch.assertExchange(ex, 'fanout', EX_OPTS),
    ch.assertQueue(q, QUEUE_OPTS),
    ch.purgeQueue(q),
    ch.bindQueue(q, ex, '', {}))
    .then(function() {
      ch.publish({exchange: ex, routingKey: ''}, new Buffer(msg));
      return waitForMessages(q);})
    .then(function() {
      return ch.get(q, {noAck: true});})
    .then(function(m) {
      assert(m);
      assert.equal(msg, m.content.toString());
    });
});

// publish to default exchange, purge, get-empty
chtest("purge queue", function(ch) {
  var q = 'test.purge-queue';
  return ch.assertQueue(q, {durable: false})
    .then(function() {
      ch.publish({exchange: '', routingKey: q}, new Buffer('foobar'));
      return waitForMessages(q);})
    .then(function() {
      ch.purgeQueue(q);
      return ch.get(q, {noAck: true});})
    .then(function(m) {
      assert(!m); // get-empty
    });
});

// bind again, unbind, publish, get-empty
chtest("unbind queue", function(ch) {
  var ex = 'test.unbind-queue-ex';
  var q = 'test.unbind-queue';
  var viabinding = randomString();
  var direct = randomString();

  return doAll(
    ch.assertExchange(ex, 'fanout', EX_OPTS),
    ch.assertQueue(q, QUEUE_OPTS),
    ch.purgeQueue(q),
    ch.bindQueue(q, ex, '', {}))
    .then(function() {
      ch.publish({exchange: ex, routingKey: ''},
                 new Buffer('foobar'));
      return waitForMessages(q);})
    .then(function() { // message got through!
      return ch.get(q, {noAck:true})
        .then(function(m) {assert(m);});})
    .then(function() {
      return ch.unbindQueue(q, ex, '', {});})
    .then(function() {
      // via the no-longer-existing binding
      ch.publish({exchange: ex, routingKey: ''}, new Buffer(viabinding));
      // direct to the queue
      ch.publish({exchange: '', routingKey: q}, new Buffer(direct));
      return waitForMessages(q);})
    .then(function() {return ch.get(q)})
    .then(function(m) {
      // the direct to queue message got through, the via-binding
      // message (sent first) did not
      assert.equal(direct, m.content.toString());
    });
});

// To some extent this is now just testing semantics of the server,
// but we can at least try out a few settings, and consume.
chtest("consume via exchange-exchange binding", function(ch) {
  var ex1 = 'test.ex-ex-binding1', ex2 = 'test.ex-ex-binding2';
  var q = 'test.ex-ex-binding-q';
  var rk = 'test.routing.key', msg = randomString();
  return doAll(
    ch.assertExchange(ex1, 'direct', EX_OPTS),
    ch.assertExchange(ex2, 'fanout',
                      {durable: false, internal: true}),
    ch.assertQueue(q, QUEUE_OPTS),
    ch.purgeQueue(q),
    ch.bindExchange(ex2, ex1, rk, {}),
    ch.bindQueue(q, ex2, '', {}))
    .then(function() {
      var arrived = defer();
      function delivery(m) {
        if (m.content.toString() === msg) arrived.resolve();
        else arrived.reject(new Error("Wrong message"));
      }
      ch.consume(q, delivery, {noAck: true})
        .then(function() {
          ch.publish({exchange: ex1, routingKey: rk},
                     new Buffer(msg));
        });
      return arrived.promise;
    });
});

// This is a bit convoluted. Sorry.
chtest("cancel consumer", function(ch) {
  var q = 'test.consumer-cancel';
  var recv1 = defer();
  var ctag;

  doAll(
    ch.assertQueue(q, QUEUE_OPTS),
    ch.purgeQueue(q),
    // My callback is 'resolve the promise in `arrived`'
    ch.consume(q, function() { recv1.resolve(); }, {noAck:true})
      .then(function(ok) {
        ctag = ok.fields.consumerTag;
        ch.publish({exchange: '', routingKey: q}, new Buffer('foo'));
      }));
  // A message should arrive because of the consume
  return recv1.promise.then(function() {
    // replace the promise resolved by the consume callback
    recv1 = defer();
    
    return doAll(
      ch.cancel(ctag).then(function() {
        ch.publish({exchange: '', routingKey: q}, new Buffer('bar'));
      }),
      // but check a message did arrive in the queue
      waitForMessages(q))
      .then(function() {
        ch.get(q, {noAck:true})
          .then(function(m) {
            // I'm going to reject it, because I flip succeed/fail
            // just below
            if (m.content.toString() === 'bar')
              recv1.reject();
          });
        return expectFail(recv1.promise);
        // i.e., fail on delivery, succeed on get-ok
      });
  });
});

// ack, by default, removes a single message from the queue
chtest("ack", function(ch) {
  var q = 'test.ack';
  var msg1 = randomString(), msg2 = randomString();

  return doAll(
    ch.assertQueue(q, QUEUE_OPTS),
    ch.purgeQueue(q))
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

  return doAll(
    ch.assertQueue(q, QUEUE_OPTS), ch.purgeQueue(q))
    .then(function() {
      ch.publish({exchange: '', routingKey: q}, new Buffer(msg1));
      return waitForMessages(q);})
    .then(function() {
      return ch.get(q, {noAck: false})})
    .then(function(m) {
      assert.equal(msg1, m.content.toString());
      ch.nack(m);
      return waitForMessages(q);})
    .then(function() {
      return ch.get(q);})
    .then(function(m) {
      assert(m);
      assert.equal(msg1, m.content.toString());
    });
});
