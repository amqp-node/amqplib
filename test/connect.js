var connect = require('../lib/connect').connect;

test("Connection refused", function(done) {
  var open = connect('amqp://localhost:23450');
  open.then(function() {
    done(new Error('Connection unexpectedly succeeded'));
  }, function(err) {
    done();
  });
});
