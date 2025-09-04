'use strict';

const assert = require('node:assert');
const connection = require('../lib/connection');
const Frames = connection.Connection;
const HEARTBEAT = require('../lib/frame').HEARTBEAT;
const Stream = require('node:stream');
const PassThrough = Stream.PassThrough;

const defs = require('../lib/defs');

// We'll need to supply a stream which we manipulate ourselves

function inputs() {
  // don't coalesce buffers, since that could mess up properties
  // (e.g., encoded frame size)
  return new PassThrough({objectMode: true});
}

const HB = Buffer.from([
  defs.constants.FRAME_HEARTBEAT,
  0,
  0, // channel 0
  0,
  0,
  0,
  0, // zero size
  defs.constants.FRAME_END,
]);

suite('Explicit parsing', function () {
  test('Parse heartbeat', function () {
    const input = inputs();
    const frames = new Frames(input);
    input.write(HB);
    assert(frames.recvFrame() === HEARTBEAT);
    assert(!frames.recvFrame());
  });

  test('Parse partitioned', function () {
    const input = inputs();
    const frames = new Frames(input);
    input.write(HB.subarray(0, 3));
    assert(!frames.recvFrame());
    input.write(HB.subarray(3));
    assert(frames.recvFrame() === HEARTBEAT);
    assert(!frames.recvFrame());
  });

  function testBogusFrame(name, bytes) {
    test(name, function (done) {
      const input = inputs();
      const frames = new Frames(input);
      frames.frameMax = 5; //for the max frame test
      input.write(Buffer.from(bytes));
      frames.step(function (err, _frame) {
        if (err != null) done();
        else done(new Error('Was a bogus frame!'));
      });
    });
  }

  testBogusFrame('Wrong sized frame', [
    defs.constants.FRAME_BODY,
    0,
    0,
    0,
    0,
    0,
    0, // zero length
    65, // but a byte!
    defs.constants.FRAME_END,
  ]);

  testBogusFrame('Unknown method frame', [
    defs.constants.FRAME_METHOD,
    0,
    0,
    0,
    0,
    0,
    4,
    0,
    0,
    0,
    0, // garbage ID
    defs.constants.FRAME_END,
  ]);
});

// Now for a bit more fun.

const amqp = require('./data');
const claire = require('claire');
const choice = claire.choice;
const forAll = claire.forAll;
const repeat = claire.repeat;
const label = claire.label;
const sequence = claire.sequence;
const transform = claire.transform;
const sized = claire.sized;

const assertEqualModuloDefaults = require('./codec').assertEqualModuloDefaults;

const Trace = label('frame trace', repeat(choice.apply(choice, amqp.methods)));

suite('Parsing', function () {
  function testPartitioning(partition) {
    return forAll(Trace)
      .satisfy(function (t) {
        const bufs = [];
        const input = inputs();
        const frames = new Frames(input);
        let i = 0,
          ex;
        frames.accept = function (f) {
          // A minor hack to make sure we get the assertion exception;
          // otherwise, it's just a test that we reached the line
          // incrementing `i` for each frame.
          try {
            assertEqualModuloDefaults(t[i], f.fields);
          } catch (e) {
            ex = e;
          }
          i++;
        };

        t.forEach(function (f) {
          f.channel = 0;
          bufs.push(defs.encodeMethod(f.id, 0, f.fields));
        });

        partition(bufs).forEach(function (chunk) {
          input.write(chunk);
        });
        frames.acceptLoop();
        if (ex) throw ex;
        return i === t.length;
      })
      .asTest({times: 20});
  }

  test(
    'Parse trace of methods',
    testPartitioning(function (bufs) {
      return bufs;
    }),
  );

  test(
    "Parse concat'd methods",
    testPartitioning(function (bufs) {
      return [Buffer.concat(bufs)];
    }),
  );

  test(
    'Parse partitioned methods',
    testPartitioning(function (bufs) {
      const full = Buffer.concat(bufs);
      const onethird = Math.floor(full.length / 3);
      const twothirds = 2 * onethird;
      return [full.subarray(0, onethird), full.subarray(onethird, twothirds), full.subarray(twothirds)];
    }),
  );
});

const FRAME_MAX_MAX = 4096 * 4;
const FRAME_MAX_MIN = 4096;

const FrameMax = amqp.rangeInt('frame max', FRAME_MAX_MIN, FRAME_MAX_MAX);

const Body = sized(function (_n) {
  return Math.floor(Math.random() * FRAME_MAX_MAX);
}, repeat(amqp.Octet));

const Content = transform(
  function (args) {
    return {
      method: args[0].fields,
      header: args[1].fields,
      body: Buffer.from(args[2]),
    };
  },
  sequence(amqp.methods['BasicDeliver'], amqp.properties['BasicProperties'], Body),
);

suite('Content framing', function () {
  test(
    'Adhere to frame max',
    forAll(Content, FrameMax)
      .satisfy(function (content, max) {
        const input = inputs();
        const frames = new Frames(input);
        frames.frameMax = max;
        frames.sendMessage(0, defs.BasicDeliver, content.method, defs.BasicProperties, content.header, content.body);
        let f,
          _i = 0,
          largest = 0;
        while ((f = input.read())) {
          _i++;
          if (f.length > largest) largest = f.length;
          if (f.length > max) {
            return false;
          }
        }
        // The ratio of frames to 'contents' should always be >= 2
        // (one properties frame and at least one content frame); > 2
        // indicates fragmentation. The largest is always, of course <= frame max
        //console.log('Frames: %d; frames per message: %d; largest frame %d', _i, _i / t.length, largest);
        return true;
      })
      .asTest(),
  );
});
