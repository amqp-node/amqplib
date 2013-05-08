//
//
//

// Channel-centric model. This is like the RabbitMQ Java client, in
// which channels are general-purpose.

var defs = require('./defs');
var defer = require('when').defer;
var assert = require('assert');

function ChannelModel(connection) {
  this.connection = connection;
}

var CM = ChannelModel.prototype;

CM.createChannel = function() {
  var c;
  c = new Channel(this.connection,
                  this.connection.freshChannel(function(f) {
                    c.handle(f);
                  }));
  return c.rpc(defs.ChannelOpen, {outOfBand: ""},
               defs.ChannelOpenOk)
    .then(function(openok) {
      return c;
    });
};

module.exports.ChannelModel = ChannelModel;

function Channel(connection, ch) {
  this.ch = ch;
  this.connection = connection;
  // for the presently outstanding RPC
  this.reply = null;
  // for the RPCs awaiting action
  this.pending = [];
}

var C = Channel.prototype;


/*

There's three modes of interaction over a connection. The first is
simply to receive frames -- e.g., deliveries. The second is to send a
method, then at some later point, receive a reply. The AMQP spec
implies that RPCs can't be pipelined; that is, you can only have one
outstanding RPC per channel at a time. Certainly that's what RabbitMQ
and its clients assume. In these two modes, the way to dispatch
methods is

  1. If it's a reply method, look for the request in channel['rpc']
  and hand it the method 2. Otherwise, emit the method

The third mode is during the opening handshake, when there is a
specific sequence of methods involved. Presently this is implemented
in the connection rather than here.

*/

// Just send the damn frame.
C.sendImmediately = function(method, fields) {
  return this.connection.sendMethod(this.ch, method, fields);
};

// Invariant: !this.reply -> pending.length == 0. That is, whenever we
// clear a reply, we must send another RPC (and thereby fill
// this.reply) if there is one waiting.

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

C.rpc = function(method, fields, expect) {
  var reply = defer();
  this.sendOrEnqueue(method, fields, reply);
  return reply.promise.then(function(f) {
    if (f.id === expect) {
      return f;
    }
    else throw new Error("Expected " + expect + " but got " + f);
  });
};

// Euw. I wonder if a key test is faster? Maybe move it into generated
// code anyway.
function isReply(method) {
  switch (method) {
  case defs.ChannelOpenOk:
  case defs.ChannelFlowOk:
  case defs.ChannelCloseOk:
  case defs.ExchangeDeclareOk:
  case defs.ExchangeDeleteOk:
  case defs.ExchangeBindOk:
  case defs.ExchangeUnbindOk:
  case defs.QueueDeclareOk:
  case defs.QueueBindOk:
  case defs.QueuePurgeOk:
  case defs.QueueDeleteOk:
  case defs.QueueUnbindOk:
  case defs.BasicQosOk:
  case defs.BasicConsumeOk:
  case defs.BasicCancelOk:
  case defs.BasicGetOk:
  case defs.BasicEmpty:
  case defs.BasicRecoverOk:
  case defs.TxSelectOk:
  case defs.TxCommitOk:
  case defs.TxRollbackOk:
  case defs.ConfirmSelectOk:
    return true;
  default:
    return false; 
  }
}

C.handle = function(f) {
  if (isReply(f.id)) {
    // Resolving the reply may lead to another RPC; to make sure we
    // don't hold that up, clear this.reply
    var reply = this.reply; this.reply = null;
    // however, maybe there's an RPC waiting to go? If so, that'll
    // fill this.reply again, restoring the invariant. This does rely
    // on any response being recv'ed after resolving the promise,
    // below.
    if (this.pending.length > 0) {
      var send = this.pending.shift();
      this.reply = send.reply;
      this.sendImmediately(send.method, send.fields);
    }
    reply.resolve(f);
  }
  else if (f.id === defs.ChannelClose) {
    if (this.reply) {
      // %%% Can I do anything with the classId & methodId?
      var e = new Error("Channel closed: " + f.replyText);
      this.reply.reject(e);
    }
    this.sendImmediately(defs.ChannelCloseOk, {});
    // %%% ORLY?
    this.pending.forEach(function(s) { s.reply.reject(e); });
    this.cleanup();
  }
  else {
    this.emit('frame', f); // %%% TODO
  }
};

C.cleanup = function() {
  this.connection.releaseChannel(this.ch);
  this.handle = function(f) {
    throw new Error("Unexpected frame on closed channel " + f);
  };
  // %%% what about sending?
}

// Public API, declaring queues and stuff

// Assert a queue into existence. This will bork the channel if the
// queue already exists but has different properties; values supplied
// in the `arguments` table may or may not count for borking purposes
// (check the broker's documentation). If you supply an empty string
// as `queue` the server will create a random name for you.
// The options are:
// - `exclusive`: if true, scopes the queue to the connection
// (defaults to false)
// - `durable`: if true, the queue will survive broker restarts,
// modulo the effects of `exclusive` and `autoDelete`; this defaults
// to true if not supplied, unlike the others
// - `autoDelete`: if true, the queue will be deleted when the number
// of consumers drops to zero (defaults to false)
// - `arguments`: additional arguments, usually parameters for some
// kind of broker-sepcific extension e.g., high availability, TTL.
C.declareQueue = function(queue, options) {
  var fields = {
    queue: queue,
    exclusive: !!options.exclusive,
    durable: (options.durable === undefined) ? true : options.durable,
    autoDelete: !!options.autoDelete,
    arguments: options.arguments || {},
    passive: false,
    // deprecated but we have to include it
    ticket: 0,
    nowait: false // aka "your guess is as good as mine"
  };
  return this.rpc(defs.QueueDeclare, fields, defs.QueueDeclareOk);
};

// Check whether a queue exists. This will bork the channel if the
// named queue *doesn't* exist; if it does exist, hooray! There's no
// options as with `declareQueue`, just the queue name.
C.checkQueue = function(queue) {
  var fields = {
    queue: queue,
    passive: true, // switch to "completely different" mode
    ticket: 0,
    nowait: false
  };
  return this.rpc(defs.QueueDeclare, fields, defs.QueueDeclareOk);
};

/*
Publish a single message on the connection. The mandatory parameters
(these go in the publish method itself) are:

 - `exchange` and `routingKey`: the exchange and routing key, which
 determine where the message goes. A special case is sending `''` as
 the exchange, which will send directly to the queue named by the
 routing key.

The remaining parameters are optional, and are divided into those that
have some meaning to RabbitMQ and those that will be ignored by
RabbitMQ.

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
C.publish = function(params, content) {
  // The CC and BCC fields expect an array of "longstr", which would
  // normally be buffer values in JavaScript; however, since a field
  // array (or table) cannot have shortstr values, the codec will
  // encode all strings as longstrs anyway.
  function convertCC(cc) {
    if (cc === undefined) {
      return undefined;
    }
    else if (typeof cc === 'string') {
      return [cc];
    }
    else if (Array.isArray(cc)) {
      return cc.map(convertCC);
    }
    else return [cc.toString()];
  }

  var fields = {
    exchange: params.exchange,
    routingKey: params.routingKey,
    mandatory: !!params.mandatory,
    immediate: false,
    ticket: 0
  };
  var headers;
  if (params.CC || params.BCC) {
    headers = {};
    for (var k in params.headers) headers[k] = params.headers[k];
    headers.CC = convertCC(params.CC);
    headers.BCC = convertCC(params.BCC);
  }
  else headers = params.headers;
  var deliveryMode; // undefined will default to 1 (non-persistent)
  if (params.deliveryMode) deliveryMode = 2;
  var expiration = params.expiration;
  if (expiration !== undefined) expiration = expiration.toString();

  var properties = {
    contentType: params.contentType,
    contentEncoding: params.contentEncoding,
    headers: headers,
    deliveryMode: deliveryMode,
    priority: params.priority,
    correlationId: params.correlationId,
    replyTo: params.replyTo,
    expiration: expiration,
    messageId: params.messageId,
    timestamp: params.timestamp,
    type: params.type,
    userId: params.userId,
    appId: params.appId,
    clusterId: ''
  };
  this.connection.sendMethod(this.ch, defs.BasicPublish, fields);
  return this.connection.sendContent(this.ch,
                                     defs.BasicProperties, properties,
                                     content);
};


// Note to self: Get needs special treatment since it can have two
// replies

C.emit = function(frame) { console.log(frame); };
