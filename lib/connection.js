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

C.sendMethod = function(channel, method, fields) {
  this.frames.sendMethod(channel, method, fields);
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
      return openOk;
    });

  this.stream.resume();
  return opened;
};

module.exports.Connection = Connection;
