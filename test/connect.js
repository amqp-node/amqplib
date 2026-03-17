'use strict';

const connect = require('../lib/connect').connect;
const credentialsFromUrl = require('../lib/connect').credentialsFromUrl;
const defs = require('../lib/defs');
const assert = require('assert');
const util = require('./util');
const net = require('net');
const fail = util.fail,
  succeed = util.succeed,
  latch = util.latch,
  kCallback = util.kCallback,
  succeedIfAttributeEquals = util.succeedIfAttributeEquals;
const format = require('util').format;

const AMQP_URL = process.env.URL || 'amqp://localhost';

suite('Credentials', function () {
  function checkCreds(creds, user, pass, done) {
    if (creds.mechanism != 'PLAIN') {
      return done('expected mechanism PLAIN');
    }
    if (creds.username != user || creds.password != pass) {
      return done(format("expected '%s', '%s'; got '%s', '%s'", user, pass, creds.username, creds.password));
    }
    done();
  }

  test('no creds', function (done) {
    const parts = new URL('amqp://localhost');
    const creds = credentialsFromUrl(parts);
    checkCreds(creds, 'guest', 'guest', done);
  });
  test('usual user:pass', function (done) {
    const parts = new URL('amqp://user:pass@localhost');
    const creds = credentialsFromUrl(parts);
    checkCreds(creds, 'user', 'pass', done);
  });
  test('missing user', function (done) {
    const parts = new URL('amqps://:password@localhost');
    const creds = credentialsFromUrl(parts);
    checkCreds(creds, '', 'password', done);
  });
  test('missing password', function (done) {
    const parts = new URL('amqps://username:@localhost');
    const creds = credentialsFromUrl(parts);
    checkCreds(creds, 'username', '', done);
  });
  test('escaped colons', function (done) {
    const parts = new URL('amqp://user%3Aname:pass%3Aword@localhost');
    const creds = credentialsFromUrl(parts);
    checkCreds(creds, 'user:name', 'pass:word', done);
  });
});

suite('Connect API', function () {
  test('Connection refused', function (done) {
    connect('amqp://localhost:23450', {}, kCallback(fail(done), succeed(done)));
  });

  // %% this ought to fail the promise, rather than throwing an error
  test('bad URL', function () {
    assert.throws(function () {
      connect('blurble');
    });
  });

  test('empty protocol on URL-like object defaults to amqp', function (done) {
    assert.doesNotThrow(function () {
      connect({protocol: '', hostname: 'localhost', port: 23450}, {}, kCallback(fail(done), succeed(done)));
    });
  });

  test('wrongly typed open option', function (done) {
    const parts = new URL(AMQP_URL);
    parts.searchParams.set('frameMax', 'NOT A NUMBER');
    const u = parts.toString();
    connect(u, {}, kCallback(fail(done), succeed(done)));
  });

  test('serverProperties', function (done) {
    const parts = new URL(AMQP_URL);
    const config = Object.fromEntries(parts.searchParams.entries());
    connect(config, {}, function (err, connection) {
      if (err) {
        return done(err);
      }
      assert.equal(connection.serverProperties.product, 'RabbitMQ');
      done();
    });
  });

  test('using custom heartbeat option', function (done) {
    const parts = new URL(AMQP_URL);
    const config = Object.fromEntries(parts.searchParams.entries());
    config.heartbeat = 20;
    connect(config, {}, kCallback(succeedIfAttributeEquals('heartbeat', 20, done), fail(done)));
  });

  test('wrongly typed heartbeat option', function (done) {
    const parts = new URL(AMQP_URL);
    const config = Object.fromEntries(parts.searchParams.entries());
    config.heartbeat = 'NOT A NUMBER';
    connect(config, {}, kCallback(fail(done), succeed(done)));
  });

  test('using plain credentials', function (done) {
    const parts = new URL(AMQP_URL);
    let u = 'guest',
      p = 'guest';
    if (parts.username !== '' || parts.password !== '') {
      u = unescape(parts.username);
      p = unescape(parts.password);
    }
    connect(AMQP_URL, {credentials: require('../lib/credentials').plain(u, p)}, kCallback(succeed(done), fail(done)));
  });

  test('using amqplain credentials', function (done) {
    const parts = new URL(AMQP_URL);
    let u = 'guest',
      p = 'guest';
    if (parts.username !== '' || parts.password !== '') {
      u = unescape(parts.username);
      p = unescape(parts.password);
    }
    connect(AMQP_URL, {credentials: require('../lib/credentials').amqplain(u, p)}, kCallback(succeed(done), fail(done)));
  });

  test('ipv6', function (done) {
    connect('amqp://[::1]', {}, function (err, _connection) {
      if (err) {
        return done(err);
      }
      done();
    });
  });

  test('using unsupported mechanism', function (done) {
    const creds = {
      mechanism: 'UNSUPPORTED',
      response: function () {
        return Buffer.from('');
      },
    };
    connect(AMQP_URL, {credentials: creds}, kCallback(fail(done), succeed(done)));
  });

  test('with a given connection timeout', function (done) {
    const timeoutServer = net.createServer(function () {}).listen(31991);

    connect('amqp://localhost:31991', {timeout: 50}, function (_err, val) {
      timeoutServer.close();
      if (val) done(new Error('Expected connection timeout, did not'));
      else done();
    });
  });
});

suite('Errors on connect', function () {
  let server;
  teardown(function () {
    if (server) {
      server.close();
    }
  });

  test('closes underlying connection on authentication error', function (done) {
    const bothDone = latch(2, done);
    server = net
      .createServer(function (socket) {
        socket.once('data', function (protocolHeader) {
          assert.deepStrictEqual(protocolHeader, Buffer.from('AMQP' + String.fromCharCode(0, 0, 9, 1)));
          util.runServer(socket, function (send, wait) {
            send(defs.ConnectionStart, {
              versionMajor: 0,
              versionMinor: 9,
              serverProperties: {},
              mechanisms: Buffer.from('PLAIN'),
              locales: Buffer.from('en_US'),
            });
            wait(defs.ConnectionStartOk)().then(function () {
              send(defs.ConnectionClose, {
                replyCode: 403,
                replyText: 'ACCESS_REFUSED - Login was refused using authentication mechanism PLAIN',
                classId: 0,
                methodId: 0,
              });
            });
          });
        });

        // Wait for the connection to be closed after the authentication error
        socket.once('end', function () {
          bothDone();
        });
      })
      .listen(0);

    connect('amqp://localhost:' + server.address().port, {}, function (err) {
      if (!err) bothDone(new Error('Expected authentication error'));
      bothDone();
    });
  });

  test('uses vhost from URL pathname', function (done) {
    const expectedVhost = 'my-vhost';
    const bothDone = latch(2, done);

    server = net
      .createServer(function (socket) {
        socket.once('data', function (protocolHeader) {
          assert.deepStrictEqual(protocolHeader, Buffer.from('AMQP' + String.fromCharCode(0, 0, 9, 1)));
          util.runServer(socket, function (send, wait) {
            send(defs.ConnectionStart, {
              versionMajor: 0,
              versionMinor: 9,
              serverProperties: {},
              mechanisms: Buffer.from('PLAIN'),
              locales: Buffer.from('en_US'),
            });

            wait(defs.ConnectionStartOk)()
              .then(function () {
                send(defs.ConnectionTune, {
                  channelMax: 0,
                  heartbeat: 0,
                  frameMax: 0,
                });
              })
              .then(wait(defs.ConnectionTuneOk))
              .then(wait(defs.ConnectionOpen))
              .then(function (frame) {
                assert.strictEqual(frame.fields.virtualHost, expectedVhost);
                send(defs.ConnectionOpenOk, {knownHosts: ''});
                bothDone();
              })
              .catch(bothDone);
          });
        });
      })
      .listen(0);

    connect('amqp://localhost:' + server.address().port + '/' + expectedVhost, {}, function (err, connection) {
      if (err) {
        return bothDone(err);
      }
      connection.close();
      bothDone();
    });
  });

  test('uses first locale when query contains duplicates', function (done) {
    const bothDone = latch(2, done);

    server = net
      .createServer(function (socket) {
        socket.once('data', function (protocolHeader) {
          assert.deepStrictEqual(protocolHeader, Buffer.from('AMQP' + String.fromCharCode(0, 0, 9, 1)));
          util.runServer(socket, function (send, wait) {
            send(defs.ConnectionStart, {
              versionMajor: 0,
              versionMinor: 9,
              serverProperties: {},
              mechanisms: Buffer.from('PLAIN'),
              locales: Buffer.from('en_US'),
            });

            wait(defs.ConnectionStartOk)()
              .then(function (frame) {
                assert.strictEqual(frame.fields.locale, 'en_US');
                bothDone();
                send(defs.ConnectionTune, {
                  channelMax: 0,
                  heartbeat: 0,
                  frameMax: 0,
                });
              })
              .then(wait(defs.ConnectionTuneOk))
              .then(wait(defs.ConnectionOpen))
              .then(function () {
                send(defs.ConnectionOpenOk, {knownHosts: ''});
              })
              .catch(bothDone);
          });
        });
      })
      .listen(0);

    connect('amqp://localhost:' + server.address().port + '?locale=en_US&locale=fr_FR', {}, function (err, connection) {
      if (err) {
        return bothDone(err);
      }
      connection.close();
      bothDone();
    });
  });
});
