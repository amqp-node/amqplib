const { constants: bufferConstants } = require('node:buffer');
const defs = require('./defs');
const constants = defs.constants;
const decode = defs.decode;

module.exports.PROTOCOL_HEADER = `AMQP${String.fromCharCode(0, 0, 9, 1)}`;

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
const FRAME_METHOD = constants.FRAME_METHOD;
const FRAME_HEARTBEAT = constants.FRAME_HEARTBEAT;
const FRAME_HEADER = constants.FRAME_HEADER;
const FRAME_BODY = constants.FRAME_BODY;
const FRAME_END = constants.FRAME_END;

// expected byte sizes for frame parts
const TYPE_BYTES = 1;
const CHANNEL_BYTES = 2;
const SIZE_BYTES = 4;
const FRAME_HEADER_BYTES = TYPE_BYTES + CHANNEL_BYTES + SIZE_BYTES;
const FRAME_END_BYTES = 1;

const LARGEST_BUFFER_BYTES = bufferConstants.MAX_LENGTH;
const NO_BYTES = Buffer.alloc(0);

/**
 * @typedef {{
 *   type: number,
 *   channel: number,
 *   size: number,
 *   payload: Buffer,
 *   rest: Buffer
 * }} FrameStructure
 */

function readInt64BE(buffer, offset) {
  return Number(buffer.readBigInt64BE(offset));
}

// %%% TESTME possibly better to cons the first bit and write the
// second directly, in the absence of IO lists
/**
 * Make a frame header
 * @arg { number } channel
 * @arg { Buffer } payload
 */
module.exports.makeBodyFrame = (channel, payload) => {
  const frameSize = FRAME_HEADER_BYTES + payload.length + FRAME_END_BYTES;

  const frame = Buffer.alloc(frameSize);

  let offset = 0;

  offset = frame.writeUInt8(FRAME_BODY, offset);
  offset = frame.writeUInt16BE(channel, offset);
  offset = frame.writeInt32BE(payload.length, offset);

  payload.copy(frame, offset);
  offset += payload.length;

  frame.writeUInt8(FRAME_END, offset);

  return frame;
};

/**
 * Parse an AMQP frame
 * @arg { Buffer } bin
 * @arg { number } max
 * @returns { FrameStructure | boolean }
 */
function parseFrame(bin, max) {
  if (bin.length < FRAME_HEADER_BYTES) {
    return false;
  }

  const type = bin.readUInt8(0);
  const channel = bin.readUInt16BE(1);
  const size = bin.readUInt32BE(3);

  if (max > 0 && size > max) {
    throw new Error(`Frame size ${size} exceeds maxFrameSize ${max}`);
  }

  const totalSize = FRAME_HEADER_BYTES + size + FRAME_END_BYTES;

  if (bin.length < totalSize) {
    return false;
  }

  const frameEnd = bin.readUInt8(FRAME_HEADER_BYTES + size);

  if (frameEnd !== FRAME_END) {
    throw new Error('Invalid frame');
  }

  return {
    type,
    channel,
    size,
    payload: bin.subarray(FRAME_HEADER_BYTES, FRAME_HEADER_BYTES + size),
    rest: bin.subarray(totalSize),
  };
}

module.exports.parseFrame = parseFrame;

// The bytes received but not yet parsed are copied into storage that doubles in size when it
// runs out of room, so each byte is copied fewer than three times on average however many
// reads a frame takes to arrive, and the storage is never more than about twice what has
// arrived.
//
// The alternative is to allocate what the frame header declares as soon as the header arrives,
// and copy each byte once. That was not chosen for two reasons. A header is 7 bytes, and it
// would make the client reserve up to maxFrameSize, or 4 GiB when there is no limit, before
// any of the frame had been received. And on Node 18 and 20 a buffer cannot exceed 4 GiB, which
// the largest frame does once its header and end byte are counted.
//
// The same 4 GiB limit is why storageBytesFor takes largestBufferBytes. Doubling would ask for
// more than a buffer can hold once about 2 GiB had arrived, so the size is held at the limit.
//
// When Node 22 is the minimum supported version, a buffer can be larger than any frame, so
// storageBytesFor no longer needs largestBufferBytes and can return twice unparsedBytes. The
// second reason above also goes away, but the first does not.
class UnparsedBytes {
  constructor() {
    this.bytes = NO_BYTES;
    this.storage = NO_BYTES;
    this.storageUsed = 0;
  }

  append(incoming) {
    const unparsedBytes = this.bytes.length + incoming.length;
    const room = this.storage.length - this.storageUsed;

    if (incoming.length > room) this.#moveToLargerStorage(unparsedBytes);

    incoming.copy(this.storage, this.storageUsed);
    this.storageUsed += incoming.length;
    this.bytes = this.storage.subarray(this.storageUsed - unparsedBytes, this.storageUsed);
  }

  keepOnly(rest) {
    this.bytes = rest;

    if (rest.length === 0) this.#releaseStorage();
  }

  #moveToLargerStorage(unparsedBytes) {
    const storage = Buffer.allocUnsafe(storageBytesFor(unparsedBytes, LARGEST_BUFFER_BYTES));

    this.bytes.copy(storage);
    this.storage = storage;
    this.storageUsed = this.bytes.length;
  }

  #releaseStorage() {
    this.storage = NO_BYTES;
    this.storageUsed = 0;
  }
}

function storageBytesFor(unparsedBytes, largestBufferBytes) {
  const doubled = 2 * unparsedBytes;

  return Math.max(unparsedBytes, Math.min(doubled, largestBufferBytes));
}

module.exports.UnparsedBytes = UnparsedBytes;
module.exports.storageBytesFor = storageBytesFor;

const HEARTBEAT = { channel: 0 };

/**
 * Decode AMQP frame into JS object
 * @param { FrameStructure } frame
 * @returns
 */
module.exports.decodeFrame = (frame) => {
  const payload = frame.payload;
  const channel = frame.channel;

  switch (frame.type) {
    case FRAME_METHOD: {
      const id = payload.readUInt32BE(0);
      const args = payload.subarray(4);
      const fields = decode(id, args);
      return { id, channel, fields };
    }
    case FRAME_HEADER: {
      const id = payload.readUInt16BE(0);
      // const weight = payload.readUInt16BE(2)
      const size = readInt64BE(payload, 4);
      const flagsAndfields = payload.subarray(12);
      const fields = decode(id, flagsAndfields);
      return { id, channel, size, fields };
    }
    case FRAME_BODY:
      return { channel, content: payload };
    case FRAME_HEARTBEAT:
      return HEARTBEAT;
    default:
      throw new Error(`Unknown frame type ${frame.type}`);
  }
};

// encoded heartbeat
module.exports.HEARTBEAT_BUF = Buffer.from([
  constants.FRAME_HEARTBEAT,
  0,
  0,
  0,
  0, // size = 0
  0,
  0, // channel = 0
  constants.FRAME_END,
]);

module.exports.HEARTBEAT = HEARTBEAT;
