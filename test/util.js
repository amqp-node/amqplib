import crypto from 'crypto';
import { Connection } from '../lib/connection.js';
import { PassThrough } from 'stream';
import * as defs from '../lib/defs.js';
import assert from 'assert';

const schedule = (typeof setImmediate === 'function') ?
  setImmediate : process.nextTick;

function randomString() {
  const hash = crypto.createHash('sha1');
  hash.update(crypto.randomBytes(64));
  return hash.digest('base64');
}


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
  const server = new PassThrough();
  const client = new PassThrough();
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
  const frames = new Connection(socket);
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

  function wait(method) {
    return function() {
      return new Promise(function(resolve, reject) {
        if (method) {
          frames.step(function(e, f) {
            if (e !== null) return reject(e);
            if (f.id === method)
              resolve(f);
            else
              reject(new Error("Expected method: " + method +
                                 ", got " + f.id));
          });
        }
        else {
          frames.step(function(e, f) {
            if (e !== null) return reject(e);
            else resolve(f);
          });
        }
      });
    };
  }
  run(send, wait);
  return frames;
}

// Produce a callback that will complete the test successfully
function succeed(done) {
    return () => done();
}

// Produce a callback that will complete the test successfully
// only if the value is an object, it has the specified
// attribute, and its value is equals to the expected value
function succeedIfAttributeEquals(attribute, value, done) {
  return function(object) {
    if (object && !(object instanceof Error) && value === object[attribute]) {
      return done();
    }

    done(new Error(attribute + " is not equal to " + value));
  };
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
  let awaiting = count;
  let alive = true;
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

// Construct a Node.JS-style callback from a success continuation and
// an error continuation
function kCallback(k, ek) {
  return function(err, val) {
    if (err === null) k && k(val);
    else ek && ek(err);
  };
}

// A noddy way to make tests depend on the node version.
function versionGreaterThan(actual, spec) {

  function int(e) { return parseInt(e); }

  const version = actual.split('.').map(int);
  const desired = spec.split('.').map(int);
  for (let i=0; i < desired.length; i++) {
    const a = version[i], b = desired[i];
    if (a != b) return a > b;
  }
  return false;
}

suite('versionGreaterThan', function() {

test('full spec', function() {
  assert(versionGreaterThan('0.8.26', '0.6.12'));
  assert(versionGreaterThan('0.8.26', '0.8.21'));
});

test('partial spec', function() {
  assert(versionGreaterThan('0.9.12', '0.8'));
});

test('not greater', function() {
  assert(!versionGreaterThan('0.8.12', '0.8.26'));
  assert(!versionGreaterThan('0.6.2', '0.6.12'));
  assert(!versionGreaterThan('0.8.29', '0.8'));
});

test

});

export {
  socketPair,
  runServer,
  succeed,
  succeedIfAttributeEquals,
  fail,
  latch,
  completes,
  kCallback,
  schedule,
  randomString,
  versionGreaterThan,
}
