'use strict';

var assert = require('assert');
var api = require('../channel_api');
var util = require('./util');
var mgmt_helpers = require('./mgmt_helpers');
var succeed = util.succeed, fail = util.fail;
var schedule = util.schedule;
var randomString = util.randomString;
var Promise = require('bluebird');
var Buffer = require('safe-buffer').Buffer;
var http = require('http');

var URL = process.env.URL || 'amqp://localhost';
var URLS;
if(process.env.URLS){
  URLS = process.env.URLS.split(";");
} else {
  URLS = ['amqp://localhost', 'amqp://127.0.0.1'];
}

var closeAllConn = mgmt_helpers.closeAllConn,
    createVhost = mgmt_helpers.createVhost,
    deleteVhost = mgmt_helpers.deleteVhost,
    deleteExchange = mgmt_helpers.deleteExchange,
    deleteQueue = mgmt_helpers.deleteQueue,
    assertPrefetch = mgmt_helpers.assertPrefetch,
    assertBinding = mgmt_helpers.assertBinding,
    assertExchangeArguments = mgmt_helpers.assertExchangeArguments,
    assertQueueArguments = mgmt_helpers.assertQueueArguments;



function connect() {
  return api.connect(URL);
}

// Expect this promise to fail, and flip the results accordingly.
function expectFail(promise) {
  return new Promise(function(resolve, reject) {
    return promise.then(reject).catch(resolve);
  });
}

// I'll rely on operations being rejected, rather than the channel
// close error, to detect failure.
function ignore () {}
function ignoreErrors(c) {
  c.on('error', ignore); return c;
}
function logErrors(c) {
  c.on('error', console.warn); return c;
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
        .finally(function() {c.close();});
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
      assert.equal('test.check-exchange', eok.exchange);
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
  return new Promise(function(resolve) {
    ch.on('error', resolve);
    ch.publish(randomString(), '', Buffer.from('foobar'));
  });
});

chtest("delete queue", function(ch) {
  var q = 'test.delete-queue';
  return Promise.join(
    ch.assertQueue(q, QUEUE_OPTS),
    ch.checkQueue(q))
    .then(function() {
      return ch.deleteQueue(q);})
    .then(function() {
      return expectFail(ch.checkQueue(q));});
});

chtest("delete exchange", function(ch) {
  var ex = 'test.delete-exchange';
  return Promise.join(
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
  return connect(URL).then(function(c) {
    return c.createChannel()
      .then(function(ch) {
        return ch.checkQueue(q).then(function(qok) {
          function check() {
            return ch.checkQueue(q).then(function(qok) {
              if (condition(qok)) {
                c.close();
                return qok;
              }
              else schedule(check);
            });
          }
          return check();
        });
      });
  });
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
  return Promise.join(ch.assertQueue(q, QUEUE_OPTS), ch.purgeQueue(q))
    .then(function() {
      ch.sendToQueue(q, Buffer.from(msg));
      return waitForMessages(q);
    })
    .then(function() {
      return ch.get(q, {noAck: true});
    })
    .then(function(m) {
      assert(m);
      assert.equal(msg, m.content.toString());
    });
});

chtest("send (and get) zero content to queue", function(ch) {
  var q = 'test.send-to-q';
  var msg = Buffer.alloc(0);
  return Promise.join(
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

  return Promise.join(
    ch.assertExchange(ex, 'fanout', EX_OPTS),
    ch.assertQueue(q, QUEUE_OPTS),
    ch.purgeQueue(q),
    ch.bindQueue(q, ex, '', {}))
    .then(function() {
      ch.publish(ex, '', Buffer.from(msg));
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
      ch.sendToQueue(q, Buffer.from('foobar'));
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

  return Promise.join(
    ch.assertExchange(ex, 'fanout', EX_OPTS),
    ch.assertQueue(q, QUEUE_OPTS),
    ch.purgeQueue(q),
    ch.bindQueue(q, ex, '', {}))
    .then(function() {
      ch.publish(ex, '', Buffer.from('foobar'));
      return waitForMessages(q);})
    .then(function() { // message got through!
      return ch.get(q, {noAck:true})
        .then(function(m) {assert(m);});})
    .then(function() {
      return ch.unbindQueue(q, ex, '', {});})
    .then(function() {
      // via the no-longer-existing binding
      ch.publish(ex, '', Buffer.from(viabinding));
      // direct to the queue
      ch.sendToQueue(q, Buffer.from(direct));
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
  return Promise.join(
    ch.assertExchange(ex1, 'direct', EX_OPTS),
    ch.assertExchange(ex2, 'fanout',
                      {durable: false, internal: true}),
    ch.assertQueue(q, QUEUE_OPTS),
    ch.purgeQueue(q),
    ch.bindExchange(ex2, ex1, rk, {}),
    ch.bindQueue(q, ex2, '', {}))
    .then(function() {
      return new Promise(function(resolve, reject) {
        function delivery(m) {
          if (m.content.toString() === msg) resolve();
          else reject(new Error("Wrong message"));
        }
        ch.consume(q, delivery, {noAck: true})
          .then(function() {
            ch.publish(ex1, rk, Buffer.from(msg));
          });
      });
    });
});

// bind again, unbind, publish, get-empty
chtest("unbind exchange", function(ch) {
  var source = 'test.unbind-ex-source';
  var dest = 'test.unbind-ex-dest';
  var q = 'test.unbind-ex-queue';
  var viabinding = randomString();
  var direct = randomString();

  return Promise.join(
    ch.assertExchange(source, 'fanout', EX_OPTS),
    ch.assertExchange(dest, 'fanout', EX_OPTS),
    ch.assertQueue(q, QUEUE_OPTS),
    ch.purgeQueue(q),
    ch.bindExchange(dest, source, '', {}),
    ch.bindQueue(q, dest, '', {}))
    .then(function() {
      ch.publish(source, '', Buffer.from('foobar'));
      return waitForMessages(q);})
    .then(function() { // message got through!
      return ch.get(q, {noAck:true})
        .then(function(m) {assert(m);});})
    .then(function() {
      return ch.unbindExchange(dest, source, '', {});})
    .then(function() {
      // via the no-longer-existing binding
      ch.publish(source, '', Buffer.from(viabinding));
      // direct to the queue
      ch.sendToQueue(q, Buffer.from(direct));
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
  var ctag;
  var recv1 = new Promise(function (resolve, reject) {
      Promise.join(
    ch.assertQueue(q, QUEUE_OPTS),
    ch.purgeQueue(q),
    // My callback is 'resolve the promise in `arrived`'
    ch.consume(q, resolve, {noAck:true})
      .then(function(ok) {
        ctag = ok.consumerTag;
        ch.sendToQueue(q, Buffer.from('foo'));
      }));
  });

  // A message should arrive because of the consume
  return recv1.then(function() {
    var recv2 = Promise.join(
      ch.cancel(ctag).then(function() {
        return ch.sendToQueue(q, Buffer.from('bar'));
      }),
      // but check a message did arrive in the queue
      waitForMessages(q))
      .then(function() {
        return ch.get(q, {noAck:true});
      })
      .then(function(m) {
        // I'm going to reject it, because I flip succeed/fail
        // just below
        if (m.content.toString() === 'bar') {
          throw new Error();
        }
      });

      return expectFail(recv2);
  });
});

chtest("cancelled consumer", function(ch) {
  var q = 'test.cancelled-consumer';
  return new Promise(function(resolve, reject) {
    return Promise.join(
      ch.assertQueue(q),
      ch.purgeQueue(q),
      ch.consume(q, function(msg) {
        if (msg === null) resolve();
        else reject(new Error('Message not expected'));
      }))
      .then(function() {
        return ch.deleteQueue(q);
      });
  });
});

// ack, by default, removes a single message from the queue
chtest("ack", function(ch) {
  var q = 'test.ack';
  var msg1 = randomString(), msg2 = randomString();

  return Promise.join(
    ch.assertQueue(q, QUEUE_OPTS),
    ch.purgeQueue(q))
    .then(function() {
      ch.sendToQueue(q, Buffer.from(msg1));
      ch.sendToQueue(q, Buffer.from(msg2));
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

  return Promise.join(
    ch.assertQueue(q, QUEUE_OPTS), ch.purgeQueue(q))
    .then(function() {
      ch.sendToQueue(q, Buffer.from(msg1));
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

  return Promise.join(
    ch.assertQueue(q, QUEUE_OPTS), ch.purgeQueue(q))
    .then(function() {
      ch.sendToQueue(q, Buffer.from(msg1));
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
  return Promise.join(
    ch.assertQueue(q, QUEUE_OPTS), ch.purgeQueue(q),
    ch.prefetch(1))
    .then(function() {
      ch.sendToQueue(q, Buffer.from('foobar'));
      ch.sendToQueue(q, Buffer.from('foobar'));
      return waitForMessages(q, 2);
    })
    .then(function() {
      return new Promise(function(resolve) {
        var messageCount = 0;
        function receive(msg) {
          ch.ack(msg);
          if (++messageCount > 1) {
            resolve(messageCount);
          }
        }
        return ch.consume(q, receive, {noAck: false})
      });
    })
    .then(function(c) {
      return assert.equal(2, c);
    });
});

chtest('close', function(ch) {
  // Resolving promise guarantees
  // channel is closed
  return ch.close();
});

});

var confirmtest = channel_test.bind(null, 'createConfirmChannel');

suite("confirms", function() {

confirmtest('message is confirmed', function(ch) {
  var q = 'test.confirm-message';
  return Promise.join(
    ch.assertQueue(q, QUEUE_OPTS), ch.purgeQueue(q))
    .then(function() {
      return ch.sendToQueue(q, Buffer.from('bleep'));
    });
});

// Usually one can provoke the server into confirming more than one
// message in an ack by simply sending a few messages in quick
// succession; a bit unscientific I know. Luckily we can eavesdrop on
// the acknowledgements coming through to see if we really did get a
// multi-ack.
confirmtest('multiple confirms', function(ch) {
  var q = 'test.multiple-confirms';
  return Promise.join(
    ch.assertQueue(q, QUEUE_OPTS), ch.purgeQueue(q))
    .then(function() {
      var multipleRainbows = false;
      ch.on('ack', function(a) {
        if (a.multiple) multipleRainbows = true;
      });

      function prod(num) {
        var cs = [];

        function sendAndPushPromise() {
          var conf = Promise.fromCallback(function(cb) {
            return ch.sendToQueue(q, Buffer.from('bleep'), {}, cb);
          });
          cs.push(conf);
        }

        for (var i=0; i < num; i++) sendAndPushPromise();

        return Promise.all(cs).then(function() {
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

confirmtest('wait for confirms', function(ch) {
  for (var i=0; i < 1000; i++) {
    ch.publish('', '', Buffer.from('foobar'), {});
  }
  return ch.waitForConfirms();
})

});

function endRecoverConsumer(vhost, done) {
  return new Promise(deleteVhost(vhost)).then(succeed(done), fail(done));
}

suite("recover", function() {

test("recover connection", function(done){
  this.timeout(15000);
  var vhost = 'recoverConnection';
  new Promise(createVhost(vhost)).then(function() {
    return api.connect(URL + "/" + encodeURIComponent(vhost),
                       {recover: true, recoverOnServerClose: true, recoverAfter: 100});
  }).then(function(c){
    return c;
  }).delay(5000).then(function(c){
    return new Promise(closeAllConn(vhost)).then(function(){ return c; });
  }).delay(1000).then(function(c){
    return c.createChannel().then(ignoreErrors).then(function(){return c;});
  }).then(function(c){
    // Disable recovery on vhost deletion
    c.connection.recoverOnServerClose = false;
    return c;
  }).finally(function() {
    return new Promise(deleteVhost(vhost));
  }).then(succeed(done), fail(done));
});

test("recover connection with multiple hosts", function(done){
  this.timeout(15000);
  var vhost = 'recoverConnectionWithMultipleHosts';
  new Promise(createVhost(vhost)).then(function() {
    var urls_w_vhost = URLS.map(function(url){
      return url + "/" + encodeURIComponent(vhost);
    });
    return api.connect(urls_w_vhost,
                       {recover: true, recoverOnServerClose: true, recoverAfter: 100});
  }).then(function(c){
    return c;
  }).delay(5000).then(function(c){
    return new Promise(closeAllConn(vhost)).then(function(){ return c; });
  }).delay(1000).then(function(c){
    return c.createChannel().then(ignoreErrors).then(function(){return c;});
  }).then(function(c){
    // Disable recovery on vhost deletion
    c.connection.recoverOnServerClose = false;
    return c;
  }).finally(function() {
    return new Promise(deleteVhost(vhost));
  }).then(succeed(done), fail(done));
});

test("recover channel", function(done){
  this.timeout(15000);
  var vhost = 'recoverChannel';
  new Promise(createVhost(vhost)).then(function() {
    return api.connect(URL + "/" + encodeURIComponent(vhost),
                       {recover: true, recoverOnServerClose: true, recoverAfter: 100});
  }).then(function(c){
    return c.createChannel().then(ignoreErrors).then(function(ch){ return {c: c, ch: ch}; });
  }).delay(5000).then(function(cch){
    return new Promise(closeAllConn(vhost)).then(function(){ return cch; });
  }).delay(1000).then(function(cch){
    return cch.ch.prefetch(100).then(function(){ return cch.c; });
  }).then(function(c){
    // Disable recovery on vhost deletion
    c.connection.recoverOnServerClose = false;
    return c;
  }).finally(function() {
    return new Promise(deleteVhost(vhost));
  }).then(succeed(done), fail(done));
});

test("recover multiple channels", function(done){
  this.timeout(15000);
  var vhost = 'recoverMultipleChannels';
  new Promise(createVhost(vhost)).then(function() {
    return api.connect(URL + "/" + encodeURIComponent(vhost),
                       {recover: true, recoverOnServerClose: true, recoverAfter: 100});
  }).then(function(c){
    return c.createChannel().then(ignoreErrors).then(function(ch){
      return {c: c, ch: ch};
    });
  }).then(function(cch){
    return cch.c.createChannel().then(ignoreErrors).then(function(ch){
      cch.ch1 = ch;
      return cch;
    });
  }).delay(5000).then(function(cch){
    return new Promise(closeAllConn(vhost)).then(function(){ return cch; });
  }).delay(1000).then(function(cch){
    return cch.ch.prefetch(100).then(function(){
      return cch.ch1.prefetch(100);
    }).then(function(){ return cch.c; });
  }).then(function(c){
    // Disable recovery on vhost deletion
    c.connection.recoverOnServerClose = false;
    return c;
  }).finally(function() {
    return new Promise(deleteVhost(vhost));
  }).then(succeed(done), fail(done));
});

test("recover channel with multiple hosts", function(done){
  this.timeout(15000);
  var vhost = 'recoverChannelWithMultipleHosts';
  new Promise(createVhost(vhost)).then(function() {
    var urls_w_vhost = URLS.map(function(url){
      return url + "/" + encodeURIComponent(vhost);
    });
    return api.connect(urls_w_vhost,
                       {recover: true, recoverOnServerClose: true, recoverAfter: 100});
  }).then(function(c){
    return c.createChannel().then(ignoreErrors).then(function(ch){ return {c: c, ch: ch}; });
  }).delay(5000).then(function(cch){
    return new Promise(closeAllConn(vhost)).then(function(){ return cch; });
  }).delay(1000).then(function(cch){
    return cch.ch.prefetch(100).then(function(){ return cch.c; });
  }).then(function(c){
    // Disable recovery on vhost deletion
    c.connection.recoverOnServerClose = false;
    return c;
  }).finally(function() {
    return new Promise(deleteVhost(vhost));
  }).then(succeed(done), fail(done));
});

test("recover prefetch", function(done){
  this.timeout(15000);
  var vhost = 'recoverPrefetch';
  new Promise(createVhost(vhost)).then(function() {
    return api.connect(URL + "/" + encodeURIComponent(vhost),
                       {recover: true, recoverOnServerClose: true, recoverAfter: 100});
  }).then(function(c){
    return c.createChannel().then(ignoreErrors).then(function(ch){ return {c: c, ch: ch}; });
  }).then(function(cch){
    return cch.ch.prefetch(10).then(function(){ return cch; })
  }).delay(5000).then(function(cch){
    return new Promise(closeAllConn(vhost)).then(function(){ return cch; });
  }).delay(5000).then(function(cch){
    return new Promise(assertPrefetch(vhost, 10)).then(function() { return cch.c; });
  }).then(function(c){
    // Disable recovery on vhost deletion
    c.connection.recoverOnServerClose = false;
    return c;
  }).finally(function() {
    return new Promise(deleteVhost(vhost));
  }).then(succeed(done), fail(done));
});


test("recover exchange", function(done){
  this.timeout(15000);
  var vhost = 'recoverExchange';
  new Promise(createVhost(vhost)).then(function() {
    return api.connect(URL + "/" + encodeURIComponent(vhost),
                       {recover: true, recoverOnServerClose: true, recoverAfter: 100, recoverTopology: true});
  }).then(function(c){
    // Ignore error event
    c.on("error", function(){});
    return c.createChannel().then(ignoreErrors).then(function(ch){ return {c: c, ch: ch}; });
  }).then(function(cch){
    return cch.ch.assertExchange('exchange_name', 'fanout').then(function(){
      return cch.ch.assertExchange('exchange_name_to_remove', 'fanout');
    }).then(function(){
      return cch.ch.deleteExchange('exchange_name_to_remove');
    }).then(function(){ return cch; });
  }).delay(5000).then(function(cch){
    return new Promise(deleteExchange(vhost, 'exchange_name')).then(function(){
      return new Promise(closeAllConn(vhost));
    }).then(function(){ return cch; });

  }).delay(1000).then(function(cch){
    // Check that exchange is there
    return cch.ch.checkExchange('exchange_name').then(function(){
      return cch.ch.checkExchange('exchange_name_to_remove').then(fail(done)).catch(function(){
        return cch;
      });
    }).then(function(){ return cch.c; });
  }).then(function(c){
    // Disable recovery on vhost deletion
    c.connection.recoverOnServerClose = false;
    return c;
  }).finally(function() {
    return new Promise(deleteVhost(vhost));
  }).then(succeed(done), fail(done));
});


test("recover queue", function(done){
  this.timeout(15000);
  var vhost = 'recoverQueue';
  new Promise(createVhost(vhost)).then(function() {
    return api.connect(URL + "/" + encodeURIComponent(vhost),
                       {recover: true, recoverOnServerClose: true, recoverAfter: 100, recoverTopology: true});
  }).then(function(c){
    // Ignore error event
    c.on("error", function(){});
    return c.createChannel().then(ignoreErrors).then(function(ch){ return {c: c, ch: ch}; });
  }).then(function(cch){
    return cch.ch.assertQueue('queue_name').then(function(){
      return cch.ch.assertQueue('queue_name_to_remove');
    }).then(function(){
      return cch.ch.deleteQueue('queue_name_to_remove');
    }).then(function(){ return cch; })
  }).delay(5000).then(function(cch){
    return new Promise(deleteQueue(vhost, 'queue_name')).then(function(){
      return new Promise(closeAllConn(vhost));
    }).then(function(){ return cch; });

  }).delay(1000).then(function(cch){
    // Check that exchange is there
    return cch.ch.checkQueue('queue_name').then(function(){
      return cch.ch.checkQueue('queue_name_to_remove').then(fail(done)).catch(function(err){
        // Deleted queue will not be recovered.
        return cch.c;
      });
    });
  }).then(function(c){
    // Disable recovery on vhost deletion
    c.connection.recoverOnServerClose = false;
    return c;
  }).finally(function() {
    return new Promise(deleteVhost(vhost));
  }).then(succeed(done), fail(done));
});

test("recover anonymous queue", function(done){
  this.timeout(15000);
  var vhost = 'recoverAnonymousQueue';
  new Promise(createVhost(vhost)).then(function() {
    return api.connect(URL + "/" + encodeURIComponent(vhost),
                       {recover: true, recoverOnServerClose: true, recoverAfter: 100, recoverTopology: true});
  }).then(function(c){
    // Ignore error event
    c.on("error", function(){});
    return c.createChannel().then(ignoreErrors).then(function(ch){ return {c: c, ch: ch}; });
  }).then(function(cch){
    return cch.ch.assertQueue('').then(function(qok){
      cch.queue = qok.queue;
      return cch;
    }).then(function(){
      return cch.ch.assertQueue('').then(function(qok){
        cch.queue_removed = qok.queue;
        return cch;
      });
    }).then(function(){
      return cch.ch.deleteQueue(cch.queue_removed).then(function(){
        return cch;
      });
    });
  }).delay(5000).then(function(cch){
    return new Promise(deleteQueue(vhost, cch.queue)).then(function(){
      return new Promise(closeAllConn(vhost));
    }).then(function(){ return cch; });

  }).delay(1000).then(function(cch){
    // Check that exchange is there
    var queues = Object.keys(cch.ch.book.queues);
    var queue_name = queues[0];
    if(queues.length === 1){
      return cch.ch.checkQueue(queue_name).then(function(){ return cch.c; });
    } else {
      return Promise.reject(new Error("There must be only one queue booked. Queues: " + queues.toString()));
    }
  }).then(function(c){
    // Disable recovery on vhost deletion
    c.connection.recoverOnServerClose = false;
    return c;
  }).finally(function() {
    return new Promise(deleteVhost(vhost));
  }).then(succeed(done), fail(done));
});

test("recover exchange binding", function(done){
  this.timeout(15000);
  var vhost = 'recoverExchangeBinding';
  new Promise(createVhost(vhost)).then(function() {
    return api.connect(URL + "/" + encodeURIComponent(vhost),
                       {recover: true, recoverOnServerClose: true, recoverAfter: 100, recoverTopology: true});
  }).then(function(c){
    return c.createChannel().then(ignoreErrors).then(function(ch){ return {c: c, ch: ch}; });
  }).then(function(cch){
    return cch.ch.assertExchange('exchange_src', 'direct').then(function(){
      return cch.ch.assertExchange('exchange_dest', 'fanout')
    }).then(function() {
      return cch.ch.bindExchange('exchange_dest', 'exchange_src', 'route');
    }).then(function(){
      return cch.ch.bindExchange('exchange_dest', 'exchange_src', 'route_to_be_removed');
    }).then(function(){
      return cch.ch.unbindExchange('exchange_dest', 'exchange_src', 'route_to_be_removed');
    }).then(function(){ return cch; });
  }).delay(5000).then(function(cch){
    return new Promise(deleteExchange(vhost, 'exchange_src')
    ).then(function(){
      return new Promise(deleteExchange(vhost, 'exchange_dest'));
    }).then(function(){
      return new Promise(closeAllConn(vhost));
    }).then(function(){ return cch; });

  }).delay(1000).then(function(cch){
    // Check that exchange is there
    return cch.ch.checkExchange('exchange_dest'
    ).then(function(){
      return cch.ch.checkExchange('exchange_src');
    }).then(function(){
      return new Promise(assertBinding(vhost, 'exchange_dest', 'exchange_src', 'route'));
    }).then(function(){
      return new Promise(
        assertBinding(vhost, 'exchange_dest', 'exchange_src', 'route_to_be_removed')
      ).then(fail(done)).catch(function(){
        return;
      });
    }).then(function(){ return cch.c; });
  }).then(function(c){
    // Disable recovery on vhost deletion
    c.connection.recoverOnServerClose = false;
    return c;
  }).finally(function() {
    return new Promise(deleteVhost(vhost));
  }).then(succeed(done), fail(done));
});

test("not recover exchange binding without the source exchange", function(done){
  this.timeout(15000);
  var vhost = 'notrecoverExchangeBindingWithoutSrc';
  new Promise(createVhost(vhost)).then(function() {
    return api.connect(URL + "/" + encodeURIComponent(vhost),
                       {recover: true, recoverOnServerClose: true, recoverAfter: 100, recoverTopology: true});
  }).then(function(c){
    // Ignore error event
    c.on("error", function(){});
    return c.createChannel().then(ignoreErrors).then(function(ch){ return {c: c, ch: ch}; });
  }).then(function(cch){
    return cch.ch.assertExchange('exchange_src', 'direct').then(function(){
      return cch.ch.assertExchange('exchange_dest', 'fanout')
    }).then(function() {
      return cch.ch.bindExchange('exchange_dest', 'exchange_src', 'route');
    }).then(function(){
      return cch.ch.deleteExchange('exchange_src', 'direct');
    }).then(function(){ return cch; });
  }).delay(5000).then(function(cch){
    return new Promise(deleteExchange(vhost, 'exchange_dest')
    ).then(function(){
      return new Promise(closeAllConn(vhost));
    }).then(function(){ return cch; });

  }).delay(1000).then(function(cch){
    // Check that exchange is there
    return cch.ch.checkExchange('exchange_dest'
    ).then(function(){
      return cch.ch.checkExchange('exchange_src').then(fail(done)).catch(function(err){
          return cch;
        });
    }).then(function(){
      return new Promise(
        assertBinding(vhost, 'exchange_dest', 'exchange_src', 'route')
      ).then(fail(done)).catch(function(){
        return cch.c;
      });
    });
  }).then(function(c){
    // Disable recovery on vhost deletion
    c.connection.recoverOnServerClose = false;
    return c;
  }).finally(function() {
    return new Promise(deleteVhost(vhost));
  }).then(succeed(done), fail(done));
});


test("not recover exchange binding without the destination exchange", function(done){
  this.timeout(15000);
  var vhost = 'notrecoverExchangeBindingWithoutSrc';
  new Promise(createVhost(vhost)).then(function() {
    return api.connect(URL + "/" + encodeURIComponent(vhost),
                       {recover: true, recoverOnServerClose: true, recoverAfter: 100, recoverTopology: true});
  }).then(function(c){
    // Ignore error event
    c.on("error", function(){});
    return c.createChannel().then(ignoreErrors).then(function(ch){ return {c: c, ch: ch}; });
  }).then(function(cch){
    return cch.ch.assertExchange('exchange_src', 'direct').then(function(){
      return cch.ch.assertExchange('exchange_dest', 'fanout')
    }).then(function() {
      return cch.ch.bindExchange('exchange_dest', 'exchange_src', 'route');
    }).then(function(){
      return cch.ch.deleteExchange('exchange_dest', 'direct');
    }).then(function(){ return cch; });
  }).delay(5000).then(function(cch){
    return new Promise(deleteExchange(vhost, 'exchange_src')
    ).then(function(){
      return new Promise(closeAllConn(vhost));
    }).then(function(){ return cch; });

  }).delay(1000).then(function(cch){
    // Check that exchange is there
    return cch.ch.checkExchange('exchange_src'
    ).then(function(){
      return cch.ch.checkExchange('exchange_dest').then(fail(done)).catch(function(err){
          return cch;
        });
    }).then(function(){
      return new Promise(
        assertBinding(vhost, 'exchange_dest', 'exchange_src', 'route')
      ).then(fail(done)).catch(function(){
        return cch.c;
      });
    });
  }).then(function(c){
    // Disable recovery on vhost deletion
    c.connection.recoverOnServerClose = false;
    return c;
  }).finally(function() {
    return new Promise(deleteVhost(vhost));
  }).then(succeed(done), fail(done));
});

test("recover queue binding", function(done){
  this.timeout(15000);
  var vhost = 'recoverQueueBinding';
  new Promise(createVhost(vhost)).then(function() {
    return api.connect(URL + "/" + encodeURIComponent(vhost),
                       {recover: true, recoverOnServerClose: true, recoverAfter: 100, recoverTopology: true});
  }).then(function(c){
    return c.createChannel().then(ignoreErrors).then(function(ch){ return {c: c, ch: ch}; });
  }).then(function(cch){
    return cch.ch.assertExchange('exchange_src', 'direct').then(function(){
      return cch.ch.assertQueue('queue_dest')
    }).then(function() {
      return cch.ch.bindQueue('queue_dest', 'exchange_src', 'route');
    }).then(function(){
      return cch.ch.bindQueue('queue_dest', 'exchange_src', 'route_to_be_removed');
    }).then(function(){
      return cch.ch.unbindQueue('queue_dest', 'exchange_src', 'route_to_be_removed');
    }).then(function(){ return cch; });
  }).delay(5000).then(function(cch){
    return new Promise(deleteExchange(vhost, 'exchange_src')
    ).then(function(){
      return new Promise(deleteQueue(vhost, 'queue_dest'));
    }).then(function(){
      return new Promise(closeAllConn(vhost));
    }).then(function(){ return cch; });

  }).delay(1000).then(function(cch){
    // Check that exchange is there
    return cch.ch.checkQueue('queue_dest'
    ).then(function(){
      return cch.ch.checkExchange('exchange_src');
    }).then(function(){
      return new Promise(assertBinding(vhost, 'queue_dest', 'exchange_src', 'route'));
    }).then(function(){
      return new Promise(
        assertBinding(vhost, 'queue_dest', 'exchange_src', 'route')
      ).then(fail(done)).catch(function(){ return; });
    }).then(function(){ return cch.c; });
  }).then(function(c){
    // Disable recovery on vhost deletion
    c.connection.recoverOnServerClose = false;
    return c;
  }).finally(function() {
    return new Promise(deleteVhost(vhost));
  }).then(succeed(done), fail(done));
});

test("not recover queue binding without the source exchange", function(done){
  this.timeout(15000);
  var vhost = 'recoverQueueBinding';
  new Promise(createVhost(vhost)).then(function() {
    return api.connect(URL + "/" + encodeURIComponent(vhost),
                       {recover: true, recoverOnServerClose: true, recoverAfter: 100, recoverTopology: true});
  }).then(function(c){
    c.on("error", function(){});
    return c.createChannel().then(ignoreErrors).then(function(ch){ return {c: c, ch: ch}; });
  }).then(function(cch){
    return cch.ch.assertExchange('exchange_src', 'direct').then(function(){
      return cch.ch.assertQueue('queue_dest')
    }).then(function() {
      return cch.ch.bindQueue('queue_dest', 'exchange_src', 'route');
    }).then(function(){ return cch; });
  }).delay(5000).then(function(cch){
    return cch.ch.deleteExchange('exchange_src').then(function(){
      return new Promise(deleteQueue(vhost, 'queue_dest'));
    }).then(function(){
      return new Promise(closeAllConn(vhost));
    }).then(function(){ return cch; });

  }).delay(1000).then(function(cch){
    // Check that exchange is there
    return cch.ch.checkQueue('queue_dest'
    ).then(function(){
      return cch.ch.checkExchange('exchange_src').then(fail(done)).catch(function(err){
        return cch;
      });
    }).then(function(){
      return new Promise(
        assertBinding(vhost, 'queue_dest', 'exchange_src', 'route')
      ).then(fail(done)).catch(function(){ return; });
    }).then(function(){ return cch.c; });
  }).then(function(c){
    // Disable recovery on vhost deletion
    c.connection.recoverOnServerClose = false;
    return c;
  }).finally(function() {
    return new Promise(deleteVhost(vhost));
  }).then(succeed(done), fail(done));
});

test("recover queue binding with args", function(done){
  this.timeout(15000);
  var vhost = 'recoverQueueBindingWithArgs';
  new Promise(createVhost(vhost)).then(function() {
    return api.connect(URL + "/" + encodeURIComponent(vhost),
                       {recover: true, recoverOnServerClose: true, recoverAfter: 100, recoverTopology: true});
  }).then(function(c){
    return c.createChannel().then(ignoreErrors).then(function(ch){ return {c: c, ch: ch}; });
  }).then(function(cch){
    return cch.ch.assertExchange('exchange_src', 'direct').then(function(){
      return cch.ch.assertQueue('queue_dest')
    }).then(function() {
      return cch.ch.bindQueue('queue_dest', 'exchange_src', 'route', {"arg": "value"});
    }).then(function(){ return cch; });
  }).delay(5000).then(function(cch){
    return new Promise(deleteExchange(vhost, 'exchange_src')
    ).then(function(){
      return new Promise(deleteQueue(vhost, 'queue_dest'));
    }).then(function(){
      return new Promise(closeAllConn(vhost));
    }).then(function(){ return cch; });

  }).delay(1000).then(function(cch){
    // Check that exchange is there
    return cch.ch.checkQueue('queue_dest'
    ).then(function(){
      return cch.ch.checkExchange('exchange_src');
    }).then(function(){
      return new Promise(assertBinding(vhost, 'queue_dest', 'exchange_src', 'route', {"arg": "value"}));
    }).then(function(){ return cch.c; });
  }).then(function(c){
    // Disable recovery on vhost deletion
    c.connection.recoverOnServerClose = false;
    return c;
  }).finally(function() {
    return new Promise(deleteVhost(vhost));
  }).then(succeed(done), fail(done));
});


test("recover anonymous queue binding", function(done){
  this.timeout(15000);
  var vhost = 'recoverAnonymousQueueBinding';
  new Promise(createVhost(vhost)).then(function() {
    return api.connect(URL + "/" + encodeURIComponent(vhost),
                       {recover: true, recoverOnServerClose: true, recoverAfter: 100, recoverTopology: true});
  }).then(function(c){
    return c.createChannel().then(ignoreErrors).then(function(ch){ return {c: c, ch: ch}; });
  }).then(function(cch){
    return cch.ch.assertExchange('exchange_src', 'direct'
    ).then(function(){
      return cch.ch.assertQueue('');
    }).then(function(qok) {
      cch.queue = qok.queue;
      return cch.ch.bindQueue(cch.queue, 'exchange_src', 'route');
    }).then(function(){ return cch; });
  }).delay(5000).then(function(cch){
    return new Promise(deleteExchange(vhost, 'exchange_src')
    ).then(function(){
      return new Promise(deleteQueue(vhost, cch.queue));
    }).then(function(){
      return new Promise(closeAllConn(vhost));
    }).then(function(){ return cch; });
  }).delay(1000).then(function(cch){
    // Check that exchange is there
    var queues = Object.keys(cch.ch.book.queues);
    var queue_name = queues[0];
    if(queues.length === 1){
      return cch.ch.checkQueue(queue_name
      ).then(function(){
        return cch.ch.checkExchange('exchange_src');
      }).then(function(){
        return new Promise(assertBinding(vhost, queue_name, 'exchange_src', 'route'));
      }).then(function(){ return cch.c; });
    } else {
      return Promise.reject(new Error("There must be only one queue booked. Queues: " + queues.toString()));
    }
  }).then(function(c){
    // Disable recovery on vhost deletion
    c.connection.recoverOnServerClose = false;
    return c;
  }).finally(function() {
    return new Promise(deleteVhost(vhost));
  }).then(succeed(done), fail(done));
});


test("recover consumer", function(done){
  this.timeout(15000);
  var vhost = 'recoverConsumer';
  new Promise(createVhost(vhost)).then(function() {
    return api.connect(URL + "/" + encodeURIComponent(vhost),
                       {recover: true, recoverOnServerClose: true, recoverAfter: 100, recoverTopology: true});
  }).then(function(c){
    return c.createChannel().then(ignoreErrors).then(function(ch){ return {c: c, ch: ch}; });
  }).then(function(cch){
    return cch.ch.deleteQueue('queue_name').then(function(){
        return cch.ch.assertQueue('queue_name')
      }).then(function() {
        // Test succeed as soon as the first message delivered.
        return cch.ch.consume('queue_name', function(msg){
          if(msg.content.toString() === "message"){
            endRecoverConsumer(vhost, done);
          } else {
            fail(done);
          }
        }, {noAck: true});
    }).then(function(){ return cch; })
  }).delay(5000).then(function(cch){
    // return cch;
    return new Promise(closeAllConn(vhost)).then(function(){ return cch; });
  }).delay(1000).then(function(cch){
    // Check that exchange is there
    return cch.ch.checkQueue('queue_name').then(function(){ return cch; });
  }).then(function(cch){
    // Disable recovery on vhost deletion
    cch.c.connection.recoverOnServerClose = false;
    return cch.ch.sendToQueue('queue_name', Buffer.from("message"));
  }).catch(fail(done));
});


test("not recover cancelled consumer", function(done){
  this.timeout(15000);
  var vhost = 'notRecoverCancelledConsumer';
  new Promise(createVhost(vhost)).then(function() {
    return api.connect(URL + "/" + encodeURIComponent(vhost),
                       {recover: true, recoverOnServerClose: true, recoverAfter: 100, recoverTopology: true});
  }).then(function(c) {
    return c.createChannel().then(ignoreErrors).then(function(ch){ return {c: c, ch: ch}; });
  }).then(function(cch) {
    return cch.ch.deleteQueue('queue_name').then(function() {
      return cch.ch.assertQueue('queue_name')
    }).then(function() {
      return cch.ch.deleteQueue('queue_name_2');
    }).then(function() {
      return cch.ch.assertQueue('queue_name_2');
    }).then(function() {
      return cch.ch.deleteQueue('queue_name_3');
    }).then(function() {
      return cch.ch.assertQueue('queue_name_3');
    }).then(function() {
      // There should be no messages delivered, only cancel (null)
      return cch.ch.consume('queue_name', function(msg){
        if(msg !== null) {
          fail(done);
        }
      }, {noAck: true});
    }).then(function(consumer) {
      // Cancel first consumer from the channel
      return cch.ch.cancel(consumer.consumerTag);
    }).then(function() {
      return cch.ch.consume('queue_name_2', function(msg){
        if(msg !== null) {
          fail(done);
        }
      }, {noAck: true});
    }).then(function(consumer) {
      return cch.ch.deleteQueue('queue_name_2');
    }).then(function() {
      return cch.ch.consume('queue_name_3', function(msg){
        if(msg !== null) {
          fail(done);
        }
      }, {noAck: true});
    }).then(function() { return cch; });
  }).delay(5000).then(function(cch) {
    // Delay after queue is removed to let the client remove the consumer
    return new Promise(deleteQueue(vhost, 'queue_name_3')).delay(500).then(function(){
      return new Promise(closeAllConn(vhost));
    }).then(function(){ return cch; });
  }).delay(1000).then(function(cch) {
    // Check that exchange is there
    return cch.ch.checkQueue('queue_name').then(function(){
      return cch.ch.checkQueue('queue_name_3');
    }).then(function(){ return cch; });
  }).then(function(cch) {
    // Disable recovery on vhost deletion
    cch.c.connection.recoverOnServerClose = false;
    cch.ch.sendToQueue('queue_name', Buffer.from("message"));
    cch.ch.sendToQueue('queue_name_2', Buffer.from("message"));
    cch.ch.sendToQueue('queue_name_3', Buffer.from("message"));
    return cch;
  }).delay(2000).finally(function() {
    return new Promise(deleteVhost(vhost));
  }).then(succeed(done), fail(done));
});

test("recover arguments", function(done){
  this.timeout(15000);
  var vhost = 'recoverArguments';
  new Promise(createVhost(vhost)).then(function() {
    return api.connect(URL + "/" + encodeURIComponent(vhost),
                       {recover: true, recoverOnServerClose: true, recoverAfter: 100, recoverTopology: true});
  }).then(function(c) {
    return c.createChannel().then(ignoreErrors).then(function(ch){ return {c: c, ch: ch}; });
  }).then(function(cch) {
    return cch.ch.deleteQueue('queue_name').then(function() {
      return cch.ch.assertQueue('queue_name', {maxLength: 10})
    }).then(function(){ return cch; });
  }).then(function(cch) {
    return cch.ch.deleteExchange('ex_name').then(function() {
      return cch.ch.assertExchange('ex_name', 'fanout', {alternateExchange: 'foo'})
    }).then(function(){ return cch; });
  }).delay(5000).then(function(cch){
    // return cch;
    return new Promise(closeAllConn(vhost)).then(function(){ return cch; });
  }).delay(1000).then(function(cch){
    return new Promise(assertExchangeArguments(vhost, 'ex_name', 'fanout', {'alternate-exchange': 'foo'})
      ).then(function(){ return cch; });
  }).then(function(cch){
    return new Promise(assertQueueArguments(vhost, 'queue_name', {'x-max-length': 10})
      ).then(function(){ return cch; });
  }).then(succeed(done), fail(done));
});

});
