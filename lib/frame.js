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

/**
 * @typedef {{
 *   type: number,
 *   channel: number,
 *   size: number,
 *   payload: Buffer | Buffer[]
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

const EMPTY = Buffer.alloc(0);

/**
 * The bytes as they arrive from the socket, and the frames taken out of them.
 *
 * A frame that arrived whole in one piece is taken as a view of that piece. One that spans pieces
 * is filled as they come: its bytes are copied once, into a buffer of its own size, and no piece
 * is held past the read it arrived in — the socket reads into a buffer it can reuse only while
 * nothing refers to the last one.
 *
 * Accumulating the pieces instead — concatenating each onto what is left over — copies every byte
 * that arrives at least once more, and a body frame larger than a read is copied again for every
 * further read it takes to complete it.
 */
class Frames {
  constructor() {
    this.chunk = EMPTY;
    this.offset = 0;

    // the beginning of a header whose rest has not arrived, a frame being filled, and a body
    // being gathered out of the pieces it spans
    this.head = EMPTY;
    this.frame = null;
    this.filled = 0;
    this.body = null;
  }

  /** Takes in what was read from the socket; whatever was read before it has been taken out. */
  push(chunk) {
    this.chunk = chunk;
    this.offset = 0;
  }

  /** The next frame, or `false` while the bytes of one have not all arrived. */
  take() {
    if (this.body !== null) return this.#gather();
    if (this.frame !== null) return this.#fill();
    if (this.head.length !== 0) return this.#header();

    const chunk = this.chunk;
    const offset = this.offset;
    const available = chunk.length - offset;

    if (available === 0) return false;

    if (available < FRAME_HEADER_BYTES) {
      this.head = Buffer.from(chunk.subarray(offset));

      return this.#exhausted();
    }

    const size = chunk.readUInt32BE(offset + TYPE_BYTES + CHANNEL_BYTES);
    const totalSize = FRAME_HEADER_BYTES + size + FRAME_END_BYTES;

    if (available >= totalSize) {
      this.offset = offset + totalSize;

      return frameOf(chunk, offset, size);
    }

    // A body is made whole once, by whoever puts the message together, and out of the pieces it
    // arrived in: copying it here would copy it twice, and a buffer the size of a frame allocated
    // for every message is a buffer the allocator hands back to the system as often.
    if (chunk.readUInt8(offset) === FRAME_BODY) {
      this.body = { channel: chunk.readUInt16BE(offset + TYPE_BYTES), size, pieces: [], gathered: 0 };
      this.offset = offset + FRAME_HEADER_BYTES;

      return this.#gather();
    }

    this.frame = Buffer.allocUnsafe(totalSize);
    this.filled = 0;

    return this.#fill();
  }

  /** Takes what the piece holds of the body being gathered, and the body once it is whole. */
  #gather() {
    const chunk = this.chunk;
    const body = this.body;
    const taken = Math.min(chunk.length - this.offset, body.size - body.gathered);

    if (taken > 0) {
      body.pieces.push(chunk.subarray(this.offset, this.offset + taken));
      body.gathered += taken;
      this.offset += taken;
    }

    // the end of the frame is a byte of its own, and may be the one piece that has not arrived
    if (body.gathered < body.size || this.offset === chunk.length) return this.#exhausted();

    if (chunk.readUInt8(this.offset) !== FRAME_END) throw new Error('Invalid frame');

    this.offset += FRAME_END_BYTES;
    this.body = null;

    return { type: FRAME_BODY, channel: body.channel, size: body.size, payload: body.pieces };
  }

  /** Takes what the piece holds of the frame being filled, and the frame once it is whole. */
  #fill() {
    const chunk = this.chunk;
    const offset = this.offset;
    const taken = Math.min(chunk.length - offset, this.frame.length - this.filled);

    chunk.copy(this.frame, this.filled, offset, offset + taken);

    this.filled += taken;
    this.offset = offset + taken;

    if (this.filled < this.frame.length) return this.#exhausted();

    const frame = this.frame;

    this.frame = null;

    return frameOf(frame, 0, frame.length - FRAME_HEADER_BYTES - FRAME_END_BYTES);
  }

  /** Completes a header that arrived split across pieces, and begins the frame it describes. */
  #header() {
    const chunk = this.chunk;
    const offset = this.offset;
    const needed = FRAME_HEADER_BYTES - this.head.length;

    if (chunk.length - offset < needed) {
      this.head = Buffer.concat([this.head, chunk.subarray(offset)]);

      return this.#exhausted();
    }

    const header = Buffer.concat([this.head, chunk.subarray(offset, offset + needed)]);
    const size = header.readUInt32BE(TYPE_BYTES + CHANNEL_BYTES);

    // a frame whose header itself was split is filled whatever its type: a body frame split
    // inside its first seven bytes is rare enough not to be worth a gather path of its own
    this.head = EMPTY;
    this.frame = Buffer.allocUnsafe(FRAME_HEADER_BYTES + size + FRAME_END_BYTES);
    this.filled = FRAME_HEADER_BYTES;
    this.offset = offset + needed;

    header.copy(this.frame, 0);

    return this.#fill();
  }

  /** Lets go of a piece that has nothing left in it. */
  #exhausted() {
    this.chunk = EMPTY;
    this.offset = 0;

    return false;
  }
}

/** A frame as it is read: the payload is a view, whatever it is a view of. */
function frameOf(bytes, offset, size) {
  const payloadAt = offset + FRAME_HEADER_BYTES;

  if (bytes.readUInt8(payloadAt + size) !== FRAME_END) throw new Error('Invalid frame');

  return {
    type: bytes.readUInt8(offset),
    channel: bytes.readUInt16BE(offset + TYPE_BYTES),
    size,
    payload: bytes.subarray(payloadAt, payloadAt + size),
  };
}

module.exports.Frames = Frames;

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
      return { channel, content: payload, size: frame.size };
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
