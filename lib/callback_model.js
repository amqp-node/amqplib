//
//
//

'use strict';

var defs = require('./defs');
var when = require('when'), defer = when.defer;
var inherits = require('util').inherits;
var EventEmitter = require('events').EventEmitter;
var BaseChannel = require('./channel').BaseChannel;
var Args = require('./api_args');

function CallbackModel(connection) {
  if (!(this instanceof CallbackModel))
    return new CallbackModel(connection);
  this.connection = connection;
  var self = this;
  ['error', 'close', 'blocked', 'unblocked'].forEach(function(ev) {
    connection.on(ev, self.emit.bind(self, ev));
  });
}
inherits(CallbackModel, EventEmitter);

module.exports.CallbackModel = CallbackModel;

function sk(cb) {
  return function(value) {
    cb(null, value);
  };
}
function ek(cb) {
  return cb; // eta
}

CallbackModel.prototype.close = function(cb) {
  this.connection.close().then(sk(cb), ek(cb));
};

function Channel(connection) {
  BaseChannel.call(this, connection);
  this.on('delivery', this.handleDelivery.bind(this));
  this.on('cancel', this.handleCancel.bind(this));
}
inherits(Channel, BaseChannel);

module.exports.Channel = Channel;

CallbackModel.prototype.createChannel = function(cb) {
  var ch = new Channel(this.connection);
  ch.open(function(err, ok) {
    if (err === null) cb && cb(null, ch);
    else cb && cb(err);
  });
  return ch;
};

Channel.prototype.rpc = function(method, fields, expect, cb) {
  this._rpc(method, fields, expect, function(err, ok) {
    if (err === null) cb && cb(null, ok.fields);
    else cb && cb(err);
  });
  return this;
};

// === Public API ===

Channel.prototype.open = function(cb) {
  return this.rpc(defs.ChannelOpen, {outOfBand: ""},
                  defs.ChannelOpenOk, cb);
};

Channel.prototype.close = function(cb) {
  return this.closeBecause("Goodbye", defs.constants.REPLY_SUCCESS,
                           function() { cb(null); });
};

Channel.prototype.assertQueue = function(queue, options, cb) {
  return this.rpc(defs.QueueDeclare,
                  Args.assertQueue(queue, options),
                  defs.QueueDeclareOk, cb);
};

Channel.prototype.checkQueue = function(queue, cb) {
  return this.rpc(defs.QueueDeclare,
                  Args.checkQueue(queue),
                  defs.QueueDeclareOk, cb);
};

Channel.prototype.deleteQueue = function(queue, options, cb) {
  return this.rpc(defs.QueueDelete,
                  Args.deleteQueue(queue, options),
                  defs.QueueDeleteOk, cb);
};

Channel.prototype.purgeQueue = function(queue, cb) {
  return this.rpc(defs.QueuePurge,
                  Args.purgeQueue(queue),
                  defs.QueuePurgeOk, cb);
};

Channel.prototype.bindQueue =
  function(queue, source, pattern, argt, cb) {
    return this.rpc(defs.QueueBind,
                    Args.bindQueue(queue, source, pattern, argt),
                    defs.QueueBindOk, cb);
  };

Channel.prototype.unbindQueue =
  function(queue, source, pattern, argt, cb) {
    return this.rpc(defs.QueueUnbind,
                    Args.unbindQueue(queue, source, pattern, argt),
                    defs.QueueUnbindOk, cb);
  };

Channel.prototype.assertExchange =
  function(exchange, type, options, cb) {
    return this.rpc(defs.ExchangeDeclare,
                    Args.assertExchange(exchange, type, options),
                    defs.ExchangeDeclareOk,
                    function(e, _) {
                      cb && cb(e, {exchange: exchange});
                    });
  };

Channel.prototype.checkExchange = function(exchange, cb) {
  return this.rpc(defs.ExchangeDeclare,
                  Args.checkExchange(exchange),
                  defs.ExchangeDeclareOk, cb);
};

Channel.prototype.deleteExchange = function(exchange, options, cb) {
  return this.rpc(defs.ExchangeDelete,
                  Args.deleteExchange(exchange, options),
                  defs.ExchangeDeleteOk, cb);
};

Channel.prototype.bindExchange =
  function(dest, source, pattern, argt, cb) {
    return this.rpc(defs.ExchangeBind,
                    Args.bindExchange(dest, source, pattern, argt),
                    defs.ExchangeBindOk, cb);
  };

Channel.prototype.unbindExchange =
  function(dest, source, pattern, argt, cb) {
    return this.rpc(defs.ExchangeUnbind,
                    Args.unbindExchange(dest, source, pattern, argt),
                    defs.ExchangeUnbindOk, cb);
  };

Channel.prototype.publish =
  function(exchange, routingKey, content, options) {
    var fieldsAndProps = Args.publish(exchange, routingKey, options);
    return this.sendMessage(fieldsAndProps, fieldsAndProps, content);
  };

Channel.prototype.sendToQueue = function(queue, content, options) {
  return this.publish('', queue, content, options);
};

Channel.prototype.consume = function(queue, callback, options, cb) {
  var fields = Args.consume(queue, options);
  var self = this;
  return this.rpc(defs.BasicConsume, fields, defs.BasicConsumeOk,
                  function(err, ok) {
                    if (err === null) {
                      self.registerConsumer(ok.consumerTag,
                                            callback);
                      cb && cb(null, ok);
                    }
                    else cb && cb(err);
                  });
};

Channel.prototype.cancel = function(consumerTag, cb) {
  var self = this;
  return this.rpc(defs.BasicCancel, Args.cancel(consumerTag),
                  defs.BasicCancelOk,
                  function(err, ok) {
                    if (err === null) {
                      self.unregisterConsumer(consumerTag);
                      cb && cb(null, ok);
                    }
                    else cb && cb(err);
                  });
};

Channel.prototype.get = function(queue, options, cb) {
  var self = this;
  var fields = Args.get(queue, options);
  return this.sendOrEnqueue(defs.BasicGet, fields, function(err, f) {
    if (err === null) {
      if (f.id === defs.BasicGetEmpty) {
        cb && cb(null, false);
      }
      else if (f.id = defs.BasicGetOk) {
        var fields = f.fields;
        self.handleMessage = acceptMessage(function(m) {
          m.fields = fields;
          cb && cb(m);
        });
      }
      else {
        cb && cb(new Error("Unexpected response to BasicGet: " +
                           inspect(f)));
      }
    }
  });
};

Channel.prototype.ack = function(message, allUpTo) {
  this.sendImmediately(
    defs.BasicAck, Args.ack(message.fields.deliveryTag, allUpTo));
  return this;
};

Channel.prototype.ackAll = function() {
  this.sendImmediately(
    defs.BasicAck, Args.ack(0, true));
  return this;
};

Channel.prototype.nack = function(message, allUpTo, requeue) {
  this.sendImmediately(
    defs.BasicNack,
    Args.nack(message.fields.deliveryTag, allUpTo, requeue));
  return this;
};

Channel.prototype.nackAll = function(requeue) {
  this.sendImmediately(
    defs.BasicNack, Args.nack(0, true, requeue))
  return this;
};

Channel.prototype.reject = function(message, requeue) {
  this.sendImmediately(
    defs.BasicReject,
    Args.reject(message.fields.deliveryTag, requeue));
  return this;
};

Channel.prototype.prefetch = function(count, global, cb) {
  return this.rpc(defs.BasicQos,
                  Args.prefetch(count, global),
                  defs.BasicQosOk, cb);
};

Channel.prototype.recover = function(cb) {
  return this.rpc(defs.BasicRecover,
                  Args.recover(),
                  defs.BasicRecoverOk, cb);
};

