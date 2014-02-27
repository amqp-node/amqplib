'use strict';

var assert = require('assert');
var crypto = require('crypto');
var api = require('../channel_api');
var util = require('./util');
var succeed = util.succeed, fail = util.fail;
var schedule = util.schedule;
var when = require('when');
var defer = when.defer;

var URL = process.env.URL || 'amqp://localhost';

function connect() {
  return api.connect(URL);
}

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
function ignoreErrors(c) {
  c.on('error', ignore); return c;
}
function logErrors(c) {
  c.on('error', console.warn); return c;
}

function randomString() {
  var hash = crypto.createHash('sha1');
  hash.update(crypto.randomBytes(64));
  return hash.digest('base64');
}

// Run a test with `name`, given a function that takes an open
// channel, and returns a promise that is resolved on test success or
// rejected on test failure.
function channel_test(chmethod, name, chfun) {
  test(name, function(done) {
    connect(URL).then(logErrors).then(function(c) {
      c[chmethod]().then(ignoreErrors).then(chfun)
        .then(succeed(done), fail(done))
      // close the connection regardless of what happens with the test
        .then(function() {c.close();});
    });
  });
}

var chtest = channel_test.bind(null, 'createChannel');

suite("connect", function() {

test("at all", function(done) {
  connect(URL).then(function(c) {
    return c.close()
    ;}).then(succeed(done), fail(done));
});

chtest("create channel", ignore); // i.e., just don't bork

});

var QUEUE_OPTS = {durable: false};
var EX_OPTS = {durable: false};

suite("assert, check, delete", function() {

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

chtest("fail on reasserting queue with different options",
       function(ch) {
         var q = 'test.reassert-queue';
         return ch.assertQueue(
           q, {durable: false, autoDelete: true})
           .then(function() {
             return expectFail(
               ch.assertQueue(q, {durable: false,
                                  autoDelete: false}));
           });
       });

chtest("fail on checking a queue that's not there", function(ch) {
  return expectFail(ch.checkQueue('test.random-' + randomString()));
});

chtest("fail on checking an exchange that's not there", function(ch) {
  return expectFail(ch.checkExchange('test.random-' + randomString()));
});

chtest("fail on reasserting exchange with different type",
       function(ch) {
         var ex = 'test.reassert-ex';
         return ch.assertExchange(ex, 'fanout', EX_OPTS)
           .then(function() {
             return expectFail(
               ch.assertExchange(ex, 'direct', EX_OPTS));
           });
       });

chtest("channel break on publishing to non-exchange", function(ch) {
  var bork = defer();
  ch.on('error', bork.resolve.bind(bork));
  ch.publish(randomString(), '', new Buffer('foobar'));
  return bork.promise;
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

});

// Wait for the queue to meet the condition; useful for waiting for
// messages to arrive, for example.
function waitForQueue(q, condition) {
  var ready = defer();
  connect(URL).then(function(c) {
    return c.createChannel()
      .then(function(ch) {
        function check() {
          ch.checkQueue(q).then(function(qok) {
            if (condition(qok)) {
              c.close();
              ready.resolve(qok);
            }
            else schedule(check);
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
    return qok.messageCount >= min;
  });
}

suite("sendMessage", function() {

// publish different size messages
chtest("send to queue and get from queue", function(ch) {
  var q = 'test.send-to-q';
  var msg = randomString();
  return doAll(
    ch.assertQueue(q, QUEUE_OPTS),
    ch.purgeQueue(q))
    .then(function() {
      ch.sendToQueue(q, new Buffer(msg));
      return waitForMessages(q);})
    .then(function() {
      return ch.get(q, {noAck: true});})
    .then(function(m) {
      assert(m);
      assert.equal(msg, m.content.toString());
    });
});

chtest("send (and get) zero content to queue", function(ch) {
  var q = 'test.send-to-q';
  var msg = new Buffer(0);
  return doAll(
    ch.assertQueue(q, QUEUE_OPTS),
    ch.purgeQueue(q))
    .then(function() {
      ch.sendToQueue(q, msg);
      return waitForMessages(q);})
    .then(function() {
      return ch.get(q, {noAck: true});})
    .then(function(m) {
      assert(m);
      assert.deepEqual(msg, m.content);
    });
});

});

suite("binding, consuming", function() {

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
      ch.publish(ex, '', new Buffer(msg));
      return waitForMessages(q);})
    .then(function() {
      return ch.get(q, {noAck: true});})
    .then(function(m) {
      assert(m);
      assert.equal(msg, m.content.toString());
    });
});

// send to queue, purge, get-empty
chtest("purge queue", function(ch) {
  var q = 'test.purge-queue';
  return ch.assertQueue(q, {durable: false})
    .then(function() {
      ch.sendToQueue(q, new Buffer('foobar'));
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
      ch.publish(ex, '', new Buffer('foobar'));
      return waitForMessages(q);})
    .then(function() { // message got through!
      return ch.get(q, {noAck:true})
        .then(function(m) {assert(m);});})
    .then(function() {
      return ch.unbindQueue(q, ex, '', {});})
    .then(function() {
      // via the no-longer-existing binding
      ch.publish(ex, '', new Buffer(viabinding));
      // direct to the queue
      ch.sendToQueue(q, new Buffer(direct));
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
          ch.publish(ex1, rk, new Buffer(msg));
        });
      return arrived.promise;
    });
});

// bind again, unbind, publish, get-empty
chtest("unbind exchange", function(ch) {
  var source = 'test.unbind-ex-source';
  var dest = 'test.unbind-ex-dest';
  var q = 'test.unbind-ex-queue';
  var viabinding = randomString();
  var direct = randomString();

  return doAll(
    ch.assertExchange(source, 'fanout', EX_OPTS),
    ch.assertExchange(dest, 'fanout', EX_OPTS),
    ch.assertQueue(q, QUEUE_OPTS),
    ch.purgeQueue(q),
    ch.bindExchange(dest, source, '', {}),
    ch.bindQueue(q, dest, '', {}))
    .then(function() {
      ch.publish(source, '', new Buffer('foobar'));
      return waitForMessages(q);})
    .then(function() { // message got through!
      return ch.get(q, {noAck:true})
        .then(function(m) {assert(m);});})
    .then(function() {
      return ch.unbindExchange(dest, source, '', {});})
    .then(function() {
      // via the no-longer-existing binding
      ch.publish(source, '', new Buffer(viabinding));
      // direct to the queue
      ch.sendToQueue(q, new Buffer(direct));
      return waitForMessages(q);})
    .then(function() {return ch.get(q)})
    .then(function(m) {
      // the direct to queue message got through, the via-binding
      // message (sent first) did not
      assert.equal(direct, m.content.toString());
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
        ctag = ok.consumerTag;
        ch.sendToQueue(q, new Buffer('foo'));
      }));
  // A message should arrive because of the consume
  return recv1.promise.then(function() {
    // replace the promise resolved by the consume callback
    recv1 = defer();
    
    return doAll(
      ch.cancel(ctag).then(function() {
        ch.sendToQueue(q, new Buffer('bar'));
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

chtest("cancelled consumer", function(ch) {
  var q = 'test.cancelled-consumer';
  var nullRecv = defer();
  
  doAll(
    ch.assertQueue(q),
    ch.purgeQueue(q),
    ch.consume(q, function(msg) {
      if (msg === null) nullRecv.resolve();
      else nullRecv.reject(new Error('Message not expected'));
    }))
    .then(function() {
      ch.deleteQueue(q);
    });
  return nullRecv.promise;
});

// ack, by default, removes a single message from the queue
chtest("ack", function(ch) {
  var q = 'test.ack';
  var msg1 = randomString(), msg2 = randomString();

  return doAll(
    ch.assertQueue(q, QUEUE_OPTS),
    ch.purgeQueue(q))
    .then(function() {
      ch.sendToQueue(q, new Buffer(msg1));
      ch.sendToQueue(q, new Buffer(msg2));
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
      ch.sendToQueue(q, new Buffer(msg1));
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

// reject is a near-synonym for nack, the latter of which is not
// available in earlier RabbitMQ (or in AMQP proper).
chtest("reject", function(ch) {
  var q = 'test.reject';
  var msg1 = randomString();

  return doAll(
    ch.assertQueue(q, QUEUE_OPTS), ch.purgeQueue(q))
    .then(function() {
      ch.sendToQueue(q, new Buffer(msg1));
      return waitForMessages(q);})
    .then(function() {
      return ch.get(q, {noAck: false})})
    .then(function(m) {
      assert.equal(msg1, m.content.toString());
      ch.reject(m);
      return waitForMessages(q);})
    .then(function() {
      return ch.get(q);})
    .then(function(m) {
      assert(m);
      assert.equal(msg1, m.content.toString());
    });
});

chtest("prefetch", function(ch) {
  var q = 'test.prefetch';
  return doAll(
    ch.assertQueue(q, QUEUE_OPTS), ch.purgeQueue(q),
    ch.prefetch(1))
    .then(function() {
      ch.sendToQueue(q, new Buffer('foobar'));
      ch.sendToQueue(q, new Buffer('foobar'));
      return waitForMessages(q, 2);
    })
    .then(function() {
      var first = defer();
      return doAll(
        ch.consume(q, function(m) {
          first.resolve(m);
        }, {noAck: false}),
        first.promise.then(function(m) {
          first = defer();
          ch.ack(m);
          return first.promise.then(function(m) {
            ch.ack(m);
          })
        }));
    });
});

});

var confirmtest = channel_test.bind(null, 'createConfirmChannel');

suite("confirms", function() {

confirmtest('message is confirmed', function(ch) {
  var q = 'test.confirm-message';
  return doAll(
    ch.assertQueue(q, QUEUE_OPTS), ch.purgeQueue(q))
    .then(function() {
      return ch.sendToQueue(q, new Buffer('bleep'));
    });
});

// Usually one can provoke the server into confirming more than one
// message in an ack by simply sending a few messages in quick
// succession; a bit unscientific I know. Luckily we can eavesdrop on
// the acknowledgements coming through to see if we really did get a
// multi-ack.
confirmtest('multiple confirms', function(ch) {
  var q = 'test.multiple-confirms';
  return doAll(
    ch.assertQueue(q, QUEUE_OPTS), ch.purgeQueue(q))
    .then(function() {
      var multipleRainbows = false;
      ch.on('ack', function(a) {
        if (a.multiple) multipleRainbows = true;
      });

      function prod(num) {
        var cs = [];

        function sendAndPushPromise() {
          var conf = defer();
          ch.sendToQueue(q, new Buffer('bleep'), {},
                         function(err) {
                           if (err) conf.reject();
                           else conf.resolve();
                         });
          cs.push(conf.promise);
        }

        for (var i=0; i < num; i++) sendAndPushPromise();

        return when.all(cs).then(function() {
          if (multipleRainbows) return true;
          else if (num > 500) throw new Error(
            "Couldn't provoke the server" +
              " into multi-acking with " + num +
              " messages; giving up");
          else {
            //console.warn("Failed with " + num + "; trying " + num * 2);
            return prod(num * 2);
          }
        });
      }
      return prod(5);
    });
});

});
