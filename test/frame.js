var assert = require('assert');

var Frames = require('../lib/frame');
var Heartbeat = Frames.Heartbeat;
var Stream = require('stream');
var PassThrough = Stream.PassThrough ||
    require('readable-stream/passthrough');

var defs = require('../lib/defs');

// We'll need to supply a stream which we manipulate ourselves

function inputs() {
    return new PassThrough();
}

var HB = new Buffer([defs.constants.FRAME_HEARTBEAT,
                     0, 0, // channel 0
                     0, 0, 0, 0, // zero size
                     defs.constants.FRAME_END]);

suite("Explicit parsing", function() {
  
  test('Parse heartbeat', function() {
    var input = inputs();
    var frames = new Frames(input);
    input.write(HB);
    assert(frames.recvFrame() instanceof Heartbeat);
    assert(!frames.recvFrame());
  });

  test('Parse partitioned', function() {
    var input = inputs();
    var frames = new Frames(input);
    input.write(HB.slice(0, 3));
    assert(!frames.recvFrame());
    input.write(HB.slice(3));
    assert(frames.recvFrame() instanceof Heartbeat);
    assert(!frames.recvFrame());
  });
});

// Now for a bit more fun.

var amqp = require('./data');
var claire = require('claire');
var choice = claire.choice;
var forAll = claire.forAll;
var repeat = claire.repeat;
var label = claire.label;

var Trace = label('frame trace',
                  repeat(choice.apply(choice, amqp.methods)));

suite("Parsing", function() {

  function testPartitioning(partition) {
    return forAll(Trace).satisfy(function(t) {
      var bufs = [];
      var input = inputs();
      var frames = new Frames(input);
      var i = 0;
      frames.accept = function(f) {
        assert.deepEqual(f, t[i]);
        i++;
      };
      
      t.forEach(function(f) {
        f.channel = 0;
        bufs.push(defs.encodeMethod(f.id, 0, f.fields));
      });

      partition(bufs).forEach(input.write.bind(input));
      frames.run();
      return i === t.length;
    }).asTest({times: 20})
  };

  test("Parse trace of methods",
       testPartitioning(function(bufs) { return bufs; }));

  test("Parse concat'd methods",
       testPartitioning(function(bufs) {
         return [Buffer.concat(bufs)];
       }));

  test("Parse partitioned methods",
       testPartitioning(function(bufs) {
         var full = Buffer.concat(bufs);
         var onethird = Math.floor(full.length / 3);
         var twothirds = 2 * onethird;
         return [
           full.slice(0, onethird),
           full.slice(onethird, twothirds),
           full.slice(twothirds)
         ];
       }));
});
