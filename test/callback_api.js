'use strict';

var assert = require('assert');
var crypto = require('crypto');
var api = require('../callback_api');
var util = require('./util');
var succeed = util.succeed, fail = util.fail;
var schedule = util.schedule;

var URL = process.env.URL || 'amqp://localhost';

function connect(cb) {
  api.connect(URL, {}, cb);
}

// Suitable for supplying a `done` value
function doneCallback(done) {
  return function(err, _) {
    if (err == null) done();
    else done(err);
  };
}

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

// Split the callback into separate continuations, handy for exiting
// early.
function kCallback(k, ek) {
  return function(err, val) {
    if (err == null) k(val);
    else ek(err);
  };
}

suite('connect', function() {

test('at all', function(done) {
  connect(doneCallback(done));
});

});

function channel_test(name, chfun) {
  test(name, function(done) {
    connect(kCallback(function(c) {
      c.createChannel(kCallback(function(ch) {
        chfun(ch, done);
      }, done));
    }, done));
  });
}

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
