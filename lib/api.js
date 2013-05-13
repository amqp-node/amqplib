//
//
//

// General-purpose API for glueing everything together.

var URL = require('url');
var QS = require('querystring');
var defer = require('when').defer;
var Connection = require('./connection').Connection;

// Parse a URL to get the options used in the opening protocol
function openOptionsFromURL(parts) {
  var user = 'guest', passwd = 'guest';
  if (parts.auth) {
    auth = parts.auth.split(':');
    user = auth[0];
    passwd = auth[1];
  }

  var vhost = parts.pathname;
  if (!vhost)
    vhost = '/';
  else
    vhost = QS.unescape(vhost.substr(1));

  var q = parts.query || {};

  return {
    // start-ok
    'clientProperties': {},
    'mechanism': 'PLAIN',
    'response': new Buffer(['', user, passwd].join(String.fromCharCode(0))),
    'locale': q.locale || 'en_US',

    // tune-ok
    'channelMax': q.channelMax || 0,
    'frameMax': q.frameMax || 0,
    'heartbeat': q.heartbeat || 0,

    // open
    'virtualHost': vhost,
    'capabilities': '',
    'insist': 0
  };
}

/*
Connect to a server. The URL follows
http://www.rabbitmq.com/uri-spec.html, with defaults for omitted parts
as given in `'amqp://guest:guest@localhost:5672'`.

RabbitMQ will interpret an omitted path (i.e., as in the URL just
given) as the virtual host named '/' which is present _out of the
box_. Just a trailing slash would indicate the virtual host named ''
(which does not exist unless it's been explicitly created). When
specifying another virtual host, remember that its name must be
escaped; so e.g., the virtual host named '/foo' is `'%2Ffoo'`.

Further connection tuning parameters may be given in the querystring
portion of the URL. These are:

 - `frameMax`, the size in bytes of the maximum frame allowed over the
   connection. By default this is `0`, meaning no limit (but since
   frames have a size field which is an unsigned 32 bit integer, it's
   perforce `2^32 - 1`).

 - `channelMax`, the maximum number of channels allowed. Default is
   `0`, meaning `2^16 - 1`.

 - `heartbeat`: the period of the connection heartbeat, in
   seconds. Defaults to `0`, meaning no heartbeat. OMG no heartbeat!

 - `locale`: the desired locale for error messages, I
   suppose. RabbitMQ only ever uses `en_US`; which, happily, is the
   default.

If a URL is not supplied, it's equivalent to giving
`'amqp://localhost'`, which will connect to a RabbitMQ with factory
settings, on localhost.

Returns a promise which will either be resolved with an open AMQP
connection or rejected with a sympathetically-worded error (in en_US).
*/
function connect(url) {
  url = url || 'amqp://localhost';

  var parts = URL.parse(url);
  var protocol = parts.protocol;
  var net;
  if (protocol === 'amqp:') {
    net = require('net');
  }
  else if (protocol === 'amqps:') {
    net = require('tls');
  }
  else {
    throw new Error("Expected amqp: or amqps: as the protocol; got " + protocol);
  }

  var options = openOptionsFromURL(parts);
  var port = parts.port || (protocol === 'amqp:') ? 5672 : 5671;
  
  var result = defer();

  var sock = net.connect(port, parts.hostname, function() {
    var c = new Connection(sock);
    c.open(options).then(function (_openok) { result.resolve(c); });
  });
  return result.promise;
}

module.exports.connect = connect;
