//
//
//

'use strict';

var defs = require('./defs');
var inherits = require('util').inherits;
var EventEmitter = require('events').EventEmitter;
var BaseChannel = require('./channel').BaseChannel;
var acceptMessage = require('./channel').acceptMessage;
var Args = require('./api_args');

function CallbackModel(connection) {
  if (!(this instanceof CallbackModel))
    return new CallbackModel(connection);
  EventEmitter.call( this );
  this.connection = connection;
  var self = this;
  ['error', 'close', 'blocked', 'unblocked'].forEach(function(ev) {
    connection.on(ev, self.emit.bind(self, ev));
  });
}
inherits(CallbackModel, EventEmitter);

module.exports.CallbackModel = CallbackModel;

CallbackModel.prototype.close = function(cb) {
  this.connection.close(cb);
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

// Wrap an RPC callback to make sure the callback is invoked with
// either `(null, value)` or `(error)`, i.e., never two non-null
// values. Also substitutes a stub if the callback is `undefined` or
// otherwise falsey, for convenience in methods for which the callback
// is optional (that is, most of them).
function callbackWrapper(ch, cb) {
  return (cb) ? function(err, ok) {
    if (err === null) {
      cb(null, ok);
    }
    else cb(err);
  } : function() {};
}

// This encodes straight-forward RPC: no side-effects and return the
// fields from the server response. It wraps the callback given it, so
// the calling method argument can be passed as-is. For anything that
// needs to have side-effects, or needs to change the server response,
// use `#_rpc(...)` and remember to dereference `.fields` of the
// server response.
Channel.prototype.rpc = function(method, fields, expect, cb0) {
  var cb = callbackWrapper(this, cb0);
  this._rpc(method, fields, expect, function(err, ok) {
    cb(err, ok && ok.fields); // in case of an error, ok will be
                              // undefined
  });
  return this;
};

// === Public API ===

Channel.prototype.open = function(cb) {
  try { this.allocate(); }
  catch (e) { return cb(e); }

  return this.rpc(defs.ChannelOpen, {outOfBand: ""},
                  defs.ChannelOpenOk, cb);
};

Channel.prototype.close = function(cb) {
  return this.closeBecause("Goodbye", defs.constants.REPLY_SUCCESS,
                           function() { cb && cb(null); });
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

Channel.prototype.assertExchange = function(ex, type, options, cb0) {
  var cb = callbackWrapper(this, cb0);
  this._rpc(defs.ExchangeDeclare,
            Args.assertExchange(ex, type, options),
            defs.ExchangeDeclareOk,
            function(e, _) { cb(e, {exchange: ex}); });
  return this;
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

Channel.prototype.consume = function(queue, callback, options, cb0) {
  var cb = callbackWrapper(this, cb0);
  var fields = Args.consume(queue, options);
  var self = this;
  this._rpc(
    defs.BasicConsume, fields, defs.BasicConsumeOk,
    function(err, ok) {
      if (err === null) {
        self.registerConsumer(ok.fields.consumerTag, callback);
        cb(null, ok.fields);
      }
      else cb(err);
    });
  return this;
};

Channel.prototype.cancel = function(consumerTag, cb0) {
  var cb = callbackWrapper(this, cb0);
  var self = this;
  this._rpc(
    defs.BasicCancel, Args.cancel(consumerTag), defs.BasicCancelOk,
    function(err, ok) {
      if (err === null) {
        self.unregisterConsumer(consumerTag);
        cb(null, ok.fields);
      }
      else cb(err);
    });
  return this;
};

Channel.prototype.get = function(queue, options, cb0) {
  var self = this;
  var fields = Args.get(queue, options);
  var cb = callbackWrapper(this, cb0);
  this.sendOrEnqueue(defs.BasicGet, fields, function(err, f) {
    if (err === null) {
      if (f.id === defs.BasicGetEmpty) {
        cb(null, false);
      }
      else if (f.id === defs.BasicGetOk) {
        self.handleMessage = acceptMessage(function(m) {
          m.fields = f.fields;
          cb(null, m);
        });
      }
      else {
        cb(new Error("Unexpected response to BasicGet: " +
                     inspect(f)));
      }
    }
  });
  return this;
};

Channel.prototype.ack = function(message, allUpTo) {
  this.sendImmediately(
    defs.BasicAck, Args.ack(message.fields.deliveryTag, allUpTo));
  return this;
};

Channel.prototype.ackAll = function() {
  this.sendImmediately(defs.BasicAck, Args.ack(0, true));
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

function ConfirmChannel(connection) {
  Channel.call(this, connection);
}
inherits(ConfirmChannel, Channel);

module.exports.ConfirmChannel = ConfirmChannel;

CallbackModel.prototype.createConfirmChannel = function(cb) {
  var ch = new ConfirmChannel(this.connection);
  ch.open(function(err) {
    if (err !== null) return cb && cb(err);
    else {
      ch.rpc(defs.ConfirmSelect, {nowait: false},
             defs.ConfirmSelectOk, function(err, _ok) {
               if (err !== null) return cb && cb(err);
               else cb && cb(null, ch);
             });
    }
  });
  return ch;
};

ConfirmChannel.prototype.publish = function(exchange, routingKey,
                                            content, options, cb) {
  this.pushConfirmCallback(cb);
  return Channel.prototype.publish.call(
    this, exchange, routingKey, content, options);
};

ConfirmChannel.prototype.sendToQueue = function(queue, content,
                                                options, cb) {
  return this.publish('', queue, content, options, cb);
};

ConfirmChannel.prototype.waitForConfirms = function(k) {
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
  return Promise.all(awaiting).then(function() { k(); },
                                 function(err) { k(err); });
};
