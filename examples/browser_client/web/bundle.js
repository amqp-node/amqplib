(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
(function (Buffer){
'use strict';
var format = require('util').format;

var Connection = require('./../../../lib/ws_connection').WebSocketConnection;
var CallbackModel = require('./../../../lib/callback_model').CallbackModel;

var correlationIds = {};
var connection;
var channel;

var outputContainer;

var r = Math.random().toString();

var amqpConfig = {
  tunnelHost: 'slackware',
  tunnelPort: '1234',
  username: 'admin',
  password: 'admin',
  rpcExchange: 'example.rpc',
  rpcRequestQueue: 'rpc.request.WEB-' + r,
  rpcResponseQueue: 'rpc.response.WEB-' + r
};

var ws = new WebSocket('ws://' + amqpConfig.tunnelHost + ':' +
  amqpConfig.tunnelPort);

function publishMessage(method, payload) {
  var correlationId = Math.random().toString();
  correlationIds[correlationId] = true;
  channel.publish(
    amqpConfig.rpcExchange,
    method,
    Buffer.from(JSON.stringify(payload)), {
      correlationId: correlationId,
      replyTo: amqpConfig.rpcResponseQueue
    }
  );
}

function onMessage(msg) {
  if(!(msg.properties.correlationId in correlationIds)) {
    return;
  }
  delete correlationIds[msg.properties.correlationId];
  msg.content = JSON.parse(msg.content.toString());
  var outputMessage = format('[ RX ] @ %s \n%s\n\n', new Date().toISOString(),
    JSON.stringify(msg, null, '  '));
  console.log(outputMessage);
  outputContainer.appendChild(document.createTextNode(outputMessage));
  outputContainer.scrollTop = outputContainer.scrollHeight;
}

ws.onopen = function() {
  connection = new Connection(ws);
  var username = amqpConfig.username;
  var password = amqpConfig.password;
  var openFrames = {
    // start-ok
    mechanism: 'PLAIN',
    response: new Buffer(['', username, password].join(String.fromCharCode(0))),
    locale: 'en_US',
    clientProperties: {
      product: 'amqplib (browser WebSocket client)',
      version: '0.0.1',
      platform: 'Chrome',
      information: 'http://squaremo.github.io/amqp.node',
      capabilities: {
        publisher_confirms: true,
        exchange_exchange_bindings: true,
        'basic.nack': true,
        consumer_cancel_notify: true,
        'connection.blocked': true,
        authentication_failure_close: true
      }
    },

    // tune-ok
    channelMax: 0,
    frameMax: 0x1000,
    heartbeat: 60,

    // open
    virtualHost: '/',
    capabilities: '',
    insist: 0
  };

  connection.open(openFrames, function(err) {
    if(err) {
      return console.error(err.message);
    }
    connection = new CallbackModel(connection);

    connection.createChannel(function(err, ch) {
      if(err) {
        return console.log(err);
      }
      ch.assertQueue(null, {exclusive: true}, function(err, q) {
        ch.bindQueue(q.queue, 'amq.rabbitmq.log', '#');
        ch.bindQueue(q.queue, 'amq.rabbitmq.trace', '#');
        channel.consume(q.queue, function(msg) {
          console.log(msg.content.toString());
        }, {noAck: true});
      });
    });

    connection.createChannel(function(err, ch) {
      if(err) {
        return console.log(err);
      }
      channel = ch;
      channel.checkExchange(amqpConfig.rpcExchange);
      channel.assertQueue(amqpConfig.rpcResponseQueue, {
        exclusive: true,
        durable: false
      }, function(err, q) {
        channel.consume(q.queue, onMessage, {noAck: true});
      });
    });
  });
};

window.onload = function() {
  outputContainer = document.getElementById('output');
};

window.onbeforeunload = function() {
  connection.close();
  ws.close();
}

window.echo = function(msgToEcho) {
  publishMessage('echo', {
    echoMessage: msgToEcho
  });
};

}).call(this,require("buffer").Buffer)
},{"./../../../lib/callback_model":4,"./../../../lib/ws_connection":12,"buffer":24,"util":31}],2:[function(require,module,exports){
//
//
//

'use strict';

/*
The channel (promise) and callback APIs have similar signatures, and
in particular, both need AMQP fields prepared from the same arguments
and options. The arguments marshalling is done here. Each of the
procedures below takes arguments and options (the latter in an object)
particular to the operation it represents, and returns an object with
fields for handing to the encoder.
*/

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

var Args = {};

Args.assertQueue = function(queue, options) {
  queue = queue || '';
  options = options || EMPTY_OPTIONS;

  var argt = Object.create(options.arguments || null);
  setIfDefined(argt, 'x-expires', options.expires);
  setIfDefined(argt, 'x-message-ttl', options.messageTtl);
  setIfDefined(argt, 'x-dead-letter-exchange',
               options.deadLetterExchange);
  setIfDefined(argt, 'x-dead-letter-routing-key',
               options.deadLetterRoutingKey);
  setIfDefined(argt, 'x-max-length', options.maxLength);
  setIfDefined(argt, 'x-max-priority', options.maxPriority);

  return {
    queue: queue,
    exclusive: !!options.exclusive,
    durable: (options.durable === undefined) ? true : options.durable,
    autoDelete: !!options.autoDelete,
    arguments: argt,
    passive: false,
    // deprecated but we have to include it
    ticket: 0,
    nowait: false
  };
};

Args.checkQueue = function(queue) {
  return {
    queue: queue,
    passive: true, // switch to "completely different" mode
    nowait: false,
    durable: true, autoDelete: false, exclusive: false, // ignored
    ticket: 0,
  };
};

Args.deleteQueue = function(queue, options) {
  options = options || EMPTY_OPTIONS;
  return {
    queue: queue,
    ifUnused: !!options.ifUnused,
    ifEmpty: !!options.ifEmpty,
    ticket: 0, nowait: false
  };
};

Args.purgeQueue = function(queue) {
  return {
    queue: queue,
    ticket: 0, nowait: false
  };
};

Args.bindQueue = function(queue, source, pattern, argt) {
  return {
    queue: queue,
    exchange: source,
    routingKey: pattern,
    arguments: argt,
    ticket: 0, nowait: false
  };
};

Args.unbindQueue = function(queue, source, pattern, argt) {
  return {
    queue: queue,
    exchange: source,
    routingKey: pattern,
    arguments: argt,
    ticket: 0, nowait: false
  };
};

Args.assertExchange = function(exchange, type, options) {
  options = options || EMPTY_OPTIONS;
  var argt = Object.create(options.arguments || null);
  setIfDefined(argt, 'alternate-exchange', options.alternateExchange);
  return {
    exchange: exchange,
    ticket: 0,
    type: type,
    passive: false,
    durable: (options.durable === undefined) ? true : options.durable,
    autoDelete: !!options.autoDelete,
    internal: !!options.internal,
    nowait: false,
    arguments: argt
  };
};

Args.checkExchange = function(exchange) {
  return {
    exchange: exchange,
    passive: true, // switch to 'may as well be another method' mode
    nowait: false,
    // ff are ignored
    durable: true, internal: false,  type: '',  autoDelete: false,
    ticket: 0
  };
};

Args.deleteExchange = function(exchange, options) {
  options = options || EMPTY_OPTIONS;
  return {
    exchange: exchange,
    ifUnused: !!options.ifUnused,
    ticket: 0, nowait: false
  };
};

Args.bindExchange = function(dest, source, pattern, argt) {
  return {
    source: source,
    destination: dest,
    routingKey: pattern,
    arguments: argt,
    ticket: 0, nowait: false
  };
};

Args.unbindExchange = function(dest, source, pattern, argt) {
  return {
    source: source,
    destination: dest,
    routingKey: pattern,
    arguments: argt,
    ticket: 0, nowait: false
  };
};

// It's convenient to construct the properties and the method fields
// at the same time, since in the APIs, values for both can appear in
// `options`. Since the property or mthod field names don't overlap, I
// just return one big object that can be used for both purposes, and
// the encoder will pick out what it wants.
Args.publish = function(exchange, routingKey, options) {
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

  return {
    // method fields
    exchange: exchange,
    routingKey: routingKey,
    mandatory: !!options.mandatory,
    immediate: false, // RabbitMQ doesn't implement this any more
    ticket: undefined,
    // properties
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
    clusterId: undefined
  };
};

Args.consume = function(queue, options) {
  options = options || EMPTY_OPTIONS;
  var argt = Object.create(options.arguments || null);
  setIfDefined(argt, 'x-priority', options.priority);
  return {
    ticket: 0,
    queue: queue,
    consumerTag: options.consumerTag || '',
    noLocal: !!options.noLocal,
    noAck: !!options.noAck,
    exclusive: !!options.exclusive,
    nowait: false,
    arguments: argt
  };
};

Args.cancel = function(consumerTag) {
  return {
    consumerTag: consumerTag,
    nowait: false
  };
};

Args.get = function(queue, options) {
  options = options || EMPTY_OPTIONS;
  return {
    ticket: 0,
    queue: queue,
    noAck: !!options.noAck
  };
};

Args.ack = function(tag, allUpTo) {
  return {
    deliveryTag: tag,
    multiple: !!allUpTo
  };
};

Args.nack = function(tag, allUpTo, requeue) {
  return {
    deliveryTag: tag,
    multiple: !!allUpTo,
    requeue: (requeue === undefined) ? true : requeue
  };
};

Args.reject = function(tag, requeue) {
  return {
    deliveryTag: tag,
    requeue: (requeue === undefined) ? true : requeue
  };
};

Args.prefetch = function(count, global) {
  return {
    prefetchCount: count || 0,
    prefetchSize: 0,
    global: !!global
  };
};

Args.recover = function() {
  return {requeue: true};
};

module.exports = Object.freeze(Args);

},{}],3:[function(require,module,exports){
//
//
//

// A bitset implementation, after that in java.util.  Yes there
// already exist such things, but none implement next{Clear|Set}Bit or
// equivalent, and none involved me tooling about for an evening.

'use strict';

function BitSet(size) {
  if (size) {
    var numWords = Math.ceil(size / 32);
    this.words = new Array(numWords);
  }
  else {
    this.words = [];
  }
  this.wordsInUse = 0; // = number, not index
}

var P = BitSet.prototype;

function wordIndex(bitIndex) {
  return Math.floor(bitIndex / 32);
}

// Make sure we have at least numWords
P.ensureSize = function(numWords) {
  var wordsPresent = this.words.length;
  if (wordsPresent < numWords) {
    this.words = this.words.concat(new Array(numWords - wordsPresent));
  }
}

P.set = function(bitIndex) {
  var w = wordIndex(bitIndex);
  if (w >= this.wordsInUse) {
    this.ensureSize(w + 1);
    this.wordsInUse = w + 1;
  }
  var bit = 1 << bitIndex;
  this.words[w] |= bit;
};

P.clear = function(bitIndex) {
  var w = wordIndex(bitIndex);
  if (w >= this.wordsInUse) return;
  var mask = ~(1 << bitIndex);
  this.words[w] &= mask;
};

P.get = function(bitIndex) {
  var w = wordIndex(bitIndex);
  if (w >= this.wordsInUse) return false; // >= since index vs size
  var bit = 1 << bitIndex;
  return !!(this.words[w] & bit);
}

function trailingZeros(i) {
  // From Hacker's Delight, via JDK. Probably far less effective here,
  // since bit ops are not necessarily the quick way to do things in
  // JS.
  if (i === 0) return 32;
  var y, n = 31;
  y = i << 16; if (y != 0) { n = n -16; i = y; }
  y = i << 8;  if (y != 0) { n = n - 8; i = y; }
  y = i << 4;  if (y != 0) { n = n - 4; i = y; }
  y = i << 2;  if (y != 0) { n = n - 2; i = y; }
  return n - ((i << 1) >>> 31);
}

// Give the next bit that's set on or after fromIndex, or -1 if no such
// bit
P.nextSetBit = function(fromIndex) {
  var w = wordIndex(fromIndex);
  if (w >= this.wordsInUse) return -1;

  // the right-hand side is shifted to only test the bits of the first
  // word that are > fromIndex
  var word = this.words[w] & (0xffffffff << fromIndex);
  while (true) {
    if (word) return (w * 32) + trailingZeros(word);
    w++;
    if (w === this.wordsInUse) return -1;
    word = this.words[w];
  }
};

P.nextClearBit = function(fromIndex) {
  var w = wordIndex(fromIndex);
  if (w >= this.wordsInUse) return fromIndex;

  var word = ~(this.words[w]) & (0xffffffff << fromIndex);
  while (true) {
    if (word) return (w * 32) + trailingZeros(word);
    w++;
    if (w == this.wordsInUse) return w * 32;
    word = ~(this.words[w]);
  }
};

module.exports.BitSet = BitSet;

},{}],4:[function(require,module,exports){
'use strict';

var util = require('util');
var defs = require('./defs');
var Promise = require('bluebird');
var inherits = require('util').inherits;
var EventEmitter = require('events').EventEmitter;

var defs = require('./defs');
var BaseChannel = require('./channel').BaseChannel;
// var ConfirmChannel = require('./confirm_channel').ConfirmChannel;
var acceptMessage = require('./channel').acceptMessage;
var Args = require('./api_args');


function Channel(connection) {
  BaseChannel.call(this, connection);
  this.on('delivery', this.handleDelivery.bind(this));
  this.on('cancel', this.handleCancel.bind(this));
}
util.inherits(Channel, BaseChannel);
module.exports.Channel = Channel;



function CallbackModel(connection) {
  if(!(this instanceof CallbackModel)) {
    return new CallbackModel(connection);
  }
  EventEmitter.call(this);
  this.connection = connection;
  var self = this;
  ['error', 'close', 'blocked', 'unblocked'].forEach(function(ev) {
    connection.on(ev, self.emit.bind(self, ev));
  });
}
util.inherits(CallbackModel, EventEmitter);
module.exports.CallbackModel = CallbackModel;

CallbackModel.prototype.close = function(cb) {
  this.connection.close(cb);
};

CallbackModel.prototype.createChannel = function(cb) {
  cb = cb || function() {};
  var ch = new Channel(this.connection);
  ch.open(function(err) {
    if(err) {
      return cb(err);
    }
    cb(null, ch);
  });
  return ch;
};


// Wrap an RPC callback to make sure the callback is invoked with
// either `(null, value)` or `(error)`, i.e., never two non-null
// values. Also substitutes a stub if the callback is `undefined` or
// otherwise falsey, for convenience in methods for which the callback
// is optional (that is, most of them).
function callbackWrapper(ch, cb) {
  cb = cb || function() {};
  return function(err, ok) {
    if(err) {
      return cb(err);
    }
    cb(null, ok);
  };
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
    cb(err, ok && ok.fields); // in case of an error, ok will be undefined
  });
  return this;
};

// === Public API ===
Channel.prototype.open = function(cb) {
  try {
    this.allocate();
  } catch(ex) {
    return cb(ex);
  }
  return this.rpc(defs.ChannelOpen, {outOfBand: ''}, defs.ChannelOpenOk, cb);
};

Channel.prototype.close = function(cb) {
  cb = cb || function() {};
  return this.closeBecause('Goodbye', defs.constants.REPLY_SUCCESS, cb);
};

Channel.prototype.assertQueue = function(queue, options, cb) {
  return this.rpc(defs.QueueDeclare, Args.assertQueue(queue, options),
    defs.QueueDeclareOk, cb);
};

Channel.prototype.checkQueue = function(queue, cb) {
  return this.rpc(defs.QueueDeclare, Args.checkQueue(queue),
    defs.QueueDeclareOk, cb);
};

Channel.prototype.deleteQueue = function(queue, options, cb) {
  return this.rpc(defs.QueueDelete, Args.deleteQueue(queue, options),
    defs.QueueDeleteOk, cb);
};

Channel.prototype.purgeQueue = function(queue, cb) {
  return this.rpc(defs.QueuePurge, Args.purgeQueue(queue), defs.QueuePurgeOk,
    cb);
};

Channel.prototype.bindQueue = function(queue, source, pattern, argt, cb) {
  return this.rpc(defs.QueueBind, Args.bindQueue(queue, source, pattern, argt),
    defs.QueueBindOk, cb);
};

Channel.prototype.unbindQueue = function(queue, source, pattern, argt, cb) {
  return this.rpc(defs.QueueUnbind,
    Args.unbindQueue(queue, source, pattern, argt), defs.QueueUnbindOk, cb);
};

Channel.prototype.assertExchange = function(ex, type, options, cb0) {
  var cb = callbackWrapper(this, cb0);
  this._rpc(defs.ExchangeDeclare, Args.assertExchange(ex, type, options),
    defs.ExchangeDeclareOk, function(err) { cb(err, {exchange: ex}); });
  return this;
};

Channel.prototype.checkExchange = function(exchange, cb) {
  return this.rpc(defs.ExchangeDeclare, Args.checkExchange(exchange),
    defs.ExchangeDeclareOk, cb);
};

Channel.prototype.deleteExchange = function(exchange, options, cb) {
  return this.rpc(defs.ExchangeDelete, Args.deleteExchange(exchange, options),
    defs.ExchangeDeleteOk, cb);
};

Channel.prototype.bindExchange = function(dest, source, pattern, argt, cb) {
  return this.rpc(defs.ExchangeBind,
    Args.bindExchange(dest, source, pattern, argt), defs.ExchangeBindOk, cb);
};

Channel.prototype.unbindExchange = function(dest, source, pattern, argt, cb) {
  return this.rpc(defs.ExchangeUnbind,
    Args.unbindExchange(dest, source, pattern, argt), defs.ExchangeUnbindOk,
      cb);
};

Channel.prototype.publish = function(exchange, routingKey, content, options) {
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
  this._rpc(defs.BasicConsume,
    fields,
    defs.BasicConsumeOk,
    function(err, ok) {
      if(err) {
        cb(err);
        return this;
      }
      self.registerConsumer(ok.fields.consumerTag, callback);
      cb(null, ok.fields);
    }
  );
  return this;
};

Channel.prototype.cancel = function(consumerTag, cb0) {
  var cb = callbackWrapper(this, cb0);
  var self = this;
  this._rpc(defs.BasicCancel,
    Args.cancel(consumerTag),
    defs.BasicCancelOk,
    function(err, ok) {
      if(err) {
        cb(err);
        return this;
      }
      self.unregisterConsumer(consumerTag);
      cb(null, ok.fields);
    }
  );
  return this;
};

Channel.prototype.get = function(queue, options, cb0) {
  var self = this;
  var fields = Args.get(queue, options);
  var cb = callbackWrapper(this, cb0);
  this.sendOrEnqueue(defs.BasicGet, fields, function(err, f) {
    if(err) {
      cb(err);
      return this;
    }
    if(f.id === defs.BasicGetEmpty) {
      cb(null, false);
    } else if(f.id === defs.BasicGetOk) {
      self.handleMessage = acceptMessage(function(m) {
        m.fields = f.fields;
        cb(null, m);
      });
    } else {
      cb(new Error('Unexpected response to BasicGet: ' + util.inspect(f)));
    }
  });

  return this;
};

Channel.prototype.ack = function(message, allUpTo) {
  this.sendImmediately(defs.BasicAck, Args.ack(message.fields.deliveryTag,
    allUpTo));
  return this;
};

Channel.prototype.ackAll = function() {
  this.sendImmediately(defs.BasicAck, Args.ack(0, true));
  return this;
};

Channel.prototype.nack = function(message, allUpTo, requeue) {
  this.sendImmediately(defs.BasicNack, Args.nack(message.fields.deliveryTag,
    allUpTo, requeue));
  return this;
};

Channel.prototype.nackAll = function(requeue) {
  this.sendImmediately(defs.BasicNack, Args.nack(0, true, requeue));
  return this;
};

Channel.prototype.reject = function(message, requeue) {
  this.sendImmediately(defs.BasicReject, Args.reject(message.fields.deliveryTag,
    requeue));
  return this;
};

Channel.prototype.prefetch = function(count, global, cb) {
  return this.rpc(defs.BasicQos, Args.prefetch(count, global), defs.BasicQosOk,
    cb);
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

},{"./api_args":2,"./channel":5,"./defs":7,"bluebird":20,"events":25,"util":31}],5:[function(require,module,exports){
(function (Buffer){
//
//
//

// Channel machinery.

'use strict';

var defs = require('./defs');
var closeMsg = require('./format').closeMessage;
var inspect = require('./format').inspect;
var methodName = require('./format').methodName;
var assert = require('assert');
var inherits = require('util').inherits;
var EventEmitter = require('events').EventEmitter;
var fmt = require('util').format;
var IllegalOperationError = require('./error').IllegalOperationError;
var stackCapture = require('./error').stackCapture;

function Channel(connection) {
  EventEmitter.call( this );
  this.connection = connection;
  // for the presently outstanding RPC
  this.reply = null;
  // for the RPCs awaiting action
  this.pending = [];
  // for unconfirmed messages
  this.lwm = 1; // the least, unconfirmed deliveryTag
  this.unconfirmed = []; // rolling window of delivery callbacks
  this.on('ack', this.handleConfirm.bind(this, function(cb) {
    if (cb) cb(null);
  }));
  this.on('nack', this.handleConfirm.bind(this, function(cb) {
    if (cb) cb(new Error('message nacked'));
  }));
  // message frame state machine
  this.handleMessage = acceptDeliveryOrReturn;
}
inherits(Channel, EventEmitter);

module.exports.Channel = Channel;
module.exports.acceptMessage = acceptMessage;

var C = Channel.prototype;

C.allocate = function() {
  this.ch = this.connection.freshChannel(this);
  return this;
}

// Incoming frames are either notifications of e.g., message delivery,
// or replies to something we've sent. In general I deal with the
// former by emitting an event, and with the latter by keeping a track
// of what's expecting a reply.
//
// The AMQP specification implies that RPCs can't be pipelined; that
// is, you can have only one outstanding RPC on a channel at a
// time. Certainly that's what RabbitMQ and its clients assume. For
// this reason, I buffer RPCs if the channel is already waiting for a
// reply.

// Just send the damn frame.
C.sendImmediately = function(method, fields) {
  return this.connection.sendMethod(this.ch, method, fields);
};

// Invariant: !this.reply -> pending.length == 0. That is, whenever we
// clear a reply, we must send another RPC (and thereby fill
// this.reply) if there is one waiting. The invariant relevant here
// and in `accept`.
C.sendOrEnqueue = function(method, fields, reply) {
  if (!this.reply) { // if no reply waiting, we can go
    assert(this.pending.length === 0);
    this.reply = reply;
    this.sendImmediately(method, fields);
  }
  else {
    this.pending.push({method: method,
                       fields: fields,
                       reply: reply});
  }
};

C.sendMessage = function(fields, properties, content) {
  return this.connection.sendMessage(
    this.ch,
    defs.BasicPublish, fields,
    defs.BasicProperties, properties,
    content);
};

// Internal, synchronously resolved RPC; the return value is resolved
// with the whole frame.
C._rpc = function(method, fields, expect, cb) {
  var self = this;

  function reply(err, f) {
    if (err === null) {
      if (f.id === expect) {
        return cb(null, f);
      }
      else {
        // We have detected a problem, so it's up to us to close the
        // channel
        var expectedName = methodName(expect);
        var e = new Error(fmt("Expected %s; got %s",
                              expectedName, inspect(f, false)));
        self.closeWithError(fmt('Expected %s; got %s',
                                expectedName, methodName(f.id)),
                            defs.constants.UNEXPECTED_FRAME, e);
        return cb(e);
      }
    }
    // An error will be given if, for example, this is waiting to be
    // sent and the connection closes
    else if (err instanceof Error) return cb(err);
    // A close frame will be given if this is the RPC awaiting reply
    // and the channel is closed by the server
    else {
      // otherwise, it's a close frame
      var closeReason =
        (err.fields.classId << 16) + err.fields.methodId;
      var e = (method === closeReason)
        ? fmt("Operation failed: %s; %s",
              methodName(method), closeMsg(err))
        : fmt("Channel closed by server: %s", closeMsg(err));
      return cb(new Error(e));
    }
  }

  this.sendOrEnqueue(method, fields, reply);
};

// Shutdown protocol. There's three scenarios:
//
// 1. The application decides to shut the channel
// 2. The server decides to shut the channel, possibly because of
// something the application did
// 3. The connection is closing, so there won't be any more frames
// going back and forth.
//
// 1 and 2 involve an exchange of method frames (Close and CloseOk),
// while 3 doesn't; the connection simply says "shutdown" to the
// channel, which then acts as if it's closing, without going through
// the exchange.

function invalidOp(msg, stack) {
  return function() {
    throw new IllegalOperationError(msg, stack);
  };
}

function invalidateSend(ch, msg, stack) {
  ch.sendImmediately = ch.sendOrEnqueue = ch.sendMessage =
    invalidOp(msg, stack);
}

// Move to entirely closed state.
C.toClosed = function(capturedStack) {
  this._rejectPending();
  invalidateSend(this, 'Channel closed', capturedStack);
  this.accept = invalidOp('Channel closed', capturedStack);
  this.connection.releaseChannel(this.ch);
  this.emit('close');
};

// Stop being able to send and receive methods and content. Used when
// we close the channel. Invokes the continuation once the server has
// acknowledged the close, but before the channel is moved to the
// closed state.
C.toClosing = function(capturedStack, k) {
  var send = this.sendImmediately.bind(this);
  invalidateSend(this, 'Channel closing', capturedStack);

  this.accept = function(f) {
    if (f.id === defs.ChannelCloseOk) {
      if (k) k();
      var s = stackCapture('ChannelCloseOk frame received');
      this.toClosed(s);
    }
    else if (f.id === defs.ChannelClose) {
      send(defs.ChannelCloseOk, {});
    }
    // else ignore frame
  };
};

C._rejectPending = function() {
  function rej(r) { 
    r(new Error("Channel ended, no reply will be forthcoming"));
  }
  if (this.reply !== null) rej(this.reply);
  this.reply = null;

  var discard;
  while (discard = this.pending.shift()) rej(discard.reply);
  this.pending = null; // so pushes will break
};

C.closeBecause = function(reason, code, k) {
  this.sendImmediately(defs.ChannelClose, {
    replyText: reason,
    replyCode: code,
    methodId:0, classId: 0
  });
  var s = stackCapture('closeBecause called: ' + reason);
  this.toClosing(s, k);
};

// If we close because there's been an error, we need to distinguish
// between what we tell the server (`reason`) and what we report as
// the cause in the client (`error`).
C.closeWithError = function(reason, code, error) {
  var self = this;
  this.closeBecause(reason, code, function() {
    error.code = code;
    self.emit('error', error);
  });
};

// A trampolining state machine for message frames on a channel. A
// message arrives in at least two frames: first, a method announcing
// the message (either a BasicDeliver or BasicGetOk); then, a message
// header with the message properties; then, zero or more content
// frames.

// Keep the try/catch localised, in an attempt to avoid disabling
// optimisation
C.acceptMessageFrame = function(f) {
  try {
    this.handleMessage = this.handleMessage(f);
  }
  catch (msg) {
    if (typeof msg === 'string') {
      this.closeWithError(msg, defs.constants.UNEXPECTED_FRAME,
                          new Error(msg));
    }
    else if (msg instanceof Error) {
      this.closeWithError('Error while processing message',
                          defs.constants.INTERNAL_ERROR, msg);
    }
    else {
      this.closeWithError('Internal error while processing message',
                          defs.constants.INTERNAL_ERROR,
                          new Error(msg.toString()));
    }
  }
};

// Kick off a message delivery given a BasicDeliver or BasicReturn
// frame (BasicGet uses the RPC mechanism)
function acceptDeliveryOrReturn(f) {
  var event;
  if (f.id === defs.BasicDeliver) event = 'delivery';
  else if (f.id === defs.BasicReturn) event = 'return';
  else throw fmt("Expected BasicDeliver or BasicReturn; got %s",
                 inspect(f));

  var self = this;
  var fields = f.fields;
  return acceptMessage(function(message) {
    message.fields = fields;
    self.emit(event, message);
  });
}

// Move to the state of waiting for message frames (headers, then
// one or more content frames)
function acceptMessage(continuation) {
  var totalSize = 0, remaining = 0;
  var buffers = null;

  var message = {
    fields: null,
    properties: null,
    content: null
  };

  return headers;

  // expect a headers frame
  function headers(f) {
    if (f.id === defs.BasicProperties) {
      message.properties = f.fields;
      totalSize = remaining = f.size;
      
      // for zero-length messages, content frames aren't required.
      if (totalSize === 0) {
        message.content = new Buffer(0);
        continuation(message);
        return acceptDeliveryOrReturn;
      }
      else {
        return content;        
      }
    }
    else {
      throw "Expected headers frame after delivery";
    }
  }

  // expect a content frame
  // %%% TODO cancelled messages (sent as zero-length content frame)
  function content(f) {
    if (f.content) {
      var size = f.content.length;
      remaining -= size;
      if (remaining === 0) {
        if (buffers !== null) {
          buffers.push(f.content);
          message.content = Buffer.concat(buffers);
        }
        else {
          message.content = f.content;
        }
        continuation(message);
        return acceptDeliveryOrReturn;
      }
      else if (remaining < 0) {
        throw fmt("Too much content sent! Expected %d bytes",
                  totalSize);
      }
      else {
        if (buffers !== null)
          buffers.push(f.content);
        else
          buffers = [f.content];
        return content;
      }
    }
    else throw "Expected content frame after headers"
  }
}

C.handleConfirm = function(handle, f) {
  var tag = f.deliveryTag;
  var multi = f.multiple;

  if (multi) {
    var confirmed = this.unconfirmed.splice(0, tag - this.lwm + 1);
    this.lwm = tag + 1;
    confirmed.forEach(handle);
  }
  else {
    var c;
    if (tag === this.lwm) {
      c = this.unconfirmed.shift();
      this.lwm++;
      // Advance the LWM and the window to the next non-gap, or
      // possibly to the end
      while (this.unconfirmed[0] === null) {
        this.unconfirmed.shift();
        this.lwm++;
      }
    }
    else {
      c = this.unconfirmed[tag - this.lwm];
      this.unconfirmed[tag - this.lwm] = null;
    }
    // Technically, in the single-deliveryTag case, I should report a
    // protocol breach if it's already been confirmed.
    handle(c);
  }
};

C.pushConfirmCallback = function(cb) {
  // `null` is used specifically for marking already confirmed slots,
  // so I coerce `undefined` and `null` to false; functions are never
  // falsey.
  this.unconfirmed.push(cb || false);
};

// Interface for connection to use

C.accept = function(f) {

  switch (f.id) {

    // Message frames
  case undefined: // content frame!
  case defs.BasicDeliver:
  case defs.BasicReturn:
  case defs.BasicProperties:
    return this.acceptMessageFrame(f);

    // confirmations, need to do confirm.select first
  case defs.BasicAck:
    return this.emit('ack', f.fields);
  case defs.BasicNack:
    return this.emit('nack', f.fields);
  case defs.BasicCancel:
    // The broker can send this if e.g., the queue is deleted.
    return this.emit('cancel', f.fields);

  case defs.ChannelClose:
    // Any remote closure is an error to us. Reject the pending reply
    // with the close frame, so it can see whether it was that
    // operation that caused it to close.
    if (this.reply) {
      var reply = this.reply; this.reply = null;
      reply(f);
    }
    var emsg = "Channel closed by server: " + closeMsg(f);
    this.sendImmediately(defs.ChannelCloseOk, {});

    var error = new Error(emsg);
    error.code = f.fields.replyCode;
    this.emit('error', error);

    var s = stackCapture(emsg);
    this.toClosed(s);
    return;

  case defs.BasicFlow:
    // RabbitMQ doesn't send this, it just blocks the TCP socket
    return this.closeWithError("Flow not implemented",
                               defs.constants.NOT_IMPLEMENTED,
                               new Error('Flow not implemented'));

  default: // assume all other things are replies
    // Resolving the reply may lead to another RPC; to make sure we
    // don't hold that up, clear this.reply
    var reply = this.reply; this.reply = null;
    // however, maybe there's an RPC waiting to go? If so, that'll
    // fill this.reply again, restoring the invariant. This does rely
    // on any response being recv'ed after resolving the promise,
    // below; hence, I use synchronous defer.
    if (this.pending.length > 0) {
      var send = this.pending.shift();
      this.reply = send.reply;
      this.sendImmediately(send.method, send.fields);
    }
    return reply(null, f);
  }
};

C.onBufferDrain = function() {
  this.emit('drain');
};


// This adds just a bit more stuff useful for the APIs, but not
// low-level machinery.
function BaseChannel(connection) {
  Channel.call(this, connection);
  this.consumers = {};
}
inherits(BaseChannel, Channel);

module.exports.BaseChannel = BaseChannel;

// Not sure I like the ff, it's going to be changing hidden classes
// all over the place. On the other hand, whaddya do.
BaseChannel.prototype.registerConsumer = function(tag, callback) {
  this.consumers[tag] = callback;
};

BaseChannel.prototype.unregisterConsumer = function(tag) {
  delete this.consumers[tag];
};

BaseChannel.prototype.dispatchMessage = function(fields, message) {
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

BaseChannel.prototype.handleDelivery = function(message) {
  return this.dispatchMessage(message.fields, message);
};

BaseChannel.prototype.handleCancel = function(fields) {
  return this.dispatchMessage(fields, null);
};

}).call(this,require("buffer").Buffer)
},{"./defs":7,"./error":8,"./format":9,"assert":22,"buffer":24,"events":25,"util":31}],6:[function(require,module,exports){
(function (Buffer){
// 
//
//

/*

The AMQP 0-9-1 is a mess when it comes to the types that can be
encoded on the wire.

There are four encoding schemes, and three overlapping sets of types:
frames, methods, (field-)tables, and properties.

Each *frame type* has a set layout in which values of given types are
concatenated along with sections of "raw binary" data.

In frames there are `shortstr`s, that is length-prefixed strings of
UTF8 chars, 8 bit unsigned integers (called `octet`), unsigned 16 bit
integers (called `short` or `short-uint`), unsigned 32 bit integers
(called `long` or `long-uint`), unsigned 64 bit integers (called
`longlong` or `longlong-uint`), and flags (called `bit`).

Methods are encoded as a frame giving a method ID and a sequence of
arguments of known types. The encoded method argument values are
concatenated (with some fun complications around "packing" consecutive
bit values into bytes).

Along with the types given in frames, method arguments may be long
byte strings (`longstr`, not required to be UTF8) or 64 bit unsigned
integers to be interpreted as timestamps (yeah I don't know why
either), or arbitrary sets of key-value pairs (called `field-table`).

Inside a field table the keys are `shortstr` and the values are
prefixed with a byte tag giving the type. The types are any of the
above except for bits (which are replaced by byte-wide `bool`), along
with a NULL value `void`, a special fixed-precision number encoding
(`decimal`), IEEE754 `float`s and `double`s, signed integers,
`field-array` (a sequence of tagged values), and nested field-tables.

RabbitMQ and QPid use a subset of the field-table types, and different
value tags, established before the AMQP 0-9-1 specification was
published. So far as I know, no-one uses the types and tags as
published. http://www.rabbitmq.com/amqp-0-9-1-errata.html gives the
list of field-table types.

Lastly, there are (sets of) properties, only one of which is given in
AMQP 0-9-1: `BasicProperties`. These are almost the same as methods,
except that they appear in content header frames, which include a
content size, and they carry a set of flags indicating which
properties are present. This scheme can save ones of bytes per message
(messages which take a minimum of three frames each to send).

*/

'use strict';

var ints = require('buffer-more-ints');

// JavaScript uses only doubles so what I'm testing for is whether
// it's *better* to encode a number as a float or double. This really
// just amounts to testing whether there's a fractional part to the
// number, except that see below. NB I don't use bitwise operations to
// do this 'efficiently' -- it would mask the number to 32 bits.
//
// At 2^50, doubles don't have sufficient precision to distinguish
// between floating point and integer numbers (`Math.pow(2, 50) + 0.1
// === Math.pow(2, 50)` (and, above 2^53, doubles cannot represent all
// integers (`Math.pow(2, 53) + 1 === Math.pow(2, 53)`)). Hence
// anything with a magnitude at or above 2^50 may as well be encoded
// as a 64-bit integer. Except that only signed integers are supported
// by RabbitMQ, so anything above 2^63 - 1 must be a double.
function isFloatingPoint(n) {
    return n >= 0x8000000000000000 ||
        (Math.abs(n) < 0x4000000000000
         && Math.floor(n) !== n);
}

function encodeTable(buffer, val, offset) {
    var start = offset;
    offset += 4; // leave room for the table length
    for (var key in val) {
        if (val[key] !== undefined) {
          var len = Buffer.byteLength(key);
          buffer.writeUInt8(len, offset); offset++;
          buffer.write(key, offset, 'utf8'); offset += len;
          offset += encodeFieldValue(buffer, val[key], offset);
        }
    }
    var size = offset - start;
    buffer.writeUInt32BE(size - 4, start);
    return size;
}

function encodeArray(buffer, val, offset) {
    var start = offset;
    offset += 4;
    for (var i=0, num=val.length; i < num; i++) {
        offset += encodeFieldValue(buffer, val[i], offset);
    }
    var size = offset - start;
    buffer.writeUInt32BE(size - 4, start);
    return size;
}

function encodeFieldValue(buffer, value, offset) {
    var start = offset;
    var type = typeof value, val = value;
    // A trapdoor for specifying a type, e.g., timestamp
    if (value && type === 'object' && value.hasOwnProperty('!')) {
        val = value.value;
        type = value['!'];
    }

    function tag(t) { buffer.write(t, offset); offset++; }

    switch (type) {
    case 'string': // no shortstr in field tables
        var len = Buffer.byteLength(val, 'utf8');
        tag('S');
        buffer.writeUInt32BE(len, offset); offset += 4;
        buffer.write(val, offset, 'utf8'); offset += len;
        break;
    case 'object':
        if (val === null) {
            tag('V');
        }
        else if (Array.isArray(val)) {
            tag('A');
            offset += encodeArray(buffer, val, offset);
        }
        else if (Buffer.isBuffer(val)) {
            tag('x');
            buffer.writeUInt32BE(val.length, offset); offset += 4;
            val.copy(buffer, offset); offset += val.length;
        }
        else {
            tag('F');
            offset += encodeTable(buffer, val, offset);
        }
        break;
    case 'boolean':
        tag('t');
        buffer.writeUInt8((val) ? 1 : 0, offset); offset++;
        break;
    case 'number':
        // Making assumptions about the kind of number (floating point
        // v integer, signed, unsigned, size) desired is dangerous in
        // general; however, in practice RabbitMQ uses only
        // longstrings and unsigned integers in its arguments, and
        // other clients generally conflate number types anyway. So
        // the only distinction we care about is floating point vs
        // integers, preferring integers since those can be promoted
        // if necessary. If floating point is required, we may as well
        // use double precision.
        if (isFloatingPoint(val)) {
            tag('d');
            buffer.writeDoubleBE(val, offset);
            offset += 8;
        }
        else { // only signed values are used in tables by
               // RabbitMQ. It *used* to (< v3.3.0) treat the byte 'b'
               // type as unsigned, but most clients (and the spec)
               // think it's signed, and now RabbitMQ does too.
            if (val < 128 && val >= -128) {
                tag('b');
                buffer.writeInt8(val, offset); offset++;
            }
            else if (val >= -0x8000 && val < 0x8000) { //  short
                tag('s');
                buffer.writeInt16BE(val, offset); offset += 2;
            }
            else if (val >= -0x80000000 && val < 0x80000000) { // int
                tag('I');
                buffer.writeInt32BE(val, offset); offset += 4;
            }
            else { // long
                tag('l');
                ints.writeInt64BE(buffer, val, offset); offset += 8;
            }
        }
        break;
    // Now for exotic types, those can only be denoted by using
    // `{'!': type, value: val}
    case 'timestamp':
        tag('T');
        ints.writeUInt64BE(buffer, val, offset); offset += 8;
        break;
    case 'float':
        tag('f');
        buffer.writeFloatBE(val, offset); offset += 4;
        break;
    case 'decimal':
        tag('D');
        if (val.hasOwnProperty('places') && val.hasOwnProperty('digits')
            && val.places >= 0 && val.places < 256) {
            buffer[offset] = val.places; offset++;
            buffer.writeUInt32BE(val.digits, offset); offset += 4;
        }
        else throw new TypeError(
            "Decimal value must be {'places': 0..255, 'digits': uint32}, " +
                "got " + JSON.stringify(val));
        break;
    default:
        throw new TypeError('Unknown type to encode: ' + type);
    }
    return offset - start;
}

// Assume we're given a slice of the buffer that contains just the
// fields.
function decodeFields(slice) {
    var fields = {}, offset = 0, size = slice.length;
    var len, key, val;

    function decodeFieldValue() {
        var tag = String.fromCharCode(slice[offset]); offset++;
        switch (tag) {
        case 'b':
            val = slice.readInt8(offset); offset++;
            break;
        case 'S':
            len = slice.readUInt32BE(offset); offset += 4;
            val = slice.toString('utf8', offset, offset + len);
            offset += len;
            break;
        case 'I':
            val = slice.readInt32BE(offset); offset += 4;
            break;
        case 'D': // only positive decimals, apparently.
            var places = slice[offset]; offset++;
            var digits = slice.readUInt32BE(offset); offset += 4;
            val = {'!': 'decimal', value: {places: places, digits: digits}};
            break;
        case 'T':
            val = ints.readUInt64BE(slice, offset); offset += 8;
            val = {'!': 'timestamp', value: val};
            break;
        case 'F':
            len = slice.readUInt32BE(offset); offset += 4;
            val = decodeFields(slice.slice(offset, offset + len));
            offset += len;
            break;
        case 'A':
            len = slice.readUInt32BE(offset); offset += 4;
            decodeArray(offset + len);
            // NB decodeArray will itself update offset and val
            break;
        case 'd':
            val = slice.readDoubleBE(offset); offset += 8;
            break;
        case 'f':
            val = slice.readFloatBE(offset); offset += 4;
            break;
        case 'l':
            val = ints.readInt64BE(slice, offset); offset += 8;
            break;
        case 's':
            val = slice.readInt16BE(offset); offset += 2;
            break;
        case 't':
            val = slice[offset] != 0; offset++;
            break;
        case 'V':
            val = null;
            break;
        case 'x':
            len = slice.readUInt32BE(offset); offset += 4;
            val = slice.slice(offset, offset + len);
            offset += len;
            break;
        default:
            throw new TypeError('Unexpected type tag "' + tag +'"');
        }
    }

    function decodeArray(until) {
        var vals = [];
        while (offset < until) {
            decodeFieldValue();
            vals.push(val);
        }
        val = vals;
    }

    while (offset < size) {
        len = slice.readUInt8(offset); offset++;
        key = slice.toString('utf8', offset, offset + len);
        offset += len;
        decodeFieldValue();
        fields[key] = val;
    }
    return fields;
}

module.exports.encodeTable = encodeTable;
module.exports.decodeFields = decodeFields;

}).call(this,require("buffer").Buffer)
},{"buffer":24,"buffer-more-ints":21}],7:[function(require,module,exports){
(function (Buffer){
/** @preserve This file is generated by the script
 * ../bin/generate-defs.js, which is not in general included in a
 * distribution, but is available in the source repository e.g. at
 * https://github.com/squaremo/amqp.node/
 */
"use strict";

function decodeConnectionStart(buffer) {
  var val, len, offset = 0, fields = {
    versionMajor: void 0,
    versionMinor: void 0,
    serverProperties: void 0,
    mechanisms: void 0,
    locales: void 0
  };
  val = buffer[offset];
  offset++;
  fields.versionMajor = val;
  val = buffer[offset];
  offset++;
  fields.versionMinor = val;
  len = buffer.readUInt32BE(offset);
  offset += 4;
  val = decodeFields(buffer.slice(offset, offset + len));
  offset += len;
  fields.serverProperties = val;
  len = buffer.readUInt32BE(offset);
  offset += 4;
  val = buffer.slice(offset, offset + len);
  offset += len;
  fields.mechanisms = val;
  len = buffer.readUInt32BE(offset);
  offset += 4;
  val = buffer.slice(offset, offset + len);
  offset += len;
  fields.locales = val;
  return fields;
}

function encodeConnectionStart(channel, fields) {
  var len, offset = 0, val = null, varyingSize = 0, scratchOffset = 0;
  val = fields.serverProperties;
  if (void 0 === val) throw new Error("Missing value for mandatory field 'serverProperties'");
  if ("object" != typeof val) throw new TypeError("Field 'serverProperties' is the wrong type; must be an object");
  len = encodeTable(SCRATCH, val, scratchOffset);
  var serverProperties_encoded = SCRATCH.slice(scratchOffset, scratchOffset + len);
  scratchOffset += len;
  varyingSize += serverProperties_encoded.length;
  val = fields.mechanisms;
  if (void 0 === val) val = new Buffer("PLAIN"); else if (!Buffer.isBuffer(val)) throw new TypeError("Field 'mechanisms' is the wrong type; must be a Buffer");
  varyingSize += val.length;
  val = fields.locales;
  if (void 0 === val) val = new Buffer("en_US"); else if (!Buffer.isBuffer(val)) throw new TypeError("Field 'locales' is the wrong type; must be a Buffer");
  varyingSize += val.length;
  var buffer = new Buffer(22 + varyingSize);
  buffer[0] = 1;
  buffer.writeUInt16BE(channel, 1);
  buffer.writeUInt32BE(655370, 7);
  offset = 11;
  val = fields.versionMajor;
  if (void 0 === val) val = 0; else if ("number" != typeof val || isNaN(val)) throw new TypeError("Field 'versionMajor' is the wrong type; must be a number (but not NaN)");
  buffer.writeUInt8(val, offset);
  offset++;
  val = fields.versionMinor;
  if (void 0 === val) val = 9; else if ("number" != typeof val || isNaN(val)) throw new TypeError("Field 'versionMinor' is the wrong type; must be a number (but not NaN)");
  buffer.writeUInt8(val, offset);
  offset++;
  offset += serverProperties_encoded.copy(buffer, offset);
  val = fields.mechanisms;
  void 0 === val && (val = new Buffer("PLAIN"));
  len = val.length;
  buffer.writeUInt32BE(len, offset);
  offset += 4;
  val.copy(buffer, offset);
  offset += len;
  val = fields.locales;
  void 0 === val && (val = new Buffer("en_US"));
  len = val.length;
  buffer.writeUInt32BE(len, offset);
  offset += 4;
  val.copy(buffer, offset);
  offset += len;
  buffer[offset] = 206;
  buffer.writeUInt32BE(offset - 7, 3);
  return buffer;
}

function decodeConnectionStartOk(buffer) {
  var val, len, offset = 0, fields = {
    clientProperties: void 0,
    mechanism: void 0,
    response: void 0,
    locale: void 0
  };
  len = buffer.readUInt32BE(offset);
  offset += 4;
  val = decodeFields(buffer.slice(offset, offset + len));
  offset += len;
  fields.clientProperties = val;
  len = buffer.readUInt8(offset);
  offset++;
  val = buffer.toString("utf8", offset, offset + len);
  offset += len;
  fields.mechanism = val;
  len = buffer.readUInt32BE(offset);
  offset += 4;
  val = buffer.slice(offset, offset + len);
  offset += len;
  fields.response = val;
  len = buffer.readUInt8(offset);
  offset++;
  val = buffer.toString("utf8", offset, offset + len);
  offset += len;
  fields.locale = val;
  return fields;
}

function encodeConnectionStartOk(channel, fields) {
  var len, offset = 0, val = null, varyingSize = 0, scratchOffset = 0;
  val = fields.clientProperties;
  if (void 0 === val) throw new Error("Missing value for mandatory field 'clientProperties'");
  if ("object" != typeof val) throw new TypeError("Field 'clientProperties' is the wrong type; must be an object");
  len = encodeTable(SCRATCH, val, scratchOffset);
  var clientProperties_encoded = SCRATCH.slice(scratchOffset, scratchOffset + len);
  scratchOffset += len;
  varyingSize += clientProperties_encoded.length;
  val = fields.mechanism;
  if (void 0 === val) val = "PLAIN"; else if (!("string" == typeof val && Buffer.byteLength(val) < 256)) throw new TypeError("Field 'mechanism' is the wrong type; must be a string (up to 255 chars)");
  var mechanism_len = Buffer.byteLength(val, "utf8");
  varyingSize += mechanism_len;
  val = fields.response;
  if (void 0 === val) throw new Error("Missing value for mandatory field 'response'");
  if (!Buffer.isBuffer(val)) throw new TypeError("Field 'response' is the wrong type; must be a Buffer");
  varyingSize += val.length;
  val = fields.locale;
  if (void 0 === val) val = "en_US"; else if (!("string" == typeof val && Buffer.byteLength(val) < 256)) throw new TypeError("Field 'locale' is the wrong type; must be a string (up to 255 chars)");
  var locale_len = Buffer.byteLength(val, "utf8");
  varyingSize += locale_len;
  var buffer = new Buffer(18 + varyingSize);
  buffer[0] = 1;
  buffer.writeUInt16BE(channel, 1);
  buffer.writeUInt32BE(655371, 7);
  offset = 11;
  offset += clientProperties_encoded.copy(buffer, offset);
  val = fields.mechanism;
  void 0 === val && (val = "PLAIN");
  buffer[offset] = mechanism_len;
  offset++;
  buffer.write(val, offset, "utf8");
  offset += mechanism_len;
  val = fields.response;
  void 0 === val && (val = new Buffer(void 0));
  len = val.length;
  buffer.writeUInt32BE(len, offset);
  offset += 4;
  val.copy(buffer, offset);
  offset += len;
  val = fields.locale;
  void 0 === val && (val = "en_US");
  buffer[offset] = locale_len;
  offset++;
  buffer.write(val, offset, "utf8");
  offset += locale_len;
  buffer[offset] = 206;
  buffer.writeUInt32BE(offset - 7, 3);
  return buffer;
}

function decodeConnectionSecure(buffer) {
  var val, len, offset = 0, fields = {
    challenge: void 0
  };
  len = buffer.readUInt32BE(offset);
  offset += 4;
  val = buffer.slice(offset, offset + len);
  offset += len;
  fields.challenge = val;
  return fields;
}

function encodeConnectionSecure(channel, fields) {
  var len, offset = 0, val = null, varyingSize = 0;
  val = fields.challenge;
  if (void 0 === val) throw new Error("Missing value for mandatory field 'challenge'");
  if (!Buffer.isBuffer(val)) throw new TypeError("Field 'challenge' is the wrong type; must be a Buffer");
  varyingSize += val.length;
  var buffer = new Buffer(16 + varyingSize);
  buffer[0] = 1;
  buffer.writeUInt16BE(channel, 1);
  buffer.writeUInt32BE(655380, 7);
  offset = 11;
  val = fields.challenge;
  void 0 === val && (val = new Buffer(void 0));
  len = val.length;
  buffer.writeUInt32BE(len, offset);
  offset += 4;
  val.copy(buffer, offset);
  offset += len;
  buffer[offset] = 206;
  buffer.writeUInt32BE(offset - 7, 3);
  return buffer;
}

function decodeConnectionSecureOk(buffer) {
  var val, len, offset = 0, fields = {
    response: void 0
  };
  len = buffer.readUInt32BE(offset);
  offset += 4;
  val = buffer.slice(offset, offset + len);
  offset += len;
  fields.response = val;
  return fields;
}

function encodeConnectionSecureOk(channel, fields) {
  var len, offset = 0, val = null, varyingSize = 0;
  val = fields.response;
  if (void 0 === val) throw new Error("Missing value for mandatory field 'response'");
  if (!Buffer.isBuffer(val)) throw new TypeError("Field 'response' is the wrong type; must be a Buffer");
  varyingSize += val.length;
  var buffer = new Buffer(16 + varyingSize);
  buffer[0] = 1;
  buffer.writeUInt16BE(channel, 1);
  buffer.writeUInt32BE(655381, 7);
  offset = 11;
  val = fields.response;
  void 0 === val && (val = new Buffer(void 0));
  len = val.length;
  buffer.writeUInt32BE(len, offset);
  offset += 4;
  val.copy(buffer, offset);
  offset += len;
  buffer[offset] = 206;
  buffer.writeUInt32BE(offset - 7, 3);
  return buffer;
}

function decodeConnectionTune(buffer) {
  var val, offset = 0, fields = {
    channelMax: void 0,
    frameMax: void 0,
    heartbeat: void 0
  };
  val = buffer.readUInt16BE(offset);
  offset += 2;
  fields.channelMax = val;
  val = buffer.readUInt32BE(offset);
  offset += 4;
  fields.frameMax = val;
  val = buffer.readUInt16BE(offset);
  offset += 2;
  fields.heartbeat = val;
  return fields;
}

function encodeConnectionTune(channel, fields) {
  var offset = 0, val = null, varyingSize = 0, buffer = new Buffer(20 + varyingSize);
  buffer[0] = 1;
  buffer.writeUInt16BE(channel, 1);
  buffer.writeUInt32BE(655390, 7);
  offset = 11;
  val = fields.channelMax;
  if (void 0 === val) val = 0; else if ("number" != typeof val || isNaN(val)) throw new TypeError("Field 'channelMax' is the wrong type; must be a number (but not NaN)");
  buffer.writeUInt16BE(val, offset);
  offset += 2;
  val = fields.frameMax;
  if (void 0 === val) val = 0; else if ("number" != typeof val || isNaN(val)) throw new TypeError("Field 'frameMax' is the wrong type; must be a number (but not NaN)");
  buffer.writeUInt32BE(val, offset);
  offset += 4;
  val = fields.heartbeat;
  if (void 0 === val) val = 0; else if ("number" != typeof val || isNaN(val)) throw new TypeError("Field 'heartbeat' is the wrong type; must be a number (but not NaN)");
  buffer.writeUInt16BE(val, offset);
  offset += 2;
  buffer[offset] = 206;
  buffer.writeUInt32BE(offset - 7, 3);
  return buffer;
}

function decodeConnectionTuneOk(buffer) {
  var val, offset = 0, fields = {
    channelMax: void 0,
    frameMax: void 0,
    heartbeat: void 0
  };
  val = buffer.readUInt16BE(offset);
  offset += 2;
  fields.channelMax = val;
  val = buffer.readUInt32BE(offset);
  offset += 4;
  fields.frameMax = val;
  val = buffer.readUInt16BE(offset);
  offset += 2;
  fields.heartbeat = val;
  return fields;
}

function encodeConnectionTuneOk(channel, fields) {
  var offset = 0, val = null, varyingSize = 0, buffer = new Buffer(20 + varyingSize);
  buffer[0] = 1;
  buffer.writeUInt16BE(channel, 1);
  buffer.writeUInt32BE(655391, 7);
  offset = 11;
  val = fields.channelMax;
  if (void 0 === val) val = 0; else if ("number" != typeof val || isNaN(val)) throw new TypeError("Field 'channelMax' is the wrong type; must be a number (but not NaN)");
  buffer.writeUInt16BE(val, offset);
  offset += 2;
  val = fields.frameMax;
  if (void 0 === val) val = 0; else if ("number" != typeof val || isNaN(val)) throw new TypeError("Field 'frameMax' is the wrong type; must be a number (but not NaN)");
  buffer.writeUInt32BE(val, offset);
  offset += 4;
  val = fields.heartbeat;
  if (void 0 === val) val = 0; else if ("number" != typeof val || isNaN(val)) throw new TypeError("Field 'heartbeat' is the wrong type; must be a number (but not NaN)");
  buffer.writeUInt16BE(val, offset);
  offset += 2;
  buffer[offset] = 206;
  buffer.writeUInt32BE(offset - 7, 3);
  return buffer;
}

function decodeConnectionOpen(buffer) {
  var val, len, offset = 0, fields = {
    virtualHost: void 0,
    capabilities: void 0,
    insist: void 0
  };
  len = buffer.readUInt8(offset);
  offset++;
  val = buffer.toString("utf8", offset, offset + len);
  offset += len;
  fields.virtualHost = val;
  len = buffer.readUInt8(offset);
  offset++;
  val = buffer.toString("utf8", offset, offset + len);
  offset += len;
  fields.capabilities = val;
  val = !!(1 & buffer[offset]);
  fields.insist = val;
  return fields;
}

function encodeConnectionOpen(channel, fields) {
  var offset = 0, val = null, bits = 0, varyingSize = 0;
  val = fields.virtualHost;
  if (void 0 === val) val = "/"; else if (!("string" == typeof val && Buffer.byteLength(val) < 256)) throw new TypeError("Field 'virtualHost' is the wrong type; must be a string (up to 255 chars)");
  var virtualHost_len = Buffer.byteLength(val, "utf8");
  varyingSize += virtualHost_len;
  val = fields.capabilities;
  if (void 0 === val) val = ""; else if (!("string" == typeof val && Buffer.byteLength(val) < 256)) throw new TypeError("Field 'capabilities' is the wrong type; must be a string (up to 255 chars)");
  var capabilities_len = Buffer.byteLength(val, "utf8");
  varyingSize += capabilities_len;
  var buffer = new Buffer(15 + varyingSize);
  buffer[0] = 1;
  buffer.writeUInt16BE(channel, 1);
  buffer.writeUInt32BE(655400, 7);
  offset = 11;
  val = fields.virtualHost;
  void 0 === val && (val = "/");
  buffer[offset] = virtualHost_len;
  offset++;
  buffer.write(val, offset, "utf8");
  offset += virtualHost_len;
  val = fields.capabilities;
  void 0 === val && (val = "");
  buffer[offset] = capabilities_len;
  offset++;
  buffer.write(val, offset, "utf8");
  offset += capabilities_len;
  val = fields.insist;
  void 0 === val && (val = !1);
  val && (bits += 1);
  buffer[offset] = bits;
  offset++;
  buffer[offset] = 206;
  buffer.writeUInt32BE(offset - 7, 3);
  return buffer;
}

function decodeConnectionOpenOk(buffer) {
  var val, len, offset = 0, fields = {
    knownHosts: void 0
  };
  len = buffer.readUInt8(offset);
  offset++;
  val = buffer.toString("utf8", offset, offset + len);
  offset += len;
  fields.knownHosts = val;
  return fields;
}

function encodeConnectionOpenOk(channel, fields) {
  var offset = 0, val = null, varyingSize = 0;
  val = fields.knownHosts;
  if (void 0 === val) val = ""; else if (!("string" == typeof val && Buffer.byteLength(val) < 256)) throw new TypeError("Field 'knownHosts' is the wrong type; must be a string (up to 255 chars)");
  var knownHosts_len = Buffer.byteLength(val, "utf8");
  varyingSize += knownHosts_len;
  var buffer = new Buffer(13 + varyingSize);
  buffer[0] = 1;
  buffer.writeUInt16BE(channel, 1);
  buffer.writeUInt32BE(655401, 7);
  offset = 11;
  val = fields.knownHosts;
  void 0 === val && (val = "");
  buffer[offset] = knownHosts_len;
  offset++;
  buffer.write(val, offset, "utf8");
  offset += knownHosts_len;
  buffer[offset] = 206;
  buffer.writeUInt32BE(offset - 7, 3);
  return buffer;
}

function decodeConnectionClose(buffer) {
  var val, len, offset = 0, fields = {
    replyCode: void 0,
    replyText: void 0,
    classId: void 0,
    methodId: void 0
  };
  val = buffer.readUInt16BE(offset);
  offset += 2;
  fields.replyCode = val;
  len = buffer.readUInt8(offset);
  offset++;
  val = buffer.toString("utf8", offset, offset + len);
  offset += len;
  fields.replyText = val;
  val = buffer.readUInt16BE(offset);
  offset += 2;
  fields.classId = val;
  val = buffer.readUInt16BE(offset);
  offset += 2;
  fields.methodId = val;
  return fields;
}

function encodeConnectionClose(channel, fields) {
  var offset = 0, val = null, varyingSize = 0;
  val = fields.replyText;
  if (void 0 === val) val = ""; else if (!("string" == typeof val && Buffer.byteLength(val) < 256)) throw new TypeError("Field 'replyText' is the wrong type; must be a string (up to 255 chars)");
  var replyText_len = Buffer.byteLength(val, "utf8");
  varyingSize += replyText_len;
  var buffer = new Buffer(19 + varyingSize);
  buffer[0] = 1;
  buffer.writeUInt16BE(channel, 1);
  buffer.writeUInt32BE(655410, 7);
  offset = 11;
  val = fields.replyCode;
  if (void 0 === val) throw new Error("Missing value for mandatory field 'replyCode'");
  if ("number" != typeof val || isNaN(val)) throw new TypeError("Field 'replyCode' is the wrong type; must be a number (but not NaN)");
  buffer.writeUInt16BE(val, offset);
  offset += 2;
  val = fields.replyText;
  void 0 === val && (val = "");
  buffer[offset] = replyText_len;
  offset++;
  buffer.write(val, offset, "utf8");
  offset += replyText_len;
  val = fields.classId;
  if (void 0 === val) throw new Error("Missing value for mandatory field 'classId'");
  if ("number" != typeof val || isNaN(val)) throw new TypeError("Field 'classId' is the wrong type; must be a number (but not NaN)");
  buffer.writeUInt16BE(val, offset);
  offset += 2;
  val = fields.methodId;
  if (void 0 === val) throw new Error("Missing value for mandatory field 'methodId'");
  if ("number" != typeof val || isNaN(val)) throw new TypeError("Field 'methodId' is the wrong type; must be a number (but not NaN)");
  buffer.writeUInt16BE(val, offset);
  offset += 2;
  buffer[offset] = 206;
  buffer.writeUInt32BE(offset - 7, 3);
  return buffer;
}

function decodeConnectionCloseOk(buffer) {
  var fields = {};
  return fields;
}

function encodeConnectionCloseOk(channel, fields) {
  var offset = 0, varyingSize = 0, buffer = new Buffer(12 + varyingSize);
  buffer[0] = 1;
  buffer.writeUInt16BE(channel, 1);
  buffer.writeUInt32BE(655411, 7);
  offset = 11;
  buffer[offset] = 206;
  buffer.writeUInt32BE(offset - 7, 3);
  return buffer;
}

function decodeConnectionBlocked(buffer) {
  var val, len, offset = 0, fields = {
    reason: void 0
  };
  len = buffer.readUInt8(offset);
  offset++;
  val = buffer.toString("utf8", offset, offset + len);
  offset += len;
  fields.reason = val;
  return fields;
}

function encodeConnectionBlocked(channel, fields) {
  var offset = 0, val = null, varyingSize = 0;
  val = fields.reason;
  if (void 0 === val) val = ""; else if (!("string" == typeof val && Buffer.byteLength(val) < 256)) throw new TypeError("Field 'reason' is the wrong type; must be a string (up to 255 chars)");
  var reason_len = Buffer.byteLength(val, "utf8");
  varyingSize += reason_len;
  var buffer = new Buffer(13 + varyingSize);
  buffer[0] = 1;
  buffer.writeUInt16BE(channel, 1);
  buffer.writeUInt32BE(655420, 7);
  offset = 11;
  val = fields.reason;
  void 0 === val && (val = "");
  buffer[offset] = reason_len;
  offset++;
  buffer.write(val, offset, "utf8");
  offset += reason_len;
  buffer[offset] = 206;
  buffer.writeUInt32BE(offset - 7, 3);
  return buffer;
}

function decodeConnectionUnblocked(buffer) {
  var fields = {};
  return fields;
}

function encodeConnectionUnblocked(channel, fields) {
  var offset = 0, varyingSize = 0, buffer = new Buffer(12 + varyingSize);
  buffer[0] = 1;
  buffer.writeUInt16BE(channel, 1);
  buffer.writeUInt32BE(655421, 7);
  offset = 11;
  buffer[offset] = 206;
  buffer.writeUInt32BE(offset - 7, 3);
  return buffer;
}

function decodeChannelOpen(buffer) {
  var val, len, offset = 0, fields = {
    outOfBand: void 0
  };
  len = buffer.readUInt8(offset);
  offset++;
  val = buffer.toString("utf8", offset, offset + len);
  offset += len;
  fields.outOfBand = val;
  return fields;
}

function encodeChannelOpen(channel, fields) {
  var offset = 0, val = null, varyingSize = 0;
  val = fields.outOfBand;
  if (void 0 === val) val = ""; else if (!("string" == typeof val && Buffer.byteLength(val) < 256)) throw new TypeError("Field 'outOfBand' is the wrong type; must be a string (up to 255 chars)");
  var outOfBand_len = Buffer.byteLength(val, "utf8");
  varyingSize += outOfBand_len;
  var buffer = new Buffer(13 + varyingSize);
  buffer[0] = 1;
  buffer.writeUInt16BE(channel, 1);
  buffer.writeUInt32BE(1310730, 7);
  offset = 11;
  val = fields.outOfBand;
  void 0 === val && (val = "");
  buffer[offset] = outOfBand_len;
  offset++;
  buffer.write(val, offset, "utf8");
  offset += outOfBand_len;
  buffer[offset] = 206;
  buffer.writeUInt32BE(offset - 7, 3);
  return buffer;
}

function decodeChannelOpenOk(buffer) {
  var val, len, offset = 0, fields = {
    channelId: void 0
  };
  len = buffer.readUInt32BE(offset);
  offset += 4;
  val = buffer.slice(offset, offset + len);
  offset += len;
  fields.channelId = val;
  return fields;
}

function encodeChannelOpenOk(channel, fields) {
  var len, offset = 0, val = null, varyingSize = 0;
  val = fields.channelId;
  if (void 0 === val) val = new Buffer(""); else if (!Buffer.isBuffer(val)) throw new TypeError("Field 'channelId' is the wrong type; must be a Buffer");
  varyingSize += val.length;
  var buffer = new Buffer(16 + varyingSize);
  buffer[0] = 1;
  buffer.writeUInt16BE(channel, 1);
  buffer.writeUInt32BE(1310731, 7);
  offset = 11;
  val = fields.channelId;
  void 0 === val && (val = new Buffer(""));
  len = val.length;
  buffer.writeUInt32BE(len, offset);
  offset += 4;
  val.copy(buffer, offset);
  offset += len;
  buffer[offset] = 206;
  buffer.writeUInt32BE(offset - 7, 3);
  return buffer;
}

function decodeChannelFlow(buffer) {
  var val, offset = 0, fields = {
    active: void 0
  };
  val = !!(1 & buffer[offset]);
  fields.active = val;
  return fields;
}

function encodeChannelFlow(channel, fields) {
  var offset = 0, val = null, bits = 0, varyingSize = 0, buffer = new Buffer(13 + varyingSize);
  buffer[0] = 1;
  buffer.writeUInt16BE(channel, 1);
  buffer.writeUInt32BE(1310740, 7);
  offset = 11;
  val = fields.active;
  if (void 0 === val) throw new Error("Missing value for mandatory field 'active'");
  val && (bits += 1);
  buffer[offset] = bits;
  offset++;
  buffer[offset] = 206;
  buffer.writeUInt32BE(offset - 7, 3);
  return buffer;
}

function decodeChannelFlowOk(buffer) {
  var val, offset = 0, fields = {
    active: void 0
  };
  val = !!(1 & buffer[offset]);
  fields.active = val;
  return fields;
}

function encodeChannelFlowOk(channel, fields) {
  var offset = 0, val = null, bits = 0, varyingSize = 0, buffer = new Buffer(13 + varyingSize);
  buffer[0] = 1;
  buffer.writeUInt16BE(channel, 1);
  buffer.writeUInt32BE(1310741, 7);
  offset = 11;
  val = fields.active;
  if (void 0 === val) throw new Error("Missing value for mandatory field 'active'");
  val && (bits += 1);
  buffer[offset] = bits;
  offset++;
  buffer[offset] = 206;
  buffer.writeUInt32BE(offset - 7, 3);
  return buffer;
}

function decodeChannelClose(buffer) {
  var val, len, offset = 0, fields = {
    replyCode: void 0,
    replyText: void 0,
    classId: void 0,
    methodId: void 0
  };
  val = buffer.readUInt16BE(offset);
  offset += 2;
  fields.replyCode = val;
  len = buffer.readUInt8(offset);
  offset++;
  val = buffer.toString("utf8", offset, offset + len);
  offset += len;
  fields.replyText = val;
  val = buffer.readUInt16BE(offset);
  offset += 2;
  fields.classId = val;
  val = buffer.readUInt16BE(offset);
  offset += 2;
  fields.methodId = val;
  return fields;
}

function encodeChannelClose(channel, fields) {
  var offset = 0, val = null, varyingSize = 0;
  val = fields.replyText;
  if (void 0 === val) val = ""; else if (!("string" == typeof val && Buffer.byteLength(val) < 256)) throw new TypeError("Field 'replyText' is the wrong type; must be a string (up to 255 chars)");
  var replyText_len = Buffer.byteLength(val, "utf8");
  varyingSize += replyText_len;
  var buffer = new Buffer(19 + varyingSize);
  buffer[0] = 1;
  buffer.writeUInt16BE(channel, 1);
  buffer.writeUInt32BE(1310760, 7);
  offset = 11;
  val = fields.replyCode;
  if (void 0 === val) throw new Error("Missing value for mandatory field 'replyCode'");
  if ("number" != typeof val || isNaN(val)) throw new TypeError("Field 'replyCode' is the wrong type; must be a number (but not NaN)");
  buffer.writeUInt16BE(val, offset);
  offset += 2;
  val = fields.replyText;
  void 0 === val && (val = "");
  buffer[offset] = replyText_len;
  offset++;
  buffer.write(val, offset, "utf8");
  offset += replyText_len;
  val = fields.classId;
  if (void 0 === val) throw new Error("Missing value for mandatory field 'classId'");
  if ("number" != typeof val || isNaN(val)) throw new TypeError("Field 'classId' is the wrong type; must be a number (but not NaN)");
  buffer.writeUInt16BE(val, offset);
  offset += 2;
  val = fields.methodId;
  if (void 0 === val) throw new Error("Missing value for mandatory field 'methodId'");
  if ("number" != typeof val || isNaN(val)) throw new TypeError("Field 'methodId' is the wrong type; must be a number (but not NaN)");
  buffer.writeUInt16BE(val, offset);
  offset += 2;
  buffer[offset] = 206;
  buffer.writeUInt32BE(offset - 7, 3);
  return buffer;
}

function decodeChannelCloseOk(buffer) {
  var fields = {};
  return fields;
}

function encodeChannelCloseOk(channel, fields) {
  var offset = 0, varyingSize = 0, buffer = new Buffer(12 + varyingSize);
  buffer[0] = 1;
  buffer.writeUInt16BE(channel, 1);
  buffer.writeUInt32BE(1310761, 7);
  offset = 11;
  buffer[offset] = 206;
  buffer.writeUInt32BE(offset - 7, 3);
  return buffer;
}

function decodeAccessRequest(buffer) {
  var val, len, offset = 0, fields = {
    realm: void 0,
    exclusive: void 0,
    passive: void 0,
    active: void 0,
    write: void 0,
    read: void 0
  };
  len = buffer.readUInt8(offset);
  offset++;
  val = buffer.toString("utf8", offset, offset + len);
  offset += len;
  fields.realm = val;
  val = !!(1 & buffer[offset]);
  fields.exclusive = val;
  val = !!(2 & buffer[offset]);
  fields.passive = val;
  val = !!(4 & buffer[offset]);
  fields.active = val;
  val = !!(8 & buffer[offset]);
  fields.write = val;
  val = !!(16 & buffer[offset]);
  fields.read = val;
  return fields;
}

function encodeAccessRequest(channel, fields) {
  var offset = 0, val = null, bits = 0, varyingSize = 0;
  val = fields.realm;
  if (void 0 === val) val = "/data"; else if (!("string" == typeof val && Buffer.byteLength(val) < 256)) throw new TypeError("Field 'realm' is the wrong type; must be a string (up to 255 chars)");
  var realm_len = Buffer.byteLength(val, "utf8");
  varyingSize += realm_len;
  var buffer = new Buffer(14 + varyingSize);
  buffer[0] = 1;
  buffer.writeUInt16BE(channel, 1);
  buffer.writeUInt32BE(1966090, 7);
  offset = 11;
  val = fields.realm;
  void 0 === val && (val = "/data");
  buffer[offset] = realm_len;
  offset++;
  buffer.write(val, offset, "utf8");
  offset += realm_len;
  val = fields.exclusive;
  void 0 === val && (val = !1);
  val && (bits += 1);
  val = fields.passive;
  void 0 === val && (val = !0);
  val && (bits += 2);
  val = fields.active;
  void 0 === val && (val = !0);
  val && (bits += 4);
  val = fields.write;
  void 0 === val && (val = !0);
  val && (bits += 8);
  val = fields.read;
  void 0 === val && (val = !0);
  val && (bits += 16);
  buffer[offset] = bits;
  offset++;
  buffer[offset] = 206;
  buffer.writeUInt32BE(offset - 7, 3);
  return buffer;
}

function decodeAccessRequestOk(buffer) {
  var val, offset = 0, fields = {
    ticket: void 0
  };
  val = buffer.readUInt16BE(offset);
  offset += 2;
  fields.ticket = val;
  return fields;
}

function encodeAccessRequestOk(channel, fields) {
  var offset = 0, val = null, varyingSize = 0, buffer = new Buffer(14 + varyingSize);
  buffer[0] = 1;
  buffer.writeUInt16BE(channel, 1);
  buffer.writeUInt32BE(1966091, 7);
  offset = 11;
  val = fields.ticket;
  if (void 0 === val) val = 1; else if ("number" != typeof val || isNaN(val)) throw new TypeError("Field 'ticket' is the wrong type; must be a number (but not NaN)");
  buffer.writeUInt16BE(val, offset);
  offset += 2;
  buffer[offset] = 206;
  buffer.writeUInt32BE(offset - 7, 3);
  return buffer;
}

function decodeExchangeDeclare(buffer) {
  var val, len, offset = 0, fields = {
    ticket: void 0,
    exchange: void 0,
    type: void 0,
    passive: void 0,
    durable: void 0,
    autoDelete: void 0,
    internal: void 0,
    nowait: void 0,
    arguments: void 0
  };
  val = buffer.readUInt16BE(offset);
  offset += 2;
  fields.ticket = val;
  len = buffer.readUInt8(offset);
  offset++;
  val = buffer.toString("utf8", offset, offset + len);
  offset += len;
  fields.exchange = val;
  len = buffer.readUInt8(offset);
  offset++;
  val = buffer.toString("utf8", offset, offset + len);
  offset += len;
  fields.type = val;
  val = !!(1 & buffer[offset]);
  fields.passive = val;
  val = !!(2 & buffer[offset]);
  fields.durable = val;
  val = !!(4 & buffer[offset]);
  fields.autoDelete = val;
  val = !!(8 & buffer[offset]);
  fields.internal = val;
  val = !!(16 & buffer[offset]);
  fields.nowait = val;
  offset++;
  len = buffer.readUInt32BE(offset);
  offset += 4;
  val = decodeFields(buffer.slice(offset, offset + len));
  offset += len;
  fields.arguments = val;
  return fields;
}

function encodeExchangeDeclare(channel, fields) {
  var len, offset = 0, val = null, bits = 0, varyingSize = 0, scratchOffset = 0;
  val = fields.exchange;
  if (void 0 === val) throw new Error("Missing value for mandatory field 'exchange'");
  if (!("string" == typeof val && Buffer.byteLength(val) < 256)) throw new TypeError("Field 'exchange' is the wrong type; must be a string (up to 255 chars)");
  var exchange_len = Buffer.byteLength(val, "utf8");
  varyingSize += exchange_len;
  val = fields.type;
  if (void 0 === val) val = "direct"; else if (!("string" == typeof val && Buffer.byteLength(val) < 256)) throw new TypeError("Field 'type' is the wrong type; must be a string (up to 255 chars)");
  var type_len = Buffer.byteLength(val, "utf8");
  varyingSize += type_len;
  val = fields.arguments;
  if (void 0 === val) val = {}; else if ("object" != typeof val) throw new TypeError("Field 'arguments' is the wrong type; must be an object");
  len = encodeTable(SCRATCH, val, scratchOffset);
  var arguments_encoded = SCRATCH.slice(scratchOffset, scratchOffset + len);
  scratchOffset += len;
  varyingSize += arguments_encoded.length;
  var buffer = new Buffer(17 + varyingSize);
  buffer[0] = 1;
  buffer.writeUInt16BE(channel, 1);
  buffer.writeUInt32BE(2621450, 7);
  offset = 11;
  val = fields.ticket;
  if (void 0 === val) val = 0; else if ("number" != typeof val || isNaN(val)) throw new TypeError("Field 'ticket' is the wrong type; must be a number (but not NaN)");
  buffer.writeUInt16BE(val, offset);
  offset += 2;
  val = fields.exchange;
  void 0 === val && (val = void 0);
  buffer[offset] = exchange_len;
  offset++;
  buffer.write(val, offset, "utf8");
  offset += exchange_len;
  val = fields.type;
  void 0 === val && (val = "direct");
  buffer[offset] = type_len;
  offset++;
  buffer.write(val, offset, "utf8");
  offset += type_len;
  val = fields.passive;
  void 0 === val && (val = !1);
  val && (bits += 1);
  val = fields.durable;
  void 0 === val && (val = !1);
  val && (bits += 2);
  val = fields.autoDelete;
  void 0 === val && (val = !1);
  val && (bits += 4);
  val = fields.internal;
  void 0 === val && (val = !1);
  val && (bits += 8);
  val = fields.nowait;
  void 0 === val && (val = !1);
  val && (bits += 16);
  buffer[offset] = bits;
  offset++;
  bits = 0;
  offset += arguments_encoded.copy(buffer, offset);
  buffer[offset] = 206;
  buffer.writeUInt32BE(offset - 7, 3);
  return buffer;
}

function decodeExchangeDeclareOk(buffer) {
  var fields = {};
  return fields;
}

function encodeExchangeDeclareOk(channel, fields) {
  var offset = 0, varyingSize = 0, buffer = new Buffer(12 + varyingSize);
  buffer[0] = 1;
  buffer.writeUInt16BE(channel, 1);
  buffer.writeUInt32BE(2621451, 7);
  offset = 11;
  buffer[offset] = 206;
  buffer.writeUInt32BE(offset - 7, 3);
  return buffer;
}

function decodeExchangeDelete(buffer) {
  var val, len, offset = 0, fields = {
    ticket: void 0,
    exchange: void 0,
    ifUnused: void 0,
    nowait: void 0
  };
  val = buffer.readUInt16BE(offset);
  offset += 2;
  fields.ticket = val;
  len = buffer.readUInt8(offset);
  offset++;
  val = buffer.toString("utf8", offset, offset + len);
  offset += len;
  fields.exchange = val;
  val = !!(1 & buffer[offset]);
  fields.ifUnused = val;
  val = !!(2 & buffer[offset]);
  fields.nowait = val;
  return fields;
}

function encodeExchangeDelete(channel, fields) {
  var offset = 0, val = null, bits = 0, varyingSize = 0;
  val = fields.exchange;
  if (void 0 === val) throw new Error("Missing value for mandatory field 'exchange'");
  if (!("string" == typeof val && Buffer.byteLength(val) < 256)) throw new TypeError("Field 'exchange' is the wrong type; must be a string (up to 255 chars)");
  var exchange_len = Buffer.byteLength(val, "utf8");
  varyingSize += exchange_len;
  var buffer = new Buffer(16 + varyingSize);
  buffer[0] = 1;
  buffer.writeUInt16BE(channel, 1);
  buffer.writeUInt32BE(2621460, 7);
  offset = 11;
  val = fields.ticket;
  if (void 0 === val) val = 0; else if ("number" != typeof val || isNaN(val)) throw new TypeError("Field 'ticket' is the wrong type; must be a number (but not NaN)");
  buffer.writeUInt16BE(val, offset);
  offset += 2;
  val = fields.exchange;
  void 0 === val && (val = void 0);
  buffer[offset] = exchange_len;
  offset++;
  buffer.write(val, offset, "utf8");
  offset += exchange_len;
  val = fields.ifUnused;
  void 0 === val && (val = !1);
  val && (bits += 1);
  val = fields.nowait;
  void 0 === val && (val = !1);
  val && (bits += 2);
  buffer[offset] = bits;
  offset++;
  buffer[offset] = 206;
  buffer.writeUInt32BE(offset - 7, 3);
  return buffer;
}

function decodeExchangeDeleteOk(buffer) {
  var fields = {};
  return fields;
}

function encodeExchangeDeleteOk(channel, fields) {
  var offset = 0, varyingSize = 0, buffer = new Buffer(12 + varyingSize);
  buffer[0] = 1;
  buffer.writeUInt16BE(channel, 1);
  buffer.writeUInt32BE(2621461, 7);
  offset = 11;
  buffer[offset] = 206;
  buffer.writeUInt32BE(offset - 7, 3);
  return buffer;
}

function decodeExchangeBind(buffer) {
  var val, len, offset = 0, fields = {
    ticket: void 0,
    destination: void 0,
    source: void 0,
    routingKey: void 0,
    nowait: void 0,
    arguments: void 0
  };
  val = buffer.readUInt16BE(offset);
  offset += 2;
  fields.ticket = val;
  len = buffer.readUInt8(offset);
  offset++;
  val = buffer.toString("utf8", offset, offset + len);
  offset += len;
  fields.destination = val;
  len = buffer.readUInt8(offset);
  offset++;
  val = buffer.toString("utf8", offset, offset + len);
  offset += len;
  fields.source = val;
  len = buffer.readUInt8(offset);
  offset++;
  val = buffer.toString("utf8", offset, offset + len);
  offset += len;
  fields.routingKey = val;
  val = !!(1 & buffer[offset]);
  fields.nowait = val;
  offset++;
  len = buffer.readUInt32BE(offset);
  offset += 4;
  val = decodeFields(buffer.slice(offset, offset + len));
  offset += len;
  fields.arguments = val;
  return fields;
}

function encodeExchangeBind(channel, fields) {
  var len, offset = 0, val = null, bits = 0, varyingSize = 0, scratchOffset = 0;
  val = fields.destination;
  if (void 0 === val) throw new Error("Missing value for mandatory field 'destination'");
  if (!("string" == typeof val && Buffer.byteLength(val) < 256)) throw new TypeError("Field 'destination' is the wrong type; must be a string (up to 255 chars)");
  var destination_len = Buffer.byteLength(val, "utf8");
  varyingSize += destination_len;
  val = fields.source;
  if (void 0 === val) throw new Error("Missing value for mandatory field 'source'");
  if (!("string" == typeof val && Buffer.byteLength(val) < 256)) throw new TypeError("Field 'source' is the wrong type; must be a string (up to 255 chars)");
  var source_len = Buffer.byteLength(val, "utf8");
  varyingSize += source_len;
  val = fields.routingKey;
  if (void 0 === val) val = ""; else if (!("string" == typeof val && Buffer.byteLength(val) < 256)) throw new TypeError("Field 'routingKey' is the wrong type; must be a string (up to 255 chars)");
  var routingKey_len = Buffer.byteLength(val, "utf8");
  varyingSize += routingKey_len;
  val = fields.arguments;
  if (void 0 === val) val = {}; else if ("object" != typeof val) throw new TypeError("Field 'arguments' is the wrong type; must be an object");
  len = encodeTable(SCRATCH, val, scratchOffset);
  var arguments_encoded = SCRATCH.slice(scratchOffset, scratchOffset + len);
  scratchOffset += len;
  varyingSize += arguments_encoded.length;
  var buffer = new Buffer(18 + varyingSize);
  buffer[0] = 1;
  buffer.writeUInt16BE(channel, 1);
  buffer.writeUInt32BE(2621470, 7);
  offset = 11;
  val = fields.ticket;
  if (void 0 === val) val = 0; else if ("number" != typeof val || isNaN(val)) throw new TypeError("Field 'ticket' is the wrong type; must be a number (but not NaN)");
  buffer.writeUInt16BE(val, offset);
  offset += 2;
  val = fields.destination;
  void 0 === val && (val = void 0);
  buffer[offset] = destination_len;
  offset++;
  buffer.write(val, offset, "utf8");
  offset += destination_len;
  val = fields.source;
  void 0 === val && (val = void 0);
  buffer[offset] = source_len;
  offset++;
  buffer.write(val, offset, "utf8");
  offset += source_len;
  val = fields.routingKey;
  void 0 === val && (val = "");
  buffer[offset] = routingKey_len;
  offset++;
  buffer.write(val, offset, "utf8");
  offset += routingKey_len;
  val = fields.nowait;
  void 0 === val && (val = !1);
  val && (bits += 1);
  buffer[offset] = bits;
  offset++;
  bits = 0;
  offset += arguments_encoded.copy(buffer, offset);
  buffer[offset] = 206;
  buffer.writeUInt32BE(offset - 7, 3);
  return buffer;
}

function decodeExchangeBindOk(buffer) {
  var fields = {};
  return fields;
}

function encodeExchangeBindOk(channel, fields) {
  var offset = 0, varyingSize = 0, buffer = new Buffer(12 + varyingSize);
  buffer[0] = 1;
  buffer.writeUInt16BE(channel, 1);
  buffer.writeUInt32BE(2621471, 7);
  offset = 11;
  buffer[offset] = 206;
  buffer.writeUInt32BE(offset - 7, 3);
  return buffer;
}

function decodeExchangeUnbind(buffer) {
  var val, len, offset = 0, fields = {
    ticket: void 0,
    destination: void 0,
    source: void 0,
    routingKey: void 0,
    nowait: void 0,
    arguments: void 0
  };
  val = buffer.readUInt16BE(offset);
  offset += 2;
  fields.ticket = val;
  len = buffer.readUInt8(offset);
  offset++;
  val = buffer.toString("utf8", offset, offset + len);
  offset += len;
  fields.destination = val;
  len = buffer.readUInt8(offset);
  offset++;
  val = buffer.toString("utf8", offset, offset + len);
  offset += len;
  fields.source = val;
  len = buffer.readUInt8(offset);
  offset++;
  val = buffer.toString("utf8", offset, offset + len);
  offset += len;
  fields.routingKey = val;
  val = !!(1 & buffer[offset]);
  fields.nowait = val;
  offset++;
  len = buffer.readUInt32BE(offset);
  offset += 4;
  val = decodeFields(buffer.slice(offset, offset + len));
  offset += len;
  fields.arguments = val;
  return fields;
}

function encodeExchangeUnbind(channel, fields) {
  var len, offset = 0, val = null, bits = 0, varyingSize = 0, scratchOffset = 0;
  val = fields.destination;
  if (void 0 === val) throw new Error("Missing value for mandatory field 'destination'");
  if (!("string" == typeof val && Buffer.byteLength(val) < 256)) throw new TypeError("Field 'destination' is the wrong type; must be a string (up to 255 chars)");
  var destination_len = Buffer.byteLength(val, "utf8");
  varyingSize += destination_len;
  val = fields.source;
  if (void 0 === val) throw new Error("Missing value for mandatory field 'source'");
  if (!("string" == typeof val && Buffer.byteLength(val) < 256)) throw new TypeError("Field 'source' is the wrong type; must be a string (up to 255 chars)");
  var source_len = Buffer.byteLength(val, "utf8");
  varyingSize += source_len;
  val = fields.routingKey;
  if (void 0 === val) val = ""; else if (!("string" == typeof val && Buffer.byteLength(val) < 256)) throw new TypeError("Field 'routingKey' is the wrong type; must be a string (up to 255 chars)");
  var routingKey_len = Buffer.byteLength(val, "utf8");
  varyingSize += routingKey_len;
  val = fields.arguments;
  if (void 0 === val) val = {}; else if ("object" != typeof val) throw new TypeError("Field 'arguments' is the wrong type; must be an object");
  len = encodeTable(SCRATCH, val, scratchOffset);
  var arguments_encoded = SCRATCH.slice(scratchOffset, scratchOffset + len);
  scratchOffset += len;
  varyingSize += arguments_encoded.length;
  var buffer = new Buffer(18 + varyingSize);
  buffer[0] = 1;
  buffer.writeUInt16BE(channel, 1);
  buffer.writeUInt32BE(2621480, 7);
  offset = 11;
  val = fields.ticket;
  if (void 0 === val) val = 0; else if ("number" != typeof val || isNaN(val)) throw new TypeError("Field 'ticket' is the wrong type; must be a number (but not NaN)");
  buffer.writeUInt16BE(val, offset);
  offset += 2;
  val = fields.destination;
  void 0 === val && (val = void 0);
  buffer[offset] = destination_len;
  offset++;
  buffer.write(val, offset, "utf8");
  offset += destination_len;
  val = fields.source;
  void 0 === val && (val = void 0);
  buffer[offset] = source_len;
  offset++;
  buffer.write(val, offset, "utf8");
  offset += source_len;
  val = fields.routingKey;
  void 0 === val && (val = "");
  buffer[offset] = routingKey_len;
  offset++;
  buffer.write(val, offset, "utf8");
  offset += routingKey_len;
  val = fields.nowait;
  void 0 === val && (val = !1);
  val && (bits += 1);
  buffer[offset] = bits;
  offset++;
  bits = 0;
  offset += arguments_encoded.copy(buffer, offset);
  buffer[offset] = 206;
  buffer.writeUInt32BE(offset - 7, 3);
  return buffer;
}

function decodeExchangeUnbindOk(buffer) {
  var fields = {};
  return fields;
}

function encodeExchangeUnbindOk(channel, fields) {
  var offset = 0, varyingSize = 0, buffer = new Buffer(12 + varyingSize);
  buffer[0] = 1;
  buffer.writeUInt16BE(channel, 1);
  buffer.writeUInt32BE(2621491, 7);
  offset = 11;
  buffer[offset] = 206;
  buffer.writeUInt32BE(offset - 7, 3);
  return buffer;
}

function decodeQueueDeclare(buffer) {
  var val, len, offset = 0, fields = {
    ticket: void 0,
    queue: void 0,
    passive: void 0,
    durable: void 0,
    exclusive: void 0,
    autoDelete: void 0,
    nowait: void 0,
    arguments: void 0
  };
  val = buffer.readUInt16BE(offset);
  offset += 2;
  fields.ticket = val;
  len = buffer.readUInt8(offset);
  offset++;
  val = buffer.toString("utf8", offset, offset + len);
  offset += len;
  fields.queue = val;
  val = !!(1 & buffer[offset]);
  fields.passive = val;
  val = !!(2 & buffer[offset]);
  fields.durable = val;
  val = !!(4 & buffer[offset]);
  fields.exclusive = val;
  val = !!(8 & buffer[offset]);
  fields.autoDelete = val;
  val = !!(16 & buffer[offset]);
  fields.nowait = val;
  offset++;
  len = buffer.readUInt32BE(offset);
  offset += 4;
  val = decodeFields(buffer.slice(offset, offset + len));
  offset += len;
  fields.arguments = val;
  return fields;
}

function encodeQueueDeclare(channel, fields) {
  var len, offset = 0, val = null, bits = 0, varyingSize = 0, scratchOffset = 0;
  val = fields.queue;
  if (void 0 === val) val = ""; else if (!("string" == typeof val && Buffer.byteLength(val) < 256)) throw new TypeError("Field 'queue' is the wrong type; must be a string (up to 255 chars)");
  var queue_len = Buffer.byteLength(val, "utf8");
  varyingSize += queue_len;
  val = fields.arguments;
  if (void 0 === val) val = {}; else if ("object" != typeof val) throw new TypeError("Field 'arguments' is the wrong type; must be an object");
  len = encodeTable(SCRATCH, val, scratchOffset);
  var arguments_encoded = SCRATCH.slice(scratchOffset, scratchOffset + len);
  scratchOffset += len;
  varyingSize += arguments_encoded.length;
  var buffer = new Buffer(16 + varyingSize);
  buffer[0] = 1;
  buffer.writeUInt16BE(channel, 1);
  buffer.writeUInt32BE(3276810, 7);
  offset = 11;
  val = fields.ticket;
  if (void 0 === val) val = 0; else if ("number" != typeof val || isNaN(val)) throw new TypeError("Field 'ticket' is the wrong type; must be a number (but not NaN)");
  buffer.writeUInt16BE(val, offset);
  offset += 2;
  val = fields.queue;
  void 0 === val && (val = "");
  buffer[offset] = queue_len;
  offset++;
  buffer.write(val, offset, "utf8");
  offset += queue_len;
  val = fields.passive;
  void 0 === val && (val = !1);
  val && (bits += 1);
  val = fields.durable;
  void 0 === val && (val = !1);
  val && (bits += 2);
  val = fields.exclusive;
  void 0 === val && (val = !1);
  val && (bits += 4);
  val = fields.autoDelete;
  void 0 === val && (val = !1);
  val && (bits += 8);
  val = fields.nowait;
  void 0 === val && (val = !1);
  val && (bits += 16);
  buffer[offset] = bits;
  offset++;
  bits = 0;
  offset += arguments_encoded.copy(buffer, offset);
  buffer[offset] = 206;
  buffer.writeUInt32BE(offset - 7, 3);
  return buffer;
}

function decodeQueueDeclareOk(buffer) {
  var val, len, offset = 0, fields = {
    queue: void 0,
    messageCount: void 0,
    consumerCount: void 0
  };
  len = buffer.readUInt8(offset);
  offset++;
  val = buffer.toString("utf8", offset, offset + len);
  offset += len;
  fields.queue = val;
  val = buffer.readUInt32BE(offset);
  offset += 4;
  fields.messageCount = val;
  val = buffer.readUInt32BE(offset);
  offset += 4;
  fields.consumerCount = val;
  return fields;
}

function encodeQueueDeclareOk(channel, fields) {
  var offset = 0, val = null, varyingSize = 0;
  val = fields.queue;
  if (void 0 === val) throw new Error("Missing value for mandatory field 'queue'");
  if (!("string" == typeof val && Buffer.byteLength(val) < 256)) throw new TypeError("Field 'queue' is the wrong type; must be a string (up to 255 chars)");
  var queue_len = Buffer.byteLength(val, "utf8");
  varyingSize += queue_len;
  var buffer = new Buffer(21 + varyingSize);
  buffer[0] = 1;
  buffer.writeUInt16BE(channel, 1);
  buffer.writeUInt32BE(3276811, 7);
  offset = 11;
  val = fields.queue;
  void 0 === val && (val = void 0);
  buffer[offset] = queue_len;
  offset++;
  buffer.write(val, offset, "utf8");
  offset += queue_len;
  val = fields.messageCount;
  if (void 0 === val) throw new Error("Missing value for mandatory field 'messageCount'");
  if ("number" != typeof val || isNaN(val)) throw new TypeError("Field 'messageCount' is the wrong type; must be a number (but not NaN)");
  buffer.writeUInt32BE(val, offset);
  offset += 4;
  val = fields.consumerCount;
  if (void 0 === val) throw new Error("Missing value for mandatory field 'consumerCount'");
  if ("number" != typeof val || isNaN(val)) throw new TypeError("Field 'consumerCount' is the wrong type; must be a number (but not NaN)");
  buffer.writeUInt32BE(val, offset);
  offset += 4;
  buffer[offset] = 206;
  buffer.writeUInt32BE(offset - 7, 3);
  return buffer;
}

function decodeQueueBind(buffer) {
  var val, len, offset = 0, fields = {
    ticket: void 0,
    queue: void 0,
    exchange: void 0,
    routingKey: void 0,
    nowait: void 0,
    arguments: void 0
  };
  val = buffer.readUInt16BE(offset);
  offset += 2;
  fields.ticket = val;
  len = buffer.readUInt8(offset);
  offset++;
  val = buffer.toString("utf8", offset, offset + len);
  offset += len;
  fields.queue = val;
  len = buffer.readUInt8(offset);
  offset++;
  val = buffer.toString("utf8", offset, offset + len);
  offset += len;
  fields.exchange = val;
  len = buffer.readUInt8(offset);
  offset++;
  val = buffer.toString("utf8", offset, offset + len);
  offset += len;
  fields.routingKey = val;
  val = !!(1 & buffer[offset]);
  fields.nowait = val;
  offset++;
  len = buffer.readUInt32BE(offset);
  offset += 4;
  val = decodeFields(buffer.slice(offset, offset + len));
  offset += len;
  fields.arguments = val;
  return fields;
}

function encodeQueueBind(channel, fields) {
  var len, offset = 0, val = null, bits = 0, varyingSize = 0, scratchOffset = 0;
  val = fields.queue;
  if (void 0 === val) val = ""; else if (!("string" == typeof val && Buffer.byteLength(val) < 256)) throw new TypeError("Field 'queue' is the wrong type; must be a string (up to 255 chars)");
  var queue_len = Buffer.byteLength(val, "utf8");
  varyingSize += queue_len;
  val = fields.exchange;
  if (void 0 === val) throw new Error("Missing value for mandatory field 'exchange'");
  if (!("string" == typeof val && Buffer.byteLength(val) < 256)) throw new TypeError("Field 'exchange' is the wrong type; must be a string (up to 255 chars)");
  var exchange_len = Buffer.byteLength(val, "utf8");
  varyingSize += exchange_len;
  val = fields.routingKey;
  if (void 0 === val) val = ""; else if (!("string" == typeof val && Buffer.byteLength(val) < 256)) throw new TypeError("Field 'routingKey' is the wrong type; must be a string (up to 255 chars)");
  var routingKey_len = Buffer.byteLength(val, "utf8");
  varyingSize += routingKey_len;
  val = fields.arguments;
  if (void 0 === val) val = {}; else if ("object" != typeof val) throw new TypeError("Field 'arguments' is the wrong type; must be an object");
  len = encodeTable(SCRATCH, val, scratchOffset);
  var arguments_encoded = SCRATCH.slice(scratchOffset, scratchOffset + len);
  scratchOffset += len;
  varyingSize += arguments_encoded.length;
  var buffer = new Buffer(18 + varyingSize);
  buffer[0] = 1;
  buffer.writeUInt16BE(channel, 1);
  buffer.writeUInt32BE(3276820, 7);
  offset = 11;
  val = fields.ticket;
  if (void 0 === val) val = 0; else if ("number" != typeof val || isNaN(val)) throw new TypeError("Field 'ticket' is the wrong type; must be a number (but not NaN)");
  buffer.writeUInt16BE(val, offset);
  offset += 2;
  val = fields.queue;
  void 0 === val && (val = "");
  buffer[offset] = queue_len;
  offset++;
  buffer.write(val, offset, "utf8");
  offset += queue_len;
  val = fields.exchange;
  void 0 === val && (val = void 0);
  buffer[offset] = exchange_len;
  offset++;
  buffer.write(val, offset, "utf8");
  offset += exchange_len;
  val = fields.routingKey;
  void 0 === val && (val = "");
  buffer[offset] = routingKey_len;
  offset++;
  buffer.write(val, offset, "utf8");
  offset += routingKey_len;
  val = fields.nowait;
  void 0 === val && (val = !1);
  val && (bits += 1);
  buffer[offset] = bits;
  offset++;
  bits = 0;
  offset += arguments_encoded.copy(buffer, offset);
  buffer[offset] = 206;
  buffer.writeUInt32BE(offset - 7, 3);
  return buffer;
}

function decodeQueueBindOk(buffer) {
  var fields = {};
  return fields;
}

function encodeQueueBindOk(channel, fields) {
  var offset = 0, varyingSize = 0, buffer = new Buffer(12 + varyingSize);
  buffer[0] = 1;
  buffer.writeUInt16BE(channel, 1);
  buffer.writeUInt32BE(3276821, 7);
  offset = 11;
  buffer[offset] = 206;
  buffer.writeUInt32BE(offset - 7, 3);
  return buffer;
}

function decodeQueuePurge(buffer) {
  var val, len, offset = 0, fields = {
    ticket: void 0,
    queue: void 0,
    nowait: void 0
  };
  val = buffer.readUInt16BE(offset);
  offset += 2;
  fields.ticket = val;
  len = buffer.readUInt8(offset);
  offset++;
  val = buffer.toString("utf8", offset, offset + len);
  offset += len;
  fields.queue = val;
  val = !!(1 & buffer[offset]);
  fields.nowait = val;
  return fields;
}

function encodeQueuePurge(channel, fields) {
  var offset = 0, val = null, bits = 0, varyingSize = 0;
  val = fields.queue;
  if (void 0 === val) val = ""; else if (!("string" == typeof val && Buffer.byteLength(val) < 256)) throw new TypeError("Field 'queue' is the wrong type; must be a string (up to 255 chars)");
  var queue_len = Buffer.byteLength(val, "utf8");
  varyingSize += queue_len;
  var buffer = new Buffer(16 + varyingSize);
  buffer[0] = 1;
  buffer.writeUInt16BE(channel, 1);
  buffer.writeUInt32BE(3276830, 7);
  offset = 11;
  val = fields.ticket;
  if (void 0 === val) val = 0; else if ("number" != typeof val || isNaN(val)) throw new TypeError("Field 'ticket' is the wrong type; must be a number (but not NaN)");
  buffer.writeUInt16BE(val, offset);
  offset += 2;
  val = fields.queue;
  void 0 === val && (val = "");
  buffer[offset] = queue_len;
  offset++;
  buffer.write(val, offset, "utf8");
  offset += queue_len;
  val = fields.nowait;
  void 0 === val && (val = !1);
  val && (bits += 1);
  buffer[offset] = bits;
  offset++;
  buffer[offset] = 206;
  buffer.writeUInt32BE(offset - 7, 3);
  return buffer;
}

function decodeQueuePurgeOk(buffer) {
  var val, offset = 0, fields = {
    messageCount: void 0
  };
  val = buffer.readUInt32BE(offset);
  offset += 4;
  fields.messageCount = val;
  return fields;
}

function encodeQueuePurgeOk(channel, fields) {
  var offset = 0, val = null, varyingSize = 0, buffer = new Buffer(16 + varyingSize);
  buffer[0] = 1;
  buffer.writeUInt16BE(channel, 1);
  buffer.writeUInt32BE(3276831, 7);
  offset = 11;
  val = fields.messageCount;
  if (void 0 === val) throw new Error("Missing value for mandatory field 'messageCount'");
  if ("number" != typeof val || isNaN(val)) throw new TypeError("Field 'messageCount' is the wrong type; must be a number (but not NaN)");
  buffer.writeUInt32BE(val, offset);
  offset += 4;
  buffer[offset] = 206;
  buffer.writeUInt32BE(offset - 7, 3);
  return buffer;
}

function decodeQueueDelete(buffer) {
  var val, len, offset = 0, fields = {
    ticket: void 0,
    queue: void 0,
    ifUnused: void 0,
    ifEmpty: void 0,
    nowait: void 0
  };
  val = buffer.readUInt16BE(offset);
  offset += 2;
  fields.ticket = val;
  len = buffer.readUInt8(offset);
  offset++;
  val = buffer.toString("utf8", offset, offset + len);
  offset += len;
  fields.queue = val;
  val = !!(1 & buffer[offset]);
  fields.ifUnused = val;
  val = !!(2 & buffer[offset]);
  fields.ifEmpty = val;
  val = !!(4 & buffer[offset]);
  fields.nowait = val;
  return fields;
}

function encodeQueueDelete(channel, fields) {
  var offset = 0, val = null, bits = 0, varyingSize = 0;
  val = fields.queue;
  if (void 0 === val) val = ""; else if (!("string" == typeof val && Buffer.byteLength(val) < 256)) throw new TypeError("Field 'queue' is the wrong type; must be a string (up to 255 chars)");
  var queue_len = Buffer.byteLength(val, "utf8");
  varyingSize += queue_len;
  var buffer = new Buffer(16 + varyingSize);
  buffer[0] = 1;
  buffer.writeUInt16BE(channel, 1);
  buffer.writeUInt32BE(3276840, 7);
  offset = 11;
  val = fields.ticket;
  if (void 0 === val) val = 0; else if ("number" != typeof val || isNaN(val)) throw new TypeError("Field 'ticket' is the wrong type; must be a number (but not NaN)");
  buffer.writeUInt16BE(val, offset);
  offset += 2;
  val = fields.queue;
  void 0 === val && (val = "");
  buffer[offset] = queue_len;
  offset++;
  buffer.write(val, offset, "utf8");
  offset += queue_len;
  val = fields.ifUnused;
  void 0 === val && (val = !1);
  val && (bits += 1);
  val = fields.ifEmpty;
  void 0 === val && (val = !1);
  val && (bits += 2);
  val = fields.nowait;
  void 0 === val && (val = !1);
  val && (bits += 4);
  buffer[offset] = bits;
  offset++;
  buffer[offset] = 206;
  buffer.writeUInt32BE(offset - 7, 3);
  return buffer;
}

function decodeQueueDeleteOk(buffer) {
  var val, offset = 0, fields = {
    messageCount: void 0
  };
  val = buffer.readUInt32BE(offset);
  offset += 4;
  fields.messageCount = val;
  return fields;
}

function encodeQueueDeleteOk(channel, fields) {
  var offset = 0, val = null, varyingSize = 0, buffer = new Buffer(16 + varyingSize);
  buffer[0] = 1;
  buffer.writeUInt16BE(channel, 1);
  buffer.writeUInt32BE(3276841, 7);
  offset = 11;
  val = fields.messageCount;
  if (void 0 === val) throw new Error("Missing value for mandatory field 'messageCount'");
  if ("number" != typeof val || isNaN(val)) throw new TypeError("Field 'messageCount' is the wrong type; must be a number (but not NaN)");
  buffer.writeUInt32BE(val, offset);
  offset += 4;
  buffer[offset] = 206;
  buffer.writeUInt32BE(offset - 7, 3);
  return buffer;
}

function decodeQueueUnbind(buffer) {
  var val, len, offset = 0, fields = {
    ticket: void 0,
    queue: void 0,
    exchange: void 0,
    routingKey: void 0,
    arguments: void 0
  };
  val = buffer.readUInt16BE(offset);
  offset += 2;
  fields.ticket = val;
  len = buffer.readUInt8(offset);
  offset++;
  val = buffer.toString("utf8", offset, offset + len);
  offset += len;
  fields.queue = val;
  len = buffer.readUInt8(offset);
  offset++;
  val = buffer.toString("utf8", offset, offset + len);
  offset += len;
  fields.exchange = val;
  len = buffer.readUInt8(offset);
  offset++;
  val = buffer.toString("utf8", offset, offset + len);
  offset += len;
  fields.routingKey = val;
  len = buffer.readUInt32BE(offset);
  offset += 4;
  val = decodeFields(buffer.slice(offset, offset + len));
  offset += len;
  fields.arguments = val;
  return fields;
}

function encodeQueueUnbind(channel, fields) {
  var len, offset = 0, val = null, varyingSize = 0, scratchOffset = 0;
  val = fields.queue;
  if (void 0 === val) val = ""; else if (!("string" == typeof val && Buffer.byteLength(val) < 256)) throw new TypeError("Field 'queue' is the wrong type; must be a string (up to 255 chars)");
  var queue_len = Buffer.byteLength(val, "utf8");
  varyingSize += queue_len;
  val = fields.exchange;
  if (void 0 === val) throw new Error("Missing value for mandatory field 'exchange'");
  if (!("string" == typeof val && Buffer.byteLength(val) < 256)) throw new TypeError("Field 'exchange' is the wrong type; must be a string (up to 255 chars)");
  var exchange_len = Buffer.byteLength(val, "utf8");
  varyingSize += exchange_len;
  val = fields.routingKey;
  if (void 0 === val) val = ""; else if (!("string" == typeof val && Buffer.byteLength(val) < 256)) throw new TypeError("Field 'routingKey' is the wrong type; must be a string (up to 255 chars)");
  var routingKey_len = Buffer.byteLength(val, "utf8");
  varyingSize += routingKey_len;
  val = fields.arguments;
  if (void 0 === val) val = {}; else if ("object" != typeof val) throw new TypeError("Field 'arguments' is the wrong type; must be an object");
  len = encodeTable(SCRATCH, val, scratchOffset);
  var arguments_encoded = SCRATCH.slice(scratchOffset, scratchOffset + len);
  scratchOffset += len;
  varyingSize += arguments_encoded.length;
  var buffer = new Buffer(17 + varyingSize);
  buffer[0] = 1;
  buffer.writeUInt16BE(channel, 1);
  buffer.writeUInt32BE(3276850, 7);
  offset = 11;
  val = fields.ticket;
  if (void 0 === val) val = 0; else if ("number" != typeof val || isNaN(val)) throw new TypeError("Field 'ticket' is the wrong type; must be a number (but not NaN)");
  buffer.writeUInt16BE(val, offset);
  offset += 2;
  val = fields.queue;
  void 0 === val && (val = "");
  buffer[offset] = queue_len;
  offset++;
  buffer.write(val, offset, "utf8");
  offset += queue_len;
  val = fields.exchange;
  void 0 === val && (val = void 0);
  buffer[offset] = exchange_len;
  offset++;
  buffer.write(val, offset, "utf8");
  offset += exchange_len;
  val = fields.routingKey;
  void 0 === val && (val = "");
  buffer[offset] = routingKey_len;
  offset++;
  buffer.write(val, offset, "utf8");
  offset += routingKey_len;
  offset += arguments_encoded.copy(buffer, offset);
  buffer[offset] = 206;
  buffer.writeUInt32BE(offset - 7, 3);
  return buffer;
}

function decodeQueueUnbindOk(buffer) {
  var fields = {};
  return fields;
}

function encodeQueueUnbindOk(channel, fields) {
  var offset = 0, varyingSize = 0, buffer = new Buffer(12 + varyingSize);
  buffer[0] = 1;
  buffer.writeUInt16BE(channel, 1);
  buffer.writeUInt32BE(3276851, 7);
  offset = 11;
  buffer[offset] = 206;
  buffer.writeUInt32BE(offset - 7, 3);
  return buffer;
}

function decodeBasicQos(buffer) {
  var val, offset = 0, fields = {
    prefetchSize: void 0,
    prefetchCount: void 0,
    global: void 0
  };
  val = buffer.readUInt32BE(offset);
  offset += 4;
  fields.prefetchSize = val;
  val = buffer.readUInt16BE(offset);
  offset += 2;
  fields.prefetchCount = val;
  val = !!(1 & buffer[offset]);
  fields.global = val;
  return fields;
}

function encodeBasicQos(channel, fields) {
  var offset = 0, val = null, bits = 0, varyingSize = 0, buffer = new Buffer(19 + varyingSize);
  buffer[0] = 1;
  buffer.writeUInt16BE(channel, 1);
  buffer.writeUInt32BE(3932170, 7);
  offset = 11;
  val = fields.prefetchSize;
  if (void 0 === val) val = 0; else if ("number" != typeof val || isNaN(val)) throw new TypeError("Field 'prefetchSize' is the wrong type; must be a number (but not NaN)");
  buffer.writeUInt32BE(val, offset);
  offset += 4;
  val = fields.prefetchCount;
  if (void 0 === val) val = 0; else if ("number" != typeof val || isNaN(val)) throw new TypeError("Field 'prefetchCount' is the wrong type; must be a number (but not NaN)");
  buffer.writeUInt16BE(val, offset);
  offset += 2;
  val = fields.global;
  void 0 === val && (val = !1);
  val && (bits += 1);
  buffer[offset] = bits;
  offset++;
  buffer[offset] = 206;
  buffer.writeUInt32BE(offset - 7, 3);
  return buffer;
}

function decodeBasicQosOk(buffer) {
  var fields = {};
  return fields;
}

function encodeBasicQosOk(channel, fields) {
  var offset = 0, varyingSize = 0, buffer = new Buffer(12 + varyingSize);
  buffer[0] = 1;
  buffer.writeUInt16BE(channel, 1);
  buffer.writeUInt32BE(3932171, 7);
  offset = 11;
  buffer[offset] = 206;
  buffer.writeUInt32BE(offset - 7, 3);
  return buffer;
}

function decodeBasicConsume(buffer) {
  var val, len, offset = 0, fields = {
    ticket: void 0,
    queue: void 0,
    consumerTag: void 0,
    noLocal: void 0,
    noAck: void 0,
    exclusive: void 0,
    nowait: void 0,
    arguments: void 0
  };
  val = buffer.readUInt16BE(offset);
  offset += 2;
  fields.ticket = val;
  len = buffer.readUInt8(offset);
  offset++;
  val = buffer.toString("utf8", offset, offset + len);
  offset += len;
  fields.queue = val;
  len = buffer.readUInt8(offset);
  offset++;
  val = buffer.toString("utf8", offset, offset + len);
  offset += len;
  fields.consumerTag = val;
  val = !!(1 & buffer[offset]);
  fields.noLocal = val;
  val = !!(2 & buffer[offset]);
  fields.noAck = val;
  val = !!(4 & buffer[offset]);
  fields.exclusive = val;
  val = !!(8 & buffer[offset]);
  fields.nowait = val;
  offset++;
  len = buffer.readUInt32BE(offset);
  offset += 4;
  val = decodeFields(buffer.slice(offset, offset + len));
  offset += len;
  fields.arguments = val;
  return fields;
}

function encodeBasicConsume(channel, fields) {
  var len, offset = 0, val = null, bits = 0, varyingSize = 0, scratchOffset = 0;
  val = fields.queue;
  if (void 0 === val) val = ""; else if (!("string" == typeof val && Buffer.byteLength(val) < 256)) throw new TypeError("Field 'queue' is the wrong type; must be a string (up to 255 chars)");
  var queue_len = Buffer.byteLength(val, "utf8");
  varyingSize += queue_len;
  val = fields.consumerTag;
  if (void 0 === val) val = ""; else if (!("string" == typeof val && Buffer.byteLength(val) < 256)) throw new TypeError("Field 'consumerTag' is the wrong type; must be a string (up to 255 chars)");
  var consumerTag_len = Buffer.byteLength(val, "utf8");
  varyingSize += consumerTag_len;
  val = fields.arguments;
  if (void 0 === val) val = {}; else if ("object" != typeof val) throw new TypeError("Field 'arguments' is the wrong type; must be an object");
  len = encodeTable(SCRATCH, val, scratchOffset);
  var arguments_encoded = SCRATCH.slice(scratchOffset, scratchOffset + len);
  scratchOffset += len;
  varyingSize += arguments_encoded.length;
  var buffer = new Buffer(17 + varyingSize);
  buffer[0] = 1;
  buffer.writeUInt16BE(channel, 1);
  buffer.writeUInt32BE(3932180, 7);
  offset = 11;
  val = fields.ticket;
  if (void 0 === val) val = 0; else if ("number" != typeof val || isNaN(val)) throw new TypeError("Field 'ticket' is the wrong type; must be a number (but not NaN)");
  buffer.writeUInt16BE(val, offset);
  offset += 2;
  val = fields.queue;
  void 0 === val && (val = "");
  buffer[offset] = queue_len;
  offset++;
  buffer.write(val, offset, "utf8");
  offset += queue_len;
  val = fields.consumerTag;
  void 0 === val && (val = "");
  buffer[offset] = consumerTag_len;
  offset++;
  buffer.write(val, offset, "utf8");
  offset += consumerTag_len;
  val = fields.noLocal;
  void 0 === val && (val = !1);
  val && (bits += 1);
  val = fields.noAck;
  void 0 === val && (val = !1);
  val && (bits += 2);
  val = fields.exclusive;
  void 0 === val && (val = !1);
  val && (bits += 4);
  val = fields.nowait;
  void 0 === val && (val = !1);
  val && (bits += 8);
  buffer[offset] = bits;
  offset++;
  bits = 0;
  offset += arguments_encoded.copy(buffer, offset);
  buffer[offset] = 206;
  buffer.writeUInt32BE(offset - 7, 3);
  return buffer;
}

function decodeBasicConsumeOk(buffer) {
  var val, len, offset = 0, fields = {
    consumerTag: void 0
  };
  len = buffer.readUInt8(offset);
  offset++;
  val = buffer.toString("utf8", offset, offset + len);
  offset += len;
  fields.consumerTag = val;
  return fields;
}

function encodeBasicConsumeOk(channel, fields) {
  var offset = 0, val = null, varyingSize = 0;
  val = fields.consumerTag;
  if (void 0 === val) throw new Error("Missing value for mandatory field 'consumerTag'");
  if (!("string" == typeof val && Buffer.byteLength(val) < 256)) throw new TypeError("Field 'consumerTag' is the wrong type; must be a string (up to 255 chars)");
  var consumerTag_len = Buffer.byteLength(val, "utf8");
  varyingSize += consumerTag_len;
  var buffer = new Buffer(13 + varyingSize);
  buffer[0] = 1;
  buffer.writeUInt16BE(channel, 1);
  buffer.writeUInt32BE(3932181, 7);
  offset = 11;
  val = fields.consumerTag;
  void 0 === val && (val = void 0);
  buffer[offset] = consumerTag_len;
  offset++;
  buffer.write(val, offset, "utf8");
  offset += consumerTag_len;
  buffer[offset] = 206;
  buffer.writeUInt32BE(offset - 7, 3);
  return buffer;
}

function decodeBasicCancel(buffer) {
  var val, len, offset = 0, fields = {
    consumerTag: void 0,
    nowait: void 0
  };
  len = buffer.readUInt8(offset);
  offset++;
  val = buffer.toString("utf8", offset, offset + len);
  offset += len;
  fields.consumerTag = val;
  val = !!(1 & buffer[offset]);
  fields.nowait = val;
  return fields;
}

function encodeBasicCancel(channel, fields) {
  var offset = 0, val = null, bits = 0, varyingSize = 0;
  val = fields.consumerTag;
  if (void 0 === val) throw new Error("Missing value for mandatory field 'consumerTag'");
  if (!("string" == typeof val && Buffer.byteLength(val) < 256)) throw new TypeError("Field 'consumerTag' is the wrong type; must be a string (up to 255 chars)");
  var consumerTag_len = Buffer.byteLength(val, "utf8");
  varyingSize += consumerTag_len;
  var buffer = new Buffer(14 + varyingSize);
  buffer[0] = 1;
  buffer.writeUInt16BE(channel, 1);
  buffer.writeUInt32BE(3932190, 7);
  offset = 11;
  val = fields.consumerTag;
  void 0 === val && (val = void 0);
  buffer[offset] = consumerTag_len;
  offset++;
  buffer.write(val, offset, "utf8");
  offset += consumerTag_len;
  val = fields.nowait;
  void 0 === val && (val = !1);
  val && (bits += 1);
  buffer[offset] = bits;
  offset++;
  buffer[offset] = 206;
  buffer.writeUInt32BE(offset - 7, 3);
  return buffer;
}

function decodeBasicCancelOk(buffer) {
  var val, len, offset = 0, fields = {
    consumerTag: void 0
  };
  len = buffer.readUInt8(offset);
  offset++;
  val = buffer.toString("utf8", offset, offset + len);
  offset += len;
  fields.consumerTag = val;
  return fields;
}

function encodeBasicCancelOk(channel, fields) {
  var offset = 0, val = null, varyingSize = 0;
  val = fields.consumerTag;
  if (void 0 === val) throw new Error("Missing value for mandatory field 'consumerTag'");
  if (!("string" == typeof val && Buffer.byteLength(val) < 256)) throw new TypeError("Field 'consumerTag' is the wrong type; must be a string (up to 255 chars)");
  var consumerTag_len = Buffer.byteLength(val, "utf8");
  varyingSize += consumerTag_len;
  var buffer = new Buffer(13 + varyingSize);
  buffer[0] = 1;
  buffer.writeUInt16BE(channel, 1);
  buffer.writeUInt32BE(3932191, 7);
  offset = 11;
  val = fields.consumerTag;
  void 0 === val && (val = void 0);
  buffer[offset] = consumerTag_len;
  offset++;
  buffer.write(val, offset, "utf8");
  offset += consumerTag_len;
  buffer[offset] = 206;
  buffer.writeUInt32BE(offset - 7, 3);
  return buffer;
}

function decodeBasicPublish(buffer) {
  var val, len, offset = 0, fields = {
    ticket: void 0,
    exchange: void 0,
    routingKey: void 0,
    mandatory: void 0,
    immediate: void 0
  };
  val = buffer.readUInt16BE(offset);
  offset += 2;
  fields.ticket = val;
  len = buffer.readUInt8(offset);
  offset++;
  val = buffer.toString("utf8", offset, offset + len);
  offset += len;
  fields.exchange = val;
  len = buffer.readUInt8(offset);
  offset++;
  val = buffer.toString("utf8", offset, offset + len);
  offset += len;
  fields.routingKey = val;
  val = !!(1 & buffer[offset]);
  fields.mandatory = val;
  val = !!(2 & buffer[offset]);
  fields.immediate = val;
  return fields;
}

function encodeBasicPublish(channel, fields) {
  var offset = 0, val = null, bits = 0, varyingSize = 0;
  val = fields.exchange;
  if (void 0 === val) val = ""; else if (!("string" == typeof val && Buffer.byteLength(val) < 256)) throw new TypeError("Field 'exchange' is the wrong type; must be a string (up to 255 chars)");
  var exchange_len = Buffer.byteLength(val, "utf8");
  varyingSize += exchange_len;
  val = fields.routingKey;
  if (void 0 === val) val = ""; else if (!("string" == typeof val && Buffer.byteLength(val) < 256)) throw new TypeError("Field 'routingKey' is the wrong type; must be a string (up to 255 chars)");
  var routingKey_len = Buffer.byteLength(val, "utf8");
  varyingSize += routingKey_len;
  var buffer = new Buffer(17 + varyingSize);
  buffer[0] = 1;
  buffer.writeUInt16BE(channel, 1);
  buffer.writeUInt32BE(3932200, 7);
  offset = 11;
  val = fields.ticket;
  if (void 0 === val) val = 0; else if ("number" != typeof val || isNaN(val)) throw new TypeError("Field 'ticket' is the wrong type; must be a number (but not NaN)");
  buffer.writeUInt16BE(val, offset);
  offset += 2;
  val = fields.exchange;
  void 0 === val && (val = "");
  buffer[offset] = exchange_len;
  offset++;
  buffer.write(val, offset, "utf8");
  offset += exchange_len;
  val = fields.routingKey;
  void 0 === val && (val = "");
  buffer[offset] = routingKey_len;
  offset++;
  buffer.write(val, offset, "utf8");
  offset += routingKey_len;
  val = fields.mandatory;
  void 0 === val && (val = !1);
  val && (bits += 1);
  val = fields.immediate;
  void 0 === val && (val = !1);
  val && (bits += 2);
  buffer[offset] = bits;
  offset++;
  buffer[offset] = 206;
  buffer.writeUInt32BE(offset - 7, 3);
  return buffer;
}

function decodeBasicReturn(buffer) {
  var val, len, offset = 0, fields = {
    replyCode: void 0,
    replyText: void 0,
    exchange: void 0,
    routingKey: void 0
  };
  val = buffer.readUInt16BE(offset);
  offset += 2;
  fields.replyCode = val;
  len = buffer.readUInt8(offset);
  offset++;
  val = buffer.toString("utf8", offset, offset + len);
  offset += len;
  fields.replyText = val;
  len = buffer.readUInt8(offset);
  offset++;
  val = buffer.toString("utf8", offset, offset + len);
  offset += len;
  fields.exchange = val;
  len = buffer.readUInt8(offset);
  offset++;
  val = buffer.toString("utf8", offset, offset + len);
  offset += len;
  fields.routingKey = val;
  return fields;
}

function encodeBasicReturn(channel, fields) {
  var offset = 0, val = null, varyingSize = 0;
  val = fields.replyText;
  if (void 0 === val) val = ""; else if (!("string" == typeof val && Buffer.byteLength(val) < 256)) throw new TypeError("Field 'replyText' is the wrong type; must be a string (up to 255 chars)");
  var replyText_len = Buffer.byteLength(val, "utf8");
  varyingSize += replyText_len;
  val = fields.exchange;
  if (void 0 === val) throw new Error("Missing value for mandatory field 'exchange'");
  if (!("string" == typeof val && Buffer.byteLength(val) < 256)) throw new TypeError("Field 'exchange' is the wrong type; must be a string (up to 255 chars)");
  var exchange_len = Buffer.byteLength(val, "utf8");
  varyingSize += exchange_len;
  val = fields.routingKey;
  if (void 0 === val) throw new Error("Missing value for mandatory field 'routingKey'");
  if (!("string" == typeof val && Buffer.byteLength(val) < 256)) throw new TypeError("Field 'routingKey' is the wrong type; must be a string (up to 255 chars)");
  var routingKey_len = Buffer.byteLength(val, "utf8");
  varyingSize += routingKey_len;
  var buffer = new Buffer(17 + varyingSize);
  buffer[0] = 1;
  buffer.writeUInt16BE(channel, 1);
  buffer.writeUInt32BE(3932210, 7);
  offset = 11;
  val = fields.replyCode;
  if (void 0 === val) throw new Error("Missing value for mandatory field 'replyCode'");
  if ("number" != typeof val || isNaN(val)) throw new TypeError("Field 'replyCode' is the wrong type; must be a number (but not NaN)");
  buffer.writeUInt16BE(val, offset);
  offset += 2;
  val = fields.replyText;
  void 0 === val && (val = "");
  buffer[offset] = replyText_len;
  offset++;
  buffer.write(val, offset, "utf8");
  offset += replyText_len;
  val = fields.exchange;
  void 0 === val && (val = void 0);
  buffer[offset] = exchange_len;
  offset++;
  buffer.write(val, offset, "utf8");
  offset += exchange_len;
  val = fields.routingKey;
  void 0 === val && (val = void 0);
  buffer[offset] = routingKey_len;
  offset++;
  buffer.write(val, offset, "utf8");
  offset += routingKey_len;
  buffer[offset] = 206;
  buffer.writeUInt32BE(offset - 7, 3);
  return buffer;
}

function decodeBasicDeliver(buffer) {
  var val, len, offset = 0, fields = {
    consumerTag: void 0,
    deliveryTag: void 0,
    redelivered: void 0,
    exchange: void 0,
    routingKey: void 0
  };
  len = buffer.readUInt8(offset);
  offset++;
  val = buffer.toString("utf8", offset, offset + len);
  offset += len;
  fields.consumerTag = val;
  val = ints.readUInt64BE(buffer, offset);
  offset += 8;
  fields.deliveryTag = val;
  val = !!(1 & buffer[offset]);
  fields.redelivered = val;
  offset++;
  len = buffer.readUInt8(offset);
  offset++;
  val = buffer.toString("utf8", offset, offset + len);
  offset += len;
  fields.exchange = val;
  len = buffer.readUInt8(offset);
  offset++;
  val = buffer.toString("utf8", offset, offset + len);
  offset += len;
  fields.routingKey = val;
  return fields;
}

function encodeBasicDeliver(channel, fields) {
  var offset = 0, val = null, bits = 0, varyingSize = 0;
  val = fields.consumerTag;
  if (void 0 === val) throw new Error("Missing value for mandatory field 'consumerTag'");
  if (!("string" == typeof val && Buffer.byteLength(val) < 256)) throw new TypeError("Field 'consumerTag' is the wrong type; must be a string (up to 255 chars)");
  var consumerTag_len = Buffer.byteLength(val, "utf8");
  varyingSize += consumerTag_len;
  val = fields.exchange;
  if (void 0 === val) throw new Error("Missing value for mandatory field 'exchange'");
  if (!("string" == typeof val && Buffer.byteLength(val) < 256)) throw new TypeError("Field 'exchange' is the wrong type; must be a string (up to 255 chars)");
  var exchange_len = Buffer.byteLength(val, "utf8");
  varyingSize += exchange_len;
  val = fields.routingKey;
  if (void 0 === val) throw new Error("Missing value for mandatory field 'routingKey'");
  if (!("string" == typeof val && Buffer.byteLength(val) < 256)) throw new TypeError("Field 'routingKey' is the wrong type; must be a string (up to 255 chars)");
  var routingKey_len = Buffer.byteLength(val, "utf8");
  varyingSize += routingKey_len;
  var buffer = new Buffer(24 + varyingSize);
  buffer[0] = 1;
  buffer.writeUInt16BE(channel, 1);
  buffer.writeUInt32BE(3932220, 7);
  offset = 11;
  val = fields.consumerTag;
  void 0 === val && (val = void 0);
  buffer[offset] = consumerTag_len;
  offset++;
  buffer.write(val, offset, "utf8");
  offset += consumerTag_len;
  val = fields.deliveryTag;
  if (void 0 === val) throw new Error("Missing value for mandatory field 'deliveryTag'");
  if ("number" != typeof val || isNaN(val)) throw new TypeError("Field 'deliveryTag' is the wrong type; must be a number (but not NaN)");
  ints.writeUInt64BE(buffer, val, offset);
  offset += 8;
  val = fields.redelivered;
  void 0 === val && (val = !1);
  val && (bits += 1);
  buffer[offset] = bits;
  offset++;
  bits = 0;
  val = fields.exchange;
  void 0 === val && (val = void 0);
  buffer[offset] = exchange_len;
  offset++;
  buffer.write(val, offset, "utf8");
  offset += exchange_len;
  val = fields.routingKey;
  void 0 === val && (val = void 0);
  buffer[offset] = routingKey_len;
  offset++;
  buffer.write(val, offset, "utf8");
  offset += routingKey_len;
  buffer[offset] = 206;
  buffer.writeUInt32BE(offset - 7, 3);
  return buffer;
}

function decodeBasicGet(buffer) {
  var val, len, offset = 0, fields = {
    ticket: void 0,
    queue: void 0,
    noAck: void 0
  };
  val = buffer.readUInt16BE(offset);
  offset += 2;
  fields.ticket = val;
  len = buffer.readUInt8(offset);
  offset++;
  val = buffer.toString("utf8", offset, offset + len);
  offset += len;
  fields.queue = val;
  val = !!(1 & buffer[offset]);
  fields.noAck = val;
  return fields;
}

function encodeBasicGet(channel, fields) {
  var offset = 0, val = null, bits = 0, varyingSize = 0;
  val = fields.queue;
  if (void 0 === val) val = ""; else if (!("string" == typeof val && Buffer.byteLength(val) < 256)) throw new TypeError("Field 'queue' is the wrong type; must be a string (up to 255 chars)");
  var queue_len = Buffer.byteLength(val, "utf8");
  varyingSize += queue_len;
  var buffer = new Buffer(16 + varyingSize);
  buffer[0] = 1;
  buffer.writeUInt16BE(channel, 1);
  buffer.writeUInt32BE(3932230, 7);
  offset = 11;
  val = fields.ticket;
  if (void 0 === val) val = 0; else if ("number" != typeof val || isNaN(val)) throw new TypeError("Field 'ticket' is the wrong type; must be a number (but not NaN)");
  buffer.writeUInt16BE(val, offset);
  offset += 2;
  val = fields.queue;
  void 0 === val && (val = "");
  buffer[offset] = queue_len;
  offset++;
  buffer.write(val, offset, "utf8");
  offset += queue_len;
  val = fields.noAck;
  void 0 === val && (val = !1);
  val && (bits += 1);
  buffer[offset] = bits;
  offset++;
  buffer[offset] = 206;
  buffer.writeUInt32BE(offset - 7, 3);
  return buffer;
}

function decodeBasicGetOk(buffer) {
  var val, len, offset = 0, fields = {
    deliveryTag: void 0,
    redelivered: void 0,
    exchange: void 0,
    routingKey: void 0,
    messageCount: void 0
  };
  val = ints.readUInt64BE(buffer, offset);
  offset += 8;
  fields.deliveryTag = val;
  val = !!(1 & buffer[offset]);
  fields.redelivered = val;
  offset++;
  len = buffer.readUInt8(offset);
  offset++;
  val = buffer.toString("utf8", offset, offset + len);
  offset += len;
  fields.exchange = val;
  len = buffer.readUInt8(offset);
  offset++;
  val = buffer.toString("utf8", offset, offset + len);
  offset += len;
  fields.routingKey = val;
  val = buffer.readUInt32BE(offset);
  offset += 4;
  fields.messageCount = val;
  return fields;
}

function encodeBasicGetOk(channel, fields) {
  var offset = 0, val = null, bits = 0, varyingSize = 0;
  val = fields.exchange;
  if (void 0 === val) throw new Error("Missing value for mandatory field 'exchange'");
  if (!("string" == typeof val && Buffer.byteLength(val) < 256)) throw new TypeError("Field 'exchange' is the wrong type; must be a string (up to 255 chars)");
  var exchange_len = Buffer.byteLength(val, "utf8");
  varyingSize += exchange_len;
  val = fields.routingKey;
  if (void 0 === val) throw new Error("Missing value for mandatory field 'routingKey'");
  if (!("string" == typeof val && Buffer.byteLength(val) < 256)) throw new TypeError("Field 'routingKey' is the wrong type; must be a string (up to 255 chars)");
  var routingKey_len = Buffer.byteLength(val, "utf8");
  varyingSize += routingKey_len;
  var buffer = new Buffer(27 + varyingSize);
  buffer[0] = 1;
  buffer.writeUInt16BE(channel, 1);
  buffer.writeUInt32BE(3932231, 7);
  offset = 11;
  val = fields.deliveryTag;
  if (void 0 === val) throw new Error("Missing value for mandatory field 'deliveryTag'");
  if ("number" != typeof val || isNaN(val)) throw new TypeError("Field 'deliveryTag' is the wrong type; must be a number (but not NaN)");
  ints.writeUInt64BE(buffer, val, offset);
  offset += 8;
  val = fields.redelivered;
  void 0 === val && (val = !1);
  val && (bits += 1);
  buffer[offset] = bits;
  offset++;
  bits = 0;
  val = fields.exchange;
  void 0 === val && (val = void 0);
  buffer[offset] = exchange_len;
  offset++;
  buffer.write(val, offset, "utf8");
  offset += exchange_len;
  val = fields.routingKey;
  void 0 === val && (val = void 0);
  buffer[offset] = routingKey_len;
  offset++;
  buffer.write(val, offset, "utf8");
  offset += routingKey_len;
  val = fields.messageCount;
  if (void 0 === val) throw new Error("Missing value for mandatory field 'messageCount'");
  if ("number" != typeof val || isNaN(val)) throw new TypeError("Field 'messageCount' is the wrong type; must be a number (but not NaN)");
  buffer.writeUInt32BE(val, offset);
  offset += 4;
  buffer[offset] = 206;
  buffer.writeUInt32BE(offset - 7, 3);
  return buffer;
}

function decodeBasicGetEmpty(buffer) {
  var val, len, offset = 0, fields = {
    clusterId: void 0
  };
  len = buffer.readUInt8(offset);
  offset++;
  val = buffer.toString("utf8", offset, offset + len);
  offset += len;
  fields.clusterId = val;
  return fields;
}

function encodeBasicGetEmpty(channel, fields) {
  var offset = 0, val = null, varyingSize = 0;
  val = fields.clusterId;
  if (void 0 === val) val = ""; else if (!("string" == typeof val && Buffer.byteLength(val) < 256)) throw new TypeError("Field 'clusterId' is the wrong type; must be a string (up to 255 chars)");
  var clusterId_len = Buffer.byteLength(val, "utf8");
  varyingSize += clusterId_len;
  var buffer = new Buffer(13 + varyingSize);
  buffer[0] = 1;
  buffer.writeUInt16BE(channel, 1);
  buffer.writeUInt32BE(3932232, 7);
  offset = 11;
  val = fields.clusterId;
  void 0 === val && (val = "");
  buffer[offset] = clusterId_len;
  offset++;
  buffer.write(val, offset, "utf8");
  offset += clusterId_len;
  buffer[offset] = 206;
  buffer.writeUInt32BE(offset - 7, 3);
  return buffer;
}

function decodeBasicAck(buffer) {
  var val, offset = 0, fields = {
    deliveryTag: void 0,
    multiple: void 0
  };
  val = ints.readUInt64BE(buffer, offset);
  offset += 8;
  fields.deliveryTag = val;
  val = !!(1 & buffer[offset]);
  fields.multiple = val;
  return fields;
}

function encodeBasicAck(channel, fields) {
  var offset = 0, val = null, bits = 0, varyingSize = 0, buffer = new Buffer(21 + varyingSize);
  buffer[0] = 1;
  buffer.writeUInt16BE(channel, 1);
  buffer.writeUInt32BE(3932240, 7);
  offset = 11;
  val = fields.deliveryTag;
  if (void 0 === val) val = 0; else if ("number" != typeof val || isNaN(val)) throw new TypeError("Field 'deliveryTag' is the wrong type; must be a number (but not NaN)");
  ints.writeUInt64BE(buffer, val, offset);
  offset += 8;
  val = fields.multiple;
  void 0 === val && (val = !1);
  val && (bits += 1);
  buffer[offset] = bits;
  offset++;
  buffer[offset] = 206;
  buffer.writeUInt32BE(offset - 7, 3);
  return buffer;
}

function decodeBasicReject(buffer) {
  var val, offset = 0, fields = {
    deliveryTag: void 0,
    requeue: void 0
  };
  val = ints.readUInt64BE(buffer, offset);
  offset += 8;
  fields.deliveryTag = val;
  val = !!(1 & buffer[offset]);
  fields.requeue = val;
  return fields;
}

function encodeBasicReject(channel, fields) {
  var offset = 0, val = null, bits = 0, varyingSize = 0, buffer = new Buffer(21 + varyingSize);
  buffer[0] = 1;
  buffer.writeUInt16BE(channel, 1);
  buffer.writeUInt32BE(3932250, 7);
  offset = 11;
  val = fields.deliveryTag;
  if (void 0 === val) throw new Error("Missing value for mandatory field 'deliveryTag'");
  if ("number" != typeof val || isNaN(val)) throw new TypeError("Field 'deliveryTag' is the wrong type; must be a number (but not NaN)");
  ints.writeUInt64BE(buffer, val, offset);
  offset += 8;
  val = fields.requeue;
  void 0 === val && (val = !0);
  val && (bits += 1);
  buffer[offset] = bits;
  offset++;
  buffer[offset] = 206;
  buffer.writeUInt32BE(offset - 7, 3);
  return buffer;
}

function decodeBasicRecoverAsync(buffer) {
  var val, offset = 0, fields = {
    requeue: void 0
  };
  val = !!(1 & buffer[offset]);
  fields.requeue = val;
  return fields;
}

function encodeBasicRecoverAsync(channel, fields) {
  var offset = 0, val = null, bits = 0, varyingSize = 0, buffer = new Buffer(13 + varyingSize);
  buffer[0] = 1;
  buffer.writeUInt16BE(channel, 1);
  buffer.writeUInt32BE(3932260, 7);
  offset = 11;
  val = fields.requeue;
  void 0 === val && (val = !1);
  val && (bits += 1);
  buffer[offset] = bits;
  offset++;
  buffer[offset] = 206;
  buffer.writeUInt32BE(offset - 7, 3);
  return buffer;
}

function decodeBasicRecover(buffer) {
  var val, offset = 0, fields = {
    requeue: void 0
  };
  val = !!(1 & buffer[offset]);
  fields.requeue = val;
  return fields;
}

function encodeBasicRecover(channel, fields) {
  var offset = 0, val = null, bits = 0, varyingSize = 0, buffer = new Buffer(13 + varyingSize);
  buffer[0] = 1;
  buffer.writeUInt16BE(channel, 1);
  buffer.writeUInt32BE(3932270, 7);
  offset = 11;
  val = fields.requeue;
  void 0 === val && (val = !1);
  val && (bits += 1);
  buffer[offset] = bits;
  offset++;
  buffer[offset] = 206;
  buffer.writeUInt32BE(offset - 7, 3);
  return buffer;
}

function decodeBasicRecoverOk(buffer) {
  var fields = {};
  return fields;
}

function encodeBasicRecoverOk(channel, fields) {
  var offset = 0, varyingSize = 0, buffer = new Buffer(12 + varyingSize);
  buffer[0] = 1;
  buffer.writeUInt16BE(channel, 1);
  buffer.writeUInt32BE(3932271, 7);
  offset = 11;
  buffer[offset] = 206;
  buffer.writeUInt32BE(offset - 7, 3);
  return buffer;
}

function decodeBasicNack(buffer) {
  var val, offset = 0, fields = {
    deliveryTag: void 0,
    multiple: void 0,
    requeue: void 0
  };
  val = ints.readUInt64BE(buffer, offset);
  offset += 8;
  fields.deliveryTag = val;
  val = !!(1 & buffer[offset]);
  fields.multiple = val;
  val = !!(2 & buffer[offset]);
  fields.requeue = val;
  return fields;
}

function encodeBasicNack(channel, fields) {
  var offset = 0, val = null, bits = 0, varyingSize = 0, buffer = new Buffer(21 + varyingSize);
  buffer[0] = 1;
  buffer.writeUInt16BE(channel, 1);
  buffer.writeUInt32BE(3932280, 7);
  offset = 11;
  val = fields.deliveryTag;
  if (void 0 === val) val = 0; else if ("number" != typeof val || isNaN(val)) throw new TypeError("Field 'deliveryTag' is the wrong type; must be a number (but not NaN)");
  ints.writeUInt64BE(buffer, val, offset);
  offset += 8;
  val = fields.multiple;
  void 0 === val && (val = !1);
  val && (bits += 1);
  val = fields.requeue;
  void 0 === val && (val = !0);
  val && (bits += 2);
  buffer[offset] = bits;
  offset++;
  buffer[offset] = 206;
  buffer.writeUInt32BE(offset - 7, 3);
  return buffer;
}

function decodeTxSelect(buffer) {
  var fields = {};
  return fields;
}

function encodeTxSelect(channel, fields) {
  var offset = 0, varyingSize = 0, buffer = new Buffer(12 + varyingSize);
  buffer[0] = 1;
  buffer.writeUInt16BE(channel, 1);
  buffer.writeUInt32BE(5898250, 7);
  offset = 11;
  buffer[offset] = 206;
  buffer.writeUInt32BE(offset - 7, 3);
  return buffer;
}

function decodeTxSelectOk(buffer) {
  var fields = {};
  return fields;
}

function encodeTxSelectOk(channel, fields) {
  var offset = 0, varyingSize = 0, buffer = new Buffer(12 + varyingSize);
  buffer[0] = 1;
  buffer.writeUInt16BE(channel, 1);
  buffer.writeUInt32BE(5898251, 7);
  offset = 11;
  buffer[offset] = 206;
  buffer.writeUInt32BE(offset - 7, 3);
  return buffer;
}

function decodeTxCommit(buffer) {
  var fields = {};
  return fields;
}

function encodeTxCommit(channel, fields) {
  var offset = 0, varyingSize = 0, buffer = new Buffer(12 + varyingSize);
  buffer[0] = 1;
  buffer.writeUInt16BE(channel, 1);
  buffer.writeUInt32BE(5898260, 7);
  offset = 11;
  buffer[offset] = 206;
  buffer.writeUInt32BE(offset - 7, 3);
  return buffer;
}

function decodeTxCommitOk(buffer) {
  var fields = {};
  return fields;
}

function encodeTxCommitOk(channel, fields) {
  var offset = 0, varyingSize = 0, buffer = new Buffer(12 + varyingSize);
  buffer[0] = 1;
  buffer.writeUInt16BE(channel, 1);
  buffer.writeUInt32BE(5898261, 7);
  offset = 11;
  buffer[offset] = 206;
  buffer.writeUInt32BE(offset - 7, 3);
  return buffer;
}

function decodeTxRollback(buffer) {
  var fields = {};
  return fields;
}

function encodeTxRollback(channel, fields) {
  var offset = 0, varyingSize = 0, buffer = new Buffer(12 + varyingSize);
  buffer[0] = 1;
  buffer.writeUInt16BE(channel, 1);
  buffer.writeUInt32BE(5898270, 7);
  offset = 11;
  buffer[offset] = 206;
  buffer.writeUInt32BE(offset - 7, 3);
  return buffer;
}

function decodeTxRollbackOk(buffer) {
  var fields = {};
  return fields;
}

function encodeTxRollbackOk(channel, fields) {
  var offset = 0, varyingSize = 0, buffer = new Buffer(12 + varyingSize);
  buffer[0] = 1;
  buffer.writeUInt16BE(channel, 1);
  buffer.writeUInt32BE(5898271, 7);
  offset = 11;
  buffer[offset] = 206;
  buffer.writeUInt32BE(offset - 7, 3);
  return buffer;
}

function decodeConfirmSelect(buffer) {
  var val, offset = 0, fields = {
    nowait: void 0
  };
  val = !!(1 & buffer[offset]);
  fields.nowait = val;
  return fields;
}

function encodeConfirmSelect(channel, fields) {
  var offset = 0, val = null, bits = 0, varyingSize = 0, buffer = new Buffer(13 + varyingSize);
  buffer[0] = 1;
  buffer.writeUInt16BE(channel, 1);
  buffer.writeUInt32BE(5570570, 7);
  offset = 11;
  val = fields.nowait;
  void 0 === val && (val = !1);
  val && (bits += 1);
  buffer[offset] = bits;
  offset++;
  buffer[offset] = 206;
  buffer.writeUInt32BE(offset - 7, 3);
  return buffer;
}

function decodeConfirmSelectOk(buffer) {
  var fields = {};
  return fields;
}

function encodeConfirmSelectOk(channel, fields) {
  var offset = 0, varyingSize = 0, buffer = new Buffer(12 + varyingSize);
  buffer[0] = 1;
  buffer.writeUInt16BE(channel, 1);
  buffer.writeUInt32BE(5570571, 7);
  offset = 11;
  buffer[offset] = 206;
  buffer.writeUInt32BE(offset - 7, 3);
  return buffer;
}

function encodeBasicProperties(channel, size, fields) {
  var val, len, offset = 0, flags = 0, scratchOffset = 0, varyingSize = 0;
  val = fields.contentType;
  if (void 0 != val) {
    if (!("string" == typeof val && Buffer.byteLength(val) < 256)) throw new TypeError("Field 'contentType' is the wrong type; must be a string (up to 255 chars)");
    var contentType_len = Buffer.byteLength(val, "utf8");
    varyingSize += 1;
    varyingSize += contentType_len;
  }
  val = fields.contentEncoding;
  if (void 0 != val) {
    if (!("string" == typeof val && Buffer.byteLength(val) < 256)) throw new TypeError("Field 'contentEncoding' is the wrong type; must be a string (up to 255 chars)");
    var contentEncoding_len = Buffer.byteLength(val, "utf8");
    varyingSize += 1;
    varyingSize += contentEncoding_len;
  }
  val = fields.headers;
  if (void 0 != val) {
    if ("object" != typeof val) throw new TypeError("Field 'headers' is the wrong type; must be an object");
    len = encodeTable(SCRATCH, val, scratchOffset);
    var headers_encoded = SCRATCH.slice(scratchOffset, scratchOffset + len);
    scratchOffset += len;
    varyingSize += headers_encoded.length;
  }
  val = fields.deliveryMode;
  if (void 0 != val) {
    if ("number" != typeof val || isNaN(val)) throw new TypeError("Field 'deliveryMode' is the wrong type; must be a number (but not NaN)");
    varyingSize += 1;
  }
  val = fields.priority;
  if (void 0 != val) {
    if ("number" != typeof val || isNaN(val)) throw new TypeError("Field 'priority' is the wrong type; must be a number (but not NaN)");
    varyingSize += 1;
  }
  val = fields.correlationId;
  if (void 0 != val) {
    if (!("string" == typeof val && Buffer.byteLength(val) < 256)) throw new TypeError("Field 'correlationId' is the wrong type; must be a string (up to 255 chars)");
    var correlationId_len = Buffer.byteLength(val, "utf8");
    varyingSize += 1;
    varyingSize += correlationId_len;
  }
  val = fields.replyTo;
  if (void 0 != val) {
    if (!("string" == typeof val && Buffer.byteLength(val) < 256)) throw new TypeError("Field 'replyTo' is the wrong type; must be a string (up to 255 chars)");
    var replyTo_len = Buffer.byteLength(val, "utf8");
    varyingSize += 1;
    varyingSize += replyTo_len;
  }
  val = fields.expiration;
  if (void 0 != val) {
    if (!("string" == typeof val && Buffer.byteLength(val) < 256)) throw new TypeError("Field 'expiration' is the wrong type; must be a string (up to 255 chars)");
    var expiration_len = Buffer.byteLength(val, "utf8");
    varyingSize += 1;
    varyingSize += expiration_len;
  }
  val = fields.messageId;
  if (void 0 != val) {
    if (!("string" == typeof val && Buffer.byteLength(val) < 256)) throw new TypeError("Field 'messageId' is the wrong type; must be a string (up to 255 chars)");
    var messageId_len = Buffer.byteLength(val, "utf8");
    varyingSize += 1;
    varyingSize += messageId_len;
  }
  val = fields.timestamp;
  if (void 0 != val) {
    if ("number" != typeof val || isNaN(val)) throw new TypeError("Field 'timestamp' is the wrong type; must be a number (but not NaN)");
    varyingSize += 8;
  }
  val = fields.type;
  if (void 0 != val) {
    if (!("string" == typeof val && Buffer.byteLength(val) < 256)) throw new TypeError("Field 'type' is the wrong type; must be a string (up to 255 chars)");
    var type_len = Buffer.byteLength(val, "utf8");
    varyingSize += 1;
    varyingSize += type_len;
  }
  val = fields.userId;
  if (void 0 != val) {
    if (!("string" == typeof val && Buffer.byteLength(val) < 256)) throw new TypeError("Field 'userId' is the wrong type; must be a string (up to 255 chars)");
    var userId_len = Buffer.byteLength(val, "utf8");
    varyingSize += 1;
    varyingSize += userId_len;
  }
  val = fields.appId;
  if (void 0 != val) {
    if (!("string" == typeof val && Buffer.byteLength(val) < 256)) throw new TypeError("Field 'appId' is the wrong type; must be a string (up to 255 chars)");
    var appId_len = Buffer.byteLength(val, "utf8");
    varyingSize += 1;
    varyingSize += appId_len;
  }
  val = fields.clusterId;
  if (void 0 != val) {
    if (!("string" == typeof val && Buffer.byteLength(val) < 256)) throw new TypeError("Field 'clusterId' is the wrong type; must be a string (up to 255 chars)");
    var clusterId_len = Buffer.byteLength(val, "utf8");
    varyingSize += 1;
    varyingSize += clusterId_len;
  }
  var buffer = new Buffer(22 + varyingSize);
  buffer[0] = 2;
  buffer.writeUInt16BE(channel, 1);
  buffer.writeUInt32BE(3932160, 7);
  ints.writeUInt64BE(buffer, size, 11);
  flags = 0;
  offset = 21;
  val = fields.contentType;
  if (void 0 != val) {
    flags += 32768;
    buffer[offset] = contentType_len;
    offset++;
    buffer.write(val, offset, "utf8");
    offset += contentType_len;
  }
  val = fields.contentEncoding;
  if (void 0 != val) {
    flags += 16384;
    buffer[offset] = contentEncoding_len;
    offset++;
    buffer.write(val, offset, "utf8");
    offset += contentEncoding_len;
  }
  val = fields.headers;
  if (void 0 != val) {
    flags += 8192;
    offset += headers_encoded.copy(buffer, offset);
  }
  val = fields.deliveryMode;
  if (void 0 != val) {
    flags += 4096;
    buffer.writeUInt8(val, offset);
    offset++;
  }
  val = fields.priority;
  if (void 0 != val) {
    flags += 2048;
    buffer.writeUInt8(val, offset);
    offset++;
  }
  val = fields.correlationId;
  if (void 0 != val) {
    flags += 1024;
    buffer[offset] = correlationId_len;
    offset++;
    buffer.write(val, offset, "utf8");
    offset += correlationId_len;
  }
  val = fields.replyTo;
  if (void 0 != val) {
    flags += 512;
    buffer[offset] = replyTo_len;
    offset++;
    buffer.write(val, offset, "utf8");
    offset += replyTo_len;
  }
  val = fields.expiration;
  if (void 0 != val) {
    flags += 256;
    buffer[offset] = expiration_len;
    offset++;
    buffer.write(val, offset, "utf8");
    offset += expiration_len;
  }
  val = fields.messageId;
  if (void 0 != val) {
    flags += 128;
    buffer[offset] = messageId_len;
    offset++;
    buffer.write(val, offset, "utf8");
    offset += messageId_len;
  }
  val = fields.timestamp;
  if (void 0 != val) {
    flags += 64;
    ints.writeUInt64BE(buffer, val, offset);
    offset += 8;
  }
  val = fields.type;
  if (void 0 != val) {
    flags += 32;
    buffer[offset] = type_len;
    offset++;
    buffer.write(val, offset, "utf8");
    offset += type_len;
  }
  val = fields.userId;
  if (void 0 != val) {
    flags += 16;
    buffer[offset] = userId_len;
    offset++;
    buffer.write(val, offset, "utf8");
    offset += userId_len;
  }
  val = fields.appId;
  if (void 0 != val) {
    flags += 8;
    buffer[offset] = appId_len;
    offset++;
    buffer.write(val, offset, "utf8");
    offset += appId_len;
  }
  val = fields.clusterId;
  if (void 0 != val) {
    flags += 4;
    buffer[offset] = clusterId_len;
    offset++;
    buffer.write(val, offset, "utf8");
    offset += clusterId_len;
  }
  buffer[offset] = 206;
  buffer.writeUInt32BE(offset - 7, 3);
  buffer.writeUInt16BE(flags, 19);
  return buffer.slice(0, offset + 1);
}

function decodeBasicProperties(buffer) {
  var flags, val, len, offset = 2;
  flags = buffer.readUInt16BE(0);
  if (0 === flags) return {};
  var fields = {
    contentType: void 0,
    contentEncoding: void 0,
    headers: void 0,
    deliveryMode: void 0,
    priority: void 0,
    correlationId: void 0,
    replyTo: void 0,
    expiration: void 0,
    messageId: void 0,
    timestamp: void 0,
    type: void 0,
    userId: void 0,
    appId: void 0,
    clusterId: void 0
  };
  if (32768 & flags) {
    len = buffer.readUInt8(offset);
    offset++;
    val = buffer.toString("utf8", offset, offset + len);
    offset += len;
    fields.contentType = val;
  }
  if (16384 & flags) {
    len = buffer.readUInt8(offset);
    offset++;
    val = buffer.toString("utf8", offset, offset + len);
    offset += len;
    fields.contentEncoding = val;
  }
  if (8192 & flags) {
    len = buffer.readUInt32BE(offset);
    offset += 4;
    val = decodeFields(buffer.slice(offset, offset + len));
    offset += len;
    fields.headers = val;
  }
  if (4096 & flags) {
    val = buffer[offset];
    offset++;
    fields.deliveryMode = val;
  }
  if (2048 & flags) {
    val = buffer[offset];
    offset++;
    fields.priority = val;
  }
  if (1024 & flags) {
    len = buffer.readUInt8(offset);
    offset++;
    val = buffer.toString("utf8", offset, offset + len);
    offset += len;
    fields.correlationId = val;
  }
  if (512 & flags) {
    len = buffer.readUInt8(offset);
    offset++;
    val = buffer.toString("utf8", offset, offset + len);
    offset += len;
    fields.replyTo = val;
  }
  if (256 & flags) {
    len = buffer.readUInt8(offset);
    offset++;
    val = buffer.toString("utf8", offset, offset + len);
    offset += len;
    fields.expiration = val;
  }
  if (128 & flags) {
    len = buffer.readUInt8(offset);
    offset++;
    val = buffer.toString("utf8", offset, offset + len);
    offset += len;
    fields.messageId = val;
  }
  if (64 & flags) {
    val = ints.readUInt64BE(buffer, offset);
    offset += 8;
    fields.timestamp = val;
  }
  if (32 & flags) {
    len = buffer.readUInt8(offset);
    offset++;
    val = buffer.toString("utf8", offset, offset + len);
    offset += len;
    fields.type = val;
  }
  if (16 & flags) {
    len = buffer.readUInt8(offset);
    offset++;
    val = buffer.toString("utf8", offset, offset + len);
    offset += len;
    fields.userId = val;
  }
  if (8 & flags) {
    len = buffer.readUInt8(offset);
    offset++;
    val = buffer.toString("utf8", offset, offset + len);
    offset += len;
    fields.appId = val;
  }
  if (4 & flags) {
    len = buffer.readUInt8(offset);
    offset++;
    val = buffer.toString("utf8", offset, offset + len);
    offset += len;
    fields.clusterId = val;
  }
  return fields;
}

var codec = require("./codec"), ints = require("buffer-more-ints"), encodeTable = codec.encodeTable, decodeFields = codec.decodeFields, SCRATCH = new Buffer(4096), EMPTY_OBJECT = Object.freeze({});

module.exports.constants = {
  FRAME_METHOD: 1,
  FRAME_HEADER: 2,
  FRAME_BODY: 3,
  FRAME_HEARTBEAT: 8,
  FRAME_MIN_SIZE: 4096,
  FRAME_END: 206,
  REPLY_SUCCESS: 200,
  CONTENT_TOO_LARGE: 311,
  NO_ROUTE: 312,
  NO_CONSUMERS: 313,
  ACCESS_REFUSED: 403,
  NOT_FOUND: 404,
  RESOURCE_LOCKED: 405,
  PRECONDITION_FAILED: 406,
  CONNECTION_FORCED: 320,
  INVALID_PATH: 402,
  FRAME_ERROR: 501,
  SYNTAX_ERROR: 502,
  COMMAND_INVALID: 503,
  CHANNEL_ERROR: 504,
  UNEXPECTED_FRAME: 505,
  RESOURCE_ERROR: 506,
  NOT_ALLOWED: 530,
  NOT_IMPLEMENTED: 540,
  INTERNAL_ERROR: 541
};

module.exports.constant_strs = {
  "1": "FRAME-METHOD",
  "2": "FRAME-HEADER",
  "3": "FRAME-BODY",
  "8": "FRAME-HEARTBEAT",
  "200": "REPLY-SUCCESS",
  "206": "FRAME-END",
  "311": "CONTENT-TOO-LARGE",
  "312": "NO-ROUTE",
  "313": "NO-CONSUMERS",
  "320": "CONNECTION-FORCED",
  "402": "INVALID-PATH",
  "403": "ACCESS-REFUSED",
  "404": "NOT-FOUND",
  "405": "RESOURCE-LOCKED",
  "406": "PRECONDITION-FAILED",
  "501": "FRAME-ERROR",
  "502": "SYNTAX-ERROR",
  "503": "COMMAND-INVALID",
  "504": "CHANNEL-ERROR",
  "505": "UNEXPECTED-FRAME",
  "506": "RESOURCE-ERROR",
  "530": "NOT-ALLOWED",
  "540": "NOT-IMPLEMENTED",
  "541": "INTERNAL-ERROR",
  "4096": "FRAME-MIN-SIZE"
};

module.exports.FRAME_OVERHEAD = 8;

module.exports.decode = function(id, buf) {
  switch (id) {
   case 655370:
    return decodeConnectionStart(buf);

   case 655371:
    return decodeConnectionStartOk(buf);

   case 655380:
    return decodeConnectionSecure(buf);

   case 655381:
    return decodeConnectionSecureOk(buf);

   case 655390:
    return decodeConnectionTune(buf);

   case 655391:
    return decodeConnectionTuneOk(buf);

   case 655400:
    return decodeConnectionOpen(buf);

   case 655401:
    return decodeConnectionOpenOk(buf);

   case 655410:
    return decodeConnectionClose(buf);

   case 655411:
    return decodeConnectionCloseOk(buf);

   case 655420:
    return decodeConnectionBlocked(buf);

   case 655421:
    return decodeConnectionUnblocked(buf);

   case 1310730:
    return decodeChannelOpen(buf);

   case 1310731:
    return decodeChannelOpenOk(buf);

   case 1310740:
    return decodeChannelFlow(buf);

   case 1310741:
    return decodeChannelFlowOk(buf);

   case 1310760:
    return decodeChannelClose(buf);

   case 1310761:
    return decodeChannelCloseOk(buf);

   case 1966090:
    return decodeAccessRequest(buf);

   case 1966091:
    return decodeAccessRequestOk(buf);

   case 2621450:
    return decodeExchangeDeclare(buf);

   case 2621451:
    return decodeExchangeDeclareOk(buf);

   case 2621460:
    return decodeExchangeDelete(buf);

   case 2621461:
    return decodeExchangeDeleteOk(buf);

   case 2621470:
    return decodeExchangeBind(buf);

   case 2621471:
    return decodeExchangeBindOk(buf);

   case 2621480:
    return decodeExchangeUnbind(buf);

   case 2621491:
    return decodeExchangeUnbindOk(buf);

   case 3276810:
    return decodeQueueDeclare(buf);

   case 3276811:
    return decodeQueueDeclareOk(buf);

   case 3276820:
    return decodeQueueBind(buf);

   case 3276821:
    return decodeQueueBindOk(buf);

   case 3276830:
    return decodeQueuePurge(buf);

   case 3276831:
    return decodeQueuePurgeOk(buf);

   case 3276840:
    return decodeQueueDelete(buf);

   case 3276841:
    return decodeQueueDeleteOk(buf);

   case 3276850:
    return decodeQueueUnbind(buf);

   case 3276851:
    return decodeQueueUnbindOk(buf);

   case 3932170:
    return decodeBasicQos(buf);

   case 3932171:
    return decodeBasicQosOk(buf);

   case 3932180:
    return decodeBasicConsume(buf);

   case 3932181:
    return decodeBasicConsumeOk(buf);

   case 3932190:
    return decodeBasicCancel(buf);

   case 3932191:
    return decodeBasicCancelOk(buf);

   case 3932200:
    return decodeBasicPublish(buf);

   case 3932210:
    return decodeBasicReturn(buf);

   case 3932220:
    return decodeBasicDeliver(buf);

   case 3932230:
    return decodeBasicGet(buf);

   case 3932231:
    return decodeBasicGetOk(buf);

   case 3932232:
    return decodeBasicGetEmpty(buf);

   case 3932240:
    return decodeBasicAck(buf);

   case 3932250:
    return decodeBasicReject(buf);

   case 3932260:
    return decodeBasicRecoverAsync(buf);

   case 3932270:
    return decodeBasicRecover(buf);

   case 3932271:
    return decodeBasicRecoverOk(buf);

   case 3932280:
    return decodeBasicNack(buf);

   case 5898250:
    return decodeTxSelect(buf);

   case 5898251:
    return decodeTxSelectOk(buf);

   case 5898260:
    return decodeTxCommit(buf);

   case 5898261:
    return decodeTxCommitOk(buf);

   case 5898270:
    return decodeTxRollback(buf);

   case 5898271:
    return decodeTxRollbackOk(buf);

   case 5570570:
    return decodeConfirmSelect(buf);

   case 5570571:
    return decodeConfirmSelectOk(buf);

   case 60:
    return decodeBasicProperties(buf);

   default:
    throw new Error("Unknown class/method ID");
  }
};

module.exports.encodeMethod = function(id, channel, fields) {
  switch (id) {
   case 655370:
    return encodeConnectionStart(channel, fields);

   case 655371:
    return encodeConnectionStartOk(channel, fields);

   case 655380:
    return encodeConnectionSecure(channel, fields);

   case 655381:
    return encodeConnectionSecureOk(channel, fields);

   case 655390:
    return encodeConnectionTune(channel, fields);

   case 655391:
    return encodeConnectionTuneOk(channel, fields);

   case 655400:
    return encodeConnectionOpen(channel, fields);

   case 655401:
    return encodeConnectionOpenOk(channel, fields);

   case 655410:
    return encodeConnectionClose(channel, fields);

   case 655411:
    return encodeConnectionCloseOk(channel, fields);

   case 655420:
    return encodeConnectionBlocked(channel, fields);

   case 655421:
    return encodeConnectionUnblocked(channel, fields);

   case 1310730:
    return encodeChannelOpen(channel, fields);

   case 1310731:
    return encodeChannelOpenOk(channel, fields);

   case 1310740:
    return encodeChannelFlow(channel, fields);

   case 1310741:
    return encodeChannelFlowOk(channel, fields);

   case 1310760:
    return encodeChannelClose(channel, fields);

   case 1310761:
    return encodeChannelCloseOk(channel, fields);

   case 1966090:
    return encodeAccessRequest(channel, fields);

   case 1966091:
    return encodeAccessRequestOk(channel, fields);

   case 2621450:
    return encodeExchangeDeclare(channel, fields);

   case 2621451:
    return encodeExchangeDeclareOk(channel, fields);

   case 2621460:
    return encodeExchangeDelete(channel, fields);

   case 2621461:
    return encodeExchangeDeleteOk(channel, fields);

   case 2621470:
    return encodeExchangeBind(channel, fields);

   case 2621471:
    return encodeExchangeBindOk(channel, fields);

   case 2621480:
    return encodeExchangeUnbind(channel, fields);

   case 2621491:
    return encodeExchangeUnbindOk(channel, fields);

   case 3276810:
    return encodeQueueDeclare(channel, fields);

   case 3276811:
    return encodeQueueDeclareOk(channel, fields);

   case 3276820:
    return encodeQueueBind(channel, fields);

   case 3276821:
    return encodeQueueBindOk(channel, fields);

   case 3276830:
    return encodeQueuePurge(channel, fields);

   case 3276831:
    return encodeQueuePurgeOk(channel, fields);

   case 3276840:
    return encodeQueueDelete(channel, fields);

   case 3276841:
    return encodeQueueDeleteOk(channel, fields);

   case 3276850:
    return encodeQueueUnbind(channel, fields);

   case 3276851:
    return encodeQueueUnbindOk(channel, fields);

   case 3932170:
    return encodeBasicQos(channel, fields);

   case 3932171:
    return encodeBasicQosOk(channel, fields);

   case 3932180:
    return encodeBasicConsume(channel, fields);

   case 3932181:
    return encodeBasicConsumeOk(channel, fields);

   case 3932190:
    return encodeBasicCancel(channel, fields);

   case 3932191:
    return encodeBasicCancelOk(channel, fields);

   case 3932200:
    return encodeBasicPublish(channel, fields);

   case 3932210:
    return encodeBasicReturn(channel, fields);

   case 3932220:
    return encodeBasicDeliver(channel, fields);

   case 3932230:
    return encodeBasicGet(channel, fields);

   case 3932231:
    return encodeBasicGetOk(channel, fields);

   case 3932232:
    return encodeBasicGetEmpty(channel, fields);

   case 3932240:
    return encodeBasicAck(channel, fields);

   case 3932250:
    return encodeBasicReject(channel, fields);

   case 3932260:
    return encodeBasicRecoverAsync(channel, fields);

   case 3932270:
    return encodeBasicRecover(channel, fields);

   case 3932271:
    return encodeBasicRecoverOk(channel, fields);

   case 3932280:
    return encodeBasicNack(channel, fields);

   case 5898250:
    return encodeTxSelect(channel, fields);

   case 5898251:
    return encodeTxSelectOk(channel, fields);

   case 5898260:
    return encodeTxCommit(channel, fields);

   case 5898261:
    return encodeTxCommitOk(channel, fields);

   case 5898270:
    return encodeTxRollback(channel, fields);

   case 5898271:
    return encodeTxRollbackOk(channel, fields);

   case 5570570:
    return encodeConfirmSelect(channel, fields);

   case 5570571:
    return encodeConfirmSelectOk(channel, fields);

   default:
    throw new Error("Unknown class/method ID");
  }
};

module.exports.encodeProperties = function(id, channel, size, fields) {
  switch (id) {
   case 60:
    return encodeBasicProperties(channel, size, fields);

   default:
    throw new Error("Unknown class/properties ID");
  }
};

module.exports.info = function(id) {
  switch (id) {
   case 655370:
    return methodInfoConnectionStart;

   case 655371:
    return methodInfoConnectionStartOk;

   case 655380:
    return methodInfoConnectionSecure;

   case 655381:
    return methodInfoConnectionSecureOk;

   case 655390:
    return methodInfoConnectionTune;

   case 655391:
    return methodInfoConnectionTuneOk;

   case 655400:
    return methodInfoConnectionOpen;

   case 655401:
    return methodInfoConnectionOpenOk;

   case 655410:
    return methodInfoConnectionClose;

   case 655411:
    return methodInfoConnectionCloseOk;

   case 655420:
    return methodInfoConnectionBlocked;

   case 655421:
    return methodInfoConnectionUnblocked;

   case 1310730:
    return methodInfoChannelOpen;

   case 1310731:
    return methodInfoChannelOpenOk;

   case 1310740:
    return methodInfoChannelFlow;

   case 1310741:
    return methodInfoChannelFlowOk;

   case 1310760:
    return methodInfoChannelClose;

   case 1310761:
    return methodInfoChannelCloseOk;

   case 1966090:
    return methodInfoAccessRequest;

   case 1966091:
    return methodInfoAccessRequestOk;

   case 2621450:
    return methodInfoExchangeDeclare;

   case 2621451:
    return methodInfoExchangeDeclareOk;

   case 2621460:
    return methodInfoExchangeDelete;

   case 2621461:
    return methodInfoExchangeDeleteOk;

   case 2621470:
    return methodInfoExchangeBind;

   case 2621471:
    return methodInfoExchangeBindOk;

   case 2621480:
    return methodInfoExchangeUnbind;

   case 2621491:
    return methodInfoExchangeUnbindOk;

   case 3276810:
    return methodInfoQueueDeclare;

   case 3276811:
    return methodInfoQueueDeclareOk;

   case 3276820:
    return methodInfoQueueBind;

   case 3276821:
    return methodInfoQueueBindOk;

   case 3276830:
    return methodInfoQueuePurge;

   case 3276831:
    return methodInfoQueuePurgeOk;

   case 3276840:
    return methodInfoQueueDelete;

   case 3276841:
    return methodInfoQueueDeleteOk;

   case 3276850:
    return methodInfoQueueUnbind;

   case 3276851:
    return methodInfoQueueUnbindOk;

   case 3932170:
    return methodInfoBasicQos;

   case 3932171:
    return methodInfoBasicQosOk;

   case 3932180:
    return methodInfoBasicConsume;

   case 3932181:
    return methodInfoBasicConsumeOk;

   case 3932190:
    return methodInfoBasicCancel;

   case 3932191:
    return methodInfoBasicCancelOk;

   case 3932200:
    return methodInfoBasicPublish;

   case 3932210:
    return methodInfoBasicReturn;

   case 3932220:
    return methodInfoBasicDeliver;

   case 3932230:
    return methodInfoBasicGet;

   case 3932231:
    return methodInfoBasicGetOk;

   case 3932232:
    return methodInfoBasicGetEmpty;

   case 3932240:
    return methodInfoBasicAck;

   case 3932250:
    return methodInfoBasicReject;

   case 3932260:
    return methodInfoBasicRecoverAsync;

   case 3932270:
    return methodInfoBasicRecover;

   case 3932271:
    return methodInfoBasicRecoverOk;

   case 3932280:
    return methodInfoBasicNack;

   case 5898250:
    return methodInfoTxSelect;

   case 5898251:
    return methodInfoTxSelectOk;

   case 5898260:
    return methodInfoTxCommit;

   case 5898261:
    return methodInfoTxCommitOk;

   case 5898270:
    return methodInfoTxRollback;

   case 5898271:
    return methodInfoTxRollbackOk;

   case 5570570:
    return methodInfoConfirmSelect;

   case 5570571:
    return methodInfoConfirmSelectOk;

   case 60:
    return propertiesInfoBasicProperties;

   default:
    throw new Error("Unknown class/method ID");
  }
};

module.exports.ConnectionStart = 655370;

var methodInfoConnectionStart = module.exports.methodInfoConnectionStart = {
  id: 655370,
  name: "ConnectionStart",
  args: [ {
    type: "octet",
    name: "versionMajor",
    "default": 0
  }, {
    type: "octet",
    name: "versionMinor",
    "default": 9
  }, {
    type: "table",
    name: "serverProperties"
  }, {
    type: "longstr",
    name: "mechanisms",
    "default": "PLAIN"
  }, {
    type: "longstr",
    name: "locales",
    "default": "en_US"
  } ]
};

module.exports.ConnectionStartOk = 655371;

var methodInfoConnectionStartOk = module.exports.methodInfoConnectionStartOk = {
  id: 655371,
  name: "ConnectionStartOk",
  args: [ {
    type: "table",
    name: "clientProperties"
  }, {
    type: "shortstr",
    name: "mechanism",
    "default": "PLAIN"
  }, {
    type: "longstr",
    name: "response"
  }, {
    type: "shortstr",
    name: "locale",
    "default": "en_US"
  } ]
};

module.exports.ConnectionSecure = 655380;

var methodInfoConnectionSecure = module.exports.methodInfoConnectionSecure = {
  id: 655380,
  name: "ConnectionSecure",
  args: [ {
    type: "longstr",
    name: "challenge"
  } ]
};

module.exports.ConnectionSecureOk = 655381;

var methodInfoConnectionSecureOk = module.exports.methodInfoConnectionSecureOk = {
  id: 655381,
  name: "ConnectionSecureOk",
  args: [ {
    type: "longstr",
    name: "response"
  } ]
};

module.exports.ConnectionTune = 655390;

var methodInfoConnectionTune = module.exports.methodInfoConnectionTune = {
  id: 655390,
  name: "ConnectionTune",
  args: [ {
    type: "short",
    name: "channelMax",
    "default": 0
  }, {
    type: "long",
    name: "frameMax",
    "default": 0
  }, {
    type: "short",
    name: "heartbeat",
    "default": 0
  } ]
};

module.exports.ConnectionTuneOk = 655391;

var methodInfoConnectionTuneOk = module.exports.methodInfoConnectionTuneOk = {
  id: 655391,
  name: "ConnectionTuneOk",
  args: [ {
    type: "short",
    name: "channelMax",
    "default": 0
  }, {
    type: "long",
    name: "frameMax",
    "default": 0
  }, {
    type: "short",
    name: "heartbeat",
    "default": 0
  } ]
};

module.exports.ConnectionOpen = 655400;

var methodInfoConnectionOpen = module.exports.methodInfoConnectionOpen = {
  id: 655400,
  name: "ConnectionOpen",
  args: [ {
    type: "shortstr",
    name: "virtualHost",
    "default": "/"
  }, {
    type: "shortstr",
    name: "capabilities",
    "default": ""
  }, {
    type: "bit",
    name: "insist",
    "default": !1
  } ]
};

module.exports.ConnectionOpenOk = 655401;

var methodInfoConnectionOpenOk = module.exports.methodInfoConnectionOpenOk = {
  id: 655401,
  name: "ConnectionOpenOk",
  args: [ {
    type: "shortstr",
    name: "knownHosts",
    "default": ""
  } ]
};

module.exports.ConnectionClose = 655410;

var methodInfoConnectionClose = module.exports.methodInfoConnectionClose = {
  id: 655410,
  name: "ConnectionClose",
  args: [ {
    type: "short",
    name: "replyCode"
  }, {
    type: "shortstr",
    name: "replyText",
    "default": ""
  }, {
    type: "short",
    name: "classId"
  }, {
    type: "short",
    name: "methodId"
  } ]
};

module.exports.ConnectionCloseOk = 655411;

var methodInfoConnectionCloseOk = module.exports.methodInfoConnectionCloseOk = {
  id: 655411,
  name: "ConnectionCloseOk",
  args: []
};

module.exports.ConnectionBlocked = 655420;

var methodInfoConnectionBlocked = module.exports.methodInfoConnectionBlocked = {
  id: 655420,
  name: "ConnectionBlocked",
  args: [ {
    type: "shortstr",
    name: "reason",
    "default": ""
  } ]
};

module.exports.ConnectionUnblocked = 655421;

var methodInfoConnectionUnblocked = module.exports.methodInfoConnectionUnblocked = {
  id: 655421,
  name: "ConnectionUnblocked",
  args: []
};

module.exports.ChannelOpen = 1310730;

var methodInfoChannelOpen = module.exports.methodInfoChannelOpen = {
  id: 1310730,
  name: "ChannelOpen",
  args: [ {
    type: "shortstr",
    name: "outOfBand",
    "default": ""
  } ]
};

module.exports.ChannelOpenOk = 1310731;

var methodInfoChannelOpenOk = module.exports.methodInfoChannelOpenOk = {
  id: 1310731,
  name: "ChannelOpenOk",
  args: [ {
    type: "longstr",
    name: "channelId",
    "default": ""
  } ]
};

module.exports.ChannelFlow = 1310740;

var methodInfoChannelFlow = module.exports.methodInfoChannelFlow = {
  id: 1310740,
  name: "ChannelFlow",
  args: [ {
    type: "bit",
    name: "active"
  } ]
};

module.exports.ChannelFlowOk = 1310741;

var methodInfoChannelFlowOk = module.exports.methodInfoChannelFlowOk = {
  id: 1310741,
  name: "ChannelFlowOk",
  args: [ {
    type: "bit",
    name: "active"
  } ]
};

module.exports.ChannelClose = 1310760;

var methodInfoChannelClose = module.exports.methodInfoChannelClose = {
  id: 1310760,
  name: "ChannelClose",
  args: [ {
    type: "short",
    name: "replyCode"
  }, {
    type: "shortstr",
    name: "replyText",
    "default": ""
  }, {
    type: "short",
    name: "classId"
  }, {
    type: "short",
    name: "methodId"
  } ]
};

module.exports.ChannelCloseOk = 1310761;

var methodInfoChannelCloseOk = module.exports.methodInfoChannelCloseOk = {
  id: 1310761,
  name: "ChannelCloseOk",
  args: []
};

module.exports.AccessRequest = 1966090;

var methodInfoAccessRequest = module.exports.methodInfoAccessRequest = {
  id: 1966090,
  name: "AccessRequest",
  args: [ {
    type: "shortstr",
    name: "realm",
    "default": "/data"
  }, {
    type: "bit",
    name: "exclusive",
    "default": !1
  }, {
    type: "bit",
    name: "passive",
    "default": !0
  }, {
    type: "bit",
    name: "active",
    "default": !0
  }, {
    type: "bit",
    name: "write",
    "default": !0
  }, {
    type: "bit",
    name: "read",
    "default": !0
  } ]
};

module.exports.AccessRequestOk = 1966091;

var methodInfoAccessRequestOk = module.exports.methodInfoAccessRequestOk = {
  id: 1966091,
  name: "AccessRequestOk",
  args: [ {
    type: "short",
    name: "ticket",
    "default": 1
  } ]
};

module.exports.ExchangeDeclare = 2621450;

var methodInfoExchangeDeclare = module.exports.methodInfoExchangeDeclare = {
  id: 2621450,
  name: "ExchangeDeclare",
  args: [ {
    type: "short",
    name: "ticket",
    "default": 0
  }, {
    type: "shortstr",
    name: "exchange"
  }, {
    type: "shortstr",
    name: "type",
    "default": "direct"
  }, {
    type: "bit",
    name: "passive",
    "default": !1
  }, {
    type: "bit",
    name: "durable",
    "default": !1
  }, {
    type: "bit",
    name: "autoDelete",
    "default": !1
  }, {
    type: "bit",
    name: "internal",
    "default": !1
  }, {
    type: "bit",
    name: "nowait",
    "default": !1
  }, {
    type: "table",
    name: "arguments",
    "default": {}
  } ]
};

module.exports.ExchangeDeclareOk = 2621451;

var methodInfoExchangeDeclareOk = module.exports.methodInfoExchangeDeclareOk = {
  id: 2621451,
  name: "ExchangeDeclareOk",
  args: []
};

module.exports.ExchangeDelete = 2621460;

var methodInfoExchangeDelete = module.exports.methodInfoExchangeDelete = {
  id: 2621460,
  name: "ExchangeDelete",
  args: [ {
    type: "short",
    name: "ticket",
    "default": 0
  }, {
    type: "shortstr",
    name: "exchange"
  }, {
    type: "bit",
    name: "ifUnused",
    "default": !1
  }, {
    type: "bit",
    name: "nowait",
    "default": !1
  } ]
};

module.exports.ExchangeDeleteOk = 2621461;

var methodInfoExchangeDeleteOk = module.exports.methodInfoExchangeDeleteOk = {
  id: 2621461,
  name: "ExchangeDeleteOk",
  args: []
};

module.exports.ExchangeBind = 2621470;

var methodInfoExchangeBind = module.exports.methodInfoExchangeBind = {
  id: 2621470,
  name: "ExchangeBind",
  args: [ {
    type: "short",
    name: "ticket",
    "default": 0
  }, {
    type: "shortstr",
    name: "destination"
  }, {
    type: "shortstr",
    name: "source"
  }, {
    type: "shortstr",
    name: "routingKey",
    "default": ""
  }, {
    type: "bit",
    name: "nowait",
    "default": !1
  }, {
    type: "table",
    name: "arguments",
    "default": {}
  } ]
};

module.exports.ExchangeBindOk = 2621471;

var methodInfoExchangeBindOk = module.exports.methodInfoExchangeBindOk = {
  id: 2621471,
  name: "ExchangeBindOk",
  args: []
};

module.exports.ExchangeUnbind = 2621480;

var methodInfoExchangeUnbind = module.exports.methodInfoExchangeUnbind = {
  id: 2621480,
  name: "ExchangeUnbind",
  args: [ {
    type: "short",
    name: "ticket",
    "default": 0
  }, {
    type: "shortstr",
    name: "destination"
  }, {
    type: "shortstr",
    name: "source"
  }, {
    type: "shortstr",
    name: "routingKey",
    "default": ""
  }, {
    type: "bit",
    name: "nowait",
    "default": !1
  }, {
    type: "table",
    name: "arguments",
    "default": {}
  } ]
};

module.exports.ExchangeUnbindOk = 2621491;

var methodInfoExchangeUnbindOk = module.exports.methodInfoExchangeUnbindOk = {
  id: 2621491,
  name: "ExchangeUnbindOk",
  args: []
};

module.exports.QueueDeclare = 3276810;

var methodInfoQueueDeclare = module.exports.methodInfoQueueDeclare = {
  id: 3276810,
  name: "QueueDeclare",
  args: [ {
    type: "short",
    name: "ticket",
    "default": 0
  }, {
    type: "shortstr",
    name: "queue",
    "default": ""
  }, {
    type: "bit",
    name: "passive",
    "default": !1
  }, {
    type: "bit",
    name: "durable",
    "default": !1
  }, {
    type: "bit",
    name: "exclusive",
    "default": !1
  }, {
    type: "bit",
    name: "autoDelete",
    "default": !1
  }, {
    type: "bit",
    name: "nowait",
    "default": !1
  }, {
    type: "table",
    name: "arguments",
    "default": {}
  } ]
};

module.exports.QueueDeclareOk = 3276811;

var methodInfoQueueDeclareOk = module.exports.methodInfoQueueDeclareOk = {
  id: 3276811,
  name: "QueueDeclareOk",
  args: [ {
    type: "shortstr",
    name: "queue"
  }, {
    type: "long",
    name: "messageCount"
  }, {
    type: "long",
    name: "consumerCount"
  } ]
};

module.exports.QueueBind = 3276820;

var methodInfoQueueBind = module.exports.methodInfoQueueBind = {
  id: 3276820,
  name: "QueueBind",
  args: [ {
    type: "short",
    name: "ticket",
    "default": 0
  }, {
    type: "shortstr",
    name: "queue",
    "default": ""
  }, {
    type: "shortstr",
    name: "exchange"
  }, {
    type: "shortstr",
    name: "routingKey",
    "default": ""
  }, {
    type: "bit",
    name: "nowait",
    "default": !1
  }, {
    type: "table",
    name: "arguments",
    "default": {}
  } ]
};

module.exports.QueueBindOk = 3276821;

var methodInfoQueueBindOk = module.exports.methodInfoQueueBindOk = {
  id: 3276821,
  name: "QueueBindOk",
  args: []
};

module.exports.QueuePurge = 3276830;

var methodInfoQueuePurge = module.exports.methodInfoQueuePurge = {
  id: 3276830,
  name: "QueuePurge",
  args: [ {
    type: "short",
    name: "ticket",
    "default": 0
  }, {
    type: "shortstr",
    name: "queue",
    "default": ""
  }, {
    type: "bit",
    name: "nowait",
    "default": !1
  } ]
};

module.exports.QueuePurgeOk = 3276831;

var methodInfoQueuePurgeOk = module.exports.methodInfoQueuePurgeOk = {
  id: 3276831,
  name: "QueuePurgeOk",
  args: [ {
    type: "long",
    name: "messageCount"
  } ]
};

module.exports.QueueDelete = 3276840;

var methodInfoQueueDelete = module.exports.methodInfoQueueDelete = {
  id: 3276840,
  name: "QueueDelete",
  args: [ {
    type: "short",
    name: "ticket",
    "default": 0
  }, {
    type: "shortstr",
    name: "queue",
    "default": ""
  }, {
    type: "bit",
    name: "ifUnused",
    "default": !1
  }, {
    type: "bit",
    name: "ifEmpty",
    "default": !1
  }, {
    type: "bit",
    name: "nowait",
    "default": !1
  } ]
};

module.exports.QueueDeleteOk = 3276841;

var methodInfoQueueDeleteOk = module.exports.methodInfoQueueDeleteOk = {
  id: 3276841,
  name: "QueueDeleteOk",
  args: [ {
    type: "long",
    name: "messageCount"
  } ]
};

module.exports.QueueUnbind = 3276850;

var methodInfoQueueUnbind = module.exports.methodInfoQueueUnbind = {
  id: 3276850,
  name: "QueueUnbind",
  args: [ {
    type: "short",
    name: "ticket",
    "default": 0
  }, {
    type: "shortstr",
    name: "queue",
    "default": ""
  }, {
    type: "shortstr",
    name: "exchange"
  }, {
    type: "shortstr",
    name: "routingKey",
    "default": ""
  }, {
    type: "table",
    name: "arguments",
    "default": {}
  } ]
};

module.exports.QueueUnbindOk = 3276851;

var methodInfoQueueUnbindOk = module.exports.methodInfoQueueUnbindOk = {
  id: 3276851,
  name: "QueueUnbindOk",
  args: []
};

module.exports.BasicQos = 3932170;

var methodInfoBasicQos = module.exports.methodInfoBasicQos = {
  id: 3932170,
  name: "BasicQos",
  args: [ {
    type: "long",
    name: "prefetchSize",
    "default": 0
  }, {
    type: "short",
    name: "prefetchCount",
    "default": 0
  }, {
    type: "bit",
    name: "global",
    "default": !1
  } ]
};

module.exports.BasicQosOk = 3932171;

var methodInfoBasicQosOk = module.exports.methodInfoBasicQosOk = {
  id: 3932171,
  name: "BasicQosOk",
  args: []
};

module.exports.BasicConsume = 3932180;

var methodInfoBasicConsume = module.exports.methodInfoBasicConsume = {
  id: 3932180,
  name: "BasicConsume",
  args: [ {
    type: "short",
    name: "ticket",
    "default": 0
  }, {
    type: "shortstr",
    name: "queue",
    "default": ""
  }, {
    type: "shortstr",
    name: "consumerTag",
    "default": ""
  }, {
    type: "bit",
    name: "noLocal",
    "default": !1
  }, {
    type: "bit",
    name: "noAck",
    "default": !1
  }, {
    type: "bit",
    name: "exclusive",
    "default": !1
  }, {
    type: "bit",
    name: "nowait",
    "default": !1
  }, {
    type: "table",
    name: "arguments",
    "default": {}
  } ]
};

module.exports.BasicConsumeOk = 3932181;

var methodInfoBasicConsumeOk = module.exports.methodInfoBasicConsumeOk = {
  id: 3932181,
  name: "BasicConsumeOk",
  args: [ {
    type: "shortstr",
    name: "consumerTag"
  } ]
};

module.exports.BasicCancel = 3932190;

var methodInfoBasicCancel = module.exports.methodInfoBasicCancel = {
  id: 3932190,
  name: "BasicCancel",
  args: [ {
    type: "shortstr",
    name: "consumerTag"
  }, {
    type: "bit",
    name: "nowait",
    "default": !1
  } ]
};

module.exports.BasicCancelOk = 3932191;

var methodInfoBasicCancelOk = module.exports.methodInfoBasicCancelOk = {
  id: 3932191,
  name: "BasicCancelOk",
  args: [ {
    type: "shortstr",
    name: "consumerTag"
  } ]
};

module.exports.BasicPublish = 3932200;

var methodInfoBasicPublish = module.exports.methodInfoBasicPublish = {
  id: 3932200,
  name: "BasicPublish",
  args: [ {
    type: "short",
    name: "ticket",
    "default": 0
  }, {
    type: "shortstr",
    name: "exchange",
    "default": ""
  }, {
    type: "shortstr",
    name: "routingKey",
    "default": ""
  }, {
    type: "bit",
    name: "mandatory",
    "default": !1
  }, {
    type: "bit",
    name: "immediate",
    "default": !1
  } ]
};

module.exports.BasicReturn = 3932210;

var methodInfoBasicReturn = module.exports.methodInfoBasicReturn = {
  id: 3932210,
  name: "BasicReturn",
  args: [ {
    type: "short",
    name: "replyCode"
  }, {
    type: "shortstr",
    name: "replyText",
    "default": ""
  }, {
    type: "shortstr",
    name: "exchange"
  }, {
    type: "shortstr",
    name: "routingKey"
  } ]
};

module.exports.BasicDeliver = 3932220;

var methodInfoBasicDeliver = module.exports.methodInfoBasicDeliver = {
  id: 3932220,
  name: "BasicDeliver",
  args: [ {
    type: "shortstr",
    name: "consumerTag"
  }, {
    type: "longlong",
    name: "deliveryTag"
  }, {
    type: "bit",
    name: "redelivered",
    "default": !1
  }, {
    type: "shortstr",
    name: "exchange"
  }, {
    type: "shortstr",
    name: "routingKey"
  } ]
};

module.exports.BasicGet = 3932230;

var methodInfoBasicGet = module.exports.methodInfoBasicGet = {
  id: 3932230,
  name: "BasicGet",
  args: [ {
    type: "short",
    name: "ticket",
    "default": 0
  }, {
    type: "shortstr",
    name: "queue",
    "default": ""
  }, {
    type: "bit",
    name: "noAck",
    "default": !1
  } ]
};

module.exports.BasicGetOk = 3932231;

var methodInfoBasicGetOk = module.exports.methodInfoBasicGetOk = {
  id: 3932231,
  name: "BasicGetOk",
  args: [ {
    type: "longlong",
    name: "deliveryTag"
  }, {
    type: "bit",
    name: "redelivered",
    "default": !1
  }, {
    type: "shortstr",
    name: "exchange"
  }, {
    type: "shortstr",
    name: "routingKey"
  }, {
    type: "long",
    name: "messageCount"
  } ]
};

module.exports.BasicGetEmpty = 3932232;

var methodInfoBasicGetEmpty = module.exports.methodInfoBasicGetEmpty = {
  id: 3932232,
  name: "BasicGetEmpty",
  args: [ {
    type: "shortstr",
    name: "clusterId",
    "default": ""
  } ]
};

module.exports.BasicAck = 3932240;

var methodInfoBasicAck = module.exports.methodInfoBasicAck = {
  id: 3932240,
  name: "BasicAck",
  args: [ {
    type: "longlong",
    name: "deliveryTag",
    "default": 0
  }, {
    type: "bit",
    name: "multiple",
    "default": !1
  } ]
};

module.exports.BasicReject = 3932250;

var methodInfoBasicReject = module.exports.methodInfoBasicReject = {
  id: 3932250,
  name: "BasicReject",
  args: [ {
    type: "longlong",
    name: "deliveryTag"
  }, {
    type: "bit",
    name: "requeue",
    "default": !0
  } ]
};

module.exports.BasicRecoverAsync = 3932260;

var methodInfoBasicRecoverAsync = module.exports.methodInfoBasicRecoverAsync = {
  id: 3932260,
  name: "BasicRecoverAsync",
  args: [ {
    type: "bit",
    name: "requeue",
    "default": !1
  } ]
};

module.exports.BasicRecover = 3932270;

var methodInfoBasicRecover = module.exports.methodInfoBasicRecover = {
  id: 3932270,
  name: "BasicRecover",
  args: [ {
    type: "bit",
    name: "requeue",
    "default": !1
  } ]
};

module.exports.BasicRecoverOk = 3932271;

var methodInfoBasicRecoverOk = module.exports.methodInfoBasicRecoverOk = {
  id: 3932271,
  name: "BasicRecoverOk",
  args: []
};

module.exports.BasicNack = 3932280;

var methodInfoBasicNack = module.exports.methodInfoBasicNack = {
  id: 3932280,
  name: "BasicNack",
  args: [ {
    type: "longlong",
    name: "deliveryTag",
    "default": 0
  }, {
    type: "bit",
    name: "multiple",
    "default": !1
  }, {
    type: "bit",
    name: "requeue",
    "default": !0
  } ]
};

module.exports.TxSelect = 5898250;

var methodInfoTxSelect = module.exports.methodInfoTxSelect = {
  id: 5898250,
  name: "TxSelect",
  args: []
};

module.exports.TxSelectOk = 5898251;

var methodInfoTxSelectOk = module.exports.methodInfoTxSelectOk = {
  id: 5898251,
  name: "TxSelectOk",
  args: []
};

module.exports.TxCommit = 5898260;

var methodInfoTxCommit = module.exports.methodInfoTxCommit = {
  id: 5898260,
  name: "TxCommit",
  args: []
};

module.exports.TxCommitOk = 5898261;

var methodInfoTxCommitOk = module.exports.methodInfoTxCommitOk = {
  id: 5898261,
  name: "TxCommitOk",
  args: []
};

module.exports.TxRollback = 5898270;

var methodInfoTxRollback = module.exports.methodInfoTxRollback = {
  id: 5898270,
  name: "TxRollback",
  args: []
};

module.exports.TxRollbackOk = 5898271;

var methodInfoTxRollbackOk = module.exports.methodInfoTxRollbackOk = {
  id: 5898271,
  name: "TxRollbackOk",
  args: []
};

module.exports.ConfirmSelect = 5570570;

var methodInfoConfirmSelect = module.exports.methodInfoConfirmSelect = {
  id: 5570570,
  name: "ConfirmSelect",
  args: [ {
    type: "bit",
    name: "nowait",
    "default": !1
  } ]
};

module.exports.ConfirmSelectOk = 5570571;

var methodInfoConfirmSelectOk = module.exports.methodInfoConfirmSelectOk = {
  id: 5570571,
  name: "ConfirmSelectOk",
  args: []
};

module.exports.BasicProperties = 60;

var propertiesInfoBasicProperties = module.exports.propertiesInfoBasicProperties = {
  id: 60,
  name: "BasicProperties",
  args: [ {
    type: "shortstr",
    name: "contentType"
  }, {
    type: "shortstr",
    name: "contentEncoding"
  }, {
    type: "table",
    name: "headers"
  }, {
    type: "octet",
    name: "deliveryMode"
  }, {
    type: "octet",
    name: "priority"
  }, {
    type: "shortstr",
    name: "correlationId"
  }, {
    type: "shortstr",
    name: "replyTo"
  }, {
    type: "shortstr",
    name: "expiration"
  }, {
    type: "shortstr",
    name: "messageId"
  }, {
    type: "timestamp",
    name: "timestamp"
  }, {
    type: "shortstr",
    name: "type"
  }, {
    type: "shortstr",
    name: "userId"
  }, {
    type: "shortstr",
    name: "appId"
  }, {
    type: "shortstr",
    name: "clusterId"
  } ]
};
}).call(this,require("buffer").Buffer)
},{"./codec":6,"buffer":24,"buffer-more-ints":21}],8:[function(require,module,exports){
var inherits = require('util').inherits;

function trimStack(stack, num) {
  return stack && stack.split('\n').slice(num).join('\n');
}

function IllegalOperationError(msg, stack) {
  var tmp = new Error();
  this.message = msg;
  this.stack = this.toString() + '\n' + trimStack(tmp.stack, 2);
  this.stackAtStateChange = stack;
}
inherits(IllegalOperationError, Error);

IllegalOperationError.prototype.name = 'IllegalOperationError';

function stackCapture(reason) {
  var e = new Error();
  return 'Stack capture: ' + reason + '\n' +
    trimStack(e.stack, 2);
}

module.exports.IllegalOperationError = IllegalOperationError;
module.exports.stackCapture = stackCapture;

},{"util":31}],9:[function(require,module,exports){
//
//
//

// Stringifying various things

'use strict';

var defs = require('./defs');
var format = require('util').format;
var inherits = require('util').inherits;
var HEARTBEAT = require('./frame').HEARTBEAT;

module.exports.closeMessage = function(close) {
  var code = close.fields.replyCode;
  return format('%d (%s) with message "%s"',
                code, defs.constant_strs[code],
                close.fields.replyText);
}

module.exports.methodName = function(id) {
  return defs.info(id).name;
};

module.exports.inspect = function(frame, showFields) {
  if (frame === HEARTBEAT) {
    return '<Heartbeat>';
  }
  else if (!frame.id) {
    return format('<Content channel:%d size:%d>',
                  frame.channel, frame.size);
  }
  else {
    var info = defs.info(frame.id);
    return format('<%s channel:%d%s>', info.name, frame.channel,
                  (showFields)
                  ? ' ' + JSON.stringify(frame.fields, undefined, 2)
                  : '');
  }
}

},{"./defs":7,"./frame":10,"util":31}],10:[function(require,module,exports){
(function (Buffer){
// The river sweeps through
// Silt and twigs, gravel and leaves
// Driving the wheel on

'use strict';

var defs = require('./defs');
var constants = defs.constants;
var decode = defs.decode;

var Bits = require('bitsyntax');

module.exports.PROTOCOL_HEADER = "AMQP" + String.fromCharCode(0, 0, 9, 1);

/*
  Frame format:

  0      1         3             7                size+7 size+8
  +------+---------+-------------+ +------------+ +-----------+
  | type | channel | size        | | payload    | | frame-end |
  +------+---------+-------------+ +------------+ +-----------+
  octet   short     long            size octets    octet

  In general I want to know those first three things straight away, so I
  can discard frames early.

*/

// framing constants
var FRAME_METHOD = constants.FRAME_METHOD,
FRAME_HEARTBEAT = constants.FRAME_HEARTBEAT,
FRAME_HEADER = constants.FRAME_HEADER,
FRAME_BODY = constants.FRAME_BODY,
FRAME_END = constants.FRAME_END;


////////////////////////////////////////////////////////////////////////////////
// TODO: For some reason browserify wasn't able to find Buffer, downstream
// within these functions. Defining them here instead. Obviously, this is no
// bueno.
var ints = require('buffer-more-ints');
function write_int(buf, value, offset, size, bigendian) {
  switch (size) {
  case 1:
    buf.writeUInt8(value, offset);
    break;
  case 2:
    (bigendian) ?
      buf.writeUInt16BE(value, offset) :
      buf.writeUInt16LE(value, offset);
    break;
  case 4:
    (bigendian) ?
      buf.writeUInt32BE(value, offset) :
      buf.writeUInt32LE(value, offset);
    break;
  case 8:
    (bigendian) ?
      ints.writeUInt64BE(buf, value, offset) :
      ints.writeUInt64LE(buf, value, offset);
    break;
  default:
    throw new Error("integer size * unit must be 8, 16, 32 or 64");
  }
  return size;
}

function bodyConsFIXME(bindings) {
  var buffersize = 8;
  buffersize += (bindings['size'] * 8) / 8;
  var buf = new Buffer(buffersize);
  var offset = 0;
  var val, size;
  // {"value":3,"type":"integer","bigendian":true,"unit":1,"size":8}
  val = 3
  size = 1;
  write_int(buf, val, offset, size, true);
  offset += size;
  // {"name":"channel","type":"integer","bigendian":true,"unit":1,"size":16}
  val = bindings['channel'];
  size = 2;
  write_int(buf, val, offset, size, true);
  offset += size;
  // {"name":"size","type":"integer","bigendian":true,"unit":1,"size":32}
  val = bindings['size'];
  size = 4;
  write_int(buf, val, offset, size, true);
  offset += size;
  // {"name":"payload","type":"binary","unit":8,"size":"size"}
  val = bindings['payload'];
  size = (bindings['size'] * 8) / 8;
  val.copy(buf, offset, 0, size);
  offset += size;
  // {"value":206,"type":"integer","bigendian":true,"unit":1,"size":8}
  val = 206
  size = 1;
  write_int(buf, val, offset, size, true);
  offset += size;
  return buf;
}
////////////////////////////////////////////////////////////////////////////////


// var bodyCons = Bits.builder(FRAME_BODY,
//   'channel:16, size:32, payload:size/binary', FRAME_END);


// %%% TESTME possibly better to cons the first bit and write the
// second directly, in the absence of IO lists
module.exports.makeBodyFrame = function(channel, payload) {
  return bodyConsFIXME({  // FIXME: Hacked the OG bodyCons - see above
    channel: channel,
    size: payload.length,
    payload: payload
  });
};

var frameHeaderPattern = Bits.matcher('type:8', 'channel:16',
                                      'size:32', 'rest/binary');

function parseFrame(bin, max) {
  var fh = frameHeaderPattern(bin);
  if (fh) {
    var size = fh.size, rest = fh.rest;
    if (size > max) {
      throw new Error('Frame size exceeds frame max');
    }
    else if (rest.length > size) {
      if (rest[size] !== FRAME_END)
        throw new Error('Invalid frame');

      return {
        type: fh.type,
        channel: fh.channel,
        size: size,
        payload: rest.slice(0, size),
        rest: rest.slice(size + 1)
      };
    }
  }
  return false;
}

module.exports.parseFrame = parseFrame;

var headerPattern = Bits.matcher('class:16',
                                 '_weight:16',
                                 'size:64',
                                 'flagsAndfields/binary');

var methodPattern = Bits.matcher('id:32, args/binary');

var HEARTBEAT = {channel: 0};

module.exports.decodeFrame = function(frame) {
  var payload = frame.payload;
  switch (frame.type) {
  case FRAME_METHOD:
    var idAndArgs = methodPattern(payload);
    var id = idAndArgs.id;
    var fields = decode(id, idAndArgs.args);
    return {id: id, channel: frame.channel, fields: fields};
  case FRAME_HEADER:
    var parts = headerPattern(payload);
    var id = parts['class'];
    var fields = decode(id, parts.flagsAndfields);
    return {id: id, channel: frame.channel,
            size: parts.size, fields: fields};
  case FRAME_BODY:
    return {channel: frame.channel, content: frame.payload};
  case FRAME_HEARTBEAT:
    return HEARTBEAT;
  default:
    throw new Error('Unknown frame type ' + frame.type);
  }
}

// encoded heartbeat
module.exports.HEARTBEAT_BUF = new Buffer([constants.FRAME_HEARTBEAT,
                                           0, 0, 0, 0, // size = 0
                                           0, 0, // channel = 0
                                           constants.FRAME_END]);

module.exports.HEARTBEAT = HEARTBEAT;

}).call(this,require("buffer").Buffer)
},{"./defs":7,"bitsyntax":13,"buffer":24,"buffer-more-ints":21}],11:[function(require,module,exports){
//
//
//

// Heartbeats. In AMQP both clients and servers may expect a heartbeat
// frame if there is no activity on the connection for a negotiated
// period of time. If there's no activity for two such intervals, the
// server or client is allowed to close the connection on the
// presumption that the other party is dead.
//
// The client has two jobs here: the first is to send a heartbeat
// frame if it's not sent any frames for a while, so that the server
// doesn't think it's dead; the second is to check periodically that
// it's seen activity from the server, and to advise if there doesn't
// appear to have been any for over two intervals.
//
// Node.JS timers are a bit unreliable, in that they endeavour only to
// fire at some indeterminate point *after* the given time (rather
// gives the lie to 'realtime', dunnit). Because the scheduler is just
// an event loop, it's quite easy to delay timers indefinitely by
// reacting to some I/O with a lot of computation.
//
// To mitigate this I need a bit of creative interpretation:
//
//  - I'll schedule a server activity check for every `interval`, and
//    check just how much time has passed. It will overshoot by at
//    least a small margin; modulo missing timer deadlines, it'll
//    notice between two and three intervals after activity actually
//    stops (otherwise, at some point after two intervals).
//
//  - Every `interval / 2` I'll check that we've sent something since
//    the last check, and if not, send a heartbeat frame. If we're
//    really too busy to even run the check for two whole heartbeat
//    intervals, there must be a lot of I (but not O, at least not on
//    the connection), or computation, in which case perhaps it's best
//    the server cuts us off anyway. Why `interval / 2`? Because the
//    edge case is that the client sent a frame just after a
//    heartbeat, which would mean I only send one after almost two
//    intervals. (NB a heartbeat counts as a send, so it'll be checked
//    at least twice before sending another)
//
// This design is based largely on RabbitMQ's heartbeating:
// https://github.com/rabbitmq/rabbitmq-common/blob/master/src/rabbit_heartbeat.erl

// %% Yes, I could apply the same 'actually passage of time' thing to
// %% send as well as to recv.

'use strict';

var inherits = require('util').inherits;
var EventEmitter = require('events').EventEmitter;

// Exported so that we can mess with it in tests
module.exports.UNITS_TO_MS = 1000;

function Heart(interval, checkSend, checkRecv) {
  EventEmitter.call(this);
  this.interval = interval;

  var intervalMs = interval * module.exports.UNITS_TO_MS;
  // Function#bind is my new best friend
  var beat = this.emit.bind(this, 'beat');
  var timeout = this.emit.bind(this, 'timeout');

  this.sendTimer = setInterval(
    this.runHeartbeat.bind(this, checkSend, beat), intervalMs / 2);

  // A timeout occurs if I see nothing for *two consecutive* intervals
  var recvMissed = 0;
  function missedTwo() {
    if (!checkRecv()) return (++recvMissed < 2);
    else { recvMissed = 0; return true; }
  }
  this.recvTimer = setInterval(
    this.runHeartbeat.bind(this, missedTwo, timeout), intervalMs);
}
inherits(Heart, EventEmitter);

module.exports.Heart = Heart;

Heart.prototype.clear = function() {
  clearInterval(this.sendTimer);
  clearInterval(this.recvTimer);
};

Heart.prototype.runHeartbeat = function(check, fail) {
  // Have we seen activity?
  if (!check()) fail();
};

},{"events":25,"util":31}],12:[function(require,module,exports){
(function (Buffer){
/* global Uint8Array, FileReader, Blob */

'use strict';
var EventEmitter = require('events').EventEmitter;
var inherits = require('util').inherits;
var defs = require('./defs');
var FRAME_OVERHEAD = defs.FRAME_OVERHEAD;
var constants = defs.constants;
var encodeMethod = defs.encodeMethod;
var encodeProperties = defs.encodeProperties;
var frame = require('./frame');
var HEARTBEAT = frame.HEARTBEAT;
var makeBodyFrame = frame.makeBodyFrame;
var parseFrame = frame.parseFrame;
var decodeFrame = frame.decodeFrame;
var Heart = require('./heartbeat').Heart;
var methodName = require('./format').methodName;
var closeMsg = require('./format').closeMessage;
var inspect = require('./format').inspect;
var BitSet = require('./bitset').BitSet;
var fmt = require('util').format;
var IllegalOperationError = require('./error').IllegalOperationError;
var stackCapture = require('./error').stackCapture;

var SINGLE_CHUNK_THRESHOLD = 2048;

function WebSocketConnection(webSocket) {
  EventEmitter.call(this);
  this.webSocket = webSocket;
  this.rest = new Buffer(0);
  this.frameMax = constants.FRAME_MIN_SIZE;
  this.sentSinceLastCheck = false;
  this.recvSinceLastCheck = false;
  this.expectSocketClose = false;
  this.freeChannels = new BitSet();
  this.channels = [{
    channel: {
      accept: channel0(this)
    },
    webSocket: webSocket
  }];
}

inherits(WebSocketConnection, EventEmitter);

function invalidOp(msg, stack) {
  return function() {
    throw new IllegalOperationError(msg, stack);
  };
}

function invalidateSend(conn, msg, stack) {
  conn.sendMethod = conn.sendContent = conn.sendMessage = invalidOp(msg, stack);
}

function channel0(connection) {
  return function(f) {
    if(f.id === defs.ConnectionClose) {
      connection.sendMethod(0, defs.ConnectionCloseOk, {});
      var emsg = fmt('Connection closed: %s', closeMsg(f));
      var s = stackCapture(emsg);
      var e = new Error(emsg);
      e.code = f.fields.replyCode;
      if(isFatalError(e)) {
        connection.emit('error', e);
      }
      connection.toClosed(s, e);
    } else if(f.id === defs.ConnectionBlocked) {
      connection.emit('blocked', f.fields.reason);
    } else if(f.id === defs.ConnectionUnblocked) {
      connection.emit('unblocked');
    } else if(f !== HEARTBEAT) {
      connection.closeWithError(fmt('Unexpected frame on channel 0'),
        constants.UNEXPECTED_FRAME,
        new Error(fmt('Unexpected frame on channel 0: %s', inspect(f, false))));
    }
  };
}

var C = WebSocketConnection.prototype;

// This changed between versions, as did the codec, methods, etc. AMQP
// 0-9-1 is fairly similar to 0.8, but better, and nothing implements
// 0.8 that doesn't implement 0-9-1. In other words, it doesn't make
// much sense to generalise here.
C.sendProtocolHeader = function() {
  this.sendBytes(frame.PROTOCOL_HEADER);
};

//   The frighteningly complicated opening protocol (spec section 2.2.4):
//
//      Client -> Server
//
//        protocol header ->
//          <- start
//        start-ok ->
//      .. next two zero or more times ..
//          <- secure
//        secure-ok ->
//          <- tune
//        tune-ok ->
//        open ->
//          <- open-ok
//
// If I'm only supporting SASL's PLAIN mechanism (which I am for the time
// being), it gets a bit easier since the server won't in general send
// back a `secure`, it'll just send `tune` after the `start-ok`.
// (SASL PLAIN: http://tools.ietf.org/html/rfc4616)
C.open = function(allFields, openCallback0) {
  var self = this;
  var openCallback = openCallback0 || function() {};
  var tunedOptions = Object.create(allFields);

  var send = function(Method) {
    try {
      self.sendMethod(0, Method, tunedOptions);
    } catch(err) {
      openCallback(err);
    }
  };

  var negotiate = function(srv, desired) {
    return Math[(srv === 0 || desired === 0) ? 'max' : 'min'](srv, desired);
  };

  var messageToBuffer = function(message, cb) {
    if(!(message.data instanceof Blob)) {
      return console.log('Message is not binary: ', message);
    }
    var reader = new FileReader();
    reader.onloadend = function() {
      message = Buffer.from(new Uint8Array(reader.result));
      var i = 0;
      var j;
      while((j = message.indexOf(206, i)+1) !== 0) {
        var frame = self.recvFrame(message.slice(i,j));
        i = j;
        cb(null, frame);
      }
    };
    reader.readAsArrayBuffer(message.data);
  };

  var start0 = function(rawMessage) {
    messageToBuffer(rawMessage, function(err, frame) {
      if(frame.channel !== 0) {
        openCallback(new Error(fmt('Frame on channel != 0 during handshake: %s',
          inspect(frame, false))));
      } else if(frame.id !== defs.ConnectionStart) {
        openCallback(new Error(fmt('Expected %s; got %s',
          methodName(defs.ConnectionStart), inspect(frame, false))));
      } else {
        var mechanisms = frame.fields.mechanisms.toString().split(' ');
        if(mechanisms.indexOf(allFields.mechanism) < 0) {
          return openCallback(new Error(fmt(
            'SASL mechanism %s is not provided by the server',
              allFields.mechanism)));
        }
        self.webSocket.removeEventListener('message', start0);
        self.webSocket.addEventListener('message', start1);
        send(defs.ConnectionStartOk);
      }
    });
  };

  var start1 = function(rawMessage) {
    messageToBuffer(rawMessage, function(err, frame) {
      switch(frame.id) {
        case defs.ConnectionSecure:
          openCallback(
            new Error('Wasn\'t expecting to have to go through secure'));
          break;
        case defs.ConnectionClose:
          openCallback(new Error(fmt('Handshake terminated by server: %s',
            closeMsg(frame))));
          break;
        case defs.ConnectionTune:
          var fields = frame.fields;
          tunedOptions.frameMax = negotiate(fields.frameMax,
            allFields.frameMax);
          tunedOptions.channelMax = negotiate(fields.channelMax,
            allFields.channelMax);
          tunedOptions.heartbeat = negotiate(fields.heartbeat,
            allFields.heartbeat);
          self.webSocket.removeEventListener('message', start1);
          self.webSocket.addEventListener('message', start2);
          send(defs.ConnectionTuneOk);
          send(defs.ConnectionOpen);
          break;
        default:
          openCallback(new Error(fmt('Expected connection.secure, ' +
            'connection.close, or connection.tune during handshake; got %s',
              inspect(frame, false))));
          break;
      }
    });
  };

  var start2 = function(rawMessage) {
    messageToBuffer(rawMessage, function(err, frame) {
      if(frame.id !== defs.ConnectionOpenOk) {
        return openCallback(new Error(fmt('Expected %s; got %s',
          methodName(defs.ConnectionStart), inspect(frame, false))));
      }
      self.channelMax = tunedOptions.channelMax || 0xffff;
      self.frameMax = tunedOptions.frameMax || 0xffffffff;
      self.heartbeat = tunedOptions.heartbeat;
      self.heartbeater = self.startHeartbeater();
      self.accept = function(frame) {
        var rec = this.channels[frame.channel];
        if(rec) {
          return rec.channel.accept(frame);
        } else {
          this.closeWithError(fmt('Frame on unknown channel %d', frame.channel),
            constants.CHANNEL_ERROR,
            new Error(fmt('Frame on unknown channel: %s',
              inspect(frame, false)))
          );
        }
      }
      self.webSocket.removeEventListener('message', start2);
      self.webSocket.addEventListener('message', function(rawMessage) {
        messageToBuffer(rawMessage, function(err, frame) {
          var rec = self.channels[frame.channel];
          if(rec) {
            return rec.channel.accept(frame);
          }
        });
      });
      openCallback(null, true);
    });
  };

  this.webSocket.addEventListener('message', start0);
  this.sendProtocolHeader();
};

// Closing things: AMQP has a closing handshake that applies to
// closing both connects and channels. As the initiating party, I send
// Close, then ignore all frames until I see either CloseOK --
// which signifies that the other party has seen the Close and shut
// the connection or channel down, so it's fine to free resources; or
// Close, which means the other party also wanted to close the
// whatever, and I should send CloseOk so it can free resources,
// then go back to waiting for the CloseOk. If I receive a Close
// out of the blue, I should throw away any unsent frames (they will
// be ignored anyway) and send CloseOk, then clean up resources. In
// general, Close out of the blue signals an error (or a forced
// closure, which may as well be an error).
//
//  RUNNING [1] --- send Close ---> Closing [2] ---> recv Close --+
//     |                               |                         [3]
//     |                               +------ send CloseOk ------+
//  recv Close                   recv CloseOk
//     |                               |
//     V                               V
//  Ended [4] ---- send CloseOk ---> Closed [5]
//
// [1] All frames accepted; getting a Close frame from the server
// moves to Ended; client may initiate a close by sending Close
// itself.
// [2] Client has initiated a close; only CloseOk or (simulataneously
// sent) Close is accepted.
// [3] Simultaneous close
// [4] Server won't send any more frames; accept no more frames, send
// CloseOk.
// [5] Fully closed, client will send no more, server will send no
// more. Signal 'close' or 'error'.
//
// There are two signalling mechanisms used in the API. The first is
// that calling `close` will return a promise, that will either
// resolve once the connection or channel is cleanly shut down, or
// will reject if the shutdown times out.
//
// The second is the 'close' and 'error' events. These are
// emitted as above. The events will fire *before* promises are
// resolved.

// Close the connection without even giving a reason. Typical.
C.close = function(closeCallback) {
  var k = closeCallback && function() { closeCallback(null); };
  this.closeBecause('Cheers, thanks', constants.REPLY_SUCCESS, k);
};

C.closeBecause = function(reason, code, k) {
  this.sendMethod(0, defs.ConnectionClose, {
    replyText: reason,
    replyCode: code,
    methodId: 0, classId: 0
  });
  var s = stackCapture('closeBecause called: ' + reason);
  this.toClosing(s, k);
};

C.closeWithError = function(reason, code, error) {
  this.emit('error', error);
  this.closeBecause(reason, code);
};

C.onSocketError = function(err) {
  if(!this.expectSocketClose) {
    this.expectSocketClose = true;
    this.emit('error', err);
    var s = stackCapture('Socket error');
    this.toClosed(s, err);
  }
};

C.toClosing = function(capturedStack, k) {
  var send = this.sendMethod.bind(this);
  this.accept = function(f) {
    if(f.id === defs.ConnectionCloseOk) {
      if(k) k();
      var s = stackCapture('ConnectionCloseOk received');
      this.toClosed(s, undefined);
    } else if(f.id === defs.ConnectionClose) {
      send(0, defs.ConnectionCloseOk, {});
    }
  };
  invalidateSend(this, 'Connection closing', capturedStack);
};

C._closeChannels = function(capturedStack) {
  for (var i = 1; i < this.channels.length; i++) {
    var ch = this.channels[i];
    if(ch !== null) {
      ch.channel.toClosed(capturedStack); // %%% or with an error? not clear
    }
  }
};

C.toClosed = function(capturedStack, maybeErr) {
  this._closeChannels(capturedStack);
  var info = fmt('Connection closed (%s)', maybeErr ?
    maybeErr.toString() : 'by client');
  invalidateSend(this, info, capturedStack);
  this.accept = invalidOp(info, capturedStack);
  this.close = function(cb) {
    cb && cb(new IllegalOperationError(info, capturedStack));
  };
  if(this.heartbeater) {
    this.heartbeater.clear();
  }
  this.expectSocketClose = true;
  this.webSocket.close();
  this.emit('close', maybeErr);
};

C.startHeartbeater = function() {
  if(this.heartbeat === 0) return null;
  else {
    var self = this;
    var hb = new Heart(this.heartbeat, this.checkSend.bind(this),
      this.checkRecv.bind(this));
    hb.on('timeout', function() {
      var hberr = new Error('Heartbeat timeout');
      var s = stackCapture('Heartbeat timeout');
      self.toClosed(s, hberr);
    });
    hb.on('beat', function() {
      self.sendHeartbeat();
    });
    return hb;
  }
};

C.freshChannel = function(channel) {
  var self = this;
  var next = this.freeChannels.nextClearBit(1);
  if(next < 0 || next > this.channelMax) {
    throw new Error('No channels left to allocate');
  }
  this.freeChannels.set(next);
  this.channels[next] = {
    channel: channel,
    webSocket: self.webSocket
  };
  return next;
};

C.releaseChannel = function(channel) {
  this.freeChannels.clear(channel);
  this.channels[channel] = null;
};

C.checkSend = function() {
  var check = this.sentSinceLastCheck;
  this.sentSinceLastCheck = false;
  return check;
}

C.checkRecv = function() {
  var check = this.recvSinceLastCheck;
  this.recvSinceLastCheck = false;
  return check;
}

C.sendBytes = function(bytes) {
  this.sentSinceLastCheck = true;
  this.webSocket.send(bytes);
};

C.sendHeartbeat = function() {
  return this.sendBytes(frame.HEARTBEAT_BUF);
};

C.sendMethod = function(channel, Method, fields) {
  var frame = encodeMethod(Method, channel, fields);
  this.sentSinceLastCheck = true;
  return this.channels[channel].webSocket.send(frame);
};

C.sendMessage = function(channel, Method, fields, Properties, props, content) {
  if(!Buffer.isBuffer(content)) {
    throw new TypeError('content is not a buffer');
  }
  var mframe = encodeMethod(Method, channel, fields);
  var pframe = encodeProperties(Properties, channel, content.length, props);
  var webSocket = this.channels[channel].webSocket;
  this.sentSinceLastCheck = true;
  var methodHeaderLen = mframe.length + pframe.length;
  var bodyLen = (content.length > 0) ? content.length + FRAME_OVERHEAD : 0;
  var allLen = methodHeaderLen + bodyLen;
  var offset;
  if(allLen < SINGLE_CHUNK_THRESHOLD) {
    var all = new Buffer(allLen);
    offset = mframe.copy(all, 0);
    offset += pframe.copy(all, offset);
    if(bodyLen > 0) {
      makeBodyFrame(channel, content).copy(all, offset);
    }
    return webSocket.send(all);
  } else {
    if(methodHeaderLen < SINGLE_CHUNK_THRESHOLD) {
      var both = new Buffer(methodHeaderLen);
      offset = mframe.copy(both, 0);
      pframe.copy(both, offset);
      webSocket.send(both);
    } else {
      webSocket.send(mframe);
      webSocket.send(pframe);
    }
    return this.sendContent(channel, content);
  }
};

C.sendContent = function(channel, body) {
  if(!Buffer.isBuffer(body)) {
    throw new TypeError(fmt('Expected buffer; got %s', body));
  }
  var writeResult = true;
  var webSocket = this.channels[channel].webSocket;
  var maxBody = this.frameMax - FRAME_OVERHEAD;
  for(var offset=0; offset<body.length; offset+=maxBody) {
    var end = offset + maxBody;
    var slice = (end > body.length) ? body.slice(offset) :
      body.slice(offset, end);
    var bodyFrame = makeBodyFrame(channel, slice);
    webSocket.send(bodyFrame);
    writeResult = true;
  }
  this.sentSinceLastCheck = true;
  return writeResult;
};

C.recvFrame = function(incoming) {
  var self = this;
  var frame = parseFrame(this.rest, this.frameMax);
  if(!frame) {
    if(!incoming) {
      return false;
    } else {
      self.recvSinceLastCheck = true;
      self.rest = Buffer.concat([self.rest, incoming]);
      return self.recvFrame();
    }
  } else {
    this.rest = frame.rest;
    return decodeFrame(frame);
  }
};

function isFatalError(error) {
  switch(error && error.code) {
    case defs.constants.CONNECTION_FORCED:
    case defs.constants.REPLY_SUCCESS:
      return false;
    default:
      return true;
  }
}

module.exports.WebSocketConnection = WebSocketConnection;
module.exports.isFatalError = isFatalError;

}).call(this,require("buffer").Buffer)
},{"./bitset":3,"./defs":7,"./error":8,"./format":9,"./frame":10,"./heartbeat":11,"buffer":24,"events":25,"util":31}],13:[function(require,module,exports){
'use strict';

module.exports.parse = require('./lib/parse').parse;
module.exports.match = require('./lib/interp').match;
module.exports.build = require('./lib/constructor').build;
module.exports.write = require('./lib/constructor').write;

module.exports.matcher = module.exports.compile =
  require('./lib/compile').compile;
module.exports.builder = require('./lib/compile').compile_builder;

},{"./lib/compile":14,"./lib/constructor":15,"./lib/interp":16,"./lib/parse":17}],14:[function(require,module,exports){
(function (Buffer){
// Compile patterns to recognisers and constructors

'use strict';

require('buffer-more-ints');
var $ = require('util').format;

var parse = require('./parse').parse;
var interp = require('./interp'),
  parse_int = interp.parse_int,
  parse_float = interp.parse_float;
var construct = require('./constructor'),
  write_int = construct.write_int,
  write_float = construct.write_float;

var lines = [];
function $start() {
  lines = [];
}
function $line(/* format , args */) {
  lines.push($.apply(null, arguments));
}
function $result() {
  return lines.join('\n');
}

function bits_expr(segment) {
  if (typeof segment.size === 'string') {
    return $('%s * %d', var_name(segment.size), segment.unit);
  }
  else {
    return (segment.size * segment.unit).toString();
  }
}

function get_number(segment) {
  $line('bits = %s;\n', bits_expr(segment));
  var parser = (segment.type === 'integer') ?
    'parse_int' : 'parse_float';
  var be = segment.bigendian, sg = segment.signed;
  $line("byteoffset = offset / 8; offset += bits");
  $line("if (offset > binsize) { return false; }");
  $line("else { result = %s(bin, byteoffset, bits / 8, %s, %s); }",
        parser, be, sg);
}

function get_binary(segment) {
  $line("byteoffset = offset / 8;");
  if (segment.size === true) {
    $line("offset = binsize;");
    $line("result = bin.slice(byteoffset);");
  }
  else {
    $line("bits = %s;", bits_expr(segment));
    $line("offset += bits;");
    $line("if (offset > binsize) { return false; }");
    $line("else { result = bin.slice(byteoffset,",
          "byteoffset + bits / 8); }");
  }
}

function get_string(segment) {
  $line("byteoffset = offset / 8;");
  var strlen = segment.value.length;
  var strlenbits = strlen * 8;
  $line("offset += %d;", strlenbits);
  $line("if (offset > binsize) { return false; }");
  $line("else { result = bin.toString(byteoffset,",
        $("byteoffset + %d); }", strlen));
}

function skip_bits(segment) {
  if (typeof segment.size === 'string') {
    // Damn. Have to look up the size.
    $line("var skipbits = %s * %d;",
          var_name(segment.size), segment.unit);
    $line("if (offset + skipbits > binsize) { return false; }");
    $line("else { offset += skipbits; }");
  }
  else if (segment.size === true) {
    $line("if (offset % 8 === 0) { offset = binsize; }");
    $line("else { return false; }");
  }
  else {
    var bits = segment.unit * segment.size;
    $line("if (offset + %d > binsize) { return false; }", bits);
    $line("else { offset += %d; }", bits);
  }
}

function match_seg(segment) {
  if (segment.name === '_') {
    skip_bits(segment);
  }
  else {
    var assign_result;
    switch (segment.type) {
    case 'integer':
    case 'float':
      get_number(segment);
      break;
    case 'binary':
      get_binary(segment);
      break;
    case 'string':
      get_string(segment);
      break;
    }
    $line("if (result === false) return false;");
    if (segment.name) {
      // variable is given a value in the environment
      $line("else if (%s !== undefined) {", var_name(segment.name));
      // .. and it is not the same as that matched
      $line("if (%s != result) return false;",
            var_name(segment.name));
      $line("}");
      // variable is free
      $line('else %s = result;', var_name(segment.name));
    }
    else {
      var repr = JSON.stringify(segment.value);
      $line("else if (result != %s) return false;", repr);
    }
  }
}

function var_name(name) {
  return  'var_' + name;
}

function variables(segments) {
  var names = {};
  for (var i = 0; i < segments.length; i++) {
    var name = segments[i].name;
    if (name && name !== '_') {
      names[name] = true;
    }
    name = segments[i].size;
    if (typeof name === 'string') {
      names[name] = true;
    }
  }
  return Object.keys(names);
}

function compile_pattern(segments) {
  $start();
  $line("return function(binary, env) {");
  $line("'use strict';");
  $line("var bin = binary, env = env || {};");
  $line("var offset = 0, binsize = bin.length * 8;");
  $line("var bits, result, byteoffset;");
  var varnames = variables(segments);
  for (var v = 0; v < varnames.length; v++) {
    var name = varnames[v];
    $line("var %s = env['%s'];", var_name(name), name);
  }

  var len = segments.length;
  for (var i = 0; i < len; i++) {
    var segment = segments[i];
    $line("// " + JSON.stringify(segment));
    match_seg(segment);
  }

  $line("if (offset == binsize) {");
  $line("return {");
  for (var v = 0; v < varnames.length; v++) {
    var name = varnames[v];
    $line("%s: %s,", name, var_name(name));
  }
  $line('};');
  $line('}'); // if offset == binsize
  $line("else return false;");
  $line("}"); // end function

  var fn = new Function('parse_int', 'parse_float', $result());
  return fn(parse_int, parse_float);
}


function write_seg(segment) {
  switch (segment.type) {
  case 'string':
    $line("offset += buf.write(%s, offset, 'utf8');",
          JSON.stringify(segment.value));
    break;
  case 'binary':
    $line("val = bindings['%s'];", segment.name);
    if (segment.size === true) {
      $line('size = val.length;');
    }
    else if (typeof segment.size === 'string') {
      $line("size = (bindings['%s'] * %d) / 8;",
            segment.size, segment.unit);
    }
    else {
      $line("size = %d;", (segment.size * segment.unit) / 8);
    }
    $line('val.copy(buf, offset, 0, size);');
    $line('offset += size;');
    break;
  case 'integer':
  case 'float':
    write_number(segment);
    break;
  }
}

function write_number(segment) {
  if (segment.name) {
    $line("val = bindings['%s'];", segment.name);
  }
  else {
    $line("val = %d", segment.value);
  }
  var writer = (segment.type === 'integer') ?
    'write_int' : 'write_float';
  if (typeof segment.size === 'string') {
    $line("size = (bindings['%s'] * %d) / 8;",
          segment.size, segment.unit);
  }
  else {
    $line('size = %d;', (segment.size * segment.unit) / 8);
  }
  $line('%s(buf, val, offset, size, %s);',
        writer, segment.bigendian);
  $line('offset += size;');
}

function size_of(segments) {
  var variable = [];
  var fixed = 0;

  for (var i = 0; i < segments.length; i++) {
    var segment = segments[i];
    if (typeof segment.size === 'string' ||
        segment.size === true) {
      variable.push(segment);
    }
    else if (segment.type === 'string') {
      fixed += Buffer.byteLength(segment.value);
    }
    else {
      fixed += (segment.size * segment.unit) / 8;
    }
  }

  $line('var buffersize = %d;', fixed);

  if (variable.length > 0) {
    for (var j = 0; j < variable.length; j++) {
      var segment = variable[j];
      if (segment.size === true) {
        $line("buffersize += bindings['%s'].length;", segment.name);
      }
      else {
        $line("buffersize += (bindings['%s'] * %d) / 8;",
              segment.size, segment.unit);
      }
    }
  }
}

function emit_write(segments) {
  $line('var val, size;');

  var len = segments.length;
  for (var i = 0; i < len; i++) {
    var segment = segments[i];
    $line('// %s', JSON.stringify(segment));
    write_seg(segment);
  }
}

function compile_ctor(segments) {
  $start();
  $line('return function(bindings) {');
  $line("'use strict';");
  size_of(segments);
  $line('var buf = new Buffer(buffersize);');
  $line('var offset = 0;');
  emit_write(segments);
  $line('return buf;');
  $line('}'); // end function

  return new Function('write_int', 'write_float',
                      $result())(write_int, write_float);
}

module.exports.compile_pattern = compile_pattern;
module.exports.compile = function() {
  var str = [].join.call(arguments, ',');
  var p = parse(str);
  return compile_pattern(p);
};
module.exports.compile_builder = function() {
  var str = [].join.call(arguments, ',');
  var p = parse(str);
  return compile_ctor(p);
};

}).call(this,require("buffer").Buffer)
},{"./constructor":15,"./interp":16,"./parse":17,"buffer":24,"buffer-more-ints":21,"util":31}],15:[function(require,module,exports){
(function (Buffer){
// -*- js-indent-level: 2 -*-

// Constructors given patterns

'use strict';

var ints = require('buffer-more-ints');

// Interpret the pattern, writing values into a buffer
function write(buf, offset, pattern, bindings) {
  for (var i=0, len = pattern.length; i < len; i++) {
    var segment = pattern[i];
    
    switch (segment.type) {
    case 'string':
      offset += buf.write(segment.value, offset, 'utf8');
      break;
    case 'binary':
      offset += writeBinary(segment, buf, offset, bindings);
      break;
    case 'integer':
      offset += writeInteger(segment, buf, offset, bindings);
      break;
    case 'float':
      offset += writeFloat(segment, buf, offset, bindings);
      break;
    }
  }
  return offset;
}

function build(pattern, bindings) {
  var bufsize = size_of(pattern, bindings);
  var buf = new Buffer(bufsize);
  write(buf, 0, pattern, bindings);
  return buf;
}

// In bytes
function size_of_segment(segment, bindings) {
  // size refers to a variable
  if (typeof segment.size === 'string') {
    return (bindings[segment.size] * segment.unit) / 8;
  }
  if (segment.type === 'string') {
    return Buffer.byteLength(segment.value, 'utf8');
  }
  if (segment.type === 'binary' && segment.size === true) {
    var val = bindings[segment.name];
    return val.length;
  }
  return (segment.size * segment.unit) / 8;
}

// size of the to-be-constructed binary, in bytes
function size_of(segments, bindings) {
  var size = 0;
  for (var i=0, len = segments.length; i < len; i++) {
    size += size_of_segment(segments[i], bindings);
  }
  return size;
}

function writeBinary(segment, buf, offset, bindings) {
  var bin = bindings[segment.name];
  var size = size_of_segment(segment, bindings);
  bin.copy(buf, offset, 0, size);
  return size;
}

// TODO in ff might use the noAssert argument to Buffer.write*() but
// need to check that it does the right thing wrt little-endian

function writeInteger(segment, buf, offset, bindings) {
  var value = (segment.name) ? bindings[segment.name] : segment.value;
  var size = size_of_segment(segment, bindings);
  return write_int(buf, value, offset, size, segment.bigendian);
}

function write_int(buf, value, offset, size, bigendian) {
  switch (size) {
  case 1:
    buf.writeUInt8(value, offset);
    break;
  case 2:
    (bigendian) ?
      buf.writeUInt16BE(value, offset) :
      buf.writeUInt16LE(value, offset);
    break;
  case 4:
    (bigendian) ?
      buf.writeUInt32BE(value, offset) :
      buf.writeUInt32LE(value, offset);
    break;
  case 8:
    (bigendian) ?
      ints.writeUInt64BE(buf, value, offset) :
      ints.writeUInt64LE(buf, value, offset);
    break;
  default:
    throw new Error("integer size * unit must be 8, 16, 32 or 64");
  }
  return size;
}

function writeFloat(segment, buf, offset, bindings) {
  var value = (segment.name) ? bindings[segment.name] : segment.value;
  var size = size_of_segment(segment, bindings);
  return write_float(buf, value, offset, size, segment.bigendian);
}

function write_float(buf, value, offset, size, bigendian) {
  if (size === 4) {
    (bigendian) ?
      buf.writeFloatBE(value, offset) :
      buf.writeFloatLE(value, offset);
  }
  else if (size === 8) {
    (bigendian) ?
      buf.writeDoubleBE(value, offset) :
      buf.writeDoubleLE(value, offset);
  }
  else {
    throw new Error("float size * unit must be 32 or 64");
  }
  return size;
}

var parse = require('./parse').parse;

module.exports.write = write;
module.exports.build = build;
module.exports.write_int = write_int;
module.exports.write_float = write_float;

module.exports.builder = function(pstr) {
  pstr = (arguments.length > 1) ? [].join.call(arguments, ',') : pstr;
  var pattern = parse(pstr);
  return function(vars) {
    return build(pattern, vars);
  };
};

}).call(this,require("buffer").Buffer)
},{"./parse":17,"buffer":24,"buffer-more-ints":21}],16:[function(require,module,exports){
(function (process){
// -*- js-indent: 2 -*-
// Interpreter for bit syntax AST.
// Grammar:
//
// pattern   := segment ("," segment)*
// segment   := (value | var) (":" size)? ("/" specifier ("-" specifier)*)? | string
// var       := "_" | identifier
// size      := integer | var
// specifier := "little" | "big" | "signed" | "unsigned" | "unit" ":" 0..256 | type
// type      := "integer" | "binary" | "float"
//
// where integer has the obvious meaning, and identifier is anything
// other than "_" that fits the JavaScript identifier specification.
//

// We'll use an object to represent each segment, and an array of
// segments for a pattern. We won't try to optimise for groups of
// patterns; we'll just step through each to see if it works. We rely
// a hypothetical prior step to check that it's a valid pattern.

// ? compile to intermediate instructions ?

// A segment looks like
// {
//    type: string, // 'string' is special case
//    size: integer | true, // true means 'all remaining'
//    name: string | null, // (may be '_')
//    value: value | null, // either name OR value
//    unit: integer,
//    signed: boolean,
//    bigendian: boolean
// }

'use strict';

var ints = require('buffer-more-ints');

var debug = (process.env.DEBUG) ?
  function(s) { console.log(s); } : function () {};

function parse_int(bin, off, sizeInBytes, bigendian, signed) {
  switch (sizeInBytes) {
  case 1:
    return (signed) ? bin.readInt8(off) : bin.readUInt8(off);
  case 2:
    return (bigendian) ?
      (signed) ? bin.readInt16BE(off) : bin.readUInt16BE(off) :
      (signed) ? bin.readInt16LE(off) : bin.readUInt16LE(off);
  case 4:
    return (bigendian) ?
      (signed) ? bin.readInt32BE(off) : bin.readUInt32BE(off) :
      (signed) ? bin.readInt32LE(off) : bin.readUInt32LE(off);
  case 8:
    return (bigendian) ?
      ((signed) ? ints.readInt64BE : ints.readUInt64BE)(bin, off) :
      ((signed) ? ints.readInt64LE : ints.readUInt64LE)(bin, off);
  default:
    throw "Integers must be 8-, 16-, 32- or 64-bit";
  }
}

function parse_float(bin, off, sizeInBytes, bigendian) {
  switch (sizeInBytes) {
  case 4:
    return (bigendian) ? bin.readFloatBE(off) : bin.readFloatLE(off);
  case 8:
    return (bigendian) ? bin.readDoubleBE(off) : bin.readDoubleLE(off);
  default:
    throw "Floats must be 32- or 64-bit";
  }
}

function size_of(segment, bound) {
  var size = segment.size;
  if (typeof size === 'string') {
    return bound[size];
  }
  else {
    return size;
  }
}

function new_scope(env) {
  function scope() {};
  scope.prototype = env;
  return new scope();
}

function bindings(scope) {
  var s = {};
  for (var k in scope) {
    if (scope.hasOwnProperty(k)) {
      s[k] = scope[k];
    }
  }
  return s;
}

function match(pattern, binary, boundvars) {
  var offset = 0, vars = new_scope(boundvars);
  var binsize = binary.length * 8;

  function skip_bits(segment) {
    debug("skip bits"); debug(segment);
    var size = size_of(segment, vars);
    if (size === true) {
      if (offset % 8 === 0) {
        offset = binsize;
        return true;
      }
      else {
        return false;
      }
    }

    var bits = segment.unit * size;
    if (offset + bits > binsize) {
      return false;
    }
    else {
      offset += bits;
    }
  }

  function get_integer(segment) {
    debug("get_integer"); debug(segment);
    // let's do only multiples of eight bits for now
    var unit = segment.unit, size = size_of(segment, vars);
    var bitsize = size * unit;
    var byteoffset = offset / 8; // NB assumes aligned
    offset += bitsize;
    if (bitsize % 8 > 0 || (offset > binsize)) {
      return false;
    }
    else {
      return parse_int(binary, byteoffset, bitsize / 8,
                       segment.bigendian, segment.signed);
    }
  }

  function get_float(segment) {
    debug("get_float"); debug(segment);
    var unit = segment.unit; var size = size_of(segment, vars);
    var bitsize = size * unit;
    var byteoffset = offset / 8; // assume aligned
    offset += bitsize;
    if (offset > binsize) {
      return false;
    }
    else {
      return parse_float(binary, byteoffset,
                         bitsize / 8, segment.bigendian);
    }
  }

  function get_binary(segment) {
    debug("get_binary"); debug(segment);
    var unit = segment.unit, size = size_of(segment, vars);
    var byteoffset = offset / 8; // NB alignment

    if (size === true) {
      offset = binsize;
      return binary.slice(byteoffset);
    }
    else {
      var bitsize = size * unit;
      if (bitsize % 8 > 0 || (offset + bitsize) > binsize) {
        return false;
      }
      else {
        offset += bitsize;
        return binary.slice(byteoffset, byteoffset + bitsize / 8);
      }
    }
  }

  function get_string(segment) {
    debug("get_string"); debug(segment);
    var len = segment.value.length;
    var byteoffset = offset / 8;

    offset += len * 8;
    if (offset > binsize) {
      return false;
    }
    // FIXME bytes vs UTF8 characters
    return binary.slice(byteoffset, byteoffset + len).toString('utf8');
  }

  var patternlen = pattern.length;
  for (var i = 0;  i < patternlen; i++) {
    var segment = pattern[i];
    var result = false;
    if (segment.name === '_') {
      result = skip_bits(segment);
    }
    else {
      switch (segment.type) {
      case 'string':
        result = get_string(segment);
        break;
      case 'integer':
        result = get_integer(segment);
        break;
      case 'float':
        result = get_float(segment);
        break;
      case 'binary':
        result = get_binary(segment);
        break;
      }

      if (result === false) {
        return false;
      }
      else if (segment.name) {
        vars[segment.name] = result;
      }
      else if (segment.value != result) {
        return false;
      }
    }
  }
  if (offset == binsize) {
    return bindings(vars);
  }
  else {
    return false;
  }
}

module.exports.match = match;
module.exports.parse_int = parse_int;
module.exports.parse_float = parse_float;

}).call(this,require('_process'))
},{"_process":28,"buffer-more-ints":21}],17:[function(require,module,exports){
// Parse patterns in string form into the form we use for interpreting
// (and later, for compiling).

'use strict';

var ast = require('./pattern');
var parser = require('./parser');

function parse_pattern(string) {
  var segments = parser.parse(string);
  for (var i=0, len = segments.length; i < len; i++) {
    var s = segments[i];
    if (s.string != undefined) {
      segments[i] = ast.string(s.string);
    }
    else if (s.value != undefined) {
      segments[i] = ast.value(s.value, s.size, s.specifiers);
    }
    else if (s.name != undefined) {
      segments[i] = ast.variable(s.name, s.size, s.specifiers);
    }
    else {
      throw "Unknown segment " + s;
    }
  }
  return segments;
}

module.exports.parse = function() {
  var str = [].join.call(arguments, ',');
  return parse_pattern(str);
};

},{"./parser":18,"./pattern":19}],18:[function(require,module,exports){
module.exports = (function(){
  /*
   * Generated by PEG.js 0.7.0.
   *
   * http://pegjs.majda.cz/
   */
  
  function quote(s) {
    /*
     * ECMA-262, 5th ed., 7.8.4: All characters may appear literally in a
     * string literal except for the closing quote character, backslash,
     * carriage return, line separator, paragraph separator, and line feed.
     * Any character may appear in the form of an escape sequence.
     *
     * For portability, we also escape escape all control and non-ASCII
     * characters. Note that "\0" and "\v" escape sequences are not used
     * because JSHint does not like the first and IE the second.
     */
     return '"' + s
      .replace(/\\/g, '\\\\')  // backslash
      .replace(/"/g, '\\"')    // closing quote character
      .replace(/\x08/g, '\\b') // backspace
      .replace(/\t/g, '\\t')   // horizontal tab
      .replace(/\n/g, '\\n')   // line feed
      .replace(/\f/g, '\\f')   // form feed
      .replace(/\r/g, '\\r')   // carriage return
      .replace(/[\x00-\x07\x0B\x0E-\x1F\x80-\uFFFF]/g, escape)
      + '"';
  }
  
  var result = {
    /*
     * Parses the input with a generated parser. If the parsing is successfull,
     * returns a value explicitly or implicitly specified by the grammar from
     * which the parser was generated (see |PEG.buildParser|). If the parsing is
     * unsuccessful, throws |PEG.parser.SyntaxError| describing the error.
     */
    parse: function(input, startRule) {
      var parseFunctions = {
        "start": parse_start,
        "segmentTail": parse_segmentTail,
        "segment": parse_segment,
        "string": parse_string,
        "chars": parse_chars,
        "char": parse_char,
        "hexDigit": parse_hexDigit,
        "identifier": parse_identifier,
        "number": parse_number,
        "size": parse_size,
        "specifierList": parse_specifierList,
        "specifierTail": parse_specifierTail,
        "specifier": parse_specifier,
        "unit": parse_unit,
        "ws": parse_ws
      };
      
      if (startRule !== undefined) {
        if (parseFunctions[startRule] === undefined) {
          throw new Error("Invalid rule name: " + quote(startRule) + ".");
        }
      } else {
        startRule = "start";
      }
      
      var pos = 0;
      var reportFailures = 0;
      var rightmostFailuresPos = 0;
      var rightmostFailuresExpected = [];
      
      function padLeft(input, padding, length) {
        var result = input;
        
        var padLength = length - input.length;
        for (var i = 0; i < padLength; i++) {
          result = padding + result;
        }
        
        return result;
      }
      
      function escape(ch) {
        var charCode = ch.charCodeAt(0);
        var escapeChar;
        var length;
        
        if (charCode <= 0xFF) {
          escapeChar = 'x';
          length = 2;
        } else {
          escapeChar = 'u';
          length = 4;
        }
        
        return '\\' + escapeChar + padLeft(charCode.toString(16).toUpperCase(), '0', length);
      }
      
      function matchFailed(failure) {
        if (pos < rightmostFailuresPos) {
          return;
        }
        
        if (pos > rightmostFailuresPos) {
          rightmostFailuresPos = pos;
          rightmostFailuresExpected = [];
        }
        
        rightmostFailuresExpected.push(failure);
      }
      
      function parse_start() {
        var result0, result1, result2, result3;
        var pos0, pos1;
        
        pos0 = pos;
        pos1 = pos;
        result0 = parse_ws();
        if (result0 !== null) {
          result1 = parse_segment();
          if (result1 !== null) {
            result2 = [];
            result3 = parse_segmentTail();
            while (result3 !== null) {
              result2.push(result3);
              result3 = parse_segmentTail();
            }
            if (result2 !== null) {
              result0 = [result0, result1, result2];
            } else {
              result0 = null;
              pos = pos1;
            }
          } else {
            result0 = null;
            pos = pos1;
          }
        } else {
          result0 = null;
          pos = pos1;
        }
        if (result0 !== null) {
          result0 = (function(offset, head, tail) { tail.unshift(head); return tail; })(pos0, result0[1], result0[2]);
        }
        if (result0 === null) {
          pos = pos0;
        }
        return result0;
      }
      
      function parse_segmentTail() {
        var result0, result1, result2, result3;
        var pos0, pos1;
        
        pos0 = pos;
        pos1 = pos;
        result0 = parse_ws();
        if (result0 !== null) {
          if (input.charCodeAt(pos) === 44) {
            result1 = ",";
            pos++;
          } else {
            result1 = null;
            if (reportFailures === 0) {
              matchFailed("\",\"");
            }
          }
          if (result1 !== null) {
            result2 = parse_ws();
            if (result2 !== null) {
              result3 = parse_segment();
              if (result3 !== null) {
                result0 = [result0, result1, result2, result3];
              } else {
                result0 = null;
                pos = pos1;
              }
            } else {
              result0 = null;
              pos = pos1;
            }
          } else {
            result0 = null;
            pos = pos1;
          }
        } else {
          result0 = null;
          pos = pos1;
        }
        if (result0 !== null) {
          result0 = (function(offset, seg) { return seg; })(pos0, result0[3]);
        }
        if (result0 === null) {
          pos = pos0;
        }
        return result0;
      }
      
      function parse_segment() {
        var result0, result1, result2;
        var pos0, pos1;
        
        pos0 = pos;
        result0 = parse_string();
        if (result0 !== null) {
          result0 = (function(offset, str) { return {string: str}; })(pos0, result0);
        }
        if (result0 === null) {
          pos = pos0;
        }
        if (result0 === null) {
          pos0 = pos;
          pos1 = pos;
          result0 = parse_identifier();
          if (result0 !== null) {
            result1 = parse_size();
            result1 = result1 !== null ? result1 : "";
            if (result1 !== null) {
              result2 = parse_specifierList();
              result2 = result2 !== null ? result2 : "";
              if (result2 !== null) {
                result0 = [result0, result1, result2];
              } else {
                result0 = null;
                pos = pos1;
              }
            } else {
              result0 = null;
              pos = pos1;
            }
          } else {
            result0 = null;
            pos = pos1;
          }
          if (result0 !== null) {
            result0 = (function(offset, v, size, specs) { return {name: v, size: size, specifiers: specs}; })(pos0, result0[0], result0[1], result0[2]);
          }
          if (result0 === null) {
            pos = pos0;
          }
          if (result0 === null) {
            pos0 = pos;
            pos1 = pos;
            result0 = parse_number();
            if (result0 !== null) {
              result1 = parse_size();
              result1 = result1 !== null ? result1 : "";
              if (result1 !== null) {
                result2 = parse_specifierList();
                result2 = result2 !== null ? result2 : "";
                if (result2 !== null) {
                  result0 = [result0, result1, result2];
                } else {
                  result0 = null;
                  pos = pos1;
                }
              } else {
                result0 = null;
                pos = pos1;
              }
            } else {
              result0 = null;
              pos = pos1;
            }
            if (result0 !== null) {
              result0 = (function(offset, v, size, specs) { return {value: v, size: size, specifiers: specs}; })(pos0, result0[0], result0[1], result0[2]);
            }
            if (result0 === null) {
              pos = pos0;
            }
          }
        }
        return result0;
      }
      
      function parse_string() {
        var result0, result1, result2;
        var pos0, pos1;
        
        pos0 = pos;
        pos1 = pos;
        if (input.charCodeAt(pos) === 34) {
          result0 = "\"";
          pos++;
        } else {
          result0 = null;
          if (reportFailures === 0) {
            matchFailed("\"\\\"\"");
          }
        }
        if (result0 !== null) {
          if (input.charCodeAt(pos) === 34) {
            result1 = "\"";
            pos++;
          } else {
            result1 = null;
            if (reportFailures === 0) {
              matchFailed("\"\\\"\"");
            }
          }
          if (result1 !== null) {
            result0 = [result0, result1];
          } else {
            result0 = null;
            pos = pos1;
          }
        } else {
          result0 = null;
          pos = pos1;
        }
        if (result0 !== null) {
          result0 = (function(offset) { return "";    })(pos0);
        }
        if (result0 === null) {
          pos = pos0;
        }
        if (result0 === null) {
          pos0 = pos;
          pos1 = pos;
          if (input.charCodeAt(pos) === 34) {
            result0 = "\"";
            pos++;
          } else {
            result0 = null;
            if (reportFailures === 0) {
              matchFailed("\"\\\"\"");
            }
          }
          if (result0 !== null) {
            result1 = parse_chars();
            if (result1 !== null) {
              if (input.charCodeAt(pos) === 34) {
                result2 = "\"";
                pos++;
              } else {
                result2 = null;
                if (reportFailures === 0) {
                  matchFailed("\"\\\"\"");
                }
              }
              if (result2 !== null) {
                result0 = [result0, result1, result2];
              } else {
                result0 = null;
                pos = pos1;
              }
            } else {
              result0 = null;
              pos = pos1;
            }
          } else {
            result0 = null;
            pos = pos1;
          }
          if (result0 !== null) {
            result0 = (function(offset, chars) { return chars; })(pos0, result0[1]);
          }
          if (result0 === null) {
            pos = pos0;
          }
        }
        return result0;
      }
      
      function parse_chars() {
        var result0, result1;
        var pos0;
        
        pos0 = pos;
        result1 = parse_char();
        if (result1 !== null) {
          result0 = [];
          while (result1 !== null) {
            result0.push(result1);
            result1 = parse_char();
          }
        } else {
          result0 = null;
        }
        if (result0 !== null) {
          result0 = (function(offset, chars) { return chars.join(""); })(pos0, result0);
        }
        if (result0 === null) {
          pos = pos0;
        }
        return result0;
      }
      
      function parse_char() {
        var result0, result1, result2, result3, result4;
        var pos0, pos1;
        
        if (/^[^"\\\0-\x1F]/.test(input.charAt(pos))) {
          result0 = input.charAt(pos);
          pos++;
        } else {
          result0 = null;
          if (reportFailures === 0) {
            matchFailed("[^\"\\\\\\0-\\x1F]");
          }
        }
        if (result0 === null) {
          pos0 = pos;
          if (input.substr(pos, 2) === "\\\"") {
            result0 = "\\\"";
            pos += 2;
          } else {
            result0 = null;
            if (reportFailures === 0) {
              matchFailed("\"\\\\\\\"\"");
            }
          }
          if (result0 !== null) {
            result0 = (function(offset) { return '"';  })(pos0);
          }
          if (result0 === null) {
            pos = pos0;
          }
          if (result0 === null) {
            pos0 = pos;
            if (input.substr(pos, 2) === "\\\\") {
              result0 = "\\\\";
              pos += 2;
            } else {
              result0 = null;
              if (reportFailures === 0) {
                matchFailed("\"\\\\\\\\\"");
              }
            }
            if (result0 !== null) {
              result0 = (function(offset) { return "\\"; })(pos0);
            }
            if (result0 === null) {
              pos = pos0;
            }
            if (result0 === null) {
              pos0 = pos;
              if (input.substr(pos, 2) === "\\/") {
                result0 = "\\/";
                pos += 2;
              } else {
                result0 = null;
                if (reportFailures === 0) {
                  matchFailed("\"\\\\/\"");
                }
              }
              if (result0 !== null) {
                result0 = (function(offset) { return "/";  })(pos0);
              }
              if (result0 === null) {
                pos = pos0;
              }
              if (result0 === null) {
                pos0 = pos;
                if (input.substr(pos, 2) === "\\b") {
                  result0 = "\\b";
                  pos += 2;
                } else {
                  result0 = null;
                  if (reportFailures === 0) {
                    matchFailed("\"\\\\b\"");
                  }
                }
                if (result0 !== null) {
                  result0 = (function(offset) { return "\b"; })(pos0);
                }
                if (result0 === null) {
                  pos = pos0;
                }
                if (result0 === null) {
                  pos0 = pos;
                  if (input.substr(pos, 2) === "\\f") {
                    result0 = "\\f";
                    pos += 2;
                  } else {
                    result0 = null;
                    if (reportFailures === 0) {
                      matchFailed("\"\\\\f\"");
                    }
                  }
                  if (result0 !== null) {
                    result0 = (function(offset) { return "\f"; })(pos0);
                  }
                  if (result0 === null) {
                    pos = pos0;
                  }
                  if (result0 === null) {
                    pos0 = pos;
                    if (input.substr(pos, 2) === "\\n") {
                      result0 = "\\n";
                      pos += 2;
                    } else {
                      result0 = null;
                      if (reportFailures === 0) {
                        matchFailed("\"\\\\n\"");
                      }
                    }
                    if (result0 !== null) {
                      result0 = (function(offset) { return "\n"; })(pos0);
                    }
                    if (result0 === null) {
                      pos = pos0;
                    }
                    if (result0 === null) {
                      pos0 = pos;
                      if (input.substr(pos, 2) === "\\r") {
                        result0 = "\\r";
                        pos += 2;
                      } else {
                        result0 = null;
                        if (reportFailures === 0) {
                          matchFailed("\"\\\\r\"");
                        }
                      }
                      if (result0 !== null) {
                        result0 = (function(offset) { return "\r"; })(pos0);
                      }
                      if (result0 === null) {
                        pos = pos0;
                      }
                      if (result0 === null) {
                        pos0 = pos;
                        if (input.substr(pos, 2) === "\\t") {
                          result0 = "\\t";
                          pos += 2;
                        } else {
                          result0 = null;
                          if (reportFailures === 0) {
                            matchFailed("\"\\\\t\"");
                          }
                        }
                        if (result0 !== null) {
                          result0 = (function(offset) { return "\t"; })(pos0);
                        }
                        if (result0 === null) {
                          pos = pos0;
                        }
                        if (result0 === null) {
                          pos0 = pos;
                          pos1 = pos;
                          if (input.substr(pos, 2) === "\\u") {
                            result0 = "\\u";
                            pos += 2;
                          } else {
                            result0 = null;
                            if (reportFailures === 0) {
                              matchFailed("\"\\\\u\"");
                            }
                          }
                          if (result0 !== null) {
                            result1 = parse_hexDigit();
                            if (result1 !== null) {
                              result2 = parse_hexDigit();
                              if (result2 !== null) {
                                result3 = parse_hexDigit();
                                if (result3 !== null) {
                                  result4 = parse_hexDigit();
                                  if (result4 !== null) {
                                    result0 = [result0, result1, result2, result3, result4];
                                  } else {
                                    result0 = null;
                                    pos = pos1;
                                  }
                                } else {
                                  result0 = null;
                                  pos = pos1;
                                }
                              } else {
                                result0 = null;
                                pos = pos1;
                              }
                            } else {
                              result0 = null;
                              pos = pos1;
                            }
                          } else {
                            result0 = null;
                            pos = pos1;
                          }
                          if (result0 !== null) {
                            result0 = (function(offset, h1, h2, h3, h4) {
                                return String.fromCharCode(parseInt("0x" + h1 + h2 + h3 + h4));
                              })(pos0, result0[1], result0[2], result0[3], result0[4]);
                          }
                          if (result0 === null) {
                            pos = pos0;
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
        return result0;
      }
      
      function parse_hexDigit() {
        var result0;
        
        if (/^[0-9a-fA-F]/.test(input.charAt(pos))) {
          result0 = input.charAt(pos);
          pos++;
        } else {
          result0 = null;
          if (reportFailures === 0) {
            matchFailed("[0-9a-fA-F]");
          }
        }
        return result0;
      }
      
      function parse_identifier() {
        var result0, result1, result2;
        var pos0, pos1;
        
        pos0 = pos;
        pos1 = pos;
        if (/^[_a-zA-Z]/.test(input.charAt(pos))) {
          result0 = input.charAt(pos);
          pos++;
        } else {
          result0 = null;
          if (reportFailures === 0) {
            matchFailed("[_a-zA-Z]");
          }
        }
        if (result0 !== null) {
          result1 = [];
          if (/^[_a-zA-Z0-9]/.test(input.charAt(pos))) {
            result2 = input.charAt(pos);
            pos++;
          } else {
            result2 = null;
            if (reportFailures === 0) {
              matchFailed("[_a-zA-Z0-9]");
            }
          }
          while (result2 !== null) {
            result1.push(result2);
            if (/^[_a-zA-Z0-9]/.test(input.charAt(pos))) {
              result2 = input.charAt(pos);
              pos++;
            } else {
              result2 = null;
              if (reportFailures === 0) {
                matchFailed("[_a-zA-Z0-9]");
              }
            }
          }
          if (result1 !== null) {
            result0 = [result0, result1];
          } else {
            result0 = null;
            pos = pos1;
          }
        } else {
          result0 = null;
          pos = pos1;
        }
        if (result0 !== null) {
          result0 = (function(offset, head, tail) { return head + tail.join(''); })(pos0, result0[0], result0[1]);
        }
        if (result0 === null) {
          pos = pos0;
        }
        return result0;
      }
      
      function parse_number() {
        var result0, result1, result2;
        var pos0, pos1;
        
        pos0 = pos;
        if (input.charCodeAt(pos) === 48) {
          result0 = "0";
          pos++;
        } else {
          result0 = null;
          if (reportFailures === 0) {
            matchFailed("\"0\"");
          }
        }
        if (result0 !== null) {
          result0 = (function(offset) { return 0; })(pos0);
        }
        if (result0 === null) {
          pos = pos0;
        }
        if (result0 === null) {
          pos0 = pos;
          pos1 = pos;
          if (/^[1-9]/.test(input.charAt(pos))) {
            result0 = input.charAt(pos);
            pos++;
          } else {
            result0 = null;
            if (reportFailures === 0) {
              matchFailed("[1-9]");
            }
          }
          if (result0 !== null) {
            result1 = [];
            if (/^[0-9]/.test(input.charAt(pos))) {
              result2 = input.charAt(pos);
              pos++;
            } else {
              result2 = null;
              if (reportFailures === 0) {
                matchFailed("[0-9]");
              }
            }
            while (result2 !== null) {
              result1.push(result2);
              if (/^[0-9]/.test(input.charAt(pos))) {
                result2 = input.charAt(pos);
                pos++;
              } else {
                result2 = null;
                if (reportFailures === 0) {
                  matchFailed("[0-9]");
                }
              }
            }
            if (result1 !== null) {
              result0 = [result0, result1];
            } else {
              result0 = null;
              pos = pos1;
            }
          } else {
            result0 = null;
            pos = pos1;
          }
          if (result0 !== null) {
            result0 = (function(offset, head, tail) { return parseInt(head + tail.join('')); })(pos0, result0[0], result0[1]);
          }
          if (result0 === null) {
            pos = pos0;
          }
        }
        return result0;
      }
      
      function parse_size() {
        var result0, result1;
        var pos0, pos1;
        
        pos0 = pos;
        pos1 = pos;
        if (input.charCodeAt(pos) === 58) {
          result0 = ":";
          pos++;
        } else {
          result0 = null;
          if (reportFailures === 0) {
            matchFailed("\":\"");
          }
        }
        if (result0 !== null) {
          result1 = parse_number();
          if (result1 !== null) {
            result0 = [result0, result1];
          } else {
            result0 = null;
            pos = pos1;
          }
        } else {
          result0 = null;
          pos = pos1;
        }
        if (result0 !== null) {
          result0 = (function(offset, num) { return num; })(pos0, result0[1]);
        }
        if (result0 === null) {
          pos = pos0;
        }
        if (result0 === null) {
          pos0 = pos;
          pos1 = pos;
          if (input.charCodeAt(pos) === 58) {
            result0 = ":";
            pos++;
          } else {
            result0 = null;
            if (reportFailures === 0) {
              matchFailed("\":\"");
            }
          }
          if (result0 !== null) {
            result1 = parse_identifier();
            if (result1 !== null) {
              result0 = [result0, result1];
            } else {
              result0 = null;
              pos = pos1;
            }
          } else {
            result0 = null;
            pos = pos1;
          }
          if (result0 !== null) {
            result0 = (function(offset, id) { return id; })(pos0, result0[1]);
          }
          if (result0 === null) {
            pos = pos0;
          }
        }
        return result0;
      }
      
      function parse_specifierList() {
        var result0, result1, result2, result3;
        var pos0, pos1;
        
        pos0 = pos;
        pos1 = pos;
        if (input.charCodeAt(pos) === 47) {
          result0 = "/";
          pos++;
        } else {
          result0 = null;
          if (reportFailures === 0) {
            matchFailed("\"/\"");
          }
        }
        if (result0 !== null) {
          result1 = parse_specifier();
          if (result1 !== null) {
            result2 = [];
            result3 = parse_specifierTail();
            while (result3 !== null) {
              result2.push(result3);
              result3 = parse_specifierTail();
            }
            if (result2 !== null) {
              result0 = [result0, result1, result2];
            } else {
              result0 = null;
              pos = pos1;
            }
          } else {
            result0 = null;
            pos = pos1;
          }
        } else {
          result0 = null;
          pos = pos1;
        }
        if (result0 !== null) {
          result0 = (function(offset, head, tail) { tail.unshift(head); return tail; })(pos0, result0[1], result0[2]);
        }
        if (result0 === null) {
          pos = pos0;
        }
        return result0;
      }
      
      function parse_specifierTail() {
        var result0, result1;
        var pos0, pos1;
        
        pos0 = pos;
        pos1 = pos;
        if (input.charCodeAt(pos) === 45) {
          result0 = "-";
          pos++;
        } else {
          result0 = null;
          if (reportFailures === 0) {
            matchFailed("\"-\"");
          }
        }
        if (result0 !== null) {
          result1 = parse_specifier();
          if (result1 !== null) {
            result0 = [result0, result1];
          } else {
            result0 = null;
            pos = pos1;
          }
        } else {
          result0 = null;
          pos = pos1;
        }
        if (result0 !== null) {
          result0 = (function(offset, spec) { return spec; })(pos0, result0[1]);
        }
        if (result0 === null) {
          pos = pos0;
        }
        return result0;
      }
      
      function parse_specifier() {
        var result0;
        
        if (input.substr(pos, 6) === "little") {
          result0 = "little";
          pos += 6;
        } else {
          result0 = null;
          if (reportFailures === 0) {
            matchFailed("\"little\"");
          }
        }
        if (result0 === null) {
          if (input.substr(pos, 3) === "big") {
            result0 = "big";
            pos += 3;
          } else {
            result0 = null;
            if (reportFailures === 0) {
              matchFailed("\"big\"");
            }
          }
          if (result0 === null) {
            if (input.substr(pos, 6) === "signed") {
              result0 = "signed";
              pos += 6;
            } else {
              result0 = null;
              if (reportFailures === 0) {
                matchFailed("\"signed\"");
              }
            }
            if (result0 === null) {
              if (input.substr(pos, 8) === "unsigned") {
                result0 = "unsigned";
                pos += 8;
              } else {
                result0 = null;
                if (reportFailures === 0) {
                  matchFailed("\"unsigned\"");
                }
              }
              if (result0 === null) {
                if (input.substr(pos, 7) === "integer") {
                  result0 = "integer";
                  pos += 7;
                } else {
                  result0 = null;
                  if (reportFailures === 0) {
                    matchFailed("\"integer\"");
                  }
                }
                if (result0 === null) {
                  if (input.substr(pos, 6) === "binary") {
                    result0 = "binary";
                    pos += 6;
                  } else {
                    result0 = null;
                    if (reportFailures === 0) {
                      matchFailed("\"binary\"");
                    }
                  }
                  if (result0 === null) {
                    if (input.substr(pos, 5) === "float") {
                      result0 = "float";
                      pos += 5;
                    } else {
                      result0 = null;
                      if (reportFailures === 0) {
                        matchFailed("\"float\"");
                      }
                    }
                    if (result0 === null) {
                      result0 = parse_unit();
                    }
                  }
                }
              }
            }
          }
        }
        return result0;
      }
      
      function parse_unit() {
        var result0, result1;
        var pos0, pos1;
        
        pos0 = pos;
        pos1 = pos;
        if (input.substr(pos, 5) === "unit:") {
          result0 = "unit:";
          pos += 5;
        } else {
          result0 = null;
          if (reportFailures === 0) {
            matchFailed("\"unit:\"");
          }
        }
        if (result0 !== null) {
          result1 = parse_number();
          if (result1 !== null) {
            result0 = [result0, result1];
          } else {
            result0 = null;
            pos = pos1;
          }
        } else {
          result0 = null;
          pos = pos1;
        }
        if (result0 !== null) {
          result0 = (function(offset, num) { return 'unit:' + num; })(pos0, result0[1]);
        }
        if (result0 === null) {
          pos = pos0;
        }
        return result0;
      }
      
      function parse_ws() {
        var result0, result1;
        
        result0 = [];
        if (/^[ \t\n]/.test(input.charAt(pos))) {
          result1 = input.charAt(pos);
          pos++;
        } else {
          result1 = null;
          if (reportFailures === 0) {
            matchFailed("[ \\t\\n]");
          }
        }
        while (result1 !== null) {
          result0.push(result1);
          if (/^[ \t\n]/.test(input.charAt(pos))) {
            result1 = input.charAt(pos);
            pos++;
          } else {
            result1 = null;
            if (reportFailures === 0) {
              matchFailed("[ \\t\\n]");
            }
          }
        }
        return result0;
      }
      
      
      function cleanupExpected(expected) {
        expected.sort();
        
        var lastExpected = null;
        var cleanExpected = [];
        for (var i = 0; i < expected.length; i++) {
          if (expected[i] !== lastExpected) {
            cleanExpected.push(expected[i]);
            lastExpected = expected[i];
          }
        }
        return cleanExpected;
      }
      
      function computeErrorPosition() {
        /*
         * The first idea was to use |String.split| to break the input up to the
         * error position along newlines and derive the line and column from
         * there. However IE's |split| implementation is so broken that it was
         * enough to prevent it.
         */
        
        var line = 1;
        var column = 1;
        var seenCR = false;
        
        for (var i = 0; i < Math.max(pos, rightmostFailuresPos); i++) {
          var ch = input.charAt(i);
          if (ch === "\n") {
            if (!seenCR) { line++; }
            column = 1;
            seenCR = false;
          } else if (ch === "\r" || ch === "\u2028" || ch === "\u2029") {
            line++;
            column = 1;
            seenCR = true;
          } else {
            column++;
            seenCR = false;
          }
        }
        
        return { line: line, column: column };
      }
      
      
      var result = parseFunctions[startRule]();
      
      /*
       * The parser is now in one of the following three states:
       *
       * 1. The parser successfully parsed the whole input.
       *
       *    - |result !== null|
       *    - |pos === input.length|
       *    - |rightmostFailuresExpected| may or may not contain something
       *
       * 2. The parser successfully parsed only a part of the input.
       *
       *    - |result !== null|
       *    - |pos < input.length|
       *    - |rightmostFailuresExpected| may or may not contain something
       *
       * 3. The parser did not successfully parse any part of the input.
       *
       *   - |result === null|
       *   - |pos === 0|
       *   - |rightmostFailuresExpected| contains at least one failure
       *
       * All code following this comment (including called functions) must
       * handle these states.
       */
      if (result === null || pos !== input.length) {
        var offset = Math.max(pos, rightmostFailuresPos);
        var found = offset < input.length ? input.charAt(offset) : null;
        var errorPosition = computeErrorPosition();
        
        throw new this.SyntaxError(
          cleanupExpected(rightmostFailuresExpected),
          found,
          offset,
          errorPosition.line,
          errorPosition.column
        );
      }
      
      return result;
    },
    
    /* Returns the parser source code. */
    toSource: function() { return this._source; }
  };
  
  /* Thrown when a parser encounters a syntax error. */
  
  result.SyntaxError = function(expected, found, offset, line, column) {
    function buildMessage(expected, found) {
      var expectedHumanized, foundHumanized;
      
      switch (expected.length) {
        case 0:
          expectedHumanized = "end of input";
          break;
        case 1:
          expectedHumanized = expected[0];
          break;
        default:
          expectedHumanized = expected.slice(0, expected.length - 1).join(", ")
            + " or "
            + expected[expected.length - 1];
      }
      
      foundHumanized = found ? quote(found) : "end of input";
      
      return "Expected " + expectedHumanized + " but " + foundHumanized + " found.";
    }
    
    this.name = "SyntaxError";
    this.expected = expected;
    this.found = found;
    this.message = buildMessage(expected, found);
    this.offset = offset;
    this.line = line;
    this.column = column;
  };
  
  result.SyntaxError.prototype = Error.prototype;
  
  return result;
})();

},{}],19:[function(require,module,exports){
// -*- js-indent-level: 2 -*-
// Constructing patterns

'use strict';

function set(values) {
  var s = {};
  for (var i in values) {
    s[values[i]] = 1;
  }
  return s;
}

// Construct a segment bound to a variable, e.g., from a segment like
// "Len:32/unsigned-big". `specifiers0` is an array.
function variable(name, size, specifiers0) {
  var specifiers = set(specifiers0);
  var segment = {name: name};
  segment.type = type_in(specifiers);
  specs(segment, segment.type, specifiers);
  segment.size = size_of(segment, segment.type, size, segment.unit);
  return segment;
}

module.exports.variable = variable;
module.exports.rest = function() {
  return variable('_', true, ['binary']);
}

// Construct a segment with a literal value, e.g., from a segment like
// "206". `specifiers0` is an array.

function value(val, size, specifiers0) {
  var specifiers = set(specifiers0);
  var segment = {value: val};
  segment.type = type_in(specifiers);
  // TODO check type v. value ..
  specs(segment, segment.type, specifiers);
  segment.size = size_of(segment, segment.type, size, segment.unit);
  return segment;
}

module.exports.value = value;

// A string can appear as a literal, but it must appear without
// specifiers.
function string(val) {
  return {value: val, type: 'string'};
}
module.exports.string = string;

var TYPES = {'integer': 1, 'binary': 1, 'float': 1};
function type_in(specifiers) {
  for (var t in specifiers) {
    if (TYPES[t]) { return t; }
  }
  return 'integer';
}

function specs(segment, type, specifiers) {
  switch (type) {
  case 'integer':
    segment.signed = signed_in(specifiers);
    // fall through
  case 'float':
    segment.bigendian = endian_in(specifiers);
    // fall through
  default:
    segment.unit = unit_in(specifiers, segment.type);
  }
  return segment;
}

function endian_in(specifiers) {
  // default is big, but I have chosen true = bigendian
  return !specifiers['little'];
}

function signed_in(specifiers) {
  // this time I got it right; default is unsigned
  return specifiers['signed'];
}

function unit_in(specifiers, type) {
  for (var s in specifiers) {
    if (s.substr(0, 5) == 'unit:') {
      var unit = parseInt(s.substr(5));
      // TODO check sane for type
      return unit;
    }
  }
  // OK defaults then
  switch (type) {
  case 'binary':
    return 8;
  case 'integer':
  case 'float':
    return 1;
  }
}

function size_of(segment, type, size, unit) {
  if (size !== undefined && size !== '') {
    return size;
  }
  else {
    switch (type) {
    case 'integer':
      return 8;
    case 'float':
      return 64;
    case 'binary':
      return true;
    }
  }
}

},{}],20:[function(require,module,exports){
(function (process,global){
/* @preserve
 * The MIT License (MIT)
 * 
 * Copyright (c) 2013-2015 Petka Antonov
 * 
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * 
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 * 
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.  IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 * 
 */
/**
 * bluebird build version 3.4.6
 * Features enabled: core, race, call_get, generators, map, nodeify, promisify, props, reduce, settle, some, using, timers, filter, any, each
*/
!function(e){if("object"==typeof exports&&"undefined"!=typeof module)module.exports=e();else if("function"==typeof define&&define.amd)define([],e);else{var f;"undefined"!=typeof window?f=window:"undefined"!=typeof global?f=global:"undefined"!=typeof self&&(f=self),f.Promise=e()}}(function(){var define,module,exports;return (function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof _dereq_=="function"&&_dereq_;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof _dereq_=="function"&&_dereq_;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(_dereq_,module,exports){
"use strict";
module.exports = function(Promise) {
var SomePromiseArray = Promise._SomePromiseArray;
function any(promises) {
    var ret = new SomePromiseArray(promises);
    var promise = ret.promise();
    ret.setHowMany(1);
    ret.setUnwrap();
    ret.init();
    return promise;
}

Promise.any = function (promises) {
    return any(promises);
};

Promise.prototype.any = function () {
    return any(this);
};

};

},{}],2:[function(_dereq_,module,exports){
"use strict";
var firstLineError;
try {throw new Error(); } catch (e) {firstLineError = e;}
var schedule = _dereq_("./schedule");
var Queue = _dereq_("./queue");
var util = _dereq_("./util");

function Async() {
    this._customScheduler = false;
    this._isTickUsed = false;
    this._lateQueue = new Queue(16);
    this._normalQueue = new Queue(16);
    this._haveDrainedQueues = false;
    this._trampolineEnabled = true;
    var self = this;
    this.drainQueues = function () {
        self._drainQueues();
    };
    this._schedule = schedule;
}

Async.prototype.setScheduler = function(fn) {
    var prev = this._schedule;
    this._schedule = fn;
    this._customScheduler = true;
    return prev;
};

Async.prototype.hasCustomScheduler = function() {
    return this._customScheduler;
};

Async.prototype.enableTrampoline = function() {
    this._trampolineEnabled = true;
};

Async.prototype.disableTrampolineIfNecessary = function() {
    if (util.hasDevTools) {
        this._trampolineEnabled = false;
    }
};

Async.prototype.haveItemsQueued = function () {
    return this._isTickUsed || this._haveDrainedQueues;
};


Async.prototype.fatalError = function(e, isNode) {
    if (isNode) {
        process.stderr.write("Fatal " + (e instanceof Error ? e.stack : e) +
            "\n");
        process.exit(2);
    } else {
        this.throwLater(e);
    }
};

Async.prototype.throwLater = function(fn, arg) {
    if (arguments.length === 1) {
        arg = fn;
        fn = function () { throw arg; };
    }
    if (typeof setTimeout !== "undefined") {
        setTimeout(function() {
            fn(arg);
        }, 0);
    } else try {
        this._schedule(function() {
            fn(arg);
        });
    } catch (e) {
        throw new Error("No async scheduler available\u000a\u000a    See http://goo.gl/MqrFmX\u000a");
    }
};

function AsyncInvokeLater(fn, receiver, arg) {
    this._lateQueue.push(fn, receiver, arg);
    this._queueTick();
}

function AsyncInvoke(fn, receiver, arg) {
    this._normalQueue.push(fn, receiver, arg);
    this._queueTick();
}

function AsyncSettlePromises(promise) {
    this._normalQueue._pushOne(promise);
    this._queueTick();
}

if (!util.hasDevTools) {
    Async.prototype.invokeLater = AsyncInvokeLater;
    Async.prototype.invoke = AsyncInvoke;
    Async.prototype.settlePromises = AsyncSettlePromises;
} else {
    Async.prototype.invokeLater = function (fn, receiver, arg) {
        if (this._trampolineEnabled) {
            AsyncInvokeLater.call(this, fn, receiver, arg);
        } else {
            this._schedule(function() {
                setTimeout(function() {
                    fn.call(receiver, arg);
                }, 100);
            });
        }
    };

    Async.prototype.invoke = function (fn, receiver, arg) {
        if (this._trampolineEnabled) {
            AsyncInvoke.call(this, fn, receiver, arg);
        } else {
            this._schedule(function() {
                fn.call(receiver, arg);
            });
        }
    };

    Async.prototype.settlePromises = function(promise) {
        if (this._trampolineEnabled) {
            AsyncSettlePromises.call(this, promise);
        } else {
            this._schedule(function() {
                promise._settlePromises();
            });
        }
    };
}

Async.prototype.invokeFirst = function (fn, receiver, arg) {
    this._normalQueue.unshift(fn, receiver, arg);
    this._queueTick();
};

Async.prototype._drainQueue = function(queue) {
    while (queue.length() > 0) {
        var fn = queue.shift();
        if (typeof fn !== "function") {
            fn._settlePromises();
            continue;
        }
        var receiver = queue.shift();
        var arg = queue.shift();
        fn.call(receiver, arg);
    }
};

Async.prototype._drainQueues = function () {
    this._drainQueue(this._normalQueue);
    this._reset();
    this._haveDrainedQueues = true;
    this._drainQueue(this._lateQueue);
};

Async.prototype._queueTick = function () {
    if (!this._isTickUsed) {
        this._isTickUsed = true;
        this._schedule(this.drainQueues);
    }
};

Async.prototype._reset = function () {
    this._isTickUsed = false;
};

module.exports = Async;
module.exports.firstLineError = firstLineError;

},{"./queue":26,"./schedule":29,"./util":36}],3:[function(_dereq_,module,exports){
"use strict";
module.exports = function(Promise, INTERNAL, tryConvertToPromise, debug) {
var calledBind = false;
var rejectThis = function(_, e) {
    this._reject(e);
};

var targetRejected = function(e, context) {
    context.promiseRejectionQueued = true;
    context.bindingPromise._then(rejectThis, rejectThis, null, this, e);
};

var bindingResolved = function(thisArg, context) {
    if (((this._bitField & 50397184) === 0)) {
        this._resolveCallback(context.target);
    }
};

var bindingRejected = function(e, context) {
    if (!context.promiseRejectionQueued) this._reject(e);
};

Promise.prototype.bind = function (thisArg) {
    if (!calledBind) {
        calledBind = true;
        Promise.prototype._propagateFrom = debug.propagateFromFunction();
        Promise.prototype._boundValue = debug.boundValueFunction();
    }
    var maybePromise = tryConvertToPromise(thisArg);
    var ret = new Promise(INTERNAL);
    ret._propagateFrom(this, 1);
    var target = this._target();
    ret._setBoundTo(maybePromise);
    if (maybePromise instanceof Promise) {
        var context = {
            promiseRejectionQueued: false,
            promise: ret,
            target: target,
            bindingPromise: maybePromise
        };
        target._then(INTERNAL, targetRejected, undefined, ret, context);
        maybePromise._then(
            bindingResolved, bindingRejected, undefined, ret, context);
        ret._setOnCancel(maybePromise);
    } else {
        ret._resolveCallback(target);
    }
    return ret;
};

Promise.prototype._setBoundTo = function (obj) {
    if (obj !== undefined) {
        this._bitField = this._bitField | 2097152;
        this._boundTo = obj;
    } else {
        this._bitField = this._bitField & (~2097152);
    }
};

Promise.prototype._isBound = function () {
    return (this._bitField & 2097152) === 2097152;
};

Promise.bind = function (thisArg, value) {
    return Promise.resolve(value).bind(thisArg);
};
};

},{}],4:[function(_dereq_,module,exports){
"use strict";
var old;
if (typeof Promise !== "undefined") old = Promise;
function noConflict() {
    try { if (Promise === bluebird) Promise = old; }
    catch (e) {}
    return bluebird;
}
var bluebird = _dereq_("./promise")();
bluebird.noConflict = noConflict;
module.exports = bluebird;

},{"./promise":22}],5:[function(_dereq_,module,exports){
"use strict";
var cr = Object.create;
if (cr) {
    var callerCache = cr(null);
    var getterCache = cr(null);
    callerCache[" size"] = getterCache[" size"] = 0;
}

module.exports = function(Promise) {
var util = _dereq_("./util");
var canEvaluate = util.canEvaluate;
var isIdentifier = util.isIdentifier;

var getMethodCaller;
var getGetter;
if (!true) {
var makeMethodCaller = function (methodName) {
    return new Function("ensureMethod", "                                    \n\
        return function(obj) {                                               \n\
            'use strict'                                                     \n\
            var len = this.length;                                           \n\
            ensureMethod(obj, 'methodName');                                 \n\
            switch(len) {                                                    \n\
                case 1: return obj.methodName(this[0]);                      \n\
                case 2: return obj.methodName(this[0], this[1]);             \n\
                case 3: return obj.methodName(this[0], this[1], this[2]);    \n\
                case 0: return obj.methodName();                             \n\
                default:                                                     \n\
                    return obj.methodName.apply(obj, this);                  \n\
            }                                                                \n\
        };                                                                   \n\
        ".replace(/methodName/g, methodName))(ensureMethod);
};

var makeGetter = function (propertyName) {
    return new Function("obj", "                                             \n\
        'use strict';                                                        \n\
        return obj.propertyName;                                             \n\
        ".replace("propertyName", propertyName));
};

var getCompiled = function(name, compiler, cache) {
    var ret = cache[name];
    if (typeof ret !== "function") {
        if (!isIdentifier(name)) {
            return null;
        }
        ret = compiler(name);
        cache[name] = ret;
        cache[" size"]++;
        if (cache[" size"] > 512) {
            var keys = Object.keys(cache);
            for (var i = 0; i < 256; ++i) delete cache[keys[i]];
            cache[" size"] = keys.length - 256;
        }
    }
    return ret;
};

getMethodCaller = function(name) {
    return getCompiled(name, makeMethodCaller, callerCache);
};

getGetter = function(name) {
    return getCompiled(name, makeGetter, getterCache);
};
}

function ensureMethod(obj, methodName) {
    var fn;
    if (obj != null) fn = obj[methodName];
    if (typeof fn !== "function") {
        var message = "Object " + util.classString(obj) + " has no method '" +
            util.toString(methodName) + "'";
        throw new Promise.TypeError(message);
    }
    return fn;
}

function caller(obj) {
    var methodName = this.pop();
    var fn = ensureMethod(obj, methodName);
    return fn.apply(obj, this);
}
Promise.prototype.call = function (methodName) {
    var args = [].slice.call(arguments, 1);;
    if (!true) {
        if (canEvaluate) {
            var maybeCaller = getMethodCaller(methodName);
            if (maybeCaller !== null) {
                return this._then(
                    maybeCaller, undefined, undefined, args, undefined);
            }
        }
    }
    args.push(methodName);
    return this._then(caller, undefined, undefined, args, undefined);
};

function namedGetter(obj) {
    return obj[this];
}
function indexedGetter(obj) {
    var index = +this;
    if (index < 0) index = Math.max(0, index + obj.length);
    return obj[index];
}
Promise.prototype.get = function (propertyName) {
    var isIndex = (typeof propertyName === "number");
    var getter;
    if (!isIndex) {
        if (canEvaluate) {
            var maybeGetter = getGetter(propertyName);
            getter = maybeGetter !== null ? maybeGetter : namedGetter;
        } else {
            getter = namedGetter;
        }
    } else {
        getter = indexedGetter;
    }
    return this._then(getter, undefined, undefined, propertyName, undefined);
};
};

},{"./util":36}],6:[function(_dereq_,module,exports){
"use strict";
module.exports = function(Promise, PromiseArray, apiRejection, debug) {
var util = _dereq_("./util");
var tryCatch = util.tryCatch;
var errorObj = util.errorObj;
var async = Promise._async;

Promise.prototype["break"] = Promise.prototype.cancel = function() {
    if (!debug.cancellation()) return this._warn("cancellation is disabled");

    var promise = this;
    var child = promise;
    while (promise._isCancellable()) {
        if (!promise._cancelBy(child)) {
            if (child._isFollowing()) {
                child._followee().cancel();
            } else {
                child._cancelBranched();
            }
            break;
        }

        var parent = promise._cancellationParent;
        if (parent == null || !parent._isCancellable()) {
            if (promise._isFollowing()) {
                promise._followee().cancel();
            } else {
                promise._cancelBranched();
            }
            break;
        } else {
            if (promise._isFollowing()) promise._followee().cancel();
            promise._setWillBeCancelled();
            child = promise;
            promise = parent;
        }
    }
};

Promise.prototype._branchHasCancelled = function() {
    this._branchesRemainingToCancel--;
};

Promise.prototype._enoughBranchesHaveCancelled = function() {
    return this._branchesRemainingToCancel === undefined ||
           this._branchesRemainingToCancel <= 0;
};

Promise.prototype._cancelBy = function(canceller) {
    if (canceller === this) {
        this._branchesRemainingToCancel = 0;
        this._invokeOnCancel();
        return true;
    } else {
        this._branchHasCancelled();
        if (this._enoughBranchesHaveCancelled()) {
            this._invokeOnCancel();
            return true;
        }
    }
    return false;
};

Promise.prototype._cancelBranched = function() {
    if (this._enoughBranchesHaveCancelled()) {
        this._cancel();
    }
};

Promise.prototype._cancel = function() {
    if (!this._isCancellable()) return;
    this._setCancelled();
    async.invoke(this._cancelPromises, this, undefined);
};

Promise.prototype._cancelPromises = function() {
    if (this._length() > 0) this._settlePromises();
};

Promise.prototype._unsetOnCancel = function() {
    this._onCancelField = undefined;
};

Promise.prototype._isCancellable = function() {
    return this.isPending() && !this._isCancelled();
};

Promise.prototype.isCancellable = function() {
    return this.isPending() && !this.isCancelled();
};

Promise.prototype._doInvokeOnCancel = function(onCancelCallback, internalOnly) {
    if (util.isArray(onCancelCallback)) {
        for (var i = 0; i < onCancelCallback.length; ++i) {
            this._doInvokeOnCancel(onCancelCallback[i], internalOnly);
        }
    } else if (onCancelCallback !== undefined) {
        if (typeof onCancelCallback === "function") {
            if (!internalOnly) {
                var e = tryCatch(onCancelCallback).call(this._boundValue());
                if (e === errorObj) {
                    this._attachExtraTrace(e.e);
                    async.throwLater(e.e);
                }
            }
        } else {
            onCancelCallback._resultCancelled(this);
        }
    }
};

Promise.prototype._invokeOnCancel = function() {
    var onCancelCallback = this._onCancel();
    this._unsetOnCancel();
    async.invoke(this._doInvokeOnCancel, this, onCancelCallback);
};

Promise.prototype._invokeInternalOnCancel = function() {
    if (this._isCancellable()) {
        this._doInvokeOnCancel(this._onCancel(), true);
        this._unsetOnCancel();
    }
};

Promise.prototype._resultCancelled = function() {
    this.cancel();
};

};

},{"./util":36}],7:[function(_dereq_,module,exports){
"use strict";
module.exports = function(NEXT_FILTER) {
var util = _dereq_("./util");
var getKeys = _dereq_("./es5").keys;
var tryCatch = util.tryCatch;
var errorObj = util.errorObj;

function catchFilter(instances, cb, promise) {
    return function(e) {
        var boundTo = promise._boundValue();
        predicateLoop: for (var i = 0; i < instances.length; ++i) {
            var item = instances[i];

            if (item === Error ||
                (item != null && item.prototype instanceof Error)) {
                if (e instanceof item) {
                    return tryCatch(cb).call(boundTo, e);
                }
            } else if (typeof item === "function") {
                var matchesPredicate = tryCatch(item).call(boundTo, e);
                if (matchesPredicate === errorObj) {
                    return matchesPredicate;
                } else if (matchesPredicate) {
                    return tryCatch(cb).call(boundTo, e);
                }
            } else if (util.isObject(e)) {
                var keys = getKeys(item);
                for (var j = 0; j < keys.length; ++j) {
                    var key = keys[j];
                    if (item[key] != e[key]) {
                        continue predicateLoop;
                    }
                }
                return tryCatch(cb).call(boundTo, e);
            }
        }
        return NEXT_FILTER;
    };
}

return catchFilter;
};

},{"./es5":13,"./util":36}],8:[function(_dereq_,module,exports){
"use strict";
module.exports = function(Promise) {
var longStackTraces = false;
var contextStack = [];

Promise.prototype._promiseCreated = function() {};
Promise.prototype._pushContext = function() {};
Promise.prototype._popContext = function() {return null;};
Promise._peekContext = Promise.prototype._peekContext = function() {};

function Context() {
    this._trace = new Context.CapturedTrace(peekContext());
}
Context.prototype._pushContext = function () {
    if (this._trace !== undefined) {
        this._trace._promiseCreated = null;
        contextStack.push(this._trace);
    }
};

Context.prototype._popContext = function () {
    if (this._trace !== undefined) {
        var trace = contextStack.pop();
        var ret = trace._promiseCreated;
        trace._promiseCreated = null;
        return ret;
    }
    return null;
};

function createContext() {
    if (longStackTraces) return new Context();
}

function peekContext() {
    var lastIndex = contextStack.length - 1;
    if (lastIndex >= 0) {
        return contextStack[lastIndex];
    }
    return undefined;
}
Context.CapturedTrace = null;
Context.create = createContext;
Context.deactivateLongStackTraces = function() {};
Context.activateLongStackTraces = function() {
    var Promise_pushContext = Promise.prototype._pushContext;
    var Promise_popContext = Promise.prototype._popContext;
    var Promise_PeekContext = Promise._peekContext;
    var Promise_peekContext = Promise.prototype._peekContext;
    var Promise_promiseCreated = Promise.prototype._promiseCreated;
    Context.deactivateLongStackTraces = function() {
        Promise.prototype._pushContext = Promise_pushContext;
        Promise.prototype._popContext = Promise_popContext;
        Promise._peekContext = Promise_PeekContext;
        Promise.prototype._peekContext = Promise_peekContext;
        Promise.prototype._promiseCreated = Promise_promiseCreated;
        longStackTraces = false;
    };
    longStackTraces = true;
    Promise.prototype._pushContext = Context.prototype._pushContext;
    Promise.prototype._popContext = Context.prototype._popContext;
    Promise._peekContext = Promise.prototype._peekContext = peekContext;
    Promise.prototype._promiseCreated = function() {
        var ctx = this._peekContext();
        if (ctx && ctx._promiseCreated == null) ctx._promiseCreated = this;
    };
};
return Context;
};

},{}],9:[function(_dereq_,module,exports){
"use strict";
module.exports = function(Promise, Context) {
var getDomain = Promise._getDomain;
var async = Promise._async;
var Warning = _dereq_("./errors").Warning;
var util = _dereq_("./util");
var canAttachTrace = util.canAttachTrace;
var unhandledRejectionHandled;
var possiblyUnhandledRejection;
var bluebirdFramePattern =
    /[\\\/]bluebird[\\\/]js[\\\/](release|debug|instrumented)/;
var nodeFramePattern = /\((?:timers\.js):\d+:\d+\)/;
var parseLinePattern = /[\/<\(](.+?):(\d+):(\d+)\)?\s*$/;
var stackFramePattern = null;
var formatStack = null;
var indentStackFrames = false;
var printWarning;
var debugging = !!(util.env("BLUEBIRD_DEBUG") != 0 &&
                        (true ||
                         util.env("BLUEBIRD_DEBUG") ||
                         util.env("NODE_ENV") === "development"));

var warnings = !!(util.env("BLUEBIRD_WARNINGS") != 0 &&
    (debugging || util.env("BLUEBIRD_WARNINGS")));

var longStackTraces = !!(util.env("BLUEBIRD_LONG_STACK_TRACES") != 0 &&
    (debugging || util.env("BLUEBIRD_LONG_STACK_TRACES")));

var wForgottenReturn = util.env("BLUEBIRD_W_FORGOTTEN_RETURN") != 0 &&
    (warnings || !!util.env("BLUEBIRD_W_FORGOTTEN_RETURN"));

Promise.prototype.suppressUnhandledRejections = function() {
    var target = this._target();
    target._bitField = ((target._bitField & (~1048576)) |
                      524288);
};

Promise.prototype._ensurePossibleRejectionHandled = function () {
    if ((this._bitField & 524288) !== 0) return;
    this._setRejectionIsUnhandled();
    async.invokeLater(this._notifyUnhandledRejection, this, undefined);
};

Promise.prototype._notifyUnhandledRejectionIsHandled = function () {
    fireRejectionEvent("rejectionHandled",
                                  unhandledRejectionHandled, undefined, this);
};

Promise.prototype._setReturnedNonUndefined = function() {
    this._bitField = this._bitField | 268435456;
};

Promise.prototype._returnedNonUndefined = function() {
    return (this._bitField & 268435456) !== 0;
};

Promise.prototype._notifyUnhandledRejection = function () {
    if (this._isRejectionUnhandled()) {
        var reason = this._settledValue();
        this._setUnhandledRejectionIsNotified();
        fireRejectionEvent("unhandledRejection",
                                      possiblyUnhandledRejection, reason, this);
    }
};

Promise.prototype._setUnhandledRejectionIsNotified = function () {
    this._bitField = this._bitField | 262144;
};

Promise.prototype._unsetUnhandledRejectionIsNotified = function () {
    this._bitField = this._bitField & (~262144);
};

Promise.prototype._isUnhandledRejectionNotified = function () {
    return (this._bitField & 262144) > 0;
};

Promise.prototype._setRejectionIsUnhandled = function () {
    this._bitField = this._bitField | 1048576;
};

Promise.prototype._unsetRejectionIsUnhandled = function () {
    this._bitField = this._bitField & (~1048576);
    if (this._isUnhandledRejectionNotified()) {
        this._unsetUnhandledRejectionIsNotified();
        this._notifyUnhandledRejectionIsHandled();
    }
};

Promise.prototype._isRejectionUnhandled = function () {
    return (this._bitField & 1048576) > 0;
};

Promise.prototype._warn = function(message, shouldUseOwnTrace, promise) {
    return warn(message, shouldUseOwnTrace, promise || this);
};

Promise.onPossiblyUnhandledRejection = function (fn) {
    var domain = getDomain();
    possiblyUnhandledRejection =
        typeof fn === "function" ? (domain === null ?
                                            fn : util.domainBind(domain, fn))
                                 : undefined;
};

Promise.onUnhandledRejectionHandled = function (fn) {
    var domain = getDomain();
    unhandledRejectionHandled =
        typeof fn === "function" ? (domain === null ?
                                            fn : util.domainBind(domain, fn))
                                 : undefined;
};

var disableLongStackTraces = function() {};
Promise.longStackTraces = function () {
    if (async.haveItemsQueued() && !config.longStackTraces) {
        throw new Error("cannot enable long stack traces after promises have been created\u000a\u000a    See http://goo.gl/MqrFmX\u000a");
    }
    if (!config.longStackTraces && longStackTracesIsSupported()) {
        var Promise_captureStackTrace = Promise.prototype._captureStackTrace;
        var Promise_attachExtraTrace = Promise.prototype._attachExtraTrace;
        config.longStackTraces = true;
        disableLongStackTraces = function() {
            if (async.haveItemsQueued() && !config.longStackTraces) {
                throw new Error("cannot enable long stack traces after promises have been created\u000a\u000a    See http://goo.gl/MqrFmX\u000a");
            }
            Promise.prototype._captureStackTrace = Promise_captureStackTrace;
            Promise.prototype._attachExtraTrace = Promise_attachExtraTrace;
            Context.deactivateLongStackTraces();
            async.enableTrampoline();
            config.longStackTraces = false;
        };
        Promise.prototype._captureStackTrace = longStackTracesCaptureStackTrace;
        Promise.prototype._attachExtraTrace = longStackTracesAttachExtraTrace;
        Context.activateLongStackTraces();
        async.disableTrampolineIfNecessary();
    }
};

Promise.hasLongStackTraces = function () {
    return config.longStackTraces && longStackTracesIsSupported();
};

var fireDomEvent = (function() {
    try {
        if (typeof CustomEvent === "function") {
            var event = new CustomEvent("CustomEvent");
            util.global.dispatchEvent(event);
            return function(name, event) {
                var domEvent = new CustomEvent(name.toLowerCase(), {
                    detail: event,
                    cancelable: true
                });
                return !util.global.dispatchEvent(domEvent);
            };
        } else if (typeof Event === "function") {
            var event = new Event("CustomEvent");
            util.global.dispatchEvent(event);
            return function(name, event) {
                var domEvent = new Event(name.toLowerCase(), {
                    cancelable: true
                });
                domEvent.detail = event;
                return !util.global.dispatchEvent(domEvent);
            };
        } else {
            var event = document.createEvent("CustomEvent");
            event.initCustomEvent("testingtheevent", false, true, {});
            util.global.dispatchEvent(event);
            return function(name, event) {
                var domEvent = document.createEvent("CustomEvent");
                domEvent.initCustomEvent(name.toLowerCase(), false, true,
                    event);
                return !util.global.dispatchEvent(domEvent);
            };
        }
    } catch (e) {}
    return function() {
        return false;
    };
})();

var fireGlobalEvent = (function() {
    if (util.isNode) {
        return function() {
            return process.emit.apply(process, arguments);
        };
    } else {
        if (!util.global) {
            return function() {
                return false;
            };
        }
        return function(name) {
            var methodName = "on" + name.toLowerCase();
            var method = util.global[methodName];
            if (!method) return false;
            method.apply(util.global, [].slice.call(arguments, 1));
            return true;
        };
    }
})();

function generatePromiseLifecycleEventObject(name, promise) {
    return {promise: promise};
}

var eventToObjectGenerator = {
    promiseCreated: generatePromiseLifecycleEventObject,
    promiseFulfilled: generatePromiseLifecycleEventObject,
    promiseRejected: generatePromiseLifecycleEventObject,
    promiseResolved: generatePromiseLifecycleEventObject,
    promiseCancelled: generatePromiseLifecycleEventObject,
    promiseChained: function(name, promise, child) {
        return {promise: promise, child: child};
    },
    warning: function(name, warning) {
        return {warning: warning};
    },
    unhandledRejection: function (name, reason, promise) {
        return {reason: reason, promise: promise};
    },
    rejectionHandled: generatePromiseLifecycleEventObject
};

var activeFireEvent = function (name) {
    var globalEventFired = false;
    try {
        globalEventFired = fireGlobalEvent.apply(null, arguments);
    } catch (e) {
        async.throwLater(e);
        globalEventFired = true;
    }

    var domEventFired = false;
    try {
        domEventFired = fireDomEvent(name,
                    eventToObjectGenerator[name].apply(null, arguments));
    } catch (e) {
        async.throwLater(e);
        domEventFired = true;
    }

    return domEventFired || globalEventFired;
};

Promise.config = function(opts) {
    opts = Object(opts);
    if ("longStackTraces" in opts) {
        if (opts.longStackTraces) {
            Promise.longStackTraces();
        } else if (!opts.longStackTraces && Promise.hasLongStackTraces()) {
            disableLongStackTraces();
        }
    }
    if ("warnings" in opts) {
        var warningsOption = opts.warnings;
        config.warnings = !!warningsOption;
        wForgottenReturn = config.warnings;

        if (util.isObject(warningsOption)) {
            if ("wForgottenReturn" in warningsOption) {
                wForgottenReturn = !!warningsOption.wForgottenReturn;
            }
        }
    }
    if ("cancellation" in opts && opts.cancellation && !config.cancellation) {
        if (async.haveItemsQueued()) {
            throw new Error(
                "cannot enable cancellation after promises are in use");
        }
        Promise.prototype._clearCancellationData =
            cancellationClearCancellationData;
        Promise.prototype._propagateFrom = cancellationPropagateFrom;
        Promise.prototype._onCancel = cancellationOnCancel;
        Promise.prototype._setOnCancel = cancellationSetOnCancel;
        Promise.prototype._attachCancellationCallback =
            cancellationAttachCancellationCallback;
        Promise.prototype._execute = cancellationExecute;
        propagateFromFunction = cancellationPropagateFrom;
        config.cancellation = true;
    }
    if ("monitoring" in opts) {
        if (opts.monitoring && !config.monitoring) {
            config.monitoring = true;
            Promise.prototype._fireEvent = activeFireEvent;
        } else if (!opts.monitoring && config.monitoring) {
            config.monitoring = false;
            Promise.prototype._fireEvent = defaultFireEvent;
        }
    }
};

function defaultFireEvent() { return false; }

Promise.prototype._fireEvent = defaultFireEvent;
Promise.prototype._execute = function(executor, resolve, reject) {
    try {
        executor(resolve, reject);
    } catch (e) {
        return e;
    }
};
Promise.prototype._onCancel = function () {};
Promise.prototype._setOnCancel = function (handler) { ; };
Promise.prototype._attachCancellationCallback = function(onCancel) {
    ;
};
Promise.prototype._captureStackTrace = function () {};
Promise.prototype._attachExtraTrace = function () {};
Promise.prototype._clearCancellationData = function() {};
Promise.prototype._propagateFrom = function (parent, flags) {
    ;
    ;
};

function cancellationExecute(executor, resolve, reject) {
    var promise = this;
    try {
        executor(resolve, reject, function(onCancel) {
            if (typeof onCancel !== "function") {
                throw new TypeError("onCancel must be a function, got: " +
                                    util.toString(onCancel));
            }
            promise._attachCancellationCallback(onCancel);
        });
    } catch (e) {
        return e;
    }
}

function cancellationAttachCancellationCallback(onCancel) {
    if (!this._isCancellable()) return this;

    var previousOnCancel = this._onCancel();
    if (previousOnCancel !== undefined) {
        if (util.isArray(previousOnCancel)) {
            previousOnCancel.push(onCancel);
        } else {
            this._setOnCancel([previousOnCancel, onCancel]);
        }
    } else {
        this._setOnCancel(onCancel);
    }
}

function cancellationOnCancel() {
    return this._onCancelField;
}

function cancellationSetOnCancel(onCancel) {
    this._onCancelField = onCancel;
}

function cancellationClearCancellationData() {
    this._cancellationParent = undefined;
    this._onCancelField = undefined;
}

function cancellationPropagateFrom(parent, flags) {
    if ((flags & 1) !== 0) {
        this._cancellationParent = parent;
        var branchesRemainingToCancel = parent._branchesRemainingToCancel;
        if (branchesRemainingToCancel === undefined) {
            branchesRemainingToCancel = 0;
        }
        parent._branchesRemainingToCancel = branchesRemainingToCancel + 1;
    }
    if ((flags & 2) !== 0 && parent._isBound()) {
        this._setBoundTo(parent._boundTo);
    }
}

function bindingPropagateFrom(parent, flags) {
    if ((flags & 2) !== 0 && parent._isBound()) {
        this._setBoundTo(parent._boundTo);
    }
}
var propagateFromFunction = bindingPropagateFrom;

function boundValueFunction() {
    var ret = this._boundTo;
    if (ret !== undefined) {
        if (ret instanceof Promise) {
            if (ret.isFulfilled()) {
                return ret.value();
            } else {
                return undefined;
            }
        }
    }
    return ret;
}

function longStackTracesCaptureStackTrace() {
    this._trace = new CapturedTrace(this._peekContext());
}

function longStackTracesAttachExtraTrace(error, ignoreSelf) {
    if (canAttachTrace(error)) {
        var trace = this._trace;
        if (trace !== undefined) {
            if (ignoreSelf) trace = trace._parent;
        }
        if (trace !== undefined) {
            trace.attachExtraTrace(error);
        } else if (!error.__stackCleaned__) {
            var parsed = parseStackAndMessage(error);
            util.notEnumerableProp(error, "stack",
                parsed.message + "\n" + parsed.stack.join("\n"));
            util.notEnumerableProp(error, "__stackCleaned__", true);
        }
    }
}

function checkForgottenReturns(returnValue, promiseCreated, name, promise,
                               parent) {
    if (returnValue === undefined && promiseCreated !== null &&
        wForgottenReturn) {
        if (parent !== undefined && parent._returnedNonUndefined()) return;
        if ((promise._bitField & 65535) === 0) return;

        if (name) name = name + " ";
        var handlerLine = "";
        var creatorLine = "";
        if (promiseCreated._trace) {
            var traceLines = promiseCreated._trace.stack.split("\n");
            var stack = cleanStack(traceLines);
            for (var i = stack.length - 1; i >= 0; --i) {
                var line = stack[i];
                if (!nodeFramePattern.test(line)) {
                    var lineMatches = line.match(parseLinePattern);
                    if (lineMatches) {
                        handlerLine  = "at " + lineMatches[1] +
                            ":" + lineMatches[2] + ":" + lineMatches[3] + " ";
                    }
                    break;
                }
            }

            if (stack.length > 0) {
                var firstUserLine = stack[0];
                for (var i = 0; i < traceLines.length; ++i) {

                    if (traceLines[i] === firstUserLine) {
                        if (i > 0) {
                            creatorLine = "\n" + traceLines[i - 1];
                        }
                        break;
                    }
                }

            }
        }
        var msg = "a promise was created in a " + name +
            "handler " + handlerLine + "but was not returned from it, " +
            "see http://goo.gl/rRqMUw" +
            creatorLine;
        promise._warn(msg, true, promiseCreated);
    }
}

function deprecated(name, replacement) {
    var message = name +
        " is deprecated and will be removed in a future version.";
    if (replacement) message += " Use " + replacement + " instead.";
    return warn(message);
}

function warn(message, shouldUseOwnTrace, promise) {
    if (!config.warnings) return;
    var warning = new Warning(message);
    var ctx;
    if (shouldUseOwnTrace) {
        promise._attachExtraTrace(warning);
    } else if (config.longStackTraces && (ctx = Promise._peekContext())) {
        ctx.attachExtraTrace(warning);
    } else {
        var parsed = parseStackAndMessage(warning);
        warning.stack = parsed.message + "\n" + parsed.stack.join("\n");
    }

    if (!activeFireEvent("warning", warning)) {
        formatAndLogError(warning, "", true);
    }
}

function reconstructStack(message, stacks) {
    for (var i = 0; i < stacks.length - 1; ++i) {
        stacks[i].push("From previous event:");
        stacks[i] = stacks[i].join("\n");
    }
    if (i < stacks.length) {
        stacks[i] = stacks[i].join("\n");
    }
    return message + "\n" + stacks.join("\n");
}

function removeDuplicateOrEmptyJumps(stacks) {
    for (var i = 0; i < stacks.length; ++i) {
        if (stacks[i].length === 0 ||
            ((i + 1 < stacks.length) && stacks[i][0] === stacks[i+1][0])) {
            stacks.splice(i, 1);
            i--;
        }
    }
}

function removeCommonRoots(stacks) {
    var current = stacks[0];
    for (var i = 1; i < stacks.length; ++i) {
        var prev = stacks[i];
        var currentLastIndex = current.length - 1;
        var currentLastLine = current[currentLastIndex];
        var commonRootMeetPoint = -1;

        for (var j = prev.length - 1; j >= 0; --j) {
            if (prev[j] === currentLastLine) {
                commonRootMeetPoint = j;
                break;
            }
        }

        for (var j = commonRootMeetPoint; j >= 0; --j) {
            var line = prev[j];
            if (current[currentLastIndex] === line) {
                current.pop();
                currentLastIndex--;
            } else {
                break;
            }
        }
        current = prev;
    }
}

function cleanStack(stack) {
    var ret = [];
    for (var i = 0; i < stack.length; ++i) {
        var line = stack[i];
        var isTraceLine = "    (No stack trace)" === line ||
            stackFramePattern.test(line);
        var isInternalFrame = isTraceLine && shouldIgnore(line);
        if (isTraceLine && !isInternalFrame) {
            if (indentStackFrames && line.charAt(0) !== " ") {
                line = "    " + line;
            }
            ret.push(line);
        }
    }
    return ret;
}

function stackFramesAsArray(error) {
    var stack = error.stack.replace(/\s+$/g, "").split("\n");
    for (var i = 0; i < stack.length; ++i) {
        var line = stack[i];
        if ("    (No stack trace)" === line || stackFramePattern.test(line)) {
            break;
        }
    }
    if (i > 0) {
        stack = stack.slice(i);
    }
    return stack;
}

function parseStackAndMessage(error) {
    var stack = error.stack;
    var message = error.toString();
    stack = typeof stack === "string" && stack.length > 0
                ? stackFramesAsArray(error) : ["    (No stack trace)"];
    return {
        message: message,
        stack: cleanStack(stack)
    };
}

function formatAndLogError(error, title, isSoft) {
    if (typeof console !== "undefined") {
        var message;
        if (util.isObject(error)) {
            var stack = error.stack;
            message = title + formatStack(stack, error);
        } else {
            message = title + String(error);
        }
        if (typeof printWarning === "function") {
            printWarning(message, isSoft);
        } else if (typeof console.log === "function" ||
            typeof console.log === "object") {
            console.log(message);
        }
    }
}

function fireRejectionEvent(name, localHandler, reason, promise) {
    var localEventFired = false;
    try {
        if (typeof localHandler === "function") {
            localEventFired = true;
            if (name === "rejectionHandled") {
                localHandler(promise);
            } else {
                localHandler(reason, promise);
            }
        }
    } catch (e) {
        async.throwLater(e);
    }

    if (name === "unhandledRejection") {
        if (!activeFireEvent(name, reason, promise) && !localEventFired) {
            formatAndLogError(reason, "Unhandled rejection ");
        }
    } else {
        activeFireEvent(name, promise);
    }
}

function formatNonError(obj) {
    var str;
    if (typeof obj === "function") {
        str = "[function " +
            (obj.name || "anonymous") +
            "]";
    } else {
        str = obj && typeof obj.toString === "function"
            ? obj.toString() : util.toString(obj);
        var ruselessToString = /\[object [a-zA-Z0-9$_]+\]/;
        if (ruselessToString.test(str)) {
            try {
                var newStr = JSON.stringify(obj);
                str = newStr;
            }
            catch(e) {

            }
        }
        if (str.length === 0) {
            str = "(empty array)";
        }
    }
    return ("(<" + snip(str) + ">, no stack trace)");
}

function snip(str) {
    var maxChars = 41;
    if (str.length < maxChars) {
        return str;
    }
    return str.substr(0, maxChars - 3) + "...";
}

function longStackTracesIsSupported() {
    return typeof captureStackTrace === "function";
}

var shouldIgnore = function() { return false; };
var parseLineInfoRegex = /[\/<\(]([^:\/]+):(\d+):(?:\d+)\)?\s*$/;
function parseLineInfo(line) {
    var matches = line.match(parseLineInfoRegex);
    if (matches) {
        return {
            fileName: matches[1],
            line: parseInt(matches[2], 10)
        };
    }
}

function setBounds(firstLineError, lastLineError) {
    if (!longStackTracesIsSupported()) return;
    var firstStackLines = firstLineError.stack.split("\n");
    var lastStackLines = lastLineError.stack.split("\n");
    var firstIndex = -1;
    var lastIndex = -1;
    var firstFileName;
    var lastFileName;
    for (var i = 0; i < firstStackLines.length; ++i) {
        var result = parseLineInfo(firstStackLines[i]);
        if (result) {
            firstFileName = result.fileName;
            firstIndex = result.line;
            break;
        }
    }
    for (var i = 0; i < lastStackLines.length; ++i) {
        var result = parseLineInfo(lastStackLines[i]);
        if (result) {
            lastFileName = result.fileName;
            lastIndex = result.line;
            break;
        }
    }
    if (firstIndex < 0 || lastIndex < 0 || !firstFileName || !lastFileName ||
        firstFileName !== lastFileName || firstIndex >= lastIndex) {
        return;
    }

    shouldIgnore = function(line) {
        if (bluebirdFramePattern.test(line)) return true;
        var info = parseLineInfo(line);
        if (info) {
            if (info.fileName === firstFileName &&
                (firstIndex <= info.line && info.line <= lastIndex)) {
                return true;
            }
        }
        return false;
    };
}

function CapturedTrace(parent) {
    this._parent = parent;
    this._promisesCreated = 0;
    var length = this._length = 1 + (parent === undefined ? 0 : parent._length);
    captureStackTrace(this, CapturedTrace);
    if (length > 32) this.uncycle();
}
util.inherits(CapturedTrace, Error);
Context.CapturedTrace = CapturedTrace;

CapturedTrace.prototype.uncycle = function() {
    var length = this._length;
    if (length < 2) return;
    var nodes = [];
    var stackToIndex = {};

    for (var i = 0, node = this; node !== undefined; ++i) {
        nodes.push(node);
        node = node._parent;
    }
    length = this._length = i;
    for (var i = length - 1; i >= 0; --i) {
        var stack = nodes[i].stack;
        if (stackToIndex[stack] === undefined) {
            stackToIndex[stack] = i;
        }
    }
    for (var i = 0; i < length; ++i) {
        var currentStack = nodes[i].stack;
        var index = stackToIndex[currentStack];
        if (index !== undefined && index !== i) {
            if (index > 0) {
                nodes[index - 1]._parent = undefined;
                nodes[index - 1]._length = 1;
            }
            nodes[i]._parent = undefined;
            nodes[i]._length = 1;
            var cycleEdgeNode = i > 0 ? nodes[i - 1] : this;

            if (index < length - 1) {
                cycleEdgeNode._parent = nodes[index + 1];
                cycleEdgeNode._parent.uncycle();
                cycleEdgeNode._length =
                    cycleEdgeNode._parent._length + 1;
            } else {
                cycleEdgeNode._parent = undefined;
                cycleEdgeNode._length = 1;
            }
            var currentChildLength = cycleEdgeNode._length + 1;
            for (var j = i - 2; j >= 0; --j) {
                nodes[j]._length = currentChildLength;
                currentChildLength++;
            }
            return;
        }
    }
};

CapturedTrace.prototype.attachExtraTrace = function(error) {
    if (error.__stackCleaned__) return;
    this.uncycle();
    var parsed = parseStackAndMessage(error);
    var message = parsed.message;
    var stacks = [parsed.stack];

    var trace = this;
    while (trace !== undefined) {
        stacks.push(cleanStack(trace.stack.split("\n")));
        trace = trace._parent;
    }
    removeCommonRoots(stacks);
    removeDuplicateOrEmptyJumps(stacks);
    util.notEnumerableProp(error, "stack", reconstructStack(message, stacks));
    util.notEnumerableProp(error, "__stackCleaned__", true);
};

var captureStackTrace = (function stackDetection() {
    var v8stackFramePattern = /^\s*at\s*/;
    var v8stackFormatter = function(stack, error) {
        if (typeof stack === "string") return stack;

        if (error.name !== undefined &&
            error.message !== undefined) {
            return error.toString();
        }
        return formatNonError(error);
    };

    if (typeof Error.stackTraceLimit === "number" &&
        typeof Error.captureStackTrace === "function") {
        Error.stackTraceLimit += 6;
        stackFramePattern = v8stackFramePattern;
        formatStack = v8stackFormatter;
        var captureStackTrace = Error.captureStackTrace;

        shouldIgnore = function(line) {
            return bluebirdFramePattern.test(line);
        };
        return function(receiver, ignoreUntil) {
            Error.stackTraceLimit += 6;
            captureStackTrace(receiver, ignoreUntil);
            Error.stackTraceLimit -= 6;
        };
    }
    var err = new Error();

    if (typeof err.stack === "string" &&
        err.stack.split("\n")[0].indexOf("stackDetection@") >= 0) {
        stackFramePattern = /@/;
        formatStack = v8stackFormatter;
        indentStackFrames = true;
        return function captureStackTrace(o) {
            o.stack = new Error().stack;
        };
    }

    var hasStackAfterThrow;
    try { throw new Error(); }
    catch(e) {
        hasStackAfterThrow = ("stack" in e);
    }
    if (!("stack" in err) && hasStackAfterThrow &&
        typeof Error.stackTraceLimit === "number") {
        stackFramePattern = v8stackFramePattern;
        formatStack = v8stackFormatter;
        return function captureStackTrace(o) {
            Error.stackTraceLimit += 6;
            try { throw new Error(); }
            catch(e) { o.stack = e.stack; }
            Error.stackTraceLimit -= 6;
        };
    }

    formatStack = function(stack, error) {
        if (typeof stack === "string") return stack;

        if ((typeof error === "object" ||
            typeof error === "function") &&
            error.name !== undefined &&
            error.message !== undefined) {
            return error.toString();
        }
        return formatNonError(error);
    };

    return null;

})([]);

if (typeof console !== "undefined" && typeof console.warn !== "undefined") {
    printWarning = function (message) {
        console.warn(message);
    };
    if (util.isNode && process.stderr.isTTY) {
        printWarning = function(message, isSoft) {
            var color = isSoft ? "\u001b[33m" : "\u001b[31m";
            console.warn(color + message + "\u001b[0m\n");
        };
    } else if (!util.isNode && typeof (new Error().stack) === "string") {
        printWarning = function(message, isSoft) {
            console.warn("%c" + message,
                        isSoft ? "color: darkorange" : "color: red");
        };
    }
}

var config = {
    warnings: warnings,
    longStackTraces: false,
    cancellation: false,
    monitoring: false
};

if (longStackTraces) Promise.longStackTraces();

return {
    longStackTraces: function() {
        return config.longStackTraces;
    },
    warnings: function() {
        return config.warnings;
    },
    cancellation: function() {
        return config.cancellation;
    },
    monitoring: function() {
        return config.monitoring;
    },
    propagateFromFunction: function() {
        return propagateFromFunction;
    },
    boundValueFunction: function() {
        return boundValueFunction;
    },
    checkForgottenReturns: checkForgottenReturns,
    setBounds: setBounds,
    warn: warn,
    deprecated: deprecated,
    CapturedTrace: CapturedTrace,
    fireDomEvent: fireDomEvent,
    fireGlobalEvent: fireGlobalEvent
};
};

},{"./errors":12,"./util":36}],10:[function(_dereq_,module,exports){
"use strict";
module.exports = function(Promise) {
function returner() {
    return this.value;
}
function thrower() {
    throw this.reason;
}

Promise.prototype["return"] =
Promise.prototype.thenReturn = function (value) {
    if (value instanceof Promise) value.suppressUnhandledRejections();
    return this._then(
        returner, undefined, undefined, {value: value}, undefined);
};

Promise.prototype["throw"] =
Promise.prototype.thenThrow = function (reason) {
    return this._then(
        thrower, undefined, undefined, {reason: reason}, undefined);
};

Promise.prototype.catchThrow = function (reason) {
    if (arguments.length <= 1) {
        return this._then(
            undefined, thrower, undefined, {reason: reason}, undefined);
    } else {
        var _reason = arguments[1];
        var handler = function() {throw _reason;};
        return this.caught(reason, handler);
    }
};

Promise.prototype.catchReturn = function (value) {
    if (arguments.length <= 1) {
        if (value instanceof Promise) value.suppressUnhandledRejections();
        return this._then(
            undefined, returner, undefined, {value: value}, undefined);
    } else {
        var _value = arguments[1];
        if (_value instanceof Promise) _value.suppressUnhandledRejections();
        var handler = function() {return _value;};
        return this.caught(value, handler);
    }
};
};

},{}],11:[function(_dereq_,module,exports){
"use strict";
module.exports = function(Promise, INTERNAL) {
var PromiseReduce = Promise.reduce;
var PromiseAll = Promise.all;

function promiseAllThis() {
    return PromiseAll(this);
}

function PromiseMapSeries(promises, fn) {
    return PromiseReduce(promises, fn, INTERNAL, INTERNAL);
}

Promise.prototype.each = function (fn) {
    return PromiseReduce(this, fn, INTERNAL, 0)
              ._then(promiseAllThis, undefined, undefined, this, undefined);
};

Promise.prototype.mapSeries = function (fn) {
    return PromiseReduce(this, fn, INTERNAL, INTERNAL);
};

Promise.each = function (promises, fn) {
    return PromiseReduce(promises, fn, INTERNAL, 0)
              ._then(promiseAllThis, undefined, undefined, promises, undefined);
};

Promise.mapSeries = PromiseMapSeries;
};


},{}],12:[function(_dereq_,module,exports){
"use strict";
var es5 = _dereq_("./es5");
var Objectfreeze = es5.freeze;
var util = _dereq_("./util");
var inherits = util.inherits;
var notEnumerableProp = util.notEnumerableProp;

function subError(nameProperty, defaultMessage) {
    function SubError(message) {
        if (!(this instanceof SubError)) return new SubError(message);
        notEnumerableProp(this, "message",
            typeof message === "string" ? message : defaultMessage);
        notEnumerableProp(this, "name", nameProperty);
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, this.constructor);
        } else {
            Error.call(this);
        }
    }
    inherits(SubError, Error);
    return SubError;
}

var _TypeError, _RangeError;
var Warning = subError("Warning", "warning");
var CancellationError = subError("CancellationError", "cancellation error");
var TimeoutError = subError("TimeoutError", "timeout error");
var AggregateError = subError("AggregateError", "aggregate error");
try {
    _TypeError = TypeError;
    _RangeError = RangeError;
} catch(e) {
    _TypeError = subError("TypeError", "type error");
    _RangeError = subError("RangeError", "range error");
}

var methods = ("join pop push shift unshift slice filter forEach some " +
    "every map indexOf lastIndexOf reduce reduceRight sort reverse").split(" ");

for (var i = 0; i < methods.length; ++i) {
    if (typeof Array.prototype[methods[i]] === "function") {
        AggregateError.prototype[methods[i]] = Array.prototype[methods[i]];
    }
}

es5.defineProperty(AggregateError.prototype, "length", {
    value: 0,
    configurable: false,
    writable: true,
    enumerable: true
});
AggregateError.prototype["isOperational"] = true;
var level = 0;
AggregateError.prototype.toString = function() {
    var indent = Array(level * 4 + 1).join(" ");
    var ret = "\n" + indent + "AggregateError of:" + "\n";
    level++;
    indent = Array(level * 4 + 1).join(" ");
    for (var i = 0; i < this.length; ++i) {
        var str = this[i] === this ? "[Circular AggregateError]" : this[i] + "";
        var lines = str.split("\n");
        for (var j = 0; j < lines.length; ++j) {
            lines[j] = indent + lines[j];
        }
        str = lines.join("\n");
        ret += str + "\n";
    }
    level--;
    return ret;
};

function OperationalError(message) {
    if (!(this instanceof OperationalError))
        return new OperationalError(message);
    notEnumerableProp(this, "name", "OperationalError");
    notEnumerableProp(this, "message", message);
    this.cause = message;
    this["isOperational"] = true;

    if (message instanceof Error) {
        notEnumerableProp(this, "message", message.message);
        notEnumerableProp(this, "stack", message.stack);
    } else if (Error.captureStackTrace) {
        Error.captureStackTrace(this, this.constructor);
    }

}
inherits(OperationalError, Error);

var errorTypes = Error["__BluebirdErrorTypes__"];
if (!errorTypes) {
    errorTypes = Objectfreeze({
        CancellationError: CancellationError,
        TimeoutError: TimeoutError,
        OperationalError: OperationalError,
        RejectionError: OperationalError,
        AggregateError: AggregateError
    });
    es5.defineProperty(Error, "__BluebirdErrorTypes__", {
        value: errorTypes,
        writable: false,
        enumerable: false,
        configurable: false
    });
}

module.exports = {
    Error: Error,
    TypeError: _TypeError,
    RangeError: _RangeError,
    CancellationError: errorTypes.CancellationError,
    OperationalError: errorTypes.OperationalError,
    TimeoutError: errorTypes.TimeoutError,
    AggregateError: errorTypes.AggregateError,
    Warning: Warning
};

},{"./es5":13,"./util":36}],13:[function(_dereq_,module,exports){
var isES5 = (function(){
    "use strict";
    return this === undefined;
})();

if (isES5) {
    module.exports = {
        freeze: Object.freeze,
        defineProperty: Object.defineProperty,
        getDescriptor: Object.getOwnPropertyDescriptor,
        keys: Object.keys,
        names: Object.getOwnPropertyNames,
        getPrototypeOf: Object.getPrototypeOf,
        isArray: Array.isArray,
        isES5: isES5,
        propertyIsWritable: function(obj, prop) {
            var descriptor = Object.getOwnPropertyDescriptor(obj, prop);
            return !!(!descriptor || descriptor.writable || descriptor.set);
        }
    };
} else {
    var has = {}.hasOwnProperty;
    var str = {}.toString;
    var proto = {}.constructor.prototype;

    var ObjectKeys = function (o) {
        var ret = [];
        for (var key in o) {
            if (has.call(o, key)) {
                ret.push(key);
            }
        }
        return ret;
    };

    var ObjectGetDescriptor = function(o, key) {
        return {value: o[key]};
    };

    var ObjectDefineProperty = function (o, key, desc) {
        o[key] = desc.value;
        return o;
    };

    var ObjectFreeze = function (obj) {
        return obj;
    };

    var ObjectGetPrototypeOf = function (obj) {
        try {
            return Object(obj).constructor.prototype;
        }
        catch (e) {
            return proto;
        }
    };

    var ArrayIsArray = function (obj) {
        try {
            return str.call(obj) === "[object Array]";
        }
        catch(e) {
            return false;
        }
    };

    module.exports = {
        isArray: ArrayIsArray,
        keys: ObjectKeys,
        names: ObjectKeys,
        defineProperty: ObjectDefineProperty,
        getDescriptor: ObjectGetDescriptor,
        freeze: ObjectFreeze,
        getPrototypeOf: ObjectGetPrototypeOf,
        isES5: isES5,
        propertyIsWritable: function() {
            return true;
        }
    };
}

},{}],14:[function(_dereq_,module,exports){
"use strict";
module.exports = function(Promise, INTERNAL) {
var PromiseMap = Promise.map;

Promise.prototype.filter = function (fn, options) {
    return PromiseMap(this, fn, options, INTERNAL);
};

Promise.filter = function (promises, fn, options) {
    return PromiseMap(promises, fn, options, INTERNAL);
};
};

},{}],15:[function(_dereq_,module,exports){
"use strict";
module.exports = function(Promise, tryConvertToPromise) {
var util = _dereq_("./util");
var CancellationError = Promise.CancellationError;
var errorObj = util.errorObj;

function PassThroughHandlerContext(promise, type, handler) {
    this.promise = promise;
    this.type = type;
    this.handler = handler;
    this.called = false;
    this.cancelPromise = null;
}

PassThroughHandlerContext.prototype.isFinallyHandler = function() {
    return this.type === 0;
};

function FinallyHandlerCancelReaction(finallyHandler) {
    this.finallyHandler = finallyHandler;
}

FinallyHandlerCancelReaction.prototype._resultCancelled = function() {
    checkCancel(this.finallyHandler);
};

function checkCancel(ctx, reason) {
    if (ctx.cancelPromise != null) {
        if (arguments.length > 1) {
            ctx.cancelPromise._reject(reason);
        } else {
            ctx.cancelPromise._cancel();
        }
        ctx.cancelPromise = null;
        return true;
    }
    return false;
}

function succeed() {
    return finallyHandler.call(this, this.promise._target()._settledValue());
}
function fail(reason) {
    if (checkCancel(this, reason)) return;
    errorObj.e = reason;
    return errorObj;
}
function finallyHandler(reasonOrValue) {
    var promise = this.promise;
    var handler = this.handler;

    if (!this.called) {
        this.called = true;
        var ret = this.isFinallyHandler()
            ? handler.call(promise._boundValue())
            : handler.call(promise._boundValue(), reasonOrValue);
        if (ret !== undefined) {
            promise._setReturnedNonUndefined();
            var maybePromise = tryConvertToPromise(ret, promise);
            if (maybePromise instanceof Promise) {
                if (this.cancelPromise != null) {
                    if (maybePromise._isCancelled()) {
                        var reason =
                            new CancellationError("late cancellation observer");
                        promise._attachExtraTrace(reason);
                        errorObj.e = reason;
                        return errorObj;
                    } else if (maybePromise.isPending()) {
                        maybePromise._attachCancellationCallback(
                            new FinallyHandlerCancelReaction(this));
                    }
                }
                return maybePromise._then(
                    succeed, fail, undefined, this, undefined);
            }
        }
    }

    if (promise.isRejected()) {
        checkCancel(this);
        errorObj.e = reasonOrValue;
        return errorObj;
    } else {
        checkCancel(this);
        return reasonOrValue;
    }
}

Promise.prototype._passThrough = function(handler, type, success, fail) {
    if (typeof handler !== "function") return this.then();
    return this._then(success,
                      fail,
                      undefined,
                      new PassThroughHandlerContext(this, type, handler),
                      undefined);
};

Promise.prototype.lastly =
Promise.prototype["finally"] = function (handler) {
    return this._passThrough(handler,
                             0,
                             finallyHandler,
                             finallyHandler);
};

Promise.prototype.tap = function (handler) {
    return this._passThrough(handler, 1, finallyHandler);
};

return PassThroughHandlerContext;
};

},{"./util":36}],16:[function(_dereq_,module,exports){
"use strict";
module.exports = function(Promise,
                          apiRejection,
                          INTERNAL,
                          tryConvertToPromise,
                          Proxyable,
                          debug) {
var errors = _dereq_("./errors");
var TypeError = errors.TypeError;
var util = _dereq_("./util");
var errorObj = util.errorObj;
var tryCatch = util.tryCatch;
var yieldHandlers = [];

function promiseFromYieldHandler(value, yieldHandlers, traceParent) {
    for (var i = 0; i < yieldHandlers.length; ++i) {
        traceParent._pushContext();
        var result = tryCatch(yieldHandlers[i])(value);
        traceParent._popContext();
        if (result === errorObj) {
            traceParent._pushContext();
            var ret = Promise.reject(errorObj.e);
            traceParent._popContext();
            return ret;
        }
        var maybePromise = tryConvertToPromise(result, traceParent);
        if (maybePromise instanceof Promise) return maybePromise;
    }
    return null;
}

function PromiseSpawn(generatorFunction, receiver, yieldHandler, stack) {
    if (debug.cancellation()) {
        var internal = new Promise(INTERNAL);
        var _finallyPromise = this._finallyPromise = new Promise(INTERNAL);
        this._promise = internal.lastly(function() {
            return _finallyPromise;
        });
        internal._captureStackTrace();
        internal._setOnCancel(this);
    } else {
        var promise = this._promise = new Promise(INTERNAL);
        promise._captureStackTrace();
    }
    this._stack = stack;
    this._generatorFunction = generatorFunction;
    this._receiver = receiver;
    this._generator = undefined;
    this._yieldHandlers = typeof yieldHandler === "function"
        ? [yieldHandler].concat(yieldHandlers)
        : yieldHandlers;
    this._yieldedPromise = null;
    this._cancellationPhase = false;
}
util.inherits(PromiseSpawn, Proxyable);

PromiseSpawn.prototype._isResolved = function() {
    return this._promise === null;
};

PromiseSpawn.prototype._cleanup = function() {
    this._promise = this._generator = null;
    if (debug.cancellation() && this._finallyPromise !== null) {
        this._finallyPromise._fulfill();
        this._finallyPromise = null;
    }
};

PromiseSpawn.prototype._promiseCancelled = function() {
    if (this._isResolved()) return;
    var implementsReturn = typeof this._generator["return"] !== "undefined";

    var result;
    if (!implementsReturn) {
        var reason = new Promise.CancellationError(
            "generator .return() sentinel");
        Promise.coroutine.returnSentinel = reason;
        this._promise._attachExtraTrace(reason);
        this._promise._pushContext();
        result = tryCatch(this._generator["throw"]).call(this._generator,
                                                         reason);
        this._promise._popContext();
    } else {
        this._promise._pushContext();
        result = tryCatch(this._generator["return"]).call(this._generator,
                                                          undefined);
        this._promise._popContext();
    }
    this._cancellationPhase = true;
    this._yieldedPromise = null;
    this._continue(result);
};

PromiseSpawn.prototype._promiseFulfilled = function(value) {
    this._yieldedPromise = null;
    this._promise._pushContext();
    var result = tryCatch(this._generator.next).call(this._generator, value);
    this._promise._popContext();
    this._continue(result);
};

PromiseSpawn.prototype._promiseRejected = function(reason) {
    this._yieldedPromise = null;
    this._promise._attachExtraTrace(reason);
    this._promise._pushContext();
    var result = tryCatch(this._generator["throw"])
        .call(this._generator, reason);
    this._promise._popContext();
    this._continue(result);
};

PromiseSpawn.prototype._resultCancelled = function() {
    if (this._yieldedPromise instanceof Promise) {
        var promise = this._yieldedPromise;
        this._yieldedPromise = null;
        promise.cancel();
    }
};

PromiseSpawn.prototype.promise = function () {
    return this._promise;
};

PromiseSpawn.prototype._run = function () {
    this._generator = this._generatorFunction.call(this._receiver);
    this._receiver =
        this._generatorFunction = undefined;
    this._promiseFulfilled(undefined);
};

PromiseSpawn.prototype._continue = function (result) {
    var promise = this._promise;
    if (result === errorObj) {
        this._cleanup();
        if (this._cancellationPhase) {
            return promise.cancel();
        } else {
            return promise._rejectCallback(result.e, false);
        }
    }

    var value = result.value;
    if (result.done === true) {
        this._cleanup();
        if (this._cancellationPhase) {
            return promise.cancel();
        } else {
            return promise._resolveCallback(value);
        }
    } else {
        var maybePromise = tryConvertToPromise(value, this._promise);
        if (!(maybePromise instanceof Promise)) {
            maybePromise =
                promiseFromYieldHandler(maybePromise,
                                        this._yieldHandlers,
                                        this._promise);
            if (maybePromise === null) {
                this._promiseRejected(
                    new TypeError(
                        "A value %s was yielded that could not be treated as a promise\u000a\u000a    See http://goo.gl/MqrFmX\u000a\u000a".replace("%s", value) +
                        "From coroutine:\u000a" +
                        this._stack.split("\n").slice(1, -7).join("\n")
                    )
                );
                return;
            }
        }
        maybePromise = maybePromise._target();
        var bitField = maybePromise._bitField;
        ;
        if (((bitField & 50397184) === 0)) {
            this._yieldedPromise = maybePromise;
            maybePromise._proxy(this, null);
        } else if (((bitField & 33554432) !== 0)) {
            Promise._async.invoke(
                this._promiseFulfilled, this, maybePromise._value()
            );
        } else if (((bitField & 16777216) !== 0)) {
            Promise._async.invoke(
                this._promiseRejected, this, maybePromise._reason()
            );
        } else {
            this._promiseCancelled();
        }
    }
};

Promise.coroutine = function (generatorFunction, options) {
    if (typeof generatorFunction !== "function") {
        throw new TypeError("generatorFunction must be a function\u000a\u000a    See http://goo.gl/MqrFmX\u000a");
    }
    var yieldHandler = Object(options).yieldHandler;
    var PromiseSpawn$ = PromiseSpawn;
    var stack = new Error().stack;
    return function () {
        var generator = generatorFunction.apply(this, arguments);
        var spawn = new PromiseSpawn$(undefined, undefined, yieldHandler,
                                      stack);
        var ret = spawn.promise();
        spawn._generator = generator;
        spawn._promiseFulfilled(undefined);
        return ret;
    };
};

Promise.coroutine.addYieldHandler = function(fn) {
    if (typeof fn !== "function") {
        throw new TypeError("expecting a function but got " + util.classString(fn));
    }
    yieldHandlers.push(fn);
};

Promise.spawn = function (generatorFunction) {
    debug.deprecated("Promise.spawn()", "Promise.coroutine()");
    if (typeof generatorFunction !== "function") {
        return apiRejection("generatorFunction must be a function\u000a\u000a    See http://goo.gl/MqrFmX\u000a");
    }
    var spawn = new PromiseSpawn(generatorFunction, this);
    var ret = spawn.promise();
    spawn._run(Promise.spawn);
    return ret;
};
};

},{"./errors":12,"./util":36}],17:[function(_dereq_,module,exports){
"use strict";
module.exports =
function(Promise, PromiseArray, tryConvertToPromise, INTERNAL, async,
         getDomain) {
var util = _dereq_("./util");
var canEvaluate = util.canEvaluate;
var tryCatch = util.tryCatch;
var errorObj = util.errorObj;
var reject;

if (!true) {
if (canEvaluate) {
    var thenCallback = function(i) {
        return new Function("value", "holder", "                             \n\
            'use strict';                                                    \n\
            holder.pIndex = value;                                           \n\
            holder.checkFulfillment(this);                                   \n\
            ".replace(/Index/g, i));
    };

    var promiseSetter = function(i) {
        return new Function("promise", "holder", "                           \n\
            'use strict';                                                    \n\
            holder.pIndex = promise;                                         \n\
            ".replace(/Index/g, i));
    };

    var generateHolderClass = function(total) {
        var props = new Array(total);
        for (var i = 0; i < props.length; ++i) {
            props[i] = "this.p" + (i+1);
        }
        var assignment = props.join(" = ") + " = null;";
        var cancellationCode= "var promise;\n" + props.map(function(prop) {
            return "                                                         \n\
                promise = " + prop + ";                                      \n\
                if (promise instanceof Promise) {                            \n\
                    promise.cancel();                                        \n\
                }                                                            \n\
            ";
        }).join("\n");
        var passedArguments = props.join(", ");
        var name = "Holder$" + total;


        var code = "return function(tryCatch, errorObj, Promise, async) {    \n\
            'use strict';                                                    \n\
            function [TheName](fn) {                                         \n\
                [TheProperties]                                              \n\
                this.fn = fn;                                                \n\
                this.asyncNeeded = true;                                     \n\
                this.now = 0;                                                \n\
            }                                                                \n\
                                                                             \n\
            [TheName].prototype._callFunction = function(promise) {          \n\
                promise._pushContext();                                      \n\
                var ret = tryCatch(this.fn)([ThePassedArguments]);           \n\
                promise._popContext();                                       \n\
                if (ret === errorObj) {                                      \n\
                    promise._rejectCallback(ret.e, false);                   \n\
                } else {                                                     \n\
                    promise._resolveCallback(ret);                           \n\
                }                                                            \n\
            };                                                               \n\
                                                                             \n\
            [TheName].prototype.checkFulfillment = function(promise) {       \n\
                var now = ++this.now;                                        \n\
                if (now === [TheTotal]) {                                    \n\
                    if (this.asyncNeeded) {                                  \n\
                        async.invoke(this._callFunction, this, promise);     \n\
                    } else {                                                 \n\
                        this._callFunction(promise);                         \n\
                    }                                                        \n\
                                                                             \n\
                }                                                            \n\
            };                                                               \n\
                                                                             \n\
            [TheName].prototype._resultCancelled = function() {              \n\
                [CancellationCode]                                           \n\
            };                                                               \n\
                                                                             \n\
            return [TheName];                                                \n\
        }(tryCatch, errorObj, Promise, async);                               \n\
        ";

        code = code.replace(/\[TheName\]/g, name)
            .replace(/\[TheTotal\]/g, total)
            .replace(/\[ThePassedArguments\]/g, passedArguments)
            .replace(/\[TheProperties\]/g, assignment)
            .replace(/\[CancellationCode\]/g, cancellationCode);

        return new Function("tryCatch", "errorObj", "Promise", "async", code)
                           (tryCatch, errorObj, Promise, async);
    };

    var holderClasses = [];
    var thenCallbacks = [];
    var promiseSetters = [];

    for (var i = 0; i < 8; ++i) {
        holderClasses.push(generateHolderClass(i + 1));
        thenCallbacks.push(thenCallback(i + 1));
        promiseSetters.push(promiseSetter(i + 1));
    }

    reject = function (reason) {
        this._reject(reason);
    };
}}

Promise.join = function () {
    var last = arguments.length - 1;
    var fn;
    if (last > 0 && typeof arguments[last] === "function") {
        fn = arguments[last];
        if (!true) {
            if (last <= 8 && canEvaluate) {
                var ret = new Promise(INTERNAL);
                ret._captureStackTrace();
                var HolderClass = holderClasses[last - 1];
                var holder = new HolderClass(fn);
                var callbacks = thenCallbacks;

                for (var i = 0; i < last; ++i) {
                    var maybePromise = tryConvertToPromise(arguments[i], ret);
                    if (maybePromise instanceof Promise) {
                        maybePromise = maybePromise._target();
                        var bitField = maybePromise._bitField;
                        ;
                        if (((bitField & 50397184) === 0)) {
                            maybePromise._then(callbacks[i], reject,
                                               undefined, ret, holder);
                            promiseSetters[i](maybePromise, holder);
                            holder.asyncNeeded = false;
                        } else if (((bitField & 33554432) !== 0)) {
                            callbacks[i].call(ret,
                                              maybePromise._value(), holder);
                        } else if (((bitField & 16777216) !== 0)) {
                            ret._reject(maybePromise._reason());
                        } else {
                            ret._cancel();
                        }
                    } else {
                        callbacks[i].call(ret, maybePromise, holder);
                    }
                }

                if (!ret._isFateSealed()) {
                    if (holder.asyncNeeded) {
                        var domain = getDomain();
                        if (domain !== null) {
                            holder.fn = util.domainBind(domain, holder.fn);
                        }
                    }
                    ret._setAsyncGuaranteed();
                    ret._setOnCancel(holder);
                }
                return ret;
            }
        }
    }
    var args = [].slice.call(arguments);;
    if (fn) args.pop();
    var ret = new PromiseArray(args).promise();
    return fn !== undefined ? ret.spread(fn) : ret;
};

};

},{"./util":36}],18:[function(_dereq_,module,exports){
"use strict";
module.exports = function(Promise,
                          PromiseArray,
                          apiRejection,
                          tryConvertToPromise,
                          INTERNAL,
                          debug) {
var getDomain = Promise._getDomain;
var util = _dereq_("./util");
var tryCatch = util.tryCatch;
var errorObj = util.errorObj;
var async = Promise._async;

function MappingPromiseArray(promises, fn, limit, _filter) {
    this.constructor$(promises);
    this._promise._captureStackTrace();
    var domain = getDomain();
    this._callback = domain === null ? fn : util.domainBind(domain, fn);
    this._preservedValues = _filter === INTERNAL
        ? new Array(this.length())
        : null;
    this._limit = limit;
    this._inFlight = 0;
    this._queue = [];
    async.invoke(this._asyncInit, this, undefined);
}
util.inherits(MappingPromiseArray, PromiseArray);

MappingPromiseArray.prototype._asyncInit = function() {
    this._init$(undefined, -2);
};

MappingPromiseArray.prototype._init = function () {};

MappingPromiseArray.prototype._promiseFulfilled = function (value, index) {
    var values = this._values;
    var length = this.length();
    var preservedValues = this._preservedValues;
    var limit = this._limit;

    if (index < 0) {
        index = (index * -1) - 1;
        values[index] = value;
        if (limit >= 1) {
            this._inFlight--;
            this._drainQueue();
            if (this._isResolved()) return true;
        }
    } else {
        if (limit >= 1 && this._inFlight >= limit) {
            values[index] = value;
            this._queue.push(index);
            return false;
        }
        if (preservedValues !== null) preservedValues[index] = value;

        var promise = this._promise;
        var callback = this._callback;
        var receiver = promise._boundValue();
        promise._pushContext();
        var ret = tryCatch(callback).call(receiver, value, index, length);
        var promiseCreated = promise._popContext();
        debug.checkForgottenReturns(
            ret,
            promiseCreated,
            preservedValues !== null ? "Promise.filter" : "Promise.map",
            promise
        );
        if (ret === errorObj) {
            this._reject(ret.e);
            return true;
        }

        var maybePromise = tryConvertToPromise(ret, this._promise);
        if (maybePromise instanceof Promise) {
            maybePromise = maybePromise._target();
            var bitField = maybePromise._bitField;
            ;
            if (((bitField & 50397184) === 0)) {
                if (limit >= 1) this._inFlight++;
                values[index] = maybePromise;
                maybePromise._proxy(this, (index + 1) * -1);
                return false;
            } else if (((bitField & 33554432) !== 0)) {
                ret = maybePromise._value();
            } else if (((bitField & 16777216) !== 0)) {
                this._reject(maybePromise._reason());
                return true;
            } else {
                this._cancel();
                return true;
            }
        }
        values[index] = ret;
    }
    var totalResolved = ++this._totalResolved;
    if (totalResolved >= length) {
        if (preservedValues !== null) {
            this._filter(values, preservedValues);
        } else {
            this._resolve(values);
        }
        return true;
    }
    return false;
};

MappingPromiseArray.prototype._drainQueue = function () {
    var queue = this._queue;
    var limit = this._limit;
    var values = this._values;
    while (queue.length > 0 && this._inFlight < limit) {
        if (this._isResolved()) return;
        var index = queue.pop();
        this._promiseFulfilled(values[index], index);
    }
};

MappingPromiseArray.prototype._filter = function (booleans, values) {
    var len = values.length;
    var ret = new Array(len);
    var j = 0;
    for (var i = 0; i < len; ++i) {
        if (booleans[i]) ret[j++] = values[i];
    }
    ret.length = j;
    this._resolve(ret);
};

MappingPromiseArray.prototype.preservedValues = function () {
    return this._preservedValues;
};

function map(promises, fn, options, _filter) {
    if (typeof fn !== "function") {
        return apiRejection("expecting a function but got " + util.classString(fn));
    }

    var limit = 0;
    if (options !== undefined) {
        if (typeof options === "object" && options !== null) {
            if (typeof options.concurrency !== "number") {
                return Promise.reject(
                    new TypeError("'concurrency' must be a number but it is " +
                                    util.classString(options.concurrency)));
            }
            limit = options.concurrency;
        } else {
            return Promise.reject(new TypeError(
                            "options argument must be an object but it is " +
                             util.classString(options)));
        }
    }
    limit = typeof limit === "number" &&
        isFinite(limit) && limit >= 1 ? limit : 0;
    return new MappingPromiseArray(promises, fn, limit, _filter).promise();
}

Promise.prototype.map = function (fn, options) {
    return map(this, fn, options, null);
};

Promise.map = function (promises, fn, options, _filter) {
    return map(promises, fn, options, _filter);
};


};

},{"./util":36}],19:[function(_dereq_,module,exports){
"use strict";
module.exports =
function(Promise, INTERNAL, tryConvertToPromise, apiRejection, debug) {
var util = _dereq_("./util");
var tryCatch = util.tryCatch;

Promise.method = function (fn) {
    if (typeof fn !== "function") {
        throw new Promise.TypeError("expecting a function but got " + util.classString(fn));
    }
    return function () {
        var ret = new Promise(INTERNAL);
        ret._captureStackTrace();
        ret._pushContext();
        var value = tryCatch(fn).apply(this, arguments);
        var promiseCreated = ret._popContext();
        debug.checkForgottenReturns(
            value, promiseCreated, "Promise.method", ret);
        ret._resolveFromSyncValue(value);
        return ret;
    };
};

Promise.attempt = Promise["try"] = function (fn) {
    if (typeof fn !== "function") {
        return apiRejection("expecting a function but got " + util.classString(fn));
    }
    var ret = new Promise(INTERNAL);
    ret._captureStackTrace();
    ret._pushContext();
    var value;
    if (arguments.length > 1) {
        debug.deprecated("calling Promise.try with more than 1 argument");
        var arg = arguments[1];
        var ctx = arguments[2];
        value = util.isArray(arg) ? tryCatch(fn).apply(ctx, arg)
                                  : tryCatch(fn).call(ctx, arg);
    } else {
        value = tryCatch(fn)();
    }
    var promiseCreated = ret._popContext();
    debug.checkForgottenReturns(
        value, promiseCreated, "Promise.try", ret);
    ret._resolveFromSyncValue(value);
    return ret;
};

Promise.prototype._resolveFromSyncValue = function (value) {
    if (value === util.errorObj) {
        this._rejectCallback(value.e, false);
    } else {
        this._resolveCallback(value, true);
    }
};
};

},{"./util":36}],20:[function(_dereq_,module,exports){
"use strict";
var util = _dereq_("./util");
var maybeWrapAsError = util.maybeWrapAsError;
var errors = _dereq_("./errors");
var OperationalError = errors.OperationalError;
var es5 = _dereq_("./es5");

function isUntypedError(obj) {
    return obj instanceof Error &&
        es5.getPrototypeOf(obj) === Error.prototype;
}

var rErrorKey = /^(?:name|message|stack|cause)$/;
function wrapAsOperationalError(obj) {
    var ret;
    if (isUntypedError(obj)) {
        ret = new OperationalError(obj);
        ret.name = obj.name;
        ret.message = obj.message;
        ret.stack = obj.stack;
        var keys = es5.keys(obj);
        for (var i = 0; i < keys.length; ++i) {
            var key = keys[i];
            if (!rErrorKey.test(key)) {
                ret[key] = obj[key];
            }
        }
        return ret;
    }
    util.markAsOriginatingFromRejection(obj);
    return obj;
}

function nodebackForPromise(promise, multiArgs) {
    return function(err, value) {
        if (promise === null) return;
        if (err) {
            var wrapped = wrapAsOperationalError(maybeWrapAsError(err));
            promise._attachExtraTrace(wrapped);
            promise._reject(wrapped);
        } else if (!multiArgs) {
            promise._fulfill(value);
        } else {
            var args = [].slice.call(arguments, 1);;
            promise._fulfill(args);
        }
        promise = null;
    };
}

module.exports = nodebackForPromise;

},{"./errors":12,"./es5":13,"./util":36}],21:[function(_dereq_,module,exports){
"use strict";
module.exports = function(Promise) {
var util = _dereq_("./util");
var async = Promise._async;
var tryCatch = util.tryCatch;
var errorObj = util.errorObj;

function spreadAdapter(val, nodeback) {
    var promise = this;
    if (!util.isArray(val)) return successAdapter.call(promise, val, nodeback);
    var ret =
        tryCatch(nodeback).apply(promise._boundValue(), [null].concat(val));
    if (ret === errorObj) {
        async.throwLater(ret.e);
    }
}

function successAdapter(val, nodeback) {
    var promise = this;
    var receiver = promise._boundValue();
    var ret = val === undefined
        ? tryCatch(nodeback).call(receiver, null)
        : tryCatch(nodeback).call(receiver, null, val);
    if (ret === errorObj) {
        async.throwLater(ret.e);
    }
}
function errorAdapter(reason, nodeback) {
    var promise = this;
    if (!reason) {
        var newReason = new Error(reason + "");
        newReason.cause = reason;
        reason = newReason;
    }
    var ret = tryCatch(nodeback).call(promise._boundValue(), reason);
    if (ret === errorObj) {
        async.throwLater(ret.e);
    }
}

Promise.prototype.asCallback = Promise.prototype.nodeify = function (nodeback,
                                                                     options) {
    if (typeof nodeback == "function") {
        var adapter = successAdapter;
        if (options !== undefined && Object(options).spread) {
            adapter = spreadAdapter;
        }
        this._then(
            adapter,
            errorAdapter,
            undefined,
            this,
            nodeback
        );
    }
    return this;
};
};

},{"./util":36}],22:[function(_dereq_,module,exports){
"use strict";
module.exports = function() {
var makeSelfResolutionError = function () {
    return new TypeError("circular promise resolution chain\u000a\u000a    See http://goo.gl/MqrFmX\u000a");
};
var reflectHandler = function() {
    return new Promise.PromiseInspection(this._target());
};
var apiRejection = function(msg) {
    return Promise.reject(new TypeError(msg));
};
function Proxyable() {}
var UNDEFINED_BINDING = {};
var util = _dereq_("./util");

var getDomain;
if (util.isNode) {
    getDomain = function() {
        var ret = process.domain;
        if (ret === undefined) ret = null;
        return ret;
    };
} else {
    getDomain = function() {
        return null;
    };
}
util.notEnumerableProp(Promise, "_getDomain", getDomain);

var es5 = _dereq_("./es5");
var Async = _dereq_("./async");
var async = new Async();
es5.defineProperty(Promise, "_async", {value: async});
var errors = _dereq_("./errors");
var TypeError = Promise.TypeError = errors.TypeError;
Promise.RangeError = errors.RangeError;
var CancellationError = Promise.CancellationError = errors.CancellationError;
Promise.TimeoutError = errors.TimeoutError;
Promise.OperationalError = errors.OperationalError;
Promise.RejectionError = errors.OperationalError;
Promise.AggregateError = errors.AggregateError;
var INTERNAL = function(){};
var APPLY = {};
var NEXT_FILTER = {};
var tryConvertToPromise = _dereq_("./thenables")(Promise, INTERNAL);
var PromiseArray =
    _dereq_("./promise_array")(Promise, INTERNAL,
                               tryConvertToPromise, apiRejection, Proxyable);
var Context = _dereq_("./context")(Promise);
 /*jshint unused:false*/
var createContext = Context.create;
var debug = _dereq_("./debuggability")(Promise, Context);
var CapturedTrace = debug.CapturedTrace;
var PassThroughHandlerContext =
    _dereq_("./finally")(Promise, tryConvertToPromise);
var catchFilter = _dereq_("./catch_filter")(NEXT_FILTER);
var nodebackForPromise = _dereq_("./nodeback");
var errorObj = util.errorObj;
var tryCatch = util.tryCatch;
function check(self, executor) {
    if (typeof executor !== "function") {
        throw new TypeError("expecting a function but got " + util.classString(executor));
    }
    if (self.constructor !== Promise) {
        throw new TypeError("the promise constructor cannot be invoked directly\u000a\u000a    See http://goo.gl/MqrFmX\u000a");
    }
}

function Promise(executor) {
    this._bitField = 0;
    this._fulfillmentHandler0 = undefined;
    this._rejectionHandler0 = undefined;
    this._promise0 = undefined;
    this._receiver0 = undefined;
    if (executor !== INTERNAL) {
        check(this, executor);
        this._resolveFromExecutor(executor);
    }
    this._promiseCreated();
    this._fireEvent("promiseCreated", this);
}

Promise.prototype.toString = function () {
    return "[object Promise]";
};

Promise.prototype.caught = Promise.prototype["catch"] = function (fn) {
    var len = arguments.length;
    if (len > 1) {
        var catchInstances = new Array(len - 1),
            j = 0, i;
        for (i = 0; i < len - 1; ++i) {
            var item = arguments[i];
            if (util.isObject(item)) {
                catchInstances[j++] = item;
            } else {
                return apiRejection("expecting an object but got " +
                    "A catch statement predicate " + util.classString(item));
            }
        }
        catchInstances.length = j;
        fn = arguments[i];
        return this.then(undefined, catchFilter(catchInstances, fn, this));
    }
    return this.then(undefined, fn);
};

Promise.prototype.reflect = function () {
    return this._then(reflectHandler,
        reflectHandler, undefined, this, undefined);
};

Promise.prototype.then = function (didFulfill, didReject) {
    if (debug.warnings() && arguments.length > 0 &&
        typeof didFulfill !== "function" &&
        typeof didReject !== "function") {
        var msg = ".then() only accepts functions but was passed: " +
                util.classString(didFulfill);
        if (arguments.length > 1) {
            msg += ", " + util.classString(didReject);
        }
        this._warn(msg);
    }
    return this._then(didFulfill, didReject, undefined, undefined, undefined);
};

Promise.prototype.done = function (didFulfill, didReject) {
    var promise =
        this._then(didFulfill, didReject, undefined, undefined, undefined);
    promise._setIsFinal();
};

Promise.prototype.spread = function (fn) {
    if (typeof fn !== "function") {
        return apiRejection("expecting a function but got " + util.classString(fn));
    }
    return this.all()._then(fn, undefined, undefined, APPLY, undefined);
};

Promise.prototype.toJSON = function () {
    var ret = {
        isFulfilled: false,
        isRejected: false,
        fulfillmentValue: undefined,
        rejectionReason: undefined
    };
    if (this.isFulfilled()) {
        ret.fulfillmentValue = this.value();
        ret.isFulfilled = true;
    } else if (this.isRejected()) {
        ret.rejectionReason = this.reason();
        ret.isRejected = true;
    }
    return ret;
};

Promise.prototype.all = function () {
    if (arguments.length > 0) {
        this._warn(".all() was passed arguments but it does not take any");
    }
    return new PromiseArray(this).promise();
};

Promise.prototype.error = function (fn) {
    return this.caught(util.originatesFromRejection, fn);
};

Promise.getNewLibraryCopy = module.exports;

Promise.is = function (val) {
    return val instanceof Promise;
};

Promise.fromNode = Promise.fromCallback = function(fn) {
    var ret = new Promise(INTERNAL);
    ret._captureStackTrace();
    var multiArgs = arguments.length > 1 ? !!Object(arguments[1]).multiArgs
                                         : false;
    var result = tryCatch(fn)(nodebackForPromise(ret, multiArgs));
    if (result === errorObj) {
        ret._rejectCallback(result.e, true);
    }
    if (!ret._isFateSealed()) ret._setAsyncGuaranteed();
    return ret;
};

Promise.all = function (promises) {
    return new PromiseArray(promises).promise();
};

Promise.cast = function (obj) {
    var ret = tryConvertToPromise(obj);
    if (!(ret instanceof Promise)) {
        ret = new Promise(INTERNAL);
        ret._captureStackTrace();
        ret._setFulfilled();
        ret._rejectionHandler0 = obj;
    }
    return ret;
};

Promise.resolve = Promise.fulfilled = Promise.cast;

Promise.reject = Promise.rejected = function (reason) {
    var ret = new Promise(INTERNAL);
    ret._captureStackTrace();
    ret._rejectCallback(reason, true);
    return ret;
};

Promise.setScheduler = function(fn) {
    if (typeof fn !== "function") {
        throw new TypeError("expecting a function but got " + util.classString(fn));
    }
    return async.setScheduler(fn);
};

Promise.prototype._then = function (
    didFulfill,
    didReject,
    _,    receiver,
    internalData
) {
    var haveInternalData = internalData !== undefined;
    var promise = haveInternalData ? internalData : new Promise(INTERNAL);
    var target = this._target();
    var bitField = target._bitField;

    if (!haveInternalData) {
        promise._propagateFrom(this, 3);
        promise._captureStackTrace();
        if (receiver === undefined &&
            ((this._bitField & 2097152) !== 0)) {
            if (!((bitField & 50397184) === 0)) {
                receiver = this._boundValue();
            } else {
                receiver = target === this ? undefined : this._boundTo;
            }
        }
        this._fireEvent("promiseChained", this, promise);
    }

    var domain = getDomain();
    if (!((bitField & 50397184) === 0)) {
        var handler, value, settler = target._settlePromiseCtx;
        if (((bitField & 33554432) !== 0)) {
            value = target._rejectionHandler0;
            handler = didFulfill;
        } else if (((bitField & 16777216) !== 0)) {
            value = target._fulfillmentHandler0;
            handler = didReject;
            target._unsetRejectionIsUnhandled();
        } else {
            settler = target._settlePromiseLateCancellationObserver;
            value = new CancellationError("late cancellation observer");
            target._attachExtraTrace(value);
            handler = didReject;
        }

        async.invoke(settler, target, {
            handler: domain === null ? handler
                : (typeof handler === "function" &&
                    util.domainBind(domain, handler)),
            promise: promise,
            receiver: receiver,
            value: value
        });
    } else {
        target._addCallbacks(didFulfill, didReject, promise, receiver, domain);
    }

    return promise;
};

Promise.prototype._length = function () {
    return this._bitField & 65535;
};

Promise.prototype._isFateSealed = function () {
    return (this._bitField & 117506048) !== 0;
};

Promise.prototype._isFollowing = function () {
    return (this._bitField & 67108864) === 67108864;
};

Promise.prototype._setLength = function (len) {
    this._bitField = (this._bitField & -65536) |
        (len & 65535);
};

Promise.prototype._setFulfilled = function () {
    this._bitField = this._bitField | 33554432;
    this._fireEvent("promiseFulfilled", this);
};

Promise.prototype._setRejected = function () {
    this._bitField = this._bitField | 16777216;
    this._fireEvent("promiseRejected", this);
};

Promise.prototype._setFollowing = function () {
    this._bitField = this._bitField | 67108864;
    this._fireEvent("promiseResolved", this);
};

Promise.prototype._setIsFinal = function () {
    this._bitField = this._bitField | 4194304;
};

Promise.prototype._isFinal = function () {
    return (this._bitField & 4194304) > 0;
};

Promise.prototype._unsetCancelled = function() {
    this._bitField = this._bitField & (~65536);
};

Promise.prototype._setCancelled = function() {
    this._bitField = this._bitField | 65536;
    this._fireEvent("promiseCancelled", this);
};

Promise.prototype._setWillBeCancelled = function() {
    this._bitField = this._bitField | 8388608;
};

Promise.prototype._setAsyncGuaranteed = function() {
    if (async.hasCustomScheduler()) return;
    this._bitField = this._bitField | 134217728;
};

Promise.prototype._receiverAt = function (index) {
    var ret = index === 0 ? this._receiver0 : this[
            index * 4 - 4 + 3];
    if (ret === UNDEFINED_BINDING) {
        return undefined;
    } else if (ret === undefined && this._isBound()) {
        return this._boundValue();
    }
    return ret;
};

Promise.prototype._promiseAt = function (index) {
    return this[
            index * 4 - 4 + 2];
};

Promise.prototype._fulfillmentHandlerAt = function (index) {
    return this[
            index * 4 - 4 + 0];
};

Promise.prototype._rejectionHandlerAt = function (index) {
    return this[
            index * 4 - 4 + 1];
};

Promise.prototype._boundValue = function() {};

Promise.prototype._migrateCallback0 = function (follower) {
    var bitField = follower._bitField;
    var fulfill = follower._fulfillmentHandler0;
    var reject = follower._rejectionHandler0;
    var promise = follower._promise0;
    var receiver = follower._receiverAt(0);
    if (receiver === undefined) receiver = UNDEFINED_BINDING;
    this._addCallbacks(fulfill, reject, promise, receiver, null);
};

Promise.prototype._migrateCallbackAt = function (follower, index) {
    var fulfill = follower._fulfillmentHandlerAt(index);
    var reject = follower._rejectionHandlerAt(index);
    var promise = follower._promiseAt(index);
    var receiver = follower._receiverAt(index);
    if (receiver === undefined) receiver = UNDEFINED_BINDING;
    this._addCallbacks(fulfill, reject, promise, receiver, null);
};

Promise.prototype._addCallbacks = function (
    fulfill,
    reject,
    promise,
    receiver,
    domain
) {
    var index = this._length();

    if (index >= 65535 - 4) {
        index = 0;
        this._setLength(0);
    }

    if (index === 0) {
        this._promise0 = promise;
        this._receiver0 = receiver;
        if (typeof fulfill === "function") {
            this._fulfillmentHandler0 =
                domain === null ? fulfill : util.domainBind(domain, fulfill);
        }
        if (typeof reject === "function") {
            this._rejectionHandler0 =
                domain === null ? reject : util.domainBind(domain, reject);
        }
    } else {
        var base = index * 4 - 4;
        this[base + 2] = promise;
        this[base + 3] = receiver;
        if (typeof fulfill === "function") {
            this[base + 0] =
                domain === null ? fulfill : util.domainBind(domain, fulfill);
        }
        if (typeof reject === "function") {
            this[base + 1] =
                domain === null ? reject : util.domainBind(domain, reject);
        }
    }
    this._setLength(index + 1);
    return index;
};

Promise.prototype._proxy = function (proxyable, arg) {
    this._addCallbacks(undefined, undefined, arg, proxyable, null);
};

Promise.prototype._resolveCallback = function(value, shouldBind) {
    if (((this._bitField & 117506048) !== 0)) return;
    if (value === this)
        return this._rejectCallback(makeSelfResolutionError(), false);
    var maybePromise = tryConvertToPromise(value, this);
    if (!(maybePromise instanceof Promise)) return this._fulfill(value);

    if (shouldBind) this._propagateFrom(maybePromise, 2);

    var promise = maybePromise._target();

    if (promise === this) {
        this._reject(makeSelfResolutionError());
        return;
    }

    var bitField = promise._bitField;
    if (((bitField & 50397184) === 0)) {
        var len = this._length();
        if (len > 0) promise._migrateCallback0(this);
        for (var i = 1; i < len; ++i) {
            promise._migrateCallbackAt(this, i);
        }
        this._setFollowing();
        this._setLength(0);
        this._setFollowee(promise);
    } else if (((bitField & 33554432) !== 0)) {
        this._fulfill(promise._value());
    } else if (((bitField & 16777216) !== 0)) {
        this._reject(promise._reason());
    } else {
        var reason = new CancellationError("late cancellation observer");
        promise._attachExtraTrace(reason);
        this._reject(reason);
    }
};

Promise.prototype._rejectCallback =
function(reason, synchronous, ignoreNonErrorWarnings) {
    var trace = util.ensureErrorObject(reason);
    var hasStack = trace === reason;
    if (!hasStack && !ignoreNonErrorWarnings && debug.warnings()) {
        var message = "a promise was rejected with a non-error: " +
            util.classString(reason);
        this._warn(message, true);
    }
    this._attachExtraTrace(trace, synchronous ? hasStack : false);
    this._reject(reason);
};

Promise.prototype._resolveFromExecutor = function (executor) {
    var promise = this;
    this._captureStackTrace();
    this._pushContext();
    var synchronous = true;
    var r = this._execute(executor, function(value) {
        promise._resolveCallback(value);
    }, function (reason) {
        promise._rejectCallback(reason, synchronous);
    });
    synchronous = false;
    this._popContext();

    if (r !== undefined) {
        promise._rejectCallback(r, true);
    }
};

Promise.prototype._settlePromiseFromHandler = function (
    handler, receiver, value, promise
) {
    var bitField = promise._bitField;
    if (((bitField & 65536) !== 0)) return;
    promise._pushContext();
    var x;
    if (receiver === APPLY) {
        if (!value || typeof value.length !== "number") {
            x = errorObj;
            x.e = new TypeError("cannot .spread() a non-array: " +
                                    util.classString(value));
        } else {
            x = tryCatch(handler).apply(this._boundValue(), value);
        }
    } else {
        x = tryCatch(handler).call(receiver, value);
    }
    var promiseCreated = promise._popContext();
    bitField = promise._bitField;
    if (((bitField & 65536) !== 0)) return;

    if (x === NEXT_FILTER) {
        promise._reject(value);
    } else if (x === errorObj) {
        promise._rejectCallback(x.e, false);
    } else {
        debug.checkForgottenReturns(x, promiseCreated, "",  promise, this);
        promise._resolveCallback(x);
    }
};

Promise.prototype._target = function() {
    var ret = this;
    while (ret._isFollowing()) ret = ret._followee();
    return ret;
};

Promise.prototype._followee = function() {
    return this._rejectionHandler0;
};

Promise.prototype._setFollowee = function(promise) {
    this._rejectionHandler0 = promise;
};

Promise.prototype._settlePromise = function(promise, handler, receiver, value) {
    var isPromise = promise instanceof Promise;
    var bitField = this._bitField;
    var asyncGuaranteed = ((bitField & 134217728) !== 0);
    if (((bitField & 65536) !== 0)) {
        if (isPromise) promise._invokeInternalOnCancel();

        if (receiver instanceof PassThroughHandlerContext &&
            receiver.isFinallyHandler()) {
            receiver.cancelPromise = promise;
            if (tryCatch(handler).call(receiver, value) === errorObj) {
                promise._reject(errorObj.e);
            }
        } else if (handler === reflectHandler) {
            promise._fulfill(reflectHandler.call(receiver));
        } else if (receiver instanceof Proxyable) {
            receiver._promiseCancelled(promise);
        } else if (isPromise || promise instanceof PromiseArray) {
            promise._cancel();
        } else {
            receiver.cancel();
        }
    } else if (typeof handler === "function") {
        if (!isPromise) {
            handler.call(receiver, value, promise);
        } else {
            if (asyncGuaranteed) promise._setAsyncGuaranteed();
            this._settlePromiseFromHandler(handler, receiver, value, promise);
        }
    } else if (receiver instanceof Proxyable) {
        if (!receiver._isResolved()) {
            if (((bitField & 33554432) !== 0)) {
                receiver._promiseFulfilled(value, promise);
            } else {
                receiver._promiseRejected(value, promise);
            }
        }
    } else if (isPromise) {
        if (asyncGuaranteed) promise._setAsyncGuaranteed();
        if (((bitField & 33554432) !== 0)) {
            promise._fulfill(value);
        } else {
            promise._reject(value);
        }
    }
};

Promise.prototype._settlePromiseLateCancellationObserver = function(ctx) {
    var handler = ctx.handler;
    var promise = ctx.promise;
    var receiver = ctx.receiver;
    var value = ctx.value;
    if (typeof handler === "function") {
        if (!(promise instanceof Promise)) {
            handler.call(receiver, value, promise);
        } else {
            this._settlePromiseFromHandler(handler, receiver, value, promise);
        }
    } else if (promise instanceof Promise) {
        promise._reject(value);
    }
};

Promise.prototype._settlePromiseCtx = function(ctx) {
    this._settlePromise(ctx.promise, ctx.handler, ctx.receiver, ctx.value);
};

Promise.prototype._settlePromise0 = function(handler, value, bitField) {
    var promise = this._promise0;
    var receiver = this._receiverAt(0);
    this._promise0 = undefined;
    this._receiver0 = undefined;
    this._settlePromise(promise, handler, receiver, value);
};

Promise.prototype._clearCallbackDataAtIndex = function(index) {
    var base = index * 4 - 4;
    this[base + 2] =
    this[base + 3] =
    this[base + 0] =
    this[base + 1] = undefined;
};

Promise.prototype._fulfill = function (value) {
    var bitField = this._bitField;
    if (((bitField & 117506048) >>> 16)) return;
    if (value === this) {
        var err = makeSelfResolutionError();
        this._attachExtraTrace(err);
        return this._reject(err);
    }
    this._setFulfilled();
    this._rejectionHandler0 = value;

    if ((bitField & 65535) > 0) {
        if (((bitField & 134217728) !== 0)) {
            this._settlePromises();
        } else {
            async.settlePromises(this);
        }
    }
};

Promise.prototype._reject = function (reason) {
    var bitField = this._bitField;
    if (((bitField & 117506048) >>> 16)) return;
    this._setRejected();
    this._fulfillmentHandler0 = reason;

    if (this._isFinal()) {
        return async.fatalError(reason, util.isNode);
    }

    if ((bitField & 65535) > 0) {
        async.settlePromises(this);
    } else {
        this._ensurePossibleRejectionHandled();
    }
};

Promise.prototype._fulfillPromises = function (len, value) {
    for (var i = 1; i < len; i++) {
        var handler = this._fulfillmentHandlerAt(i);
        var promise = this._promiseAt(i);
        var receiver = this._receiverAt(i);
        this._clearCallbackDataAtIndex(i);
        this._settlePromise(promise, handler, receiver, value);
    }
};

Promise.prototype._rejectPromises = function (len, reason) {
    for (var i = 1; i < len; i++) {
        var handler = this._rejectionHandlerAt(i);
        var promise = this._promiseAt(i);
        var receiver = this._receiverAt(i);
        this._clearCallbackDataAtIndex(i);
        this._settlePromise(promise, handler, receiver, reason);
    }
};

Promise.prototype._settlePromises = function () {
    var bitField = this._bitField;
    var len = (bitField & 65535);

    if (len > 0) {
        if (((bitField & 16842752) !== 0)) {
            var reason = this._fulfillmentHandler0;
            this._settlePromise0(this._rejectionHandler0, reason, bitField);
            this._rejectPromises(len, reason);
        } else {
            var value = this._rejectionHandler0;
            this._settlePromise0(this._fulfillmentHandler0, value, bitField);
            this._fulfillPromises(len, value);
        }
        this._setLength(0);
    }
    this._clearCancellationData();
};

Promise.prototype._settledValue = function() {
    var bitField = this._bitField;
    if (((bitField & 33554432) !== 0)) {
        return this._rejectionHandler0;
    } else if (((bitField & 16777216) !== 0)) {
        return this._fulfillmentHandler0;
    }
};

function deferResolve(v) {this.promise._resolveCallback(v);}
function deferReject(v) {this.promise._rejectCallback(v, false);}

Promise.defer = Promise.pending = function() {
    debug.deprecated("Promise.defer", "new Promise");
    var promise = new Promise(INTERNAL);
    return {
        promise: promise,
        resolve: deferResolve,
        reject: deferReject
    };
};

util.notEnumerableProp(Promise,
                       "_makeSelfResolutionError",
                       makeSelfResolutionError);

_dereq_("./method")(Promise, INTERNAL, tryConvertToPromise, apiRejection,
    debug);
_dereq_("./bind")(Promise, INTERNAL, tryConvertToPromise, debug);
_dereq_("./cancel")(Promise, PromiseArray, apiRejection, debug);
_dereq_("./direct_resolve")(Promise);
_dereq_("./synchronous_inspection")(Promise);
_dereq_("./join")(
    Promise, PromiseArray, tryConvertToPromise, INTERNAL, async, getDomain);
Promise.Promise = Promise;
Promise.version = "3.4.6";
_dereq_('./map.js')(Promise, PromiseArray, apiRejection, tryConvertToPromise, INTERNAL, debug);
_dereq_('./call_get.js')(Promise);
_dereq_('./using.js')(Promise, apiRejection, tryConvertToPromise, createContext, INTERNAL, debug);
_dereq_('./timers.js')(Promise, INTERNAL, debug);
_dereq_('./generators.js')(Promise, apiRejection, INTERNAL, tryConvertToPromise, Proxyable, debug);
_dereq_('./nodeify.js')(Promise);
_dereq_('./promisify.js')(Promise, INTERNAL);
_dereq_('./props.js')(Promise, PromiseArray, tryConvertToPromise, apiRejection);
_dereq_('./race.js')(Promise, INTERNAL, tryConvertToPromise, apiRejection);
_dereq_('./reduce.js')(Promise, PromiseArray, apiRejection, tryConvertToPromise, INTERNAL, debug);
_dereq_('./settle.js')(Promise, PromiseArray, debug);
_dereq_('./some.js')(Promise, PromiseArray, apiRejection);
_dereq_('./filter.js')(Promise, INTERNAL);
_dereq_('./each.js')(Promise, INTERNAL);
_dereq_('./any.js')(Promise);
                                                         
    util.toFastProperties(Promise);                                          
    util.toFastProperties(Promise.prototype);                                
    function fillTypes(value) {                                              
        var p = new Promise(INTERNAL);                                       
        p._fulfillmentHandler0 = value;                                      
        p._rejectionHandler0 = value;                                        
        p._promise0 = value;                                                 
        p._receiver0 = value;                                                
    }                                                                        
    // Complete slack tracking, opt out of field-type tracking and           
    // stabilize map                                                         
    fillTypes({a: 1});                                                       
    fillTypes({b: 2});                                                       
    fillTypes({c: 3});                                                       
    fillTypes(1);                                                            
    fillTypes(function(){});                                                 
    fillTypes(undefined);                                                    
    fillTypes(false);                                                        
    fillTypes(new Promise(INTERNAL));                                        
    debug.setBounds(Async.firstLineError, util.lastLineError);               
    return Promise;                                                          

};

},{"./any.js":1,"./async":2,"./bind":3,"./call_get.js":5,"./cancel":6,"./catch_filter":7,"./context":8,"./debuggability":9,"./direct_resolve":10,"./each.js":11,"./errors":12,"./es5":13,"./filter.js":14,"./finally":15,"./generators.js":16,"./join":17,"./map.js":18,"./method":19,"./nodeback":20,"./nodeify.js":21,"./promise_array":23,"./promisify.js":24,"./props.js":25,"./race.js":27,"./reduce.js":28,"./settle.js":30,"./some.js":31,"./synchronous_inspection":32,"./thenables":33,"./timers.js":34,"./using.js":35,"./util":36}],23:[function(_dereq_,module,exports){
"use strict";
module.exports = function(Promise, INTERNAL, tryConvertToPromise,
    apiRejection, Proxyable) {
var util = _dereq_("./util");
var isArray = util.isArray;

function toResolutionValue(val) {
    switch(val) {
    case -2: return [];
    case -3: return {};
    }
}

function PromiseArray(values) {
    var promise = this._promise = new Promise(INTERNAL);
    if (values instanceof Promise) {
        promise._propagateFrom(values, 3);
    }
    promise._setOnCancel(this);
    this._values = values;
    this._length = 0;
    this._totalResolved = 0;
    this._init(undefined, -2);
}
util.inherits(PromiseArray, Proxyable);

PromiseArray.prototype.length = function () {
    return this._length;
};

PromiseArray.prototype.promise = function () {
    return this._promise;
};

PromiseArray.prototype._init = function init(_, resolveValueIfEmpty) {
    var values = tryConvertToPromise(this._values, this._promise);
    if (values instanceof Promise) {
        values = values._target();
        var bitField = values._bitField;
        ;
        this._values = values;

        if (((bitField & 50397184) === 0)) {
            this._promise._setAsyncGuaranteed();
            return values._then(
                init,
                this._reject,
                undefined,
                this,
                resolveValueIfEmpty
           );
        } else if (((bitField & 33554432) !== 0)) {
            values = values._value();
        } else if (((bitField & 16777216) !== 0)) {
            return this._reject(values._reason());
        } else {
            return this._cancel();
        }
    }
    values = util.asArray(values);
    if (values === null) {
        var err = apiRejection(
            "expecting an array or an iterable object but got " + util.classString(values)).reason();
        this._promise._rejectCallback(err, false);
        return;
    }

    if (values.length === 0) {
        if (resolveValueIfEmpty === -5) {
            this._resolveEmptyArray();
        }
        else {
            this._resolve(toResolutionValue(resolveValueIfEmpty));
        }
        return;
    }
    this._iterate(values);
};

PromiseArray.prototype._iterate = function(values) {
    var len = this.getActualLength(values.length);
    this._length = len;
    this._values = this.shouldCopyValues() ? new Array(len) : this._values;
    var result = this._promise;
    var isResolved = false;
    var bitField = null;
    for (var i = 0; i < len; ++i) {
        var maybePromise = tryConvertToPromise(values[i], result);

        if (maybePromise instanceof Promise) {
            maybePromise = maybePromise._target();
            bitField = maybePromise._bitField;
        } else {
            bitField = null;
        }

        if (isResolved) {
            if (bitField !== null) {
                maybePromise.suppressUnhandledRejections();
            }
        } else if (bitField !== null) {
            if (((bitField & 50397184) === 0)) {
                maybePromise._proxy(this, i);
                this._values[i] = maybePromise;
            } else if (((bitField & 33554432) !== 0)) {
                isResolved = this._promiseFulfilled(maybePromise._value(), i);
            } else if (((bitField & 16777216) !== 0)) {
                isResolved = this._promiseRejected(maybePromise._reason(), i);
            } else {
                isResolved = this._promiseCancelled(i);
            }
        } else {
            isResolved = this._promiseFulfilled(maybePromise, i);
        }
    }
    if (!isResolved) result._setAsyncGuaranteed();
};

PromiseArray.prototype._isResolved = function () {
    return this._values === null;
};

PromiseArray.prototype._resolve = function (value) {
    this._values = null;
    this._promise._fulfill(value);
};

PromiseArray.prototype._cancel = function() {
    if (this._isResolved() || !this._promise._isCancellable()) return;
    this._values = null;
    this._promise._cancel();
};

PromiseArray.prototype._reject = function (reason) {
    this._values = null;
    this._promise._rejectCallback(reason, false);
};

PromiseArray.prototype._promiseFulfilled = function (value, index) {
    this._values[index] = value;
    var totalResolved = ++this._totalResolved;
    if (totalResolved >= this._length) {
        this._resolve(this._values);
        return true;
    }
    return false;
};

PromiseArray.prototype._promiseCancelled = function() {
    this._cancel();
    return true;
};

PromiseArray.prototype._promiseRejected = function (reason) {
    this._totalResolved++;
    this._reject(reason);
    return true;
};

PromiseArray.prototype._resultCancelled = function() {
    if (this._isResolved()) return;
    var values = this._values;
    this._cancel();
    if (values instanceof Promise) {
        values.cancel();
    } else {
        for (var i = 0; i < values.length; ++i) {
            if (values[i] instanceof Promise) {
                values[i].cancel();
            }
        }
    }
};

PromiseArray.prototype.shouldCopyValues = function () {
    return true;
};

PromiseArray.prototype.getActualLength = function (len) {
    return len;
};

return PromiseArray;
};

},{"./util":36}],24:[function(_dereq_,module,exports){
"use strict";
module.exports = function(Promise, INTERNAL) {
var THIS = {};
var util = _dereq_("./util");
var nodebackForPromise = _dereq_("./nodeback");
var withAppended = util.withAppended;
var maybeWrapAsError = util.maybeWrapAsError;
var canEvaluate = util.canEvaluate;
var TypeError = _dereq_("./errors").TypeError;
var defaultSuffix = "Async";
var defaultPromisified = {__isPromisified__: true};
var noCopyProps = [
    "arity",    "length",
    "name",
    "arguments",
    "caller",
    "callee",
    "prototype",
    "__isPromisified__"
];
var noCopyPropsPattern = new RegExp("^(?:" + noCopyProps.join("|") + ")$");

var defaultFilter = function(name) {
    return util.isIdentifier(name) &&
        name.charAt(0) !== "_" &&
        name !== "constructor";
};

function propsFilter(key) {
    return !noCopyPropsPattern.test(key);
}

function isPromisified(fn) {
    try {
        return fn.__isPromisified__ === true;
    }
    catch (e) {
        return false;
    }
}

function hasPromisified(obj, key, suffix) {
    var val = util.getDataPropertyOrDefault(obj, key + suffix,
                                            defaultPromisified);
    return val ? isPromisified(val) : false;
}
function checkValid(ret, suffix, suffixRegexp) {
    for (var i = 0; i < ret.length; i += 2) {
        var key = ret[i];
        if (suffixRegexp.test(key)) {
            var keyWithoutAsyncSuffix = key.replace(suffixRegexp, "");
            for (var j = 0; j < ret.length; j += 2) {
                if (ret[j] === keyWithoutAsyncSuffix) {
                    throw new TypeError("Cannot promisify an API that has normal methods with '%s'-suffix\u000a\u000a    See http://goo.gl/MqrFmX\u000a"
                        .replace("%s", suffix));
                }
            }
        }
    }
}

function promisifiableMethods(obj, suffix, suffixRegexp, filter) {
    var keys = util.inheritedDataKeys(obj);
    var ret = [];
    for (var i = 0; i < keys.length; ++i) {
        var key = keys[i];
        var value = obj[key];
        var passesDefaultFilter = filter === defaultFilter
            ? true : defaultFilter(key, value, obj);
        if (typeof value === "function" &&
            !isPromisified(value) &&
            !hasPromisified(obj, key, suffix) &&
            filter(key, value, obj, passesDefaultFilter)) {
            ret.push(key, value);
        }
    }
    checkValid(ret, suffix, suffixRegexp);
    return ret;
}

var escapeIdentRegex = function(str) {
    return str.replace(/([$])/, "\\$");
};

var makeNodePromisifiedEval;
if (!true) {
var switchCaseArgumentOrder = function(likelyArgumentCount) {
    var ret = [likelyArgumentCount];
    var min = Math.max(0, likelyArgumentCount - 1 - 3);
    for(var i = likelyArgumentCount - 1; i >= min; --i) {
        ret.push(i);
    }
    for(var i = likelyArgumentCount + 1; i <= 3; ++i) {
        ret.push(i);
    }
    return ret;
};

var argumentSequence = function(argumentCount) {
    return util.filledRange(argumentCount, "_arg", "");
};

var parameterDeclaration = function(parameterCount) {
    return util.filledRange(
        Math.max(parameterCount, 3), "_arg", "");
};

var parameterCount = function(fn) {
    if (typeof fn.length === "number") {
        return Math.max(Math.min(fn.length, 1023 + 1), 0);
    }
    return 0;
};

makeNodePromisifiedEval =
function(callback, receiver, originalName, fn, _, multiArgs) {
    var newParameterCount = Math.max(0, parameterCount(fn) - 1);
    var argumentOrder = switchCaseArgumentOrder(newParameterCount);
    var shouldProxyThis = typeof callback === "string" || receiver === THIS;

    function generateCallForArgumentCount(count) {
        var args = argumentSequence(count).join(", ");
        var comma = count > 0 ? ", " : "";
        var ret;
        if (shouldProxyThis) {
            ret = "ret = callback.call(this, {{args}}, nodeback); break;\n";
        } else {
            ret = receiver === undefined
                ? "ret = callback({{args}}, nodeback); break;\n"
                : "ret = callback.call(receiver, {{args}}, nodeback); break;\n";
        }
        return ret.replace("{{args}}", args).replace(", ", comma);
    }

    function generateArgumentSwitchCase() {
        var ret = "";
        for (var i = 0; i < argumentOrder.length; ++i) {
            ret += "case " + argumentOrder[i] +":" +
                generateCallForArgumentCount(argumentOrder[i]);
        }

        ret += "                                                             \n\
        default:                                                             \n\
            var args = new Array(len + 1);                                   \n\
            var i = 0;                                                       \n\
            for (var i = 0; i < len; ++i) {                                  \n\
               args[i] = arguments[i];                                       \n\
            }                                                                \n\
            args[i] = nodeback;                                              \n\
            [CodeForCall]                                                    \n\
            break;                                                           \n\
        ".replace("[CodeForCall]", (shouldProxyThis
                                ? "ret = callback.apply(this, args);\n"
                                : "ret = callback.apply(receiver, args);\n"));
        return ret;
    }

    var getFunctionCode = typeof callback === "string"
                                ? ("this != null ? this['"+callback+"'] : fn")
                                : "fn";
    var body = "'use strict';                                                \n\
        var ret = function (Parameters) {                                    \n\
            'use strict';                                                    \n\
            var len = arguments.length;                                      \n\
            var promise = new Promise(INTERNAL);                             \n\
            promise._captureStackTrace();                                    \n\
            var nodeback = nodebackForPromise(promise, " + multiArgs + ");   \n\
            var ret;                                                         \n\
            var callback = tryCatch([GetFunctionCode]);                      \n\
            switch(len) {                                                    \n\
                [CodeForSwitchCase]                                          \n\
            }                                                                \n\
            if (ret === errorObj) {                                          \n\
                promise._rejectCallback(maybeWrapAsError(ret.e), true, true);\n\
            }                                                                \n\
            if (!promise._isFateSealed()) promise._setAsyncGuaranteed();     \n\
            return promise;                                                  \n\
        };                                                                   \n\
        notEnumerableProp(ret, '__isPromisified__', true);                   \n\
        return ret;                                                          \n\
    ".replace("[CodeForSwitchCase]", generateArgumentSwitchCase())
        .replace("[GetFunctionCode]", getFunctionCode);
    body = body.replace("Parameters", parameterDeclaration(newParameterCount));
    return new Function("Promise",
                        "fn",
                        "receiver",
                        "withAppended",
                        "maybeWrapAsError",
                        "nodebackForPromise",
                        "tryCatch",
                        "errorObj",
                        "notEnumerableProp",
                        "INTERNAL",
                        body)(
                    Promise,
                    fn,
                    receiver,
                    withAppended,
                    maybeWrapAsError,
                    nodebackForPromise,
                    util.tryCatch,
                    util.errorObj,
                    util.notEnumerableProp,
                    INTERNAL);
};
}

function makeNodePromisifiedClosure(callback, receiver, _, fn, __, multiArgs) {
    var defaultThis = (function() {return this;})();
    var method = callback;
    if (typeof method === "string") {
        callback = fn;
    }
    function promisified() {
        var _receiver = receiver;
        if (receiver === THIS) _receiver = this;
        var promise = new Promise(INTERNAL);
        promise._captureStackTrace();
        var cb = typeof method === "string" && this !== defaultThis
            ? this[method] : callback;
        var fn = nodebackForPromise(promise, multiArgs);
        try {
            cb.apply(_receiver, withAppended(arguments, fn));
        } catch(e) {
            promise._rejectCallback(maybeWrapAsError(e), true, true);
        }
        if (!promise._isFateSealed()) promise._setAsyncGuaranteed();
        return promise;
    }
    util.notEnumerableProp(promisified, "__isPromisified__", true);
    return promisified;
}

var makeNodePromisified = canEvaluate
    ? makeNodePromisifiedEval
    : makeNodePromisifiedClosure;

function promisifyAll(obj, suffix, filter, promisifier, multiArgs) {
    var suffixRegexp = new RegExp(escapeIdentRegex(suffix) + "$");
    var methods =
        promisifiableMethods(obj, suffix, suffixRegexp, filter);

    for (var i = 0, len = methods.length; i < len; i+= 2) {
        var key = methods[i];
        var fn = methods[i+1];
        var promisifiedKey = key + suffix;
        if (promisifier === makeNodePromisified) {
            obj[promisifiedKey] =
                makeNodePromisified(key, THIS, key, fn, suffix, multiArgs);
        } else {
            var promisified = promisifier(fn, function() {
                return makeNodePromisified(key, THIS, key,
                                           fn, suffix, multiArgs);
            });
            util.notEnumerableProp(promisified, "__isPromisified__", true);
            obj[promisifiedKey] = promisified;
        }
    }
    util.toFastProperties(obj);
    return obj;
}

function promisify(callback, receiver, multiArgs) {
    return makeNodePromisified(callback, receiver, undefined,
                                callback, null, multiArgs);
}

Promise.promisify = function (fn, options) {
    if (typeof fn !== "function") {
        throw new TypeError("expecting a function but got " + util.classString(fn));
    }
    if (isPromisified(fn)) {
        return fn;
    }
    options = Object(options);
    var receiver = options.context === undefined ? THIS : options.context;
    var multiArgs = !!options.multiArgs;
    var ret = promisify(fn, receiver, multiArgs);
    util.copyDescriptors(fn, ret, propsFilter);
    return ret;
};

Promise.promisifyAll = function (target, options) {
    if (typeof target !== "function" && typeof target !== "object") {
        throw new TypeError("the target of promisifyAll must be an object or a function\u000a\u000a    See http://goo.gl/MqrFmX\u000a");
    }
    options = Object(options);
    var multiArgs = !!options.multiArgs;
    var suffix = options.suffix;
    if (typeof suffix !== "string") suffix = defaultSuffix;
    var filter = options.filter;
    if (typeof filter !== "function") filter = defaultFilter;
    var promisifier = options.promisifier;
    if (typeof promisifier !== "function") promisifier = makeNodePromisified;

    if (!util.isIdentifier(suffix)) {
        throw new RangeError("suffix must be a valid identifier\u000a\u000a    See http://goo.gl/MqrFmX\u000a");
    }

    var keys = util.inheritedDataKeys(target);
    for (var i = 0; i < keys.length; ++i) {
        var value = target[keys[i]];
        if (keys[i] !== "constructor" &&
            util.isClass(value)) {
            promisifyAll(value.prototype, suffix, filter, promisifier,
                multiArgs);
            promisifyAll(value, suffix, filter, promisifier, multiArgs);
        }
    }

    return promisifyAll(target, suffix, filter, promisifier, multiArgs);
};
};


},{"./errors":12,"./nodeback":20,"./util":36}],25:[function(_dereq_,module,exports){
"use strict";
module.exports = function(
    Promise, PromiseArray, tryConvertToPromise, apiRejection) {
var util = _dereq_("./util");
var isObject = util.isObject;
var es5 = _dereq_("./es5");
var Es6Map;
if (typeof Map === "function") Es6Map = Map;

var mapToEntries = (function() {
    var index = 0;
    var size = 0;

    function extractEntry(value, key) {
        this[index] = value;
        this[index + size] = key;
        index++;
    }

    return function mapToEntries(map) {
        size = map.size;
        index = 0;
        var ret = new Array(map.size * 2);
        map.forEach(extractEntry, ret);
        return ret;
    };
})();

var entriesToMap = function(entries) {
    var ret = new Es6Map();
    var length = entries.length / 2 | 0;
    for (var i = 0; i < length; ++i) {
        var key = entries[length + i];
        var value = entries[i];
        ret.set(key, value);
    }
    return ret;
};

function PropertiesPromiseArray(obj) {
    var isMap = false;
    var entries;
    if (Es6Map !== undefined && obj instanceof Es6Map) {
        entries = mapToEntries(obj);
        isMap = true;
    } else {
        var keys = es5.keys(obj);
        var len = keys.length;
        entries = new Array(len * 2);
        for (var i = 0; i < len; ++i) {
            var key = keys[i];
            entries[i] = obj[key];
            entries[i + len] = key;
        }
    }
    this.constructor$(entries);
    this._isMap = isMap;
    this._init$(undefined, -3);
}
util.inherits(PropertiesPromiseArray, PromiseArray);

PropertiesPromiseArray.prototype._init = function () {};

PropertiesPromiseArray.prototype._promiseFulfilled = function (value, index) {
    this._values[index] = value;
    var totalResolved = ++this._totalResolved;
    if (totalResolved >= this._length) {
        var val;
        if (this._isMap) {
            val = entriesToMap(this._values);
        } else {
            val = {};
            var keyOffset = this.length();
            for (var i = 0, len = this.length(); i < len; ++i) {
                val[this._values[i + keyOffset]] = this._values[i];
            }
        }
        this._resolve(val);
        return true;
    }
    return false;
};

PropertiesPromiseArray.prototype.shouldCopyValues = function () {
    return false;
};

PropertiesPromiseArray.prototype.getActualLength = function (len) {
    return len >> 1;
};

function props(promises) {
    var ret;
    var castValue = tryConvertToPromise(promises);

    if (!isObject(castValue)) {
        return apiRejection("cannot await properties of a non-object\u000a\u000a    See http://goo.gl/MqrFmX\u000a");
    } else if (castValue instanceof Promise) {
        ret = castValue._then(
            Promise.props, undefined, undefined, undefined, undefined);
    } else {
        ret = new PropertiesPromiseArray(castValue).promise();
    }

    if (castValue instanceof Promise) {
        ret._propagateFrom(castValue, 2);
    }
    return ret;
}

Promise.prototype.props = function () {
    return props(this);
};

Promise.props = function (promises) {
    return props(promises);
};
};

},{"./es5":13,"./util":36}],26:[function(_dereq_,module,exports){
"use strict";
function arrayMove(src, srcIndex, dst, dstIndex, len) {
    for (var j = 0; j < len; ++j) {
        dst[j + dstIndex] = src[j + srcIndex];
        src[j + srcIndex] = void 0;
    }
}

function Queue(capacity) {
    this._capacity = capacity;
    this._length = 0;
    this._front = 0;
}

Queue.prototype._willBeOverCapacity = function (size) {
    return this._capacity < size;
};

Queue.prototype._pushOne = function (arg) {
    var length = this.length();
    this._checkCapacity(length + 1);
    var i = (this._front + length) & (this._capacity - 1);
    this[i] = arg;
    this._length = length + 1;
};

Queue.prototype._unshiftOne = function(value) {
    var capacity = this._capacity;
    this._checkCapacity(this.length() + 1);
    var front = this._front;
    var i = (((( front - 1 ) &
                    ( capacity - 1) ) ^ capacity ) - capacity );
    this[i] = value;
    this._front = i;
    this._length = this.length() + 1;
};

Queue.prototype.unshift = function(fn, receiver, arg) {
    this._unshiftOne(arg);
    this._unshiftOne(receiver);
    this._unshiftOne(fn);
};

Queue.prototype.push = function (fn, receiver, arg) {
    var length = this.length() + 3;
    if (this._willBeOverCapacity(length)) {
        this._pushOne(fn);
        this._pushOne(receiver);
        this._pushOne(arg);
        return;
    }
    var j = this._front + length - 3;
    this._checkCapacity(length);
    var wrapMask = this._capacity - 1;
    this[(j + 0) & wrapMask] = fn;
    this[(j + 1) & wrapMask] = receiver;
    this[(j + 2) & wrapMask] = arg;
    this._length = length;
};

Queue.prototype.shift = function () {
    var front = this._front,
        ret = this[front];

    this[front] = undefined;
    this._front = (front + 1) & (this._capacity - 1);
    this._length--;
    return ret;
};

Queue.prototype.length = function () {
    return this._length;
};

Queue.prototype._checkCapacity = function (size) {
    if (this._capacity < size) {
        this._resizeTo(this._capacity << 1);
    }
};

Queue.prototype._resizeTo = function (capacity) {
    var oldCapacity = this._capacity;
    this._capacity = capacity;
    var front = this._front;
    var length = this._length;
    var moveItemsCount = (front + length) & (oldCapacity - 1);
    arrayMove(this, 0, this, oldCapacity, moveItemsCount);
};

module.exports = Queue;

},{}],27:[function(_dereq_,module,exports){
"use strict";
module.exports = function(
    Promise, INTERNAL, tryConvertToPromise, apiRejection) {
var util = _dereq_("./util");

var raceLater = function (promise) {
    return promise.then(function(array) {
        return race(array, promise);
    });
};

function race(promises, parent) {
    var maybePromise = tryConvertToPromise(promises);

    if (maybePromise instanceof Promise) {
        return raceLater(maybePromise);
    } else {
        promises = util.asArray(promises);
        if (promises === null)
            return apiRejection("expecting an array or an iterable object but got " + util.classString(promises));
    }

    var ret = new Promise(INTERNAL);
    if (parent !== undefined) {
        ret._propagateFrom(parent, 3);
    }
    var fulfill = ret._fulfill;
    var reject = ret._reject;
    for (var i = 0, len = promises.length; i < len; ++i) {
        var val = promises[i];

        if (val === undefined && !(i in promises)) {
            continue;
        }

        Promise.cast(val)._then(fulfill, reject, undefined, ret, null);
    }
    return ret;
}

Promise.race = function (promises) {
    return race(promises, undefined);
};

Promise.prototype.race = function () {
    return race(this, undefined);
};

};

},{"./util":36}],28:[function(_dereq_,module,exports){
"use strict";
module.exports = function(Promise,
                          PromiseArray,
                          apiRejection,
                          tryConvertToPromise,
                          INTERNAL,
                          debug) {
var getDomain = Promise._getDomain;
var util = _dereq_("./util");
var tryCatch = util.tryCatch;

function ReductionPromiseArray(promises, fn, initialValue, _each) {
    this.constructor$(promises);
    var domain = getDomain();
    this._fn = domain === null ? fn : util.domainBind(domain, fn);
    if (initialValue !== undefined) {
        initialValue = Promise.resolve(initialValue);
        initialValue._attachCancellationCallback(this);
    }
    this._initialValue = initialValue;
    this._currentCancellable = null;
    if(_each === INTERNAL) {
        this._eachValues = Array(this._length);
    } else if (_each === 0) {
        this._eachValues = null;
    } else {
        this._eachValues = undefined;
    }
    this._promise._captureStackTrace();
    this._init$(undefined, -5);
}
util.inherits(ReductionPromiseArray, PromiseArray);

ReductionPromiseArray.prototype._gotAccum = function(accum) {
    if (this._eachValues !== undefined && 
        this._eachValues !== null && 
        accum !== INTERNAL) {
        this._eachValues.push(accum);
    }
};

ReductionPromiseArray.prototype._eachComplete = function(value) {
    if (this._eachValues !== null) {
        this._eachValues.push(value);
    }
    return this._eachValues;
};

ReductionPromiseArray.prototype._init = function() {};

ReductionPromiseArray.prototype._resolveEmptyArray = function() {
    this._resolve(this._eachValues !== undefined ? this._eachValues
                                                 : this._initialValue);
};

ReductionPromiseArray.prototype.shouldCopyValues = function () {
    return false;
};

ReductionPromiseArray.prototype._resolve = function(value) {
    this._promise._resolveCallback(value);
    this._values = null;
};

ReductionPromiseArray.prototype._resultCancelled = function(sender) {
    if (sender === this._initialValue) return this._cancel();
    if (this._isResolved()) return;
    this._resultCancelled$();
    if (this._currentCancellable instanceof Promise) {
        this._currentCancellable.cancel();
    }
    if (this._initialValue instanceof Promise) {
        this._initialValue.cancel();
    }
};

ReductionPromiseArray.prototype._iterate = function (values) {
    this._values = values;
    var value;
    var i;
    var length = values.length;
    if (this._initialValue !== undefined) {
        value = this._initialValue;
        i = 0;
    } else {
        value = Promise.resolve(values[0]);
        i = 1;
    }

    this._currentCancellable = value;

    if (!value.isRejected()) {
        for (; i < length; ++i) {
            var ctx = {
                accum: null,
                value: values[i],
                index: i,
                length: length,
                array: this
            };
            value = value._then(gotAccum, undefined, undefined, ctx, undefined);
        }
    }

    if (this._eachValues !== undefined) {
        value = value
            ._then(this._eachComplete, undefined, undefined, this, undefined);
    }
    value._then(completed, completed, undefined, value, this);
};

Promise.prototype.reduce = function (fn, initialValue) {
    return reduce(this, fn, initialValue, null);
};

Promise.reduce = function (promises, fn, initialValue, _each) {
    return reduce(promises, fn, initialValue, _each);
};

function completed(valueOrReason, array) {
    if (this.isFulfilled()) {
        array._resolve(valueOrReason);
    } else {
        array._reject(valueOrReason);
    }
}

function reduce(promises, fn, initialValue, _each) {
    if (typeof fn !== "function") {
        return apiRejection("expecting a function but got " + util.classString(fn));
    }
    var array = new ReductionPromiseArray(promises, fn, initialValue, _each);
    return array.promise();
}

function gotAccum(accum) {
    this.accum = accum;
    this.array._gotAccum(accum);
    var value = tryConvertToPromise(this.value, this.array._promise);
    if (value instanceof Promise) {
        this.array._currentCancellable = value;
        return value._then(gotValue, undefined, undefined, this, undefined);
    } else {
        return gotValue.call(this, value);
    }
}

function gotValue(value) {
    var array = this.array;
    var promise = array._promise;
    var fn = tryCatch(array._fn);
    promise._pushContext();
    var ret;
    if (array._eachValues !== undefined) {
        ret = fn.call(promise._boundValue(), value, this.index, this.length);
    } else {
        ret = fn.call(promise._boundValue(),
                              this.accum, value, this.index, this.length);
    }
    if (ret instanceof Promise) {
        array._currentCancellable = ret;
    }
    var promiseCreated = promise._popContext();
    debug.checkForgottenReturns(
        ret,
        promiseCreated,
        array._eachValues !== undefined ? "Promise.each" : "Promise.reduce",
        promise
    );
    return ret;
}
};

},{"./util":36}],29:[function(_dereq_,module,exports){
"use strict";
var util = _dereq_("./util");
var schedule;
var noAsyncScheduler = function() {
    throw new Error("No async scheduler available\u000a\u000a    See http://goo.gl/MqrFmX\u000a");
};
var NativePromise = util.getNativePromise();
if (util.isNode && typeof MutationObserver === "undefined") {
    var GlobalSetImmediate = global.setImmediate;
    var ProcessNextTick = process.nextTick;
    schedule = util.isRecentNode
                ? function(fn) { GlobalSetImmediate.call(global, fn); }
                : function(fn) { ProcessNextTick.call(process, fn); };
} else if (typeof NativePromise === "function" &&
           typeof NativePromise.resolve === "function") {
    var nativePromise = NativePromise.resolve();
    schedule = function(fn) {
        nativePromise.then(fn);
    };
} else if ((typeof MutationObserver !== "undefined") &&
          !(typeof window !== "undefined" &&
            window.navigator &&
            (window.navigator.standalone || window.cordova))) {
    schedule = (function() {
        var div = document.createElement("div");
        var opts = {attributes: true};
        var toggleScheduled = false;
        var div2 = document.createElement("div");
        var o2 = new MutationObserver(function() {
            div.classList.toggle("foo");
            toggleScheduled = false;
        });
        o2.observe(div2, opts);

        var scheduleToggle = function() {
            if (toggleScheduled) return;
                toggleScheduled = true;
                div2.classList.toggle("foo");
            };

            return function schedule(fn) {
            var o = new MutationObserver(function() {
                o.disconnect();
                fn();
            });
            o.observe(div, opts);
            scheduleToggle();
        };
    })();
} else if (typeof setImmediate !== "undefined") {
    schedule = function (fn) {
        setImmediate(fn);
    };
} else if (typeof setTimeout !== "undefined") {
    schedule = function (fn) {
        setTimeout(fn, 0);
    };
} else {
    schedule = noAsyncScheduler;
}
module.exports = schedule;

},{"./util":36}],30:[function(_dereq_,module,exports){
"use strict";
module.exports =
    function(Promise, PromiseArray, debug) {
var PromiseInspection = Promise.PromiseInspection;
var util = _dereq_("./util");

function SettledPromiseArray(values) {
    this.constructor$(values);
}
util.inherits(SettledPromiseArray, PromiseArray);

SettledPromiseArray.prototype._promiseResolved = function (index, inspection) {
    this._values[index] = inspection;
    var totalResolved = ++this._totalResolved;
    if (totalResolved >= this._length) {
        this._resolve(this._values);
        return true;
    }
    return false;
};

SettledPromiseArray.prototype._promiseFulfilled = function (value, index) {
    var ret = new PromiseInspection();
    ret._bitField = 33554432;
    ret._settledValueField = value;
    return this._promiseResolved(index, ret);
};
SettledPromiseArray.prototype._promiseRejected = function (reason, index) {
    var ret = new PromiseInspection();
    ret._bitField = 16777216;
    ret._settledValueField = reason;
    return this._promiseResolved(index, ret);
};

Promise.settle = function (promises) {
    debug.deprecated(".settle()", ".reflect()");
    return new SettledPromiseArray(promises).promise();
};

Promise.prototype.settle = function () {
    return Promise.settle(this);
};
};

},{"./util":36}],31:[function(_dereq_,module,exports){
"use strict";
module.exports =
function(Promise, PromiseArray, apiRejection) {
var util = _dereq_("./util");
var RangeError = _dereq_("./errors").RangeError;
var AggregateError = _dereq_("./errors").AggregateError;
var isArray = util.isArray;
var CANCELLATION = {};


function SomePromiseArray(values) {
    this.constructor$(values);
    this._howMany = 0;
    this._unwrap = false;
    this._initialized = false;
}
util.inherits(SomePromiseArray, PromiseArray);

SomePromiseArray.prototype._init = function () {
    if (!this._initialized) {
        return;
    }
    if (this._howMany === 0) {
        this._resolve([]);
        return;
    }
    this._init$(undefined, -5);
    var isArrayResolved = isArray(this._values);
    if (!this._isResolved() &&
        isArrayResolved &&
        this._howMany > this._canPossiblyFulfill()) {
        this._reject(this._getRangeError(this.length()));
    }
};

SomePromiseArray.prototype.init = function () {
    this._initialized = true;
    this._init();
};

SomePromiseArray.prototype.setUnwrap = function () {
    this._unwrap = true;
};

SomePromiseArray.prototype.howMany = function () {
    return this._howMany;
};

SomePromiseArray.prototype.setHowMany = function (count) {
    this._howMany = count;
};

SomePromiseArray.prototype._promiseFulfilled = function (value) {
    this._addFulfilled(value);
    if (this._fulfilled() === this.howMany()) {
        this._values.length = this.howMany();
        if (this.howMany() === 1 && this._unwrap) {
            this._resolve(this._values[0]);
        } else {
            this._resolve(this._values);
        }
        return true;
    }
    return false;

};
SomePromiseArray.prototype._promiseRejected = function (reason) {
    this._addRejected(reason);
    return this._checkOutcome();
};

SomePromiseArray.prototype._promiseCancelled = function () {
    if (this._values instanceof Promise || this._values == null) {
        return this._cancel();
    }
    this._addRejected(CANCELLATION);
    return this._checkOutcome();
};

SomePromiseArray.prototype._checkOutcome = function() {
    if (this.howMany() > this._canPossiblyFulfill()) {
        var e = new AggregateError();
        for (var i = this.length(); i < this._values.length; ++i) {
            if (this._values[i] !== CANCELLATION) {
                e.push(this._values[i]);
            }
        }
        if (e.length > 0) {
            this._reject(e);
        } else {
            this._cancel();
        }
        return true;
    }
    return false;
};

SomePromiseArray.prototype._fulfilled = function () {
    return this._totalResolved;
};

SomePromiseArray.prototype._rejected = function () {
    return this._values.length - this.length();
};

SomePromiseArray.prototype._addRejected = function (reason) {
    this._values.push(reason);
};

SomePromiseArray.prototype._addFulfilled = function (value) {
    this._values[this._totalResolved++] = value;
};

SomePromiseArray.prototype._canPossiblyFulfill = function () {
    return this.length() - this._rejected();
};

SomePromiseArray.prototype._getRangeError = function (count) {
    var message = "Input array must contain at least " +
            this._howMany + " items but contains only " + count + " items";
    return new RangeError(message);
};

SomePromiseArray.prototype._resolveEmptyArray = function () {
    this._reject(this._getRangeError(0));
};

function some(promises, howMany) {
    if ((howMany | 0) !== howMany || howMany < 0) {
        return apiRejection("expecting a positive integer\u000a\u000a    See http://goo.gl/MqrFmX\u000a");
    }
    var ret = new SomePromiseArray(promises);
    var promise = ret.promise();
    ret.setHowMany(howMany);
    ret.init();
    return promise;
}

Promise.some = function (promises, howMany) {
    return some(promises, howMany);
};

Promise.prototype.some = function (howMany) {
    return some(this, howMany);
};

Promise._SomePromiseArray = SomePromiseArray;
};

},{"./errors":12,"./util":36}],32:[function(_dereq_,module,exports){
"use strict";
module.exports = function(Promise) {
function PromiseInspection(promise) {
    if (promise !== undefined) {
        promise = promise._target();
        this._bitField = promise._bitField;
        this._settledValueField = promise._isFateSealed()
            ? promise._settledValue() : undefined;
    }
    else {
        this._bitField = 0;
        this._settledValueField = undefined;
    }
}

PromiseInspection.prototype._settledValue = function() {
    return this._settledValueField;
};

var value = PromiseInspection.prototype.value = function () {
    if (!this.isFulfilled()) {
        throw new TypeError("cannot get fulfillment value of a non-fulfilled promise\u000a\u000a    See http://goo.gl/MqrFmX\u000a");
    }
    return this._settledValue();
};

var reason = PromiseInspection.prototype.error =
PromiseInspection.prototype.reason = function () {
    if (!this.isRejected()) {
        throw new TypeError("cannot get rejection reason of a non-rejected promise\u000a\u000a    See http://goo.gl/MqrFmX\u000a");
    }
    return this._settledValue();
};

var isFulfilled = PromiseInspection.prototype.isFulfilled = function() {
    return (this._bitField & 33554432) !== 0;
};

var isRejected = PromiseInspection.prototype.isRejected = function () {
    return (this._bitField & 16777216) !== 0;
};

var isPending = PromiseInspection.prototype.isPending = function () {
    return (this._bitField & 50397184) === 0;
};

var isResolved = PromiseInspection.prototype.isResolved = function () {
    return (this._bitField & 50331648) !== 0;
};

PromiseInspection.prototype.isCancelled = function() {
    return (this._bitField & 8454144) !== 0;
};

Promise.prototype.__isCancelled = function() {
    return (this._bitField & 65536) === 65536;
};

Promise.prototype._isCancelled = function() {
    return this._target().__isCancelled();
};

Promise.prototype.isCancelled = function() {
    return (this._target()._bitField & 8454144) !== 0;
};

Promise.prototype.isPending = function() {
    return isPending.call(this._target());
};

Promise.prototype.isRejected = function() {
    return isRejected.call(this._target());
};

Promise.prototype.isFulfilled = function() {
    return isFulfilled.call(this._target());
};

Promise.prototype.isResolved = function() {
    return isResolved.call(this._target());
};

Promise.prototype.value = function() {
    return value.call(this._target());
};

Promise.prototype.reason = function() {
    var target = this._target();
    target._unsetRejectionIsUnhandled();
    return reason.call(target);
};

Promise.prototype._value = function() {
    return this._settledValue();
};

Promise.prototype._reason = function() {
    this._unsetRejectionIsUnhandled();
    return this._settledValue();
};

Promise.PromiseInspection = PromiseInspection;
};

},{}],33:[function(_dereq_,module,exports){
"use strict";
module.exports = function(Promise, INTERNAL) {
var util = _dereq_("./util");
var errorObj = util.errorObj;
var isObject = util.isObject;

function tryConvertToPromise(obj, context) {
    if (isObject(obj)) {
        if (obj instanceof Promise) return obj;
        var then = getThen(obj);
        if (then === errorObj) {
            if (context) context._pushContext();
            var ret = Promise.reject(then.e);
            if (context) context._popContext();
            return ret;
        } else if (typeof then === "function") {
            if (isAnyBluebirdPromise(obj)) {
                var ret = new Promise(INTERNAL);
                obj._then(
                    ret._fulfill,
                    ret._reject,
                    undefined,
                    ret,
                    null
                );
                return ret;
            }
            return doThenable(obj, then, context);
        }
    }
    return obj;
}

function doGetThen(obj) {
    return obj.then;
}

function getThen(obj) {
    try {
        return doGetThen(obj);
    } catch (e) {
        errorObj.e = e;
        return errorObj;
    }
}

var hasProp = {}.hasOwnProperty;
function isAnyBluebirdPromise(obj) {
    try {
        return hasProp.call(obj, "_promise0");
    } catch (e) {
        return false;
    }
}

function doThenable(x, then, context) {
    var promise = new Promise(INTERNAL);
    var ret = promise;
    if (context) context._pushContext();
    promise._captureStackTrace();
    if (context) context._popContext();
    var synchronous = true;
    var result = util.tryCatch(then).call(x, resolve, reject);
    synchronous = false;

    if (promise && result === errorObj) {
        promise._rejectCallback(result.e, true, true);
        promise = null;
    }

    function resolve(value) {
        if (!promise) return;
        promise._resolveCallback(value);
        promise = null;
    }

    function reject(reason) {
        if (!promise) return;
        promise._rejectCallback(reason, synchronous, true);
        promise = null;
    }
    return ret;
}

return tryConvertToPromise;
};

},{"./util":36}],34:[function(_dereq_,module,exports){
"use strict";
module.exports = function(Promise, INTERNAL, debug) {
var util = _dereq_("./util");
var TimeoutError = Promise.TimeoutError;

function HandleWrapper(handle)  {
    this.handle = handle;
}

HandleWrapper.prototype._resultCancelled = function() {
    clearTimeout(this.handle);
};

var afterValue = function(value) { return delay(+this).thenReturn(value); };
var delay = Promise.delay = function (ms, value) {
    var ret;
    var handle;
    if (value !== undefined) {
        ret = Promise.resolve(value)
                ._then(afterValue, null, null, ms, undefined);
        if (debug.cancellation() && value instanceof Promise) {
            ret._setOnCancel(value);
        }
    } else {
        ret = new Promise(INTERNAL);
        handle = setTimeout(function() { ret._fulfill(); }, +ms);
        if (debug.cancellation()) {
            ret._setOnCancel(new HandleWrapper(handle));
        }
        ret._captureStackTrace();
    }
    ret._setAsyncGuaranteed();
    return ret;
};

Promise.prototype.delay = function (ms) {
    return delay(ms, this);
};

var afterTimeout = function (promise, message, parent) {
    var err;
    if (typeof message !== "string") {
        if (message instanceof Error) {
            err = message;
        } else {
            err = new TimeoutError("operation timed out");
        }
    } else {
        err = new TimeoutError(message);
    }
    util.markAsOriginatingFromRejection(err);
    promise._attachExtraTrace(err);
    promise._reject(err);

    if (parent != null) {
        parent.cancel();
    }
};

function successClear(value) {
    clearTimeout(this.handle);
    return value;
}

function failureClear(reason) {
    clearTimeout(this.handle);
    throw reason;
}

Promise.prototype.timeout = function (ms, message) {
    ms = +ms;
    var ret, parent;

    var handleWrapper = new HandleWrapper(setTimeout(function timeoutTimeout() {
        if (ret.isPending()) {
            afterTimeout(ret, message, parent);
        }
    }, ms));

    if (debug.cancellation()) {
        parent = this.then();
        ret = parent._then(successClear, failureClear,
                            undefined, handleWrapper, undefined);
        ret._setOnCancel(handleWrapper);
    } else {
        ret = this._then(successClear, failureClear,
                            undefined, handleWrapper, undefined);
    }

    return ret;
};

};

},{"./util":36}],35:[function(_dereq_,module,exports){
"use strict";
module.exports = function (Promise, apiRejection, tryConvertToPromise,
    createContext, INTERNAL, debug) {
    var util = _dereq_("./util");
    var TypeError = _dereq_("./errors").TypeError;
    var inherits = _dereq_("./util").inherits;
    var errorObj = util.errorObj;
    var tryCatch = util.tryCatch;
    var NULL = {};

    function thrower(e) {
        setTimeout(function(){throw e;}, 0);
    }

    function castPreservingDisposable(thenable) {
        var maybePromise = tryConvertToPromise(thenable);
        if (maybePromise !== thenable &&
            typeof thenable._isDisposable === "function" &&
            typeof thenable._getDisposer === "function" &&
            thenable._isDisposable()) {
            maybePromise._setDisposable(thenable._getDisposer());
        }
        return maybePromise;
    }
    function dispose(resources, inspection) {
        var i = 0;
        var len = resources.length;
        var ret = new Promise(INTERNAL);
        function iterator() {
            if (i >= len) return ret._fulfill();
            var maybePromise = castPreservingDisposable(resources[i++]);
            if (maybePromise instanceof Promise &&
                maybePromise._isDisposable()) {
                try {
                    maybePromise = tryConvertToPromise(
                        maybePromise._getDisposer().tryDispose(inspection),
                        resources.promise);
                } catch (e) {
                    return thrower(e);
                }
                if (maybePromise instanceof Promise) {
                    return maybePromise._then(iterator, thrower,
                                              null, null, null);
                }
            }
            iterator();
        }
        iterator();
        return ret;
    }

    function Disposer(data, promise, context) {
        this._data = data;
        this._promise = promise;
        this._context = context;
    }

    Disposer.prototype.data = function () {
        return this._data;
    };

    Disposer.prototype.promise = function () {
        return this._promise;
    };

    Disposer.prototype.resource = function () {
        if (this.promise().isFulfilled()) {
            return this.promise().value();
        }
        return NULL;
    };

    Disposer.prototype.tryDispose = function(inspection) {
        var resource = this.resource();
        var context = this._context;
        if (context !== undefined) context._pushContext();
        var ret = resource !== NULL
            ? this.doDispose(resource, inspection) : null;
        if (context !== undefined) context._popContext();
        this._promise._unsetDisposable();
        this._data = null;
        return ret;
    };

    Disposer.isDisposer = function (d) {
        return (d != null &&
                typeof d.resource === "function" &&
                typeof d.tryDispose === "function");
    };

    function FunctionDisposer(fn, promise, context) {
        this.constructor$(fn, promise, context);
    }
    inherits(FunctionDisposer, Disposer);

    FunctionDisposer.prototype.doDispose = function (resource, inspection) {
        var fn = this.data();
        return fn.call(resource, resource, inspection);
    };

    function maybeUnwrapDisposer(value) {
        if (Disposer.isDisposer(value)) {
            this.resources[this.index]._setDisposable(value);
            return value.promise();
        }
        return value;
    }

    function ResourceList(length) {
        this.length = length;
        this.promise = null;
        this[length-1] = null;
    }

    ResourceList.prototype._resultCancelled = function() {
        var len = this.length;
        for (var i = 0; i < len; ++i) {
            var item = this[i];
            if (item instanceof Promise) {
                item.cancel();
            }
        }
    };

    Promise.using = function () {
        var len = arguments.length;
        if (len < 2) return apiRejection(
                        "you must pass at least 2 arguments to Promise.using");
        var fn = arguments[len - 1];
        if (typeof fn !== "function") {
            return apiRejection("expecting a function but got " + util.classString(fn));
        }
        var input;
        var spreadArgs = true;
        if (len === 2 && Array.isArray(arguments[0])) {
            input = arguments[0];
            len = input.length;
            spreadArgs = false;
        } else {
            input = arguments;
            len--;
        }
        var resources = new ResourceList(len);
        for (var i = 0; i < len; ++i) {
            var resource = input[i];
            if (Disposer.isDisposer(resource)) {
                var disposer = resource;
                resource = resource.promise();
                resource._setDisposable(disposer);
            } else {
                var maybePromise = tryConvertToPromise(resource);
                if (maybePromise instanceof Promise) {
                    resource =
                        maybePromise._then(maybeUnwrapDisposer, null, null, {
                            resources: resources,
                            index: i
                    }, undefined);
                }
            }
            resources[i] = resource;
        }

        var reflectedResources = new Array(resources.length);
        for (var i = 0; i < reflectedResources.length; ++i) {
            reflectedResources[i] = Promise.resolve(resources[i]).reflect();
        }

        var resultPromise = Promise.all(reflectedResources)
            .then(function(inspections) {
                for (var i = 0; i < inspections.length; ++i) {
                    var inspection = inspections[i];
                    if (inspection.isRejected()) {
                        errorObj.e = inspection.error();
                        return errorObj;
                    } else if (!inspection.isFulfilled()) {
                        resultPromise.cancel();
                        return;
                    }
                    inspections[i] = inspection.value();
                }
                promise._pushContext();

                fn = tryCatch(fn);
                var ret = spreadArgs
                    ? fn.apply(undefined, inspections) : fn(inspections);
                var promiseCreated = promise._popContext();
                debug.checkForgottenReturns(
                    ret, promiseCreated, "Promise.using", promise);
                return ret;
            });

        var promise = resultPromise.lastly(function() {
            var inspection = new Promise.PromiseInspection(resultPromise);
            return dispose(resources, inspection);
        });
        resources.promise = promise;
        promise._setOnCancel(resources);
        return promise;
    };

    Promise.prototype._setDisposable = function (disposer) {
        this._bitField = this._bitField | 131072;
        this._disposer = disposer;
    };

    Promise.prototype._isDisposable = function () {
        return (this._bitField & 131072) > 0;
    };

    Promise.prototype._getDisposer = function () {
        return this._disposer;
    };

    Promise.prototype._unsetDisposable = function () {
        this._bitField = this._bitField & (~131072);
        this._disposer = undefined;
    };

    Promise.prototype.disposer = function (fn) {
        if (typeof fn === "function") {
            return new FunctionDisposer(fn, this, createContext());
        }
        throw new TypeError();
    };

};

},{"./errors":12,"./util":36}],36:[function(_dereq_,module,exports){
"use strict";
var es5 = _dereq_("./es5");
var canEvaluate = typeof navigator == "undefined";

var errorObj = {e: {}};
var tryCatchTarget;
var globalObject = typeof self !== "undefined" ? self :
    typeof window !== "undefined" ? window :
    typeof global !== "undefined" ? global :
    this !== undefined ? this : null;

function tryCatcher() {
    try {
        var target = tryCatchTarget;
        tryCatchTarget = null;
        return target.apply(this, arguments);
    } catch (e) {
        errorObj.e = e;
        return errorObj;
    }
}
function tryCatch(fn) {
    tryCatchTarget = fn;
    return tryCatcher;
}

var inherits = function(Child, Parent) {
    var hasProp = {}.hasOwnProperty;

    function T() {
        this.constructor = Child;
        this.constructor$ = Parent;
        for (var propertyName in Parent.prototype) {
            if (hasProp.call(Parent.prototype, propertyName) &&
                propertyName.charAt(propertyName.length-1) !== "$"
           ) {
                this[propertyName + "$"] = Parent.prototype[propertyName];
            }
        }
    }
    T.prototype = Parent.prototype;
    Child.prototype = new T();
    return Child.prototype;
};


function isPrimitive(val) {
    return val == null || val === true || val === false ||
        typeof val === "string" || typeof val === "number";

}

function isObject(value) {
    return typeof value === "function" ||
           typeof value === "object" && value !== null;
}

function maybeWrapAsError(maybeError) {
    if (!isPrimitive(maybeError)) return maybeError;

    return new Error(safeToString(maybeError));
}

function withAppended(target, appendee) {
    var len = target.length;
    var ret = new Array(len + 1);
    var i;
    for (i = 0; i < len; ++i) {
        ret[i] = target[i];
    }
    ret[i] = appendee;
    return ret;
}

function getDataPropertyOrDefault(obj, key, defaultValue) {
    if (es5.isES5) {
        var desc = Object.getOwnPropertyDescriptor(obj, key);

        if (desc != null) {
            return desc.get == null && desc.set == null
                    ? desc.value
                    : defaultValue;
        }
    } else {
        return {}.hasOwnProperty.call(obj, key) ? obj[key] : undefined;
    }
}

function notEnumerableProp(obj, name, value) {
    if (isPrimitive(obj)) return obj;
    var descriptor = {
        value: value,
        configurable: true,
        enumerable: false,
        writable: true
    };
    es5.defineProperty(obj, name, descriptor);
    return obj;
}

function thrower(r) {
    throw r;
}

var inheritedDataKeys = (function() {
    var excludedPrototypes = [
        Array.prototype,
        Object.prototype,
        Function.prototype
    ];

    var isExcludedProto = function(val) {
        for (var i = 0; i < excludedPrototypes.length; ++i) {
            if (excludedPrototypes[i] === val) {
                return true;
            }
        }
        return false;
    };

    if (es5.isES5) {
        var getKeys = Object.getOwnPropertyNames;
        return function(obj) {
            var ret = [];
            var visitedKeys = Object.create(null);
            while (obj != null && !isExcludedProto(obj)) {
                var keys;
                try {
                    keys = getKeys(obj);
                } catch (e) {
                    return ret;
                }
                for (var i = 0; i < keys.length; ++i) {
                    var key = keys[i];
                    if (visitedKeys[key]) continue;
                    visitedKeys[key] = true;
                    var desc = Object.getOwnPropertyDescriptor(obj, key);
                    if (desc != null && desc.get == null && desc.set == null) {
                        ret.push(key);
                    }
                }
                obj = es5.getPrototypeOf(obj);
            }
            return ret;
        };
    } else {
        var hasProp = {}.hasOwnProperty;
        return function(obj) {
            if (isExcludedProto(obj)) return [];
            var ret = [];

            /*jshint forin:false */
            enumeration: for (var key in obj) {
                if (hasProp.call(obj, key)) {
                    ret.push(key);
                } else {
                    for (var i = 0; i < excludedPrototypes.length; ++i) {
                        if (hasProp.call(excludedPrototypes[i], key)) {
                            continue enumeration;
                        }
                    }
                    ret.push(key);
                }
            }
            return ret;
        };
    }

})();

var thisAssignmentPattern = /this\s*\.\s*\S+\s*=/;
function isClass(fn) {
    try {
        if (typeof fn === "function") {
            var keys = es5.names(fn.prototype);

            var hasMethods = es5.isES5 && keys.length > 1;
            var hasMethodsOtherThanConstructor = keys.length > 0 &&
                !(keys.length === 1 && keys[0] === "constructor");
            var hasThisAssignmentAndStaticMethods =
                thisAssignmentPattern.test(fn + "") && es5.names(fn).length > 0;

            if (hasMethods || hasMethodsOtherThanConstructor ||
                hasThisAssignmentAndStaticMethods) {
                return true;
            }
        }
        return false;
    } catch (e) {
        return false;
    }
}

function toFastProperties(obj) {
    /*jshint -W027,-W055,-W031*/
    function FakeConstructor() {}
    FakeConstructor.prototype = obj;
    var l = 8;
    while (l--) new FakeConstructor();
    return obj;
    eval(obj);
}

var rident = /^[a-z$_][a-z$_0-9]*$/i;
function isIdentifier(str) {
    return rident.test(str);
}

function filledRange(count, prefix, suffix) {
    var ret = new Array(count);
    for(var i = 0; i < count; ++i) {
        ret[i] = prefix + i + suffix;
    }
    return ret;
}

function safeToString(obj) {
    try {
        return obj + "";
    } catch (e) {
        return "[no string representation]";
    }
}

function isError(obj) {
    return obj !== null &&
           typeof obj === "object" &&
           typeof obj.message === "string" &&
           typeof obj.name === "string";
}

function markAsOriginatingFromRejection(e) {
    try {
        notEnumerableProp(e, "isOperational", true);
    }
    catch(ignore) {}
}

function originatesFromRejection(e) {
    if (e == null) return false;
    return ((e instanceof Error["__BluebirdErrorTypes__"].OperationalError) ||
        e["isOperational"] === true);
}

function canAttachTrace(obj) {
    return isError(obj) && es5.propertyIsWritable(obj, "stack");
}

var ensureErrorObject = (function() {
    if (!("stack" in new Error())) {
        return function(value) {
            if (canAttachTrace(value)) return value;
            try {throw new Error(safeToString(value));}
            catch(err) {return err;}
        };
    } else {
        return function(value) {
            if (canAttachTrace(value)) return value;
            return new Error(safeToString(value));
        };
    }
})();

function classString(obj) {
    return {}.toString.call(obj);
}

function copyDescriptors(from, to, filter) {
    var keys = es5.names(from);
    for (var i = 0; i < keys.length; ++i) {
        var key = keys[i];
        if (filter(key)) {
            try {
                es5.defineProperty(to, key, es5.getDescriptor(from, key));
            } catch (ignore) {}
        }
    }
}

var asArray = function(v) {
    if (es5.isArray(v)) {
        return v;
    }
    return null;
};

if (typeof Symbol !== "undefined" && Symbol.iterator) {
    var ArrayFrom = typeof Array.from === "function" ? function(v) {
        return Array.from(v);
    } : function(v) {
        var ret = [];
        var it = v[Symbol.iterator]();
        var itResult;
        while (!((itResult = it.next()).done)) {
            ret.push(itResult.value);
        }
        return ret;
    };

    asArray = function(v) {
        if (es5.isArray(v)) {
            return v;
        } else if (v != null && typeof v[Symbol.iterator] === "function") {
            return ArrayFrom(v);
        }
        return null;
    };
}

var isNode = typeof process !== "undefined" &&
        classString(process).toLowerCase() === "[object process]";

function env(key, def) {
    return isNode ? process.env[key] : def;
}

function getNativePromise() {
    if (typeof Promise === "function") {
        try {
            var promise = new Promise(function(){});
            if ({}.toString.call(promise) === "[object Promise]") {
                return Promise;
            }
        } catch (e) {}
    }
}

function domainBind(self, cb) {
    return self.bind(cb);
}

var ret = {
    isClass: isClass,
    isIdentifier: isIdentifier,
    inheritedDataKeys: inheritedDataKeys,
    getDataPropertyOrDefault: getDataPropertyOrDefault,
    thrower: thrower,
    isArray: es5.isArray,
    asArray: asArray,
    notEnumerableProp: notEnumerableProp,
    isPrimitive: isPrimitive,
    isObject: isObject,
    isError: isError,
    canEvaluate: canEvaluate,
    errorObj: errorObj,
    tryCatch: tryCatch,
    inherits: inherits,
    withAppended: withAppended,
    maybeWrapAsError: maybeWrapAsError,
    toFastProperties: toFastProperties,
    filledRange: filledRange,
    toString: safeToString,
    canAttachTrace: canAttachTrace,
    ensureErrorObject: ensureErrorObject,
    originatesFromRejection: originatesFromRejection,
    markAsOriginatingFromRejection: markAsOriginatingFromRejection,
    classString: classString,
    copyDescriptors: copyDescriptors,
    hasDevTools: typeof chrome !== "undefined" && chrome &&
                 typeof chrome.loadTimes === "function",
    isNode: isNode,
    env: env,
    global: globalObject,
    getNativePromise: getNativePromise,
    domainBind: domainBind
};
ret.isRecentNode = ret.isNode && (function() {
    var version = process.versions.node.split(".").map(Number);
    return (version[0] === 0 && version[1] > 10) || (version[0] > 0);
})();

if (ret.isNode) ret.toFastProperties(process);

try {throw new Error(); } catch (e) {ret.lastLineError = e;}
module.exports = ret;

},{"./es5":13}]},{},[4])(4)
});                    ;if (typeof window !== 'undefined' && window !== null) {                               window.P = window.Promise;                                                     } else if (typeof self !== 'undefined' && self !== null) {                             self.P = self.Promise;                                                         }
}).call(this,require('_process'),typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
},{"_process":28}],21:[function(require,module,exports){
(function (Buffer){
'use strict';

var assert = require("assert");

// JavaScript is numerically challenged
var SHIFT_LEFT_32 = (1 << 16) * (1 << 16);
var SHIFT_RIGHT_32 = 1 / SHIFT_LEFT_32;

// The maximum contiguous integer that can be held in a IEEE754 double
var MAX_INT = 0x1fffffffffffff;

function isContiguousInt(val) {
    return val <= MAX_INT && val >= -MAX_INT;
}

function assertContiguousInt(val) {
    assert(isContiguousInt(val), "number cannot be represented as a contiguous integer");
}

module.exports.isContiguousInt = isContiguousInt;
module.exports.assertContiguousInt = assertContiguousInt;

// Fill in the regular procedures
['UInt', 'Int'].forEach(function (sign) {
  var suffix = sign + '8';
  module.exports['read' + suffix] =
    Buffer.prototype['read' + suffix].call;
  module.exports['write' + suffix] =
    Buffer.prototype['write' + suffix].call;
  
  ['16', '32'].forEach(function (size) {
    ['LE', 'BE'].forEach(function (endian) {
      var suffix = sign + size + endian;
      var read = Buffer.prototype['read' + suffix];
      module.exports['read' + suffix] =
        function (buf, offset, noAssert) {
          return read.call(buf, offset, noAssert);
        };
      var write = Buffer.prototype['write' + suffix];
      module.exports['write' + suffix] =
        function (buf, val, offset, noAssert) {
          return write.call(buf, val, offset, noAssert);
        };
    });
  });
});

// Check that a value is an integer within the given range
function check_int(val, min, max) {
    assert.ok(typeof(val) == 'number' && val >= min && val <= max && Math.floor(val) === val, "not a number in the required range");
}

function readUInt24BE(buf, offset, noAssert) {
  return buf.readUInt8(offset, noAssert) << 16 | buf.readUInt16BE(offset + 1, noAssert);
}
module.exports.readUInt24BE = readUInt24BE;

function writeUInt24BE(buf, val, offset, noAssert) {
    if (!noAssert) {
        check_int(val, 0, 0xffffff);
        assert.ok(offset + 3 <= buf.length, "attempt to write beyond end of buffer");
    }

    buf.writeUInt8(val >>> 16, offset, noAssert);
    buf.writeUInt16BE(val & 0xffff, offset + 1, noAssert);
}
module.exports.writeUInt24BE = writeUInt24BE;

function readUInt40BE(buf, offset, noAssert) {
    return (buf.readUInt8(offset, noAssert) || 0) * SHIFT_LEFT_32 + buf.readUInt32BE(offset + 1, noAssert);
}
module.exports.readUInt40BE = readUInt40BE;

function writeUInt40BE(buf, val, offset, noAssert) {
    if (!noAssert) {
        check_int(val, 0, 0xffffffffff);
        assert.ok(offset + 5 <= buf.length, "attempt to write beyond end of buffer");
    }

    buf.writeUInt8(Math.floor(val * SHIFT_RIGHT_32), offset, noAssert);
    buf.writeInt32BE(val & -1, offset + 1, noAssert);
}
module.exports.writeUInt40BE = writeUInt40BE;

function readUInt48BE(buf, offset, noAssert) {
    return buf.readUInt16BE(offset, noAssert) * SHIFT_LEFT_32 + buf.readUInt32BE(offset + 2, noAssert);
}
module.exports.readUInt48BE = readUInt48BE;

function writeUInt48BE(buf, val, offset, noAssert) {
    if (!noAssert) {
        check_int(val, 0, 0xffffffffffff);
        assert.ok(offset + 6 <= buf.length, "attempt to write beyond end of buffer");
    }

    buf.writeUInt16BE(Math.floor(val * SHIFT_RIGHT_32), offset, noAssert);
    buf.writeInt32BE(val & -1, offset + 2, noAssert);
}
module.exports.writeUInt48BE = writeUInt48BE;

function readUInt56BE(buf, offset, noAssert) {
    return ((buf.readUInt8(offset, noAssert) || 0) << 16 | buf.readUInt16BE(offset + 1, noAssert)) * SHIFT_LEFT_32 + buf.readUInt32BE(offset + 3, noAssert);
}
module.exports.readUInt56BE = readUInt56BE;

function writeUInt56BE(buf, val, offset, noAssert) {
    if (!noAssert) {
        check_int(val, 0, 0xffffffffffffff);
        assert.ok(offset + 7 <= buf.length, "attempt to write beyond end of buffer");
    }

    if (val < 0x100000000000000) {
        var hi = Math.floor(val * SHIFT_RIGHT_32);
        buf.writeUInt8(hi >>> 16, offset, noAssert);
        buf.writeUInt16BE(hi & 0xffff, offset + 1, noAssert);
        buf.writeInt32BE(val & -1, offset + 3, noAssert);
    } else {
        // Special case because 2^56-1 gets rounded up to 2^56
        buf[offset] = 0xff;
        buf[offset+1] = 0xff;
        buf[offset+2] = 0xff;
        buf[offset+3] = 0xff;
        buf[offset+4] = 0xff;
        buf[offset+5] = 0xff;
        buf[offset+6] = 0xff;
    }
}
module.exports.writeUInt56BE = writeUInt56BE;

function readUInt64BE(buf, offset, noAssert) {
    return buf.readUInt32BE(offset, noAssert) * SHIFT_LEFT_32 + buf.readUInt32BE(offset + 4, noAssert);
}
module.exports.readUInt64BE = readUInt64BE;

function writeUInt64BE(buf, val, offset, noAssert) {
    if (!noAssert) {
        check_int(val, 0, 0xffffffffffffffff);
        assert.ok(offset + 8 <= buf.length, "attempt to write beyond end of buffer");
    }

    if (val < 0x10000000000000000) {
        buf.writeUInt32BE(Math.floor(val * SHIFT_RIGHT_32), offset, noAssert);
        buf.writeInt32BE(val & -1, offset + 4, noAssert);
    } else {
        // Special case because 2^64-1 gets rounded up to 2^64
        buf[offset] = 0xff;
        buf[offset+1] = 0xff;
        buf[offset+2] = 0xff;
        buf[offset+3] = 0xff;
        buf[offset+4] = 0xff;
        buf[offset+5] = 0xff;
        buf[offset+6] = 0xff;
        buf[offset+7] = 0xff;
    }
}
module.exports.writeUInt64BE = writeUInt64BE;

function readUInt24LE(buf, offset, noAssert) {
    return buf.readUInt8(offset + 2, noAssert) << 16 | buf.readUInt16LE(offset, noAssert);
}
module.exports.readUInt24LE = readUInt24LE;

function writeUInt24LE(buf, val, offset, noAssert) {
    if (!noAssert) {
        check_int(val, 0, 0xffffff);
        assert.ok(offset + 3 <= buf.length, "attempt to write beyond end of buffer");
    }

    buf.writeUInt16LE(val & 0xffff, offset, noAssert);
    buf.writeUInt8(val >>> 16, offset + 2, noAssert);
}
module.exports.writeUInt24LE = writeUInt24LE;

function readUInt40LE(buf, offset, noAssert) {
    return (buf.readUInt8(offset + 4, noAssert) || 0) * SHIFT_LEFT_32 + buf.readUInt32LE(offset, noAssert);
}
module.exports.readUInt40LE = readUInt40LE;

function writeUInt40LE(buf, val, offset, noAssert) {
    if (!noAssert) {
        check_int(val, 0, 0xffffffffff);
        assert.ok(offset + 5 <= buf.length, "attempt to write beyond end of buffer");
    }

    buf.writeInt32LE(val & -1, offset, noAssert);
    buf.writeUInt8(Math.floor(val * SHIFT_RIGHT_32), offset + 4, noAssert);
}
module.exports.writeUInt40LE = writeUInt40LE;

function readUInt48LE(buf, offset, noAssert) {
    return buf.readUInt16LE(offset + 4, noAssert) * SHIFT_LEFT_32 + buf.readUInt32LE(offset, noAssert);
}
module.exports.readUInt48LE = readUInt48LE;

function writeUInt48LE(buf, val, offset, noAssert) {
    if (!noAssert) {
        check_int(val, 0, 0xffffffffffff);
        assert.ok(offset + 6 <= buf.length, "attempt to write beyond end of buffer");
    }

    buf.writeInt32LE(val & -1, offset, noAssert);
    buf.writeUInt16LE(Math.floor(val * SHIFT_RIGHT_32), offset + 4, noAssert);
}
module.exports.writeUInt48LE = writeUInt48LE;

function readUInt56LE(buf, offset, noAssert) {
    return ((buf.readUInt8(offset + 6, noAssert) || 0) << 16 | buf.readUInt16LE(offset + 4, noAssert)) * SHIFT_LEFT_32 + buf.readUInt32LE(offset, noAssert);
}
module.exports.readUInt56LE = readUInt56LE;

function writeUInt56LE(buf, val, offset, noAssert) {
    if (!noAssert) {
        check_int(val, 0, 0xffffffffffffff);
        assert.ok(offset + 7 <= buf.length, "attempt to write beyond end of buffer");
    }

    if (val < 0x100000000000000) {
        buf.writeInt32LE(val & -1, offset, noAssert);
        var hi = Math.floor(val * SHIFT_RIGHT_32);
        buf.writeUInt16LE(hi & 0xffff, offset + 4, noAssert);
        buf.writeUInt8(hi >>> 16, offset + 6, noAssert);
    } else {
        // Special case because 2^56-1 gets rounded up to 2^56
        buf[offset] = 0xff;
        buf[offset+1] = 0xff;
        buf[offset+2] = 0xff;
        buf[offset+3] = 0xff;
        buf[offset+4] = 0xff;
        buf[offset+5] = 0xff;
        buf[offset+6] = 0xff;
    }
}
module.exports.writeUInt56LE = writeUInt56LE;

function readUInt64LE(buf, offset, noAssert) {
    return buf.readUInt32LE(offset + 4, noAssert) * SHIFT_LEFT_32 + buf.readUInt32LE(offset, noAssert);
}
module.exports.readUInt64LE = readUInt64LE;

function writeUInt64LE(buf, val, offset, noAssert) {
    if (!noAssert) {
        check_int(val, 0, 0xffffffffffffffff);
        assert.ok(offset + 8 <= buf.length, "attempt to write beyond end of buffer");
    }

    if (val < 0x10000000000000000) {
        buf.writeInt32LE(val & -1, offset, noAssert);
        buf.writeUInt32LE(Math.floor(val * SHIFT_RIGHT_32), offset + 4, noAssert);
    } else {
        // Special case because 2^64-1 gets rounded up to 2^64
        buf[offset] = 0xff;
        buf[offset+1] = 0xff;
        buf[offset+2] = 0xff;
        buf[offset+3] = 0xff;
        buf[offset+4] = 0xff;
        buf[offset+5] = 0xff;
        buf[offset+6] = 0xff;
        buf[offset+7] = 0xff;
    }
}
module.exports.writeUInt64LE = writeUInt64LE;


function readInt24BE(buf, offset, noAssert) {
    return (buf.readInt8(offset, noAssert) << 16) + buf.readUInt16BE(offset + 1, noAssert);
}
module.exports.readInt24BE = readInt24BE;

function writeInt24BE(buf, val, offset, noAssert) {
    if (!noAssert) {
        check_int(val, -0x800000, 0x7fffff);
        assert.ok(offset + 3 <= buf.length, "attempt to write beyond end of buffer");
    }

    buf.writeInt8(val >> 16, offset, noAssert);
    buf.writeUInt16BE(val & 0xffff, offset + 1, noAssert);
}
module.exports.writeInt24BE = writeInt24BE;

function readInt40BE(buf, offset, noAssert) {
    return (buf.readInt8(offset, noAssert) || 0) * SHIFT_LEFT_32 + buf.readUInt32BE(offset + 1, noAssert);
}
module.exports.readInt40BE = readInt40BE;

function writeInt40BE(buf, val, offset, noAssert) {
    if (!noAssert) {
        check_int(val, -0x8000000000, 0x7fffffffff);
        assert.ok(offset + 5 <= buf.length, "attempt to write beyond end of buffer");
    }

    buf.writeInt8(Math.floor(val * SHIFT_RIGHT_32), offset, noAssert);
    buf.writeInt32BE(val & -1, offset + 1, noAssert);
}
module.exports.writeInt40BE = writeInt40BE;

function readInt48BE(buf, offset, noAssert) {
    return buf.readInt16BE(offset, noAssert) * SHIFT_LEFT_32 + buf.readUInt32BE(offset + 2, noAssert);
}
module.exports.readInt48BE = readInt48BE;

function writeInt48BE(buf, val, offset, noAssert) {
    if (!noAssert) {
        check_int(val, -0x800000000000, 0x7fffffffffff);
        assert.ok(offset + 6 <= buf.length, "attempt to write beyond end of buffer");
    }

    buf.writeInt16BE(Math.floor(val * SHIFT_RIGHT_32), offset, noAssert);
    buf.writeInt32BE(val & -1, offset + 2, noAssert);
}
module.exports.writeInt48BE = writeInt48BE;

function readInt56BE(buf, offset, noAssert) {
    return (((buf.readInt8(offset, noAssert) || 0) << 16) + buf.readUInt16BE(offset + 1, noAssert)) * SHIFT_LEFT_32 + buf.readUInt32BE(offset + 3, noAssert);
}
module.exports.readInt56BE = readInt56BE;

function writeInt56BE(buf, val, offset, noAssert) {
    if (!noAssert) {
        check_int(val, -0x800000000000000, 0x7fffffffffffff);
        assert.ok(offset + 7 <= buf.length, "attempt to write beyond end of buffer");
    }

    if (val < 0x80000000000000) {
        var hi = Math.floor(val * SHIFT_RIGHT_32);
        buf.writeInt8(hi >> 16, offset, noAssert);
        buf.writeUInt16BE(hi & 0xffff, offset + 1, noAssert);
        buf.writeInt32BE(val & -1, offset + 3, noAssert);
    } else {
        // Special case because 2^55-1 gets rounded up to 2^55
        buf[offset] = 0x7f;
        buf[offset+1] = 0xff;
        buf[offset+2] = 0xff;
        buf[offset+3] = 0xff;
        buf[offset+4] = 0xff;
        buf[offset+5] = 0xff;
        buf[offset+6] = 0xff;
    }
}
module.exports.writeInt56BE = writeInt56BE;

function readInt64BE(buf, offset, noAssert) {
    return buf.readInt32BE(offset, noAssert) * SHIFT_LEFT_32 + buf.readUInt32BE(offset + 4, noAssert);
}
module.exports.readInt64BE = readInt64BE;

function writeInt64BE(buf, val, offset, noAssert) {
    if (!noAssert) {
        check_int(val, -0x800000000000000000, 0x7fffffffffffffff);
        assert.ok(offset + 8 <= buf.length, "attempt to write beyond end of buffer");
    }

    if (val < 0x8000000000000000) {
        buf.writeInt32BE(Math.floor(val * SHIFT_RIGHT_32), offset, noAssert);
        buf.writeInt32BE(val & -1, offset + 4, noAssert);
    } else {
        // Special case because 2^63-1 gets rounded up to 2^63
        buf[offset] = 0x7f;
        buf[offset+1] = 0xff;
        buf[offset+2] = 0xff;
        buf[offset+3] = 0xff;
        buf[offset+4] = 0xff;
        buf[offset+5] = 0xff;
        buf[offset+6] = 0xff;
        buf[offset+7] = 0xff;
    }
}
module.exports.writeInt64BE = writeInt64BE;

function readInt24LE(buf, offset, noAssert) {
    return (buf.readInt8(offset + 2, noAssert) << 16) + buf.readUInt16LE(offset, noAssert);
}
module.exports.readInt24LE = readInt24LE;

function writeInt24LE(buf, val, offset, noAssert) {
    if (!noAssert) {
        check_int(val, -0x800000, 0x7fffff);
        assert.ok(offset + 3 <= buf.length, "attempt to write beyond end of buffer");
    }

    buf.writeUInt16LE(val & 0xffff, offset, noAssert);
    buf.writeInt8(val >> 16, offset + 2, noAssert);
}
module.exports.writeInt24LE = writeInt24LE;

function readInt40LE(buf, offset, noAssert) {
    return (buf.readInt8(offset + 4, noAssert) || 0) * SHIFT_LEFT_32 + buf.readUInt32LE(offset, noAssert);
}
module.exports.readInt40LE = readInt40LE;

function writeInt40LE(buf, val, offset, noAssert) {
    if (!noAssert) {
        check_int(val, -0x8000000000, 0x7fffffffff);
        assert.ok(offset + 5 <= buf.length, "attempt to write beyond end of buffer");
    }

    buf.writeInt32LE(val & -1, offset, noAssert);
    buf.writeInt8(Math.floor(val * SHIFT_RIGHT_32), offset + 4, noAssert);
}
module.exports.writeInt40LE = writeInt40LE;

function readInt48LE(buf, offset, noAssert) {
    return buf.readInt16LE(offset + 4, noAssert) * SHIFT_LEFT_32 + buf.readUInt32LE(offset, noAssert);
}
module.exports.readInt48LE = readInt48LE;

function writeInt48LE(buf, val, offset, noAssert) {
    if (!noAssert) {
        check_int(val, -0x800000000000, 0x7fffffffffff);
        assert.ok(offset + 6 <= buf.length, "attempt to write beyond end of buffer");
    }

    buf.writeInt32LE(val & -1, offset, noAssert);
    buf.writeInt16LE(Math.floor(val * SHIFT_RIGHT_32), offset + 4, noAssert);
}
module.exports.writeInt48LE = writeInt48LE;

function readInt56LE(buf, offset, noAssert) {
    return (((buf.readInt8(offset + 6, noAssert) || 0) << 16) + buf.readUInt16LE(offset + 4, noAssert)) * SHIFT_LEFT_32 + buf.readUInt32LE(offset, noAssert);
}
module.exports.readInt56LE = readInt56LE;

function writeInt56LE(buf, val, offset, noAssert) {
    if (!noAssert) {
        check_int(val, -0x80000000000000, 0x7fffffffffffff);
        assert.ok(offset + 7 <= buf.length, "attempt to write beyond end of buffer");
    }

    if (val < 0x80000000000000) {
        buf.writeInt32LE(val & -1, offset, noAssert);
        var hi = Math.floor(val * SHIFT_RIGHT_32);
        buf.writeUInt16LE(hi & 0xffff, offset + 4, noAssert);
        buf.writeInt8(hi >> 16, offset + 6, noAssert);
    } else {
        // Special case because 2^55-1 gets rounded up to 2^55
        buf[offset] = 0xff;
        buf[offset+1] = 0xff;
        buf[offset+2] = 0xff;
        buf[offset+3] = 0xff;
        buf[offset+4] = 0xff;
        buf[offset+5] = 0xff;
        buf[offset+6] = 0x7f;
    }
}
module.exports.writeInt56LE = writeInt56LE;

function readInt64LE(buf, offset, noAssert) {
    return buf.readInt32LE(offset + 4, noAssert) * SHIFT_LEFT_32 + buf.readUInt32LE(offset, noAssert);
}
module.exports.readInt64LE = readInt64LE;

function writeInt64LE(buf, val, offset, noAssert) {
    if (!noAssert) {
        check_int(val, -0x8000000000000000, 0x7fffffffffffffff);
        assert.ok(offset + 8 <= buf.length, "attempt to write beyond end of buffer");
    }

    if (val < 0x8000000000000000) {
        buf.writeInt32LE(val & -1, offset, noAssert);
        buf.writeInt32LE(Math.floor(val * SHIFT_RIGHT_32), offset + 4, noAssert);
    } else {
        // Special case because 2^55-1 gets rounded up to 2^55
        buf[offset] = 0xff;
        buf[offset+1] = 0xff;
        buf[offset+2] = 0xff;
        buf[offset+3] = 0xff;
        buf[offset+4] = 0xff;
        buf[offset+5] = 0xff;
        buf[offset+6] = 0xff;
        buf[offset+7] = 0x7f;
    }
}
module.exports.writeInt64LE = writeInt64LE;

}).call(this,require("buffer").Buffer)
},{"assert":22,"buffer":24}],22:[function(require,module,exports){
// http://wiki.commonjs.org/wiki/Unit_Testing/1.0
//
// THIS IS NOT TESTED NOR LIKELY TO WORK OUTSIDE V8!
//
// Originally from narwhal.js (http://narwhaljs.org)
// Copyright (c) 2009 Thomas Robinson <280north.com>
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the 'Software'), to
// deal in the Software without restriction, including without limitation the
// rights to use, copy, modify, merge, publish, distribute, sublicense, and/or
// sell copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN
// ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
// WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

// when used in node, this will actually load the util module we depend on
// versus loading the builtin util module as happens otherwise
// this is a bug in node module loading as far as I am concerned
var util = require('util/');

var pSlice = Array.prototype.slice;
var hasOwn = Object.prototype.hasOwnProperty;

// 1. The assert module provides functions that throw
// AssertionError's when particular conditions are not met. The
// assert module must conform to the following interface.

var assert = module.exports = ok;

// 2. The AssertionError is defined in assert.
// new assert.AssertionError({ message: message,
//                             actual: actual,
//                             expected: expected })

assert.AssertionError = function AssertionError(options) {
  this.name = 'AssertionError';
  this.actual = options.actual;
  this.expected = options.expected;
  this.operator = options.operator;
  if (options.message) {
    this.message = options.message;
    this.generatedMessage = false;
  } else {
    this.message = getMessage(this);
    this.generatedMessage = true;
  }
  var stackStartFunction = options.stackStartFunction || fail;

  if (Error.captureStackTrace) {
    Error.captureStackTrace(this, stackStartFunction);
  }
  else {
    // non v8 browsers so we can have a stacktrace
    var err = new Error();
    if (err.stack) {
      var out = err.stack;

      // try to strip useless frames
      var fn_name = stackStartFunction.name;
      var idx = out.indexOf('\n' + fn_name);
      if (idx >= 0) {
        // once we have located the function frame
        // we need to strip out everything before it (and its line)
        var next_line = out.indexOf('\n', idx + 1);
        out = out.substring(next_line + 1);
      }

      this.stack = out;
    }
  }
};

// assert.AssertionError instanceof Error
util.inherits(assert.AssertionError, Error);

function replacer(key, value) {
  if (util.isUndefined(value)) {
    return '' + value;
  }
  if (util.isNumber(value) && !isFinite(value)) {
    return value.toString();
  }
  if (util.isFunction(value) || util.isRegExp(value)) {
    return value.toString();
  }
  return value;
}

function truncate(s, n) {
  if (util.isString(s)) {
    return s.length < n ? s : s.slice(0, n);
  } else {
    return s;
  }
}

function getMessage(self) {
  return truncate(JSON.stringify(self.actual, replacer), 128) + ' ' +
         self.operator + ' ' +
         truncate(JSON.stringify(self.expected, replacer), 128);
}

// At present only the three keys mentioned above are used and
// understood by the spec. Implementations or sub modules can pass
// other keys to the AssertionError's constructor - they will be
// ignored.

// 3. All of the following functions must throw an AssertionError
// when a corresponding condition is not met, with a message that
// may be undefined if not provided.  All assertion methods provide
// both the actual and expected values to the assertion error for
// display purposes.

function fail(actual, expected, message, operator, stackStartFunction) {
  throw new assert.AssertionError({
    message: message,
    actual: actual,
    expected: expected,
    operator: operator,
    stackStartFunction: stackStartFunction
  });
}

// EXTENSION! allows for well behaved errors defined elsewhere.
assert.fail = fail;

// 4. Pure assertion tests whether a value is truthy, as determined
// by !!guard.
// assert.ok(guard, message_opt);
// This statement is equivalent to assert.equal(true, !!guard,
// message_opt);. To test strictly for the value true, use
// assert.strictEqual(true, guard, message_opt);.

function ok(value, message) {
  if (!value) fail(value, true, message, '==', assert.ok);
}
assert.ok = ok;

// 5. The equality assertion tests shallow, coercive equality with
// ==.
// assert.equal(actual, expected, message_opt);

assert.equal = function equal(actual, expected, message) {
  if (actual != expected) fail(actual, expected, message, '==', assert.equal);
};

// 6. The non-equality assertion tests for whether two objects are not equal
// with != assert.notEqual(actual, expected, message_opt);

assert.notEqual = function notEqual(actual, expected, message) {
  if (actual == expected) {
    fail(actual, expected, message, '!=', assert.notEqual);
  }
};

// 7. The equivalence assertion tests a deep equality relation.
// assert.deepEqual(actual, expected, message_opt);

assert.deepEqual = function deepEqual(actual, expected, message) {
  if (!_deepEqual(actual, expected)) {
    fail(actual, expected, message, 'deepEqual', assert.deepEqual);
  }
};

function _deepEqual(actual, expected) {
  // 7.1. All identical values are equivalent, as determined by ===.
  if (actual === expected) {
    return true;

  } else if (util.isBuffer(actual) && util.isBuffer(expected)) {
    if (actual.length != expected.length) return false;

    for (var i = 0; i < actual.length; i++) {
      if (actual[i] !== expected[i]) return false;
    }

    return true;

  // 7.2. If the expected value is a Date object, the actual value is
  // equivalent if it is also a Date object that refers to the same time.
  } else if (util.isDate(actual) && util.isDate(expected)) {
    return actual.getTime() === expected.getTime();

  // 7.3 If the expected value is a RegExp object, the actual value is
  // equivalent if it is also a RegExp object with the same source and
  // properties (`global`, `multiline`, `lastIndex`, `ignoreCase`).
  } else if (util.isRegExp(actual) && util.isRegExp(expected)) {
    return actual.source === expected.source &&
           actual.global === expected.global &&
           actual.multiline === expected.multiline &&
           actual.lastIndex === expected.lastIndex &&
           actual.ignoreCase === expected.ignoreCase;

  // 7.4. Other pairs that do not both pass typeof value == 'object',
  // equivalence is determined by ==.
  } else if (!util.isObject(actual) && !util.isObject(expected)) {
    return actual == expected;

  // 7.5 For all other Object pairs, including Array objects, equivalence is
  // determined by having the same number of owned properties (as verified
  // with Object.prototype.hasOwnProperty.call), the same set of keys
  // (although not necessarily the same order), equivalent values for every
  // corresponding key, and an identical 'prototype' property. Note: this
  // accounts for both named and indexed properties on Arrays.
  } else {
    return objEquiv(actual, expected);
  }
}

function isArguments(object) {
  return Object.prototype.toString.call(object) == '[object Arguments]';
}

function objEquiv(a, b) {
  if (util.isNullOrUndefined(a) || util.isNullOrUndefined(b))
    return false;
  // an identical 'prototype' property.
  if (a.prototype !== b.prototype) return false;
  // if one is a primitive, the other must be same
  if (util.isPrimitive(a) || util.isPrimitive(b)) {
    return a === b;
  }
  var aIsArgs = isArguments(a),
      bIsArgs = isArguments(b);
  if ((aIsArgs && !bIsArgs) || (!aIsArgs && bIsArgs))
    return false;
  if (aIsArgs) {
    a = pSlice.call(a);
    b = pSlice.call(b);
    return _deepEqual(a, b);
  }
  var ka = objectKeys(a),
      kb = objectKeys(b),
      key, i;
  // having the same number of owned properties (keys incorporates
  // hasOwnProperty)
  if (ka.length != kb.length)
    return false;
  //the same set of keys (although not necessarily the same order),
  ka.sort();
  kb.sort();
  //~~~cheap key test
  for (i = ka.length - 1; i >= 0; i--) {
    if (ka[i] != kb[i])
      return false;
  }
  //equivalent values for every corresponding key, and
  //~~~possibly expensive deep test
  for (i = ka.length - 1; i >= 0; i--) {
    key = ka[i];
    if (!_deepEqual(a[key], b[key])) return false;
  }
  return true;
}

// 8. The non-equivalence assertion tests for any deep inequality.
// assert.notDeepEqual(actual, expected, message_opt);

assert.notDeepEqual = function notDeepEqual(actual, expected, message) {
  if (_deepEqual(actual, expected)) {
    fail(actual, expected, message, 'notDeepEqual', assert.notDeepEqual);
  }
};

// 9. The strict equality assertion tests strict equality, as determined by ===.
// assert.strictEqual(actual, expected, message_opt);

assert.strictEqual = function strictEqual(actual, expected, message) {
  if (actual !== expected) {
    fail(actual, expected, message, '===', assert.strictEqual);
  }
};

// 10. The strict non-equality assertion tests for strict inequality, as
// determined by !==.  assert.notStrictEqual(actual, expected, message_opt);

assert.notStrictEqual = function notStrictEqual(actual, expected, message) {
  if (actual === expected) {
    fail(actual, expected, message, '!==', assert.notStrictEqual);
  }
};

function expectedException(actual, expected) {
  if (!actual || !expected) {
    return false;
  }

  if (Object.prototype.toString.call(expected) == '[object RegExp]') {
    return expected.test(actual);
  } else if (actual instanceof expected) {
    return true;
  } else if (expected.call({}, actual) === true) {
    return true;
  }

  return false;
}

function _throws(shouldThrow, block, expected, message) {
  var actual;

  if (util.isString(expected)) {
    message = expected;
    expected = null;
  }

  try {
    block();
  } catch (e) {
    actual = e;
  }

  message = (expected && expected.name ? ' (' + expected.name + ').' : '.') +
            (message ? ' ' + message : '.');

  if (shouldThrow && !actual) {
    fail(actual, expected, 'Missing expected exception' + message);
  }

  if (!shouldThrow && expectedException(actual, expected)) {
    fail(actual, expected, 'Got unwanted exception' + message);
  }

  if ((shouldThrow && actual && expected &&
      !expectedException(actual, expected)) || (!shouldThrow && actual)) {
    throw actual;
  }
}

// 11. Expected to throw an error:
// assert.throws(block, Error_opt, message_opt);

assert.throws = function(block, /*optional*/error, /*optional*/message) {
  _throws.apply(this, [true].concat(pSlice.call(arguments)));
};

// EXTENSION! This is annoying to write outside this module.
assert.doesNotThrow = function(block, /*optional*/message) {
  _throws.apply(this, [false].concat(pSlice.call(arguments)));
};

assert.ifError = function(err) { if (err) {throw err;}};

var objectKeys = Object.keys || function (obj) {
  var keys = [];
  for (var key in obj) {
    if (hasOwn.call(obj, key)) keys.push(key);
  }
  return keys;
};

},{"util/":31}],23:[function(require,module,exports){
'use strict'

exports.byteLength = byteLength
exports.toByteArray = toByteArray
exports.fromByteArray = fromByteArray

var lookup = []
var revLookup = []
var Arr = typeof Uint8Array !== 'undefined' ? Uint8Array : Array

var code = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
for (var i = 0, len = code.length; i < len; ++i) {
  lookup[i] = code[i]
  revLookup[code.charCodeAt(i)] = i
}

revLookup['-'.charCodeAt(0)] = 62
revLookup['_'.charCodeAt(0)] = 63

function placeHoldersCount (b64) {
  var len = b64.length
  if (len % 4 > 0) {
    throw new Error('Invalid string. Length must be a multiple of 4')
  }

  // the number of equal signs (place holders)
  // if there are two placeholders, than the two characters before it
  // represent one byte
  // if there is only one, then the three characters before it represent 2 bytes
  // this is just a cheap hack to not do indexOf twice
  return b64[len - 2] === '=' ? 2 : b64[len - 1] === '=' ? 1 : 0
}

function byteLength (b64) {
  // base64 is 4/3 + up to two characters of the original data
  return b64.length * 3 / 4 - placeHoldersCount(b64)
}

function toByteArray (b64) {
  var i, j, l, tmp, placeHolders, arr
  var len = b64.length
  placeHolders = placeHoldersCount(b64)

  arr = new Arr(len * 3 / 4 - placeHolders)

  // if there are placeholders, only get up to the last complete 4 chars
  l = placeHolders > 0 ? len - 4 : len

  var L = 0

  for (i = 0, j = 0; i < l; i += 4, j += 3) {
    tmp = (revLookup[b64.charCodeAt(i)] << 18) | (revLookup[b64.charCodeAt(i + 1)] << 12) | (revLookup[b64.charCodeAt(i + 2)] << 6) | revLookup[b64.charCodeAt(i + 3)]
    arr[L++] = (tmp >> 16) & 0xFF
    arr[L++] = (tmp >> 8) & 0xFF
    arr[L++] = tmp & 0xFF
  }

  if (placeHolders === 2) {
    tmp = (revLookup[b64.charCodeAt(i)] << 2) | (revLookup[b64.charCodeAt(i + 1)] >> 4)
    arr[L++] = tmp & 0xFF
  } else if (placeHolders === 1) {
    tmp = (revLookup[b64.charCodeAt(i)] << 10) | (revLookup[b64.charCodeAt(i + 1)] << 4) | (revLookup[b64.charCodeAt(i + 2)] >> 2)
    arr[L++] = (tmp >> 8) & 0xFF
    arr[L++] = tmp & 0xFF
  }

  return arr
}

function tripletToBase64 (num) {
  return lookup[num >> 18 & 0x3F] + lookup[num >> 12 & 0x3F] + lookup[num >> 6 & 0x3F] + lookup[num & 0x3F]
}

function encodeChunk (uint8, start, end) {
  var tmp
  var output = []
  for (var i = start; i < end; i += 3) {
    tmp = (uint8[i] << 16) + (uint8[i + 1] << 8) + (uint8[i + 2])
    output.push(tripletToBase64(tmp))
  }
  return output.join('')
}

function fromByteArray (uint8) {
  var tmp
  var len = uint8.length
  var extraBytes = len % 3 // if we have 1 byte left, pad 2 bytes
  var output = ''
  var parts = []
  var maxChunkLength = 16383 // must be multiple of 3

  // go through the array every three bytes, we'll deal with trailing stuff later
  for (var i = 0, len2 = len - extraBytes; i < len2; i += maxChunkLength) {
    parts.push(encodeChunk(uint8, i, (i + maxChunkLength) > len2 ? len2 : (i + maxChunkLength)))
  }

  // pad the end with zeros, but make sure to not forget the extra bytes
  if (extraBytes === 1) {
    tmp = uint8[len - 1]
    output += lookup[tmp >> 2]
    output += lookup[(tmp << 4) & 0x3F]
    output += '=='
  } else if (extraBytes === 2) {
    tmp = (uint8[len - 2] << 8) + (uint8[len - 1])
    output += lookup[tmp >> 10]
    output += lookup[(tmp >> 4) & 0x3F]
    output += lookup[(tmp << 2) & 0x3F]
    output += '='
  }

  parts.push(output)

  return parts.join('')
}

},{}],24:[function(require,module,exports){
(function (global){
/*!
 * The buffer module from node.js, for the browser.
 *
 * @author   Feross Aboukhadijeh <feross@feross.org> <http://feross.org>
 * @license  MIT
 */
/* eslint-disable no-proto */

'use strict'

var base64 = require('base64-js')
var ieee754 = require('ieee754')
var isArray = require('isarray')

exports.Buffer = Buffer
exports.SlowBuffer = SlowBuffer
exports.INSPECT_MAX_BYTES = 50

/**
 * If `Buffer.TYPED_ARRAY_SUPPORT`:
 *   === true    Use Uint8Array implementation (fastest)
 *   === false   Use Object implementation (most compatible, even IE6)
 *
 * Browsers that support typed arrays are IE 10+, Firefox 4+, Chrome 7+, Safari 5.1+,
 * Opera 11.6+, iOS 4.2+.
 *
 * Due to various browser bugs, sometimes the Object implementation will be used even
 * when the browser supports typed arrays.
 *
 * Note:
 *
 *   - Firefox 4-29 lacks support for adding new properties to `Uint8Array` instances,
 *     See: https://bugzilla.mozilla.org/show_bug.cgi?id=695438.
 *
 *   - Chrome 9-10 is missing the `TypedArray.prototype.subarray` function.
 *
 *   - IE10 has a broken `TypedArray.prototype.subarray` function which returns arrays of
 *     incorrect length in some situations.

 * We detect these buggy browsers and set `Buffer.TYPED_ARRAY_SUPPORT` to `false` so they
 * get the Object implementation, which is slower but behaves correctly.
 */
Buffer.TYPED_ARRAY_SUPPORT = global.TYPED_ARRAY_SUPPORT !== undefined
  ? global.TYPED_ARRAY_SUPPORT
  : typedArraySupport()

/*
 * Export kMaxLength after typed array support is determined.
 */
exports.kMaxLength = kMaxLength()

function typedArraySupport () {
  try {
    var arr = new Uint8Array(1)
    arr.__proto__ = {__proto__: Uint8Array.prototype, foo: function () { return 42 }}
    return arr.foo() === 42 && // typed array instances can be augmented
        typeof arr.subarray === 'function' && // chrome 9-10 lack `subarray`
        arr.subarray(1, 1).byteLength === 0 // ie10 has broken `subarray`
  } catch (e) {
    return false
  }
}

function kMaxLength () {
  return Buffer.TYPED_ARRAY_SUPPORT
    ? 0x7fffffff
    : 0x3fffffff
}

function createBuffer (that, length) {
  if (kMaxLength() < length) {
    throw new RangeError('Invalid typed array length')
  }
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    // Return an augmented `Uint8Array` instance, for best performance
    that = new Uint8Array(length)
    that.__proto__ = Buffer.prototype
  } else {
    // Fallback: Return an object instance of the Buffer class
    if (that === null) {
      that = new Buffer(length)
    }
    that.length = length
  }

  return that
}

/**
 * The Buffer constructor returns instances of `Uint8Array` that have their
 * prototype changed to `Buffer.prototype`. Furthermore, `Buffer` is a subclass of
 * `Uint8Array`, so the returned instances will have all the node `Buffer` methods
 * and the `Uint8Array` methods. Square bracket notation works as expected -- it
 * returns a single octet.
 *
 * The `Uint8Array` prototype remains unmodified.
 */

function Buffer (arg, encodingOrOffset, length) {
  if (!Buffer.TYPED_ARRAY_SUPPORT && !(this instanceof Buffer)) {
    return new Buffer(arg, encodingOrOffset, length)
  }

  // Common case.
  if (typeof arg === 'number') {
    if (typeof encodingOrOffset === 'string') {
      throw new Error(
        'If encoding is specified then the first argument must be a string'
      )
    }
    return allocUnsafe(this, arg)
  }
  return from(this, arg, encodingOrOffset, length)
}

Buffer.poolSize = 8192 // not used by this implementation

// TODO: Legacy, not needed anymore. Remove in next major version.
Buffer._augment = function (arr) {
  arr.__proto__ = Buffer.prototype
  return arr
}

function from (that, value, encodingOrOffset, length) {
  if (typeof value === 'number') {
    throw new TypeError('"value" argument must not be a number')
  }

  if (typeof ArrayBuffer !== 'undefined' && value instanceof ArrayBuffer) {
    return fromArrayBuffer(that, value, encodingOrOffset, length)
  }

  if (typeof value === 'string') {
    return fromString(that, value, encodingOrOffset)
  }

  return fromObject(that, value)
}

/**
 * Functionally equivalent to Buffer(arg, encoding) but throws a TypeError
 * if value is a number.
 * Buffer.from(str[, encoding])
 * Buffer.from(array)
 * Buffer.from(buffer)
 * Buffer.from(arrayBuffer[, byteOffset[, length]])
 **/
Buffer.from = function (value, encodingOrOffset, length) {
  return from(null, value, encodingOrOffset, length)
}

if (Buffer.TYPED_ARRAY_SUPPORT) {
  Buffer.prototype.__proto__ = Uint8Array.prototype
  Buffer.__proto__ = Uint8Array
  if (typeof Symbol !== 'undefined' && Symbol.species &&
      Buffer[Symbol.species] === Buffer) {
    // Fix subarray() in ES2016. See: https://github.com/feross/buffer/pull/97
    Object.defineProperty(Buffer, Symbol.species, {
      value: null,
      configurable: true
    })
  }
}

function assertSize (size) {
  if (typeof size !== 'number') {
    throw new TypeError('"size" argument must be a number')
  } else if (size < 0) {
    throw new RangeError('"size" argument must not be negative')
  }
}

function alloc (that, size, fill, encoding) {
  assertSize(size)
  if (size <= 0) {
    return createBuffer(that, size)
  }
  if (fill !== undefined) {
    // Only pay attention to encoding if it's a string. This
    // prevents accidentally sending in a number that would
    // be interpretted as a start offset.
    return typeof encoding === 'string'
      ? createBuffer(that, size).fill(fill, encoding)
      : createBuffer(that, size).fill(fill)
  }
  return createBuffer(that, size)
}

/**
 * Creates a new filled Buffer instance.
 * alloc(size[, fill[, encoding]])
 **/
Buffer.alloc = function (size, fill, encoding) {
  return alloc(null, size, fill, encoding)
}

function allocUnsafe (that, size) {
  assertSize(size)
  that = createBuffer(that, size < 0 ? 0 : checked(size) | 0)
  if (!Buffer.TYPED_ARRAY_SUPPORT) {
    for (var i = 0; i < size; ++i) {
      that[i] = 0
    }
  }
  return that
}

/**
 * Equivalent to Buffer(num), by default creates a non-zero-filled Buffer instance.
 * */
Buffer.allocUnsafe = function (size) {
  return allocUnsafe(null, size)
}
/**
 * Equivalent to SlowBuffer(num), by default creates a non-zero-filled Buffer instance.
 */
Buffer.allocUnsafeSlow = function (size) {
  return allocUnsafe(null, size)
}

function fromString (that, string, encoding) {
  if (typeof encoding !== 'string' || encoding === '') {
    encoding = 'utf8'
  }

  if (!Buffer.isEncoding(encoding)) {
    throw new TypeError('"encoding" must be a valid string encoding')
  }

  var length = byteLength(string, encoding) | 0
  that = createBuffer(that, length)

  var actual = that.write(string, encoding)

  if (actual !== length) {
    // Writing a hex string, for example, that contains invalid characters will
    // cause everything after the first invalid character to be ignored. (e.g.
    // 'abxxcd' will be treated as 'ab')
    that = that.slice(0, actual)
  }

  return that
}

function fromArrayLike (that, array) {
  var length = array.length < 0 ? 0 : checked(array.length) | 0
  that = createBuffer(that, length)
  for (var i = 0; i < length; i += 1) {
    that[i] = array[i] & 255
  }
  return that
}

function fromArrayBuffer (that, array, byteOffset, length) {
  array.byteLength // this throws if `array` is not a valid ArrayBuffer

  if (byteOffset < 0 || array.byteLength < byteOffset) {
    throw new RangeError('\'offset\' is out of bounds')
  }

  if (array.byteLength < byteOffset + (length || 0)) {
    throw new RangeError('\'length\' is out of bounds')
  }

  if (byteOffset === undefined && length === undefined) {
    array = new Uint8Array(array)
  } else if (length === undefined) {
    array = new Uint8Array(array, byteOffset)
  } else {
    array = new Uint8Array(array, byteOffset, length)
  }

  if (Buffer.TYPED_ARRAY_SUPPORT) {
    // Return an augmented `Uint8Array` instance, for best performance
    that = array
    that.__proto__ = Buffer.prototype
  } else {
    // Fallback: Return an object instance of the Buffer class
    that = fromArrayLike(that, array)
  }
  return that
}

function fromObject (that, obj) {
  if (Buffer.isBuffer(obj)) {
    var len = checked(obj.length) | 0
    that = createBuffer(that, len)

    if (that.length === 0) {
      return that
    }

    obj.copy(that, 0, 0, len)
    return that
  }

  if (obj) {
    if ((typeof ArrayBuffer !== 'undefined' &&
        obj.buffer instanceof ArrayBuffer) || 'length' in obj) {
      if (typeof obj.length !== 'number' || isnan(obj.length)) {
        return createBuffer(that, 0)
      }
      return fromArrayLike(that, obj)
    }

    if (obj.type === 'Buffer' && isArray(obj.data)) {
      return fromArrayLike(that, obj.data)
    }
  }

  throw new TypeError('First argument must be a string, Buffer, ArrayBuffer, Array, or array-like object.')
}

function checked (length) {
  // Note: cannot use `length < kMaxLength()` here because that fails when
  // length is NaN (which is otherwise coerced to zero.)
  if (length >= kMaxLength()) {
    throw new RangeError('Attempt to allocate Buffer larger than maximum ' +
                         'size: 0x' + kMaxLength().toString(16) + ' bytes')
  }
  return length | 0
}

function SlowBuffer (length) {
  if (+length != length) { // eslint-disable-line eqeqeq
    length = 0
  }
  return Buffer.alloc(+length)
}

Buffer.isBuffer = function isBuffer (b) {
  return !!(b != null && b._isBuffer)
}

Buffer.compare = function compare (a, b) {
  if (!Buffer.isBuffer(a) || !Buffer.isBuffer(b)) {
    throw new TypeError('Arguments must be Buffers')
  }

  if (a === b) return 0

  var x = a.length
  var y = b.length

  for (var i = 0, len = Math.min(x, y); i < len; ++i) {
    if (a[i] !== b[i]) {
      x = a[i]
      y = b[i]
      break
    }
  }

  if (x < y) return -1
  if (y < x) return 1
  return 0
}

Buffer.isEncoding = function isEncoding (encoding) {
  switch (String(encoding).toLowerCase()) {
    case 'hex':
    case 'utf8':
    case 'utf-8':
    case 'ascii':
    case 'latin1':
    case 'binary':
    case 'base64':
    case 'ucs2':
    case 'ucs-2':
    case 'utf16le':
    case 'utf-16le':
      return true
    default:
      return false
  }
}

Buffer.concat = function concat (list, length) {
  if (!isArray(list)) {
    throw new TypeError('"list" argument must be an Array of Buffers')
  }

  if (list.length === 0) {
    return Buffer.alloc(0)
  }

  var i
  if (length === undefined) {
    length = 0
    for (i = 0; i < list.length; ++i) {
      length += list[i].length
    }
  }

  var buffer = Buffer.allocUnsafe(length)
  var pos = 0
  for (i = 0; i < list.length; ++i) {
    var buf = list[i]
    if (!Buffer.isBuffer(buf)) {
      throw new TypeError('"list" argument must be an Array of Buffers')
    }
    buf.copy(buffer, pos)
    pos += buf.length
  }
  return buffer
}

function byteLength (string, encoding) {
  if (Buffer.isBuffer(string)) {
    return string.length
  }
  if (typeof ArrayBuffer !== 'undefined' && typeof ArrayBuffer.isView === 'function' &&
      (ArrayBuffer.isView(string) || string instanceof ArrayBuffer)) {
    return string.byteLength
  }
  if (typeof string !== 'string') {
    string = '' + string
  }

  var len = string.length
  if (len === 0) return 0

  // Use a for loop to avoid recursion
  var loweredCase = false
  for (;;) {
    switch (encoding) {
      case 'ascii':
      case 'latin1':
      case 'binary':
        return len
      case 'utf8':
      case 'utf-8':
      case undefined:
        return utf8ToBytes(string).length
      case 'ucs2':
      case 'ucs-2':
      case 'utf16le':
      case 'utf-16le':
        return len * 2
      case 'hex':
        return len >>> 1
      case 'base64':
        return base64ToBytes(string).length
      default:
        if (loweredCase) return utf8ToBytes(string).length // assume utf8
        encoding = ('' + encoding).toLowerCase()
        loweredCase = true
    }
  }
}
Buffer.byteLength = byteLength

function slowToString (encoding, start, end) {
  var loweredCase = false

  // No need to verify that "this.length <= MAX_UINT32" since it's a read-only
  // property of a typed array.

  // This behaves neither like String nor Uint8Array in that we set start/end
  // to their upper/lower bounds if the value passed is out of range.
  // undefined is handled specially as per ECMA-262 6th Edition,
  // Section 13.3.3.7 Runtime Semantics: KeyedBindingInitialization.
  if (start === undefined || start < 0) {
    start = 0
  }
  // Return early if start > this.length. Done here to prevent potential uint32
  // coercion fail below.
  if (start > this.length) {
    return ''
  }

  if (end === undefined || end > this.length) {
    end = this.length
  }

  if (end <= 0) {
    return ''
  }

  // Force coersion to uint32. This will also coerce falsey/NaN values to 0.
  end >>>= 0
  start >>>= 0

  if (end <= start) {
    return ''
  }

  if (!encoding) encoding = 'utf8'

  while (true) {
    switch (encoding) {
      case 'hex':
        return hexSlice(this, start, end)

      case 'utf8':
      case 'utf-8':
        return utf8Slice(this, start, end)

      case 'ascii':
        return asciiSlice(this, start, end)

      case 'latin1':
      case 'binary':
        return latin1Slice(this, start, end)

      case 'base64':
        return base64Slice(this, start, end)

      case 'ucs2':
      case 'ucs-2':
      case 'utf16le':
      case 'utf-16le':
        return utf16leSlice(this, start, end)

      default:
        if (loweredCase) throw new TypeError('Unknown encoding: ' + encoding)
        encoding = (encoding + '').toLowerCase()
        loweredCase = true
    }
  }
}

// The property is used by `Buffer.isBuffer` and `is-buffer` (in Safari 5-7) to detect
// Buffer instances.
Buffer.prototype._isBuffer = true

function swap (b, n, m) {
  var i = b[n]
  b[n] = b[m]
  b[m] = i
}

Buffer.prototype.swap16 = function swap16 () {
  var len = this.length
  if (len % 2 !== 0) {
    throw new RangeError('Buffer size must be a multiple of 16-bits')
  }
  for (var i = 0; i < len; i += 2) {
    swap(this, i, i + 1)
  }
  return this
}

Buffer.prototype.swap32 = function swap32 () {
  var len = this.length
  if (len % 4 !== 0) {
    throw new RangeError('Buffer size must be a multiple of 32-bits')
  }
  for (var i = 0; i < len; i += 4) {
    swap(this, i, i + 3)
    swap(this, i + 1, i + 2)
  }
  return this
}

Buffer.prototype.swap64 = function swap64 () {
  var len = this.length
  if (len % 8 !== 0) {
    throw new RangeError('Buffer size must be a multiple of 64-bits')
  }
  for (var i = 0; i < len; i += 8) {
    swap(this, i, i + 7)
    swap(this, i + 1, i + 6)
    swap(this, i + 2, i + 5)
    swap(this, i + 3, i + 4)
  }
  return this
}

Buffer.prototype.toString = function toString () {
  var length = this.length | 0
  if (length === 0) return ''
  if (arguments.length === 0) return utf8Slice(this, 0, length)
  return slowToString.apply(this, arguments)
}

Buffer.prototype.equals = function equals (b) {
  if (!Buffer.isBuffer(b)) throw new TypeError('Argument must be a Buffer')
  if (this === b) return true
  return Buffer.compare(this, b) === 0
}

Buffer.prototype.inspect = function inspect () {
  var str = ''
  var max = exports.INSPECT_MAX_BYTES
  if (this.length > 0) {
    str = this.toString('hex', 0, max).match(/.{2}/g).join(' ')
    if (this.length > max) str += ' ... '
  }
  return '<Buffer ' + str + '>'
}

Buffer.prototype.compare = function compare (target, start, end, thisStart, thisEnd) {
  if (!Buffer.isBuffer(target)) {
    throw new TypeError('Argument must be a Buffer')
  }

  if (start === undefined) {
    start = 0
  }
  if (end === undefined) {
    end = target ? target.length : 0
  }
  if (thisStart === undefined) {
    thisStart = 0
  }
  if (thisEnd === undefined) {
    thisEnd = this.length
  }

  if (start < 0 || end > target.length || thisStart < 0 || thisEnd > this.length) {
    throw new RangeError('out of range index')
  }

  if (thisStart >= thisEnd && start >= end) {
    return 0
  }
  if (thisStart >= thisEnd) {
    return -1
  }
  if (start >= end) {
    return 1
  }

  start >>>= 0
  end >>>= 0
  thisStart >>>= 0
  thisEnd >>>= 0

  if (this === target) return 0

  var x = thisEnd - thisStart
  var y = end - start
  var len = Math.min(x, y)

  var thisCopy = this.slice(thisStart, thisEnd)
  var targetCopy = target.slice(start, end)

  for (var i = 0; i < len; ++i) {
    if (thisCopy[i] !== targetCopy[i]) {
      x = thisCopy[i]
      y = targetCopy[i]
      break
    }
  }

  if (x < y) return -1
  if (y < x) return 1
  return 0
}

// Finds either the first index of `val` in `buffer` at offset >= `byteOffset`,
// OR the last index of `val` in `buffer` at offset <= `byteOffset`.
//
// Arguments:
// - buffer - a Buffer to search
// - val - a string, Buffer, or number
// - byteOffset - an index into `buffer`; will be clamped to an int32
// - encoding - an optional encoding, relevant is val is a string
// - dir - true for indexOf, false for lastIndexOf
function bidirectionalIndexOf (buffer, val, byteOffset, encoding, dir) {
  // Empty buffer means no match
  if (buffer.length === 0) return -1

  // Normalize byteOffset
  if (typeof byteOffset === 'string') {
    encoding = byteOffset
    byteOffset = 0
  } else if (byteOffset > 0x7fffffff) {
    byteOffset = 0x7fffffff
  } else if (byteOffset < -0x80000000) {
    byteOffset = -0x80000000
  }
  byteOffset = +byteOffset  // Coerce to Number.
  if (isNaN(byteOffset)) {
    // byteOffset: it it's undefined, null, NaN, "foo", etc, search whole buffer
    byteOffset = dir ? 0 : (buffer.length - 1)
  }

  // Normalize byteOffset: negative offsets start from the end of the buffer
  if (byteOffset < 0) byteOffset = buffer.length + byteOffset
  if (byteOffset >= buffer.length) {
    if (dir) return -1
    else byteOffset = buffer.length - 1
  } else if (byteOffset < 0) {
    if (dir) byteOffset = 0
    else return -1
  }

  // Normalize val
  if (typeof val === 'string') {
    val = Buffer.from(val, encoding)
  }

  // Finally, search either indexOf (if dir is true) or lastIndexOf
  if (Buffer.isBuffer(val)) {
    // Special case: looking for empty string/buffer always fails
    if (val.length === 0) {
      return -1
    }
    return arrayIndexOf(buffer, val, byteOffset, encoding, dir)
  } else if (typeof val === 'number') {
    val = val & 0xFF // Search for a byte value [0-255]
    if (Buffer.TYPED_ARRAY_SUPPORT &&
        typeof Uint8Array.prototype.indexOf === 'function') {
      if (dir) {
        return Uint8Array.prototype.indexOf.call(buffer, val, byteOffset)
      } else {
        return Uint8Array.prototype.lastIndexOf.call(buffer, val, byteOffset)
      }
    }
    return arrayIndexOf(buffer, [ val ], byteOffset, encoding, dir)
  }

  throw new TypeError('val must be string, number or Buffer')
}

function arrayIndexOf (arr, val, byteOffset, encoding, dir) {
  var indexSize = 1
  var arrLength = arr.length
  var valLength = val.length

  if (encoding !== undefined) {
    encoding = String(encoding).toLowerCase()
    if (encoding === 'ucs2' || encoding === 'ucs-2' ||
        encoding === 'utf16le' || encoding === 'utf-16le') {
      if (arr.length < 2 || val.length < 2) {
        return -1
      }
      indexSize = 2
      arrLength /= 2
      valLength /= 2
      byteOffset /= 2
    }
  }

  function read (buf, i) {
    if (indexSize === 1) {
      return buf[i]
    } else {
      return buf.readUInt16BE(i * indexSize)
    }
  }

  var i
  if (dir) {
    var foundIndex = -1
    for (i = byteOffset; i < arrLength; i++) {
      if (read(arr, i) === read(val, foundIndex === -1 ? 0 : i - foundIndex)) {
        if (foundIndex === -1) foundIndex = i
        if (i - foundIndex + 1 === valLength) return foundIndex * indexSize
      } else {
        if (foundIndex !== -1) i -= i - foundIndex
        foundIndex = -1
      }
    }
  } else {
    if (byteOffset + valLength > arrLength) byteOffset = arrLength - valLength
    for (i = byteOffset; i >= 0; i--) {
      var found = true
      for (var j = 0; j < valLength; j++) {
        if (read(arr, i + j) !== read(val, j)) {
          found = false
          break
        }
      }
      if (found) return i
    }
  }

  return -1
}

Buffer.prototype.includes = function includes (val, byteOffset, encoding) {
  return this.indexOf(val, byteOffset, encoding) !== -1
}

Buffer.prototype.indexOf = function indexOf (val, byteOffset, encoding) {
  return bidirectionalIndexOf(this, val, byteOffset, encoding, true)
}

Buffer.prototype.lastIndexOf = function lastIndexOf (val, byteOffset, encoding) {
  return bidirectionalIndexOf(this, val, byteOffset, encoding, false)
}

function hexWrite (buf, string, offset, length) {
  offset = Number(offset) || 0
  var remaining = buf.length - offset
  if (!length) {
    length = remaining
  } else {
    length = Number(length)
    if (length > remaining) {
      length = remaining
    }
  }

  // must be an even number of digits
  var strLen = string.length
  if (strLen % 2 !== 0) throw new TypeError('Invalid hex string')

  if (length > strLen / 2) {
    length = strLen / 2
  }
  for (var i = 0; i < length; ++i) {
    var parsed = parseInt(string.substr(i * 2, 2), 16)
    if (isNaN(parsed)) return i
    buf[offset + i] = parsed
  }
  return i
}

function utf8Write (buf, string, offset, length) {
  return blitBuffer(utf8ToBytes(string, buf.length - offset), buf, offset, length)
}

function asciiWrite (buf, string, offset, length) {
  return blitBuffer(asciiToBytes(string), buf, offset, length)
}

function latin1Write (buf, string, offset, length) {
  return asciiWrite(buf, string, offset, length)
}

function base64Write (buf, string, offset, length) {
  return blitBuffer(base64ToBytes(string), buf, offset, length)
}

function ucs2Write (buf, string, offset, length) {
  return blitBuffer(utf16leToBytes(string, buf.length - offset), buf, offset, length)
}

Buffer.prototype.write = function write (string, offset, length, encoding) {
  // Buffer#write(string)
  if (offset === undefined) {
    encoding = 'utf8'
    length = this.length
    offset = 0
  // Buffer#write(string, encoding)
  } else if (length === undefined && typeof offset === 'string') {
    encoding = offset
    length = this.length
    offset = 0
  // Buffer#write(string, offset[, length][, encoding])
  } else if (isFinite(offset)) {
    offset = offset | 0
    if (isFinite(length)) {
      length = length | 0
      if (encoding === undefined) encoding = 'utf8'
    } else {
      encoding = length
      length = undefined
    }
  // legacy write(string, encoding, offset, length) - remove in v0.13
  } else {
    throw new Error(
      'Buffer.write(string, encoding, offset[, length]) is no longer supported'
    )
  }

  var remaining = this.length - offset
  if (length === undefined || length > remaining) length = remaining

  if ((string.length > 0 && (length < 0 || offset < 0)) || offset > this.length) {
    throw new RangeError('Attempt to write outside buffer bounds')
  }

  if (!encoding) encoding = 'utf8'

  var loweredCase = false
  for (;;) {
    switch (encoding) {
      case 'hex':
        return hexWrite(this, string, offset, length)

      case 'utf8':
      case 'utf-8':
        return utf8Write(this, string, offset, length)

      case 'ascii':
        return asciiWrite(this, string, offset, length)

      case 'latin1':
      case 'binary':
        return latin1Write(this, string, offset, length)

      case 'base64':
        // Warning: maxLength not taken into account in base64Write
        return base64Write(this, string, offset, length)

      case 'ucs2':
      case 'ucs-2':
      case 'utf16le':
      case 'utf-16le':
        return ucs2Write(this, string, offset, length)

      default:
        if (loweredCase) throw new TypeError('Unknown encoding: ' + encoding)
        encoding = ('' + encoding).toLowerCase()
        loweredCase = true
    }
  }
}

Buffer.prototype.toJSON = function toJSON () {
  return {
    type: 'Buffer',
    data: Array.prototype.slice.call(this._arr || this, 0)
  }
}

function base64Slice (buf, start, end) {
  if (start === 0 && end === buf.length) {
    return base64.fromByteArray(buf)
  } else {
    return base64.fromByteArray(buf.slice(start, end))
  }
}

function utf8Slice (buf, start, end) {
  end = Math.min(buf.length, end)
  var res = []

  var i = start
  while (i < end) {
    var firstByte = buf[i]
    var codePoint = null
    var bytesPerSequence = (firstByte > 0xEF) ? 4
      : (firstByte > 0xDF) ? 3
      : (firstByte > 0xBF) ? 2
      : 1

    if (i + bytesPerSequence <= end) {
      var secondByte, thirdByte, fourthByte, tempCodePoint

      switch (bytesPerSequence) {
        case 1:
          if (firstByte < 0x80) {
            codePoint = firstByte
          }
          break
        case 2:
          secondByte = buf[i + 1]
          if ((secondByte & 0xC0) === 0x80) {
            tempCodePoint = (firstByte & 0x1F) << 0x6 | (secondByte & 0x3F)
            if (tempCodePoint > 0x7F) {
              codePoint = tempCodePoint
            }
          }
          break
        case 3:
          secondByte = buf[i + 1]
          thirdByte = buf[i + 2]
          if ((secondByte & 0xC0) === 0x80 && (thirdByte & 0xC0) === 0x80) {
            tempCodePoint = (firstByte & 0xF) << 0xC | (secondByte & 0x3F) << 0x6 | (thirdByte & 0x3F)
            if (tempCodePoint > 0x7FF && (tempCodePoint < 0xD800 || tempCodePoint > 0xDFFF)) {
              codePoint = tempCodePoint
            }
          }
          break
        case 4:
          secondByte = buf[i + 1]
          thirdByte = buf[i + 2]
          fourthByte = buf[i + 3]
          if ((secondByte & 0xC0) === 0x80 && (thirdByte & 0xC0) === 0x80 && (fourthByte & 0xC0) === 0x80) {
            tempCodePoint = (firstByte & 0xF) << 0x12 | (secondByte & 0x3F) << 0xC | (thirdByte & 0x3F) << 0x6 | (fourthByte & 0x3F)
            if (tempCodePoint > 0xFFFF && tempCodePoint < 0x110000) {
              codePoint = tempCodePoint
            }
          }
      }
    }

    if (codePoint === null) {
      // we did not generate a valid codePoint so insert a
      // replacement char (U+FFFD) and advance only 1 byte
      codePoint = 0xFFFD
      bytesPerSequence = 1
    } else if (codePoint > 0xFFFF) {
      // encode to utf16 (surrogate pair dance)
      codePoint -= 0x10000
      res.push(codePoint >>> 10 & 0x3FF | 0xD800)
      codePoint = 0xDC00 | codePoint & 0x3FF
    }

    res.push(codePoint)
    i += bytesPerSequence
  }

  return decodeCodePointsArray(res)
}

// Based on http://stackoverflow.com/a/22747272/680742, the browser with
// the lowest limit is Chrome, with 0x10000 args.
// We go 1 magnitude less, for safety
var MAX_ARGUMENTS_LENGTH = 0x1000

function decodeCodePointsArray (codePoints) {
  var len = codePoints.length
  if (len <= MAX_ARGUMENTS_LENGTH) {
    return String.fromCharCode.apply(String, codePoints) // avoid extra slice()
  }

  // Decode in chunks to avoid "call stack size exceeded".
  var res = ''
  var i = 0
  while (i < len) {
    res += String.fromCharCode.apply(
      String,
      codePoints.slice(i, i += MAX_ARGUMENTS_LENGTH)
    )
  }
  return res
}

function asciiSlice (buf, start, end) {
  var ret = ''
  end = Math.min(buf.length, end)

  for (var i = start; i < end; ++i) {
    ret += String.fromCharCode(buf[i] & 0x7F)
  }
  return ret
}

function latin1Slice (buf, start, end) {
  var ret = ''
  end = Math.min(buf.length, end)

  for (var i = start; i < end; ++i) {
    ret += String.fromCharCode(buf[i])
  }
  return ret
}

function hexSlice (buf, start, end) {
  var len = buf.length

  if (!start || start < 0) start = 0
  if (!end || end < 0 || end > len) end = len

  var out = ''
  for (var i = start; i < end; ++i) {
    out += toHex(buf[i])
  }
  return out
}

function utf16leSlice (buf, start, end) {
  var bytes = buf.slice(start, end)
  var res = ''
  for (var i = 0; i < bytes.length; i += 2) {
    res += String.fromCharCode(bytes[i] + bytes[i + 1] * 256)
  }
  return res
}

Buffer.prototype.slice = function slice (start, end) {
  var len = this.length
  start = ~~start
  end = end === undefined ? len : ~~end

  if (start < 0) {
    start += len
    if (start < 0) start = 0
  } else if (start > len) {
    start = len
  }

  if (end < 0) {
    end += len
    if (end < 0) end = 0
  } else if (end > len) {
    end = len
  }

  if (end < start) end = start

  var newBuf
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    newBuf = this.subarray(start, end)
    newBuf.__proto__ = Buffer.prototype
  } else {
    var sliceLen = end - start
    newBuf = new Buffer(sliceLen, undefined)
    for (var i = 0; i < sliceLen; ++i) {
      newBuf[i] = this[i + start]
    }
  }

  return newBuf
}

/*
 * Need to make sure that buffer isn't trying to write out of bounds.
 */
function checkOffset (offset, ext, length) {
  if ((offset % 1) !== 0 || offset < 0) throw new RangeError('offset is not uint')
  if (offset + ext > length) throw new RangeError('Trying to access beyond buffer length')
}

Buffer.prototype.readUIntLE = function readUIntLE (offset, byteLength, noAssert) {
  offset = offset | 0
  byteLength = byteLength | 0
  if (!noAssert) checkOffset(offset, byteLength, this.length)

  var val = this[offset]
  var mul = 1
  var i = 0
  while (++i < byteLength && (mul *= 0x100)) {
    val += this[offset + i] * mul
  }

  return val
}

Buffer.prototype.readUIntBE = function readUIntBE (offset, byteLength, noAssert) {
  offset = offset | 0
  byteLength = byteLength | 0
  if (!noAssert) {
    checkOffset(offset, byteLength, this.length)
  }

  var val = this[offset + --byteLength]
  var mul = 1
  while (byteLength > 0 && (mul *= 0x100)) {
    val += this[offset + --byteLength] * mul
  }

  return val
}

Buffer.prototype.readUInt8 = function readUInt8 (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 1, this.length)
  return this[offset]
}

Buffer.prototype.readUInt16LE = function readUInt16LE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 2, this.length)
  return this[offset] | (this[offset + 1] << 8)
}

Buffer.prototype.readUInt16BE = function readUInt16BE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 2, this.length)
  return (this[offset] << 8) | this[offset + 1]
}

Buffer.prototype.readUInt32LE = function readUInt32LE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length)

  return ((this[offset]) |
      (this[offset + 1] << 8) |
      (this[offset + 2] << 16)) +
      (this[offset + 3] * 0x1000000)
}

Buffer.prototype.readUInt32BE = function readUInt32BE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length)

  return (this[offset] * 0x1000000) +
    ((this[offset + 1] << 16) |
    (this[offset + 2] << 8) |
    this[offset + 3])
}

Buffer.prototype.readIntLE = function readIntLE (offset, byteLength, noAssert) {
  offset = offset | 0
  byteLength = byteLength | 0
  if (!noAssert) checkOffset(offset, byteLength, this.length)

  var val = this[offset]
  var mul = 1
  var i = 0
  while (++i < byteLength && (mul *= 0x100)) {
    val += this[offset + i] * mul
  }
  mul *= 0x80

  if (val >= mul) val -= Math.pow(2, 8 * byteLength)

  return val
}

Buffer.prototype.readIntBE = function readIntBE (offset, byteLength, noAssert) {
  offset = offset | 0
  byteLength = byteLength | 0
  if (!noAssert) checkOffset(offset, byteLength, this.length)

  var i = byteLength
  var mul = 1
  var val = this[offset + --i]
  while (i > 0 && (mul *= 0x100)) {
    val += this[offset + --i] * mul
  }
  mul *= 0x80

  if (val >= mul) val -= Math.pow(2, 8 * byteLength)

  return val
}

Buffer.prototype.readInt8 = function readInt8 (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 1, this.length)
  if (!(this[offset] & 0x80)) return (this[offset])
  return ((0xff - this[offset] + 1) * -1)
}

Buffer.prototype.readInt16LE = function readInt16LE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 2, this.length)
  var val = this[offset] | (this[offset + 1] << 8)
  return (val & 0x8000) ? val | 0xFFFF0000 : val
}

Buffer.prototype.readInt16BE = function readInt16BE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 2, this.length)
  var val = this[offset + 1] | (this[offset] << 8)
  return (val & 0x8000) ? val | 0xFFFF0000 : val
}

Buffer.prototype.readInt32LE = function readInt32LE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length)

  return (this[offset]) |
    (this[offset + 1] << 8) |
    (this[offset + 2] << 16) |
    (this[offset + 3] << 24)
}

Buffer.prototype.readInt32BE = function readInt32BE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length)

  return (this[offset] << 24) |
    (this[offset + 1] << 16) |
    (this[offset + 2] << 8) |
    (this[offset + 3])
}

Buffer.prototype.readFloatLE = function readFloatLE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length)
  return ieee754.read(this, offset, true, 23, 4)
}

Buffer.prototype.readFloatBE = function readFloatBE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length)
  return ieee754.read(this, offset, false, 23, 4)
}

Buffer.prototype.readDoubleLE = function readDoubleLE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 8, this.length)
  return ieee754.read(this, offset, true, 52, 8)
}

Buffer.prototype.readDoubleBE = function readDoubleBE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 8, this.length)
  return ieee754.read(this, offset, false, 52, 8)
}

function checkInt (buf, value, offset, ext, max, min) {
  if (!Buffer.isBuffer(buf)) throw new TypeError('"buffer" argument must be a Buffer instance')
  if (value > max || value < min) throw new RangeError('"value" argument is out of bounds')
  if (offset + ext > buf.length) throw new RangeError('Index out of range')
}

Buffer.prototype.writeUIntLE = function writeUIntLE (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset | 0
  byteLength = byteLength | 0
  if (!noAssert) {
    var maxBytes = Math.pow(2, 8 * byteLength) - 1
    checkInt(this, value, offset, byteLength, maxBytes, 0)
  }

  var mul = 1
  var i = 0
  this[offset] = value & 0xFF
  while (++i < byteLength && (mul *= 0x100)) {
    this[offset + i] = (value / mul) & 0xFF
  }

  return offset + byteLength
}

Buffer.prototype.writeUIntBE = function writeUIntBE (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset | 0
  byteLength = byteLength | 0
  if (!noAssert) {
    var maxBytes = Math.pow(2, 8 * byteLength) - 1
    checkInt(this, value, offset, byteLength, maxBytes, 0)
  }

  var i = byteLength - 1
  var mul = 1
  this[offset + i] = value & 0xFF
  while (--i >= 0 && (mul *= 0x100)) {
    this[offset + i] = (value / mul) & 0xFF
  }

  return offset + byteLength
}

Buffer.prototype.writeUInt8 = function writeUInt8 (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 1, 0xff, 0)
  if (!Buffer.TYPED_ARRAY_SUPPORT) value = Math.floor(value)
  this[offset] = (value & 0xff)
  return offset + 1
}

function objectWriteUInt16 (buf, value, offset, littleEndian) {
  if (value < 0) value = 0xffff + value + 1
  for (var i = 0, j = Math.min(buf.length - offset, 2); i < j; ++i) {
    buf[offset + i] = (value & (0xff << (8 * (littleEndian ? i : 1 - i)))) >>>
      (littleEndian ? i : 1 - i) * 8
  }
}

Buffer.prototype.writeUInt16LE = function writeUInt16LE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 2, 0xffff, 0)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value & 0xff)
    this[offset + 1] = (value >>> 8)
  } else {
    objectWriteUInt16(this, value, offset, true)
  }
  return offset + 2
}

Buffer.prototype.writeUInt16BE = function writeUInt16BE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 2, 0xffff, 0)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value >>> 8)
    this[offset + 1] = (value & 0xff)
  } else {
    objectWriteUInt16(this, value, offset, false)
  }
  return offset + 2
}

function objectWriteUInt32 (buf, value, offset, littleEndian) {
  if (value < 0) value = 0xffffffff + value + 1
  for (var i = 0, j = Math.min(buf.length - offset, 4); i < j; ++i) {
    buf[offset + i] = (value >>> (littleEndian ? i : 3 - i) * 8) & 0xff
  }
}

Buffer.prototype.writeUInt32LE = function writeUInt32LE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 4, 0xffffffff, 0)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset + 3] = (value >>> 24)
    this[offset + 2] = (value >>> 16)
    this[offset + 1] = (value >>> 8)
    this[offset] = (value & 0xff)
  } else {
    objectWriteUInt32(this, value, offset, true)
  }
  return offset + 4
}

Buffer.prototype.writeUInt32BE = function writeUInt32BE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 4, 0xffffffff, 0)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value >>> 24)
    this[offset + 1] = (value >>> 16)
    this[offset + 2] = (value >>> 8)
    this[offset + 3] = (value & 0xff)
  } else {
    objectWriteUInt32(this, value, offset, false)
  }
  return offset + 4
}

Buffer.prototype.writeIntLE = function writeIntLE (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) {
    var limit = Math.pow(2, 8 * byteLength - 1)

    checkInt(this, value, offset, byteLength, limit - 1, -limit)
  }

  var i = 0
  var mul = 1
  var sub = 0
  this[offset] = value & 0xFF
  while (++i < byteLength && (mul *= 0x100)) {
    if (value < 0 && sub === 0 && this[offset + i - 1] !== 0) {
      sub = 1
    }
    this[offset + i] = ((value / mul) >> 0) - sub & 0xFF
  }

  return offset + byteLength
}

Buffer.prototype.writeIntBE = function writeIntBE (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) {
    var limit = Math.pow(2, 8 * byteLength - 1)

    checkInt(this, value, offset, byteLength, limit - 1, -limit)
  }

  var i = byteLength - 1
  var mul = 1
  var sub = 0
  this[offset + i] = value & 0xFF
  while (--i >= 0 && (mul *= 0x100)) {
    if (value < 0 && sub === 0 && this[offset + i + 1] !== 0) {
      sub = 1
    }
    this[offset + i] = ((value / mul) >> 0) - sub & 0xFF
  }

  return offset + byteLength
}

Buffer.prototype.writeInt8 = function writeInt8 (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 1, 0x7f, -0x80)
  if (!Buffer.TYPED_ARRAY_SUPPORT) value = Math.floor(value)
  if (value < 0) value = 0xff + value + 1
  this[offset] = (value & 0xff)
  return offset + 1
}

Buffer.prototype.writeInt16LE = function writeInt16LE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 2, 0x7fff, -0x8000)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value & 0xff)
    this[offset + 1] = (value >>> 8)
  } else {
    objectWriteUInt16(this, value, offset, true)
  }
  return offset + 2
}

Buffer.prototype.writeInt16BE = function writeInt16BE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 2, 0x7fff, -0x8000)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value >>> 8)
    this[offset + 1] = (value & 0xff)
  } else {
    objectWriteUInt16(this, value, offset, false)
  }
  return offset + 2
}

Buffer.prototype.writeInt32LE = function writeInt32LE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 4, 0x7fffffff, -0x80000000)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value & 0xff)
    this[offset + 1] = (value >>> 8)
    this[offset + 2] = (value >>> 16)
    this[offset + 3] = (value >>> 24)
  } else {
    objectWriteUInt32(this, value, offset, true)
  }
  return offset + 4
}

Buffer.prototype.writeInt32BE = function writeInt32BE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 4, 0x7fffffff, -0x80000000)
  if (value < 0) value = 0xffffffff + value + 1
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value >>> 24)
    this[offset + 1] = (value >>> 16)
    this[offset + 2] = (value >>> 8)
    this[offset + 3] = (value & 0xff)
  } else {
    objectWriteUInt32(this, value, offset, false)
  }
  return offset + 4
}

function checkIEEE754 (buf, value, offset, ext, max, min) {
  if (offset + ext > buf.length) throw new RangeError('Index out of range')
  if (offset < 0) throw new RangeError('Index out of range')
}

function writeFloat (buf, value, offset, littleEndian, noAssert) {
  if (!noAssert) {
    checkIEEE754(buf, value, offset, 4, 3.4028234663852886e+38, -3.4028234663852886e+38)
  }
  ieee754.write(buf, value, offset, littleEndian, 23, 4)
  return offset + 4
}

Buffer.prototype.writeFloatLE = function writeFloatLE (value, offset, noAssert) {
  return writeFloat(this, value, offset, true, noAssert)
}

Buffer.prototype.writeFloatBE = function writeFloatBE (value, offset, noAssert) {
  return writeFloat(this, value, offset, false, noAssert)
}

function writeDouble (buf, value, offset, littleEndian, noAssert) {
  if (!noAssert) {
    checkIEEE754(buf, value, offset, 8, 1.7976931348623157E+308, -1.7976931348623157E+308)
  }
  ieee754.write(buf, value, offset, littleEndian, 52, 8)
  return offset + 8
}

Buffer.prototype.writeDoubleLE = function writeDoubleLE (value, offset, noAssert) {
  return writeDouble(this, value, offset, true, noAssert)
}

Buffer.prototype.writeDoubleBE = function writeDoubleBE (value, offset, noAssert) {
  return writeDouble(this, value, offset, false, noAssert)
}

// copy(targetBuffer, targetStart=0, sourceStart=0, sourceEnd=buffer.length)
Buffer.prototype.copy = function copy (target, targetStart, start, end) {
  if (!start) start = 0
  if (!end && end !== 0) end = this.length
  if (targetStart >= target.length) targetStart = target.length
  if (!targetStart) targetStart = 0
  if (end > 0 && end < start) end = start

  // Copy 0 bytes; we're done
  if (end === start) return 0
  if (target.length === 0 || this.length === 0) return 0

  // Fatal error conditions
  if (targetStart < 0) {
    throw new RangeError('targetStart out of bounds')
  }
  if (start < 0 || start >= this.length) throw new RangeError('sourceStart out of bounds')
  if (end < 0) throw new RangeError('sourceEnd out of bounds')

  // Are we oob?
  if (end > this.length) end = this.length
  if (target.length - targetStart < end - start) {
    end = target.length - targetStart + start
  }

  var len = end - start
  var i

  if (this === target && start < targetStart && targetStart < end) {
    // descending copy from end
    for (i = len - 1; i >= 0; --i) {
      target[i + targetStart] = this[i + start]
    }
  } else if (len < 1000 || !Buffer.TYPED_ARRAY_SUPPORT) {
    // ascending copy from start
    for (i = 0; i < len; ++i) {
      target[i + targetStart] = this[i + start]
    }
  } else {
    Uint8Array.prototype.set.call(
      target,
      this.subarray(start, start + len),
      targetStart
    )
  }

  return len
}

// Usage:
//    buffer.fill(number[, offset[, end]])
//    buffer.fill(buffer[, offset[, end]])
//    buffer.fill(string[, offset[, end]][, encoding])
Buffer.prototype.fill = function fill (val, start, end, encoding) {
  // Handle string cases:
  if (typeof val === 'string') {
    if (typeof start === 'string') {
      encoding = start
      start = 0
      end = this.length
    } else if (typeof end === 'string') {
      encoding = end
      end = this.length
    }
    if (val.length === 1) {
      var code = val.charCodeAt(0)
      if (code < 256) {
        val = code
      }
    }
    if (encoding !== undefined && typeof encoding !== 'string') {
      throw new TypeError('encoding must be a string')
    }
    if (typeof encoding === 'string' && !Buffer.isEncoding(encoding)) {
      throw new TypeError('Unknown encoding: ' + encoding)
    }
  } else if (typeof val === 'number') {
    val = val & 255
  }

  // Invalid ranges are not set to a default, so can range check early.
  if (start < 0 || this.length < start || this.length < end) {
    throw new RangeError('Out of range index')
  }

  if (end <= start) {
    return this
  }

  start = start >>> 0
  end = end === undefined ? this.length : end >>> 0

  if (!val) val = 0

  var i
  if (typeof val === 'number') {
    for (i = start; i < end; ++i) {
      this[i] = val
    }
  } else {
    var bytes = Buffer.isBuffer(val)
      ? val
      : utf8ToBytes(new Buffer(val, encoding).toString())
    var len = bytes.length
    for (i = 0; i < end - start; ++i) {
      this[i + start] = bytes[i % len]
    }
  }

  return this
}

// HELPER FUNCTIONS
// ================

var INVALID_BASE64_RE = /[^+\/0-9A-Za-z-_]/g

function base64clean (str) {
  // Node strips out invalid characters like \n and \t from the string, base64-js does not
  str = stringtrim(str).replace(INVALID_BASE64_RE, '')
  // Node converts strings with length < 2 to ''
  if (str.length < 2) return ''
  // Node allows for non-padded base64 strings (missing trailing ===), base64-js does not
  while (str.length % 4 !== 0) {
    str = str + '='
  }
  return str
}

function stringtrim (str) {
  if (str.trim) return str.trim()
  return str.replace(/^\s+|\s+$/g, '')
}

function toHex (n) {
  if (n < 16) return '0' + n.toString(16)
  return n.toString(16)
}

function utf8ToBytes (string, units) {
  units = units || Infinity
  var codePoint
  var length = string.length
  var leadSurrogate = null
  var bytes = []

  for (var i = 0; i < length; ++i) {
    codePoint = string.charCodeAt(i)

    // is surrogate component
    if (codePoint > 0xD7FF && codePoint < 0xE000) {
      // last char was a lead
      if (!leadSurrogate) {
        // no lead yet
        if (codePoint > 0xDBFF) {
          // unexpected trail
          if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
          continue
        } else if (i + 1 === length) {
          // unpaired lead
          if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
          continue
        }

        // valid lead
        leadSurrogate = codePoint

        continue
      }

      // 2 leads in a row
      if (codePoint < 0xDC00) {
        if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
        leadSurrogate = codePoint
        continue
      }

      // valid surrogate pair
      codePoint = (leadSurrogate - 0xD800 << 10 | codePoint - 0xDC00) + 0x10000
    } else if (leadSurrogate) {
      // valid bmp char, but last char was a lead
      if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
    }

    leadSurrogate = null

    // encode utf8
    if (codePoint < 0x80) {
      if ((units -= 1) < 0) break
      bytes.push(codePoint)
    } else if (codePoint < 0x800) {
      if ((units -= 2) < 0) break
      bytes.push(
        codePoint >> 0x6 | 0xC0,
        codePoint & 0x3F | 0x80
      )
    } else if (codePoint < 0x10000) {
      if ((units -= 3) < 0) break
      bytes.push(
        codePoint >> 0xC | 0xE0,
        codePoint >> 0x6 & 0x3F | 0x80,
        codePoint & 0x3F | 0x80
      )
    } else if (codePoint < 0x110000) {
      if ((units -= 4) < 0) break
      bytes.push(
        codePoint >> 0x12 | 0xF0,
        codePoint >> 0xC & 0x3F | 0x80,
        codePoint >> 0x6 & 0x3F | 0x80,
        codePoint & 0x3F | 0x80
      )
    } else {
      throw new Error('Invalid code point')
    }
  }

  return bytes
}

function asciiToBytes (str) {
  var byteArray = []
  for (var i = 0; i < str.length; ++i) {
    // Node's code seems to be doing this and not & 0x7F..
    byteArray.push(str.charCodeAt(i) & 0xFF)
  }
  return byteArray
}

function utf16leToBytes (str, units) {
  var c, hi, lo
  var byteArray = []
  for (var i = 0; i < str.length; ++i) {
    if ((units -= 2) < 0) break

    c = str.charCodeAt(i)
    hi = c >> 8
    lo = c % 256
    byteArray.push(lo)
    byteArray.push(hi)
  }

  return byteArray
}

function base64ToBytes (str) {
  return base64.toByteArray(base64clean(str))
}

function blitBuffer (src, dst, offset, length) {
  for (var i = 0; i < length; ++i) {
    if ((i + offset >= dst.length) || (i >= src.length)) break
    dst[i + offset] = src[i]
  }
  return i
}

function isnan (val) {
  return val !== val // eslint-disable-line no-self-compare
}

}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
},{"base64-js":23,"ieee754":26,"isarray":27}],25:[function(require,module,exports){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

function EventEmitter() {
  this._events = this._events || {};
  this._maxListeners = this._maxListeners || undefined;
}
module.exports = EventEmitter;

// Backwards-compat with node 0.10.x
EventEmitter.EventEmitter = EventEmitter;

EventEmitter.prototype._events = undefined;
EventEmitter.prototype._maxListeners = undefined;

// By default EventEmitters will print a warning if more than 10 listeners are
// added to it. This is a useful default which helps finding memory leaks.
EventEmitter.defaultMaxListeners = 10;

// Obviously not all Emitters should be limited to 10. This function allows
// that to be increased. Set to zero for unlimited.
EventEmitter.prototype.setMaxListeners = function(n) {
  if (!isNumber(n) || n < 0 || isNaN(n))
    throw TypeError('n must be a positive number');
  this._maxListeners = n;
  return this;
};

EventEmitter.prototype.emit = function(type) {
  var er, handler, len, args, i, listeners;

  if (!this._events)
    this._events = {};

  // If there is no 'error' event listener then throw.
  if (type === 'error') {
    if (!this._events.error ||
        (isObject(this._events.error) && !this._events.error.length)) {
      er = arguments[1];
      if (er instanceof Error) {
        throw er; // Unhandled 'error' event
      } else {
        // At least give some kind of context to the user
        var err = new Error('Uncaught, unspecified "error" event. (' + er + ')');
        err.context = er;
        throw err;
      }
    }
  }

  handler = this._events[type];

  if (isUndefined(handler))
    return false;

  if (isFunction(handler)) {
    switch (arguments.length) {
      // fast cases
      case 1:
        handler.call(this);
        break;
      case 2:
        handler.call(this, arguments[1]);
        break;
      case 3:
        handler.call(this, arguments[1], arguments[2]);
        break;
      // slower
      default:
        args = Array.prototype.slice.call(arguments, 1);
        handler.apply(this, args);
    }
  } else if (isObject(handler)) {
    args = Array.prototype.slice.call(arguments, 1);
    listeners = handler.slice();
    len = listeners.length;
    for (i = 0; i < len; i++)
      listeners[i].apply(this, args);
  }

  return true;
};

EventEmitter.prototype.addListener = function(type, listener) {
  var m;

  if (!isFunction(listener))
    throw TypeError('listener must be a function');

  if (!this._events)
    this._events = {};

  // To avoid recursion in the case that type === "newListener"! Before
  // adding it to the listeners, first emit "newListener".
  if (this._events.newListener)
    this.emit('newListener', type,
              isFunction(listener.listener) ?
              listener.listener : listener);

  if (!this._events[type])
    // Optimize the case of one listener. Don't need the extra array object.
    this._events[type] = listener;
  else if (isObject(this._events[type]))
    // If we've already got an array, just append.
    this._events[type].push(listener);
  else
    // Adding the second element, need to change to array.
    this._events[type] = [this._events[type], listener];

  // Check for listener leak
  if (isObject(this._events[type]) && !this._events[type].warned) {
    if (!isUndefined(this._maxListeners)) {
      m = this._maxListeners;
    } else {
      m = EventEmitter.defaultMaxListeners;
    }

    if (m && m > 0 && this._events[type].length > m) {
      this._events[type].warned = true;
      console.error('(node) warning: possible EventEmitter memory ' +
                    'leak detected. %d listeners added. ' +
                    'Use emitter.setMaxListeners() to increase limit.',
                    this._events[type].length);
      if (typeof console.trace === 'function') {
        // not supported in IE 10
        console.trace();
      }
    }
  }

  return this;
};

EventEmitter.prototype.on = EventEmitter.prototype.addListener;

EventEmitter.prototype.once = function(type, listener) {
  if (!isFunction(listener))
    throw TypeError('listener must be a function');

  var fired = false;

  function g() {
    this.removeListener(type, g);

    if (!fired) {
      fired = true;
      listener.apply(this, arguments);
    }
  }

  g.listener = listener;
  this.on(type, g);

  return this;
};

// emits a 'removeListener' event iff the listener was removed
EventEmitter.prototype.removeListener = function(type, listener) {
  var list, position, length, i;

  if (!isFunction(listener))
    throw TypeError('listener must be a function');

  if (!this._events || !this._events[type])
    return this;

  list = this._events[type];
  length = list.length;
  position = -1;

  if (list === listener ||
      (isFunction(list.listener) && list.listener === listener)) {
    delete this._events[type];
    if (this._events.removeListener)
      this.emit('removeListener', type, listener);

  } else if (isObject(list)) {
    for (i = length; i-- > 0;) {
      if (list[i] === listener ||
          (list[i].listener && list[i].listener === listener)) {
        position = i;
        break;
      }
    }

    if (position < 0)
      return this;

    if (list.length === 1) {
      list.length = 0;
      delete this._events[type];
    } else {
      list.splice(position, 1);
    }

    if (this._events.removeListener)
      this.emit('removeListener', type, listener);
  }

  return this;
};

EventEmitter.prototype.removeAllListeners = function(type) {
  var key, listeners;

  if (!this._events)
    return this;

  // not listening for removeListener, no need to emit
  if (!this._events.removeListener) {
    if (arguments.length === 0)
      this._events = {};
    else if (this._events[type])
      delete this._events[type];
    return this;
  }

  // emit removeListener for all listeners on all events
  if (arguments.length === 0) {
    for (key in this._events) {
      if (key === 'removeListener') continue;
      this.removeAllListeners(key);
    }
    this.removeAllListeners('removeListener');
    this._events = {};
    return this;
  }

  listeners = this._events[type];

  if (isFunction(listeners)) {
    this.removeListener(type, listeners);
  } else if (listeners) {
    // LIFO order
    while (listeners.length)
      this.removeListener(type, listeners[listeners.length - 1]);
  }
  delete this._events[type];

  return this;
};

EventEmitter.prototype.listeners = function(type) {
  var ret;
  if (!this._events || !this._events[type])
    ret = [];
  else if (isFunction(this._events[type]))
    ret = [this._events[type]];
  else
    ret = this._events[type].slice();
  return ret;
};

EventEmitter.prototype.listenerCount = function(type) {
  if (this._events) {
    var evlistener = this._events[type];

    if (isFunction(evlistener))
      return 1;
    else if (evlistener)
      return evlistener.length;
  }
  return 0;
};

EventEmitter.listenerCount = function(emitter, type) {
  return emitter.listenerCount(type);
};

function isFunction(arg) {
  return typeof arg === 'function';
}

function isNumber(arg) {
  return typeof arg === 'number';
}

function isObject(arg) {
  return typeof arg === 'object' && arg !== null;
}

function isUndefined(arg) {
  return arg === void 0;
}

},{}],26:[function(require,module,exports){
exports.read = function (buffer, offset, isLE, mLen, nBytes) {
  var e, m
  var eLen = nBytes * 8 - mLen - 1
  var eMax = (1 << eLen) - 1
  var eBias = eMax >> 1
  var nBits = -7
  var i = isLE ? (nBytes - 1) : 0
  var d = isLE ? -1 : 1
  var s = buffer[offset + i]

  i += d

  e = s & ((1 << (-nBits)) - 1)
  s >>= (-nBits)
  nBits += eLen
  for (; nBits > 0; e = e * 256 + buffer[offset + i], i += d, nBits -= 8) {}

  m = e & ((1 << (-nBits)) - 1)
  e >>= (-nBits)
  nBits += mLen
  for (; nBits > 0; m = m * 256 + buffer[offset + i], i += d, nBits -= 8) {}

  if (e === 0) {
    e = 1 - eBias
  } else if (e === eMax) {
    return m ? NaN : ((s ? -1 : 1) * Infinity)
  } else {
    m = m + Math.pow(2, mLen)
    e = e - eBias
  }
  return (s ? -1 : 1) * m * Math.pow(2, e - mLen)
}

exports.write = function (buffer, value, offset, isLE, mLen, nBytes) {
  var e, m, c
  var eLen = nBytes * 8 - mLen - 1
  var eMax = (1 << eLen) - 1
  var eBias = eMax >> 1
  var rt = (mLen === 23 ? Math.pow(2, -24) - Math.pow(2, -77) : 0)
  var i = isLE ? 0 : (nBytes - 1)
  var d = isLE ? 1 : -1
  var s = value < 0 || (value === 0 && 1 / value < 0) ? 1 : 0

  value = Math.abs(value)

  if (isNaN(value) || value === Infinity) {
    m = isNaN(value) ? 1 : 0
    e = eMax
  } else {
    e = Math.floor(Math.log(value) / Math.LN2)
    if (value * (c = Math.pow(2, -e)) < 1) {
      e--
      c *= 2
    }
    if (e + eBias >= 1) {
      value += rt / c
    } else {
      value += rt * Math.pow(2, 1 - eBias)
    }
    if (value * c >= 2) {
      e++
      c /= 2
    }

    if (e + eBias >= eMax) {
      m = 0
      e = eMax
    } else if (e + eBias >= 1) {
      m = (value * c - 1) * Math.pow(2, mLen)
      e = e + eBias
    } else {
      m = value * Math.pow(2, eBias - 1) * Math.pow(2, mLen)
      e = 0
    }
  }

  for (; mLen >= 8; buffer[offset + i] = m & 0xff, i += d, m /= 256, mLen -= 8) {}

  e = (e << mLen) | m
  eLen += mLen
  for (; eLen > 0; buffer[offset + i] = e & 0xff, i += d, e /= 256, eLen -= 8) {}

  buffer[offset + i - d] |= s * 128
}

},{}],27:[function(require,module,exports){
var toString = {}.toString;

module.exports = Array.isArray || function (arr) {
  return toString.call(arr) == '[object Array]';
};

},{}],28:[function(require,module,exports){
// shim for using process in browser
var process = module.exports = {};

// cached from whatever global is present so that test runners that stub it
// don't break things.  But we need to wrap it in a try catch in case it is
// wrapped in strict mode code which doesn't define any globals.  It's inside a
// function because try/catches deoptimize in certain engines.

var cachedSetTimeout;
var cachedClearTimeout;

function defaultSetTimout() {
    throw new Error('setTimeout has not been defined');
}
function defaultClearTimeout () {
    throw new Error('clearTimeout has not been defined');
}
(function () {
    try {
        if (typeof setTimeout === 'function') {
            cachedSetTimeout = setTimeout;
        } else {
            cachedSetTimeout = defaultSetTimout;
        }
    } catch (e) {
        cachedSetTimeout = defaultSetTimout;
    }
    try {
        if (typeof clearTimeout === 'function') {
            cachedClearTimeout = clearTimeout;
        } else {
            cachedClearTimeout = defaultClearTimeout;
        }
    } catch (e) {
        cachedClearTimeout = defaultClearTimeout;
    }
} ())
function runTimeout(fun) {
    if (cachedSetTimeout === setTimeout) {
        //normal enviroments in sane situations
        return setTimeout(fun, 0);
    }
    // if setTimeout wasn't available but was latter defined
    if ((cachedSetTimeout === defaultSetTimout || !cachedSetTimeout) && setTimeout) {
        cachedSetTimeout = setTimeout;
        return setTimeout(fun, 0);
    }
    try {
        // when when somebody has screwed with setTimeout but no I.E. maddness
        return cachedSetTimeout(fun, 0);
    } catch(e){
        try {
            // When we are in I.E. but the script has been evaled so I.E. doesn't trust the global object when called normally
            return cachedSetTimeout.call(null, fun, 0);
        } catch(e){
            // same as above but when it's a version of I.E. that must have the global object for 'this', hopfully our context correct otherwise it will throw a global error
            return cachedSetTimeout.call(this, fun, 0);
        }
    }


}
function runClearTimeout(marker) {
    if (cachedClearTimeout === clearTimeout) {
        //normal enviroments in sane situations
        return clearTimeout(marker);
    }
    // if clearTimeout wasn't available but was latter defined
    if ((cachedClearTimeout === defaultClearTimeout || !cachedClearTimeout) && clearTimeout) {
        cachedClearTimeout = clearTimeout;
        return clearTimeout(marker);
    }
    try {
        // when when somebody has screwed with setTimeout but no I.E. maddness
        return cachedClearTimeout(marker);
    } catch (e){
        try {
            // When we are in I.E. but the script has been evaled so I.E. doesn't  trust the global object when called normally
            return cachedClearTimeout.call(null, marker);
        } catch (e){
            // same as above but when it's a version of I.E. that must have the global object for 'this', hopfully our context correct otherwise it will throw a global error.
            // Some versions of I.E. have different rules for clearTimeout vs setTimeout
            return cachedClearTimeout.call(this, marker);
        }
    }



}
var queue = [];
var draining = false;
var currentQueue;
var queueIndex = -1;

function cleanUpNextTick() {
    if (!draining || !currentQueue) {
        return;
    }
    draining = false;
    if (currentQueue.length) {
        queue = currentQueue.concat(queue);
    } else {
        queueIndex = -1;
    }
    if (queue.length) {
        drainQueue();
    }
}

function drainQueue() {
    if (draining) {
        return;
    }
    var timeout = runTimeout(cleanUpNextTick);
    draining = true;

    var len = queue.length;
    while(len) {
        currentQueue = queue;
        queue = [];
        while (++queueIndex < len) {
            if (currentQueue) {
                currentQueue[queueIndex].run();
            }
        }
        queueIndex = -1;
        len = queue.length;
    }
    currentQueue = null;
    draining = false;
    runClearTimeout(timeout);
}

process.nextTick = function (fun) {
    var args = new Array(arguments.length - 1);
    if (arguments.length > 1) {
        for (var i = 1; i < arguments.length; i++) {
            args[i - 1] = arguments[i];
        }
    }
    queue.push(new Item(fun, args));
    if (queue.length === 1 && !draining) {
        runTimeout(drainQueue);
    }
};

// v8 likes predictible objects
function Item(fun, array) {
    this.fun = fun;
    this.array = array;
}
Item.prototype.run = function () {
    this.fun.apply(null, this.array);
};
process.title = 'browser';
process.browser = true;
process.env = {};
process.argv = [];
process.version = ''; // empty string to avoid regexp issues
process.versions = {};

function noop() {}

process.on = noop;
process.addListener = noop;
process.once = noop;
process.off = noop;
process.removeListener = noop;
process.removeAllListeners = noop;
process.emit = noop;

process.binding = function (name) {
    throw new Error('process.binding is not supported');
};

process.cwd = function () { return '/' };
process.chdir = function (dir) {
    throw new Error('process.chdir is not supported');
};
process.umask = function() { return 0; };

},{}],29:[function(require,module,exports){
if (typeof Object.create === 'function') {
  // implementation from standard node.js 'util' module
  module.exports = function inherits(ctor, superCtor) {
    ctor.super_ = superCtor
    ctor.prototype = Object.create(superCtor.prototype, {
      constructor: {
        value: ctor,
        enumerable: false,
        writable: true,
        configurable: true
      }
    });
  };
} else {
  // old school shim for old browsers
  module.exports = function inherits(ctor, superCtor) {
    ctor.super_ = superCtor
    var TempCtor = function () {}
    TempCtor.prototype = superCtor.prototype
    ctor.prototype = new TempCtor()
    ctor.prototype.constructor = ctor
  }
}

},{}],30:[function(require,module,exports){
module.exports = function isBuffer(arg) {
  return arg && typeof arg === 'object'
    && typeof arg.copy === 'function'
    && typeof arg.fill === 'function'
    && typeof arg.readUInt8 === 'function';
}
},{}],31:[function(require,module,exports){
(function (process,global){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

var formatRegExp = /%[sdj%]/g;
exports.format = function(f) {
  if (!isString(f)) {
    var objects = [];
    for (var i = 0; i < arguments.length; i++) {
      objects.push(inspect(arguments[i]));
    }
    return objects.join(' ');
  }

  var i = 1;
  var args = arguments;
  var len = args.length;
  var str = String(f).replace(formatRegExp, function(x) {
    if (x === '%%') return '%';
    if (i >= len) return x;
    switch (x) {
      case '%s': return String(args[i++]);
      case '%d': return Number(args[i++]);
      case '%j':
        try {
          return JSON.stringify(args[i++]);
        } catch (_) {
          return '[Circular]';
        }
      default:
        return x;
    }
  });
  for (var x = args[i]; i < len; x = args[++i]) {
    if (isNull(x) || !isObject(x)) {
      str += ' ' + x;
    } else {
      str += ' ' + inspect(x);
    }
  }
  return str;
};


// Mark that a method should not be used.
// Returns a modified function which warns once by default.
// If --no-deprecation is set, then it is a no-op.
exports.deprecate = function(fn, msg) {
  // Allow for deprecating things in the process of starting up.
  if (isUndefined(global.process)) {
    return function() {
      return exports.deprecate(fn, msg).apply(this, arguments);
    };
  }

  if (process.noDeprecation === true) {
    return fn;
  }

  var warned = false;
  function deprecated() {
    if (!warned) {
      if (process.throwDeprecation) {
        throw new Error(msg);
      } else if (process.traceDeprecation) {
        console.trace(msg);
      } else {
        console.error(msg);
      }
      warned = true;
    }
    return fn.apply(this, arguments);
  }

  return deprecated;
};


var debugs = {};
var debugEnviron;
exports.debuglog = function(set) {
  if (isUndefined(debugEnviron))
    debugEnviron = process.env.NODE_DEBUG || '';
  set = set.toUpperCase();
  if (!debugs[set]) {
    if (new RegExp('\\b' + set + '\\b', 'i').test(debugEnviron)) {
      var pid = process.pid;
      debugs[set] = function() {
        var msg = exports.format.apply(exports, arguments);
        console.error('%s %d: %s', set, pid, msg);
      };
    } else {
      debugs[set] = function() {};
    }
  }
  return debugs[set];
};


/**
 * Echos the value of a value. Trys to print the value out
 * in the best way possible given the different types.
 *
 * @param {Object} obj The object to print out.
 * @param {Object} opts Optional options object that alters the output.
 */
/* legacy: obj, showHidden, depth, colors*/
function inspect(obj, opts) {
  // default options
  var ctx = {
    seen: [],
    stylize: stylizeNoColor
  };
  // legacy...
  if (arguments.length >= 3) ctx.depth = arguments[2];
  if (arguments.length >= 4) ctx.colors = arguments[3];
  if (isBoolean(opts)) {
    // legacy...
    ctx.showHidden = opts;
  } else if (opts) {
    // got an "options" object
    exports._extend(ctx, opts);
  }
  // set default options
  if (isUndefined(ctx.showHidden)) ctx.showHidden = false;
  if (isUndefined(ctx.depth)) ctx.depth = 2;
  if (isUndefined(ctx.colors)) ctx.colors = false;
  if (isUndefined(ctx.customInspect)) ctx.customInspect = true;
  if (ctx.colors) ctx.stylize = stylizeWithColor;
  return formatValue(ctx, obj, ctx.depth);
}
exports.inspect = inspect;


// http://en.wikipedia.org/wiki/ANSI_escape_code#graphics
inspect.colors = {
  'bold' : [1, 22],
  'italic' : [3, 23],
  'underline' : [4, 24],
  'inverse' : [7, 27],
  'white' : [37, 39],
  'grey' : [90, 39],
  'black' : [30, 39],
  'blue' : [34, 39],
  'cyan' : [36, 39],
  'green' : [32, 39],
  'magenta' : [35, 39],
  'red' : [31, 39],
  'yellow' : [33, 39]
};

// Don't use 'blue' not visible on cmd.exe
inspect.styles = {
  'special': 'cyan',
  'number': 'yellow',
  'boolean': 'yellow',
  'undefined': 'grey',
  'null': 'bold',
  'string': 'green',
  'date': 'magenta',
  // "name": intentionally not styling
  'regexp': 'red'
};


function stylizeWithColor(str, styleType) {
  var style = inspect.styles[styleType];

  if (style) {
    return '\u001b[' + inspect.colors[style][0] + 'm' + str +
           '\u001b[' + inspect.colors[style][1] + 'm';
  } else {
    return str;
  }
}


function stylizeNoColor(str, styleType) {
  return str;
}


function arrayToHash(array) {
  var hash = {};

  array.forEach(function(val, idx) {
    hash[val] = true;
  });

  return hash;
}


function formatValue(ctx, value, recurseTimes) {
  // Provide a hook for user-specified inspect functions.
  // Check that value is an object with an inspect function on it
  if (ctx.customInspect &&
      value &&
      isFunction(value.inspect) &&
      // Filter out the util module, it's inspect function is special
      value.inspect !== exports.inspect &&
      // Also filter out any prototype objects using the circular check.
      !(value.constructor && value.constructor.prototype === value)) {
    var ret = value.inspect(recurseTimes, ctx);
    if (!isString(ret)) {
      ret = formatValue(ctx, ret, recurseTimes);
    }
    return ret;
  }

  // Primitive types cannot have properties
  var primitive = formatPrimitive(ctx, value);
  if (primitive) {
    return primitive;
  }

  // Look up the keys of the object.
  var keys = Object.keys(value);
  var visibleKeys = arrayToHash(keys);

  if (ctx.showHidden) {
    keys = Object.getOwnPropertyNames(value);
  }

  // IE doesn't make error fields non-enumerable
  // http://msdn.microsoft.com/en-us/library/ie/dww52sbt(v=vs.94).aspx
  if (isError(value)
      && (keys.indexOf('message') >= 0 || keys.indexOf('description') >= 0)) {
    return formatError(value);
  }

  // Some type of object without properties can be shortcutted.
  if (keys.length === 0) {
    if (isFunction(value)) {
      var name = value.name ? ': ' + value.name : '';
      return ctx.stylize('[Function' + name + ']', 'special');
    }
    if (isRegExp(value)) {
      return ctx.stylize(RegExp.prototype.toString.call(value), 'regexp');
    }
    if (isDate(value)) {
      return ctx.stylize(Date.prototype.toString.call(value), 'date');
    }
    if (isError(value)) {
      return formatError(value);
    }
  }

  var base = '', array = false, braces = ['{', '}'];

  // Make Array say that they are Array
  if (isArray(value)) {
    array = true;
    braces = ['[', ']'];
  }

  // Make functions say that they are functions
  if (isFunction(value)) {
    var n = value.name ? ': ' + value.name : '';
    base = ' [Function' + n + ']';
  }

  // Make RegExps say that they are RegExps
  if (isRegExp(value)) {
    base = ' ' + RegExp.prototype.toString.call(value);
  }

  // Make dates with properties first say the date
  if (isDate(value)) {
    base = ' ' + Date.prototype.toUTCString.call(value);
  }

  // Make error with message first say the error
  if (isError(value)) {
    base = ' ' + formatError(value);
  }

  if (keys.length === 0 && (!array || value.length == 0)) {
    return braces[0] + base + braces[1];
  }

  if (recurseTimes < 0) {
    if (isRegExp(value)) {
      return ctx.stylize(RegExp.prototype.toString.call(value), 'regexp');
    } else {
      return ctx.stylize('[Object]', 'special');
    }
  }

  ctx.seen.push(value);

  var output;
  if (array) {
    output = formatArray(ctx, value, recurseTimes, visibleKeys, keys);
  } else {
    output = keys.map(function(key) {
      return formatProperty(ctx, value, recurseTimes, visibleKeys, key, array);
    });
  }

  ctx.seen.pop();

  return reduceToSingleString(output, base, braces);
}


function formatPrimitive(ctx, value) {
  if (isUndefined(value))
    return ctx.stylize('undefined', 'undefined');
  if (isString(value)) {
    var simple = '\'' + JSON.stringify(value).replace(/^"|"$/g, '')
                                             .replace(/'/g, "\\'")
                                             .replace(/\\"/g, '"') + '\'';
    return ctx.stylize(simple, 'string');
  }
  if (isNumber(value))
    return ctx.stylize('' + value, 'number');
  if (isBoolean(value))
    return ctx.stylize('' + value, 'boolean');
  // For some reason typeof null is "object", so special case here.
  if (isNull(value))
    return ctx.stylize('null', 'null');
}


function formatError(value) {
  return '[' + Error.prototype.toString.call(value) + ']';
}


function formatArray(ctx, value, recurseTimes, visibleKeys, keys) {
  var output = [];
  for (var i = 0, l = value.length; i < l; ++i) {
    if (hasOwnProperty(value, String(i))) {
      output.push(formatProperty(ctx, value, recurseTimes, visibleKeys,
          String(i), true));
    } else {
      output.push('');
    }
  }
  keys.forEach(function(key) {
    if (!key.match(/^\d+$/)) {
      output.push(formatProperty(ctx, value, recurseTimes, visibleKeys,
          key, true));
    }
  });
  return output;
}


function formatProperty(ctx, value, recurseTimes, visibleKeys, key, array) {
  var name, str, desc;
  desc = Object.getOwnPropertyDescriptor(value, key) || { value: value[key] };
  if (desc.get) {
    if (desc.set) {
      str = ctx.stylize('[Getter/Setter]', 'special');
    } else {
      str = ctx.stylize('[Getter]', 'special');
    }
  } else {
    if (desc.set) {
      str = ctx.stylize('[Setter]', 'special');
    }
  }
  if (!hasOwnProperty(visibleKeys, key)) {
    name = '[' + key + ']';
  }
  if (!str) {
    if (ctx.seen.indexOf(desc.value) < 0) {
      if (isNull(recurseTimes)) {
        str = formatValue(ctx, desc.value, null);
      } else {
        str = formatValue(ctx, desc.value, recurseTimes - 1);
      }
      if (str.indexOf('\n') > -1) {
        if (array) {
          str = str.split('\n').map(function(line) {
            return '  ' + line;
          }).join('\n').substr(2);
        } else {
          str = '\n' + str.split('\n').map(function(line) {
            return '   ' + line;
          }).join('\n');
        }
      }
    } else {
      str = ctx.stylize('[Circular]', 'special');
    }
  }
  if (isUndefined(name)) {
    if (array && key.match(/^\d+$/)) {
      return str;
    }
    name = JSON.stringify('' + key);
    if (name.match(/^"([a-zA-Z_][a-zA-Z_0-9]*)"$/)) {
      name = name.substr(1, name.length - 2);
      name = ctx.stylize(name, 'name');
    } else {
      name = name.replace(/'/g, "\\'")
                 .replace(/\\"/g, '"')
                 .replace(/(^"|"$)/g, "'");
      name = ctx.stylize(name, 'string');
    }
  }

  return name + ': ' + str;
}


function reduceToSingleString(output, base, braces) {
  var numLinesEst = 0;
  var length = output.reduce(function(prev, cur) {
    numLinesEst++;
    if (cur.indexOf('\n') >= 0) numLinesEst++;
    return prev + cur.replace(/\u001b\[\d\d?m/g, '').length + 1;
  }, 0);

  if (length > 60) {
    return braces[0] +
           (base === '' ? '' : base + '\n ') +
           ' ' +
           output.join(',\n  ') +
           ' ' +
           braces[1];
  }

  return braces[0] + base + ' ' + output.join(', ') + ' ' + braces[1];
}


// NOTE: These type checking functions intentionally don't use `instanceof`
// because it is fragile and can be easily faked with `Object.create()`.
function isArray(ar) {
  return Array.isArray(ar);
}
exports.isArray = isArray;

function isBoolean(arg) {
  return typeof arg === 'boolean';
}
exports.isBoolean = isBoolean;

function isNull(arg) {
  return arg === null;
}
exports.isNull = isNull;

function isNullOrUndefined(arg) {
  return arg == null;
}
exports.isNullOrUndefined = isNullOrUndefined;

function isNumber(arg) {
  return typeof arg === 'number';
}
exports.isNumber = isNumber;

function isString(arg) {
  return typeof arg === 'string';
}
exports.isString = isString;

function isSymbol(arg) {
  return typeof arg === 'symbol';
}
exports.isSymbol = isSymbol;

function isUndefined(arg) {
  return arg === void 0;
}
exports.isUndefined = isUndefined;

function isRegExp(re) {
  return isObject(re) && objectToString(re) === '[object RegExp]';
}
exports.isRegExp = isRegExp;

function isObject(arg) {
  return typeof arg === 'object' && arg !== null;
}
exports.isObject = isObject;

function isDate(d) {
  return isObject(d) && objectToString(d) === '[object Date]';
}
exports.isDate = isDate;

function isError(e) {
  return isObject(e) &&
      (objectToString(e) === '[object Error]' || e instanceof Error);
}
exports.isError = isError;

function isFunction(arg) {
  return typeof arg === 'function';
}
exports.isFunction = isFunction;

function isPrimitive(arg) {
  return arg === null ||
         typeof arg === 'boolean' ||
         typeof arg === 'number' ||
         typeof arg === 'string' ||
         typeof arg === 'symbol' ||  // ES6 symbol
         typeof arg === 'undefined';
}
exports.isPrimitive = isPrimitive;

exports.isBuffer = require('./support/isBuffer');

function objectToString(o) {
  return Object.prototype.toString.call(o);
}


function pad(n) {
  return n < 10 ? '0' + n.toString(10) : n.toString(10);
}


var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep',
              'Oct', 'Nov', 'Dec'];

// 26 Feb 16:19:34
function timestamp() {
  var d = new Date();
  var time = [pad(d.getHours()),
              pad(d.getMinutes()),
              pad(d.getSeconds())].join(':');
  return [d.getDate(), months[d.getMonth()], time].join(' ');
}


// log is just a thin wrapper to console.log that prepends a timestamp
exports.log = function() {
  console.log('%s - %s', timestamp(), exports.format.apply(exports, arguments));
};


/**
 * Inherit the prototype methods from one constructor into another.
 *
 * The Function.prototype.inherits from lang.js rewritten as a standalone
 * function (not on Function.prototype). NOTE: If this file is to be loaded
 * during bootstrapping this function needs to be rewritten using some native
 * functions as prototype setup using normal JavaScript does not work as
 * expected during bootstrapping (see mirror.js in r114903).
 *
 * @param {function} ctor Constructor function which needs to inherit the
 *     prototype.
 * @param {function} superCtor Constructor function to inherit prototype from.
 */
exports.inherits = require('inherits');

exports._extend = function(origin, add) {
  // Don't do anything if add isn't an object
  if (!add || !isObject(add)) return origin;

  var keys = Object.keys(add);
  var i = keys.length;
  while (i--) {
    origin[keys[i]] = add[keys[i]];
  }
  return origin;
};

function hasOwnProperty(obj, prop) {
  return Object.prototype.hasOwnProperty.call(obj, prop);
}

}).call(this,require('_process'),typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
},{"./support/isBuffer":30,"_process":28,"inherits":29}]},{},[1]);
