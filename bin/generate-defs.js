// A safe size for the buffer to write into if we don't know how big
// the encoding is going to be.
var METHOD_BUFFER_SIZE = 2048;

var FS = require('fs');

var defs = require('./amqp-rabbitmq-0.9.1.json');

var out = process.stdout;

function nl() { out.write('\n'); }
function print(str) { out.write(str, 'utf8'); }
function println(str) { print(str); nl(); }
var indent = '    ';

println('var codec = require("./codec");');
println('var encodeTable = codec.encodeTable;');
println('var decodeFields = codec.decodeFields;');
nl();

var constants = {};
for (var i = 0, len = defs.constants.length; i < len; i++) {
    var cdef = defs.constants[i];
    constants[constantName(cdef)] = cdef.value;
}

print('module.exports.constants = ');
println(JSON.stringify(constants, undefined, 2)); nl();

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
  return {type: type, name: friendlyName};
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
        methods[name] = {
            id: methodId(clazz, method),
            args: method['arguments'].map(argument),
            isReply: method.answer,
            constructor: constructorFn(name, clazz, method),
            encoder: encoderFn(name, clazz, method),
            decoder: decoderFn(name, clazz, method)
        };
    }
    if (clazz.properties && clazz.properties.length > 0) {
        var name = propertiesName(clazz);
        var props = clazz.properties;
        propertieses[name] = {
            constructor: propsConstructorFn(name, clazz, props),
            id: clazz.id,
            encoder: encodePropsFn(name, clazz, props),
            decoder: decodePropsFn(name, clazz, props),
        };
    }
}

for (var m in methods) {
    var method = methods[m];
    println(method.constructor);
    println(m + '.args = ' + JSON.stringify(method.args, undefined, 2) + ';'); nl();
    println(m + '.prototype.id = ' + m + '.id = ' + method.id + ';');
    if (method.isReply)
      println(m + '.prototype.isReply = true;'), nl();
    println(m + '.prototype.encodeToFrame = ' + method.encoder); nl();
    println(m + '.fromBuffer = ' + method.decoder);
    println('module.exports.' + m + ' = ' + m + ';'); nl();
}

for (var p in propertieses) {
    var properties = propertieses[p];
    println(properties.constructor);
    println(p + '.prototype.id = ' + properties.id + ';');
    println(p + '.prototype.encodeToFrame = ' + properties.encoder); nl();
    println(p + '.fromBuffer = ' + properties.decoder);
    println('module.exports.' + p + ' = ' + p + ';'); nl();
}

println('module.exports.methodFor = function(id) {');
println(indent + 'switch (id) {');
for (var m in methods) {
    println(indent + 'case ' + methods[m].id + ': return ' + m + ';');
}
println(indent + '}');
println('}');

println('module.exports.propertiesFor = function(id) {');
println(indent + 'switch (id) {');
for (var m in propertieses) {
    println(indent + 'case ' + propertieses[m].id + ': return ' + m + ';');
}
println(indent + '}');
println('}');


function methodId(clazz, method) {
    return (clazz.id << 16) + method.id;
}

function propertiesName(clazz) {
    return initial(clazz.name) + 'Properties';
}

function constructorFn(name, clazz, method) {
    return 'function ' + name + '(fields) {' +
        ' this.fields = fields; ' +
        '}';
}

function encoderFn(name, clazz, method) {
    var id = methodId(clazz, method);
    var lines = [];
    var args = method['arguments'];
    lines.push('function(channel) {');
    lines.push('var offset = 0, val = null, bits = 0, len;');

    var fixed = fixedSize(args);
    if (fixed > 0) {
        lines.push('var buffer = new Buffer(' + fixed + ');');
    }
    else {
        lines.push('var buffer = new Buffer(' + METHOD_BUFFER_SIZE + ');');
    }
    lines.push('buffer[0] = ' + constants.FRAME_METHOD + ';');
    lines.push('buffer.writeUInt16BE(channel, 1);');
    // skip size for now, we'll write it in when we know
    lines.push('buffer.writeUInt32BE(' + id + ', 7);');
    lines.push('offset = 11;');

    var bitsInARow = 0;
    for (var i = 0, len = args.length; i < len; i++) {
        var arg = args[i], a = argument(arg);
        var field = "this.fields['" + a.name + "']";
        if (arg['default-value']) {
            var def = JSON.stringify(arg['default-value']);
            lines.push('val = ' + field + '; val = (val === undefined) ? ' + def + ' : val;');
        }
        else {
            lines.push('if (!this.fields.hasOwnProperty(\'' +
                       a.name + '\'))');
            lines.push(indent + 'throw new Error("Missing value for ' +
                       a.name + '");');
            lines.push('val = ' + field + ';');
        }

        // Flush any collected bits before doing a new field
        if (a.type != 'bit' && bitsInARow > 0) {
            bitsInARow = 0;
            lines.push('buffer[offset] = bits; offset++; bits = 0;');
        }

        switch (a.type) {
        case 'octet':
            lines.push('buffer.writeUInt8(val, offset); offset++;');
            break;
        case 'short':
            lines.push('buffer.writeUInt16BE(val, offset); offset += 2;');
            break;
        case 'long':
            lines.push('buffer.writeUInt32BE(val, offset); offset += 4;');
            break;
        case 'longlong':
        case 'timestamp':
            lines.push('buffer.writeUInt64BE(val, offset); offset += 8;');
            break;
        case 'bit':
            lines.push('if (val) bits += ' + (1 << bitsInARow) + ';');
            if (bitsInARow === 7) { // I don't think this ever happens, but whatever
                lines.push('buffer[offset] = bits; offset++; bits = 0;');
                bitsInARow = 0;
            }
            else bitsInARow++;
            break;
        case 'shortstr':
            lines.push('len = Buffer.byteLength(val, "utf8");');
            lines.push('buffer[offset] = len; offset++;');
            lines.push('buffer.write(val, offset, "utf8"); offset += len;');
            break;
        case 'longstr':
            lines.push('len = val.length;');
            lines.push('buffer.writeUInt32BE(len, offset); offset += 4;');
            lines.push('val.copy(buffer, offset); offset += len;');
            break;
        case 'table':
            lines.push('offset += encodeTable(buffer, val, offset);');
            break;
        default: throw "Unexpected argument type: " + a.type;
        }

    }

    // Flush any collected bits at the end
    if (bitsInARow > 0) {
        lines.push('buffer[offset] = bits; offset++;');
    }
    
    lines.push('buffer[offset] = ' + constants.FRAME_END +'; ');
    // size does not include the frame header or frame end byte
    lines.push('buffer.writeUInt32BE(offset - 7, 3);');

    if (fixed > 0) {
        lines.push('return buffer;');
    }
    else {
        lines.push('return buffer.slice(0, offset + 1);');
    }
    return lines.join('\n' + indent) + '\n}';
}

function decoderFn(name, clazz, method) {
    var name = methodName(clazz, method);
    var lines = [];
    var args = method['arguments'];
    lines.push('function(buffer) {');
    lines.push('var fields = {}, offset = 0, val, len;');
    var bitsInARow = 0;

    for (var i=0, num=args.length; i < num; i++) {
        var a = argument(args[i]);
        var field = "fields['" + a.name + "']";

        // Flush any collected bits before doing a new field
        if (a.type != 'bit' && bitsInARow > 0) {
            bitsInARow = 0;
            lines.push('offset++;');
        }

        switch (a.type) {
        case 'octet':
            lines.push('val = buffer[offset]; offset++;');
            break;
        case 'short':
            lines.push('val = buffer.readUInt16BE(offset); offset += 2;');
            break;
        case 'long':
            lines.push('val = buffer.readUInt32BE(offset); offset += 4;');
            break;
        case 'longlong':
            lines.push('val = buffer.readUInt64BE(offset); offset += 8;');
            break;
        case 'timestamp':
            lines.push('val = buffer.readUInt64BE(offset); offset += 8;');
            break;
        case 'bit':
            var bit = 1 << bitsInARow;
            lines.push('val = !!(buffer[offset] & ' + bit + ');');
            if (bitsInARow === 7) {
                lines.push('offset++;');
                bitsInARow = 0;
            }
            else bitsInARow++;
            break;
        case 'longstr':
            lines.push('len = buffer.readUInt32BE(offset); offset += 4;');
            lines.push('val = buffer.slice(offset, offset + len);');
            lines.push('offset += len;');
            break;
        case 'shortstr':
            lines.push('len = buffer.readUInt8(offset); offset++;');
            lines.push('val = buffer.toString("utf8", offset, offset + len);');
            lines.push('offset += len;');
            break;
        case 'table':
            lines.push('len = buffer.readUInt32BE(offset); offset += 4;');
            lines.push('val = decodeFields(buffer.slice(offset, offset + len));');
            lines.push('offset += len;');
            break;
        default:
            throw new TypeError("Unexpected type in argument list: " + a.type);
        }
        lines.push(field + ' = val;');
    }
    lines.push('return new ' + name + '(fields);');
    return lines.join('\n' + indent) + '\n}';
}

function propsConstructorFn(name, clazz, props) {
    return 'function ' + name + '(fields) { this.fields = fields; }';
}

// the flags are laid out in groups of fifteen in a short (high to
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

function encodePropsFn(name, clazz, props) {
    var lines = [];
    lines.push('function(channel, size) {');
    lines.push('var offset = 0; flags = 0, fields = this.fields;');
    lines.push('var buffer = new Buffer(' + METHOD_BUFFER_SIZE + ');');

    lines.push('buffer[0] = ' + constants.FRAME_HEADER + ';');
    lines.push('buffer.writeUInt16BE(channel, 1);');
    // content class ID and 'weight' (== 0)
    lines.push('buffer.writeUInt32BE(' + (clazz.id << 16) + ', 7);');
    // skip size for now, we'll write it in when we know.
    // body size
    lines.push('buffer.writeUInt64BE(size, 11);');

    lines.push('flags = 0;');
    // we'll write the flags later too
    lines.push('offset = 21;');
    
    for (var i=0, num=props.length; i < num; i++) {
        var p = argument(props[i]);
        var flag = flagAt(i);
        var field = "this.fields['" + p.name + "']";
        lines.push('if (this.fields.hasOwnProperty("' +
                   p.name + '")) {');
        lines.push(indent + 'val = ' + field + ';');
        if (p.type === 'bit') { // which none of them are ..
            lines.push(indent + 'if (val) flags += ' + flag + ';');
        }
        else {
            lines.push('flags += ' + flag + ';');
            // %%% FIXME only slightly different to the method args encoding
            switch (p.type) {
            case 'octet':
                lines.push('buffer.writeUInt8(val, offset); offset++;');
                break;
            case 'short':
                lines.push('buffer.writeUInt16BE(val, offset); offset += 2;');
                break;
            case 'long':
                lines.push('buffer.writeUInt32BE(val, offset); offset += 4;');
                break;
            case 'longlong':
            case 'timestamp':
                lines.push('buffer.writeUInt64BE(val, offset); offset += 8;');
                break;
            case 'bit':
                lines.push('if (val) bits += ' + (1 << bitsInARow) + ';');
                if (bitsInARow === 7) { // I don't think this ever happens, but whatever
                    lines.push('buffer[offset] = bits; offset++; bits = 0;');
                    bitsInARow = 0;
                }
                else bitsInARow++;
                break;
            case 'shortstr':
                lines.push('len = Buffer.byteLength(val, "utf8");');
                lines.push('buffer[offset] = len; offset++;');
                lines.push('buffer.write(val, offset, "utf8"); offset += len;');
                break;
            case 'longstr':
                lines.push('len = val.length;');
                lines.push('buffer.writeUInt32BE(len, offset); offset += 4;');
                lines.push('val.copy(buffer, offset); offset += len;');
                break;
            case 'table':
                lines.push('offset += encodeTable(buffer, val, offset);');
                break;
            default: throw "Unexpected argument type: " + p.type;
            }
        }
        lines.push('}');
    }

    lines.push('buffer[offset] = ' + constants.FRAME_END +'; ');
    // size does not include the frame header or frame end byte
    lines.push('buffer.writeUInt32BE(offset - 7, 3);');
    lines.push('buffer.writeUInt16BE(flags, 19);');
    lines.push('return buffer.slice(0, offset + 1);');
    return lines.join('\n' + indent) + '\n}';
}

function decodePropsFn(name, clazz, props) {
    var lines = [];
    lines.push('function(buffer) {');
    lines.push('var fields = {}, flags, offset = 2, val, len;');

    lines.push('flags = buffer.readUInt16BE(0);');

    for (var i=0, num=props.length; i < num; i++) {
        var p = argument(props[i]);
        var field = "fields['" + p.name + "']";

        lines.push('if (flags & ' + flagAt(i) + ') {');
        if (p.type === 'bit') {
            lines.push(field + ' = true;');
        }
        else {
            switch (p.type) {
            case 'octet':
                lines.push('val = buffer[offset]; offset++;');
                break;
            case 'short':
                lines.push('val = buffer.readUInt16BE(offset); offset += 2;');
                break;
            case 'long':
                lines.push('val = buffer.readUInt32BE(offset); offset += 4;');
                break;
            case 'longlong':
                lines.push('val = buffer.readUInt64BE(offset); offset += 8;');
                break;
            case 'timestamp':
                lines.push('val = buffer.readUInt64BE(offset); offset += 8;');
                break;
            case 'longstr':
                lines.push('len = buffer.readUInt32BE(offset); offset += 4;');
                lines.push('val = buffer.slice(offset, offset + len);');
                lines.push('offset += len;');
                break;
            case 'shortstr':
                lines.push('len = buffer.readUInt8(offset); offset++;');
                lines.push('val = buffer.toString("utf8", offset, offset + len);');
                lines.push('offset += len;');
                break;
            case 'table':
                lines.push('len = buffer.readUInt32BE(offset); offset += 4;');
                lines.push('val = decodeFields(buffer.slice(offset, offset + len));');
                lines.push('offset += len;');
                break;
            default:
                throw new TypeError("Unexpected type in argument list: " + p.type);
            }
            lines.push(field + ' = val;');
        }
        lines.push('}');
    }
    lines.push('return new ' + name + '(fields);');
    return lines.join('\n' + indent) + '\n}';
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
