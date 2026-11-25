const { describe, it } = require('node:test');
const assert = require('node:assert');
const connection = require('../lib/connection');
const Frames = connection.Connection;
const HEARTBEAT = require('../lib/frame').HEARTBEAT;
const parseFrame = require('../lib/frame').parseFrame;
const makeBodyFrame = require('../lib/frame').makeBodyFrame;
const { UnparsedBytes, storageBytesFor } = require('../lib/frame');
const Stream = require('node:stream');
const PassThrough = Stream.PassThrough;
const { choice, forAll, repeat, label, sequence, transform, sized } = require('claire');
const amqp = require('./lib/data');
const assertEqualModuloDefaults = require('./lib/util').assertEqualModuloDefaults;
const defs = require('../lib/defs');

// We'll need to supply a stream which we manipulate ourselves
function inputs() {
  // don't coalesce buffers, since that could mess up properties (e.g., encoded frame size)
  return new PassThrough({ objectMode: true });
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

describe('Frame', () => {

  describe('Explicit parsing', () => {
    it('Parse heartbeat', () => {
      const input = inputs();
      const frames = new Frames(input);
      input.write(HB);
      assert.ok(frames.recvFrame() === HEARTBEAT);
      assert.ok(!frames.recvFrame());
    });

    it('Parse partitioned', () => {
      const input = inputs();
      const frames = new Frames(input);
      input.write(HB.subarray(0, 3));
      assert.ok(!frames.recvFrame());
      input.write(HB.subarray(3));
      assert.ok(frames.recvFrame() === HEARTBEAT);
      assert.ok(!frames.recvFrame());
    });

    function testBogusFrame(name, bytes) {
      it(name, (_t, done) => {
        const input = inputs();
        const frames = new Frames(input);
        input.write(Buffer.from(bytes));
        frames.step((err, _frame) => {
          if (err != null) done();
          else assert.fail('Was a bogus frame!');
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

  describe('Frame size limit', () => {
    const HUGE_HEADER = Buffer.from([defs.constants.FRAME_METHOD, 0, 0, 0xff, 0xff, 0xff, 0xf0]);

    it('refuses a frame larger than the limit from the header alone', () => {
      assert.throws(() => parseFrame(HUGE_HEADER, 4096), /Frame size 4294967280 exceeds maxFrameSize 4096/);
    });

    it('waits for the rest of a frame within the limit', () => {
      const header = Buffer.from([defs.constants.FRAME_METHOD, 0, 0, 0, 0, 0, 10]);
      assert.strictEqual(parseFrame(header, 4096), false);
    });

    it('treats a limit of 0 as no limit', () => {
      assert.strictEqual(parseFrame(HUGE_HEADER, 0), false);
    });

    it('applies no limit when none is given', () => {
      assert.strictEqual(parseFrame(HUGE_HEADER), false);
    });

    it('accepts a size exactly equal to the limit', () => {
      const header = Buffer.from([defs.constants.FRAME_METHOD, 0, 0, 0, 0, 0x10, 0x00]);
      assert.strictEqual(parseFrame(header, 4096), false);
    });

    it('accepts a frame larger than frameMax but within maxFrameSize', () => {
      const input = inputs();
      const frames = new Frames(input);
      frames.frameMax = 4096;
      const big = makeBodyFrame(1, Buffer.alloc(100 * 1024, 0x41));
      input.write(big);
      const f = frames.recvFrame();
      assert.ok(f, 'frame should be accepted');
      assert.strictEqual(f.content.length, 100 * 1024);
    });
  });

  describe('Frames that arrive in pieces', () => {
    function body(channel, content) {
      return makeBodyFrame(channel, content);
    }

    function patterned(length, seed) {
      const content = Buffer.alloc(length);
      for (let i = 0; i < length; i++) content[i] = (i * 7 + seed) % 251;
      return content;
    }

    function cut(bytes, size) {
      const pieces = [];
      for (let offset = 0; offset < bytes.length; offset += size) pieces.push(bytes.subarray(offset, offset + size));
      return pieces;
    }

    function receiver() {
      const input = inputs();
      const connection = new Frames(input);
      return (pieces) => {
        const received = [];
        for (const piece of pieces) {
          input.write(piece);
          for (let frame = connection.recvFrame(); frame; frame = connection.recvFrame()) received.push(frame);
        }
        return received;
      };
    }

    function countingBytesCopied(task) {
      const concat = Buffer.concat;
      const copy = Buffer.prototype.copy;
      let copied = 0;
      Buffer.concat = (list, length) => {
        const joined = concat(list, length);
        copied += joined.length;
        return joined;
      };
      Buffer.prototype.copy = function (...args) {
        const count = copy.apply(this, args);
        copied += count;
        return count;
      };
      try {
        return { result: task(), copied };
      } finally {
        Buffer.concat = concat;
        Buffer.prototype.copy = copy;
      }
    }

    it('copies a frame that arrives in many reads a bounded number of times', () => {
      const content = patterned(1024 * 1024, 1);
      const frame = body(1, content);
      const receive = receiver();
      let received;
      const copied = countingBytesCopied(() => {
        received = receive(cut(frame, 1024));
      }).copied;
      assert.strictEqual(received.length, 1);
      assert.ok(received[0].content.equals(content));
      assert.ok(copied < 3 * frame.length, `copied ${copied} bytes to receive a frame of ${frame.length}`);
    });

    it('copies a frame that arrives one byte at a time a bounded number of times', () => {
      const content = patterned(64 * 1024, 2);
      const frame = body(1, content);
      const receive = receiver();
      let received;
      const copied = countingBytesCopied(() => {
        received = receive(cut(frame, 1));
      }).copied;
      assert.strictEqual(received.length, 1);
      assert.ok(received[0].content.equals(content));
      assert.ok(copied < 3 * frame.length, `copied ${copied} bytes to receive a frame of ${frame.length}`);
    });

    it('reads the same frames wherever the bytes are cut', () => {
      const small = patterned(5, 3);
      const large = patterned(10000, 4);
      const stream = Buffer.concat([HB, body(1, small), body(2, large), HB, body(3, Buffer.alloc(0)), body(4, large)]);
      for (const size of [1, 2, 6, 7, 8, 9, 13, 100, 4096, stream.length - 1, stream.length]) {
        const received = receiver()(cut(stream, size));
        const at = `cut every ${size}`;
        assert.strictEqual(received.length, 6, at);
        assert.strictEqual(received[0], HEARTBEAT, at);
        assert.deepStrictEqual([received[1].channel, received[1].content], [1, small], at);
        assert.deepStrictEqual([received[2].channel, received[2].content], [2, large], at);
        assert.strictEqual(received[3], HEARTBEAT, at);
        assert.deepStrictEqual([received[4].channel, received[4].content], [3, Buffer.alloc(0)], at);
        assert.deepStrictEqual([received[5].channel, received[5].content], [4, large], at);
      }
    });

    it('leaves a received body unchanged by the frames that follow it', () => {
      const first = patterned(20000, 5);
      const receive = receiver();
      const [delivered] = receive(cut(body(1, first), 300));
      for (let seed = 6; seed < 40; seed++) receive(cut(body(1, patterned(20000, seed)), 300));
      assert.ok(delivered.content.equals(first));
    });

    it('lets go of its storage once nothing is left unparsed', () => {
      const unparsed = new UnparsedBytes();
      unparsed.append(Buffer.alloc(100));
      unparsed.append(Buffer.alloc(100));
      unparsed.keepOnly(unparsed.bytes.subarray(200));
      assert.strictEqual(unparsed.storage.length, 0);
    });

    it('keeps its storage while bytes are left unparsed', () => {
      const unparsed = new UnparsedBytes();
      unparsed.append(patterned(100, 1));
      unparsed.append(patterned(100, 2));
      unparsed.keepOnly(unparsed.bytes.subarray(150));
      assert.ok(unparsed.bytes.equals(patterned(100, 2).subarray(50)));
      assert.ok(unparsed.storage.length >= 200);
    });

    describe('storage size', () => {
      const LARGEST = 4096;

      it('is twice the bytes it has to hold', () => {
        assert.strictEqual(storageBytesFor(1000, LARGEST), 2000);
      });

      it('is no more than the largest buffer', () => {
        assert.strictEqual(storageBytesFor(3000, LARGEST), LARGEST);
      });

      it('is the bytes it has to hold when they exceed the largest buffer, so that allocating it fails', () => {
        assert.strictEqual(storageBytesFor(5000, LARGEST), 5000);
      });
    });
  });

  const Trace = label('frame trace', repeat(choice.apply(choice, amqp.methods)));

  describe('Parsing', () => {
    function testPartitioning(partition) {
      return forAll(Trace)
        .satisfy((t) => {
          const bufs = [];
          const input = inputs();
          const frames = new Frames(input);
          let i = 0;
          let ex;
          frames.accept = (f) => {
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

          t.forEach((f) => {
            f.channel = 0;
            bufs.push(defs.encodeMethod(f.id, 0, f.fields));
          });

          partition(bufs).forEach((chunk) => input.write(chunk));
          frames.acceptLoop();
          if (ex) throw ex;
          return i === t.length;
        })
        .asTest({ times: 20 });
    }

    it('Parse trace of methods', testPartitioning((bufs) => bufs));

    it("Parse concat'd methods", testPartitioning((bufs) => [Buffer.concat(bufs)]));

    it('Parse partitioned methods', testPartitioning((bufs) => {
      const full = Buffer.concat(bufs);
      const onethird = Math.floor(full.length / 3);
      const twothirds = 2 * onethird;
      return [full.subarray(0, onethird), full.subarray(onethird, twothirds), full.subarray(twothirds)];
    }));
  });

  const FRAME_MAX_MAX = 4096 * 4;
  const FRAME_MAX_MIN = 4096;
  const FrameMax = amqp.rangeInt('frame max', FRAME_MAX_MIN, FRAME_MAX_MAX);
  const Body = sized((_n) => Math.floor(Math.random() * FRAME_MAX_MAX), repeat(amqp.Octet));

  const Content = transform(
    (args) => ({
      method: args[0].fields,
      header: args[1].fields,
      body: Buffer.from(args[2]),
    }),
    sequence(amqp.methods['BasicDeliver'], amqp.properties['BasicProperties'], Body),
  );

  describe('Content framing', () => {
    it('Adhere to frame max', forAll(Content, FrameMax)
      .satisfy((content, max) => {
        const input = inputs();
        const frames = new Frames(input);
        frames.frameMax = max;
        frames.sendMessage(0, defs.BasicDeliver, content.method, defs.BasicProperties, content.header, content.body);
        let _i = 0;
        let largest = 0;
        let frame = input.read();
        while (frame) {
          _i++;
          if (frame.length > largest) largest = frame.length;
          if (frame.length > max) {
            return false;
          }
          frame = input.read();
        }
        // The ratio of frames to 'contents' should always be >= 2
        // (one properties frame and at least one content frame); > 2
        // indicates fragmentation. The largest is always, of course <= frame max
        //console.log('Frames: %d; frames per message: %d; largest frame %d', _i, _i / t.length, largest);
        return true;
      })
      .asTest());
  });
});
