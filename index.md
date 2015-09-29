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


[rabbit.js]: https://github.com/squaremo/rabbit.js
[node-amqp]: https://github.com/postwait/node-amqp
