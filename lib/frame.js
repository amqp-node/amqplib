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

A connection is a duplex frame-stream. We can translate flow control
on byte buffers to flow control on frames.

I want to support the pipe protocol in both directions; that is, you
ought to be able to pipe frames into a frame stream as well as out of
it. I must also deal with the flow control of the socket we're writing
to and reading from; in a sense the frame stream is mediating three
ways between a frame producer, a frame consumer, and the underlying
socket.

frame-max, which ought to be enforced here, brings trouble: I don't
want it to close the underlying socket since there's still the close
frame to send on it.

*/

function FrameStream(socket /*. options */) {
    this.stream = socket;
    this.paused = false;
    stream.writeBuffer = [];
    this.readable = this.writable = true;
    this.start();
}

var proto = FrameStream.prototype = new (require('stream'));

// == Pipe protocol

// If we've piped this into a stream, and `write(..)` on that stream
// returns false, we'll have `pause()` called.
proto.pause = function() {
    this.paused = true;
};

// If we're piping to a stream, we've been paused, and the downstream
// emits 'drain', we'll have `resume()` called.
proto.resume = function() {
    var buffer = this.writeBuffer, go = true;
    while (buffer.length > 0 && go) {
        var frame = buffer.shift();
        go = this.writeFrame(frame);
    }
    this.paused = !go;
    if (go) this.emit('drain');
};

// == Stream API

proto.write = function(frame) {
    if (!this.writable) {
        
    }
    var ok = this.writeFrame(frame);
    this.paused = !ok;
    return ok;
};

proto.end = function(frame) {
    this.writable = false;
    if (frame) this.writeFrame(frame);
};

proto.destroy = function() {
    this.writable = this.readable = false;
    this.stream = null;
    this.remainder = null;
    this.writeBuffer = null;
    this.emit('close');
}

proto.destroySoon = function() {
    if (this.writeBuffer.length === 0) {
        this.destroy();
    }
    // Presumably we didn't already write everything because we're
    // paused.
    else if (this.paused) {
        this.once('drain', function() {
            this.destroySoon();
        });
    }
    // That's odd. Stuff to write but not paused. Force writing the
    // buffer out to reset pause and try again.
    else {
        this.resume();
        this.destroySoon();
    }
}

// == Internal API

var BITS = require('bitsyntax');

var encodeFrame =
    BITS.constructor('type:8, channel:16, size:32, payload/binary, 206');;
// %% If we use iolists, this might be interrupted midway through.
proto.writeFrame = function(frame) {
    var bytes = encodeFrame(frame);
    return this.stream.write(bytes);
};

var decodeFrame =
    BITS.compile('type:8, channel:16, size:32,' +
                 'payload:size/binary, end/8, rest/binary');

proto.start = function() {
    var self = this;
    self.remainder = null;

    function decodeAll(incoming) {
        var left = catBuffers(self.remainder, incoming);
        var all = [];
        while (left.length > 0) {
            var f = decodeFrame(left);
            if (f.end !== FRAME_END) {
                self.error("Incorrect frame end byte " + f.end);
            }
            if (f) {
                left = f.rest;
                delete f.rest; // or just cons a new obj?
                delete f.end;
                all.push(f);
            }
            else {
                break;
            }
        }
        self.remainder = left;
        return all;
    }

    function ondata(incoming) {
        var frames = decodeAll(incoming);
        // %% incoming = null;
        frames.forEach(function(frame) {
            self.emit('data', frame);
        });
    }

    function onend() {
        self.readable = false;
        self.emit('end');
    }

    var stream = this.stream;
    stream.on('data', ondata);
    stream.on('end', onend);
    stream.on('error', function(err) { self.error(err); });
};

proto.error = function(err) {
    this.readable = this.writable = false;
    this.emit('error', err);
    // %% do something with the stream?
};
