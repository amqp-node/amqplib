var assert = require('assert');

var Frames = require('../lib/frame');
var HEARTBEAT = Frames.HEARTBEAT;
var Stream = require('stream');
var PassThrough = Stream.PassThrough ||
    require('readable-stream/passthrough');

var defs = require('../lib/defs');

// We'll need to supply a stream which we manipulate ourselves

function inputs() {
  // don't coalesce buffers, since that could mess up properties
  // (e.g., encoded frame size)
  return new PassThrough({objectMode: true});
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
    assert(frames.recvFrame() === HEARTBEAT);
    assert(!frames.recvFrame());
  });

  test('Parse partitioned', function() {
    var input = inputs();
    var frames = new Frames(input);
    input.write(HB.slice(0, 3));
    assert(!frames.recvFrame());
    input.write(HB.slice(3));
    assert(frames.recvFrame() === HEARTBEAT);
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
var sequence = claire.sequence;
var transform = claire.transform;
var sized = claire.sized;

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

var FRAME_MAX_MAX = 4096 * 4;
var FRAME_MAX_MIN = 4096;

var FrameMax = amqp.rangeInt('frame max',
                             FRAME_MAX_MIN,
                             FRAME_MAX_MAX);

var Body = sized(function(_n) {
  return Math.floor(Math.random() * FRAME_MAX_MAX);
}, repeat(amqp.Octet));

var Content = transform(function(args) {
  return {
    fields: args[0].fields,
    body: new Buffer(args[1])
  }
}, sequence(amqp.properties['BasicProperties'],
            Body));

var ContentTrace = label("content trace", repeat(Content));

suite("Content framing", function() {
  test("Adhere to frame max",
       forAll(ContentTrace, FrameMax).satisfy(function(t, max) {
         var input = inputs();
         var frames = new Frames(input);
         frames.frameMax = max;
         t.forEach(function(content) {
           frames.sendContent(0, defs.BasicProperties,
                              content.fields,
                              content.body);
         });
         var f, i = 0, largest = 0;
         while (f = input.read()) {
           i++;
           if (f.length > largest) largest = f.length;
           if (f.length > max) {
             return false;
           }
         }
         // The ratio of frames to 'contents' should always be >= 2
         // (one properties frame and at least one content frame); > 2
         // indicates fragmentation. The largest is always, of course <= frame max
         //console.log('Frames: %d; frames per message: %d; largest frame %d', i, i / t.length, largest);
         return true;
       }).asTest({times: 10}));
});
