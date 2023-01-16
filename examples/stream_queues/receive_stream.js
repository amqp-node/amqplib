#!/usr/bin/env node
const amqp = require('amqplib');


async function receiveStream() {
    try {
        const connection = await amqp.connect('amqp://localhost');
        process.once('SIGINT', connection.close);

        const channel = await connection.createChannel();
        const queue = 'my_first_stream';

        // Define the queue stream
        // Mandatory: exclusive: false, durable: true  autoDelete: false
        await channel.assertQueue(queue, {
            exclusive: false,
            durable: true,
            autoDelete: false,
            arguments: {
                'x-queue-type': 'stream',  // Mandatory to define stream queue
                'x-max-length-bytes': 2_000_000_000  // Set the queue retention to 2GB else the stream doesn't have any limit
            }
        });

        channel.qos(100);  // This is mandatory

        channel.consume(queue, (msg) => {
            console.log(" [x] Received '%s'", msg.content.toString());
            channel.ack(msg);  // Mandatory
        }, {
            noAck: false,
            arguments: {
                'x-stream-offset': 'first'  // Here you can specify the offset: : first, last, next, and timestamp
                                            // with first start consuming always from the beginning
            }
        });

        console.log(' [*] Waiting for messages. To exit press CTRL+C');
    }
    // Catch and display any errors in the console
    catch(e) { console.log(e) }
}


module.exports = {
    receiveStream
}