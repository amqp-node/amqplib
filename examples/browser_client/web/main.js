/* global WebSocket, window, document */
'use strict';
var format = require('util').format;

var Connection = require('./../../../lib/ws_connection').WebSocketConnection;
var CallbackModel = require('./../../../lib/callback_model').CallbackModel;

var correlationIds = {};
var connection;
var channel;

var outputContainer;

var r = Math.random().toString();

var amqpConfig = {
  tunnelHost: 'slackware',
  tunnelPort: '1234',
  username: 'admin',
  password: 'admin',
  rpcExchange: 'example.rpc',
  rpcRequestQueue: 'rpc.request.WEB-' + r,
  rpcResponseQueue: 'rpc.response.WEB-' + r
};

var ws = new WebSocket('ws://' + amqpConfig.tunnelHost + ':' +
  amqpConfig.tunnelPort);

function publishMessage(method, payload) {
  var correlationId = Math.random().toString();
  correlationIds[correlationId] = true;
  channel.publish(
    amqpConfig.rpcExchange,
    method,
    Buffer.from(JSON.stringify(payload)), {
      correlationId: correlationId,
      replyTo: amqpConfig.rpcResponseQueue
    }
  );
}

function onMessage(msg) {
  if(!(msg.properties.correlationId in correlationIds)) {
    return;
  }
  delete correlationIds[msg.properties.correlationId];
  msg.content = JSON.parse(msg.content.toString());
  var outputMessage = format('[ RX ] @ %s \n%s\n\n', new Date().toISOString(),
    JSON.stringify(msg, null, '  '));
  console.log(outputMessage);
  outputContainer.appendChild(document.createTextNode(outputMessage));
  outputContainer.scrollTop = outputContainer.scrollHeight;
}

ws.onopen = function() {
  connection = new Connection();
  connection.open({
    username: amqpConfig.username,
    password: amqpConfig.password
  }, function(err) {
    if(err) {
      return console.error(err.message);
    }
    connection = new CallbackModel(connection);
    connection.createChannel(function(err, ch) {
      if(err) {
        return console.log(err);
      }
      ch.assertQueue(null, {exclusive: true}, function(err, q) {
        ch.bindQueue(q.queue, 'amq.rabbitmq.log', '#');
        ch.bindQueue(q.queue, 'amq.rabbitmq.trace', '#');
        channel.consume(q.queue, function(msg) {
          console.log(msg.content.toString());
        }, {noAck: true});
      });
    });
    connection.createChannel(function(err, ch) {
      if(err) {
        return console.log(err);
      }
      channel = ch;
      channel.checkExchange(amqpConfig.rpcExchange);
      channel.assertQueue(amqpConfig.rpcResponseQueue, {
        exclusive: true,
        durable: false
      }, function(err, q) {
        channel.consume(q.queue, onMessage, {noAck: true});
      });
    });
  });
};

window.onload = function() {
  outputContainer = document.getElementById('output');
};

window.onbeforeunload = function() {
  connection.close();
  ws.close();
}

window.echo = function(msgToEcho) {
  publishMessage('echo', {
    echoMessage: msgToEcho
  });
};
