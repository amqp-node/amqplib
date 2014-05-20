//
//
//

// General-purpose API for glueing everything together.

'use strict';

var URL = require('url');
var QS = require('querystring');
var Connection = require('./connection').Connection;
var fmt = require('util').format;

// Adapted from util._extend, which is too fringe to use.
function clone(obj) {
  var newObj = {};
  var keys = Object.keys(obj);
  var i = keys.length;
  while (i--) {
    var k = keys[i];
    newObj[k] = obj[k];
  }
  return newObj;
};

var CLIENT_PROPERTIES = {
  "product": "amqplib",
  "version": require('../package.json').version,
  "platform": fmt('Node.JS %s', process.version),
  "information": "http://squaremo.github.io/amqp.node",
  "capabilities": {
    "publisher_confirms": true,
    "exchange_exchange_bindings": true,
    "basic.nack": true,
    "consumer_cancel_notify": true,
    "connection.blocked": true,
    "authentication_failure_close": true
  }
};


// Parse a URL to get the options used in the opening protocol
function openOptionsFromURL(parts) {
  var user = 'guest', passwd = 'guest';
  if (parts.auth) {
    var auth = parts.auth.split(':');
    user = auth[0];
    passwd = auth[1];
  }

  var vhost = parts.pathname;
  if (!vhost)
    vhost = '/';
  else
    vhost = QS.unescape(vhost.substr(1));

  var q = parts.query || {};

  function intOrDefault(val, def) {
    return (val === undefined) ? def : parseInt(val);
  }

  return {
    // start-ok
    'clientProperties': CLIENT_PROPERTIES,
    'mechanism': 'PLAIN',
    'response': new Buffer(['', user, passwd].join(String.fromCharCode(0))),
    'locale': q.locale || 'en_US',

    // tune-ok
    'channelMax': intOrDefault(q.channelMax, 0),
    'frameMax': intOrDefault(q.frameMax, 0x1000),
    'heartbeat': intOrDefault(q.heartbeat, 0),

    // open
    'virtualHost': vhost,
    'capabilities': '',
    'insist': 0
  };
}

function connect(url, socketOptions, openCallback) {
  // tls.connect uses `util._extend()` on the options given it, which
  // copies only properties mentioned in `Object.keys()`, when
  // processing the options. So I have to make copies too, rather
  // than using `Object.create()`.
  var sockopts = clone(socketOptions || {});
  url = url || 'amqp://localhost';

  var parts = URL.parse(url, true); // yes, parse the query string
  var protocol = parts.protocol;
  var noDelay = !!sockopts.noDelay;

  var options = openOptionsFromURL(parts);
  var port = parts.port || ((protocol === 'amqp:') ? 5672 : 5671);
  sockopts.host = parts.hostname;
  sockopts.port = parseInt(port);

  var sockok = false;
  var sock;

  function onConnect() {
    sockok = true;
    sock.setNoDelay(noDelay);
    var c = new Connection(sock);
    c.open(options, function(err, ok) {
      if (err === null) openCallback(null, c);
      else openCallback(err);
    });
  }

  if (protocol === 'amqp:') {
    sock = require('net').connect(sockopts, onConnect);
  }
  else if (protocol === 'amqps:') {
    sock = require('tls').connect(sockopts, onConnect);
  }
  else {
    throw new Error("Expected amqp: or amqps: as the protocol; got " + protocol);
  }

  sock.once('error', function(err) {
    if (!sockok) openCallback(err);
  });

}

module.exports.connect = connect;
