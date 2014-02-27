//
//
//

'use strict';

var defs = require('./defs');
var when = require('when'), defer = when.defer;
var inherits = require('util').inherits;
var EventEmitter = require('events').EventEmitter;
var BaseChannel = require('./channel').Channel;

function ChannelModel(connection) {
  if (!(this instanceof ChannelModel))
    return new ChannelModel(connection);
  this.connection = connection;
  var self = this;
  ['error', 'close', 'blocked', 'unblocked'].forEach(function(ev) {
    connection.on(ev, self.emit.bind(self, ev));
  });
}
inherits(ChannelModel, EventEmitter);

module.exports.ChannelModel = ChannelModel;

var CM = ChannelModel.prototype;

CM.close = function() {
  return this.connection.close();
};

// Channels

function Channel(connection) {
  BaseChannel.call(this, connection);
  this.consumers = {};
  this.on('delivery', this.handleDelivery.bind(this));
  this.on('cancel', this.handleCancel.bind(this));
}
inherits(Channel, BaseChannel);

module.exports.Channel = Channel;

CM.createChannel = function() {
  var c = new Channel(this.connection);
  return c.open().then(function(openOk) { return c; });
};

var C = Channel.prototype;

// An RPC that returns a 'proper' promise, which resolves to just the
// response's fields; this is intended to be suitable for implementing
// API procedures.
C.rpc = function(method, fields, expect) {
  var reply = defer();
  this._rpc(method, fields, expect, function(err, f) {
    if (err !== null) reply.reject(err);
    else reply.resolve(f.fields);
  });
  return reply.promise;
};

// Do the remarkably simple channel open handshake
C.open = function() {
  return this.rpc(defs.ChannelOpen, {outOfBand: ""},
                  defs.ChannelOpenOk);
};

C.close = function() {
  var closed = defer();
  this.closeBecause("Goodbye", defs.constants.REPLY_SUCCESS,
                    closed.resolve)
  return closed.promise;
};

// Not sure I like the ff, it's going to be changing hidden classes
// all over the place. On the other hand, whaddya do.
C.registerConsumer = function(tag, callback) {
  this.consumers[tag] = callback;
};

C.unregisterConsumer = function(tag) {
  delete this.consumers[tag];
};

C.dispatchMessage = function(fields, message) {
  var consumerTag = fields.consumerTag;
  var consumer = this.consumers[consumerTag];
  if (consumer) {
    return consumer(message);
  }
  else {
    // %%% Surely a race here
    throw new Error("Unknown consumer: " + consumerTag);
  }
};

C.handleDelivery = function(message) {
  return this.dispatchMessage(message.fields, message);
};

C.handleCancel = function(fields) {
  return this.dispatchMessage(fields, null);
};

// === Public API, declaring queues and stuff ===


// A number of AMQP methods have a table-typed field called
// `arguments`, that is intended to carry extension-specific
// values. RabbitMQ uses this in a number of places; e.g., to specify
// an 'alternate exchange'.
//
// Many of the methods in this API have an `options` argument, from
// which I take both values that have a default in AMQP (e.g.,
// autoDelete in QueueDeclare) *and* values that are specific to
// RabbitMQ (e.g., 'alternate-exchange'), which would normally be
// supplied in `arguments`. So that extensions I don't support yet can
// be used, I include `arguments` itself among the options.
//
// The upshot of this is that I often need to prepare an `arguments`
// value that has any values passed in `options.arguments` as well as
// any I've promoted to being options themselves. Since I don't want
// to mutate anything passed in, the general pattern is to create a
// fresh object with the `arguments` value given as its prototype; all
// fields in the supplied value will be serialised, as well as any I
// set on the fresh object. What I don't want to do, however, is set a
// field to undefined by copying possibly missing field values,
// because that will mask a value in the prototype.
//
// NB the `arguments` field already has a default value of `{}`, so
// there's no need to explicitly default it unless I'm setting values.
function setIfDefined(obj, prop, value) {
  if (value != undefined) obj[prop] = value;
}

var EMPTY_OPTIONS = Object.freeze({});

C.assertQueue = function(queue, options) {
  queue = queue || '';
  options = options || EMPTY_OPTIONS;

  var args = Object.create(options.arguments || null);
  setIfDefined(args, 'x-expires', options.expires);
  setIfDefined(args, 'x-message-ttl', options.messageTtl);
  setIfDefined(args, 'x-dead-letter-exchange',
               options.deadLetterExchange);
  setIfDefined(args, 'x-dead-letter-routing-key',
               options.deadLetterRoutingKey);
  setIfDefined(args, 'x-max-length', options.maxLength);
  
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

C.deleteQueue = function(name, options) {
  options = options || EMPTY_OPTIONS;
  var fields = {
    queue: name,
    ifUnused: !!options.ifUnused,
    ifEmpty: !!options.ifEmpty,
    ticket: 0, nowait: false
  };
  return this.rpc(defs.QueueDelete, fields, defs.QueueDeleteOk);
};

C.purgeQueue = function(queue) {
  var fields = {
    queue: queue,
    ticket: 0, nowait: false
  };
  return this.rpc(defs.QueuePurge, fields, defs.QueuePurgeOk);
};

C.bindQueue = function(queue, source, pattern, args) {
  var fields = {
    queue: queue,
    exchange: source,
    routingKey: pattern,
    arguments: args,
    ticket: 0, nowait: false
  };
  return this.rpc(defs.QueueBind, fields, defs.QueueBindOk);
};

C.unbindQueue = function(queue, source, pattern, args) {
  var fields = {
    queue: queue,
    exchange: source,
    routingKey: pattern,
    arguments: args,
    ticket: 0, nowait: false
  };
  return this.rpc(defs.QueueUnbind, fields, defs.QueueUnbindOk);  
};

C.assertExchange = function(exchange, type, options) {
  options = options || EMPTY_OPTIONS;
  var args = Object.create(options.arguments || null);
  setIfDefined(args, 'alternate-exchange', options.alternateExchange);
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

C.deleteExchange = function(name, options) {
  options = options || EMPTY_OPTIONS;
  var fields = {
    exchange: name,
    ifUnused: !!options.ifUnused,
    ticket: 0, nowait: false
  };
  return this.rpc(defs.ExchangeDelete, fields, defs.ExchangeDeleteOk);
};

C.bindExchange = function(destination, source, pattern, args) {
  var fields = {
    source: source,
    destination: destination,
    routingKey: pattern,
    arguments: args,
    ticket: 0, nowait: false
  };
  return this.rpc(defs.ExchangeBind, fields, defs.ExchangeBindOk);
};

C.unbindExchange = function(destination, source, pattern, args) {
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

C.publish = function(exchange, routingKey, content, options) {
  options = options || EMPTY_OPTIONS;

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

  var fields = {
    exchange: exchange,
    routingKey: routingKey,
    mandatory: !!options.mandatory,
    immediate: false, // RabbitMQ doesn't implement this any more
    ticket: 0
  };

  var headers = Object.create(options.headers || null);
  setIfDefined(headers, 'CC', convertCC(options.CC));
  setIfDefined(headers, 'BCC', convertCC(options.BCC));

  var deliveryMode; // undefined will default to 1 (non-persistent)

  // Previously I overloaded deliveryMode be a boolean meaning
  // 'persistent or not'; better is to name this option for what it
  // is, but I need to have backwards compatibility for applications
  // that either supply a numeric or boolean value.
  if (options.persistent !== undefined)
    deliveryMode = (options.persistent) ? 2 : 1;
  else if (typeof options.deliveryMode === 'number')
    deliveryMode = options.deliveryMode;
  else if (options.deliveryMode) // is supplied and truthy
    deliveryMode = 2;

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

C.sendToQueue = function(queue, content, options) {
  return this.publish('', queue, content, options);
};

C.consume = function(queue, callback, options) {
  options = options || EMPTY_OPTIONS;
  var args = Object.create(options.arguments || null);
  setIfDefined(args, 'x-priority', options.priority);
  var fields = {
    ticket: 0,
    queue: queue,
    consumerTag: options.consumerTag || '',
    noLocal: !!options.noLocal,
    noAck: !!options.noAck,
    exclusive: !!options.exclusive,
    nowait: false,
    arguments: args
  };
  var self = this;
  // NB we want the callback to be run synchronously, so that we've
  // registered the consumerTag before any messages can arrive.
  var reply = defer();
  this._rpc(defs.BasicConsume, fields, defs.BasicConsumeOk,
            function(err, ok) {
              if (err === null) {
                self.registerConsumer(ok.fields.consumerTag,
                                      callback);
                reply.resolve(ok.fields);
              }
              else reply.reject(err);
            });
  return reply.promise;
};

C.cancel = function(consumerTag) {
  var fields = {
    consumerTag: consumerTag,
    nowait: false
  };
  var self = this;
  var reply = defer();
  this._rpc(defs.BasicCancel, fields, defs.BasicCancelOk,
            function(err, ok) {
              if (err === null) {
                self.unregisterConsumer(consumerTag);
                reply.resolve(ok.fields);
              }
              else reply.reject(err);
            });
  return reply.promise;
};

C.get = function(queue, options) {
  options = options || EMPTY_OPTIONS;
  var reply = defer();
  var self = this;

  var fields = {
    ticket: 0,
    queue: queue,
    noAck: !!options.noAck
  };

  this.sendOrEnqueue(defs.BasicGet, fields, function(err, f) {
    if (err === null) {
      if (f.id === defs.BasicGetEmpty) {
        reply.resolve(false);
      }
      else if (f.id === defs.BasicGetOk) {
        var fields = f.fields;
        self.handleMessage = BaseChannel.acceptMessage(function(m) {
          m.fields = fields;
          reply.resolve(m);
        });
      }
      else {
        reply.reject(new Error("Unexpected response to BasicGet: %s" +
                               inspect(f)));
      }
    }
    else reply.reject(err);
  });
  return reply.promise;
};

C.ack = function(message, allUpTo) {
  var fields = {
    deliveryTag: message.fields.deliveryTag,
    multiple: !!allUpTo
  };
  this.sendImmediately(defs.BasicAck, fields);
};

C.ackAll = function() {
  this.sendImmediately(defs.BasicAck, {multiple: true, deliveryTag: 0});
};

C.nack = function(message, allUpTo, requeue) {
  var fields = {
    deliveryTag: message.fields.deliveryTag,
    multiple: !!allUpTo,
    requeue: (requeue === undefined) ? true : requeue
  };
  this.sendImmediately(defs.BasicNack, fields);
};

C.nackAll = function(requeue) {
  this.sendImmediately(defs.BasicNack, {
    deliveryTag: 0,
    multiple: true,
    requeue: (requeue === undefined) ? true : requeue
  });
};

// `Basic.Nack` is not available in older RabbitMQ versions (or in the
// AMQP specification), so you have to use the one-at-a-time
// `Basic.Reject`. This is otherwise synonymous with
// `#nack(message, false, requeue)`.
C.reject = function(message, requeue) {
  var fields = {
    deliveryTag: message.fields.deliveryTag,
    requeue: (requeue === undefined) ? true : requeue,
  };
  this.sendImmediately(defs.BasicReject, fields);
};

// There are more options in AMQP than exposed here; RabbitMQ only
// implements prefetch based on message count, and only for individual
// channels.
C.prefetch = C.qos = function(count) {
  var fields = {
    prefetchCount: count || 0,
    prefetchSize: 0,
    global: false
  };
  return this.rpc(defs.BasicQos, fields, defs.BasicQosOk);
};

C.recover = function() {
  return this.rpc(defs.BasicRecover, {requeue: true},
                  defs.BasicRecoverOk);
};

// Confirm channel. This is a channel with confirms 'switched on',
// meaning sent messages will provoke a responding 'ack' or 'nack'
// from the server. The upshot of this is that `publish` and
// `sendToQueue` both take a callback, which will be called either
// with `null` as its argument to signify 'ack', or an exception as
// its argument to signify 'nack'.

function ConfirmChannel(connection) {
  Channel.call(this, connection);
}
inherits(ConfirmChannel, Channel);

module.exports.ConfirmChannel = ConfirmChannel;

CM.createConfirmChannel = function() {
  var c = new ConfirmChannel(this.connection);
  return c.open()
    .then(function(openOk) {
      return c.rpc(defs.ConfirmSelect, {nowait: false},
                   defs.ConfirmSelectOk)
    })
    .then(function() { return c; });
};

var CC = ConfirmChannel.prototype;

CC.publish = function(exchange, routingKey, content, options, cb) {
  this.pushConfirmCallback(cb);
  return C.publish.call(this, exchange, routingKey, content, options);
};

CC.sendToQueue = function(queue, content, options, cb) {
  return this.publish('', queue, content, options, cb);
};
