'use strict';
var util = require('util');
var crypto = require('crypto');
var net = require('net');
var WebSocket = require('./../../../v5/wsp');
var app = require('express')();

var PORT = 1234;

var args = (function() {
  var args = {};
  var rawArgs = Array.prototype.slice.call(process.argv).slice(2);
  var x, i=-1;
  while((x = rawArgs[++i])) {
    if(/^--/i.test(x)) {
      if(/=/.test(x)) {
        var pieces = x.split('=');
        args[pieces[0]] = pieces[1];
      } else {
        args[x] = rawArgs[i+1];
        ++i;
      }
    } else if(/^-/i.test(x)) {
      args[x] = null;
    }
  }
  return args;
}());

if('--port' in args) {
  PORT = args['--port'];
}

var config = {
  rabbitMqUrl: 'amqp://admin:admin@localhost:5672/',
  rpcExchange: 'example.rpc',
  rpcRequestQueue: 'rpc.request',
  rpcResponseQueue: 'rpc.response'
};

var server = app.listen(PORT, function() {
  process.stdout.write(util.format('[ Server ]  listening on %s\n', PORT));
  app.server = server;
  app.server.on('upgrade', function(req, socket) {
    var incomingKey = req.headers['sec-websocket-key'];
    var ws = new WebSocket({socket: socket});
    ws.upgradeReq = req;
    socket.write([
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: WebSocket',
      'Connection: Upgrade',
      'Sec-WebSocket-Accept: ' + crypto.createHash('sha1')
        .update(incomingKey + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
        .digest('base64'), '', ''
    ].join('\r\n'));

    // Upstream tunnel
    var amqpSocket = net.Socket();
    amqpSocket.setNoDelay(true);
    amqpSocket.on('error', function(err) {
      console.log(err);
    });
    amqpSocket.connect({host: 'localhost', port: 5672}, function(err) {
      if(err) {
        process.stderr.write(err.message + '\n');
      }
      process.stdout.write('Connected to AMQP broker\n');
      ws.pipe(amqpSocket).pipe(ws);
    });
  });
});

//// Controller ////////////////////////////////////////////////////////////////
function EchoController() { }
EchoController.prototype.echo = function(payload, cb) {
  return cb(null, payload);
};

var controller = new EchoController();


//// Server-side AMQP Client ///////////////////////////////////////////////////
var amqp = require('./../../callback_api');
amqp.connect(config.rabbitMqUrl, function(err, conn) {
  if(err) {
    process.stderr.write(err.message + '\n');
    process.exit(1);
  }

  // Channel for RabbitMQ logs: assumes `rabbitmqctl trace_on`
  conn.createChannel(function(err, ch) {
    ch.assertQueue('server_logs', {exclusive: true}, function(err, q) {
      ch.bindQueue(q.queue, 'amq.rabbitmq.log', '#');
      ch.bindQueue(q.queue, 'amq.rabbitmq.trace', '#');
      ch.consume(q.queue, function(msg) {
        msg.content = msg.content.toString().replace(/[\r\n]/ig, ' ');
        process.stdout.write(util.format('[ RabbitMQ ]  %s: %s\n',
          msg.fields.routingKey, msg.content));
      }, {noAck: true});
    });
  });

  // Channel for custom RPC API
  conn.createChannel(function(err, ch) {
    ch.assertExchange(config.rpcExchange, 'topic');
    ch.prefetch(1);
    ch.assertQueue('rpc.request', {
      durable: false,
      messageTtl: 60000
    }, function(err, q) {
      ch.bindQueue(q.queue, config.rpcExchange, '#');
      ch.consume(q.queue, function(msg) {
        var respond = function(err, data) {
          data = !err ? data : {error: err.message};
          data = data || null;
          ch.sendToQueue(
            msg.properties.replyTo,
            Buffer.from(JSON.stringify(data)),
            {correlationId: msg.properties.correlationId}
          );
          ch.ack(msg);
        };

        var method = msg.fields.routingKey.split('.')[0];
        var payload = null;
        if(msg.content.length > 0) {
          payload = JSON.parse(msg.content);
        }

        if(!(method in controller)) {
          var errMsg = 'API method `' + method + '` not defined';
          process.stderr.write(errMsg + '\n');
          return respond(new Error(errMsg));
        }

        controller[method](payload, respond);
      });
    });
  });
});
