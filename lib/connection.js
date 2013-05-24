// 
// 
// Beating train rhythms

var defs = require('./defs');
var Frames = require('./frame');
var Heartbeat = Frames.Heartbeat;
var BitSet = require('./bitset').BitSet;
var defer = require('when').defer;
var inherits = require('util').inherits;

function Connection(underlying) {
  Frames.call(this, underlying);
  this.freeChannels = new BitSet();
  this.channels = [];
}
inherits(Connection, Frames);

var C = Connection.prototype;

// Usual frame accept mode
Connection.mainAccept = function(frame) {
  if (frame.channel === 0)  {
    return this.handle0(frame);
  }
  else {
    var handle = this.channels[frame.channel];
    if (handle) { return handle(frame); }
    else throw new Error("Frame on unknown channel " + frame);
  }
}

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

  function await() {
    var reply = defer();
    self.accept = function(frame) {
      if (frame.channel !== 0)
        reply.reject(new Error("Frame on channel != 0 during handshake"));
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
        throw new Error("Expected " + Method + " but got " + frame.id);
    });
  }

  function send(Method) {
    self.sendMethod(0, Method, allOptions);
  }
  
  var opened = expect(defs.ConnectionStart)
    .then(function(start) {
      send(defs.ConnectionStartOk);
      return await();
    })
    .then(function(reply) {
      switch (reply.id) {
      case defs.ConnectionSecure:
        throw new Error("Wasn't expecting to have to go through secure");
      case defs.ConnectionTune:
        send(defs.ConnectionTuneOk);
        send(defs.ConnectionOpen);
        return expect(defs.ConnectionOpenOk);
      default:
        throw new Error(
          "Expected secure or tune during handshake; got " +
            reply);
      }
    })
    .then(function(openOk) {
      self.accept = Connection.mainAccept;
      // %%% FIXME frameMax, channelMax
      self.channelMax = 0xffff;
      self.frameMax = 0xffffffff;
      self.run();
      return openOk;
    });

  return opened;
};

C.freshChannel = function(handler) {
  var next = this.freeChannels.nextClearBit(1);
  if (next < 0 || next > this.channelMax)
    throw new Error("No channels left to allocate");
  this.freeChannels.set(next);
  this.channels[next] = handler;
  return next;
};

C.releaseChannel = function(channel) {
  this.freeChannels.clear(channel);
  this.channels[channel] = null;
};

module.exports.Connection = Connection;
