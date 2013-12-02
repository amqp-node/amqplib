'use strict';

var Connection = require('../lib/connection').Connection;
var PassThrough =
  require('stream').PassThrough ||
  require('readable-stream/passthrough');
var defer = require('when').defer;
var defs = require('../lib/defs');

var schedule = (typeof setImmediate === 'function') ?
  setImmediate : process.nextTick;


// Set up a socket pair {client, server}, such that writes to the
// client are readable from the server, and writes to the server are
// readable at the client.
//
//          +---+      +---+
//          | C |      | S |
// --write->| l |----->| e |--read-->
//          | i |      | r |
// <--read--| e |<-----| v |<-write--
//          | n |      | e |
//          | t |      | r |
//          +---+      +---+
//
// I also need to make sure that end called on either socket affects
// the other.

function socketPair() {
  var server = new PassThrough();
  var client = new PassThrough();
  server.write = client.push.bind(client);
  client.write = server.push.bind(server);
  function end(chunk, encoding) {
    if (chunk) this.push(chunk, encoding);
    this.push(null);
  }
  server.end = end.bind(client);
  client.end = end.bind(server);

  return {client: client, server: server};
}

function runServer(socket, run) {
  var frames = new Connection(socket);
  // We will be closing the socket without doing a closing handshake,
  // so cheat
  frames.expectSocketClose = true;
  // We also need to create some channel buffers, again a cheat
  frames.freshChannel(null);
  frames.freshChannel(null);
  frames.freshChannel(null);

  function send(id, fields, channel, content) {
    channel = channel || 0;
    if (content) {
      schedule(function() {
        frames.sendMessage(channel, id, fields,
                           defs.BasicProperties, fields,
                           content);
      });
    }
    else {
      schedule(function() {
        frames.sendMethod(channel, id, fields);
      });
    }
  }

  function await(method) {
    return function() {
      var d = defer();
      if (method) {
        frames.step(function(e, f) {
          if (e !== null) return d.reject(e);
          if (f.id === method)
            d.resolve(f);
          else
            d.reject(new Error("Expected method: " + method +
                               ", got " + f.id));
        });
      }
      else {
        frames.step(function(e, f) {
          if (e !== null) return d.reject(e);
          else d.resolve(f);
        });
      }
      return d.promise;
    };
  }
  run(send, await);
  return frames;
}

// Produce a callback that will complete the test successfully
function succeed(done) {
  return function() { done(); }
}

// Produce a callback that will fail the test, given either an error
// (to be used as a failure continuation) or any other value (to be
// used as a success continuation when failure is expected)
function fail(done) {
  return function(err) {
    if (err instanceof Error) done(err);
    else done(new Error("Expected to fail, instead got " + err.toString()));
  }
}

// Create a function that will call done once it's been called itself
// `count` times. If it's called with an error value, it will
// immediately call done with that error value.
function latch(count, done) {
  var awaiting = count;
  var alive = true;
  return function(err) {
    if (err instanceof Error && alive) {
      alive = false;
      done(err);
    }
    else {
      awaiting--;
      if (awaiting === 0 && alive) {
        alive = false;
        done();
      }
    }
  };
}

// Call a thunk with a continuation that will be called with an error
// if the thunk throws one, or nothing if it runs to completion.
function completes(thunk, done) {
  try {
    thunk();
    done();
  }
  catch (e) { done(e); }
}

module.exports = {
  socketPair: socketPair,
  runServer: runServer,
  succeed: succeed,
  fail: fail,
  latch: latch,
  completes: completes,
  schedule: schedule
};
