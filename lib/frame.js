// The river sweeps through
// Silt and twigs, gravel and leaves
// Driving the wheel on

'use strict';

var defs = require('./defs');
var constants = defs.constants;
var decode = defs.decode;

var Bits = require('bitsyntax');

module.exports.PROTOCOL_HEADER = "AMQP" + String.fromCharCode(0, 0, 9, 1);

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

// framing constants
var FRAME_METHOD = constants.FRAME_METHOD,
FRAME_HEARTBEAT = constants.FRAME_HEARTBEAT,
FRAME_HEADER = constants.FRAME_HEADER,
FRAME_BODY = constants.FRAME_BODY,
FRAME_END = constants.FRAME_END;


////////////////////////////////////////////////////////////////////////////////
// TODO: For some reason browserify wasn't able to find Buffer without defining
// these functions in this scope. Obviously, this is no bueno.
var ints = require('buffer-more-ints');
function write_int(buf, value, offset, size, bigendian) {
  switch (size) {
  case 1:
    buf.writeUInt8(value, offset);
    break;
  case 2:
    (bigendian) ?
      buf.writeUInt16BE(value, offset) :
      buf.writeUInt16LE(value, offset);
    break;
  case 4:
    (bigendian) ?
      buf.writeUInt32BE(value, offset) :
      buf.writeUInt32LE(value, offset);
    break;
  case 8:
    (bigendian) ?
      ints.writeUInt64BE(buf, value, offset) :
      ints.writeUInt64LE(buf, value, offset);
    break;
  default:
    throw new Error("integer size * unit must be 8, 16, 32 or 64");
  }
  return size;
}

function bodyConsFIXME(bindings) {
  var buffersize = 8;
  buffersize += (bindings['size'] * 8) / 8;
  var buf = new Buffer(buffersize);
  var offset = 0;
  var val, size;
  // {"value":3,"type":"integer","bigendian":true,"unit":1,"size":8}
  val = 3
  size = 1;
  write_int(buf, val, offset, size, true);
  offset += size;
  // {"name":"channel","type":"integer","bigendian":true,"unit":1,"size":16}
  val = bindings['channel'];
  size = 2;
  write_int(buf, val, offset, size, true);
  offset += size;
  // {"name":"size","type":"integer","bigendian":true,"unit":1,"size":32}
  val = bindings['size'];
  size = 4;
  write_int(buf, val, offset, size, true);
  offset += size;
  // {"name":"payload","type":"binary","unit":8,"size":"size"}
  val = bindings['payload'];
  size = (bindings['size'] * 8) / 8;
  val.copy(buf, offset, 0, size);
  offset += size;
  // {"value":206,"type":"integer","bigendian":true,"unit":1,"size":8}
  val = 206
  size = 1;
  write_int(buf, val, offset, size, true);
  offset += size;
  return buf;
}
////////////////////////////////////////////////////////////////////////////////


// var bodyCons = Bits.builder(FRAME_BODY,
//   'channel:16, size:32, payload:size/binary', FRAME_END);


// %%% TESTME possibly better to cons the first bit and write the
// second directly, in the absence of IO lists
module.exports.makeBodyFrame = function(channel, payload) {
  return bodyConsFIXME({  // FIXME: Hacked the OG bodyCons - see above
    channel: channel,
    size: payload.length,
    payload: payload
  });
};

var frameHeaderPattern = Bits.matcher('type:8', 'channel:16',
                                      'size:32', 'rest/binary');

function parseFrame(bin, max) {
  var fh = frameHeaderPattern(bin);
  if (fh) {
    var size = fh.size, rest = fh.rest;
    if (size > max) {
      throw new Error('Frame size exceeds frame max');
    }
    else if (rest.length > size) {
      if (rest[size] !== FRAME_END)
        throw new Error('Invalid frame');

      return {
        type: fh.type,
        channel: fh.channel,
        size: size,
        payload: rest.slice(0, size),
        rest: rest.slice(size + 1)
      };
    }
  }
  return false;
}

module.exports.parseFrame = parseFrame;

var headerPattern = Bits.matcher('class:16',
                                 '_weight:16',
                                 'size:64',
                                 'flagsAndfields/binary');

var methodPattern = Bits.matcher('id:32, args/binary');

var HEARTBEAT = {channel: 0};

module.exports.decodeFrame = function(frame) {
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

// encoded heartbeat
module.exports.HEARTBEAT_BUF = new Buffer([constants.FRAME_HEARTBEAT,
                                           0, 0, 0, 0, // size = 0
                                           0, 0, // channel = 0
                                           constants.FRAME_END]);

module.exports.HEARTBEAT = HEARTBEAT;
