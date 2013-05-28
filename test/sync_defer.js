var assert = require('assert');
var defer = require('../lib/sync_defer').defer;

suite("Sync promise", function() {

test('ResolveThen', function() {
  var resolved = false;
  var d = defer();
  d.resolve('frob');
  d.promise.then(function(f) { if (f === 'frob') resolved = true; });
  assert(resolved);
});

test('ThenResolve', function() {
  var resolved = false;
  var d = defer();
  d.promise.then(function(f) { if (f === 'frob') resolved = true; });
  d.resolve('frob');
  assert(resolved);
});

test('ThenThenResolve', function() {
  var d = defer(), called = false;
  d.promise
    .then(function(f) { if (f === 'foo') return 'bar'; })
    .then(function(b) { if (b === 'bar') called = true; });
  d.resolve('foo');
  assert(called);
});

test('ResolveThenThen', function() {
  var d = defer(), called = false;
  d.resolve('foo');
  d.promise
    .then(function(f) { if (f === 'foo') return 'bar'; })
    .then(function(b) { if (b === 'bar') called = true; });
  assert(called);
});

test('RejectThen', function() {
  var called = false;
  var d = defer();
  d.reject('frob');
  d.promise.then(assert.fail,
                 function(f) {
                   if (f === 'frob') called = true; });
  assert(called);
});

test('ThenReject', function() {
  var called = false;
  var d = defer();
  d.promise.then(assert.fail,
                 function(f) {
                   if (f === 'frob') called = true; });
  d.reject('frob');
  assert(called);
});

test('ThenThrowThen', function() {
  var called = false;
  var d = defer();
  d.promise
    .then(function() { throw 'foo'; })
    .then(assert.fail, function(f) { if (f === 'foo') called = true; });
  d.resolve();
  assert(called);
});

// Test that errors will get propagated when there's no explicit
// errback in the middle.
test('ThenThrowThenThen', function() {
  var called = false;
  var d = defer();
  d.promise
    .then(function() { throw 'foo'; })
    .then(function() { return 'bar'; })
    .then(assert.fail, function(f) { if ( f=== 'foo') called = true; });
  d.resolve();
  assert(called);
});

test('RejectThenThen', function() {
  var called = false;
  var d = defer();
  d.reject('foo');
  d.promise
    .then(assert.fail)
    .then(assert.fail, function(e) {
      if (e === 'foo') called = true;
    });
  assert(called);
});

test('ResolveThenThen', function() {
  var called = false;
  var d = defer();
  d.resolve('foo');
  d.promise
    .then(null, assert.fail)
    .then(function(f) {
      if (f === 'foo') called = true;
    }, assert.fail);
  assert(called);
});

});
