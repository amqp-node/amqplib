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
// At 2^50, doubles don't have sufficient precision to distinguish
// between floating point and integer numbers (`Math.pow(2, 50) + 0.1
// === Math.pow(2, 50)` (and, above 2^53, doubles cannot represent all
// integers (`Math.pow(2, 53) + 1 === Math.pow(2, 53)`)). Hence
// anything with a magnitude at or above 2^50 may as well be encoded
// as a 64-bit integer. Except that only signed integers are supported
// by RabbitMQ, so anything above 2^63 - 1 must be a double.
function isFloatingPoint(n) {
  return n >= 0x8000000000000000 || (Math.abs(n) < 0x4000000000000 && Math.floor(n) !== n);
}

function checkSpace(buffer, offset, size) {
  if (offset + size > buffer.length) {
    throw new RangeError(`Encoded field table (headers or arguments) exceeds the ${buffer.length} byte encoding buffer`);
  }
}

function encodeTable(buffer, table, offset) {
  const start = offset;
  const unfinished = [];
  offset = beginContainer(unfinished, buffer, table, offset);
  while (unfinished.length > 0) {
    const current = unfinished.at(-1);
    if (current.next < current.count) {
      offset = encodeEntry(unfinished, buffer, current, offset);
    } else {
      buffer.writeUInt32BE(offset - current.lengthAt - 4, current.lengthAt);
      unfinished.pop();
    }
  }
  return offset - start;
}

function beginContainer(unfinished, buffer, container, offset) {
  checkSpace(buffer, offset, 4);
  const keys = Array.isArray(container) ? null : enumerableKeys(container);
  const count = keys ? keys.length : container.length;
  unfinished.push({ container, keys, count, next: 0, lengthAt: offset });
  return offset + 4; // leave room for the length
}

function enumerableKeys(table) {
  const keys = [];
  for (const key in table) keys.push(key);
  return keys;
}

function encodeEntry(unfinished, buffer, current, offset) {
  const key = current.keys ? current.keys[current.next] : current.next;
  const value = current.container[key];
  current.next++;

  if (current.keys) {
    if (value === undefined) return offset;
    offset += encodeKey(buffer, key, offset);
  }

  let type = typeof value;
  let val = value;
  // A trapdoor for specifying a type, e.g., timestamp
  if (value && type === 'object' && Object.hasOwn(value, '!')) {
    val = value.value;
    type = value['!'];
  }

  if (type !== 'object' || val === null || Buffer.isBuffer(val)) {
    return offset + encodeScalar(buffer, type, val, offset);
  }

  checkSpace(buffer, offset, 1);
  buffer.write(Array.isArray(val) ? 'A' : 'F', offset);
  return beginContainer(unfinished, buffer, val, offset + 1);
}

function encodeKey(buffer, key, offset) {
  const len = Buffer.byteLength(key);
  checkSpace(buffer, offset, 1 + len);
  buffer.writeUInt8(len, offset);
  buffer.write(key, offset + 1, 'utf8');
  return 1 + len;
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
      buffer.writeBigInt64BE(BigInt(val), offset);
      offset += 8;
      break;

    // Now for exotic types, those can _only_ be denoted by using
    // `{'!': type, value: val}
    case 'timestamp':
      tag('T');
      checkSpace(buffer, offset, 8);
      buffer.writeBigUInt64BE(BigInt(val), offset);
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
  const unfinished = [{ container: fields, isArray: false, reader: { slice, offset: 0 }, end: slice.length }];
  while (unfinished.length > 0) {
    const current = unfinished.at(-1);
    if (current.reader.offset < current.end) {
      decodeEntry(unfinished, current);
    } else {
      unfinished.pop();
    }
  }
  return fields;
}

function decodeEntry(unfinished, current) {
  const { container, reader } = current;
  const key = current.isArray ? container.length : decodeKey(reader);
  const tag = String.fromCharCode(reader.slice[reader.offset]);
  reader.offset++;

  if (tag === 'F') {
    const len = decodeLength(reader);
    const slice = reader.slice.subarray(reader.offset, reader.offset + len);
    reader.offset += len;
    const table = {};
    container[key] = table;
    unfinished.push({ container: table, isArray: false, reader: { slice, offset: 0 }, end: slice.length });
  } else if (tag === 'A') {
    const len = decodeLength(reader);
    const array = [];
    container[key] = array;
    unfinished.push({ container: array, isArray: true, reader, end: reader.offset + len });
  } else {
    container[key] = decodeScalar(reader, tag);
  }
}

function decodeKey(reader) {
  const len = reader.slice.readUInt8(reader.offset);
  const start = reader.offset + 1;
  reader.offset = start + len;
  return reader.slice.toString('utf8', start, start + len);
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
