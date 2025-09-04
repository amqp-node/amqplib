#!/usr/bin/env node
const co = require('co');
const amqp = require('amqplib');
const readline = require('node:readline');

co(function* () {
  const myConsumer = (msg) => {
    if (msg !== null) {
      console.log('consuming message %s in generator', JSON.stringify(msg.content.toString()));
    }
  };
  const conn = yield amqp.connect('amqp://localhost');
  // create a message to consume
  const q = 'hello';
  const msg = 'Hello World!';
  const channel = yield conn.createChannel();
  yield channel.assertQueue(q);
  channel.sendToQueue(q, Buffer.from(msg));
  console.log(" [x] Sent '%s'", msg);
  // consume the message
  yield channel.consume(q, myConsumer, {noAck: true});
}).catch((err) => {
  console.warn('Error:', err);
});

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

// pend until message is consumed
rl.question('newline to exit', () => process.exit());
