var assert = require('assert');
var defer = require('../lib/sync_defer').defer;

var suite = module.exports;

suite.testResolveThen = function() {
  var resolved = false;
  var d = defer();
  d.resolve('frob');
  d.promise.then(function(f) { if (f === 'frob') resolved = true; });
  assert(resolved);
};

suite.testThenResolve = function() {
  var resolved = false;
  var d = defer();
  d.promise.then(function(f) { if (f === 'frob') resolved = true; });
  d.resolve('frob');
  assert(resolved);
};

suite.testThenThenResolve = function() {
  var d = defer(), called = false;
  d.promise
    .then(function(f) { if (f === 'foo') return 'bar'; })
    .then(function(b) { if (b === 'bar') called = true; });
  d.resolve('foo');
  assert(called);
};

suite.testResolveThenThen = function() {
  var d = defer(), called = false;
  d.resolve('foo');
  d.promise
    .then(function(f) { if (f === 'foo') return 'bar'; })
    .then(function(b) { if (b === 'bar') called = true; });
  assert(called);
};

suite.testRejectThen = function() {
  var called = false;
  var d = defer();
  d.reject('frob');
  d.promise.then(assert.fail,
                 function(f) {
                   if (f === 'frob') called = true; });
  assert(called);
};

suite.testThenReject = function() {
  var called = false;
  var d = defer();
  d.promise.then(assert.fail,
                 function(f) {
                   if (f === 'frob') called = true; });
  d.reject('frob');
  assert(called);
};

suite.testThenThrowThen = function() {
  var called = false;
  var d = defer();
  d.promise
    .then(function() { throw 'foo'; })
    .then(assert.fail, function(f) { if (f === 'foo') called = true; });
  d.resolve();
  assert(called);
};

// Test that errors will get propagated when there's no explicit
// errback in the middle.
suite.testThenThrowThenThen = function() {
  var called = false;
  var d = defer();
  d.promise
    .then(function() { throw 'foo'; })
    .then(function() { return 'bar'; })
    .then(assert.fail, function(f) { if ( f=== 'foo') called = true; });
  d.resolve();
  assert(called);
};
