// A safe size for the buffer to write into if we don't know how big
// the encoding is going to be.
var METHOD_BUFFER_SIZE = 2048;

var FS = require('fs');
var format = require('util').format;

var defs = require('./amqp-rabbitmq-0.9.1.json');

var out = process.stdout;

function printf() {
  out.write(format.apply(format, arguments), 'utf8');
}

function nl() { out.write('\n'); }
function println() { printf.apply(printf, arguments); nl(); }

var constants = {};
for (var i = 0, len = defs.constants.length; i < len; i++) {
  var cdef = defs.constants[i];
  constants[constantName(cdef)] = cdef.value;
}

function constantName(def) {
  return def.name.replace(/-/g, '_');
}

function methodName(clazz, method) {
  return initial(clazz.name) + method.name.split('-').map(initial).join('');
}

function propertyName(dashed) {
  var parts = dashed.split('-');
  return parts[0] + parts.slice(1).map(initial).join('');
}

function initial(part) {
  return part.charAt(0).toUpperCase() + part.substr(1);
}

function argument(a) {
  var type = a.type || domains[a.domain];
  var friendlyName = propertyName(a.name);
  return {type: type, name: friendlyName, default: a['default-value']};
}

var domains = {};
for (var i=0, len = defs.domains.length; i < len; i++) {
  var dom = defs.domains[i];
  domains[dom[0]] = dom[1];
}

var methods = {};
var propertieses = {};

for (var i = 0, len = defs.classes.length; i < len; i++) {
  var clazz = defs.classes[i];
  for (var j = 0, num = clazz.methods.length; j < num; j++) {
    var method = clazz.methods[j];
    var name = methodName(clazz, method);
    var info = 'methodInfo' + name;

    methods[name] = {
      id: methodId(clazz, method),
      name: name,
      clazz: clazz.name,
      args: method['arguments'].map(argument),
      isReply: method.answer,
      encoder: 'encode' + name,
      decoder: 'decode' + name,
      info: info
    };
  }
  if (clazz.properties && clazz.properties.length > 0) {
    var name = propertiesName(clazz);
    var props = clazz.properties;
    propertieses[name] = {
      id: clazz.id,
      name: name,
      encoder: 'encode' + name,
      decoder: 'decode' + name,
      info: 'propertiesInfo' + name,
      args: props.map(argument),
    };
  }
}

// OK let's get emitting

println('var codec = require("./codec");');
println('var encodeTable = codec.encodeTable;');
println('var decodeFields = codec.decodeFields;');
nl();

println('module.exports.constants = %s',
        JSON.stringify(constants));
nl();

println('module.exports.decode = function(id, buf) {');
println('switch (id) {');
for (var m in methods) {
  var method = methods[m];
  println('case %d: return %s(buf);', method.id, method.decoder);
}
for (var p in propertieses) {
  var props = propertieses[p];
  println('case %d: return %s(buf);', props.id,  props.decoder);
}
println('}}'); nl();

println('module.exports.encodeMethod =',
        'function(id, channel, fields) {');
println('switch (id) {');
for (var m in methods) {
  var method = methods[m];
  println('case %d: return %s(channel, fields);',
          method.id, method.encoder);
}
println('}}'); nl();

println('module.exports.encodeProperties ='
        , 'function(id, channel, size, fields) {');
println('switch (id) {');
for (var p in propertieses) {
  var props = propertieses[p];
  println('case %d: return %s(channel, size, fields);',
          props.id, props.encoder);
}
println('}}'); nl();

println('module.exports.info = function(id) {');
println('switch(id) {');
for (var m in methods) {
  var method = methods[m];
  println('case %d: return %s; ', method.id, method.info);
}
for (var p in propertieses) {
  var properties = propertieses[p];
  println('case %d: return %s', properties.id, properties.info);
}
println('}}'); nl();

for (var m in methods) {
  var method = methods[m];
  println('module.exports.%s = %d;', m, method.id);
  decoderFn(method); nl();
  encoderFn(method); nl();
  infoObj(method); nl();
}

for (var p in propertieses) {
  var properties = propertieses[p];
  println('module.exports.%s = %d;', p, properties.id);
  encodePropsFn(properties); nl();
  decodePropsFn(properties); nl();
  infoObj(properties); nl();
}

function methodId(clazz, method) {
  return (clazz.id << 16) + method.id;
}

function propertiesName(clazz) {
  return initial(clazz.name) + 'Properties';
}

function encoderFn(method) {
  var args = method['args'];
  println('function %s(channel, fields) {', method.encoder);
  println('var offset = 0, val = null, bits = 0, len;');

  var bufferSize = fixedSize(args);
  if (bufferSize === -1) bufferSize = METHOD_BUFFER_SIZE;
  println('var buffer = new Buffer(%d);', bufferSize);

  println('buffer[0] = %d;', constants.FRAME_METHOD);
  println('buffer.writeUInt16BE(channel, 1);');
  // skip size for now, we'll write it in when we know
  println('buffer.writeUInt32BE(%d, 7);', method.id);
  println('offset = 11;');

  var bitsInARow = 0;
  for (var i = 0, len = args.length; i < len; i++) {
    var a = args[i];
    var field = "fields['" + a.name + "']";

    println('val = %s;', field);

    if (a.default !== undefined) {
      var def = JSON.stringify(a.default);
      println('val = (val === undefined) ? %s : val;', def);
    }
    else {
      println('if (val === undefined) {');
      println('throw new Error("Missing value for %s");}', a.name);
    }

    // Flush any collected bits before doing a new field
    if (a.type != 'bit' && bitsInARow > 0) {
      bitsInARow = 0;
      println('buffer[offset] = bits; offset++; bits = 0;');
    }

    switch (a.type) {
    case 'octet':
      println('buffer.writeUInt8(val, offset); offset++;');
      break;
    case 'short':
      println('buffer.writeUInt16BE(val, offset); offset += 2;');
      break;
    case 'long':
      println('buffer.writeUInt32BE(val, offset); offset += 4;');
      break;
    case 'longlong':
    case 'timestamp':
      println('buffer.writeUInt64BE(val, offset); offset += 8;');
      break;
    case 'bit':
      println('if (val) bits += %d;', 1 << bitsInARow);
      if (bitsInARow === 7) { // I don't think this ever happens, but whatever
        println('buffer[offset] = bits; offset++; bits = 0;');
        bitsInARow = 0;
      }
      else bitsInARow++;
      break;
    case 'shortstr':
      println('len = Buffer.byteLength(val, "utf8");');
      println('buffer[offset] = len; offset++;');
      println('buffer.write(val, offset, "utf8"); offset += len;');
      break;
    case 'longstr':
      println('len = val.length;');
      println('buffer.writeUInt32BE(len, offset); offset += 4;');
      println('val.copy(buffer, offset); offset += len;');
      break;
    case 'table':
      println('offset += encodeTable(buffer, val, offset);');
      break;
    default: throw new Error("Unexpected argument type: " + a.type);
    }
  }

  // Flush any collected bits at the end
  if (bitsInARow > 0) {
    println('buffer[offset] = bits; offset++;');
  }
  
  println('buffer[offset] = %d;', constants.FRAME_END);
  // size does not include the frame header or frame end byte
  println('buffer.writeUInt32BE(offset - 7, 3);');

  if (bufferSize !== METHOD_BUFFER_SIZE) {
    println('return buffer;');
  }
  else {
    println('return buffer.slice(0, offset + 1);');
  }
  println('}');
}

function decoderFn(method) {
  var args = method.args;
  println('function %s(buffer) {', method.decoder);
  println('var fields = {}, offset = 0, val, len;');
  var bitsInARow = 0;

  for (var i=0, num=args.length; i < num; i++) {
    var a = args[i];
    var field = "fields['" + a.name + "']";

    // Flush any collected bits before doing a new field
    if (a.type != 'bit' && bitsInARow > 0) {
      bitsInARow = 0;
      println('offset++;');
    }

    switch (a.type) {
    case 'octet':
      println('val = buffer[offset]; offset++;');
      break;
    case 'short':
      println('val = buffer.readUInt16BE(offset); offset += 2;');
      break;
    case 'long':
      println('val = buffer.readUInt32BE(offset); offset += 4;');
      break;
    case 'longlong':
    case 'timestamp':
      println('val = buffer.readUInt64BE(offset); offset += 8;');
      break;
    case 'bit':
      var bit = 1 << bitsInARow;
      println('val = !!(buffer[offset] & %d);', bit);
      if (bitsInARow === 7) {
        println('offset++;');
        bitsInARow = 0;
      }
      else bitsInARow++;
      break;
    case 'longstr':
      println('len = buffer.readUInt32BE(offset); offset += 4;');
      println('val = buffer.slice(offset, offset + len);');
      println('offset += len;');
      break;
    case 'shortstr':
      println('len = buffer.readUInt8(offset); offset++;');
      println('val = buffer.toString("utf8", offset, offset + len);');
      println('offset += len;');
      break;
    case 'table':
      println('len = buffer.readUInt32BE(offset); offset += 4;');
      println('val = decodeFields(buffer.slice(offset, offset + len));');
      println('offset += len;');
      break;
    default:
      throw new TypeError("Unexpected type in argument list: " + a.type);
    }
    println('%s = val;', field);
  }
  println('return fields;');
  println('}');
}

function infoObj(thing) {
  var info = JSON.stringify({id: thing.id,
                             name: thing.name,
                             args: thing.args});
  println('var %s = module.exports.%s = %s;',
          thing.info, thing.info, info);
}

// The flags are laid out in groups of fifteen in a short (high to
// low bits), with a continuation bit (at 0) and another group
// following if there's more than fifteen. Presence and absence
// are conflated with true and false, for bit fields (i.e., if the
// flag for the field is set, it's true, otherwise false).
// 
// However, none of that is actually used in AMQP 0-9-1. The only
// instance of properties -- basic properties -- has 14 fields, none
// of them bits.

function flagAt(index) {
  return 1 << (15 - index);
}

function encodePropsFn(props) {
  println('function %s(channel, size, fields) {', props.encoder);
  println('var offset = 0, flags = 0, val, len;');
  println('var buffer = new Buffer(%d);', METHOD_BUFFER_SIZE);

  println('buffer[0] = %d', constants.FRAME_HEADER);
  println('buffer.writeUInt16BE(channel, 1);');
  // content class ID and 'weight' (== 0)
  println('buffer.writeUInt32BE(%d, 7);', props.id << 16);
  // skip frame size for now, we'll write it in when we know.

  // body size
  println('buffer.writeUInt64BE(size, 11);');

  println('flags = 0;');
  // we'll write the flags later too
  println('offset = 21;');
  
  for (var i=0, num=props.args.length; i < num; i++) {
    var p = argument(props.args[i]);
    var flag = flagAt(i);
    var field = "fields['" + p.name + "']";
    println('val = %s;', field);
    println('if (val !== undefined) {');
    if (p.type === 'bit') { // which none of them are ..
      println('if (val) flags += %d;', flag);
    }
    else {
      println('flags += %d;', flag);
      // %%% FIXME only slightly different to the method args encoding
      switch (p.type) {
      case 'octet':
        println('buffer.writeUInt8(val, offset); offset++;');
        break;
      case 'short':
        println('buffer.writeUInt16BE(val, offset); offset += 2;');
        break;
      case 'long':
        println('buffer.writeUInt32BE(val, offset); offset += 4;');
        break;
      case 'longlong':
      case 'timestamp':
        println('buffer.writeUInt64BE(val, offset); offset += 8;');
        break;
      case 'bit':
        println('if (val) bits += %d;', 1 << bitsInARow);
        if (bitsInARow === 7) { // I don't think this ever happens, but whatever
          println('buffer[offset] = bits; offset++; bits = 0;');
          bitsInARow = 0;
        }
        else bitsInARow++;
        break;
      case 'shortstr':
        println('len = Buffer.byteLength(val, "utf8");');
        println('buffer[offset] = len; offset++;');
        println('buffer.write(val, offset, "utf8"); offset += len;');
        break;
      case 'longstr':
        println('len = val.length;');
        println('buffer.writeUInt32BE(len, offset); offset += 4;');
        println('val.copy(buffer, offset); offset += len;');
        break;
      case 'table':
        println('offset += encodeTable(buffer, val, offset);');
        break;
      default: throw new Error("Unexpected argument type: " + p.type);
      }
    }
    println('}');
  }

  println('buffer[offset] = %d;', constants.FRAME_END);
  // size does not include the frame header or frame end byte
  println('buffer.writeUInt32BE(offset - 7, 3);');
  println('buffer.writeUInt16BE(flags, 19);');
  println('return buffer.slice(0, offset + 1);');
  println('}');
}

function decodePropsFn(props) {
  println('function %s(buffer) {', props.decoder);
  println('var fields = {}, flags, offset = 2, val, len;');

  println('flags = buffer.readUInt16BE(0);');

  for (var i=0, num=props.args.length; i < num; i++) {
    var p = argument(props.args[i]);
    var field = "fields['" + p.name + "']";

    println('if (flags & %d) {', flagAt(i));
    if (p.type === 'bit') {
      println('%d = true;', field);
    }
    else {
      switch (p.type) {
      case 'octet':
        println('val = buffer[offset]; offset++;');
        break;
      case 'short':
        println('val = buffer.readUInt16BE(offset); offset += 2;');
        break;
      case 'long':
        println('val = buffer.readUInt32BE(offset); offset += 4;');
        break;
      case 'longlong':
      case 'timestamp':
        println('val = buffer.readUInt64BE(offset); offset += 8;');
        break;
      case 'longstr':
        println('len = buffer.readUInt32BE(offset); offset += 4;');
        println('val = buffer.slice(offset, offset + len);');
        println('offset += len;');
        break;
      case 'shortstr':
        println('len = buffer.readUInt8(offset); offset++;');
        println('val = buffer.toString("utf8", offset, offset + len);');
        println('offset += len;');
        break;
      case 'table':
        println('len = buffer.readUInt32BE(offset); offset += 4;');
        println('val = decodeFields(buffer.slice(offset, offset + len));');
        println('offset += len;');
        break;
      default:
        throw new TypeError("Unexpected type in argument list: " + p.type);
      }
      println('%s = val;', field);
    }
    println('}');
  }
  println('return fields;');
  println('}');
}

function fixedSize(args) {
  var size = 12; // header, size, and frame end marker
  var bitsInARow = 0;
  for (var i = 0, len = args.length; i < len; i++) {
    if (args[i].type != 'bit') bitsInARow = 0;
    switch (args[i].type) {
    case 'octet': size++; break;
    case 'short': size += 2; break;
    case 'long': size += 4; break;
    case 'longlong':
    case 'timestamp': size += 8; break;
    case 'bit':
      if (bitsInARow % 8 === 0) {
        size++;
      }
      bitsInARow++;
      break;
    default: return -1;
    }
  }
  return size;
}
