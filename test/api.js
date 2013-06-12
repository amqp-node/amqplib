var api = require('../lib/api');

test("Connection refused", function(done) {
  var open = api.connect('amqp://localhost:23450');
  open.then(function() {
    done(new Error('Connection unexpectedly succeeded'));
  }, function(err) {
    done();
  });
});
