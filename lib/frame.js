// The river sweeps through
// Silt and twigs, gravel and leaves
// Driving the wheel on


/*
Frame format:

0      1         3             7                size+7 size+8
+------+---------+-------------+ +------------+ +-----------+
| type | channel | size        | | payload    | | frame-end |
+------+---------+-------------+ +------------+ +-----------+
 octet   short     long            size octets    octet

In general I want to know those first three things straight away, so I
can discard frames early.

*/

var constants = require('./defs').constants;
var Bits = require('bitsyntax');
var FRAME_OVERHEAD = 8;

/*

Wrap a byte stream with methods for writing and receiving frames.

*/

function Frames(stream) {
    this.stream = stream;
    this.frameMax = constants.FRAME_MIN_SIZE;
}


var F = Frames.prototype;

// low-level API

F.sendMethod = function(channel, method) {
    var frame = method.encodeToFrame(channel);
    return this.stream.write(frame);
};

F.sendContent = function(channel, method, header, body) {
    var writeResult = true;
    var methodFrame = method.encodeToFrame(channel);
    var headerFrame = header.encodeToFrame(channel);
    // I'll send the headers regardless
    this.stream.write(methodFrame);
    writeResult = this.stream.write(headerFrame);

    var maxBody = this.frameMax - FRAME_OVERHEAD;
    for (var i = 0; i < body.length; i += maxBody) {
        var end = i + maxBody;
        var slice = (end > body.length) ? body.slice(i) : body.slice(i, end);
        var bodyFrame = makeBodyFrame(channel, slice);
        writeResult = this.stream.write(bodyFrame);
    }
    return writeResult;
};

var bodyPattern = Bits.constructor('type:8, channel:16, size:32, payload/binary, end:8');
function makeBodyFrame(channel, payload) {
    return bodyPattern({type: constants.FRAME_BODY, end: constants.FRAME_END,
                        channel: channel, size: payload.length, payload: payload});
}

module.exports.Frames = Frames;
