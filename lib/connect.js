//
//
//

// General-purpose API for glueing everything together.

'use strict';

var URL = require('url');
var QS = require('querystring');
var Connection = require('./connection').Connection;
var fmt = require('util').format;
var credentials = require('./credentials');

function copyInto(obj, target) {
  var keys = Object.keys(obj);
  var i = keys.length;
  while (i--) {
    var k = keys[i];
    target[k] = obj[k];
  }
  return target;
}

// Adapted from util._extend, which is too fringe to use.
function clone(obj) {
  return copyInto(obj, {});
}

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


// Construct the main frames used in the opening handshake
function openFrames(parts, credentials, extraClientProperties) {

  var vhost = parts.pathname;
  if (!vhost)
    vhost = '/';
  else
    vhost = QS.unescape(vhost.substr(1));

  var q = parts.query || {};

  function intOrDefault(val, def) {
    return (val === undefined) ? def : parseInt(val);
  }

  var clientProperties = Object.create(CLIENT_PROPERTIES);

  return {
    // start-ok
    'clientProperties': copyInto(extraClientProperties, clientProperties),
    'mechanism': credentials.mechanism,
    'response': credentials.response(),
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

// Decide on credentials based on what we're supplied
function credentialsFromUrl(parts) {
  var user = 'guest', passwd = 'guest';
  if (parts.auth) {
    var auth = parts.auth.split(':');
    user = auth[0];
    passwd = auth[1];
  }
  return credentials.plain(user, passwd);
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
  var timeout = sockopts.timeout;
  var keepAlive = !!sockopts.keepAlive;
  // 0 is default for node
  var keepAliveDelay = sockopts.keepAliveDelay || 0;

  var extraClientProperties = sockopts.clientProperties || {};
  var credentials = sockopts.credentials || credentialsFromUrl(parts);

  var fields = openFrames(parts, credentials, extraClientProperties);
  var port = parts.port || ((protocol === 'amqp:') ? 5672 : 5671);
  sockopts.host = parts.hostname;
  sockopts.port = parseInt(port);

  var sockok = false;
  var sock;

  function onConnect() {
    sockok = true;
    sock.setNoDelay(noDelay);
    if (timeout) {
      sock.setTimeout(
        timeout, openCallback.bind(this, new Error('connect ETIMEDOUT')));
    }
    if (keepAlive) sock.setKeepAlive(keepAlive, keepAliveDelay);

    var c = new Connection(sock);
    c.open(fields, function(err, ok) {
      // disable timeout once the connection is open, we don't want
      // it fouling things
      if (timeout) sock.setTimeout(0);
      if (err === null) {
        openCallback(null, c);
      }
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
