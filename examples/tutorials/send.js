#!/usr/bin/env node

var amqp = require('amqplib');

function send(url, queueName, message) {
  var connection;

  function createChannel(_connection) {
    connection = _connection;
    return connection.createChannel();
  }

  function setupQueue(channel) {
    var queueConfig = {durable: false};
    return channel.assertQueue(queueName, queueConfig);
  }

  function sendMsgToQueue(channel) {
    channel.sendToQueue(queueName, new Buffer(message));
  }
  
  function closeChannel(channel) {
    return channel.close();
  }

  function closeConnection() {
    if(connection) {
      connection.close();
    }
  }
  
  return amqp.connect(url)
    .then(createChannel)
    .tap(setupQueue)
    .tap(sendMsgToQueue)
    .then(closeChannel)
    .catch(console.warn)
    .finally(closeConnection);
}

send('amqp://localhost', 'hello', 'Hello, World!');
