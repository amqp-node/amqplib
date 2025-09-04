const connect = require('../lib/connect').connect;
const credentialsFromUrl = require('../lib/connect').credentialsFromUrl;
const defs = require('../lib/defs');
const assert = require('node:assert');
const util = require('./util');
const net = require('node:net');
const fail = util.fail,
  succeed = util.succeed,
  latch = util.latch,
  kCallback = util.kCallback,
  succeedIfAttributeEquals = util.succeedIfAttributeEquals;
const format = require('node:util').format;

const URL = process.env.URL || 'amqp://localhost';

const urlparse = require('url-parse');

suite('Credentials', () => {
  function checkCreds(creds, user, pass, done) {
    if (creds.mechanism !== 'PLAIN') {
      return done('expected mechanism PLAIN');
    }
    if (creds.username !== user || creds.password !== pass) {
      return done(format("expected '%s', '%s'; got '%s', '%s'", user, pass, creds.username, creds.password));
    }
    done();
  }

  test('no creds', (done) => {
    const parts = urlparse('amqp://localhost');
    const creds = credentialsFromUrl(parts);
    checkCreds(creds, 'guest', 'guest', done);
  });
  test('usual user:pass', (done) => {
    const parts = urlparse('amqp://user:pass@localhost');
    const creds = credentialsFromUrl(parts);
    checkCreds(creds, 'user', 'pass', done);
  });
  test('missing user', (done) => {
    const parts = urlparse('amqps://:password@localhost');
    const creds = credentialsFromUrl(parts);
    checkCreds(creds, '', 'password', done);
  });
  test('missing password', (done) => {
    const parts = urlparse('amqps://username:@localhost');
    const creds = credentialsFromUrl(parts);
    checkCreds(creds, 'username', '', done);
  });
  test('escaped colons', (done) => {
    const parts = urlparse('amqp://user%3Aname:pass%3Aword@localhost');
    const creds = credentialsFromUrl(parts);
    checkCreds(creds, 'user:name', 'pass:word', done);
  });
});

suite('Connect API', () => {
  test('Connection refused', (done) => {
    connect('amqp://localhost:23450', {}, kCallback(fail(done), succeed(done)));
  });

  // %% this ought to fail the promise, rather than throwing an error
  test('bad URL', () => {
    assert.throws(() => {
      connect('blurble');
    });
  });

  test('wrongly typed open option', (done) => {
    const url = require('node:url');
    const parts = url.parse(URL, true);
    const q = parts.query || {};
    q.frameMax = 'NOT A NUMBER';
    parts.query = q;
    const u = url.format(parts);
    connect(u, {}, kCallback(fail(done), succeed(done)));
  });

  test('serverProperties', (done) => {
    const url = require('node:url');
    const parts = url.parse(URL, true);
    const config = parts.query || {};
    connect(config, {}, (err, connection) => {
      if (err) {
        return done(err);
      }
      assert.equal(connection.serverProperties.product, 'RabbitMQ');
      done();
    });
  });

  test('using custom heartbeat option', (done) => {
    const url = require('node:url');
    const parts = url.parse(URL, true);
    const config = parts.query || {};
    config.heartbeat = 20;
    connect(config, {}, kCallback(succeedIfAttributeEquals('heartbeat', 20, done), fail(done)));
  });

  test('wrongly typed heartbeat option', (done) => {
    const url = require('node:url');
    const parts = url.parse(URL, true);
    const config = parts.query || {};
    config.heartbeat = 'NOT A NUMBER';
    connect(config, {}, kCallback(fail(done), succeed(done)));
  });

  test('using plain credentials', (done) => {
    const url = require('node:url');
    const parts = url.parse(URL, true);
    let u = 'guest',
      p = 'guest';
    if (parts.auth) {
      const auth = parts.auth.split(':');
      (u = auth[0]), (p = auth[1]);
    }
    connect(URL, {credentials: require('../lib/credentials').plain(u, p)}, kCallback(succeed(done), fail(done)));
  });

  test('using amqplain credentials', (done) => {
    const url = require('node:url');
    const parts = url.parse(URL, true);
    let u = 'guest',
      p = 'guest';
    if (parts.auth) {
      const auth = parts.auth.split(':');
      (u = auth[0]), (p = auth[1]);
    }
    connect(URL, {credentials: require('../lib/credentials').amqplain(u, p)}, kCallback(succeed(done), fail(done)));
  });

  test('ipv6', (done) => {
    connect('amqp://[::1]', {}, (err, _connection) => {
      if (err) {
        return done(err);
      }
      done();
    });
  });

  test('using unsupported mechanism', (done) => {
    const creds = {
      mechanism: 'UNSUPPORTED',
      response: () => Buffer.from(''),
    };
    connect(URL, {credentials: creds}, kCallback(fail(done), succeed(done)));
  });

  test('with a given connection timeout', (done) => {
    const timeoutServer = net.createServer(() => {}).listen(31991);

    connect('amqp://localhost:31991', {timeout: 50}, (_err, val) => {
      timeoutServer.close();
      if (val) done(new Error('Expected connection timeout, did not'));
      else done();
    });
  });
});

suite('Errors on connect', () => {
  let server;
  teardown(() => {
    if (server) {
      server.close();
    }
  });

  test('closes underlying connection on authentication error', (done) => {
    const bothDone = latch(2, done);
    server = net
      .createServer((socket) => {
        socket.once('data', (protocolHeader) => {
          assert.deepStrictEqual(protocolHeader, Buffer.from(`AMQP${String.fromCharCode(0, 0, 9, 1)}`));
          util.runServer(socket, (send, wait) => {
            send(defs.ConnectionStart, {
              versionMajor: 0,
              versionMinor: 9,
              serverProperties: {},
              mechanisms: Buffer.from('PLAIN'),
              locales: Buffer.from('en_US'),
            });
            wait(defs.ConnectionStartOk)().then(() => {
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
        socket.once('end', () => {
          bothDone();
        });
      })
      .listen(0);

    connect(`amqp://localhost:${server.address().port}`, {}, (err) => {
      if (!err) bothDone(new Error('Expected authentication error'));
      bothDone();
    });
  });
});
