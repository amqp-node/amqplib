'use strict';

var assert = require('assert');
var crypto = require('crypto');
var api = require('../callback_api');
var util = require('./util');
var schedule = util.schedule;
var randomString = util.randomString;

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
    ch.sendToQueue(q.queue, new Buffer(msg));
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
    ch.sendToQueue(q.queue, new Buffer(msg));
  });
});

channel_test('send to and get from queue', function(ch, done) {
  ch.assertQueue('', {exclusive: true}, function(e, q) {
    if (e != null) return done(e);
    var msg = randomString();
    ch.sendToQueue(q.queue, new Buffer(msg));
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
  ch.publish('amq.topic', 'no.one.bound', new Buffer('foo'),
             {}, done);
});

});
