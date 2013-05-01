var codec = require('../lib/codec');
var defs = require('../lib/defs');
var assert = require('assert');

var suite = module.exports;

// These just test known encodings; to generate the answers I used
// RabbitMQ's binary generator module.

var testCases = [
    // integers
    ['byte', {byte: 127}, [4,98,121,116,101,98,127]],
    ['byte max value', {byte: 255}, [4,98,121,116,101,98,255]],
    ['byte min value', {byte: 0}, [4,98,121,116,101,98,0]],
    ['< 0 promoted to signed short', {short: -1}, [5,115,104,111,114,116,115,255,255]],
    ['> 255 promoted to short', {short: 256}, [5,115,104,111,114,116,115,1,0]],
    ['< 2^15 still a short', {short: 0x7fff}, [5,115,104,111,114,116,115,127,255]],
    ['-2^15 still a short', {short: -0x8000}, [5,115,104,111,114,116,115,128,0]],
    ['>= 2^15 promoted to int', {int: 0x8000}, [3,105,110,116,73,0,0,128,0]],
    ['< -2^15 promoted to int', {int: -0x8001}, [3,105,110,116,73,255,255,127,255]],
    ['< 2^31 still an int', {int: 0x7fffffff}, [3,105,110,116,73,127,255,255,255]],
    ['>= -2^31 still an int', {int: -0x80000000}, [3,105,110,116,73,128,0,0,0]],
    ['>= 2^31 promoted to long', {long: 0x80000000}, [4,108,111,110,103,108,0,0,0,0,128,0,0,0]],
    ['< -2^31 promoted to long', {long: -0x80000001}, [4,108,111,110,103,108,255,255,255,255,127,255,255,255]],

    // floating point
    ['float value', {double: 0.5}, [6,100,111,117,98,108,101,100,63,224,0,0,0,0,0,0]],
    ['negative float value', {double: -0.5}, [6,100,111,117,98,108,101,100,191,224,0,0,0,0,0,0]],
    // %% test some boundaries of precision?
    
    // string
    ['string', {string: "boop"}, [6,115,116,114,105,110,103,83,0,0,0,4,98,111,111,112]],

    // buffer -> byte array
    ['byte array from buffer', {bytes: new Buffer([1,2,3,4])},
     [5,98,121,116,101,115,120,0,0,0,4,1,2,3,4]],

    // boolean, void
    ['true', {bool: true}, [4,98,111,111,108,116,1]],
    ['false', {bool: false}, [4,98,111,111,108,116,0]],
    ['null', {'void': null}, [4,118,111,105,100,86]],

    // array, object
    ['array', {array: [6, true, "foo"]},
     [5,97,114,114,97,121,65,0,0,0,12,98,6,116,1,83,0,0,0,3,102,111,111]],
    ['object', {object: {foo: "bar", baz: 12}},
     [6,111,98,106,101,99,116,70,0,0,0,18,3,102,111,111,83,0,
      0,0,3,98,97,114,3,98,97,122,98,12]],

    // exotic types
    ['timestamp', {timestamp: {'!': 'timestamp', value: 1357212277527}},
     [9,116,105,109,101,115,116,97,109,112,84,0,0,1,60,0,39,219,23]],
    ['decimal', {decimal: {'!': 'decimal', value: {digits: 2345, places: 2}}},
     [7,100,101,99,105,109,97,108,68,2,0,0,9,41]],
    ['float', {float: {'!': 'float', value: 0.1}},
     [5,102,108,111,97,116,102,61,204,204,205]],,
];

testCases.forEach(function(tc) {
    var name = tc[0], val = tc[1], expect = tc[2];
    suite[name] = function() {
        var buffer = new Buffer(1000);
        var size = codec.encodeTable(buffer, val, 0);
        var result = buffer.slice(4, size);
        assert.deepEqual(expect, bufferToArray(result));
    };
});

function bufferToArray(b) {
    return Array.prototype.slice.call(b);
}

// Whole frames

var C = require('claire');

var forAll = C.forAll;
var arb = C.data;
var transform = C.transform;
var repeat = C.repeat;
var label = C.label;
var sequence = C.sequence;
var asGenerator = C.asGenerator;
var sized = C.sized;
var recursive = C.recursive;

// These aren't exported in claire/index. so I could have to reproduce
// them I guess.
function choose(a, b) {
  return Math.random() * (b - a) + a;
}

function chooseInt(a, b) {
  return Math.floor(choose(a, b));
}

function rangeInt(name, a, b) {
  return label(name,
               asGenerator(function(_) { return chooseInt(a, b); }));
}

function toFloat32(i) {
  var b = new Buffer(4);
  b.writeFloatBE(i, 0);
  return b.readFloatBE(0);
}

function floatChooser(maxExp) {
  return function() {
    var n = Number.NaN;
    while (isNaN(n)) {
      var mantissa = Math.random() * 2 - 1;
      var exponent = chooseInt(0, maxExp);
      n = Math.pow(mantissa, exponent);
  }
    return n;
  }
}

// FIXME null, byte array, others?

var Octet = rangeInt('octet', 0, 255);
var ShortStr = label('shortstr',
                     transform(function(s) {
                       return s.substr(0, 255);
                     }, arb.Str));

var LongStr = label('longstr',
                    transform(
                      function(bytes) { return new Buffer(bytes); },
                      repeat(Octet)));

var UShort = rangeInt('short-uint', 0, 0xffff);
var ULong = rangeInt('long-uint', 0, 0xffffffff);
var ULongLong = rangeInt('longlong-uint', 0, 0xffffffffffffffff);
var Short = rangeInt('short-int', -0x8000, 0x7fff);
var Long = rangeInt('long-int', -0x80000000, 0x7fffffff);
var LongLong = rangeInt('longlong-int', -0x8000000000000000, 0x7fffffffffffffff);
var Bit = label('bit', arb.Bool);
var Double = label('double', asGenerator(floatChooser(308)));
var Float = label('float', transform(toFloat32, floatChooser(38)));
var Timestamp = label('timestamp', transform(
  function(n) {
    return {'!': 'timestamp', value: n};
  }, ULongLong));
var Decimal = label('decimal', transform(
  function(args) {
    return {'!': 'decimal', value: {places: args[1], digits: args[0]}};
  }, sequence(arb.UInt, Octet)));

// TODO rrr these two are mutally recursive
var FieldArray = label('field-array', recursive(function() {
  return arb.Array(
    LongStr, ShortStr, Octet,
    UShort, ULong, ULongLong,
    Short, Long, LongLong,
    Bit, Float, Double, FieldTable)
}));


var FieldTable = label('table', recursive(function() {
  return sized(function() { return 5; },
               arb.Object(
                 LongStr, ShortStr, Octet,
                 UShort, ULong, ULongLong,
                 Short, Long, LongLong,
                 Bit, Float, Double, FieldArray))
}));

// Internal tests of our properties
domainProps = [
  [Octet, function(n) { return n >= 0 && n < 256; }],
  [ShortStr, function(s) { return typeof s === 'string' && s.length < 256; }],
  [LongStr, function(s) { return Buffer.isBuffer(s); }],
  [UShort, function(n) { return n >= 0 && n <= 0xffff; }],
  [ULong, function(n) { return n >= 0 && n <= 0xffffffff; }],
  [ULongLong, function(n) {
    return n >= 0 && n <= 0xffffffffffffffff; }],
  [Short, function(n) { return n >= -0x8000 && n <= 0x8000; }],
  [Long, function(n) { return n >= -0x80000000 && n < 0x80000000; }],
  [LongLong, function(n) { return n >= -0x8000000000000000 && n < 0x8000000000000000; }],
  [Bit, function(b) { return typeof b === 'boolean'; }],
  [Double, function(f) { return !isNaN(f) && isFinite(f); }],
  [Float, function(f) { return !isNaN(f) && isFinite(f) && (Math.log(Math.abs(f)) * Math.LOG10E) < 309; }],
  [Decimal, function(d) {
    return d['!'] === 'decimal' &&
      d.value['places'] <= 255 &&
      d.value['digits'] <= 0xffffffff;
  }],
  [Timestamp, function(t) { return t['!'] === 'timestamp'; }],
  [FieldTable, function(t) { return typeof t === 'object'; }],
  [FieldArray, function(a) { return Array.isArray(a); }]
];

domainProps.forEach(function(p) {
    suite['test' + p[0] + 'Domain'] = forAll(p[0]).satisfy(p[1]).asTest({times: 500});
});

function roundtrip_table(t) {
  var buf = new Buffer(4096);
  var size = codec.encodeTable(buf, t, 0);
  var decoded = codec.decodeFields(buf.slice(4, size)); // ignore the length-prefix
  try {
    assert.deepEqual(t, decoded);
  }
  catch (e) { return false; }
  return true;
}

function roundtrips(T) {
  return forAll(T).satisfy(function(v) { return roundtrip_table({value: v}); });
}

[
  Octet,
  ShortStr,
  LongStr,
  UShort,
  ULong,
  ULongLong,
  UShort,
  Short,
  Long,
  Bit,
  Decimal,
  Timestamp,
  Double,
  Float,
  FieldArray,
  FieldTable
].forEach(function(T) {
  suite['test' + T.toString() + 'Roundtrips'] = roundtrips(T).asTest();
});


// The spec is horribly inconsistent, and names various types
// different things in different places. It's chaos I tell you.

// These are the domains used in method arguments
ARG_TYPES = {
  'octet': Octet,
  'shortstr': ShortStr,
  'longstr': LongStr,
  'short': UShort,
  'long': ULong,
  'longlong': ULongLong,
  'bit': Bit,
  'table': FieldTable,
  'timestamp': Timestamp
};

function args(Method) {
  var types = Method.args.map(function(a) { return ARG_TYPES[a.type];});
  return sequence.apply(null, types);
}

function roundtripMethod(Method) {

  function zipObject(vals, names) {
    var obj = {};
    vals.forEach(function(v, i) { obj[names[i]] = v; });
    return obj;
  }

  var domain = args(Method);
  var names = Method.args.map(function(a) { return a.name; });
  return forAll(domain).satisfy(function(vals) {
    var m = new Method(zipObject(vals, names));
    var buf = m.encodeToFrame(0);
    // FIXME depends on framing, ugh
    var m1 = Method.fromBuffer(buf.slice(11, buf.length));
    assert.deepEqual(m1.fields, m.fields);
    return true;
  }).asTest();
}

for (var k in defs) {
  var Method = defs[k];
  if (Method.id) {
    suite['test' + Method.name + 'Roundtrip'] = roundtripMethod(Method);
  }
};
