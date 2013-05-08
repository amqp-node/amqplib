// 
// 
// Beating train rhythms

var defs = require('./defs');
var Frames = require('./frame');
var Heartbeat = Frames.Heartbeat;
var BitSet = require('./bitset').BitSet;
var defer = require('when').defer;

function Connection(duplex) {
  var self = this;
  this.stream = duplex;
  this.frames = new Frames(duplex);
  this.freeChannels = new BitSet();
  this.channels = [];
}

var C = Connection.prototype;

C.sendMethod = function(channel, method, fields) {
  this.frames.sendMethod(channel, method, fields);
};

C.sendContent = function(channel, properties, fields, content) {
  return this.frames.sendContent(channel, properties, fields, content);
};

C.run = function() {
  var self = this;
  var f = this.frames.recvFrame();
  while (f) {
    this.accept(f);
    f = this.frames.recvFrame();
  }
};

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

*/
C.open = function(allOptions) {
  this.frames.sendProtocolHeader();
  var self = this;

  this.stream.on('readable', function() { self.run(); });

  function recv() {
    var reply = defer();
    self.accept = function(frame) {
      if (frame.channel !== 0)
        reply.reject(new Error("Frame on channel != 0 during handshake"));
      else
        reply.resolve(frame);
    };
    return reply.promise;
  }

  function expect(Method) {
    return recv().then(function(frame) {
      if (frame.id === Method)
        return frame;
      else
        throw new Error("Expected " + Method + " but got " + frame.id);
    });
  }

  function send(method, fields) {
    self.sendMethod(0, method, fields);
  }
  
  var opened = expect(defs.ConnectionStart)
    .then(function(start) {
      send(defs.ConnectionStartOk, allOptions);
      return recv();
    })
    .then(function(reply) {
      switch (reply.id) {
      case defs.ConnectionSecure:
        throw new Error("Wasn't expecting to have to go through secure");
      case defs.ConnectionTune:
        send(defs.ConnectionTuneOk, allOptions);
        send(defs.ConnectionOpen, allOptions);
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
      return openOk;
    });

  this.stream.resume();
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
