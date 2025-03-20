// The river sweeps through
// Silt and twigs, gravel and leaves
// Driving the wheel on

'use strict';

const ints = require('buffer-more-ints')
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

// expected byte sizes for frame parts
const TYPE_BYTES = 1
const CHANNEL_BYTES = 2
const SIZE_BYTES = 4
const FRAME_HEADER_BYTES = TYPE_BYTES + CHANNEL_BYTES + SIZE_BYTES
const FRAME_END_BYTES = 1

/**
 * @typedef {{
 *   type: number,
 *   channel: number,
 *   size: number,
 *   payload: Buffer,
 *   rest: Buffer
 * }} FrameStructure
 */

/**
 * This is a polyfill which will read a big int 64 bit as a number.
 * @arg { Buffer } buffer
 * @arg { number } offset
 * @returns { number }
 */
function readInt64BE(buffer, offset) {
  /**
   * We try to use native implementation if available here because
   * buffer-more-ints does not
   */
  if (typeof Buffer.prototype.readBigInt64BE === 'function') {
    return Number(buffer.readBigInt64BE(offset))
  }

  return ints.readInt64BE(buffer, offset)
}

// %%% TESTME possibly better to cons the first bit and write the
// second directly, in the absence of IO lists
/**
 * Make a frame header
 * @arg { number } channel
 * @arg { Buffer } payload
 */
module.exports.makeBodyFrame = function (channel, payload) {
  const frameSize = FRAME_HEADER_BYTES + payload.length + FRAME_END_BYTES

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
 * @arg { Buffer } bin
 * @arg { number } max
 * @returns { FrameStructure | boolean }
 */
function parseFrame(bin) {
  if (bin.length < FRAME_HEADER_BYTES) {
    return false
  }

  const type = bin.readUInt8(0)
  const channel = bin.readUInt16BE(1)
  const size = bin.readUInt32BE(3)

  const totalSize = FRAME_HEADER_BYTES + size + FRAME_END_BYTES

  if (bin.length < totalSize) {
    return false
  }

  const frameEnd = bin.readUInt8(FRAME_HEADER_BYTES + size)

  if (frameEnd !== FRAME_END) {
    throw new Error('Invalid frame')
  }

  return {
    type,
    channel,
    size,
    payload: bin.subarray(FRAME_HEADER_BYTES, FRAME_HEADER_BYTES + size),
    rest: bin.subarray(totalSize)
  }
}

module.exports.parseFrame = parseFrame;

var HEARTBEAT = {channel: 0};

/**
 * Decode AMQP frame into JS object
 * @param { FrameStructure } frame
 * @returns
 */
module.exports.decodeFrame = (frame) => {
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
      const size = readInt64BE(payload, 4)
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