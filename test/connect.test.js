const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert');
const net = require('node:net');
const connect = require('../lib/connect').connect;
const DEFAULT_MAX_FRAME_SIZE = require('../lib/connection').DEFAULT_MAX_FRAME_SIZE;
const defs = require('../lib/defs');
const { plain, amqplain } = require('../lib/credentials')
const { latch, runServer } = require('./lib/util');

describe('Connect', () => {

  describe('Connect API', () => {

    let connection;

    afterEach((_t, done) => {
      if (connection) connection.close(() => done())
      else done();
    });

    it('Connection refused', (_t, done) => {
      connect('amqp://localhost:23450', {}, (err) => {
        assert.strictEqual(err.code, 'ECONNREFUSED');
        done();
      });
    });

    // %% this ought to fail the promise, rather than throwing an error
    it('bad URL', (_t, done) => {
      assert.throws(() => connect('blurble'), (err) => {
        assert.match(err.message, /Expected amqp: or amqps: as the protocol/);
        return true;
      });
      done();
    });

    it('wrongly typed open option', (_t, done) => {
      connect('amqp://localhost?frameMax=NOT_A_NUMBER', {}, (err) => {
        assert.match(err.message, /Field 'frameMax' is the wrong type/);
        done();
      });
    });

    it('serverProperties', (_t, done) => {
      connect({ protocol: 'amqp', hostname: 'localhost' }, {}, (err, _connection) => {
        connection = _connection;
        assert.ifError(err);
        assert.equal(connection.serverProperties.product, 'RabbitMQ');
        done();
      });
    });

    it('using custom heartbeat option', (_t, done) => {
      connect({ heartbeat: 20 }, {}, (err, _connection) => {
        assert.ifError(err);
        connection = _connection;
        assert.strictEqual(connection.heartbeat, 20);
        done();
      });
    });

    it('wrongly typed heartbeat option', (_t, done) => {
      connect('amqp://localhost?heartbeat=NOT_A_NUMBER', {}, (err) => {
        assert.match(err.message, /Field 'heartbeat' is the wrong type/);
        done();
      });
    });

    it('using custom maxFrameSize option', (_t, done) => {
      connect({ maxFrameSize: 1048576 }, {}, (err, _connection) => {
        assert.ifError(err);
        connection = _connection;
        assert.strictEqual(connection.maxFrameSize, 1048576);
        done();
      });
    });

    it('using maxFrameSize from the URL', (_t, done) => {
      connect('amqp://localhost?maxFrameSize=1048576', {}, (err, _connection) => {
        assert.ifError(err);
        connection = _connection;
        assert.strictEqual(connection.maxFrameSize, 1048576);
        done();
      });
    });

    it('maxFrameSize with a leading-0x typo is rejected, not silently unlimited', (_t, done) => {
      connect('amqp://localhost?maxFrameSize=0x4000000', {}, (err, _connection) => {
        connection = _connection;
        assert.ok(err);
        assert.match(err.message, /maxFrameSize must be 0 \(no limit\) or an integer of at least 4096/);
        done();
      });
    });

    it('a non-integer maxFrameSize is rejected', (_t, done) => {
      connect('amqp://localhost?maxFrameSize=4096.5', {}, (err, _connection) => {
        connection = _connection;
        assert.ok(err);
        assert.match(err.message, /maxFrameSize must be 0 \(no limit\) or an integer of at least 4096/);
        done();
      });
    });

    it('maxFrameSize of null uses the default', (_t, done) => {
      connect({ maxFrameSize: null }, {}, (err, _connection) => {
        assert.ifError(err);
        connection = _connection;
        assert.strictEqual(connection.maxFrameSize, DEFAULT_MAX_FRAME_SIZE);
        done();
      });
    });

    it('maxFrameSize of 0 means no limit', (_t, done) => {
      connect({ maxFrameSize: 0 }, {}, (err, _connection) => {
        assert.ifError(err);
        connection = _connection;
        assert.strictEqual(connection.maxFrameSize, 0);
        done();
      });
    });

    it('wrongly typed maxFrameSize option', (_t, done) => {
      connect('amqp://localhost?maxFrameSize=NOT_A_NUMBER', {}, (err, _connection) => {
        connection = _connection;
        assert.ok(err);
        assert.match(err.message, /maxFrameSize must be 0 \(no limit\) or an integer of at least 4096/);
        done();
      });
    });

    it('maxFrameSize below the protocol minimum', (_t, done) => {
      connect({ maxFrameSize: 100 }, {}, (err, _connection) => {
        connection = _connection;
        assert.ok(err);
        assert.match(err.message, /maxFrameSize must be 0 \(no limit\) or an integer of at least 4096; got 100/);
        done();
      });
    });

    it('using plain credentials', (_t, done) => {
      connect('amqp://localhost', { credentials: plain('guest', 'guest') }, (err, _connection) => {
        assert.ifError(err);
        connection = _connection;
        done();
      });
    });

    it('using amqplain credentials', (_t, done) => {
      connect('amqp://localhost', { credentials: amqplain('guest', 'guest') }, (err, _connection) => {
        assert.ifError(err);
        connection = _connection;
        done();
      });
    });

    it('ipv6', (_t, done) => {
      connect('amqp://[::1]', {}, (err, _connection) => {
        assert.ifError(err);
        connection = _connection;
        done();
      });
    });

    it('using unsupported mechanism',  (_t, done) => {
      const credentials = { mechanism: 'UNSUPPORTED', response: () => Buffer.from('') };
      connect('amqp://localhost', { credentials }, (err) => {
        assert.match(err.message, /SASL mechanism UNSUPPORTED is not provided by the server/);
        done();
      });
    });

    it('with a given connection timeout', (_t, done) => {
      const timeoutServer = net.createServer(() => { }).listen(31991);

      connect('amqp://localhost:31991', { timeout: 50 }, (err) => {
        timeoutServer.close();
        assert.match(err.message, /ETIMEDOUT/);
        done();
      });
    });
  });

  describe('Errors on connect', () => {

    let server;

    afterEach(() => {
      if (server) server.close();
    });

    it('closes underlying connection on authentication error', (_t, done) => {
      const decrementLatch = latch(2, done);
      server = net.createServer((socket) => {
        socket.once('data', (protocolHeader) => {
          assert.deepStrictEqual(protocolHeader, Buffer.from(`AMQP${String.fromCharCode(0, 0, 9, 1)}`));
          runServer(socket, (send, wait) => {
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
        socket.once('end', () => decrementLatch());
      });
      server.listen(0);

      connect(`amqp://localhost:${server.address().port}`, {}, (err) => {
        assert.match(err.message, /Handshake terminated by server: 403 \(ACCESS-REFUSED\)/);
        decrementLatch();
      });
    });
  });

});
