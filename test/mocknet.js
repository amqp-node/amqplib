var Frames = require('../lib/frame');
var PassThrough =
  require('stream').PassThrough ||
  require('readable-stream/passthrough');
var defer = require('when').defer;

// Assume Frames works fine, now test Connection.

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

function socketPair() {
  var server = new PassThrough();
  var client = new PassThrough();
  server.write = client.push.bind(client);
  client.write = server.push.bind(server);
  return {client: client, server: server};
}

function runServer(socket, run) {
  var frames = new Frames(socket);

  function send(id, fields, channel) {
    channel = channel || 0;
    frames.sendMethod(channel, id, fields);
  }

  function await(method) {
    return function() {
      var d = defer();
      if (method) {
        frames.accept = function(f) {
          if (f.id === method)
            d.resolve(f);
          else
            d.reject(new Error("Expected method: " + method +
                               ", got " + f.id));
        };
      }
      else {
        frames.accept = d.resolve.bind(d);
      }
      frames.step();
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
  return function(err) {
    if (err instanceof Error) {
      done(err);
    }
    else {
      awaiting--;
      if (awaiting === 0) {
        done();
      }
    }
  };
}

module.exports = {
  socketPair: socketPair,
  runServer: runServer,
  succeed: succeed,
  fail: fail,
  latch: latch
};
