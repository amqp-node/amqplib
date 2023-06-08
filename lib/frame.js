// The river sweeps through
// Silt and twigs, gravel and leaves
// Driving the wheel on


import { constants, decode } from './defs.js';

import Bits from '@acuminous/bitsyntax';

export const PROTOCOL_HEADER = "AMQP" + String.fromCharCode(0, 0, 9, 1);

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
const FRAME_METHOD = constants.FRAME_METHOD,
FRAME_HEARTBEAT = constants.FRAME_HEARTBEAT,
FRAME_HEADER = constants.FRAME_HEADER,
FRAME_BODY = constants.FRAME_BODY,
FRAME_END = constants.FRAME_END;

const bodyCons =
  Bits.builder(FRAME_BODY,
               'channel:16, size:32, payload:size/binary',
               FRAME_END);

// %%% TESTME possibly better to cons the first bit and write the
// second directly, in the absence of IO lists
export function makeBodyFrame(channel, payload) {
  return bodyCons({channel: channel, size: payload.length, payload: payload});
};

const frameHeaderPattern = Bits.matcher('type:8', 'channel:16',
                                      'size:32', 'rest/binary');

export function parseFrame(bin, max) {
  const fh = frameHeaderPattern(bin);
  if (fh) {
    const size = fh.size, rest = fh.rest;
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

const headerPattern = Bits.matcher('class:16',
                                 '_weight:16',
                                 'size:64',
                                 'flagsAndfields/binary');

const methodPattern = Bits.matcher('id:32, args/binary');

export let HEARTBEAT = {channel: 0};

export function decodeFrame(frame) {
  const payload = frame.payload;
  switch (frame.type) {
    case FRAME_METHOD: {     
      const idAndArgs = methodPattern(payload);
      const id = idAndArgs.id;
      const fields = decode(id, idAndArgs.args);
      return {id: id, channel: frame.channel, fields: fields};
    }
    case FRAME_HEADER: {

      const parts = headerPattern(payload);
      const id = parts['class'];
      const fields = decode(id, parts.flagsAndfields);
      return {id: id, channel: frame.channel,
              size: parts.size, fields: fields};
    }
  case FRAME_BODY:
    return {channel: frame.channel, content: frame.payload};
  case FRAME_HEARTBEAT:
    return HEARTBEAT;
  default:
    throw new Error('Unknown frame type ' + frame.type);
  }
}

// encoded heartbeat
export const HEARTBEAT_BUF = Buffer.from([constants.FRAME_HEARTBEAT,
                                           0, 0, 0, 0, // size = 0
                                           0, 0, // channel = 0
                                           constants.FRAME_END]);
