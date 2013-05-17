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
var decoderFor = defs.decoder;
var encoderFor = defs.encoder;
var propertiesFor = defs.propertiesFor;

var FRAME_METHOD = constants.FRAME_METHOD,
    FRAME_HEARTBEAT = constants.FRAME_HEARTBEAT,
    FRAME_HEADER = constants.FRAME_HEADER,
    FRAME_BODY = constants.FRAME_BODY,
    FRAME_END = constants.FRAME_END;

var Bits = require('bitsyntax');
var Stream = require('stream');
var Duplex = require('stream').Duplex || require('readable-stream/duplex');

var FRAME_OVERHEAD = 8;

function wrapStream(s) {
    if (s instanceof Duplex) return s;
    else {
        var ws = new Duplex();
        ws.wrap(s);
        return ws;
    }     
}

/*
Sending and receiving frames, given a duplex byte stream
*/
function Frames(stream) {
    this.stream = wrapStream(stream);
    this.rest = new Buffer([]);
    this.frameMax = constants.FRAME_MIN_SIZE;
}

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
  this.stream.resume();
};

F.accept = function() {
  throw new Error("Intended to be provided by a subclass");
};

// low-level API

F.sendBytes = function(bytes) {
  this.stream.write(bytes);
};

F.sendMethod = function(channel, method, fields) {
    var frame = encoderFor(method)(channel, fields);
    return this.stream.write(frame);
};

F.sendContent = function(channel, properties, fields, body) {
    var writeResult = true;
    var headerFrame = encoderFor(properties)(channel, body.length, fields);
    // I'll send the headers regardless
    writeResult = this.stream.write(headerFrame);

    var maxBody = this.frameMax - FRAME_OVERHEAD;
    for (var offset = 0; offset < body.length; offset += maxBody) {
        var end = offset + maxBody;
        var slice = (end > body.length) ? body.slice(offset) : body.slice(offset, end);
        var bodyFrame = makeBodyFrame(channel, slice);
        writeResult = this.stream.write(bodyFrame);
    }
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
            this.rest = Buffer.concat([this.rest, incoming]);
            return this.recvFrame();
        }
    }
    else {
        this.rest = frame.rest;
        return decodeFrame(frame);
    }
};

function Heartbeat() {}
var heartbeat = new Heartbeat();

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
        var decoder = decoderFor(idAndArgs.id);
        var fields = decoder(idAndArgs.args);
        return {id: id, channel: frame.channel, fields: fields};
    case FRAME_HEADER:
        var parts = headerPattern(payload);
        var id = parts['class'];
        var decode = decoderFor(id);
        var fields = decode(parts.flagsAndfields);
        return {id: id, channel: frame.channel,
                size: parts.size, fields: fields};
    case FRAME_BODY:        
        return {channel: frame.channel, content: frame.payload};
    case FRAME_HEARTBEAT:
        return heartbeat;
    default:
        throw new Error('Unknown frame type ' + frame.type);
    }
}

module.exports = Frames;
module.exports.Heartbeat = Heartbeat;
