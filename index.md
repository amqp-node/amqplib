---
layout: default
title: AMQP 0-9-1 library and client for Node.JS
---

# AMQP 0-9-1 library and client for Node.JS

`amqplib` implements the machinery needed to make clients for AMQP
0-9-1, and includes such a client. Why phrase it that way around?
Because AMQP is complicated enough that there are a few different ways
of presenting it in API form (e.g., [node-amqp][] deals with
exchanges and queues as first-class objects, while hiding channels;
[rabbit.js][] deprecates exchanges and queues in favour of
routing patterns).

AMQP often seems to be designed to confound client developers; it is
not very cleanly layered and there are consequences to molding it this
way or that in search of a usable API. In `amqplib` I have tried to
implement only the necessary machinery of AMQP, in layers as best I
can, without prejudice to any particular client API.

[Client API reference](channel_api.html) | [SSL guide](ssl.html)

## Client APIs

There are two client APIs included here, which are really two styles
of the same API: one uses promises, and one callbacks.

The client APIs are oriented around `Channel` objects (which are
something like sessions). They expose the protocol fairly directly as
methods on an object. Exchanges and queues are only represented
insofar as they are named (with strings) in arguments to these
methods.

Almost all operations are asynchronous RPCs; these methods on
`Channel` either return promises, or accept callbacks. Some operations
(e.g., `#ack`) elicit no response from the server, and don't return a
promise or take a callback.

In general I have made arguments that are mandatory in the protocol
into method arguments in the API, and coalesced optional arguments,
properties, and RabbitMQ extensions into a single `options` argument
which can often be omitted altogether.

The [reference](channel_api.html) has full details of both APIs.

## Library overview

To be able to get anywhere at all, an AMQP library needs to be able to

 * parse and serialise frames
 * maintain connection and channel state
 * implement the opening and closing handshakes

In `amqplib`, parsing and serialising are dealt with in the modules

 * `codec` procedures for parsing and serialising values;
 *  `defs` generated code for encoding and decoding protocol methods;
    and,
 * `frame` for turning a byte stream into decoded frames and
   vice-versa.

Connection state is maintained in a `Connection` object (module
`connection`) and channel state in a `Channel` (module `channel`);
these two modules also implement the opening and closing handshakes.

The interfaces among these modules is small and mostly mediated with
primitive values; e.g., strings and numbers. A few points of interface
require callbacks of the `function(err, ok) {}` variety, or in the
form of duck-typed objects (e.g., an object with an `#accept` method).

## Troubleshooting

### Why don't the publish, sendToQueue, ack, ackAll, nack, nackAll and reject channel methods return a promise?
Some commands in the amqp protocol require a reply, others do not. When a command does not require a reply, amqplib writes the command to an internal buffer and returns immediately. When a command expects a reply, amqplib will **usually** return a promise which will resolve when the reply is received. The two exceptions are the publish and sendToQueue methods, which when using a confirm channel do expect a reply, but still do not return a promise. This is because they return a boolean to indicate whether the internal buffer is full and that the client should back off until a drain event is emitted from the channel.

### Why does amqplib crash my application?
Error events are a special type of event in Node.js applications, which if unhandled will cause the node process to exit. The connection and channel objects emit error events when something bad happens. Your code needs to handle these events if you don't want your application to crash.

```js
const connection = await amqplib.connect();
connection.on('error', (err) => {
  // recover or exit
});

const channel = await connection.createChannel();
channel.on('error', (err) => {
  // recover or exit
})l
```

### How do I recover from a connection or channel error?
To recover from a channel error your code must listen for the channel error event, create a new channel and restablish any consumers. To recover from a connection error your code must listen for the connection error event, reconnect, create the necessary channels and restablish any consumers. You may also wish to handle to the connection 'close' event which will be emitted if the server shutsdown gracefully AND following a connection error.

### Why do I get a "Frame size exceeds frame max" error?
This is typically because you've connected to a server that doesn't use the amqp 0.9.1 protocol. Sometimes people are trying to connect to an amqp 1.0 broker, other times they have accidentally connected to an HTTP server by specifying the wrong port, or that they were not aware was running. It can also be because you've used `amqp://` rather than `amqps://` when connecting over SSL. A related problem can occur when receiving a message with an oversized header, in which case you can try increasing the maximum frame size via the `frameMax` connection parameter. 

### How do I flush messages? / Why are messages not sent?
When you publish a message using channel.publish or channel.sendToQueue it is written to an internal buffer associated with the channel. Under the hood, amqplib loops through each of the channel buffers, sending the messages to the server. Messages will be written as fast as possible and the buffers do not need to be flushed, however if you close the connection or your application exits while there are still messages in the buffer, they will be lost. Be sure to explicity close the channel and wait for the returned promise to resolve, or supplied callback to be invoked before closing the connection or terminating your application.

### Why do I get ECONNRESET?
ECONNRESET means that the server (or something between the client and the server) closed the connection without warning. This may occur during the initial handshake if the connection parameters you supply are invalid, or after successful connection if the server is killed, or if the network is unstable, or if you connect to the server through a load balancer / firewall and it decides to drop the connection, or if the client application is overloaded and cannot send commands to the server before the heartbeat timeout expires. Typically an ECONNRESET does not indicate a problem with amqplib, but a configuration or networking issue in your environment.

### Why do I get Error: Channel ended, no reply will be forthcoming?
Many amqp commands require a reply. If the channel ends before the reply is received then the outstanding promise / callback will fail with this error. This can occur when the client does not wait for all operations to complete and/or does not prevent new operations from starting while the application is shutting down.

### Debugging Tips
1. Use [Wireshark](https://www.rabbitmq.com/amqp-wireshark.html) to inspect the communication between your application and the broker.
2. Use [Node's debugger](https://nodejs.org/en/docs/guides/debugging-getting-started/) combined with your IDE or Chrome.
3. Set a very long heartbeat (or disable them completely) to prevent heartbeat errors while stepping through the code.
4. Use a [RabbitMQ Docker Container](https://hub.docker.com/_/rabbitmq) to simulate network errors.


[rabbit.js]: https://github.com/squaremo/rabbit.js
[node-amqp]: https://github.com/postwait/node-amqp
