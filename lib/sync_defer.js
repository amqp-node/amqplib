//
//
//

// deferred/promises for which the callbacks are guaranteed to be
// called synchronously. This is important if you want to control
// which order things happen, e.g., if you wish to tell the user of
// the promise fullfilment before any more I/O is processed.

// To make things simpler these are one-shot; you can do then and
// resolve/reject in either order, and you can chain the results, but
// once you've used both then and resolve/reject, it's done.

// If you want to 'switch' to an async (and multi-shot) promise after
// the first handler, do something like
//
//    var d = sync_defer.defer();
//    return when(d.promise.then(function(v) {
//        syncStuff(v); return v;
//    }));
//
// where `when` is the typical promise-coercion thing you get with
// e.g., when.js.

function defer() {

  var me = {resolve: undefined,
            reject: undefined,
            promise: {then: undefined}};

  me.promise.then = function(callback, errback) {
    var d = defer();
    me.resolve = function(value) {
      try { d.resolve((callback) ? callback(value) : value); }
      catch (e) { d.reject(e); }
    };
    me.reject = function(err) {
      try { d.reject((errback) ? errback(err) : err); }
      catch (e) { d.reject(e); } // problematic; we just tried this
    };
    me.promise.then = error;
    return d.promise;
  };

  me.resolve = function(value) {
    me.promise.then = function(callback, errback) {
      var d = defer();
      try { d.resolve((callback) ? callback(value) : value); }
      catch (e) { d.reject(e) }
      return d.promise;
    };
    me.resolve = me.reject = error;
  };

  me.reject = function(value) {
    me.promise.then = function(callback, errback) {
      var d = defer();
      try { d.reject((errback) ? errback(value) : value) }
      catch (e) { d.reject(e) }
      return d.promise;
    };
    me.resolve = me.reject = error;
  };
  
  function error() {
    throw new Error("Then, resolve or reject called more than once");
  };
  
  return me;
}

module.exports.defer = defer;
