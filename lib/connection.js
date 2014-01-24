//
//
//

'use strict';

var defs = require('./defs');
var constants = defs.constants;
var frame = require('./frame');
var HEARTBEAT = frame.HEARTBEAT;
var Mux = require('./mux').Mux;

var Duplex =
  require('stream').Duplex ||
  require('readable-stream/duplex');
var EventEmitter = require('events').EventEmitter;
var Heart = require('./heartbeat').Heart;

var methodName = require('./format').methodName;
var closeMsg = require('./format').closeMessage;
var inspect = require('./format').inspect;

var BitSet = require('./bitset').BitSet;
var defer = require('when').defer;
var inherits = require('util').inherits;
var fmt = require('util').format;
var PassThrough = require('stream').PassThrough ||
  require('readable-stream/passthrough');
var IllegalOperationError = require('./error').IllegalOperationError;
var stackCapture = require('./error').stackCapture;

// High-water mark for channel write buffers, in 'objects' (which are
// encoded frames as buffers).
var DEFAULT_WRITE_HWM = 1024;
// If all the frames of a message (method, properties, content) total
// to less than this, copy them into a single buffer and write it all
// at once. Note that this is less than the minimum frame size: if it
// was greater, we might have to fragment the content.
var SINGLE_CHUNK_THRESHOLD = 2048;

function Connection(underlying) {
  var stream = this.stream = wrapStream(underlying);
  this.muxer = new Mux(stream);

  // frames
  this.rest = new Buffer(0);
  this.frameMax = constants.FRAME_MIN_SIZE;
  this.sentSinceLastCheck = false;
  this.recvSinceLastCheck = false;

  this.expectSocketClose = false;
  this.freeChannels = new BitSet();
  this.channels = [{channel: {accept: channel0(this)},
                    buffer: underlying}];
}
inherits(Connection, EventEmitter);

var C = Connection.prototype;

// Usual frame accept mode
function mainAccept(frame) {
  var rec = this.channels[frame.channel];
  if (rec) { return rec.channel.accept(frame); }
  // NB CHANNEL_ERROR may not be right, but I don't know what is ..
  else
    this.closeWithError(
      fmt('Frame on unknown channel %d', frame.channel),
      constants.CHANNEL_ERROR,
      new Error(fmt("Frame on unknown channel: %s",
                    inspect(frame, false))));
}

// Handle anything that comes through on channel 0, that's the
// connection control channel. This is only used once mainAccept is
// installed as the frame handler, after the opening handshake.
function channel0(connection) {
  return function(f) {
    // Once we get a 'close', we know 1. we'll get no more frames, and
    // 2. anything we send except close, or close-ok, will be
    // ignored. If we already sent 'close', this won't be invoked since
    // we're already in closing mode; if we didn't well we're not going
    // to send it now are we.
    if (f === HEARTBEAT); // ignore; it's already counted as activity
                          // on the socket, which is its purpose
    else if (f.id === defs.ConnectionClose) {
      // Oh. OK. I guess we're done here then.
      connection.sendMethod(0, defs.ConnectionCloseOk, {});
      var emsg = fmt('Connection closed: %s', closeMsg(f));
      var s = stackCapture(emsg);
      connection.emit('error', new Error(emsg));
      connection.toClosed(s);
    }
    else if (f.id === defs.ConnectionBlocked) {
      connection.emit('blocked', f.fields.reason);
    }
    else if (f.id === defs.ConnectionUnblocked) {
      connection.emit('unblocked');
    }
    else {
      connection.closeWithError(
        fmt("Unexpected frame on channel 0"),
        constants.UNEXPECTED_FRAME,
        new Error(fmt("Unexpected frame on channel 0: %s",
                      inspect(f, false))));
    }
  };
}

// This changed between versions, as did the codec, methods, etc. AMQP
// 0-9-1 is fairly similar to 0.8, but better, and nothing implements
// 0.8 that doesn't implement 0-9-1. In other words, it doesn't make
// much sense to generalise here.
C.sendProtocolHeader = function() {
  this.sendBytes(frame.PROTOCOL_HEADER);
};

/*
  The frighteningly complicated opening protocol (spec section 2.2.4):

     Client -> Server

       protocol header ->
         <- start
       start-ok ->
     .. next two zero or more times ..
         <- secure
       secure-ok ->
         <- tune
       tune-ok ->
       open ->
         <- open-ok

If I'm only supporting SASL's PLAIN mechanism (which I am for the time
being), it gets a bit easier since the server won't in general send
back a `secure`, it'll just send `tune` after the `start-ok`.
(SASL PLAIN: http://tools.ietf.org/html/rfc4616)

*/

C.open = function(allOptions) {
  var self = this;

  // This is where we'll put our negotiated values
  var tunedOptions = Object.create(allOptions);

  function await() {
    var reply = defer();
    self.step(function(err, frame) {
      if (err !== null) return reply.reject(err);
      if (frame.channel !== 0)
        reply.reject(
          new Error(fmt("Frame on channel != 0 during handshake: %s",
                        inspect(frame, false))));
      else
        reply.resolve(frame);
    });
    return reply.promise;
  }

  function expect(Method) {
    return await().then(function(frame) {
      if (frame.id === Method)
        return frame;
      else
        throw new Error(fmt("Expected %s; got %s",
                            methodName(Method), inspect(frame, false)));
    });
  }

  function send(Method) {
    self.sendMethod(0, Method, tunedOptions);
  }

  function negotiate(server, client) {
    // We get sent values for channelMax, frameMax and heartbeat,
    // which we may accept or lower (subject to a minimum for
    // frameMax, but we'll leave that to the server to enforce). In
    // all cases, `0` really means `+infinity`, that is, no limit
    // (except that of the encoded representation, e.g., unsigned
    // short for channelMax). RabbitMQ allows all these figures to be
    // negotiated downward, *including* to zero i.e., no limit.
    return (server === 0) ? client : Math.min(server, client);
  }

  var opened = defer();

  var handshake = expect(defs.ConnectionStart)
    .then(function(start) {
      send(defs.ConnectionStartOk);
      return await();
    })
    .then(function(reply) {
      switch (reply.id) {
      case defs.ConnectionSecure:
        throw new Error(
          "Wasn't expecting to have to go through secure");
      case defs.ConnectionClose:
        throw new Error(fmt("Handshake terminated by server: %s",
                            closeMsg(reply)));
      case defs.ConnectionTune:
        var fields = reply.fields;
        tunedOptions.frameMax =
          negotiate(fields.frameMax, allOptions.frameMax);
        tunedOptions.channelMax =
          negotiate(fields.channelMax, allOptions.channelMax);
        tunedOptions.heartbeat =
          negotiate(fields.heartbeat, allOptions.heartbeat);
        send(defs.ConnectionTuneOk);
        send(defs.ConnectionOpen);
        return expect(defs.ConnectionOpenOk);
      default:
        throw new Error(
          fmt("Expected connection.secure, connection.close, " +
              "or connection.tune during handshake; got %s",
              inspect(reply, false)));
      }
    })
    .then(function(openOk) {
      self.channelMax = tunedOptions.channelMax || 0xffff;
      self.frameMax = tunedOptions.frameMax || 0xffffffff;
      self.heartbeat = tunedOptions.heartbeat;
      self.heartbeater = self.startHeartbeater();
      self.accept = mainAccept;
      return openOk;
    });

  // If the server closes the connection, it's probably because of
  // something we did
  function endWhileOpening(err) {
    opened.reject(err || new Error('Socket closed abruptly ' +
                                   'during opening handshake'));
  }

  this.stream.on('end', endWhileOpening);
  this.stream.on('error', endWhileOpening);

  handshake.then(function(ok) {

    self.stream.removeListener('end', endWhileOpening);
    self.stream.removeListener('error', endWhileOpening);

    self.stream.on('error', self.onSocketError.bind(self));    
    self.stream.on('end', self.onSocketError.bind(
      self, new Error('Unexpected close')));
    self.on('frameError', self.onSocketError.bind(self));

    opened.resolve(ok);
    self.acceptLoop();
  }, opened.reject);

  // Now kick off the handshake by prompting the server
  this.sendProtocolHeader();

  return opened.promise;
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
C.close = function() {
  var closed = defer();
  this.closeBecause("Cheers, thanks", constants.REPLY_SUCCESS,
                    closed.resolve);
  return closed.promise;
};

// Close with a reason and a 'code'. I'm pretty sure RabbitMQ totally
// ignores these; maybe it logs them. The callback will be invoked
// when the CloseOk has been received, and before the 'close' event.
C.closeBecause = function(reason, code, cb) {
  this.sendMethod(0, defs.ConnectionClose, {
    replyText: reason,
    replyCode: code,
    methodId: 0, classId: 0
  });
  var s = stackCapture('closeBecause called: ' + reason);
  this.toClosing(s, cb);
};

C.closeWithError = function(reason, code, error) {
  this.emit('error', error);
  this.closeBecause(reason, code);
};

C.onSocketError = function(err) {
  if (!this.expectSocketClose) {
    // forestall any more calls to onSocketError, since we're signed
    // up for `'error'` *and* `'end'`
    this.expectSocketClose = true;
    this.emit('error', err);
    var s = stackCapture('Socket error');
    this.toClosed(s);
  }
};

function invalidOp(msg, stack) {
  return function() {
    throw new IllegalOperationError(msg, stack);
  };
}

function invalidateSend(conn, msg, stack) {
  conn.sendMethod = conn.sendContent = conn.sendMessage =
    invalidOp(msg, stack);
}

// A close has been initiated. Repeat: a close has been initiated.
// This means we should not send more frames, anyway they will be
// ignored. We also have to shut down all the channels.
C.toClosing = function(capturedStack, cb) {
  var send = this.sendMethod.bind(this);

  this.accept = function(f) {
    if (f.id === defs.ConnectionCloseOk) {
      if (cb) cb();
      var s = stackCapture('ConnectionCloseOk received');
      this.toClosed(s);
    }
    else if (f.id === defs.ConnectionClose) {
      send(0, defs.ConnectionCloseOk, {});
    }
    // else ignore frame
  };
  invalidateSend(this, 'Connection closing', capturedStack);
};

C._closeChannels = function(capturedStack) {
  for (var i = 1; i < this.channels.length; i++) {
    var ch = this.channels[i];
    if (ch !== null) {
      ch.channel.toClosed(capturedStack); // %%% or with an error? not clear
    }
  }
};

// A close has been confirmed. Cease all communication.
C.toClosed = function(capturedStack) {
  this._closeChannels(capturedStack);
  // Tidy up, invalidate enverything, dynamite the bridges.
  invalidateSend(this, 'Connection closed', capturedStack);
  this.accept = invalidOp('Connection closed', capturedStack);
  if (this.heartbeater) this.heartbeater.clear();
  // This is certainly true now, if it wasn't before
  this.expectSocketClose = true;
  this.stream.end();
  this.emit('close');
};

// ===

C.startHeartbeater = function() {
  if (this.heartbeat === 0) return null;
  else {
    var self = this;
    var hb = new Heart(this.heartbeat,
                       this.checkSend.bind(this),
                       this.checkRecv.bind(this));
    hb.on('timeout', function() {
      self.emit('error', new Error("Heartbeat timeout"));
      var s = stackCapture('Heartbeat timeout');
      self.toClosed(s);
    });
    hb.on('beat', function() {
      self.sendHeartbeat();
    });
    return hb;
  }
};

// I use an array to keep track of the channels, rather than an
// object. The channel identifiers are numbers, and allocated by the
// connection. If I try to allocate low numbers when they are
// available (which I do, by looking from the start of the bitset),
// this ought to keep the array small, and out of 'sparse array
// storage'. I also set entries to null, rather than deleting them, in
// the expectation that the next channel allocation will fill the slot
// again rather than growing the array. See
// http://www.html5rocks.com/en/tutorials/speed/v8/
C.freshChannel = function(channel, options) {
  var next = this.freeChannels.nextClearBit(1);
  if (next < 0 || next > this.channelMax)
    throw new Error("No channels left to allocate");
  this.freeChannels.set(next);

  var hwm = (options && options.highWaterMark) || DEFAULT_WRITE_HWM;
  var writeBuffer = new PassThrough({
    objectMode: true, highWaterMark: hwm
  });
  this.channels[next] = {channel: channel, buffer: writeBuffer};
  writeBuffer.on('drain', function() {
    channel.onBufferDrain();
  });
  this.muxer.pipeFrom(writeBuffer);
  return next;
};

C.releaseChannel = function(channel) {
  this.freeChannels.clear(channel);
  var buffer = this.channels[channel].buffer;
  this.muxer.unpipeFrom(buffer);
  this.channels[channel] = null;
};

C.acceptLoop = function() {
  var self = this;

  function go() {
    try {
      var f; while (f = self.recvFrame()) self.accept(f);
    }
    catch (e) {
      self.emit('frameError', e);
    }
  }
  self.stream.on('readable', go);
  go();
};

C.step = function(cb) {
  var self = this;
  function recv() {
    try {
      var f = self.recvFrame();
      if (f) cb(null, f);
      else self.stream.once('readable', recv);
    }
    catch (e) {
      cb(e, null);
    }
  }
  recv();
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
  this.stream.write(bytes);
};

C.sendHeartbeat = function() {
  return this.sendBytes(frame.HEARTBEAT_BUF);
};

var encodeMethod = defs.encodeMethod;
var encodeProperties = defs.encodeProperties;

C.sendMethod = function(channel, Method, fields) {
  var frame = encodeMethod(Method, channel, fields);
  this.sentSinceLastCheck = true;
  var buffer = this.channels[channel].buffer;
  return buffer.write(frame);
};

C.sendMessage = function(channel,
                         Method, fields,
                         Properties, props,
                         content) {
  if (!Buffer.isBuffer(content))
    throw new TypeError('content is not a buffer');

  var mframe = encodeMethod(Method, channel, fields);
  var pframe = encodeProperties(Properties, channel,
                                content.length, props);
  var buffer = this.channels[channel].buffer;
  this.sentSinceLastCheck = true;

  var methodHeaderLen = mframe.length + pframe.length;
  var bodyLen = (content.length > 0) ?
    content.length + FRAME_OVERHEAD : 0;
  var allLen = methodHeaderLen + bodyLen;

  if (allLen < SINGLE_CHUNK_THRESHOLD) {
    var all = new Buffer(allLen);
    var offset = mframe.copy(all, 0);
    offset += pframe.copy(all, offset);
    
    if (bodyLen > 0)
      makeBodyFrame(channel, content).copy(all, offset);
    return buffer.write(all);
  }
  else {
    if (methodHeaderLen < SINGLE_CHUNK_THRESHOLD) {
      var both = new Buffer(methodHeaderLen);
      var offset = mframe.copy(both, 0);
      pframe.copy(both, offset);
      buffer.write(both);
    }
    else {
      buffer.write(mframe);
      buffer.write(pframe);
    }
    return this.sendContent(channel, content);
  }
};

var FRAME_OVERHEAD = defs.FRAME_OVERHEAD;
var makeBodyFrame = frame.makeBodyFrame;

C.sendContent = function(channel, body) {
  if (!Buffer.isBuffer(body)) {
    throw new TypeError(fmt("Expected buffer; got %s", body));
  }
  var writeResult = true;
  var buffer = this.channels[channel].buffer;

  var maxBody = this.frameMax - FRAME_OVERHEAD;

  for (var offset = 0; offset < body.length; offset += maxBody) {
    var end = offset + maxBody;
    var slice = (end > body.length) ? body.slice(offset) : body.slice(offset, end);
    var bodyFrame = makeBodyFrame(channel, slice);
    writeResult = buffer.write(bodyFrame);
  }
  this.sentSinceLastCheck = true;
  return writeResult;
};

var parseFrame = frame.parseFrame;
var decodeFrame = frame.decodeFrame;

C.recvFrame = function() {
  // %%% identifying invariants might help here?
  var frame = parseFrame(this.rest, this.frameMax);
 
  if (!frame) {
    var incoming = this.stream.read();
    if (incoming === null) {
      return false;
    }
    else {
      this.recvSinceLastCheck = true;
      this.rest = Buffer.concat([this.rest, incoming]);
      return this.recvFrame();
    }
  }
  else {
    this.rest = frame.rest;
    return decodeFrame(frame);
  }
};

function wrapStream(s) {
  if (s instanceof Duplex) return s;
  else {
    var ws = new Duplex();
    ws.wrap(s); //wraps the readable side of things
    ws._write = function(chunk, encoding, callback) {
      return s.write(chunk, encoding, callback);
    };
    return ws;
  }
}

module.exports.Connection = Connection;
