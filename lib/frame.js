// The river sweeps through
// Silt and twigs, gravel and leaves
// Driving the wheel on

'use strict';

var defs = require('./defs');
var constants = defs.constants;
var decode = defs.decode;

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

/**
 * Parse an AMQP frame
 * @arg {Buffer} bin
 */
function parseFrame(bin, max) {
  if (bin.length < 7) return false

  const type = bin.readUInt8(0)
  const channel = bin.readUInt16BE(1)
  const size = bin.readUInt32BE(3)

  if (size > max) {
    throw new Error('Frame size exceeds frame max');
  }

  // The total size of the frame is the size of the payload + the header + the frame-end
  const totalSize = size + 8

  if (bin.length < totalSize) {
    return false
  }

  const frameEnd = bin.readUInt8(7 + size)

  if (frameEnd !== FRAME_END) {
    throw new Error('Invalid frame')
  }

  return {
    type,
    channel,
    size,
    payload: bin.subarray(7, 7 + size),
    rest: bin.subarray(totalSize)
  }
}

module.exports.parseFrame = parseFrame;

var HEARTBEAT = {channel: 0};

module.exports.decodeFrame = (frame) => {
  /** @type { Buffer } */
  const payload = frame.payload
  const channel = frame.channel

  switch (frame.type) {
    case FRAME_METHOD: {
      const id = payload.readUInt32BE(0)
      const args = payload.subarray(4)
      const fields = decode(id, args)
      return { id, channel, fields }
    }
    case FRAME_HEADER: {
      const id = payload.readUInt16BE(0)
      // const weight = payload.readUInt16BE(2)
      const size = Number(payload.readBigInt64BE(4))
      const flagsAndfields = payload.subarray(12)
      const fields = decode(id, flagsAndfields)
      return { id, channel, size, fields }
    }
    case FRAME_BODY:
      return { channel, content: payload }
    case FRAME_HEARTBEAT:
      return HEARTBEAT
    default:
      throw new Error('Unknown frame type ' + frame.type)
  }
}

// encoded heartbeat
module.exports.HEARTBEAT_BUF = Buffer.from([constants.FRAME_HEARTBEAT,
                                           0, 0, 0, 0, // size = 0
                                           0, 0, // channel = 0
                                           constants.FRAME_END]);

module.exports.HEARTBEAT = HEARTBEAT;
