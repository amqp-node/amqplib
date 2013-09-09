// Multiplexed streams

// Muxing: Accept writes from a number of streams, and interleave them
// fairly.
//
// A muxer is a readable stream into which other readable streams may
// be piped; it then provides the regular readable stream interface,
// yielding chunks from the source streams, interleaved.

var inherits = require('util').inherits;
var assert = require('assert');

function Mux(into) {
  this.newStreams = [];
  this.oldStreams = [];
  this.blocked = false;
  this.scheduledRead = false;

  this.out = into;
  var self = this;
  into.on('drain', function() {
    self.blocked = false;
    self._readIncoming();
  });
}

// There are 2 states we can be in:

// - waiting for outbound capacity, which will be signalled by _read
//   being called

// - no packets to send, waiting for an inbound buffer to have
//   packets, which will be signalled by a 'readable' event

// If we write all packets available whenever there is outbound
// capacity, we will either run out of outbound capacity (`#push`
// returns false), or run out of packets (all calls to inbound.read()
// have returned null).

Mux.prototype._readIncoming = function() {
//  console.log('_read');

  // We may be sent here speculatively, if an incoming stream has
  // become readable
  if (this.blocked) return;

  var self = this;
  var accepting = true;
  var out = this.out;

  // Try to read a chunk from each stream in turn, until all streams
  // are empty, or we exhaust our ability to accept chunks.
  function roundrobin(streams) {
    var s; while (accepting && (s = streams.shift())) {
      var chunk = s.read();
      if (chunk !== null) {
        accepting = out.write(chunk);
        streams.push(s);
      }
    }
  }

  roundrobin(this.newStreams);

  // Either we exhausted the new queues, or we ran out of capacity. If
  // we ran out of capacity, all the remaining new streams (i.e.,
  // those with packets left) become old queues.

  if (accepting) { // all new queues are exhausted, write as many as
                   // we can from the old streams
    assert.equal(0, this.newStreams.length);
    roundrobin(this.oldStreams);
  }
  else { // ran out of room
    assert(this.newStreams.length > 0, "Expect some new streams to remain");
    this.oldStreams = this.oldStreams.concat(this.newStreams);
    this.newStreams = [];
  }
  // We may have exhausted all the old queues, or run out of room;
  // either way, all we need to do is record whether we have capacity
  // or not, so any speculative reads will know
  this.blocked = !accepting;
};

Mux.prototype._scheduleRead = function() {
  var self = this;
  
  if (!self.scheduledRead) {
    setImmediate(function() {
//      console.warn('scheduling read');
      self.scheduledRead = false;
      self._readIncoming();
    });
    self.scheduledRead = true;
  }
};

Mux.prototype.pipeFrom = function(readable) {
//  console.warn('pipeFrom');
  var self = this;

  function enqueue() {
    self.newStreams.push(readable);
    self._scheduleRead();
  }
  function cleanup() {
    readable.removeListener('readable', enqueue);
  }

  readable.on('readable', enqueue);
  readable.once('unpipeFrom', function(dest) {
    if (dest === self) cleanup();
  });
  readable.once('end', cleanup);
  enqueue();
};

Mux.prototype.unpipeFrom = function(readable) {
  readable.emit('unpipeFrom', this);
};

module.exports.Mux = Mux;
