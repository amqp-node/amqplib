#!/usr/bin/env node

const amqp = require('amqplib');

(async () => {
  try {
    const connection = await amqp.connect('amqp://localhost');
    process.once('SIGINT', async () => { 
      await connection.close();
    });
    const channel = await connection.createChannel();
    await channel.assertQueue('hello', { durable: false });
    await channel.consume('hello', (message) => {
      console.log(" [x] Received '%s'", message.content.toString());
    }, { noAck: true });

    console.log(' [*] Waiting for messages. To exit press CTRL+C');
  } catch (err) {
    console.warn(err);
  }
})();
