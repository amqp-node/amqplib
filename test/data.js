// Property-based testing representations of various things in AMQP


import C from 'claire';
const forAll = C.forAll;
const arb = C.data;
const transform = C.transform;
const repeat = C.repeat;
const label = C.label;
const sequence = C.sequence;
const asGenerator = C.asGenerator;
const sized = C.sized;
const recursive = C.recursive;
const choice = C.choice;
const Undefined = C.Undefined;

// Stub these out so we can use outside tests
// if (!suite) const suite = function() {}
// if (!test) const test = function() {}

// These aren't exported in claire/index. so I could have to reproduce
// them I guess.
function choose(a, b) {
  return Math.random() * (b - a) + a;
}

function chooseInt(a, b) {
  return Math.floor(choose(a, b));
}

export function rangeInt(name, a, b) {
  return label(name,
               asGenerator(function(_) { return chooseInt(a, b); }));
}

function toFloat32(i) {
  const b = Buffer.alloc(4);
  b.writeFloatBE(i, 0);
  return b.readFloatBE(0);
}

function floatChooser(maxExp) {
  return function() {
    let n = Number.NaN;
    while (isNaN(n)) {
      const mantissa = Math.random() * 2 - 1;
      const exponent = chooseInt(0, maxExp);
      n = Math.pow(mantissa, exponent);
  }
    return n;
  }
}

function explicitType(t, underlying) {
    return label(t, transform(function(n) {
        return {'!': t, value: n};
    }, underlying));
}

// FIXME null, byte array, others?

const Octet = rangeInt('octet', 0, 255);
const ShortStr = label('shortstr',
                     transform(function(s) {
                       return s.substr(0, 255);
                     }, arb.Str));

const LongStr = label('longstr',
                    transform(
                      function(bytes) { return Buffer.from(bytes); },
                      repeat(Octet)));

const UShort = rangeInt('short-uint', 0, 0xffff);
const ULong = rangeInt('long-uint', 0, 0xffffffff);
const ULongLong = rangeInt('longlong-uint', 0, 0xffffffffffffffff);
const Short = rangeInt('short-int', -0x8000, 0x7fff);
const Long = rangeInt('long-int', -0x80000000, 0x7fffffff);
const LongLong = rangeInt('longlong-int', -0x8000000000000000,
                        0x7fffffffffffffff);
const Bit = label('bit', arb.Bool);
const Double = label('double', asGenerator(floatChooser(308)));
const Float = label('float', transform(toFloat32, floatChooser(38)));
const Timestamp = label('timestamp', transform(
  function(n) {
    return {'!': 'timestamp', value: n};
  }, ULongLong));
const Decimal = label('decimal', transform(
  function(args) {
    return {'!': 'decimal', value: {places: args[1], digits: args[0]}};
  }, sequence(arb.UInt, Octet)));

// Signed 8 bit int
const Byte = rangeInt('byte', -128, 127);

// Explicitly typed values
const ExByte = explicitType('byte', Byte);
const ExInt8 = explicitType('int8', Byte);
const ExShort = explicitType('short', Short);
const ExInt16 = explicitType('int16', Short);
const ExInt = explicitType('int', Long);
const ExInt32 = explicitType('int32', Long);
const ExLong = explicitType('long', LongLong);
const ExInt64 = explicitType('int64', LongLong);

const FieldArray = label('field-array', recursive(function() {
  return arb.Array(
    arb.Null,
    LongStr, ShortStr,
    Octet, UShort, ULong, ULongLong,
    Byte, Short, Long, LongLong,
    ExByte, ExInt8, ExShort, ExInt16,
    ExInt, ExInt32, ExLong, ExInt64,
    Bit, Float, Double, FieldTable, FieldArray)
}));

const FieldTable = label('table', recursive(function() {
  return sized(function() { return 5; },
               arb.Object(
                 arb.Null,
                 LongStr, ShortStr, Octet,
                 UShort, ULong, ULongLong,
                 Byte, Short, Long, LongLong,
                 ExByte, ExInt8, ExShort, ExInt16,
                 ExInt, ExInt32, ExLong, ExInt64,
                 Bit, Float, Double, FieldArray, FieldTable))
}));

// Internal tests of our properties
const domainProps = [
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

suite("Domains", function() {
  domainProps.forEach(function(p) {
    test(p[0] + ' domain',
         forAll(p[0]).satisfy(p[1]).asTest({times: 500}));
  });
});

// For methods and properties (as opposed to field table values) it's
// easier just to accept and produce numbers for timestamps.
const ArgTimestamp = label('timestamp', ULongLong);

// These are the domains used in method arguments
const ARG_TYPES = {
  'octet': Octet,
  'shortstr': ShortStr,
  'longstr': LongStr,
  'short': UShort,
  'long': ULong,
  'longlong': ULongLong,
  'bit': Bit,
  'table': FieldTable,
  'timestamp': ArgTimestamp
};

function argtype(thing) {
  if (thing.default === undefined) {
    return ARG_TYPES[thing.type];
  }
  else {
    return choice(ARG_TYPES[thing.type], Undefined);
  }
}

function zipObject(vals, names) {
  const obj = {};
  vals.forEach(function(v, i) { obj[names[i]] = v; });
  return obj;
}

function name(arg) { return arg.name; }

import * as defs from '../lib/defs.js';

function method(info) {
  const domain = sequence.apply(null, info.args.map(argtype));
  const names = info.args.map(name);
  return label(info.name, transform(function(fieldVals) {
    return {id: info.id,
            fields: zipObject(fieldVals, names)};
  }, domain));
}

function getProperties(info) {
  const types = info.args.map(argtype);
  types.unshift(ULongLong); // size
  const domain = sequence.apply(null, types);
  const names = info.args.map(name);
  return label(info.name, transform(function(fieldVals) {
    return {id: info.id,
            size: fieldVals[0],
            fields: zipObject(fieldVals.slice(1), names)};
  }, domain));
}

const methods = [];
const properties = [];

for (let k in defs) {
  if (k.substr(0, 10) === 'methodInfo') {
    methods.push(method(defs[k]));
    methods[defs[k].name] = method(defs[k]);
  }
  else if (k.substr(0, 14) === 'propertiesInfo') {
    properties.push(getProperties(defs[k]));
    properties[defs[k].name] = getProperties(defs[k]);
  }
};

export {
  Octet,
  ShortStr,
  LongStr,
  UShort,
  ULong,
  ULongLong,
  Short,
  Long,
  LongLong,
  Bit,
  Double,
  Float,
  Timestamp,
  Decimal,
  FieldArray,
  FieldTable,

  methods,
  properties
}
