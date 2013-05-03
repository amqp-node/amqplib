// 
// 
// Beating train rhythms

var defs = require('./defs');
var Frames = require('./frame');
var Heartbeat = Frames.Heartbeat;
var defer = require('when').defer;

function Connection(duplex) {
  var self = this;

  this.stream = duplex;
  this.frames = new Frames(duplex);

  // %%% TODO parameters e.g., frame max.
}

var C = Connection.prototype;

/*

There's three modes of interaction over a connection. The first is
simply to receive frames -- e.g., deliveries. The second is to send a
method, then at some later point, receive its reply. The AMQP spec
implies that RPCs can't be pipelined; that is, you can only have one
outstanding RPC per channel at a time. Certainly that's what RabbitMQ
and its clients assume. In these two modes, the way to dispatch
methods is

  1. If it's a reply method, look for the request in channel['rpc']
  and hand it the method 2. Otherwise, emit the method

The third mode is during the opening handshake, when there is a
specific sequence of methods involved. For this we replace the general
dispatch with a state machine.

*/

C.sendMethod = function(channel, method) {
  this.frames.sendMethod(channel, method);
};

C.run = function() {
  var self = this;
  var f = this.frames.recvFrame();
  while (f) {
    this.accept(f);
    console.log({frame: f});
    f = this.frames.recvFrame();
  }
};

// Usual frame accept mode
Connection.mainAccept = function(frame) {
  console.log(frame);
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
      if (frame instanceof Method)
        return frame;
      else
        throw new Error("Expected " + Method + " but got " + f);
    });
  }

  function send(frame) {
    self.sendMethod(0, frame);
  }
  
  var opened = expect(defs.ConnectionStart)
    .then(function(start) {
      send(new defs.ConnectionStartOk(allOptions));
      return recv();
    })
    .then(function(secureOrTune) {
      if (secureOrTune instanceof defs.ConnectionSecure) {
        throw new Error("Wasn't expecting to have to go through secure");
      }
      else if (secureOrTune instanceof defs.ConnectionTune) {
        send(new defs.ConnectionTuneOk(allOptions));
        send(new defs.ConnectionOpen(allOptions));
        return expect(defs.ConnectionOpenOk);
      }
      else {
        throw new Error(
          "Expected secure or tune during handshake; got " +
            secureOrTune);
      }
    })
    .then(function(openOk) {
      self.accept = Connection.mainAccept;
      return openOk;
    });

  this.stream.resume();
  return opened;
};

module.exports.Connection = Connection;
