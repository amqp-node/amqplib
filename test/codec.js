'use strict';

var codec = require('../lib/codec');
var defs = require('../lib/defs');
var assert = require('assert');
var ints = require('buffer-more-ints');

var C = require('claire');
var forAll = C.forAll;

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
     [5,102,108,111,97,116,102,61,204,204,205]],
];

function bufferToArray(b) {
    return Array.prototype.slice.call(b);
}

suite("Explicit encodings", function() {

  testCases.forEach(function(tc) {
    var name = tc[0], val = tc[1], expect = tc[2];
    test(name, function() {
      var buffer = new Buffer(1000);
      var size = codec.encodeTable(buffer, val, 0);
      var result = buffer.slice(4, size);
      assert.deepEqual(expect, bufferToArray(result));
    });
  });
});

// Whole frames

var amqp = require('./data');

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

suite("Roundtrip values", function() {
  [
    amqp.Octet,
    amqp.ShortStr,
    amqp.LongStr,
    amqp.UShort,
    amqp.ULong,
    amqp.ULongLong,
    amqp.UShort,
    amqp.Short,
    amqp.Long,
    amqp.Bit,
    amqp.Decimal,
    amqp.Timestamp,
    amqp.Double,
    amqp.Float,
    amqp.FieldArray,
    amqp.FieldTable
  ].forEach(function(T) {
    test(T.toString() + ' roundtrip', roundtrips(T).asTest());
  });
});

// Asserts that the decoded fields are equal to the original fields,
// or equal to a default where absent in the original. The defaults
// depend on the type of method or properties.
//
// This works slightly different for methods and properties: for
// methods, each field must have a value, so the default is
// substituted for undefined values when encoding; for properties,
// fields may be absent in the encoded value, so a default is
// substituted for missing fields when decoding. The effect is the
// same so far as these tests are concerned.
function assertEqualModuloDefaults(original, decodedFields) {
  var args = defs.info(original.id).args;
  for (var i=0; i < args.length; i++) {
    var arg = args[i];
    var originalValue = original.fields[arg.name];
    var decodedValue = decodedFields[arg.name];
    try {
      if (originalValue === undefined) {
        // longstr gets special treatment here, since the defaults are
        // given as strings rather than buffers, but the decoded values
        // will be buffers.
        assert.deepEqual((arg.type === 'longstr') ?
                         new Buffer(arg.default) : arg.default,
                         decodedValue);
      }
      else {
        assert.deepEqual(originalValue, decodedValue);
      }
    }
    catch (assertionErr) {
      var methodOrProps = defs.info(original.id).name;
      assertionErr.message += ' (frame ' + methodOrProps +
        ' field ' + arg.name + ')';
      throw assertionErr;
    }
  }
  // %%% TODO make sure there's no surplus fields
  return true;
}

// This is handy for elsewhere
module.exports.assertEqualModuloDefaults = assertEqualModuloDefaults;

function roundtripMethod(Method) {
  return forAll(Method).satisfy(function(method) {
    var buf = defs.encodeMethod(method.id, 0, method.fields);
    // FIXME depends on framing, ugh
    var fs1 = defs.decode(method.id, buf.slice(11, buf.length));
    assertEqualModuloDefaults(method, fs1);
    return true;
  });
}

function roundtripProperties(Properties) {
  return forAll(Properties).satisfy(function(properties) {
    var buf = defs.encodeProperties(properties.id, 0, properties.size,
                                    properties.fields);
    // FIXME depends on framing, ugh
    var fs1 = defs.decode(properties.id, buf.slice(19, buf.length));
    assert.equal(properties.size, ints.readUInt64BE(buf, 11));
    assertEqualModuloDefaults(properties, fs1);
    return true;
  });
}

suite("Roundtrip methods", function() {
  amqp.methods.forEach(function(Method) {
    test(Method.toString() + ' roundtrip',
         roundtripMethod(Method).asTest());
  });
});

suite("Roundtrip properties", function() {
  amqp.properties.forEach(function(Properties) {
    test(Properties.toString() + ' roundtrip',
         roundtripProperties(Properties).asTest());
  });
});
