var amqp = require('../');

var NUM_MSGS = 20;

function mkCallback(i) {
  return (i % 2) === 0 ? function(err) {
    if (err !== null) { console.error('Message %d failed!', i); }
    else { console.log('Message %d confirmed', i); }
  } : null;
}

amqp.connect().then(function(c) {
  c.createConfirmChannel().then(function(ch) {
    for (var i=0; i < NUM_MSGS; i++) {
      ch.publish('amq.topic', 'whatever', new Buffer('blah'), {}, mkCallback(i));
    }
    ch.waitForConfirms().then(function() {
      console.log('All messages done');
      c.close();
    }).catch(console.error);
  });
});
