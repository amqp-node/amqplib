//
//
//

'use strict';

var defs = require('./defs');
var when = require('when'), defer = when.defer;
var inherits = require('util').inherits;
var EventEmitter = require('events').EventEmitter;
var BaseChannel = require('./channel').BaseChannel;
var acceptMessage = require('./channel').acceptMessage;
var Args = require('./api_args');

function ChannelModel(connection) {
  if (!(this instanceof ChannelModel))
    return new ChannelModel(connection);
  EventEmitter.call( this );
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
  var closed = defer();
  this.connection.close(function (err) {
    if (err === null) closed.resolve();
    else closed.reject(err);
  });
  return closed.promise;
};

// Channels

function Channel(connection) {
  BaseChannel.call(this, connection);
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
  return when.try(this.allocate.bind(this)).then(
    function(ch) {
      return ch.rpc(defs.ChannelOpen, {outOfBand: ""},
                    defs.ChannelOpenOk);
    });
};

C.close = function() {
  var closed = defer();
  this.closeBecause("Goodbye", defs.constants.REPLY_SUCCESS,
                    closed.resolve)
  return closed.promise;
};

// === Public API, declaring queues and stuff ===

C.assertQueue = function(queue, options) {
  return this.rpc(defs.QueueDeclare,
                  Args.assertQueue(queue, options),
                  defs.QueueDeclareOk);
};

C.checkQueue = function(queue) {
  return this.rpc(defs.QueueDeclare,
                  Args.checkQueue(queue),
                  defs.QueueDeclareOk);
};

C.deleteQueue = function(queue, options) {
  return this.rpc(defs.QueueDelete,
                  Args.deleteQueue(queue, options),
                  defs.QueueDeleteOk);
};

C.purgeQueue = function(queue) {
  return this.rpc(defs.QueuePurge,
                  Args.purgeQueue(queue),
                  defs.QueuePurgeOk);
};

C.bindQueue = function(queue, source, pattern, argt) {
  return this.rpc(defs.QueueBind,
                  Args.bindQueue(queue, source, pattern, argt),
                  defs.QueueBindOk);
};

C.unbindQueue = function(queue, source, pattern, argt) {
  return this.rpc(defs.QueueUnbind,
                  Args.unbindQueue(queue, source, pattern, argt),
                  defs.QueueUnbindOk);
};

C.assertExchange = function(exchange, type, options) {
  // The server reply is an empty set of fields, but it's convenient
  // to have the exchange name handed to the continuation.
  return this.rpc(defs.ExchangeDeclare,
                  Args.assertExchange(exchange, type, options),
                  defs.ExchangeDeclareOk)
    .then(function(_ok) { return { exchange: exchange }; });
};

C.checkExchange = function(exchange) {
  return this.rpc(defs.ExchangeDeclare,
                  Args.checkExchange(exchange),
                  defs.ExchangeDeclareOk);
};

C.deleteExchange = function(name, options) {
  return this.rpc(defs.ExchangeDelete,
                  Args.deleteExchange(name, options),
                  defs.ExchangeDeleteOk);
};

C.bindExchange = function(dest, source, pattern, argt) {
  return this.rpc(defs.ExchangeBind,
                  Args.bindExchange(dest, source, pattern, argt),
                  defs.ExchangeBindOk);
};

C.unbindExchange = function(dest, source, pattern, argt) {
  return this.rpc(defs.ExchangeUnbind,
                  Args.unbindExchange(dest, source, pattern, argt),
                  defs.ExchangeUnbindOk);  
};

// Working with messages

C.publish = function(exchange, routingKey, content, options) {
  var fieldsAndProps = Args.publish(exchange, routingKey, options);
  return this.sendMessage(fieldsAndProps, fieldsAndProps, content);
};

C.sendToQueue = function(queue, content, options) {
  return this.publish('', queue, content, options);
};

C.consume = function(queue, callback, options) {
  var self = this;
  // NB we want the callback to be run synchronously, so that we've
  // registered the consumerTag before any messages can arrive.
  var fields = Args.consume(queue, options);
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
  var self = this;
  var reply = defer();
  this._rpc(defs.BasicCancel, Args.cancel(consumerTag),
            defs.BasicCancelOk,
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
  var reply = defer();
  var self = this;
  var fields = Args.get(queue, options);
  this.sendOrEnqueue(defs.BasicGet, fields, function(err, f) {
    if (err === null) {
      if (f.id === defs.BasicGetEmpty) {
        reply.resolve(false);
      }
      else if (f.id === defs.BasicGetOk) {
        var fields = f.fields;
        self.handleMessage = acceptMessage(function(m) {
          m.fields = fields;
          reply.resolve(m);
        });
      }
      else {
        reply.reject(new Error("Unexpected response to BasicGet: " +
                               inspect(f)));
      }
    }
    else reply.reject(err);
  });
  return reply.promise;
};

C.ack = function(message, allUpTo) {
  this.sendImmediately(
    defs.BasicAck,
    Args.ack(message.fields.deliveryTag, allUpTo));
};

C.ackAll = function() {
  this.sendImmediately(defs.BasicAck, Args.ack(0, true));
};

C.nack = function(message, allUpTo, requeue) {
  this.sendImmediately(
    defs.BasicNack,
    Args.nack(message.fields.deliveryTag, allUpTo, requeue));
};

C.nackAll = function(requeue) {
  this.sendImmediately(defs.BasicNack,
                       Args.nack(0, true, requeue));
};

// `Basic.Nack` is not available in older RabbitMQ versions (or in the
// AMQP specification), so you have to use the one-at-a-time
// `Basic.Reject`. This is otherwise synonymous with
// `#nack(message, false, requeue)`.
C.reject = function(message, requeue) {
  this.sendImmediately(
    defs.BasicReject,
    Args.reject(message.fields.deliveryTag, requeue));
};

// There are more options in AMQP than exposed here; RabbitMQ only
// implements prefetch based on message count, and only for individual
// channels or consumers. RabbitMQ v3.3.0 and after treat prefetch
// (without `global` set) as per-consumer (for consumers following),
// and prefetch with `global` set as per-channel.
C.prefetch = C.qos = function(count, global) {
  return this.rpc(defs.BasicQos,
                  Args.prefetch(count, global),
                  defs.BasicQosOk);
};

C.recover = function() {
  return this.rpc(defs.BasicRecover,
                  Args.recover(),
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

CC.waitForConfirms = function() {
  var awaiting = [];
  var unconfirmed = this.unconfirmed;
  unconfirmed.forEach(function(val, index) {
    if (val === null); // already confirmed
    else {
      var confirmed = defer();
      unconfirmed[index] = function(err) {
        if (val) val(err);
        if (err === null) confirmed.resolve();
        else confirmed.reject(err);
      };
      awaiting.push(confirmed.promise);
    }
  });
  return when.all(awaiting);
};
