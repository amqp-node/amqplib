const { describe, it } = require('node:test');
const assert = require('node:assert');
const Mux = require('../lib/mux').Mux;
const PassThrough = require('node:stream').PassThrough;

const latch = require('./lib/util').latch;
const schedule = require('./lib/util').schedule;

function stream() {
  return new PassThrough({ objectMode: true });
}

function readAllObjects(s, cb) {
  const objs = [];

  function read() {
    let v = s.read();
    while (v !== null) {
      objs.push(v);
      v = s.read();
    }
  }

  s.on('end', () => {
    cb(objs);
  });
  s.on('readable', read);

  read();
}

describe('mux', () => {

  it('single input', (_t, done) => {
    const input = stream();
    const output = stream();
    input.on('end', () => output.end());

    const mux = new Mux(output);
    mux.pipeFrom(input);

    const data = [1, 2, 3, 4, 5, 6, 7, 8, 9];
    // not 0, it's treated specially by PassThrough for some reason. By
    // 'specially' I mean it breaks the stream. See e.g.,
    // https://github.com/isaacs/readable-stream/pull/55
    data.forEach((chunk) => input.write(chunk));

    readAllObjects(output, (vals) => {
      assert.deepEqual(data, vals);
      done();
    });

    input.end();
  });

  it('single input, resuming stream', (_t, done) => {
    const input = stream();
    const output = stream();
    input.on('end', () => output.end());

    const mux = new Mux(output);
    mux.pipeFrom(input);

    // Streams might be blocked and become readable again, simulate this
    // using a special read function and a marker
    const data = [1, 2, 3, 4, 'skip', 6, 7, 8, 9];

    const oldRead = input.read;
    input.read = (size) => {
      const val = oldRead.call(input, size);

      if (val === 'skip') {
        input.emit('readable');
        return null;
      }

      return val;
    };

    data.forEach((chunk) => input.write(chunk));

    readAllObjects(output, (vals) => {
      assert.deepEqual([1, 2, 3, 4, 6, 7, 8, 9], vals);
      done();
    });

    input.end();
  });

  it('two sequential inputs', (_t, done) => {
    const input1 = stream();
    const input2 = stream();
    const output = stream();
    const mux = new Mux(output);
    mux.pipeFrom(input1);
    mux.pipeFrom(input2);

    const data = [1, 2, 3, 4, 5, 6, 7, 8, 9];
    data.forEach((v) => {
      input1.write(v);
    });

    input1.on('end', () => {
      data.forEach((v) => {
        input2.write(v);
      });
      input2.end();
    });
    input2.on('end', () => output.end());

    input1.end();
    readAllObjects(output, (vs) => {
      assert.equal(2 * data.length, vs.length);
      done();
    });
  });

  it('two interleaved inputs', (_t, done) => {
    const input1 = stream();
    const input2 = stream();
    const output = stream();
    const mux = new Mux(output);
    mux.pipeFrom(input1);
    mux.pipeFrom(input2);

    const decrementLatch = latch(2, () => output.end());
    input1.on('end', decrementLatch);
    input2.on('end', decrementLatch);

    const data = [1, 2, 3, 4, 5, 6, 7, 8, 9];
    data.forEach((v) => {
      input1.write(v);
    });
    input1.end();

    data.forEach((v) => input2.write(v));
    input2.end();

    readAllObjects(output, (vs) => {
      assert.equal(2 * data.length, vs.length);
      done();
    });
  });

  it('unpipe', (_t, done) => {
    const input = stream();
    const output = stream();
    const mux = new Mux(output);

    const pipedData = [1, 2, 3, 4, 5];
    const unpipedData = [6, 7, 8, 9];

    mux.pipeFrom(input);

    schedule(() => {
      pipedData.forEach((chunk) => input.write(chunk));

      schedule(() => {
        mux.unpipeFrom(input);

        schedule(() => {
          unpipedData.forEach((chunk) => input.write(chunk));
          input.end();
          schedule(() => {
            // exhaust so that 'end' fires
            let v;
            do {
              v = input.read();
            } while (v);
          });
        });
      });
    });

    input.on('end', () => output.end());

    readAllObjects(output, (vals) => {
      try {
        assert.deepEqual(pipedData, vals);
        done();
      } catch (e) {
        done(e);
      }
    });
  });

  it('backpressure does not crash when newStreams is drained', () => {
    // Regression test: out.write() returns false (backpressure) while
    // draining newStreams. The buggy code does an unconditional shift at the
    // bottom of the loop, so if the next stream reads null (empty) it gets
    // discarded without being pushed back, leaving newStreams empty and
    // triggering assert(this.newStreams.length > 0) in the else-branch.
    //
    // Scenario: newStreams = [input1, input2], input1 has data, input2 empty.
    // - shift input1, read 1, write → backpressure (false), push input1 back
    // - (buggy) unconditional shift takes input2, loop condition false → exit
    // - newStreams = [input1], length > 0, assert passes  ← not the bug path
    //
    // The crash path requires backpressure AND the shifted stream reading null
    // with no other streams remaining. Use a single stream that has data, then
    // engineer a second read() on the same stream returning null after the
    // write so the stream is not pushed back, emptying newStreams entirely.
    const input1 = stream();
    const output = stream();
    const mux = new Mux(output);

    mux.newStreams.push(input1);
    input1.write(1);

    // After the first write (which triggers backpressure), wrap read() so
    // the stream appears empty on the next call — simulating a stream that
    // had one item buffered and is now drained within the same roundrobin pass.
    const originalRead = input1.read.bind(input1);
    let readCount = 0;
    input1.read = (size) => {
      readCount++;
      if (readCount > 1) return null; // appear empty after first read
      return originalRead(size);
    };

    const originalWrite = output.write.bind(output);
    output.write = (...args) => {
      originalWrite(...args);
      return false; // signal backpressure immediately
    };

    assert.doesNotThrow(() => mux._readIncoming());
  });

  it('roundrobin', (_t, done) => {
    const input1 = stream();
    const input2 = stream();
    const output = stream();
    const mux = new Mux(output);

    mux.pipeFrom(input1);
    mux.pipeFrom(input2);

    const decrementLatch = latch(2, () => output.end());
    input1.on('end', decrementLatch);
    input2.on('end', decrementLatch);

    const ones = [1, 1, 1, 1, 1];
    ones.forEach((v) => {
      input1.write(v);
    });
    input1.end();

    const twos = [2, 2, 2, 2, 2];
    twos.forEach((v) => input2.write(v));
    input2.end();

    readAllObjects(output, (vs) => {
      assert.deepEqual([1, 2, 1, 2, 1, 2, 1, 2, 1, 2], vs);
      done();
    });
  });
});
