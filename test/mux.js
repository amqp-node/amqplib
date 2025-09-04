const assert = require('node:assert');
const Mux = require('../lib/mux').Mux;
const PassThrough = require('node:stream').PassThrough;

const latch = require('./util').latch;
const schedule = require('./util').schedule;

function stream() {
  return new PassThrough({objectMode: true});
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

  s.on('end', function () {
    cb(objs);
  });
  s.on('readable', read);

  read();
}

test('single input', function (done) {
  const input = stream();
  const output = stream();
  input.on('end', function () {
    output.end();
  });

  const mux = new Mux(output);
  mux.pipeFrom(input);

  const data = [1, 2, 3, 4, 5, 6, 7, 8, 9];
  // not 0, it's treated specially by PassThrough for some reason. By
  // 'specially' I mean it breaks the stream. See e.g.,
  // https://github.com/isaacs/readable-stream/pull/55
  data.forEach(function (chunk) {
    input.write(chunk);
  });

  readAllObjects(output, function (vals) {
    assert.deepEqual(data, vals);
    done();
  });

  input.end();
});

test('single input, resuming stream', function (done) {
  const input = stream();
  const output = stream();
  input.on('end', function () {
    output.end();
  });

  const mux = new Mux(output);
  mux.pipeFrom(input);

  // Streams might be blocked and become readable again, simulate this
  // using a special read function and a marker
  const data = [1, 2, 3, 4, 'skip', 6, 7, 8, 9];

  const oldRead = input.read;
  input.read = function (size) {
    const val = oldRead.call(input, size);

    if (val === 'skip') {
      input.emit('readable');
      return null;
    }

    return val;
  };

  data.forEach(function (chunk) {
    input.write(chunk);
  });

  readAllObjects(output, function (vals) {
    assert.deepEqual([1, 2, 3, 4, 6, 7, 8, 9], vals);
    done();
  });

  input.end();
});

test('two sequential inputs', function (done) {
  const input1 = stream();
  const input2 = stream();
  const output = stream();
  const mux = new Mux(output);
  mux.pipeFrom(input1);
  mux.pipeFrom(input2);

  const data = [1, 2, 3, 4, 5, 6, 7, 8, 9];
  data.forEach(function (v) {
    input1.write(v);
  });

  input1.on('end', function () {
    data.forEach(function (v) {
      input2.write(v);
    });
    input2.end();
  });
  input2.on('end', function () {
    output.end();
  });

  input1.end();
  readAllObjects(output, function (vs) {
    assert.equal(2 * data.length, vs.length);
    done();
  });
});

test('two interleaved inputs', function (done) {
  const input1 = stream();
  const input2 = stream();
  const output = stream();
  const mux = new Mux(output);
  mux.pipeFrom(input1);
  mux.pipeFrom(input2);

  const endLatch = latch(2, function () {
    output.end();
  });
  input1.on('end', endLatch);
  input2.on('end', endLatch);

  const data = [1, 2, 3, 4, 5, 6, 7, 8, 9];
  data.forEach(function (v) {
    input1.write(v);
  });
  input1.end();

  data.forEach(function (v) {
    input2.write(v);
  });
  input2.end();

  readAllObjects(output, function (vs) {
    assert.equal(2 * data.length, vs.length);
    done();
  });
});

test('unpipe', function (done) {
  const input = stream();
  const output = stream();
  const mux = new Mux(output);

  const pipedData = [1, 2, 3, 4, 5];
  const unpipedData = [6, 7, 8, 9];

  mux.pipeFrom(input);

  schedule(function () {
    pipedData.forEach(function (chunk) {
      input.write(chunk);
    });

    schedule(function () {
      mux.unpipeFrom(input);

      schedule(function () {
        unpipedData.forEach(function (chunk) {
          input.write(chunk);
        });
        input.end();
        schedule(function () {
          // exhaust so that 'end' fires
          let v;
          do {
            v = input.read();
          } while (v);
        });
      });
    });
  });

  input.on('end', function () {
    output.end();
  });

  readAllObjects(output, function (vals) {
    try {
      assert.deepEqual(pipedData, vals);
      done();
    } catch (e) {
      done(e);
    }
  });
});

test('roundrobin', function (done) {
  const input1 = stream();
  const input2 = stream();
  const output = stream();
  const mux = new Mux(output);

  mux.pipeFrom(input1);
  mux.pipeFrom(input2);

  const endLatch = latch(2, function () {
    output.end();
  });
  input1.on('end', endLatch);
  input2.on('end', endLatch);

  const ones = [1, 1, 1, 1, 1];
  ones.forEach(function (v) {
    input1.write(v);
  });
  input1.end();

  const twos = [2, 2, 2, 2, 2];
  twos.forEach(function (v) {
    input2.write(v);
  });
  input2.end();

  readAllObjects(output, function (vs) {
    assert.deepEqual([1, 2, 1, 2, 1, 2, 1, 2, 1, 2], vs);
    done();
  });
});
