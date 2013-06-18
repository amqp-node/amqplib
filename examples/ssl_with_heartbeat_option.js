// Example of using a TLS/SSL connection. Note that the server must be
// configured to accept SSL connections; see, for example,
// http://www.rabbitmq.com/ssl.html.
//
// When trying this out, I followed the RabbitMQ SSL guide above,
// almost verbatim. I set the CN of the server certificate to
// 'localhost' rather than $(hostname) (since on my MBP hostname ends
// up being "<blah>.local", which is just weird). My client
// certificates etc., are in `../etc/client/`. My testca certificate
// is in `../etc/testca` and server certs etc., in `../etc/server`,
// and I've made a `rabbitmq.config` file, with which I start
// RabbitMQ:
//
//     RABBITMQ_CONFIG_FILE=`pwd`/../etc/server/rabbitmq \
//       /usr/local/sbin/rabbitmq-server &
//
// A way to check RabbitMQ's running with SSL OK is to use
//
//     openssl s_client -connect localhost:5671

var amqp = require('../');
var fs = require('fs');

// Assemble the SSL options; for verification we need at least
// * a certificate to present to the server ('cert', in PEM format)
// * the private key for the certificate ('key', in PEM format)
// * (possibly) a passphrase for the private key
//
// The first two may be replaced with a PKCS12 file ('pfx', in pkcs12
// format)

// We will also want to list the CA certificates that we will trust,
// since we're using a self-signed certificate. It is NOT recommended
// to use `rejectUnauthorized: false`.

// Options for full client and server verification:
var opts = {
  cert: fs.readFileSync('../etc/client/cert.pem'),
  key: fs.readFileSync('../etc/client/key.pem'),
  // cert and key or
  // pfx: fs.readFileSync('../etc/client/keycert.p12'),
  passphrase: 'MySecretPassword',
  ca: [fs.readFileSync('../etc/testca/cacert.pem')]
};

// Options for just confidentiality. This requires RabbitMQ's SSL
// configuration to include the items
//
//     {verify, verify_none},
//     {fail_if_no_peer_cert,false}
//
var opts1 = {  ca: [fs.readFileSync('../etc/testca/cacert.pem')] };

var open = amqp.connect('amqps://localhost/?heartbeat=5', opts);

open.then(function(conn) {
  process.on('SIGINT', conn.close.bind(conn));
  //set the maxMissedHeartbeats on the underlying connection
  //as it seems, at least with RabbitMQ/Erlang 2.7.1 / R14B03,
  //that one of the initial heartbeats is missed.
  //
  //maxMissedHeartbeats = max consequtive heartbeats that can be missed
  //  before the connection is closed by the client and an error thrown
  conn.connection.maxMissedHeartbeats = 1;
  return conn.createChannel().then(function(ch) {
    ch.sendToQueue('foo', new Buffer('Hello World!'));
  });
}).then(null, console.warn);
