// The river sweeps through
// Silt and twigs, gravel and leaves
// Driving the wheel on

'use strict';

var defs = require('./defs');
var constants = defs.constants;
var decode = defs.decode;

var Bits = require('@acuminous/bitsyntax');

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

// %%% TESTME possibly better to cons the first bit and write the
// second directly, in the absence of IO lists
module.exports.makeBodyFrame = function (channel, payload) {
  // 1 byte for type, 2 bytes for channel, 4 bytes for size, payload size and 1 for frame-end
  const frameSize = 8 + payload.length

  const frame = Buffer.alloc(frameSize)

  let offset = 0

  offset = frame.writeUInt8(FRAME_BODY, offset)
  offset = frame.writeUInt16BE(channel, offset)
  offset = frame.writeInt32BE(payload.length, offset)

  payload.copy(frame, offset)
  offset += payload.length

  frame.writeUInt8(FRAME_END, offset)

  return frame
};

var frameHeaderPattern = Bits.matcher('type:8', 'channel:16',
                                      'size:32', 'rest/binary');

function parseFrame(bin) {
  var fh = frameHeaderPattern(bin);
  if (fh) {
    var size = fh.size, rest = fh.rest;
    if (rest.length > size) {
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
module.exports.HEARTBEAT_BUF = Buffer.from([constants.FRAME_HEARTBEAT,
                                           0, 0, 0, 0, // size = 0
                                           0, 0, // channel = 0
                                           constants.FRAME_END]);

module.exports.HEARTBEAT = HEARTBEAT;
