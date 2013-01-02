// A safe size for the buffer to write into if we don't know how big
// the encoding is going to be.
var METHOD_BUFFER_SIZE = 2048;

var FS = require('fs');

var defs = JSON.parse(FS.readFileSync('./amqp-rabbitmq-0.9.1.json'));

var out = process.stdout;

function nl() { out.write('\n'); }
function print(str) { out.write(str, 'utf8'); }
function println(str) { print(str); nl(); }
var indent = '    ';

println('var codec = require("./codec");');
println('var encodeTable = codec.encodeTable, encodeArray = codec.encodeArray;');
nl();

print('module.exports.constants = ');

var constants = {};
for (var i = 0, len = defs.constants.length; i < len; i++) {
    var cdef = defs.constants[i];
    constants[constantName(cdef)] = cdef.value;
}
println(JSON.stringify(constants, undefined, 2)); nl();

function constantName(def) {
    return def.name.replace(/-/g, '_');
}

function methodName(clazz, method) {
    return initial(clazz.name) + method.name.split('-').map(initial).join('');
}

function initial(part) {
    return part.charAt(0).toUpperCase() + part.substr(1);
}

var domains = {};
for (var i=0, len = defs.domains.length; i < len; i++) {
    var dom = defs.domains[i];
    domains[dom[0]] = dom[1];
}

var constructors = {};
var encoders = {};
for (var i = 0, len = defs.classes.length; i < len; i++) {
    var clazz = defs.classes[i];
    for (var j = 0, num = clazz.methods.length; j < num; j++) {
        var method = clazz.methods[j];
        var name = methodName(clazz, method);
        constructors[name] = constructorFn(clazz, method);
        encoders[name] = encoderFn(clazz, method);
        //decoders[name] = decoderBody(clazz, method);
    }
}

for (var m in constructors) {
    println(constructors[m]);
    println('module.exports.' + m + ' = ' + m + ';'); nl();
    println(m + '.prototype.encodeToFrame = ' + encoders[m]); nl();
}

function constructorFn(clazz, method) {
    return 'function ' + methodName(clazz, method) + '(fields) {' +
        ' this.fields = fields; ' +
        '}';
}

function encoderFn(clazz, method) {
    var id = (clazz.id << 16) + method.id;
    var lines = [];
    var args = method['arguments'];
    lines.push('function(channel) {');
    lines.push('var offset = 0, val = null, bits = 0, len;')

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
        var arg = args[i];
        var type = arg.type || domains[arg.domain];
        if (arg['default-value']) {
            var def = JSON.stringify(arg['default-value']);
            lines.push('val = this.fields[\'' + arg.name + '\'] || ' + def + ';');
        }
        else {
            lines.push('if (!this.fields.hasOwnProperty(\'' + arg.name + '\'))');
            lines.push(indent + 'throw new Exception("Missing value for ' + arg.name + '");');
            lines.push('val = this.fields[\'' + arg.name + '\'];');
        }

        // Flush any collected bits before doing a new field
        if (type != 'bit' && bitsInARow > 0) {
            bitsInARow = 0;
            lines.push('buffer[offset] = bits; offset++; bits = 0;');
        }

        switch (type) {
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
            lines.push('buffer.writeUInt32BE(len, offset); offset++;');
            lines.push('buffer.write(val, offset); offset += len;');
            break;
        case 'table':
            lines.push('offset += encodeTable(buffer, val, offset);');
            break;
        default: throw "Unexpected argument type: " + type;
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

function fixedSize(args) {
    var size = 8; // header and frame end marker
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
