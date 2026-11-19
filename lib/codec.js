/*
The AMQP 0-9-1 is a mess when it comes to the types that can be
encoded on the wire.

There are four encoding schemes, and three overlapping sets of types:
frames, methods, (field-)tables, and properties.

Each *frame type* has a set layout in which values of given types are
concatenated along with sections of "raw binary" data.

In frames there are `shortstr`s, that is length-prefixed strings of
UTF8 chars, 8 bit unsigned integers (called `octet`), unsigned 16 bit
integers (called `short` or `short-uint`), unsigned 32 bit integers
(called `long` or `long-uint`), unsigned 64 bit integers (called
`longlong` or `longlong-uint`), and flags (called `bit`).

Methods are encoded as a frame giving a method ID and a sequence of
arguments of known types. The encoded method argument values are
concatenated (with some fun complications around "packing" consecutive
bit values into bytes).

Along with the types given in frames, method arguments may be long
byte strings (`longstr`, not required to be UTF8) or 64 bit unsigned
integers to be interpreted as timestamps (yeah I don't know why
either), or arbitrary sets of key-value pairs (called `field-table`).

Inside a field table the keys are `shortstr` and the values are
prefixed with a byte tag giving the type. The types are any of the
above except for bits (which are replaced by byte-wide `bool`), along
with a NULL value `void`, a special fixed-precision number encoding
(`decimal`), IEEE754 `float`s and `double`s, signed integers,
`field-array` (a sequence of tagged values), and nested field-tables.

RabbitMQ and QPid use a subset of the field-table types, and different
value tags, established before the AMQP 0-9-1 specification was
published. So far as I know, no-one uses the types and tags as
published. http://www.rabbitmq.com/amqp-0-9-1-errata.html gives the
list of field-table types.

Lastly, there are (sets of) properties, only one of which is given in
AMQP 0-9-1: `BasicProperties`. These are almost the same as methods,
except that they appear in content header frames, which include a
content size, and they carry a set of flags indicating which
properties are present. This scheme can save ones of bytes per message
(messages which take a minimum of three frames each to send).
*/

// JavaScript uses only doubles so what I'm testing for is whether
// it's *better* to encode a number as a float or double. This really
// just amounts to testing whether there's a fractional part to the
// number, except that see below. NB I don't use bitwise operations to
// do this 'efficiently' -- it would mask the number to 32 bits.
//
// At 2^53, doubles no longer have a fractional part, so anything with
// a magnitude at or above that is an integer and may as well be
// encoded as a 64-bit integer. Except that only signed integers are
// supported by RabbitMQ, so anything outside the range -2^63 to
// 2^63 - 1 must be a double, as must NaN.
function isFloatingPoint(n) {
  return n >= 0x8000000000000000 || n < -0x8000000000000000 || Number.isNaN(n) || (Math.abs(n) < 2 ** 53 && Math.floor(n) !== n);
}

const MAX_INT64 = 0x7fffffffffffffffn;
const MAX_UINT64 = 0xffffffffffffffffn;
const MAX_INT64_AS_NUMBER = Number(MAX_INT64);
const MAX_UINT64_AS_NUMBER = Number(MAX_UINT64);

function toBigInt64(val) {
  return val === MAX_INT64_AS_NUMBER ? MAX_INT64 : BigInt(val);
}

function toBigUInt64(val) {
  return val === MAX_UINT64_AS_NUMBER ? MAX_UINT64 : BigInt(val);
}

function checkSpace(buffer, offset, size) {
  if (offset + size > buffer.length) {
    throw new RangeError(`Encoded field table (headers or arguments) exceeds the ${buffer.length} byte encoding buffer`);
  }
}

function encodeTable(buffer, table, offset) {
  const start = offset;
  const unfinishedContainers = [];
  offset = beginEncodingContainer(unfinishedContainers, buffer, table, offset);
  while (unfinishedContainers.length > 0) {
    const innermostContainer = unfinishedContainers.at(-1);
    if (hasUnencodedEntries(innermostContainer)) {
      offset = encodeNextEntry(unfinishedContainers, buffer, innermostContainer, offset);
    } else {
      finishEncodingContainer(unfinishedContainers, buffer, offset);
    }
  }
  return offset - start;
}

function beginEncodingContainer(unfinishedContainers, buffer, values, offset) {
  checkSpace(buffer, offset, 4);
  const isArray = Array.isArray(values);
  const keys = isArray ? null : enumerableKeys(values);
  const entryCount = isArray ? values.length : keys.length;
  unfinishedContainers.push({ values, isArray, keys, entryCount, nextEntry: 0, lengthOffset: offset });
  return offset + 4; // leave room for the length
}

function enumerableKeys(table) {
  const keys = [];
  for (const key in table) keys.push(key);
  return keys;
}

function hasUnencodedEntries(container) {
  return container.nextEntry < container.entryCount;
}

function finishEncodingContainer(unfinishedContainers, buffer, offset) {
  const container = unfinishedContainers.pop();
  const contentOffset = container.lengthOffset + 4;
  buffer.writeUInt32BE(offset - contentOffset, container.lengthOffset);
}

function encodeNextEntry(unfinishedContainers, buffer, container, offset) {
  return container.isArray
    ? encodeNextArrayElement(unfinishedContainers, buffer, container, offset)
    : encodeNextTableEntry(unfinishedContainers, buffer, container, offset);
}

function encodeNextArrayElement(unfinishedContainers, buffer, container, offset) {
  const value = container.values[container.nextEntry];
  container.nextEntry++;
  return encodeValue(unfinishedContainers, buffer, value, offset);
}

function encodeNextTableEntry(unfinishedContainers, buffer, container, offset) {
  const key = container.keys[container.nextEntry];
  const value = container.values[key];
  container.nextEntry++;
  if (value === undefined) return offset;
  offset += encodeKey(buffer, key, offset);
  return encodeValue(unfinishedContainers, buffer, value, offset);
}

function encodeKey(buffer, key, offset) {
  const len = Buffer.byteLength(key);
  checkSpace(buffer, offset, 1 + len);
  buffer.writeUInt8(len, offset);
  buffer.write(key, offset + 1, 'utf8');
  return 1 + len;
}

function encodeValue(unfinishedContainers, buffer, value, offset) {
  // A trapdoor for specifying a type, e.g., timestamp
  const explicitlyTyped = hasExplicitType(value);
  const type = explicitlyTyped ? value['!'] : typeof value;
  const val = explicitlyTyped ? value.value : value;

  if (type === 'table') return encodeExplicitTable(unfinishedContainers, buffer, val, offset);
  if (isTableOrArray(type, val)) return encodeContainer(unfinishedContainers, buffer, val, offset);
  return offset + encodeScalar(buffer, type, val, offset);
}

function encodeExplicitTable(unfinishedContainers, buffer, table, offset) {
  if (!isTable(table)) throw new TypeError('The value of an explicit table must be a table');
  return encodeContainer(unfinishedContainers, buffer, table, offset);
}

function encodeContainer(unfinishedContainers, buffer, values, offset) {
  offset += encodeContainerTag(buffer, values, offset);
  return beginEncodingContainer(unfinishedContainers, buffer, values, offset);
}

function hasExplicitType(value) {
  return Boolean(value) && typeof value === 'object' && Object.hasOwn(value, '!');
}

function isTableOrArray(type, val) {
  return type === 'object' && val !== null && !Buffer.isBuffer(val);
}

function isTable(val) {
  return isTableOrArray(typeof val, val) && !Array.isArray(val);
}

function encodeContainerTag(buffer, values, offset) {
  checkSpace(buffer, offset, 1);
  buffer.write(Array.isArray(values) ? 'A' : 'F', offset);
  return 1;
}

function encodeScalar(buffer, type, val, offset) {
  const start = offset;

  // If it's a JS number, we'll have to guess what type to encode it
  // as.
  if (type === 'number') {
    // Making assumptions about the kind of number (floating point
    // v integer, signed, unsigned, size) desired is dangerous in
    // general; however, in practice RabbitMQ uses only
    // longstrings and unsigned integers in its arguments, and
    // other clients generally conflate number types anyway. So
    // the only distinction we care about is floating point vs
    // integers, preferring integers since those can be promoted
    // if necessary. If floating point is required, we may as well
    // use double precision.
    if (isFloatingPoint(val)) {
      type = 'double';
    } else {
      // only signed values are used in tables by
      // RabbitMQ. It *used* to (< v3.3.0) treat the byte 'b'
      // type as unsigned, but most clients (and the spec)
      // think it's signed, and now RabbitMQ does too.
      if (val < 128 && val >= -128) {
        type = 'byte';
      } else if (val >= -0x8000 && val < 0x8000) {
        type = 'short';
      } else if (val >= -0x80000000 && val < 0x80000000) {
        type = 'int';
      } else {
        type = 'long';
      }
    }
  }

  function tag(t) {
    checkSpace(buffer, offset, 1);
    buffer.write(t, offset);
    offset++;
  }

  switch (type) {
    case 'string': {
      // no shortstr in field tables
      const len = Buffer.byteLength(val, 'utf8');
      tag('S');
      checkSpace(buffer, offset, 4 + len);
      buffer.writeUInt32BE(len, offset);
      offset += 4;
      buffer.write(val, offset, 'utf8');
      offset += len;
      break;
    }
    case 'object':
      if (val === null) {
        tag('V');
      } else {
        tag('x');
        checkSpace(buffer, offset, 4 + val.length);
        buffer.writeUInt32BE(val.length, offset);
        offset += 4;
        val.copy(buffer, offset);
        offset += val.length;
      }
      break;
    case 'boolean':
      tag('t');
      checkSpace(buffer, offset, 1);
      buffer.writeUInt8(val ? 1 : 0, offset);
      offset++;
      break;
    // These are the types that are either guessed above, or
    // explicitly given using the {'!': type} notation.
    case 'double':
    case 'float64':
      tag('d');
      checkSpace(buffer, offset, 8);
      buffer.writeDoubleBE(val, offset);
      offset += 8;
      break;
    case 'byte':
    case 'int8':
      tag('b');
      checkSpace(buffer, offset, 1);
      buffer.writeInt8(val, offset);
      offset++;
      break;
    case 'unsignedbyte':
    case 'uint8':
      tag('B');
      checkSpace(buffer, offset, 1);
      buffer.writeUInt8(val, offset);
      offset++;
      break;
    case 'short':
    case 'int16':
      tag('s');
      checkSpace(buffer, offset, 2);
      buffer.writeInt16BE(val, offset);
      offset += 2;
      break;
    case 'unsignedshort':
    case 'uint16':
      tag('u');
      checkSpace(buffer, offset, 2);
      buffer.writeUInt16BE(val, offset);
      offset += 2;
      break;
    case 'int':
    case 'int32':
      tag('I');
      checkSpace(buffer, offset, 4);
      buffer.writeInt32BE(val, offset);
      offset += 4;
      break;
    case 'unsignedint':
    case 'uint32':
      tag('i');
      checkSpace(buffer, offset, 4);
      buffer.writeUInt32BE(val, offset);
      offset += 4;
      break;
    case 'long':
    case 'int64':
      tag('l');
      checkSpace(buffer, offset, 8);
      buffer.writeBigInt64BE(toBigInt64(val), offset);
      offset += 8;
      break;

    // Now for exotic types, those can _only_ be denoted by using
    // `{'!': type, value: val}
    case 'timestamp':
      tag('T');
      checkSpace(buffer, offset, 8);
      buffer.writeBigUInt64BE(toBigUInt64(val), offset);
      offset += 8;
      break;
    case 'float':
      tag('f');
      checkSpace(buffer, offset, 4);
      buffer.writeFloatBE(val, offset);
      offset += 4;
      break;
    case 'decimal':
      tag('D');
      if (Object.hasOwn(val, 'places') && Object.hasOwn(val, 'digits') && val.places >= 0 && val.places < 256) {
        checkSpace(buffer, offset, 5);
        buffer[offset] = val.places;
        offset++;
        buffer.writeUInt32BE(val.digits, offset);
        offset += 4;
      } else throw new TypeError(`Decimal value must be {'places': 0..255, 'digits': uint32}, got ${JSON.stringify(val)}`);
      break;
    default:
      throw new TypeError(`Unknown type to encode: ${type}`);
  }
  return offset - start;
}

// Assume we're given a slice of the buffer that contains just the
// fields.
function decodeFields(slice) {
  const fields = {};
  const unfinishedContainers = [];
  beginDecodingTable(unfinishedContainers, fields, slice);
  while (unfinishedContainers.length > 0) {
    const innermostContainer = unfinishedContainers.at(-1);
    if (hasUndecodedEntries(innermostContainer)) {
      decodeNextEntry(unfinishedContainers, innermostContainer);
    } else {
      finishDecodingContainer(unfinishedContainers);
    }
  }
  return fields;
}

function beginDecodingTable(unfinishedContainers, values, slice, parent, key) {
  const reader = { slice, offset: 0 };
  unfinishedContainers.push({ values, isArray: false, reader, endOffset: slice.length, parent, key });
}

function beginDecodingArray(unfinishedContainers, values, reader, length, parent, key) {
  unfinishedContainers.push({ values, isArray: true, reader, endOffset: reader.offset + length, parent, key });
}

function hasUndecodedEntries(container) {
  return container.reader.offset < container.endOffset;
}

function finishDecodingContainer(unfinishedContainers) {
  const container = unfinishedContainers.pop();
  if (container.parent) setValue(container.parent, container.key, decodedValue(container));
}

function decodedValue(container) {
  return hasExplicitTypeKey(container) ? { '!': 'table', value: container.values } : container.values;
}

function hasExplicitTypeKey(container) {
  return !container.isArray && Object.hasOwn(container.values, '!');
}

function decodeNextEntry(unfinishedContainers, container) {
  if (container.isArray) {
    decodeNextArrayElement(unfinishedContainers, container);
  } else {
    decodeNextTableEntry(unfinishedContainers, container);
  }
}

function decodeNextArrayElement(unfinishedContainers, container) {
  const index = container.values.length;
  decodeValue(unfinishedContainers, container, index);
}

function decodeNextTableEntry(unfinishedContainers, container) {
  const key = decodeKey(container.reader);
  decodeValue(unfinishedContainers, container, key);
}

function decodeKey(reader) {
  const len = reader.slice.readUInt8(reader.offset);
  const start = reader.offset + 1;
  reader.offset = start + len;
  return reader.slice.toString('utf8', start, start + len);
}

function decodeValue(unfinishedContainers, container, key) {
  const tag = decodeTag(container.reader);
  if (tag === 'F') {
    decodeNestedTable(unfinishedContainers, container, key);
  } else if (tag === 'A') {
    decodeNestedArray(unfinishedContainers, container, key);
  } else {
    setValue(container, key, decodeScalar(container.reader, tag));
  }
}

function setValue(container, key, value) {
  if (key === '__proto__') {
    Object.defineProperty(container.values, key, { value, enumerable: true, writable: true, configurable: true });
  } else {
    container.values[key] = value;
  }
}

function decodeTag(reader) {
  const tag = String.fromCharCode(reader.slice[reader.offset]);
  reader.offset++;
  return tag;
}

function decodeNestedTable(unfinishedContainers, parent, key) {
  const reader = parent.reader;
  const length = decodeLength(reader);
  const slice = reader.slice.subarray(reader.offset, reader.offset + length);
  reader.offset += length;
  beginDecodingTable(unfinishedContainers, {}, slice, parent, key);
}

function decodeNestedArray(unfinishedContainers, parent, key) {
  const length = decodeLength(parent.reader);
  beginDecodingArray(unfinishedContainers, [], parent.reader, length, parent, key);
}

function decodeLength(reader) {
  const len = reader.slice.readUInt32BE(reader.offset);
  reader.offset += 4;
  return len;
}

function decodeScalar(reader, tag) {
  const slice = reader.slice;
  let offset = reader.offset;
  let len;
  let val;

  switch (tag) {
    case 'b':
      val = slice.readInt8(offset);
      offset++;
      break;
    case 'B':
      val = slice.readUInt8(offset);
      offset++;
      break;
    case 'S':
      len = slice.readUInt32BE(offset);
      offset += 4;
      val = slice.toString('utf8', offset, offset + len);
      offset += len;
      break;
    case 'I':
      val = slice.readInt32BE(offset);
      offset += 4;
      break;
    case 'i':
      val = slice.readUInt32BE(offset);
      offset += 4;
      break;
    case 'D': {
      // only positive decimals, apparently.
      const places = slice[offset];
      offset++;
      const digits = slice.readUInt32BE(offset);
      offset += 4;
      val = { '!': 'decimal', value: { places: places, digits: digits } };
      break;
    }
    case 'T':
      val = Number(slice.readBigUInt64BE(offset));
      offset += 8;
      val = { '!': 'timestamp', value: val };
      break;
    case 'd':
      val = slice.readDoubleBE(offset);
      offset += 8;
      break;
    case 'f':
      val = slice.readFloatBE(offset);
      offset += 4;
      break;
    case 'l':
      val = Number(slice.readBigInt64BE(offset));
      offset += 8;
      break;
    case 's':
      val = slice.readInt16BE(offset);
      offset += 2;
      break;
    case 'u':
      val = slice.readUInt16BE(offset);
      offset += 2;
      break;
    case 't':
      val = slice[offset] !== 0;
      offset++;
      break;
    case 'V':
      val = null;
      break;
    case 'x':
      len = slice.readUInt32BE(offset);
      offset += 4;
      val = slice.subarray(offset, offset + len);
      offset += len;
      break;
    default:
      throw new TypeError(`Unexpected type tag "${tag}"`);
  }

  reader.offset = offset;
  return val;
}

module.exports.encodeTable = encodeTable;
module.exports.decodeFields = decodeFields;
module.exports.toBigUInt64 = toBigUInt64;
