var amqp = require('../');

var sent = 0;
var acked = 0;

amqp.connect().then(function(c) {
  c.createConfirmChannel().then(function(ch) {
    var p;
    while (p = ch.publish('amq.topic', 'whatever', new Buffer('foobar')), p.ok) {
      sent++;
      p.then(function() { acked++; if (acked % 100 == 0) console.log('%d acked', acked); });
    }
    console.log('Sent %d', sent);
    ch.waitForConfirms().then(function() {
      console.log('All messages done');
      c.close();
    }, console.error);
  });
});
