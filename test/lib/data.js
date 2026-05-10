const { data: arb, transform, repeat, label, sequence, asGenerator, sized, recursive, choice, Undefined } = require('claire');
const defs = require('../../lib/defs');

// These aren't exported in claire/index. so I could have to reproduce them I guess.
function choose(a, b) {
  return Math.random() * (b - a) + a;
}

function chooseInt(a, b) {
  return Math.floor(choose(a, b));
}

function rangeInt(name, a, b) {
  return label(name, asGenerator((_) => chooseInt(a, b)));
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
    transform((n) => ({ '!': t, value: n }), underlying),
  );
}

// FIXME null, byte array, others?

const Octet = rangeInt('octet', 0, 255);
const ShortStr = label('shortstr', transform((s) => s.substr(0, 255), arb.Str));
const LongStr = label('longstr', transform((bytes) => Buffer.from(bytes), repeat(Octet)));
const UShort = rangeInt('short-uint', 0, 0xffff);
const ULong = rangeInt('long-uint', 0, 0xffffffff);
const ULongLong = rangeInt('longlong-uint', 0, Number.MAX_SAFE_INTEGER);
const Short = rangeInt('short-int', -0x8000, 0x7fff);
const Long = rangeInt('long-int', -0x80000000, 0x7fffffff);
const LongLong = rangeInt('longlong-int', Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
const Bit = label('bit', arb.Bool);
const Double = label('double', asGenerator(floatChooser(308)));
const Float = label('float', transform(toFloat32, floatChooser(38)));
const Timestamp = label('timestamp', transform((n) => ({ '!': 'timestamp', value: n }), ULongLong));
const Decimal = label('decimal', transform((args) => ({ '!': 'decimal', value: { places: args[1], digits: args[0] } }), sequence(arb.UInt, Octet)));
const UnsignedByte = label('unsignedbyte', transform((n) => ({ '!': 'unsignedbyte', value: n }), Octet));
const UnsignedShort = label('unsignedshort', transform((n) => ({ '!': 'unsignedshort', value: n }), UShort));
const UnsignedInt = label('unsignedint', transform((n) => ({ '!': 'unsignedint', value: n }), ULong));
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

const FieldArray = label('field-array',
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

const FieldTable = label('field-table',
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

function method(info) {
  const domain = sequence.apply(null, info.args.map(argtype));
  const names = info.args.map(name);
  return label(
    info.name,
    transform((fieldVals) => ({ id: info.id, fields: zipObject(fieldVals, names) }), domain),
  );
}

function properties(info) {
  const types = info.args.map(argtype);
  types.unshift(ULongLong); // size
  const domain = sequence.apply(null, types);
  const names = info.args.map(name);
  return label(info.name,
    transform((fieldVals) => ({ id: info.id, size: fieldVals[0], fields: zipObject(fieldVals.slice(1), names) }), domain),
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

const OPEN_OPTS = {
  // start-ok
  clientProperties: {},
  mechanism: 'PLAIN',
  response: Buffer.from(['', 'guest', 'guest'].join(String.fromCharCode(0))),
  locale: 'en_US',

  // tune-ok
  channelMax: 0,
  frameMax: 0,
  heartbeat: null,

  // open
  virtualHost: '/',
  capabilities: '',
  insist: 0,
};

module.exports = {
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
  UnsignedByte,
  UnsignedShort,
  UnsignedInt,
  FieldArray,
  FieldTable,
  methods,
  properties: propertieses,
  rangeInt,
  OPEN_OPTS,
};
