//
//
//

// Channel machinery.

var defs = require('./defs');
var when = require('when'), defer = when.defer;
var deferSync = require('./sync_defer').defer;
var assert = require('assert');
var inherits = require('util').inherits;
var EventEmitter = require('events').EventEmitter;

function Channel(connection) {
  this.ch = connection.freshChannel(this); // %% move to open?
  this.connection = connection;
  // for the presently outstanding RPC
  this.reply = null;
  // for the RPCs awaiting action
  this.pending = [];
  this.handleMessage = unexpectedFrame;
}
inherits(Channel, EventEmitter);

module.exports.Channel = Channel;

var C = Channel.prototype;

/*

There's three intermingled modes of interaction over a channel. The
first is simply to receive frames -- e.g., deliveries. The second is
to send a method, then at some later point, receive a reply. The AMQP
spec implies that RPCs can't be pipelined; that is, you can only have
one outstanding RPC per channel at a time. Certainly that's what
RabbitMQ and its clients assume. In these two modes, the way to
dispatch methods is

  1. If it's a reply method, look for the request in channel['reply']
  and hand it the method
  2. Otherwise, emit the method

The third mode is during the opening handshake, when there is a
specific sequence of methods involved. Presently this is implemented
in the connection rather than here, since it's not general-purpose.

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

C.sendMessage = function(fields, properties, content) {
  this.sendImmediately(defs.BasicPublish, fields);
  return this.connection.sendContent(this.ch,
                                     defs.BasicProperties, properties,
                                     content);
};

// Internal, synchronously resolved RPC
C._rpc = function(method, fields, expect) {
  var reply = deferSync();
  this.sendOrEnqueue(method, fields, reply);
  return reply.promise.then(function(f) {
    if (f.id === expect) {
      return f;
    }
    else throw new Error("Expected " + expect + " but got " + f);
  });
};

// An RPC that returns a 'proper' promise
C.rpc = function(method, fields, expect) {
  return when(this._rpc(method, fields, expect));
};

// Do the remarkably simple channel open handshake
C.open = function() {
  return this.rpc(defs.ChannelOpen, {outOfBand: ""},
                  defs.ChannelOpenOk);
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

// Move to entirely closed state. If err is provided, it was closed
// because there was an error; if not, it was all as intended.
C.toClosed = function(err) {
  this.sendImmediately = Channel.sendMessage = Channel.closedSend;
  this.sendOrEnqueue = Channel.closedEnqueue;
  this.accept = Channel.closedAccept;
  this.connection.releaseChannel(this.ch);
  if (err) this.emit('error', err);
  else this.emit('close');
};

Channel.closedSend = function() {
  throw new Error("Channel is closed, do not use");
};
Channel.closedAccept = function(f) {
  throw new Error("Channel is closed, not expecting frame: " + f);
};
Channel.closedEnqueue = function(_method, _fields, reply) {
  reply.reject(new Error("Channel is closed"));
};

// Stop being able to send and receive methods and content. Used when
// a channel close happens, and also by the connection when it closes.
C.stop = function() {
  // emit this now so apps have a chance to prepare for pending RPCs
  // to fail; but they can't respond by sending more.
  this.emit('end');

  function rej(r) { 
    r.reject(new Error("Channel ended, no reply will be forthcoming"));
  }
  if (this.reply) rej(this.reply);
  this.pending.forEach(rej);
  this.pending = null; // so pushes will break
};

// And the API for closing channels.
C.close = function() {
  return this.closeBecause("Goodbye", defs.constants.REPLY_SUCCESS);
};

C.closeBecause = function(reason, code) {
  this.sendImmediately(defs.ChannelClose, {
    replyText: reason,
    replyCode: code,
    methodId:0, classId: 0
  });
  
  var done = defer();
  var self = this;
  this.accept = function(f) {
    if (f.id === defs.ChannelCloseOk) {
      done.resolve();
      self.toClosed();
    }
    else if (f.id === defs.ChannelClose) {
      this.sendImmediately(defs.ChannelCloseOk, {});
    }
    else; // drop the frame
  };
  this.stop();
  return done.promise;
};

function unexpectedFrame(f) {
  throw new Error("Unannounced message frame: " + f)
}

// Kick off a message delivery given a BasicDeliver frame (BasicGet
// uses the RPC mechanism)
function acceptDelivery(f) {
  var self = this;
  var fields = f.fields;
  return Channel.acceptMessage(function(message) {
    message.fields = fields;
    self.emit('delivery', message);
  });
}

// A state machine for message frames on a channel. Message arrives in
// at least three frames: first, a method announcing the message
// (either a BaiscDeliver or BasicGetOk); then, a message header with
// the message properties; then, one or more content frames. Message
// frames may be interleaved with method frames per channel, but they
// must not be interleaved with other message frames.

Channel.acceptMessage = function(continuation) {
  var remaining = 0;
  var buffers = null;

  var message = {
    fields: null,
    properties: null,
    content: null
  };

  return headers;

  // ---states
  function headers(f) {
    if (f.id === defs.BasicProperties) {
      message.properties = f.fields;
      remaining = f.size;
      return content;
    }
    else {
      throw new Error("Expected headers frame after delivery");
    }
  }

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
        return unexpectedFrame;
      }
      else if (remaining < 0) {
        throw new Error("Too much content sent!");
      }
      else {
        if (buffers !== null)
          buffers.push(f.content);
        else
          buffers = [f.content];
        return content;
      }
    }
    else throw new Error("Expected content frame after headers")
  }
}

C.accept = function(f) {

  var self = this;

  switch (f.id) {

    // Message frames
  case defs.BasicDeliver:
    // prime for invoking handler just below
    this.handleMessage = acceptDelivery;
  case undefined: // content frame!
  case defs.BasicProperties:
    this.handleMessage = this.handleMessage(f);
    return;

    // confirmations, need to do confirm.select first
  case defs.BasicAck:
  case defs.BasicNack:
    throw new Error("Confirmations not implemented");

  case defs.ChannelClose:
    // Any remote closure is an error to us.
    var e = new Error("Channel closed: " + f.fields.replyText);
    if (this.reply) {
      // %%% Can I do anything with the classId & methodId?
      var r = this.reply; this.reply = null;
      r.reject(e);
    }
    this.stop();
    this.sendImmediately(defs.ChannelCloseOk, {});
    this.toClosed(e);
    return;

  case defs.BasicCancel:
    // The broker can send this if e.g., the queue is deleted.
    // TODO (also needs to send capability in client properties)
    throw new Error("Unexpected consumer cancel notification");
  case defs.BasicReturn:
    throw new Error("I don't handle returns yet");
  case defs.BasicFlow:
    // rabbit doesn't send this, it just blocks the TCP socket
    throw new Error("I wasn't expecting a flow method");

  default: // assume all other things are replies
    // Resolving the reply may lead to another RPC; to make sure we
    // don't hold that up, clear this.reply
    var reply = this.reply; this.reply = null;
    // however, maybe there's an RPC waiting to go? If so, that'll
    // fill this.reply again, restoring the invariant. This does rely
    // on any response being recv'ed after resolving the promise,
    // below; for that reason, synchronous deferreds are used.
    if (this.pending.length > 0) {
      var send = this.pending.shift();
      this.reply = send.reply;
      this.sendImmediately(send.method, send.fields);
    }
    return reply.resolve(f);
  }
};
