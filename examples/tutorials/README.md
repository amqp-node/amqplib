# RabbitMQ tutorials

This directory contains the [RabbitMQ tutorials][rabbitmq-tutes],
ported to amqplib.

## Preparation

To run the tutorial code, you need amqplib installed. Assuming you are
in a clone of the amqplib repository, from the tutorials directory:

    npm install ../..

Then just run each file as a script, e.g., in bash

    ./send.js

or

    node send.js

or

    nave use 0.8 node send.js

## [Tutorial one: Hello World!][tute-one]

A "Hello World" example, with one script sending a message to a queue,
and another receiving messages from the same queue.

 * [send.js](send.js)
 * [receive.js](receive.js)

## [Tutorial two: Work queues][tute-two]

Using RabbitMQ as a work queue; `new_task` creates a task, and
`worker` processes tasks. Multiple `worker` process will share the
tasks among them. Long-running tasks are simulated by supplying a
string with dots, e.g., '...' to `new_task`. Each dot makes the worker
"work" for a second.

 * [new_task.js](new_task.js)
 * [worker.js](worker.js)

[rabbitmq-tutes]: http://github.com/rabbitmq/rabbitmq-tutorials
[tute-one]: http://www.rabbitmq.com/tutorials/tutorial-one-python.html
[tute-two]: http://www.rabbitmq.com/tutorials/tutorial-two-python.html
