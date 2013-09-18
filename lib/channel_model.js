//
//
//

'use strict';

var defs = require('./defs');
var when = require('when'), defer = when.defer;
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

module.exports.ChannelModel = ChannelModel;

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

C.assertQueue = function(queue, options) {
  queue = queue || '';
  options = options || {};
  var args;
  if (options.messageTtl ||
      options.expires ||
      options.deadLetterExchange ||
      options.deadLetterRoutingKey ||
      options.maxLength) {
    args = (options.arguments) ?
      Object.create(options.arguments) : {};
    args['x-expires'] = options.expires;
    args['x-message-ttl'] = options.messageTtl;
    args['x-dead-letter-exchange'] = options.deadLetterExchange;
    args['x-dead-letter-routing-key'] = options.deadLetterRoutingKey;
    args['x-max-length'] = options.maxLength;
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
  options = options || {};
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

C.assertExchange = function(exchange, type, options) {
  options = options || {};
  var args;
  if (options.alternateExchange) {
    args = (options.arguments) ?
      Object.create(options.arguments) : {};
    // NB no 'x-' prefix for some reason
    args['alternate-exchange'] = options.alternateExchange;
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
  var fields = {
    exchange: name,
    ifUnused: (options) ? !!options.ifUnused : false,
    ticket: 0, nowait: false
  };
  return this.rpc(defs.ExchangeDelete, fields, defs.ExchangeDeleteOk);
};

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

C.sendToQueue = function(queue, content, options) {
  return this.publish('', queue, content, options);
};

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
        return consumeOk.fields;
      }));
};

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
        return cancelOk.fields;
      }));
};

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
