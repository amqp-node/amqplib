// 
// 
// Beating train rhythms

var defs = require('./defs');
var Frames = require('./frame');
var HEARTBEAT = Frames.HEARTBEAT;
var inspect = require('./format').inspect;
var methodName = require('./format').methodName;
var closeMsg = require('./format').closeMessage;
var BitSet = require('./bitset').BitSet;
var defer = require('when').defer;
var inherits = require('util').inherits;
var fmt = require('util').format;

function Connection(underlying) {
  Frames.call(this, underlying);
  // `'close'` isn't emitted by all streams, but `'end'` should be; we
  // want to know if the stream closes without a closing handshake
  underlying.once(
    'end', this.onSocketError.bind(this, new Error('Unexpected close')));
  // or with an error
  underlying.once('error', this.onSocketError.bind(this));
  this.expectSocketClose = false;
  this.freeChannels = new BitSet();
  this.channels = [{accept: channel0(this)}];
}
inherits(Connection, Frames);

var C = Connection.prototype;

// Usual frame accept mode
function mainAccept(frame) {
  var channel = this.channels[frame.channel];
  if (channel) { return channel.accept(frame); }
  // NB CHANNEL_ERROR may not be right, but I don't know what is ..
  else this.closeBecause(fmt("Frame on unknown channel: %s",
                             inspect(frame, false)),
                         defs.constants.CHANNEL_ERROR);
};

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
      connection.stop();
      connection.sendMethod(0, defs.ConnectionCloseOk, {});
      var err = new Error(fmt('Connection closed: %s', closeMsg(f)));
      connection.toClosed(err);
    }
    else {
      connection.closeBecause(fmt("Unexpected frame on channel 0: %s",
                                  inspect(f, false)),
                              defs.constants.UNEXPECTED_FRAME);
    }
  };
};


// This changed between versions, as did the codec, methods, etc. AMQP
// 0-9-1 is fairly similar to 0.8, but better, and nothing implements
// 0.8 that doesn't implement 0-9-1. In other words, it doesn't make
// much sense to generalise here.
C.sendProtocolHeader = function() {
  this.sendBytes("AMQP" + String.fromCharCode(0, 0, 9, 1));
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
  this.sendProtocolHeader();
  var self = this;

  // This is where we'll put our negotiated values
  var tunedOptions = Object.create(allOptions);

  function await() {
    var reply = defer();
    self.accept = function(frame) {
      if (frame.channel !== 0)
        reply.reject(
          new Error(fmt("Frame on channel != 0 during handshake: %s",
                        inspect(frame, false))));
      else
        reply.resolve(frame);
    };
    self.step();
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
    return Math.min(server, client);
  }

  var opened = expect(defs.ConnectionStart)
    .then(function(start) {
      send(defs.ConnectionStartOk);
      return await();
    })
    .then(function(reply) {
      switch (reply.id) {
      case defs.ConnectionSecure:
        throw new Error(
          "Wasn't expecting to have to go through secure");
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
          fmt("Expected secure or tune during handshake; got %s",
              inspect(reply, false)));
      }
    })
    .then(function(openOk) {
      self.accept = mainAccept;
      self.channelMax = tunedOptions.channelMax || 0xffff;
      self.frameMax = tunedOptions.frameMax || 0xffffffff;
      self.heartbeat = tunedOptions.heartbeat;
      self.run();
      return openOk;
    });

  return opened;
};

// Closing things: AMQP has a closing handshake that applies to
// closing both connects and channels. As the initiating party, I send
// 'close', then ignore all frames until I see either 'close-ok' --
// which signifies that the other party has seen the 'close' and shut
// the connection or channel down, so it's fine to free resources; or
// 'close', which means the other party also wanted to close the
// whatever, and I should send 'close-ok' so it can free resources,
// then go back to waiting for the 'close-ok'. If I receive a 'close'
// out of the blue, I should throw away any unsent frames (they will
// be ignored anyway) and send 'close-ok', then clean up resources. In
// general, 'close' out of the blue signals an error (or a forced
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
// [3] Simutaneous close: signal 'end'.
// [4] Server won't send any more frames; accept no more frames, send
// CloseOk. Signal 'end'.
// [5] Fully closed, client will send no more, server will send no
// more. Signal 'close' or 'error'.
//
// There are two signalling mechanisms used in the API. The first is
// that calling `close` or `closeBecause` will return a promise, that
// will either resolve once the connection or channel is cleanly shut
// down, or will reject if the shutdown times out.
//
// The second is the 'end', 'close' and 'error' events. These are
// emitted as above. The events will fire *before* promises are
// resolved.

// Close the connection without even giving a reason. Typical.
C.close = function() {
  return this.closeBecause("Cheers", defs.constants.REPLY_SUCCESS);
};

// Close with a reason and a 'code'. I'm pretty sure RabbitMQ totally
// ignores these; maybe it logs them. Returns a promise that will be
// resolved when the CloseOk has been received; NB the 'close' event
// will be emitted once the underlying stream is ended.
C.closeBecause = function(reason, code) {
  this.sendMethod(0, defs.ConnectionClose, {
    replyText: reason,
    replyCode: code,
    methodId: 0, classId: 0
  });

  var err;
  if (code !== defs.constants.REPLY_SUCCESS)
    err = new Error(reason);

  var self = this;
  var done = defer();
  this.accept = function(f) {
    if (f.id === defs.ConnectionCloseOk) {
      done.resolve();
      self.toClosed(err);
    }
    else if (f.id === defs.ConnectionClose) {
      self.sendMethod(0, defs.ConnectionCloseOk, {});
    }
    else;
  };
  this.stop();
  return done.promise;
};

// A close has been initiated. Repeat: a close has been initiated.
// This means we should not send more frames, anyway they will be
// ignored. We also have to shut down all the channels.
C.stop = function() {
  for (var i = 1; i < this.channels.length; i++) {
    var ch = this.channels[i];
    if (ch) {
      ch.stop();
      ch.toClosed(); // %%% or with an error? not clear
    }
  }
};

function closedSend() {
  throw new Error("Connection closed");
}
function closedAccept(f) {
  throw new Error(fmt("Unexpected frame on closed connection: %s",
                      inspect(f, false)));
}

C.onSocketError = function(err) {
  if (!this.expectSocketClose) {
    // forestall any more calls to onSocketError, since we're signed
    // up for `'error'` *and* `'end'`
    this.expectSocketClose = true;
    this.stop();
    this.toClosed(err);
  }
};

// A close has been confirmed. Cease all communication.
C.toClosed = function(err) {
  // Tidy up, invalidate enverything, dynamite the bridges.
  this.sendMethod = this.sendContent = closedSend;
  this.accept = closedAccept;
  // This is certainly true now, if it wasn't before
  this.expectSocketClose = true;
  this.end();
  if (err) this.emit('error', err);
  this.emit('close');
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
C.freshChannel = function(channel) {
  var next = this.freeChannels.nextClearBit(1);
  if (next < 0 || next > this.channelMax)
    throw new Error("No channels left to allocate");
  this.freeChannels.set(next);
  this.channels[next] = channel;
  return next;
};

C.releaseChannel = function(channel) {
  this.freeChannels.clear(channel);
  this.channels[channel] = null;
};

module.exports.Connection = Connection;
