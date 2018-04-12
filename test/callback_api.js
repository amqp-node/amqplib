'use strict';

var assert = require('assert');
var crypto = require('crypto');
var api = require('../callback_api');
var util = require('./util');
var schedule = util.schedule;
var randomString = util.randomString;
var kCallback = util.kCallback;
var domain = require('domain');
var Buffer = require('safe-buffer').Buffer;

var URL = process.env.URL || 'amqp://localhost';

var Promise = require('bluebird');
var mgmt_helpers = require('./mgmt_helpers');
var closeAllConn = mgmt_helpers.closeAllConn,
    createVhost = mgmt_helpers.createVhost,
    deleteVhost = mgmt_helpers.deleteVhost,
    deleteExchange = mgmt_helpers.deleteExchange,
    deleteQueue = mgmt_helpers.deleteQueue,
    assertPrefetch = mgmt_helpers.assertPrefetch,
    assertBinding = mgmt_helpers.assertBinding;


function connect(cb) {
  api.connect(URL, {}, cb);
}

// Construct a node-style callback from a `done` function
function doneCallback(done) {
  return function(err, _) {
    if (err == null) done();
    else done(err);
  };
}

function ignore() {}

function twice(done) {
  var first = function(err) {
    if (err == undefined) second = done;
    else second = ignore, done(err);
  };
  var second = function(err) {
    if (err == undefined) first = done;
    else first = ignore, done(err);
  };
  return {first:  function(err) { first(err); },
          second: function(err) { second(err); }};
}

// Adapt 'done' to a callback that's expected to fail
function failCallback(done) {
  return function(err, _) {
    if (err == null) done(new Error('Expected failure, got ' + val));
    else done();
  };
}

function waitForMessages(ch, q, k) {
  ch.checkQueue(q, function(e, ok) {
    if (e != null) return k(e);
    else if (ok.messageCount > 0) return k(null, ok);
    else schedule(waitForMessages.bind(null, ch, q, k));
  });
}


suite('connect', function() {

test('at all', function(done) {
  connect(doneCallback(done));
});

});

function channel_test_fn(method) {
  return function(name, chfun) {
    test(name, function(done) {
      connect(kCallback(function(c) {
        c[method](kCallback(function(ch) {
          chfun(ch, done);
        }, done));
      }, done));
    });
  };
}
var channel_test = channel_test_fn('createChannel');
var confirm_channel_test = channel_test_fn('createConfirmChannel');

suite('channel open', function() {

channel_test('at all', function(ch, done) {
  done();
});

channel_test('open and close', function(ch, done) {
  ch.close(doneCallback(done));
});

});

suite('assert, check, delete', function() {

channel_test('assert, check, delete queue', function(ch, done) {
  ch.assertQueue('test.cb.queue', {}, kCallback(function(q) {
    ch.checkQueue('test.cb.queue', kCallback(function(ok) {
      ch.deleteQueue('test.cb.queue', {}, doneCallback(done));
    }, done));
  }, done));
});

channel_test('assert, check, delete exchange', function(ch, done) {
  ch.assertExchange(
    'test.cb.exchange', 'topic', {}, kCallback(function(ex) {
      ch.checkExchange('test.cb.exchange', kCallback(function(ok) {
        ch.deleteExchange('test.cb.exchange', {}, doneCallback(done));
      }, done));
    }, done));
});

channel_test('fail on check non-queue', function(ch, done) {
  var both = twice(done);
  ch.on('error', failCallback(both.first));
  ch.checkQueue('test.cb.nothere', failCallback(both.second));
});

channel_test('fail on check non-exchange', function(ch, done) {
  var both = twice(done);
  ch.on('error', failCallback(both.first));
  ch.checkExchange('test.cb.nothere', failCallback(both.second));
});

});

suite('bindings', function() {

channel_test('bind queue', function(ch, done) {
  ch.assertQueue('test.cb.bindq', {}, kCallback(function(q) {
    ch.assertExchange(
      'test.cb.bindex', 'fanout', {}, kCallback(function(ex) {
        ch.bindQueue(q.queue, ex.exchange, '', {},
                     doneCallback(done));
      }, done));
  }, done));
});

channel_test('bind exchange', function(ch, done) {
  ch.assertExchange(
    'test.cb.bindex1', 'fanout', {}, kCallback(function(ex1) {
      ch.assertExchange(
        'test.cb.bindex2', 'fanout', {}, kCallback(function(ex2) {
          ch.bindExchange(ex1.exchange,
                          ex2.exchange, '', {},
                          doneCallback(done));
        }, done));
    }, done));
});

});

suite('sending messages', function() {

channel_test('send to queue and consume noAck', function(ch, done) {
  var msg = randomString();
  ch.assertQueue('', {exclusive: true}, function(e, q) {
    if (e !== null) return done(e);
    ch.consume(q.queue, function(m) {
      if (m.content.toString() == msg) done();
      else done(new Error("message content doesn't match:" +
                          msg + " =/= " + m.content.toString()));
    }, {noAck: true, exclusive: true});
    ch.sendToQueue(q.queue, Buffer.from(msg));
  });
});

channel_test('send to queue and consume ack', function(ch, done) {
  var msg = randomString();
  ch.assertQueue('', {exclusive: true}, function(e, q) {
    if (e !== null) return done(e);
    ch.consume(q.queue, function(m) {
      if (m.content.toString() == msg) {
        ch.ack(m);
        done();
      }
      else done(new Error("message content doesn't match:" +
                          msg + " =/= " + m.content.toString()));
    }, {noAck: false, exclusive: true});
    ch.sendToQueue(q.queue, Buffer.from(msg));
  });
});

channel_test('send to and get from queue', function(ch, done) {
  ch.assertQueue('', {exclusive: true}, function(e, q) {
    if (e != null) return done(e);
    var msg = randomString();
    ch.sendToQueue(q.queue, Buffer.from(msg));
    waitForMessages(ch, q.queue, function(e, _) {
      if (e != null) return done(e);
      ch.get(q.queue, {noAck: true}, function(e, m) {
        if (e != null)
          return done(e);
        else if (!m)
          return done(new Error('Empty (false) not expected'));
        else if (m.content.toString() == msg)
          return done();
        else
          return done(
            new Error('Messages do not match: ' +
                      msg + ' =/= ' + m.content.toString()));
      });
    });
  });
});

});

suite('ConfirmChannel', function() {

confirm_channel_test('Receive confirmation', function(ch, done) {
  // An unroutable message, on the basis that you're not allowed a
  // queue with an empty name, and you can't make bindings to the
  // default exchange. Tricky eh?
  ch.publish('', '', Buffer.from('foo'), {}, done);
});

confirm_channel_test('Wait for confirms', function(ch, done) {
  for (var i=0; i < 1000; i++) {
    ch.publish('', '', Buffer.from('foo'), {});
  }
  ch.waitForConfirms(done);
});

});

suite("Error handling", function() {

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
  test('Throw error in connection open callback', function(done) {
    var dom = domain.createDomain();
    dom.on('error', failCallback(done));
    connect(dom.bind(function(err, conn) {
      throw new Error('Spurious connection open callback error');
    }));
  });
}

// TODO: refactor {error_test, channel_test}
function error_test(name, fun) {
  test(name, function(done) {
    var dom = domain.createDomain();
    var done1 = function(result){
      dom.exit();
      done(result);
    }
    dom.run(function() {
      connect(kCallback(function(c) {
        // Seems like there were some unironed wrinkles in 0.8's
        // implementation of domains; explicitly adding the connection
        // to the domain makes sure any exception thrown in the course
        // of processing frames is handled by the domain. For other
        // versions of Node.JS, this ends up being belt-and-braces.
        dom.add(c);
        c.createChannel(kCallback(function(ch) {
          fun(ch, done1, dom);
        }, done1));
      }, done1));
    });
  });
}

error_test('Channel open callback throws an error', function(ch, done, dom) {
  dom.on('error', failCallback(done));
  throw new Error('Error in open callback');
});

error_test('RPC callback throws error', function(ch, done, dom) {
  dom.on('error', failCallback(done));
  ch.prefetch(0, false, function(err, ok) {
    throw new Error('Spurious callback error');
  });
});

error_test('Get callback throws error', function(ch, done, dom) {
  dom.on('error', failCallback(done));
  ch.assertQueue('test.cb.get-with-error', {}, function(err, ok) {
    ch.get('test.cb.get-with-error', {noAck: true}, function() {
      throw new Error('Spurious callback error');
    });
  });
});

error_test('Consume callback throws error', function(ch, done, dom) {
  dom.on('error', failCallback(done));
  ch.assertQueue('test.cb.consume-with-error', {}, function(err, ok) {
    ch.consume('test.cb.consume-with-error', ignore, {noAck: true}, function() {
      throw new Error('Spurious callback error');
    });
  });
});

error_test('Get from non-queue invokes error k', function(ch, done, dom) {
  var both = twice(failCallback(done));
  dom.on('error', both.first);
  ch.get('', {}, both.second);
});

error_test('Consume from non-queue invokes error k', function(ch, done, dom) {
  var both = twice(failCallback(done));
  dom.on('error', both.first);
  ch.consume('', both.second);
});

});


suite("recover", function() {

test("recover channel", function(done){
  this.timeout(15000);
  var vhost = 'recoverChannel';
  new Promise(createVhost(vhost)).then(function() {
    var connect = Promise.promisify(function(url, opts, cb){api.connect(url, opts, cb)});
    return connect(URL + "/" + encodeURIComponent(vhost),
                   {recover: true, recoverOnServerClose: true, recoverAfter: 100});
  }).then(function(c){
    var createChannel = Promise.promisify(function(cb){c.createChannel(cb)});
    return createChannel().then(function(ch){ return {c: c, ch: ch}; });
  }).delay(5000).then(function(cch){
    return new Promise(closeAllConn(vhost)).then(function(){ return cch; });
  }).delay(1000).then(function(cch){
    var prefetch = Promise.promisify(function(num, cb){cch.ch.prefetch(num,false,cb)});

    return prefetch(100).then(function(){ return cch.c; });
  }).then(function(c){
    // Disable recovery on vhost deletion
    c.connection.recoverOnServerClose = false;
    return c;
  }).finally(function() {
    return new Promise(deleteVhost(vhost));
  }).asCallback(doneCallback(done));
});


test("recover connection", function(done){
  this.timeout(15000);
  var vhost = 'recoverConnection';
  new Promise(createVhost(vhost)).then(function() {
    var connect = Promise.promisify(function(url, opts, cb){api.connect(url, opts, cb)});
    return connect(URL + "/" + encodeURIComponent(vhost),
                   {recover: true, recoverOnServerClose: true, recoverAfter: 100});
  }).then(function(c){
    return c;
  }).delay(5000).then(function(c){
    return new Promise(closeAllConn(vhost)).then(function(){ return c; });
  }).delay(1000).then(function(c){
    var createChannel = Promise.promisify(function(cb){c.createChannel(cb)});
    return createChannel().then(function(){return c;});
  }).then(function(c){
    // Disable recovery on vhost deletion
    c.connection.recoverOnServerClose = false;
    return c;
  }).finally(function() {
    return new Promise(deleteVhost(vhost));
  }).asCallback(doneCallback(done));
});


test("recover prefetch", function(done){
  this.timeout(15000);
  var vhost = 'recoverPrefetch';
  new Promise(createVhost(vhost)).then(function() {
    var connect = Promise.promisify(function(url, opts, cb){api.connect(url, opts, cb)});
    return connect(URL + "/" + encodeURIComponent(vhost),
                   {recover: true, recoverOnServerClose: true, recoverAfter: 100});
  }).then(function(c){
    var createChannel = Promise.promisify(function(cb){c.createChannel(cb)});
    return createChannel().then(function(ch){ return {c: c, ch: ch}; });
  }).then(function(cch){
    var prefetch = Promise.promisify(function(num, cb){cch.ch.prefetch(num,false,cb)});
    return prefetch(10).then(function(){ return cch; })
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
  }).asCallback(doneCallback(done));
});


test("recover exchange", function(done){
  this.timeout(15000);
  var vhost = 'recoverExchange';
  new Promise(createVhost(vhost)).then(function() {
    var connect = Promise.promisify(function(url, opts, cb){api.connect(url, opts, cb)});
    return connect(URL + "/" + encodeURIComponent(vhost),
                   {recover: true, recoverOnServerClose: true, recoverAfter: 100, recoverTopology: true});
  }).then(function(c){
    var createChannel = Promise.promisify(function(cb){c.createChannel(cb)});
    return createChannel().then(function(ch){ return {c: c, ch: ch}; });
  }).then(function(cch){
    var assertExchange = Promise.promisify(function(name, type, cb){cch.ch.assertExchange(name, type, {}, cb)});
    return assertExchange('exchange_name', 'fanout').then(function(){ return cch; })
  }).delay(5000).then(function(cch){
    return new Promise(deleteExchange(vhost, 'exchange_name')).then(function(){
      return new Promise(closeAllConn(vhost));
    }).then(function(){ return cch; });

  }).delay(1000).then(function(cch){
    var checkExchange = Promise.promisify(function(name, cb){cch.ch.checkExchange(name, cb)});
    // Check that exchange is there
    return checkExchange('exchange_name').then(function(){ return cch.c; });
  }).then(function(c){
    // Disable recovery on vhost deletion
    c.connection.recoverOnServerClose = false;
    return c;
  }).finally(function() {
    return new Promise(deleteVhost(vhost));
  }).asCallback(doneCallback(done));
});


test("recover queue", function(done){
  this.timeout(15000);
  var vhost = 'recoverQueue';
  new Promise(createVhost(vhost)).then(function() {
    var connect = Promise.promisify(function(url, opts, cb){api.connect(url, opts, cb)});
    return connect(URL + "/" + encodeURIComponent(vhost),
                   {recover: true, recoverOnServerClose: true, recoverAfter: 100, recoverTopology: true});
  }).then(function(c){
    var createChannel = Promise.promisify(function(cb){c.createChannel(cb)});
    return createChannel().then(function(ch){ return {c: c, ch: ch}; });
  }).then(function(cch){
    var assertQueue = Promise.promisify(function(name, cb){cch.ch.assertQueue(name, {}, cb)});
    return assertQueue('queue_name').then(function(){ return cch; })
  }).delay(5000).then(function(cch){
    return new Promise(deleteQueue(vhost, 'queue_name')).then(function(){
      return new Promise(closeAllConn(vhost));
    }).then(function(){ return cch; });

  }).delay(1000).then(function(cch){
    var checkQueue = Promise.promisify(function(name, cb){cch.ch.checkQueue(name, cb)});
    // Check that exchange is there
    return checkQueue('queue_name').then(function(){ return cch.c; });
  }).then(function(c){
    // Disable recovery on vhost deletion
    c.connection.recoverOnServerClose = false;
    return c;
  }).finally(function() {
    return new Promise(deleteVhost(vhost));
  }).asCallback(doneCallback(done));
});

test("recover anonymous queue", function(done){
  this.timeout(15000);
  var vhost = 'recoverAnonymousQueue';
  new Promise(createVhost(vhost)).then(function() {
    var connect = Promise.promisify(function(url, opts, cb){api.connect(url, opts, cb)});
    return connect(URL + "/" + encodeURIComponent(vhost),
                   {recover: true, recoverOnServerClose: true, recoverAfter: 100, recoverTopology: true});
  }).then(function(c){
    var createChannel = Promise.promisify(function(cb){c.createChannel(cb)});
    return createChannel().then(function(ch){ return {c: c, ch: ch}; });
  }).then(function(cch){
    var assertQueue = Promise.promisify(function(name, cb){cch.ch.assertQueue(name, {}, cb)});
    return assertQueue('').then(function(qok){
      cch.queue = qok.queue;
      return cch;
    })
  }).delay(5000).then(function(cch){
    return new Promise(deleteQueue(vhost, cch.queue)).then(function(){
      return new Promise(closeAllConn(vhost));
    }).then(function(){ return cch; });

  }).delay(1000).then(function(cch){
    // Check that exchange is there
    var queues = Object.keys(cch.ch.book.queues);
    var queue_name = queues[0];
    if(queues.length === 1){
      var checkQueue = Promise.promisify(function(name, cb){cch.ch.checkQueue(name, cb)});
      return checkQueue(queue_name).then(function(){ return cch.c; });
    } else {
      return Promise.reject(new Error("There must be only one queue booked. Queues: " + queues.toString()));
    }
  }).then(function(c){
    // Disable recovery on vhost deletion
    c.connection.recoverOnServerClose = false;
    return c;
  }).finally(function() {
    return new Promise(deleteVhost(vhost));
  }).asCallback(doneCallback(done));
});

test("recover exchange binding", function(done){
  this.timeout(15000);
  var vhost = 'recoverExchangeBinding';
  new Promise(createVhost(vhost)).then(function() {
    var connect = Promise.promisify(function(url, opts, cb){api.connect(url, opts, cb)});
    return connect(URL + "/" + encodeURIComponent(vhost),
                   {recover: true, recoverOnServerClose: true, recoverAfter: 100, recoverTopology: true});
  }).then(function(c){
    var createChannel = Promise.promisify(function(cb){c.createChannel(cb)});
    return createChannel().then(function(ch){ return {c: c, ch: ch}; });
  }).then(function(cch){
    var assertExchange = Promise.promisify(function(name, type, cb){cch.ch.assertExchange(name, type, {}, cb)});
    var bindExchange = Promise.promisify(function(dest, src, key, cb){cch.ch.bindExchange(dest, src, key, [], cb)});
    return assertExchange('exchange_src', 'direct').then(function(){
      return assertExchange('exchange_dest', 'fanout')
    }).then(function() {
      return bindExchange('exchange_dest', 'exchange_src', 'route');
    }).then(function(){ return cch; });
  }).delay(5000).then(function(cch){
    return new Promise(deleteExchange(vhost, 'exchange_src')
    ).then(function(){
      return new Promise(deleteExchange(vhost, 'exchange_dest'));
    }).then(function(){
      return new Promise(closeAllConn(vhost));
    }).then(function(){ return cch; });

  }).delay(1000).then(function(cch){
    var checkExchange = Promise.promisify(function(name, cb){cch.ch.checkExchange(name, cb)});
    // Check that exchange is there
    return checkExchange('exchange_dest'
    ).then(function(){
      return checkExchange('exchange_src');
    }).then(function(){
      return new Promise(assertBinding(vhost, 'exchange_dest', 'exchange_src', 'route'));
    }).then(function(){ return cch.c; });
  }).then(function(c){
    // Disable recovery on vhost deletion
    c.connection.recoverOnServerClose = false;
    return c;
  }).finally(function() {
    return new Promise(deleteVhost(vhost));
  }).asCallback(doneCallback(done));
});

test("recover queue binding", function(done){
  this.timeout(15000);
  var vhost = 'recoverQueueBinding';
  new Promise(createVhost(vhost)).then(function() {
    var connect = Promise.promisify(function(url, opts, cb){api.connect(url, opts, cb)});
    return connect(URL + "/" + encodeURIComponent(vhost),
                   {recover: true, recoverOnServerClose: true, recoverAfter: 100, recoverTopology: true});
  }).then(function(c){
    var createChannel = Promise.promisify(function(cb){c.createChannel(cb)});
    return createChannel().then(function(ch){ return {c: c, ch: ch}; });
  }).then(function(cch){
    var assertExchange = Promise.promisify(function(name, type, cb){cch.ch.assertExchange(name, type, {}, cb)});
    var assertQueue = Promise.promisify(function(name, cb){cch.ch.assertQueue(name, {}, cb)});
    var bindQueue = Promise.promisify(function(dest, src, key, cb){cch.ch.bindQueue(dest, src, key, [], cb)});
    return assertExchange('exchange_src', 'direct').then(function(){
      return assertQueue('queue_dest')
    }).then(function() {
      return bindQueue('queue_dest', 'exchange_src', 'route');
    }).then(function(){ return cch; });
  }).delay(5000).then(function(cch){
    return new Promise(deleteExchange(vhost, 'exchange_src')
    ).then(function(){
      return new Promise(deleteQueue(vhost, 'queue_dest'));
    }).then(function(){
      return new Promise(closeAllConn(vhost));
    }).then(function(){ return cch; });

  }).delay(1000).then(function(cch){
    var checkQueue = Promise.promisify(function(name, cb){cch.ch.checkQueue(name, cb)});
    var checkExchange = Promise.promisify(function(name, cb){cch.ch.checkExchange(name, cb)});
    // Check that exchange is there
    return checkQueue('queue_dest'
    ).then(function(){
      return checkExchange('exchange_src');
    }).then(function(){
      return new Promise(assertBinding(vhost, 'queue_dest', 'exchange_src', 'route'));
    }).then(function(){ return cch.c; });
  }).then(function(c){
    // Disable recovery on vhost deletion
    c.connection.recoverOnServerClose = false;
    return c;
  }).finally(function() {
    return new Promise(deleteVhost(vhost));
  }).asCallback(doneCallback(done));
});

test("recover anonymous queue binding", function(done){
  this.timeout(15000);
  var vhost = 'recoverAnonymousQueueBinding';
  new Promise(createVhost(vhost)).then(function() {
    var connect = Promise.promisify(function(url, opts, cb){api.connect(url, opts, cb)});
    return connect(URL + "/" + encodeURIComponent(vhost),
                   {recover: true, recoverOnServerClose: true, recoverAfter: 100, recoverTopology: true});
  }).then(function(c){
    var createChannel = Promise.promisify(function(cb){c.createChannel(cb)});
    return createChannel().then(function(ch){ return {c: c, ch: ch}; });
  }).then(function(cch){
    var assertExchange = Promise.promisify(function(name, type, cb){cch.ch.assertExchange(name, type, {}, cb)});
    var assertQueue = Promise.promisify(function(name, cb){cch.ch.assertQueue(name, {}, cb)});
    var bindQueue = Promise.promisify(function(dest, src, key, cb){cch.ch.bindQueue(dest, src, key, [], cb)});
    return assertExchange('exchange_src', 'direct'
    ).then(function(){
      return assertQueue('');
    }).then(function(qok) {
      cch.queue = qok.queue;
      return bindQueue(cch.queue, 'exchange_src', 'route');
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
      var checkQueue = Promise.promisify(function(name, cb){cch.ch.checkQueue(name, cb)});
      var checkExchange = Promise.promisify(function(name, cb){cch.ch.checkExchange(name, cb)});
      return checkQueue(queue_name
      ).then(function(){
        return checkExchange('exchange_src');
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
  }).asCallback(doneCallback(done));
});


function endRecoverConsumer(vhost, done) {
  return new Promise(deleteVhost(vhost)).asCallback(doneCallback(done));
}


test("recover consumer", function(done){
  this.timeout(15000);
  var vhost = 'recoverConsumer';
  new Promise(createVhost(vhost)).then(function() {
    var connect = Promise.promisify(function(url, opts, cb){api.connect(url, opts, cb)});
    return connect(URL + "/" + encodeURIComponent(vhost),
                       {recover: true, recoverOnServerClose: true, recoverAfter: 100, recoverTopology: true});
  }).then(function(c){
    var createChannel = Promise.promisify(function(cb){c.createChannel(cb)});
    return createChannel().then(function(ch){ return {c: c, ch: ch}; });
  }).then(function(cch){
    var deleteQueue = Promise.promisify(function(name, cb){cch.ch.deleteQueue(name, {}, cb)});
    var assertQueue = Promise.promisify(function(name, cb){cch.ch.assertQueue(name, {}, cb)});
    var consume = Promise.promisify(function(queue, callback, opts, cb){cch.ch.consume(queue, callback, opts, cb)});
    return deleteQueue('queue_name').then(function(){
        return assertQueue('queue_name')
      }).then(function() {
        // Test succeed as soon as the first message delivered.
        return consume('queue_name', function(msg){
          if(msg.content.toString() === "message"){
            endRecoverConsumer(vhost, done);
          } else {
            fail(done);
          }
        }, {noAck: true});
    }).then(function(){ return cch; })
  }).delay(5000).then(function(cch){
    return new Promise(closeAllConn(vhost)).then(function(){ return cch; });
  }).delay(1000).then(function(cch){
    var checkQueue = Promise.promisify(function(name, cb){cch.ch.checkQueue(name, cb)});
    // Check that exchange is there
    return checkQueue('queue_name').then(function(){ return cch; });
  }).then(function(cch){
    // Disable recovery on vhost deletion
    cch.c.connection.recoverOnServerClose = false;
    return cch.ch.sendToQueue('queue_name', Buffer.from("message"), {});
  }).catch(failCallback(done));
});

});