'use strict';

var connect = require('../lib/connect').connect;
var assert = require('assert');
var util = require('./util');
var net = require('net');
var fail = util.fail, succeed = util.succeed,
    kCallback = util.kCallback;

var URL = process.env.URL || 'amqp://localhost';

suite("Connect API", function() {

  test("Connection refused", function(done) {
    connect('amqp://localhost:23450', {},
            kCallback(fail(done), succeed(done)));
  });
  
  // %% this ought to fail the promise, rather than throwing an error
  test("bad URL", function() {
    assert.throws(function() {
      connect('blurble');
    });
  });

  test("wrongly typed open option", function(done) {
    var url = require('url');
    var parts = url.parse(URL, true);
    var q = parts.query || {};
    q.frameMax = 'NOT A NUMBER';
    parts.query = q;
    var u = url.format(parts);
    connect(u, {}, kCallback(fail(done), succeed(done)));
  });

  test("using plain credentials", function(done) {
    var url = require('url');
    var parts = url.parse(URL, true);
    var u = 'guest', p = 'guest';
    if (parts.auth) {
      var auth = parts.auth.split(":");
      u = auth[0], p = auth[1];
    }
    connect(URL, {credentials: require('../lib/credentials').plain(u, p)},
            kCallback(succeed(done), fail(done)));
  });

  test("using unsupported mechanism", function(done) {
    var creds = {
      mechanism: 'UNSUPPORTED',
      response: function() { return new Buffer(''); }
    };
    connect(URL, {credentials: creds},
            kCallback(fail(done), succeed(done)));
  });

  test("with a given connection timeout", function(done) {
    var timeoutServer = net.createServer(function() {}).listen(31991);

    connect('amqp://localhost:31991', {timeout: 50}, function(err, val) {
        timeoutServer.close();
        if (val) done(new Error('Expected connection timeout, did not'));
        else done();
    });
  });

});
