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

Channel.prototype.recoverChannel = function(recoverTopology, cb){
  this.revalidate();
  var self = this;
  var recoverPrefetchAndConsumers = function(error, _ok) {
    if (error !== null) {
      return cb(error);
    } else {
      self.recoverPrefetch(function(error, res){
        if(error === null) {
          if(recoverTopology){
            self.recoverExchanges(function(error, ok) {
              if(error === null){
                self.recoverQueues(function(error, ok) {
                  if(error === null) {
                    self.recoverBindings(function(error, ok){
                      if(error === null){
                        self.recoverConsumers(cb);
                      } else {
                        cb(error, ok);
                      }
                    });
                  } else {
                    cb(error, ok);
                  }
                });
              } else {
                cb(error, ok);
              }
            });
          } else {
            cb(error, res);
          }
        } else {
          cb(error, res);
        }
      });
    }
  };
  this.open(function(error, channel){
    // cb(error, channel);
    if(error !== null) {
      cb(error, channel);
    } else {
      if(self instanceof ConfirmChannel) {
        self.rpc(defs.ConfirmSelect, {nowait: false},
               defs.ConfirmSelectOk,
               recoverPrefetchAndConsumers);
      } else {
        recoverPrefetchAndConsumers(null);
      }
    }
  });
};

Channel.prototype.recoverPrefetch = function(callback) {
  if(this.book !== undefined && this.book.prefetch !== undefined) {
    var count = this.book.prefetch.count;
    var global = this.book.prefetch.global;
    this.prefetch(count, global, callback);
  } else {
    callback(null);
  }
};

Channel.prototype.recoverConsumers = function(callback) {
  function consumeNext(self, keys, consumers, n) {
    if(n < keys.length) {
      var consumer = consumers[keys[n]];
      // Set consumer tag
      consumer.options["consumerTag"] = keys[n];
      self.consume(consumer.queue, consumer.callback, consumer.options,
        function(error) {
          if(error === null){
            consumeNext(self, keys, consumers, n + 1);
          } else {
            callback(error);
          }
        });
    } else {
      callback(null, self);
    }
  }
  if(this.book && this.book.consumers){
    var self = this;
    var consumers = this.book.consumers;
    var keys = Object.keys(consumers);
    consumeNext(self, keys, consumers, 0);
  } else {
    callback(null, this);
  }
};

Channel.prototype.recoverExchanges = function(callback) {
  function recoverNext(self, keys, exchanges, n) {
    if(n < keys.length) {
      var exchange = keys[n];
      var exchange_type = exchanges[exchange].type;
      var exchange_options = exchanges[exchange].options;
      self.assertExchange(exchange, exchange_type, exchange_options,
                          function(error, ok) {
                            if(error === null) {
                              recoverNext(self, keys, exchanges, n + 1);
                            } else {
                              callback(error, ok);
                            }
                          });
    } else {
      callback(null, self);
    }
  }
  if(this.book !== undefined && this.book.exchanges !== undefined) {
    var self = this;
    var exchanges = this.book.exchanges;
    var keys = Object.keys(exchanges);
    recoverNext(self, keys, exchanges, 0);
  } else {
    callback(null, this);
  }
};

Channel.prototype.recoverQueues = function(callback) {
  function afterRecovery(self, queue_renames) {
    queue_renames.forEach(function(queue_rename){
      if(queue_rename.old_name !== queue_rename.new_name){
        self.renameQueue(queue_rename.old_name, queue_rename.new_name);
      }
    });
    callback(null, self);
  }
  function recoverNext(self, keys, queues, n, acc) {
    if(n < keys.length) {
      var queue_name = keys[n];
      var queue_is_anonymous = queues[queue_name].anonymous;
      var queue_options = queues[queue_name].options;
      var declare_name = queue_name;
      if(queue_is_anonymous) {
        declare_name = '';
      }
      self.assertQueue(
        declare_name, queue_options,
        function(error, declareok) {
          if(error === null) {
            acc.push({old_name: queue_name, new_name: declareok.queue});
            recoverNext(self, keys, queues, n + 1, acc);
          } else {
            callback(error, declareok);
          }
        });
    } else {
      afterRecovery(self, acc);
    }
  }
  if(this.book !== undefined && this.book.queues !== undefined) {
    var self = this;
    var queues = this.book.queues;
    var keys = Object.keys(queues);
    recoverNext(self, keys, queues, 0, []);
  } else {
    callback(null, this);
  }
};

Channel.prototype.recoverBindings = function(callback) {
  function recoverNext(self, bindings, n) {
    if(n < bindings.length) {
      var binding = bindings[n];
      var source = binding.source;
      var destination = binding.destination;
      var destination_type = binding.destination_type;
      var pattern = binding.pattern;
      var args = binding.args;
      if(destination_type === "queue") {
        self.bindQueue(destination, source, pattern, args,
                       function(error, ok){
                         if(error === null){
                           recoverNext(self, bindings, n + 1);
                         } else {
                           callback(error, ok);
                         }
                       });
      } else {
        self.bindExchange(destination, source, pattern, args,
                          function(error, ok){
                            if(error === null){
                              recoverNext(self, bindings, n + 1);
                            } else {
                              callback(error, ok);
                            }
                          });
      }
    } else {
      callback(null, self);
    }
  }
  if(this.book !== undefined && this.book.bindings !== undefined) {
    var self = this;
    var bindings = this.book.bindings;
    recoverNext(self, bindings, 0);
  } else {
    callback(null, this);
  }
};

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
  var self = this;
  return this.rpc(defs.QueueDeclare,
                  Args.assertQueue(queue, options),
                  defs.QueueDeclareOk,
                  function(error, qok){
                    if(error === null){
                      var qname = queue;
                      var anonymous = false;
                      if(qname === '' || !qname){
                        // Anonymous queue
                        qname = qok.queue;
                        anonymous = true;
                      }
                      self.recordQueue(qname, anonymous, options);
                    }
                    cb(error, qok);
                  });
};

Channel.prototype.checkQueue = function(queue, cb) {
  return this.rpc(defs.QueueDeclare,
                  Args.checkQueue(queue),
                  defs.QueueDeclareOk, cb);
};

Channel.prototype.deleteQueue = function(queue, options, cb) {
  var self = this;
  return this.rpc(defs.QueueDelete,
                  Args.deleteQueue(queue, options),
                  defs.QueueDeleteOk,
                  function(error, delok){
                    if(error === null) {
                      self.removeQueue(queue);
                    }
                    cb(error, delok);
                  });
};

Channel.prototype.purgeQueue = function(queue, cb) {
  return this.rpc(defs.QueuePurge,
                  Args.purgeQueue(queue),
                  defs.QueuePurgeOk, cb);
};

Channel.prototype.bindQueue =
  function(queue, source, pattern, argt, cb) {
    var self = this;
    return this.rpc(defs.QueueBind,
                    Args.bindQueue(queue, source, pattern, argt),
                    defs.QueueBindOk,
                    function(error, bindok) {
                      if(error === null) {
                        self.recordBinding("queue", queue, source, pattern, argt);
                      }
                      cb(error, bindok);
                    });
  };

Channel.prototype.unbindQueue =
  function(queue, source, pattern, argt, cb) {
    var self = this;
    return this.rpc(defs.QueueUnbind,
                    Args.unbindQueue(queue, source, pattern, argt),
                    defs.QueueUnbindOk,
                    function(error, unbindok) {
                      if(error === null) {
                        self.removeBinding("queue", queue, source, pattern, argt);
                      }
                      cb(error, unbindok);
                    });
  };

Channel.prototype.assertExchange = function(ex, type, options, cb0) {
  var cb = callbackWrapper(this, cb0);
  var self = this;
  this._rpc(defs.ExchangeDeclare,
            Args.assertExchange(ex, type, options),
            defs.ExchangeDeclareOk,
            function(e, _) {
              if(e === null){
                self.recordExchange(ex, type, options);
              }
              cb(e, {exchange: ex});
            });
  return this;
};

Channel.prototype.checkExchange = function(exchange, cb) {
  return this.rpc(defs.ExchangeDeclare,
                  Args.checkExchange(exchange),
                  defs.ExchangeDeclareOk, cb);
};

Channel.prototype.deleteExchange = function(exchange, options, cb) {
  var self = this;
  return this.rpc(defs.ExchangeDelete,
                  Args.deleteExchange(exchange, options),
                  defs.ExchangeDeleteOk,
                  function(error, deleteok) {
                    if(error === null) {
                      self.removeExchange(exchange);
                    }
                    cb(error, deleteok);
                  });
};

Channel.prototype.bindExchange =
  function(dest, source, pattern, argt, cb) {
    var self = this;
    return this.rpc(defs.ExchangeBind,
                    Args.bindExchange(dest, source, pattern, argt),
                    defs.ExchangeBindOk,
                    function(error, bindok) {
                      if(error === null) {
                        self.recordBinding("exchange", dest, source, pattern, argt);
                      }
                      cb(error, bindok);
                    });
  };

Channel.prototype.unbindExchange =
  function(dest, source, pattern, argt, cb) {
    var self = this;
    return this.rpc(defs.ExchangeUnbind,
                    Args.unbindExchange(dest, source, pattern, argt),
                    defs.ExchangeUnbindOk,
                    function(error, unbindok) {
                      if(error === null) {
                        self.removeBinding("exchange", dest, source, pattern, argt);
                      }
                      cb(error, unbindok);
                    });
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
        var consumerTag = ok.fields.consumerTag;
        self.registerConsumer(consumerTag, callback);
        //TODO: If autorecovery is enabled
        self.recordConsumer(consumerTag, queue, callback, options);
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
        //TODO: If autorecovery is enabled
        self.removeConsumer(consumerTag);
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
  // Drop all older incarnations acks.
  if(message.incarnation == this.incarnation) {
    this.sendImmediately(
      defs.BasicAck, Args.ack(message.fields.deliveryTag, allUpTo));
  }
  return this;
};

Channel.prototype.ackAll = function() {
  this.sendImmediately(defs.BasicAck, Args.ack(0, true));
  return this;
};

Channel.prototype.nack = function(message, allUpTo, requeue) {
  // Drop all older incarnations nacks.
  if(message.incarnation == this.incarnation) {
    this.sendImmediately(
      defs.BasicNack,
      Args.nack(message.fields.deliveryTag, allUpTo, requeue));
  }
  return this;
};

Channel.prototype.nackAll = function(requeue) {
  this.sendImmediately(
    defs.BasicNack, Args.nack(0, true, requeue))
  return this;
};

Channel.prototype.reject = function(message, requeue) {
  // Drop all older incarnations nacks.
  if(message.incarnation == this.incarnation) {
    this.sendImmediately(
      defs.BasicReject,
      Args.reject(message.fields.deliveryTag, requeue));
  }
  return this;
};

Channel.prototype.prefetch = function(count, global, cb) {
  var self = this;
  return this.rpc(defs.BasicQos,
                  Args.prefetch(count, global),
                  defs.BasicQosOk,
                  function(error, prefetchok) {
                    if(error === null) {
                      self.recordPrefetch(count, global);
                    }
                    cb(error, prefetchok);
                  });
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
