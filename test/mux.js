var assert = require('assert');
var Mux = require('../lib/mux').Mux;
var PassThrough = require('stream').PassThrough ||
  require('readable-stream/passthrough');

var latch = require('./mocknet').latch;

function readAllObjects(s, cb) {
  var objs = [];

  function read() {
    var v = s.read();
    while (v !== null) {
      objs.push(v);
      v = s.read();
    }
  }

  s.on('end', function() { cb(objs); });
  s.on('readable', read);

  read();
}

test("straight line", function(done) {
  var input = new PassThrough({objectMode: true});
  var output = new PassThrough({objectMode: true});
  input.on('end', function() { output.end() });

  var mux = new Mux(output);
  mux.pipeFrom(input);

  var data = [1,2,3,4,5,6,7,8,9]; // not 0, it's treated specially by
                                  // PassThrough for some reason. By
                                  // 'specially' I mean it breaks the
                                  // stream.
  data.forEach(input.write.bind(input));

  readAllObjects(output, function(vals) {
    assert.deepEqual(data, vals);
    done();
  });

  input.end();
});

test("two sequential inputs", function(done) {
  var input1 = new PassThrough({objectMode: true});
  var input2 = new PassThrough({objectMode: true});
  var output = new PassThrough({objectMode: true});
  var mux = new Mux(output);
  mux.pipeFrom(input1);
  mux.pipeFrom(input2);

  var data = [1,2,3,4,5,6,7,8,9];
  data.forEach(function(v) { input1.write(v); });

  input1.on('end', function() {
    data.forEach(function (v) { input2.write(v); });
    input2.end();
  });
  input2.on('end', function() { output.end(); });

  input1.end();
  readAllObjects(output, function(vs) {
    assert.equal(2 * data.length, vs.length);
    done();
  });
});

test("two interleaved inputs", function(done) {
  var input1 = new PassThrough({objectMode: true});
  var input2 = new PassThrough({objectMode: true});
  var output = new PassThrough({objectMode: true});
  var mux = new Mux(output);
  mux.pipeFrom(input1);
  mux.pipeFrom(input2);

  var endLatch = latch(2, function() { output.end(); });
  input1.on('end', endLatch);
  input2.on('end', endLatch);

  var data = [1,2,3,4,5,6,7,8,9];
  data.forEach(function(v) { input1.write(v); });
  input1.end();

  data.forEach(function(v) { input2.write(v); });
  input2.end();

  readAllObjects(output, function(vs) {
    assert.equal(2 * data.length, vs.length);
    done();
  });
});
