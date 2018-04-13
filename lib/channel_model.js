//
//
//

'use strict';

var defs = require('./defs');
var Promise = require('bluebird');
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
  return Promise.fromCallback(this.connection.close.bind(this.connection));
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

C.recoverChannel = function(recoverTopology, cb) {
  // Revalidate callbacks
  this.revalidate();
  var self = this;
  var recoverPromise = this.open()
      .then(
        function() {
          if(self instanceof ConfirmChannel) {
            return self.rpc(defs.ConfirmSelect, {nowait: false},
                            defs.ConfirmSelectOk);
          } else {
            Promise.resolve();
          }
        })
      .then(
        function() {
          return self.recoverPrefetch();
        });

  if(recoverTopology) {
    recoverPromise = recoverPromise.then(
        function(){
          return self.recoverExchanges();
        })
      .then(
        function() {
          return self.recoverQueues();
        })
      .then(
        function(){
          return self.recoverBindings();
        })
      .then(
        function() {
          return self.recoverConsumers();
        });
  }
  return recoverPromise.asCallback(cb);
};

C.recoverExchanges = function() {
  if(this.book !== undefined && this.book.exchanges !== undefined) {
    var self = this;
    var exchanges = this.book.exchanges;
    var keys = Object.keys(exchanges);
    return Promise.each(keys, function(exchange, index, length){
      var exchange_type = exchanges[exchange].type;
      var exchange_options = exchanges[exchange].options;
      return self.assertExchange(exchange, exchange_type, exchange_options);
    });
  } else {
    return Promise.resolve();
  }
};

C.recoverBindings = function() {
  if(this.book !== undefined && this.book.bindings !== undefined) {
    var self = this;
    var bindings = this.book.bindings;
    return Promise.each(bindings, function(binding, index, length){
      var source = binding.source;
      var destination = binding.destination;
      var destination_type = binding.destination_type;
      var pattern = binding.pattern;
      var args = binding.args;
      if(destination_type === "queue") {
        return self.bindQueue(destination, source, pattern, args);
      } else {
        return self.bindExchange(destination, source, pattern, args);
      }
    });
  } else {
    return Promise.resolve();
  }
};

C.recoverQueues = function() {
  if(this.book !== undefined && this.book.queues !== undefined) {
    var self = this;
    var queues = this.book.queues;
    var keys = Object.keys(queues);
    return Promise.mapSeries(keys, function(queue_name, index, length){
      var queue_is_anonymous = queues[queue_name].anonymous;
      var queue_options = queues[queue_name].options;
      var declare_name = queue_name;
      if(queue_is_anonymous) {
        declare_name = '';
      }
      return self.assertQueue(declare_name, queue_options)
                 .then(function(declareok){
                   return {old_name: queue_name, new_name: declareok.queue};
                 });
    }).then(function(queue_renames){
      queue_renames.forEach(function(queue_rename){
        if(queue_rename.old_name !== queue_rename.new_name){
          self.renameQueue(queue_rename.old_name, queue_rename.new_name);
        }
      });
    });
  } else {
    return Promise.resolve();
  }
};

C.recoverPrefetch = function() {
  if(this.book !== undefined && this.book.prefetch !== undefined) {
    var count = this.book.prefetch.count;
    var global = this.book.prefetch.global;
    return this.prefetch(count, global);
  } else {
    return Promise.resolve();
  }
};

C.recoverConsumers = function() {
  if(this.book !== undefined && this.book.consumers !== undefined) {
    var self = this;
    var consumers = this.book.consumers;
    var keys = Object.keys(consumers);
    return Promise.each(keys, function(consumer_id, index, length) {
      var consumer = consumers[consumer_id];
      consumer.options["consumerTag"] = consumer_id;
      return self.consume(consumer.queue, consumer.callback, consumer.options);
    });
  } else {
    return Promise.resolve();
  }
};

// An RPC that returns a 'proper' promise, which resolves to just the
// response's fields; this is intended to be suitable for implementing
// API procedures.
C.rpc = function(method, fields, expect) {
  var self = this;
  return Promise.fromCallback(function(cb) {
    return self._rpc(method, fields, expect, cb);
  })
  .then(function(f) {
    return f.fields;
  });
};

// Do the remarkably simple channel open handshake
C.open = function() {
  return Promise.try(this.allocate.bind(this)).then(
    function(ch) {
      return ch.rpc(defs.ChannelOpen, {outOfBand: ""},
                    defs.ChannelOpenOk);
    });
};

C.close = function() {
  var self = this;
  return Promise.fromCallback(function(cb) {
    return self.closeBecause("Goodbye", defs.constants.REPLY_SUCCESS,
                    cb);
  });
};

// === Public API, declaring queues and stuff ===

C.assertQueue = function(queue, options) {
  var self = this;
  return this.rpc(defs.QueueDeclare,
                  Args.assertQueue(queue, options),
                  defs.QueueDeclareOk)
              .then(function(qok){
                var qname = queue;
                var anonymous = false;
                if(qname === '' || !qname){
                  // Anonymous queue
                  qname = qok.queue;
                  anonymous = true;
                }
                self.recordQueue(qname, anonymous, options);
                return qok;
              });
};

C.checkQueue = function(queue) {
  return this.rpc(defs.QueueDeclare,
                  Args.checkQueue(queue),
                  defs.QueueDeclareOk);
};

C.deleteQueue = function(queue, options) {
  var self = this;
  return this.rpc(defs.QueueDelete,
                  Args.deleteQueue(queue, options),
                  defs.QueueDeleteOk)
              .then(function(delok){
                self.removeQueue(queue);
                return delok;
              });
};

C.purgeQueue = function(queue) {
  return this.rpc(defs.QueuePurge,
                  Args.purgeQueue(queue),
                  defs.QueuePurgeOk);
};

C.bindQueue = function(queue, source, pattern, argt) {
  var self = this;
  return this.rpc(defs.QueueBind,
                  Args.bindQueue(queue, source, pattern, argt),
                  defs.QueueBindOk)
              .then(function(bindok){
                self.recordBinding("queue", queue, source, pattern, argt);
                return bindok;
              });
};

C.unbindQueue = function(queue, source, pattern, argt) {
  var self = this;
  return this.rpc(defs.QueueUnbind,
                  Args.unbindQueue(queue, source, pattern, argt),
                  defs.QueueUnbindOk)
              .then(function(unbindok){
                self.removeBinding("queue", queue, source, pattern, argt);
                return unbindok;
              });
};

C.assertExchange = function(exchange, type, options) {
  // The server reply is an empty set of fields, but it's convenient
  // to have the exchange name handed to the continuation.
  var self = this;
  return this.rpc(defs.ExchangeDeclare,
                  Args.assertExchange(exchange, type, options),
                  defs.ExchangeDeclareOk)
    .then(function(_ok) {
      self.recordExchange(exchange, type, options);
      return { exchange: exchange };
    });
};

C.checkExchange = function(exchange) {
  return this.rpc(defs.ExchangeDeclare,
                  Args.checkExchange(exchange),
                  defs.ExchangeDeclareOk);
};

C.deleteExchange = function(name, options) {
  var self = this;
  return this.rpc(defs.ExchangeDelete,
                  Args.deleteExchange(name, options),
                  defs.ExchangeDeleteOk)
              .then(function(delok){
                self.removeExchange(name);
                return delok;
              });
};

C.bindExchange = function(dest, source, pattern, argt) {
  var self = this;
  return this.rpc(defs.ExchangeBind,
                  Args.bindExchange(dest, source, pattern, argt),
                  defs.ExchangeBindOk)
              .then(function(bindok){
                self.recordBinding("exchange", dest, source, pattern, argt);
                return bindok;
              });
};

C.unbindExchange = function(dest, source, pattern, argt) {
  var self = this;
  return this.rpc(defs.ExchangeUnbind,
                  Args.unbindExchange(dest, source, pattern, argt),
                  defs.ExchangeUnbindOk)
              .then(function(unbindok){
                self.removeBinding("exchange", dest, source, pattern, argt);
                return unbindok;
              });
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
  return Promise.fromCallback(function(cb) {
    self._rpc(defs.BasicConsume, fields, defs.BasicConsumeOk, cb);
  })
  .then(function(ok) {
    self.registerConsumer(ok.fields.consumerTag, callback);
    self.recordConsumer(ok.fields.consumerTag, queue, callback, options);
    return ok.fields;
  });
};

C.cancel = function(consumerTag) {
  var self = this;
  return Promise.fromCallback(function(cb) {
    self._rpc(defs.BasicCancel, Args.cancel(consumerTag),
          defs.BasicCancelOk,
          cb);
  })
  .then(function(ok) {
    self.unregisterConsumer(consumerTag);
    self.removeConsumer(consumerTag);
    return ok.fields;
  });
};

C.get = function(queue, options) {
  var self = this;
  var fields = Args.get(queue, options);
  return Promise.fromCallback(function(cb) {
    return self.sendOrEnqueue(defs.BasicGet, fields, cb);
  })
  .then(function(f) {
    if (f.id === defs.BasicGetEmpty) {
      return false;
    }
    else if (f.id === defs.BasicGetOk) {
      var fields = f.fields;
      return new Promise(function(resolve) {
        self.handleMessage = acceptMessage(function(m) {
          m.fields = fields;
          resolve(m);
        });
      });
    }
    else {
      throw new Error("Unexpected response to BasicGet: " +
                             inspect(f));
    }
  })
};

C.ack = function(message, allUpTo) {
  // Drop all older incarnations acks.
  if(message.incarnation == this.incarnation) {
    this.sendImmediately(
      defs.BasicAck,
      Args.ack(message.fields.deliveryTag, allUpTo));
  }
};

C.ackAll = function() {
  this.sendImmediately(defs.BasicAck, Args.ack(0, true));
};

C.nack = function(message, allUpTo, requeue) {
  // Drop all older incarnations nacks.
  if(message.incarnation == this.incarnation) {
    this.sendImmediately(
      defs.BasicNack,
      Args.nack(message.fields.deliveryTag, allUpTo, requeue));
  }
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
  // Drop all older incarnations nacks.
  if(message.incarnation == this.incarnation) {
    this.sendImmediately(
      defs.BasicReject,
      Args.reject(message.fields.deliveryTag, requeue));
  }
};

// There are more options in AMQP than exposed here; RabbitMQ only
// implements prefetch based on message count, and only for individual
// channels or consumers. RabbitMQ v3.3.0 and after treat prefetch
// (without `global` set) as per-consumer (for consumers following),
// and prefetch with `global` set as per-channel.
C.prefetch = C.qos = function(count, global) {
  var self = this;
  return this.rpc(defs.BasicQos,
                  Args.prefetch(count, global),
                  defs.BasicQosOk)
              .then(function(prefetchok){
                self.recordPrefetch(count, global);
                return prefetchok;
              });
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
      var confirmed = new Promise(function(resolve, reject) {
        unconfirmed[index] = function(err) {
          if (val) val(err);
          if (err === null) resolve();
          else reject(err);
        };
      });
      awaiting.push(confirmed);
    }
  });
  return Promise.all(awaiting);
};
