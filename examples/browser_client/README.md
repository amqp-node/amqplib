# AMQP 0-9-1 browser WebSocket tunnel example

This example demonstrates a browser-based AMQP connection tunneled through a transparent WebSocket proxy. It contains two basic JavaScript components:

  - server.js: The NodeJS tunneling WebSocket server
  - web/main.js: The browser JavaScript AMQP client (Chrome tested only)

##Running
  - Ensure RabbitMQ is installed and running on a well known host
  - Set the configuration




```javascript
var q = 'tasks';

function bail(err) {
  console.error(err);
  process.exit(1);
}

// Publisher
function publisher(conn) {
  conn.createChannel(on_open);
  function on_open(err, ch) {
    if (err != null) bail(err);
    ch.assertQueue(q);
    ch.sendToQueue(q, new Buffer('something to do'));
  }
}

// Consumer
function consumer(conn) {
  var ok = conn.createChannel(on_open);
  function on_open(err, ch) {
    if (err != null) bail(err);
    ch.assertQueue(q);
    ch.consume(q, function(msg) {
      if (msg !== null) {
        console.log(msg.content.toString());
        ch.ack(msg);
      }
    });
  }
}

require('amqplib/callback_api')
  .connect('amqp://localhost', function(err, conn) {
    if (err != null) bail(err);
    consumer(conn);
    publisher(conn);
  });
```
