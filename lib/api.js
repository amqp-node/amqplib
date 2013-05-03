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

// connect :: string -> promise connection
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
    throw new Error("Expected amqp: or amqps: as the protocol");
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
