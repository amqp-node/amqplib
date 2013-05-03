//
//
//

// General-purpose API for glueing everything together.

var URL = require('url');
var QS = require('querystring');
var NET = require('net');
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

function connect(url, callback) {
  var parts = URL.parse(url);
  // TODO TLS
  var sock = NET.connect(parts.port, parts.hostname);
  var options = openOptionsFromURL(parts);
  var c = new Connection(sock);
  return c.open(options).then(function (_openok) { return c; });
}

module.exports.connect = connect;
