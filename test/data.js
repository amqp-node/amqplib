const C = require('claire');
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
// if (!suite) var suite = function() {}
// if (!test) var test = function() {}

// These aren't exported in claire/index. so I could have to reproduce
// them I guess.
function choose(a, b) {
  return Math.random() * (b - a) + a;
}

function chooseInt(a, b) {
  return Math.floor(choose(a, b));
}

function rangeInt(name, a, b) {
  return label(
    name,
    asGenerator((_) => chooseInt(a, b)),
  );
}

function toFloat32(i) {
  const b = Buffer.alloc(4);
  b.writeFloatBE(i, 0);
  return b.readFloatBE(0);
}

function floatChooser(maxExp) {
  return () => {
    let n = Number.NaN;
    while (Number.isNaN(n)) {
      const mantissa = Math.random() * 2 - 1;
      const exponent = chooseInt(0, maxExp);
      n = mantissa ** exponent;
    }
    return n;
  };
}

function explicitType(t, underlying) {
  return label(
    t,
    transform((n) => ({'!': t, value: n}), underlying),
  );
}

// FIXME null, byte array, others?

const Octet = rangeInt('octet', 0, 255);
const ShortStr = label(
  'shortstr',
  transform((s) => s.substr(0, 255), arb.Str),
);

const LongStr = label(
  'longstr',
  transform((bytes) => Buffer.from(bytes), repeat(Octet)),
);

const UShort = rangeInt('short-uint', 0, 0xffff);
const ULong = rangeInt('long-uint', 0, 0xffffffff);
const ULongLong = rangeInt('longlong-uint', 0, Number.MAX_SAFE_INTEGER);
const Short = rangeInt('short-int', -0x8000, 0x7fff);
const Long = rangeInt('long-int', -0x80000000, 0x7fffffff);
const LongLong = rangeInt('longlong-int', Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
const Bit = label('bit', arb.Bool);
const Double = label('double', asGenerator(floatChooser(308)));
const Float = label('float', transform(toFloat32, floatChooser(38)));
const Timestamp = label(
  'timestamp',
  transform((n) => ({'!': 'timestamp', value: n}), ULongLong),
);
const Decimal = label(
  'decimal',
  transform((args) => ({'!': 'decimal', value: {places: args[1], digits: args[0]}}), sequence(arb.UInt, Octet)),
);
const UnsignedByte = label(
  'unsignedbyte',
  transform((n) => ({'!': 'unsignedbyte', value: n}), Octet),
);
const UnsignedShort = label(
  'unsignedshort',
  transform((n) => ({'!': 'unsignedshort', value: n}), UShort),
);
const UnsignedInt = label(
  'unsignedint',
  transform((n) => ({'!': 'unsignedint', value: n}), ULong),
);

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

const FieldArray = label(
  'field-array',
  recursive(() =>
    arb.Array(
      arb.Null,
      LongStr,
      ShortStr,
      Octet,
      UShort,
      ULong,
      ULongLong,
      Byte,
      Short,
      Long,
      LongLong,
      ExByte,
      ExInt8,
      ExShort,
      ExInt16,
      ExInt,
      ExInt32,
      ExLong,
      ExInt64,
      Bit,
      Float,
      Double,
      FieldTable,
      FieldArray,
    ),
  ),
);

const FieldTable = label(
  'table',
  recursive(() =>
    sized(
      () => 5,
      arb.Object(
        arb.Null,
        LongStr,
        ShortStr,
        Octet,
        UShort,
        ULong,
        ULongLong,
        Byte,
        Short,
        Long,
        LongLong,
        ExByte,
        ExInt8,
        ExShort,
        ExInt16,
        ExInt,
        ExInt32,
        ExLong,
        ExInt64,
        Bit,
        Float,
        Double,
        FieldArray,
        FieldTable,
      ),
    ),
  ),
);

// Internal tests of our properties
const domainProps = [
  [Octet, (n) => n >= 0 && n < 256],
  [ShortStr, (s) => typeof s === 'string' && s.length < 256],
  [LongStr, (s) => Buffer.isBuffer(s)],
  [UShort, (n) => n >= 0 && n <= 0xffff],
  [ULong, (n) => n >= 0 && n <= 0xffffffff],
  [ULongLong, (n) => n >= 0 && n <= 0xffffffffffffffff],
  [Short, (n) => n >= -0x8000 && n <= 0x8000],
  [Long, (n) => n >= -0x80000000 && n < 0x80000000],
  [LongLong, (n) => n >= Number.MIN_SAFE_INTEGER && n <= Number.MAX_SAFE_INTEGER],
  [Bit, (b) => typeof b === 'boolean'],
  [Double, (f) => !Number.isNaN(f) && Number.isFinite(f)],
  [Float, (f) => !Number.isNaN(f) && Number.isFinite(f) && Math.log(Math.abs(f)) * Math.LOG10E < 309],
  [Decimal, (d) => d['!'] === 'decimal' && d.value['places'] <= 255 && d.value['digits'] <= 0xffffffff],
  [Timestamp, (t) => t['!'] === 'timestamp'],
  [FieldTable, (t) => typeof t === 'object'],
  [FieldArray, (a) => Array.isArray(a)],
];

suite('Domains', () => {
  domainProps.forEach((p) => {
    test(`${p[0]} domain`, forAll(p[0]).satisfy(p[1]).asTest({times: 500}));
  });
});

// For methods and properties (as opposed to field table values) it's
// easier just to accept and produce numbers for timestamps.
const ArgTimestamp = label('timestamp', ULongLong);

// These are the domains used in method arguments
const ARG_TYPES = {
  octet: Octet,
  shortstr: ShortStr,
  longstr: LongStr,
  short: UShort,
  long: ULong,
  longlong: ULongLong,
  bit: Bit,
  table: FieldTable,
  timestamp: ArgTimestamp,
};

function argtype(thing) {
  if (thing.default === undefined) {
    return ARG_TYPES[thing.type];
  } else {
    return choice(ARG_TYPES[thing.type], Undefined);
  }
}

function zipObject(vals, names) {
  const obj = {};
  vals.forEach((v, i) => {
    obj[names[i]] = v;
  });
  return obj;
}

function name(arg) {
  return arg.name;
}

const defs = require('../lib/defs');

function method(info) {
  const domain = sequence.apply(null, info.args.map(argtype));
  const names = info.args.map(name);
  return label(
    info.name,
    transform((fieldVals) => ({id: info.id, fields: zipObject(fieldVals, names)}), domain),
  );
}

function properties(info) {
  const types = info.args.map(argtype);
  types.unshift(ULongLong); // size
  const domain = sequence.apply(null, types);
  const names = info.args.map(name);
  return label(
    info.name,
    transform((fieldVals) => ({id: info.id, size: fieldVals[0], fields: zipObject(fieldVals.slice(1), names)}), domain),
  );
}

const methods = [];
const propertieses = [];

for (const k in defs) {
  if (k.substr(0, 10) === 'methodInfo') {
    methods.push(method(defs[k]));
    methods[defs[k].name] = method(defs[k]);
  } else if (k.substr(0, 14) === 'propertiesInfo') {
    propertieses.push(properties(defs[k]));
    propertieses[defs[k].name] = properties(defs[k]);
  }
}

module.exports = {
  Octet: Octet,
  ShortStr: ShortStr,
  LongStr: LongStr,
  UShort: UShort,
  ULong: ULong,
  ULongLong: ULongLong,
  Short: Short,
  Long: Long,
  LongLong: LongLong,
  Bit: Bit,
  Double: Double,
  Float: Float,
  Timestamp: Timestamp,
  Decimal: Decimal,
  UnsignedByte: UnsignedByte,
  UnsignedShort: UnsignedShort,
  UnsignedInt: UnsignedInt,
  FieldArray: FieldArray,
  FieldTable: FieldTable,

  methods: methods,
  properties: propertieses,
};

module.exports.rangeInt = rangeInt;
