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

});
