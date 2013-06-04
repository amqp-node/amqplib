//
//
//

// Channel-oriented API, similar to RabbitMQ's Java client. In this
// model, the modus operandi is to create a channel with which to
// issue commands. Most errors in AMQP invalidate just the channel
// which had problems, so this ends up being a fairly natural way to
// use AMQP. The downside is that it doesn't give any guidance on
// *useful* ways to use AMQP; that is, it does little beyond giving
// access to the various AMQP methods.

var defs = require('./defs');
var when = require('when'), defer = when.defer;
var api = require('./api');
var deferSync = require('./sync_defer').defer;
var inherits = require('util').inherits;
var EventEmitter = require('events').EventEmitter;
var BaseChannel = require('./channel').Channel;

function ChannelModel(connection) {
  if (!(this instanceof ChannelModel))
    return new ChannelModel(connection);
  this.connection = connection;
  connection.on('close', this.onClose.bind(this));
  connection.on('error', this.onError.bind(this));
}
inherits(ChannelModel, EventEmitter);

ChannelModel.connect = function(url) {
  return api.connect(url).then(ChannelModel);
};

module.exports = ChannelModel;

var CM = ChannelModel.prototype;

CM.close = function() {
  return this.connection.close();
};

CM.onClose = function() { this.emit('close'); };
CM.onError = function(e) { this.emit('error', e); };

// Channels

function Channel(connection) {
  BaseChannel.call(this, connection);
  this.consumers = {};
  this.on('delivery', this.dispatchMessage.bind(this));
}
inherits(Channel, BaseChannel);

CM.createChannel = function() {
  var c = new Channel(this.connection);
  return c.open().then(function(openOk) { return c; });
};

var C = Channel.prototype;

// Not sure I like the ff, it's going to be changing hidden classes
// all over the place. On the other hand, whaddya do.
C.registerConsumer = function(tag, callback) {
  this.consumers[tag] = callback;
};

C.unregisterConsumer = function(tag) {
  delete this.consumers[tag];
};

C.dispatchMessage = function(message) {
  var consumerTag = message.fields.consumerTag;
  var consumer = this.consumers[consumerTag];
  if (consumer) {
    return consumer(message);
  }
  else {
    // %%% Surely a race here
    throw new Error("Unknown consumer: " + consumerTag);
  }
};

// === Public API, declaring queues and stuff ===

/*
Assert a queue into existence. This will bork the channel if the queue
already exists but has different properties; values supplied in the
`arguments` table may or may not count for borking purposes (check the
broker's documentation). If you supply an empty string as `queue`, or
don't supply it at all, the server will create a random name for you.

`options` is an object and may also be omitted. The options are:

- `exclusive`: if true, scopes the queue to the connection (defaults
  to false)

- `durable`: if true, the queue will survive broker restarts, modulo
  the effects of `exclusive` and `autoDelete`; this defaults to true
  if not supplied, unlike the others

- `autoDelete`: if true, the queue will be deleted when the number of
  consumers drops to zero (defaults to false)

- `arguments`: additional arguments, usually parameters for some kind
  of broker-specific extension e.g., high availability, TTL.

RabbitMQ extensions can also be supplied as options. These typically
require non-standard `x-*` keys and values sent in the `arguments`
table; e.g., `x-expires`. Here, I've removed the `x-` prefix and made
them options; they will overwrite anything you supply in `arguments`.

- `messageTtl` (0 <= n < 2^32): expires messages arriving in the queue
  after n milliseconds

- `expires` (0 < n < 2^32): the queue will be destroyed after n
  milliseconds of disuse, where use means having consumers, being
  declared (or checked, in this API), or being polled with a `get`.

- `deadLetterExchange` (string): an exchange to which messages
  discarded from the queue will be resent. Use `deadlLetterRoutingKey`
  to set a routing key for discarded messages; otherwise, the
  message's routing key (and CC and BCC, if present) will be
  preserved. A message is discarded when it expires or is rejected, or
  the queue limit is reached.

- `maxLength` (positive integer): sets a maximum number of messages
  the queue will hold. Old messages will be discarded (dead-lettered
  if that's set) to make way for new messages.
*/
C.assertQueue = function(queue, options) {
  queue = queue || '';
  options = options || {};
  var args;
  if (options.expires ||
      options.deadLetterExchange ||
      options.deadLetterRoutingKey ||
      options.maxLength) {
    args = options.arguments || {};
    args.expires = options.expires;
    args.deadLetterExchange = options.deadLetterExchange;
    args.deadLetterRoutingKey = options.deadLetterRoutingKey;
    args.maxLength = options.maxLength;
  }
  
  var fields = {
    queue: queue,
    exclusive: !!options.exclusive,
    durable: (options.durable === undefined) ? true : options.durable,
    autoDelete: !!options.autoDelete,
    arguments: args,
    passive: false,
    // deprecated but we have to include it
    ticket: 0,
    nowait: false
  };
  return this.rpc(defs.QueueDeclare, fields, defs.QueueDeclareOk);
};

// Check whether a queue exists. This will bork the channel if the
// named queue *doesn't* exist; if it does exist, hooray! There's no
// options as with `declareQueue`, just the queue name. The success
// value of the returned promise has the queue name, message count,
// and number of consumers. Should you care.
C.checkQueue = function(queue) {
  var fields = {
    queue: queue,
    passive: true, // switch to "completely different" mode
    nowait: false,
    durable: true, autoDelete: false, exclusive: false, // ignored
    ticket: 0,
  };
  return this.rpc(defs.QueueDeclare, fields, defs.QueueDeclareOk);
};

// Delete a queue. Naming a queue that doesn't exist will result in
// the server closing the channel, to teach you a lesson. The options
// here are:
//
// - ifUnused (boolean): if true and the queue has consumers, it will
//   not be deleted and the channel will be closed. Defaults to false.
//
// - ifEmpty (boolean): if true and the queue contains messages, the
//   queue will not be deleted and the channel will be
//   closed. Defaults to false.
//
// Note the obverse semantics of the options: if both are true, the
// queue will only be deleted if it has no consumers *and* no
// messages.
//
// You may leave out the options altogether if you want to delete the
// queue unconditionally.
C.deleteQueue = function(name, options) {
  options = options || {};
  var fields = {
    queue: name,
    ifUnused: !!options.ifUnused,
    ifEmpty: !!options.ifEmpty,
    ticket: 0, nowait: false
  };
  return this.rpc(defs.QueueDelete, fields, defs.QueueDeleteOk);
};

// Remove all undelivered messages from a queue. Note that this won't
// remove messages that have been delivered but not yet acknowledged;
// they will remain.
C.purgeQueue = function(queue) {
  var fields = {
    queue: queue,
    ticket: 0, nowait: false
  };
  return this.rpc(defs.QueuePurge, fields, defs.QueuePurgeOk);
};

// Bind a queue to an exchange. The exchange named by `source` will
// relay messages to the `queue` named, according to the type of the
// exchange and the `pattern` given.
//
// `args` is an object containing extra arguments that may be required
// for the particular exchange type (for which, see server
// documentation). It may be omitted if not needed.
C.bindQueue = function(queue, source, pattern, args) {
  args = args || {};
  var fields = {
    queue: queue,
    exchange: source,
    routingKey: pattern,
    arguments: args,
    ticket: 0, nowait: false
  };
  return this.rpc(defs.QueueBind, fields, defs.QueueBindOk);
};

// Remove a binding from an exchange to a queue. A binding with the
// exact `source` exchange, destination `queue`, routing key
// `pattern`, and extension `args` will be removed.
C.unbindQueue = function(queue, source, pattern, args) {
  args = args || {};
  var fields = {
    queue: queue,
    exchange: source,
    routingKey: pattern,
    arguments: args,
    ticket: 0, nowait: false
  };
  return this.rpc(defs.QueueUnbind, fields, defs.QueueUnbindOk);  
};

/*
Assert an exchange into existence. As with queues, if the exchange
exists already and has properties different to those supplied, the
channel will splode; fields in the arguments table may or may not be
splodey. Unlike queues, you must supply a name, and it can't be the
empty string. You must also supply an exchange type, which determines
how messages will be routed through the exchange.

*NB* There is just one RabbitMQ extension pertaining to exchanges in
general; however, specific exchange types may use the `arguments`
table to supply parameters.

The options:

- `durable` (boolean): if true, the exchange will survive broker
  restarts. Defaults to true.

- `internal` (boolean): if true, messages cannot be published
  directly to the exchange (i.e., it can only be the target of
  bindings, or possibly create messages ex-nihilo). Defaults to false.

- `autoDelete` (boolean): if true, the exchange will be destroyed once
  the number of bindings for which it is the source drop to
  zero. Defaults to false.

- `alternateExchange` (string): an exchange to send messages to if
  this exchange can't route them to any queues.

*/
C.assertExchange = function(exchange, type, options) {
  options = options || {};
  var args;
  if (options.alternateExchange) {
    args = options.arguments || {};
    args.alternateExchange = options.alternateExchange;
  }
  var fields = {
    exchange: exchange,
    ticket: 0,
    type: type,
    passive: false,
    durable: (options.durable === undefined) ? true : options.durable,
    autoDelete: !!options.autoDelete,
    internal: !!options.internal,
    nowait: false,
    arguments: args
  };
  return this.rpc(defs.ExchangeDeclare, fields, defs.ExchangeDeclareOk);
};

// Check that an exchange exists. If it doesn't exist, the channel
// will be closed. If it does, happy days.
C.checkExchange = function(exchange) {
  var fields = {
    exchange: exchange,
    passive: true, // switch to 'may as well be another method' mode
    nowait: false,
    // ff are ignored
    durable: true, internal: false,  type: '',  autoDelete: false,
    ticket: 0
  };
  return this.rpc(defs.ExchangeDeclare, fields, defs.ExchangeDeclareOk);
};

// Delete an exchange. The option is:
//
// - ifUnused (boolean): if true and the exchange has bindings, it
//   will not be deleted and the channel will be closed.
C.deleteExchange = function(name, options) {
  var fields = {
    exchange: name,
    ifUnused: (options) ? !!options.ifUnused : false,
    ticket: 0, nowait: false
  };
  return this.rpc(defs.ExchangeDelete, fields, defs.ExchangeDeleteOk);
};

// Bind an exchange to another exchange. The exchange named by
// `destination` will receive messages from the exchange named by
// `source`, according to the type of the source and the `pattern`
// given. For example, a direct exchange will relay messages that have
// a routing key equal to the pattern.
C.bindExchange = function(destination, source, pattern, args) {
  args = args || {};
  var fields = {
    source: source,
    destination: destination,
    routingKey: pattern,
    arguments: args,
    ticket: 0, nowait: false
  };
  return this.rpc(defs.ExchangeBind, fields, defs.ExchangeBindOk);
};

// Remove a binding from an exchange to a queue. A binding with the
// exact `source` exchange, destination `queue`, routing key
// `pattern`, and extension `args` will be removed.
C.unbindExchange = function(source, destination, pattern, args) {
  args = args || {};
  var fields = {
    source: source,
    destination: destination,
    routingKey: pattern,
    arguments: args,
    ticket: 0, nowait: false
  };
  return this.rpc(defs.ExchangeUnbind, fields, defs.ExchangeUnbindOk);  
};

// Working with messages

/*
Publish a single message to an exchange. The mandatory parameters
(these go in the publish method itself) are:

 - `exchange` and `routingKey`: the exchange and routing key, which
 determine where the message goes. A special case is sending `''` as
 the exchange, which will send directly to the queue named by the
 routing key.

 - `content`: a buffer containing the message content. This will be
 copied during encoding, so it is safe to mutate it once this method
 has returned.

The remaining parameters are optional, and are divided into those that
have some meaning to RabbitMQ and those that will be ignored by
RabbitMQ. ALl these are passed in `options`, which may be omitted.

The former options are a mix of fields in BasicDeliver (the method
used to publish a message), BasicProperties (in the message header
frame) and RabbitMQ extensions which are given in the `headers` table
in BasicProperties.

Used by RabbitMQ and sent on to consumers:

 - `expiration` (string): if supplied, the message will be discarded
   from a queue once it's been there longer than the given number of
   milliseconds. In the specification this is a string; numbers
   supplied here will be coerced.

 - `userId` (string): If supplied, RabbitMQ will compare it to the
   username supplied when opening the connection, and reject messages
   for which it does not match.

 - `CC` (array of string): an array of routing keys as strings;
   messages will be routed to these routing keys in addition to that
   given as the `routingKey` parameter. This will override any value
   given for `CC` in the `headers` parameter. *NB* The property names
   `CC` and `BCC` are case-sensitive.

Used by RabbitMQ but not sent on to consumers:

 - `mandatory` (boolean): if true, the message will be returned if it
   is not routed to a queue (i.e., if there are no bindings that match
   its routing key).

 - `deliveryMode` (boolean): if true, the message will survive a
   broker restart. Default is false. (In the specification this is
   either `1` meaning non-persistent, or `2` meaning
   persistent. That's just silly though)

 - `BCC` (array of string): like `CC`, except that the value will not
   be sent in the message headers to consumers.

Ignored by RabbitMQ and not sent to consumers:

 - `immediate` (boolean): return the message if it is not able to be sent
   immediately to a consumer. No longer implemented in RabbitMQ

Ignored by RabbitMQ (but may be useful for applications):

 - `contentType` (string): a MIME type for the message content

 - `contentEncoding` (string): a MIME encoding for the message content

 - `headers` (object): application specific headers to be carried
   along with the message content. The value as sent may be augmented
   by extension-specific fields if they are given in the parameters,
   for example, 'cc', since these are encoded as message headers; the
   supplied value won't be mutated.

 - `priority` (0..9): a notional priority for the message; presently
   ignored by RabbitMQ

 - `correlationId` (string): usually used to match replies to
   requests, or similar.

 - `replyTo` (string): often used to name a queue to which the
   receiving application must send replies, in an RPC scenario (many
   libraries assume this pattern)

 - `messageId` (string): arbitrary application-specific identifier for
   the message

 - `timestamp` (positive number): a timestamp for the message

 - `type` (string): an arbitrary application-specific type for the
   message

 - `appId` (string): an arbitrary identifier for the originating
   application

*/
C.publish = function(exchange, routingKey, content, options) {
  options = options || {};

  // The CC and BCC fields expect an array of "longstr", which would
  // normally be buffer values in JavaScript; however, since a field
  // array (or table) cannot have shortstr values, the codec will
  // encode all strings as longstrs anyway.
  function convertCC(cc) {
    if (cc === undefined) {
      return undefined;
    }
    else if (Array.isArray(cc)) {
      return cc.map(String);
    }
    else return [String(cc)];
  }

  // `for .. in` doesn't get optimised, put it in its own function 
  function headersClone(headers) {
    var newheaders = {CC: undefined, BCC: undefined};
    if (headers === undefined) return newheaders;
    for (var k in headers) {
      if (headers.hasOwnProperty(k)) newheaders[k] = headers[k];
    }
    return newheaders;
  }

  var fields = {
    exchange: exchange,
    routingKey: routingKey,
    mandatory: !!options.mandatory,
    immediate: false, // RabbitMQ doesn't implement this any more
    ticket: 0
  };
  var headers;
  if (options.CC || options.BCC) {
    headers = headersClone(options.headers);
    headers.CC = convertCC(options.CC);
    headers.BCC = convertCC(options.BCC);
  }
  else headers = options.headers;

  var deliveryMode; // undefined will default to 1 (non-persistent)
  if (options.deliveryMode) deliveryMode = 2;
  var expiration = options.expiration;
  if (expiration !== undefined) expiration = expiration.toString();

  var properties = {
    contentType: options.contentType,
    contentEncoding: options.contentEncoding,
    headers: headers,
    deliveryMode: deliveryMode,
    priority: options.priority,
    correlationId: options.correlationId,
    replyTo: options.replyTo,
    expiration: expiration,
    messageId: options.messageId,
    timestamp: options.timestamp,
    type: options.type,
    userId: options.userId,
    appId: options.appId,
    clusterId: ''
  };
  return this.sendMessage(fields, properties, content);
};

/*
Send a single message directly to the `queue` named. The options
are exactly the same as for publish
*/
C.sendToQueue = function(queue, content, options) {
  return this.publish('', queue, content, options);
};

/*
Set up a consumer with a callback.

Options (which may be omitted altogether):

- `consumerTag` (string): a name which the server will use to
  distinguish message deliveries for the consumer; mustn't be already
  in use on the channel. It's usually easier to omit this, in which
  case the server will create a random name.

- `noLocal` (boolean): in theory, if true then the broker won't
  deliver messages to the consumer if they were also published on this
  connection; RabbitMQ doesn't implement it though. Defaults to false.

- `noAck` (boolean): if true, the broker won't expect an
  acknowledgement of messages delivered to this consumer; i.e., it
  will dequeue messages as soon as they've been sent down the
  wire. Defaults to false (i.e., you will acknowledge messages).

- `exclusive` (boolean): if true, the broker won't let anyone else
  consume from this queue; if there already is a consumer, there goes
  your channel (so usually only useful if you've made a 'private'
  queue by letting the server choose its name).

- `arguments` (object): arbitrary arguments. No RabbitMQ extensions
  use these, but hey go to town.

*/
C.consume = function(queue, callback, options) {
  options = options || {};
  var fields = {
    ticket: 0,
    queue: queue,
    consumerTag: options.consumerTag || '',
    noLocal: !!options.noLocal,
    noAck: !!options.noAck,
    exclusive: !!options.exclusive,
    nowait: false,
    arguments: options.arguments
  };
  var self = this;
  // NB we want the callback to be run synchronously, so that we've
  // registered the consumerTag before any messages can arrive.
  return when(
    this._rpc(defs.BasicConsume, fields, defs.BasicConsumeOk)
      .then(function(consumeOk) {
        self.registerConsumer(consumeOk.fields.consumerTag, callback);
        return consumeOk;
      }));
};

// Cancel a consumer, given a `consumerTag`. The consumerTag is
// returned in the BasicConsumeOk method in response to
// BasicConsume. Once the returned promise is resolved, no more
// messages will be delivered for that consumer (i.e., the callback
// supplied to consume will no longer be called).
C.cancel = function(consumerTag) {
  var fields = {
    consumerTag: consumerTag,
    nowait: false
  };
  var self = this;
  return when(
    this._rpc(defs.BasicCancel, fields, defs.BasicCancelOk)
      .then(function(cancelOk) {
        self.unregisterConsumer(consumerTag);
        return cancelOk;
      }));
};

/*
Ask a queue for a message. This returns a promise that will be
resolved with either false, if there is no message to be had, or a
message.

Options:

 - noAck (boolean): if true, the message will be assumed by the server
   to be acknowledged (i.e., dequeued) as soon as it's been sent over
   the wire. Default is false.
*/
C.get = function(queue, options) {
  options = options || {};
  var reply = deferSync();
  var self = this;

  var fields = {
    ticket: 0,
    queue: queue,
    noAck: !!options.noAck
  };

  this.sendOrEnqueue(defs.BasicGet, fields, reply);
  return when(reply.promise.then(function(f) {
    if (f.id === defs.BasicGetEmpty) {
      return false;
    }
    else if (f.id === defs.BasicGetOk) {
      var delivery = deferSync();
      var fields = f.fields;
      self.handleMessage = BaseChannel.acceptMessage(function(m) {
        m.fields = fields;
        delivery.resolve(m);
      });
      return delivery.promise;
    }
    else {
      throw new Error("Unexpected response to BasicGet: " + f);
    }
  }));
};

/*
Acknowledge a message or messages. If a `consume` or `get` is issued
with noAck: false (the default), the server will expect
acknowledgements for messages before forgetting about them. If no such
acknowledgement is given, those messages may be requeued once the
channel is closed.

If `upTo` is true, all outstanding messages prior to and including the
given message shall be considered acknowledged. If false, or elided,
only the message supplied is acknowledged.

It's an error to supply a message that either doesn't require
acknowledgement, or has already been acknowledged. Doing so will gank
the channel. If you want to acknowledge all the messages and you don't
have a specific message around, use `ackAll`.
*/
C.ack = function(message, upTo) {
  var fields = {
    deliveryTag: message.fields.deliveryTag,
    multiple: !!upTo
  };
  this.sendImmediately(defs.BasicAck, fields);
};

/*
Acknowledge all outstanding messages on the channel. In general this
is a safe operation, in that it won't result in an error even if there
are no such messages.
*/
C.ackAll = function() {
  this.sendImmediately(defs.BasicAck, {multiple: true, deliveryTag: 0});
};

/*
Reject a message. This instructs the server to either requeue the
message or throw it away (which may mean dead-lettering it).

If 'upTo' is true, all outstanding messages prior to and including the
given message are rejected. As with `ack`, it's a channel-ganking
error to use a message that is not
outstanding. Understandably. Defaults to false.

If `requeue` is true, the server shall try to put the message or
messages back on the queue or queues from which they came. Defaults to
true, so if you want to make sure messages are dead-lettered or
discarded, supply false here.
*/
C.nack = function(message, upTo, requeue) {
  var fields = {
    deliveryTag: message.fields.deliveryTag,
    multiple: !!upTo,
    requeue: (requeue === undefined) ? true : requeue
  };
  this.sendImmediately(defs.BasicNack, fields);
};

/*
Reject all messages outstanding on this channel. If `requeue` is true,
or omitted, the server shall try to re-enqueue the messages.
*/
C.nackAll = function(requeue) {
  this.sendImmediately(defs.BasicNack, {
    deliveryTag: 0,
    multiple: true,
    requeue: (requeue === undefined) ? true : requeue
  });
};

// Set the prefetch count for this channel. The `count` given is the
// number of messages that can be awaiting acknowledgement; once there
// are `count` messages outstanding, the server will not send more
// messages on this channel until one or more have been
// acknowledged. A falsey value for `count` indicates no such limit.
//
// There are more options in AMQP than exposed here; RabbitMQ only
// implements prefetch based on message count, and only for individual
// channels.
C.prefetch = C.qos = function(count) {
  var fields = {
    prefetchCount: count || 0,
    prefetchSize: 0,
    global: false
  };
  return this.rpc(defs.BasicQos, fields, defs.BasicQos);
};

// Requeue unacknowledged messages on this channel. The returned
// promise will be resolved once all messages are requeued.
C.recover = function() {
  return this.rpc(defs.BasicRecover, {requeue: true},
                  defs.BasicRecoverOk);
};
