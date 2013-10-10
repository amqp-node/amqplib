# Change log for amqplib

## Changes in master (since v0.1.0)

    git log v0.1.0..

## Changes in v0.1.0 (since v0.0.2)

    git log v0.0.2..v0.1.0

### Breaking changes

 * Consumer callbacks are invoked with `null` if the consumer is
   cancelled (see
   [RabbitMQ's consumer cancel notification][rabbitmq-consumer-cancel])
 * In confirm channels, instead of `#publish` and `#sentToQueue`
   returning promises, they return a boolean as for normal channels,
   and take a Node.JS-style `function (err, ok)` callback for the
   server ack or nack

### Fixes

 * Overlapping channel and connection close frames are dealt with
   gracefully
 * Exceptions thrown in consumer callbacks are raised as `'error'`
   events
 * Zero-size messages are handled
 * Avoid monkey-patching `Buffer`, and eschew
   `require('util')._extend`

### Enhancements

 * Channels now behave like `Writable` streams with regard to `#publish`
   and `#sendToQueue`, returning a boolean from those methods and
   emitting `'drain'`
 * Connections now multiplex frames from channels fairly
 * Low-level channel machinery is now fully callback-based


[rabbitmq-consumer-cancel]: http://www.rabbitmq.com/consumer-cancel.html
