// The river sweeps through
// Silt and twigs, gravel and leaves
// Driving the wheel on

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

var defs = require('./defs');
var constants = defs.constants;
var decode = defs.decode;
var encodeMethod = defs.encodeMethod;
var encodeProperties = defs.encodeProperties;

var FRAME_METHOD = constants.FRAME_METHOD,
FRAME_HEARTBEAT = constants.FRAME_HEARTBEAT,
FRAME_HEADER = constants.FRAME_HEADER,
FRAME_BODY = constants.FRAME_BODY,
FRAME_END = constants.FRAME_END;

var Bits = require('bitsyntax');
var Stream = require('stream');
var Duplex =
  require('stream').Duplex ||
  require('readable-stream/duplex');
var EventEmitter = require('events').EventEmitter;
var inherits = require('util').inherits;

var FRAME_OVERHEAD = 8;

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

/*
  Sending and receiving frames, given a duplex byte stream
*/
function Frames(stream) {
  EventEmitter.call(this);
  this.stream = wrapStream(stream);
  // %% not sure of the utility of forwarding this event
  this.stream.once('end',  this.emit.bind('end'));
  this.rest = new Buffer([]);
  this.frameMax = constants.FRAME_MIN_SIZE;
  this.sentSinceLastCheck = false;
  this.recvSinceLastCheck = false;
}
inherits(Frames, EventEmitter);

var F = Frames.prototype;

F.run = function() {
  var self = this;

  function go() {
    var f = self.recvFrame();
    while (f) {
      self.accept(f);
      f = self.recvFrame();
    }
  }
  this.stream.on('readable', go);
  go();
};

F.step = function() {
  var self = this;
  function recv() {
    var f = self.recvFrame();
    if (f) self.accept(f);
    else self.stream.once('readable', recv);
  }
  recv();
};

F.accept = function() {
  throw new Error("Intended to be provided by a subclass");
};

// Call to signal that no more work will be done on this frame, erm,
// stream.
F.end = function() {
  this.stream.end();
};

// low-level API

F.checkSend = function() {
  var check = this.sentSinceLastCheck;
  this.sentSinceLastCheck = false;
  return check;
}

F.checkRecv = function() {
  var check = this.recvSinceLastCheck;
  this.recvSinceLastCheck = false;
  return check;
}

F.sendBytes = function(bytes) {
  this.sentSinceLastCheck = true;
  this.stream.write(bytes);
};

var HEARTBEAT_BUF = new Buffer([constants.FRAME_HEARTBEAT,
                                0, 0, 0, 0, // size = 0
                                0, 0, // channel = 0
                                constants.FRAME_END]);

F.sendHeartbeat = function() {
  return this.sendBytes(HEARTBEAT_BUF);
};

F.sendMethod = function(channel, Method, fields) {
  var frame = encodeMethod(Method, channel, fields);
  this.sentSinceLastCheck = true;
  return this.stream.write(frame);
};

F.sendContent = function(channel, Properties, fields, body) {
  var writeResult = true;
  var headerFrame = encodeProperties(
    Properties, channel, body.length, fields);
  // I'll send the headers regardless
  writeResult = this.stream.write(headerFrame);

  var maxBody = this.frameMax - FRAME_OVERHEAD;
  for (var offset = 0; offset < body.length; offset += maxBody) {
    var end = offset + maxBody;
    var slice = (end > body.length) ? body.slice(offset) : body.slice(offset, end);
    var bodyFrame = makeBodyFrame(channel, slice);
    writeResult = this.stream.write(bodyFrame);
  }
  this.sentSinceLastCheck = true;
  return writeResult;
};

var bodyCons =
  Bits.constructor(FRAME_BODY,
                   'channel:16, size:32, payload/binary',
                   FRAME_END);
// %%% TESTME possibly better to cons the first bit and write the
// second directly, in the absence of IO lists
function makeBodyFrame(channel, payload) {
  return bodyCons({channel: channel, size: payload.length, payload: payload});
}

var framePattern = Bits.compile('type:8, channel:16',
                                'size:32, payload:size/binary',
                                FRAME_END, 'rest/binary');
var methodPattern = Bits.compile('id:32, args/binary');

F.recvFrame = function() {
  // %%% identifying invariants might help here?
  var frame = framePattern(this.rest);
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

var HEARTBEAT = {channel: 0}; // channel to make sure it gets
                              // dispatched properly

var headerPattern = Bits.compile('class:16',
                                 '_weight:16',
                                 'size:64',
                                 'flagsAndfields/binary');

function decodeFrame(frame) {
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

module.exports = Frames;
module.exports.HEARTBEAT = HEARTBEAT;
