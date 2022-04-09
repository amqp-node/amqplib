'use strict';

var connect = require('../lib/connect').connect;
var credentialsFromUrl = require('../lib/connect').credentialsFromUrl;
var defs = require('../lib/defs');
var assert = require('assert');
var util = require('./util');
var net = require('net');
var parseUrl = require('url').parse;
var fail = util.fail, succeed = util.succeed, latch = util.latch,
    kCallback = util.kCallback,
    succeedIfAttributeEquals = util.succeedIfAttributeEquals;
var format = require('util').format;

var baseURL = process.env.URL || 'amqp://localhost';


suite("Credentials", function() {

  function checkCreds(creds, user, pass, done) {
    if (creds.mechanism != 'PLAIN') {
      return done('expected mechanism PLAIN');
    }
    if (creds.username != user || creds.password != pass) {
      return done(format("expected '%s', '%s'; got '%s', '%s'",
                         user, pass, creds.username, creds.password));
    }
    done();
  }

  test("no creds", function(done) {
    var parts = new URL('amqp://localhost');
    var creds = credentialsFromUrl(parts);
    checkCreds(creds, 'guest', 'guest', done);
  });
  test("usual user:pass", function(done) {
    var parts = new URL('amqp://user:pass@localhost')
    var creds = credentialsFromUrl(parts);
    checkCreds(creds, 'user', 'pass', done);
  });
  test("missing user", function(done) {
    var parts = new URL('amqps://:password@localhost');
    var creds = credentialsFromUrl(parts);
    checkCreds(creds, '', 'password', done);
  });
  test("missing password", function(done) {
    var parts = new URL('amqps://username:@localhost');
    var creds = credentialsFromUrl(parts);
    checkCreds(creds, 'username', '', done);
  });
  test("escaped colons", function(done) {
    var parts = new URL('amqp://user%3Aname:pass%3Aword@localhost')
    var creds = credentialsFromUrl(parts);
    checkCreds(creds, 'user:name', 'pass:word', done);
  });
});

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

  [
    ["As instance of URL", url => url ],
    ["As string", url => url.href ],
  ].forEach(([suiteDescription, processURL]) => {
    suite(suiteDescription, () => {
      test("wrongly typed open option", function(done) {
        var url = new URL(baseURL);
        url.searchParams.set('frameMax', 'NOT A NUMBER');
        connect(processURL(url), {}, kCallback(fail(done), succeed(done)));
      });

      test("serverProperties", function(done) {
        var url = new URL(baseURL);
        connect(processURL(url), {}, function(err, connection) {
          if (err) { return done(err); }
          assert.equal(connection.serverProperties.product, 'RabbitMQ');
          done();
        });
      });

      test("using custom heartbeat option", function(done) {
        var url = new URL(baseURL);
        url.searchParams.set('heartbeat', 20);
        connect(processURL(url), {}, kCallback(succeedIfAttributeEquals('heartbeat', 20, done), fail(done)));
      });

      test("wrongly typed heartbeat option", function(done) {
        var url = new URL(baseURL);
        url.searchParams.set('heartbeat', 'NOT A NUMBER');
        connect(processURL(url), {}, kCallback(fail(done), succeed(done)));
      });

      test("using plain credentials", function(done) {
        var url = new URL(baseURL);
        var u = url.username || 'guest';
        var p = url.password || 'guest';
        connect(processURL(url), {credentials: require('../lib/credentials').plain(u, p)},
                kCallback(succeed(done), fail(done)));
      });

      test("using amqplain credentials", function(done) {
        var url = new URL(baseURL);
        var u = url.username || 'guest';
        var p = url.password || 'guest';
        connect(processURL(url), {credentials: require('../lib/credentials').amqplain(u, p)},
                kCallback(succeed(done), fail(done)));
      });

      test("using unsupported mechanism", function(done) {
        var creds = {
          mechanism: 'UNSUPPORTED',
          response: function() { return Buffer.from(''); }
        };
        connect(processURL(baseURL), {credentials: creds},
                kCallback(fail(done), succeed(done)));
      });

      test("with a given connection timeout", function(done) {
        var timeoutServer = net.createServer(function() {}).listen(31991);
        var url = new URL('amqp://localhost:31991');
        connect(processURL(url), {timeout: 50}, function(err, val) {
            timeoutServer.close();
            if (val) done(new Error('Expected connection timeout, did not'));
            else done();
        });
      });
    });
  });
});

suite('Errors on connect', function() {
  var server
  afterEach(function() {
    if (server) {
      server.close();
    }
  })

  test("closes underlying connection on authentication error", function(done) {
    var bothDone = latch(2, done);
    server = net.createServer(function(socket) {
      socket.once('data', function(protocolHeader) {
        assert.deepStrictEqual(
          protocolHeader,
          Buffer.from("AMQP" + String.fromCharCode(0,0,9,1))
        );
        util.runServer(socket, function(send, wait) {
          send(defs.ConnectionStart,
            {versionMajor: 0,
              versionMinor: 9,
              serverProperties: {},
              mechanisms: Buffer.from('PLAIN'),
              locales: Buffer.from('en_US')});
          wait(defs.ConnectionStartOk)().then(function() {
            send(defs.ConnectionClose,
              {replyCode: 403,
              replyText: 'ACCESS_REFUSED - Login was refused using authentication mechanism PLAIN',
              classId: 0,
              methodId: 0});
          });
        });
      });

      // Wait for the connection to be closed after the authentication error
      socket.once('end', function() {
        bothDone();
      });
    }).listen(0);

    connect('amqp://localhost:' + server.address().port, {}, function(err) {
      if (!err) bothDone(new Error('Expected authentication error'));
      bothDone();
    });
  });
});
