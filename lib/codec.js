// 
//
//

require('buffer-more-ints');

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
    return n >= 0x8000000000000000 ||
        (Math.abs(n) < 0x4000000000000
         && Math.floor(n) !== n);
}

function encodeTable(buffer, val, offset) {
    var start = offset;
    offset += 4; // leave room for the table length
    for (key in val) {
        console.log({FIELD: key, VALUE: val[key]});
        var len = Buffer.byteLength(key);
        buffer.writeUInt8(len, offset); offset++;
        buffer.write(key, offset, 'utf8'); offset += len;
        offset += encodeFieldValue(buffer, val[key], offset);
    }
    var size = offset - start;
    buffer.writeUInt32BE(size - 4, start);
    return size;
}

function encodeArray(buffer, val, offset) {
    var start = offset;
    offset += 4;
    for (var i=0, num=val.length; i < num; i++) {
        offset += encodeFieldValue(buffer, val[i], offset);
    }
    var size = offset - start;
    buffer.writeUInt32BE(size - 4, start);
    return size;
}

function encodeFieldValue(buffer, val, offset) {
    var start = offset;
    switch (typeof val) {
    case 'string': // no shortstr in field tables
        len = Buffer.byteLength(val, 'utf8');
        val.write('S'); offset++;
        buffer.writeUInt32BE(len, offset); offset += 4;
        buffer.write(val, offset, 'utf8'); offset += len;
        break;
    case 'object':
        if (val === null) {
            buffer.write('V'); offset++;
        }
        else if (Array.isArray(val)) {
            buffer.write('A', offset); offset++;
            offset += encodeArray(buffer, val, offset);
        }
        else if (Buffer.isBuffer(val)) {
            buffer.write('x', offset); offset++;
            buffer.writeUInt32BE(val.length, offset); offset += 4;
            val.copy(buffer, offset); offset += val.length;
        }
        else {
            buffer.write('F', offset); offset++;
            offset += encodeTable(buffer, val, offset);
        }
        break;
    case 'boolean':
        buffer.write('t'); offset++;
        buffer.writeInt8((val) ? 1 : 0, offset); offset++;
        break;
    case 'number':
        // Making assumptions about the kind of number (floating
        // point v integer, signed, unsigned, size) desired is
        // dangerous in general; however, in practice RabbitMQ
        // uses only longstrings and unsigned integers in its
        // arguments, and other clients generally conflate number
        // types anyway. So the only distinction we care about is
        // floating point vs integers, preferring integers since
        // those can be promoted if necessary.
        if (isFloatingPoint(val)) {
            if (val < 0x100000000) {
                buffer.write('f'); offset++;
                buffer.writeFloatBE(val, offset);
                offset += 4;
            }
            else {
                buffer.write('d'); offset++;
                buffer.writeDoubleBE(val, offset);
                offset += 8;
            }
        }
        else { // only signed values are used in tables by RabbitMQ,
               // except for 'byte's which are only unsigned.
            if (val < 256 && val >= 0) {
                buffer.write('b', offset); offset++;
                buffer.writeUInt8(val, offset); offset++;
            }
            else if (val >= -0x8000 && val < 0x8000) { //  short
                buffer.write('s', offset); offset++;
                buffer.writeInt16BE(val, offset); offset += 2;
            }
            else if (val >= -0x80000000 && val < 0x80000000) { // int
                buffer.write('I', offset); offset++;
                buffer.writeInt32BE(val, offset); offset += 4;
            }
            else { // long
                buffer.write('l', offset); offset++;
                buffer.writeInt64BE(val, offset); offset += 8;
            }
        }
        break;
    }
    return offset - start;
}

module.exports.encodeTable = encodeTable;
module.exports.encodeArray = encodeArray;
module.exports.encodeFieldValue = encodeFieldValue;
