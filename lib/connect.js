//
//
//

// General-purpose API for glueing everything together.

'use strict';

const URL = require('url-parse');
const QS = require('node:querystring');
const Connection = require('./connection').Connection;
const fmt = require('node:util').format;
const credentials = require('./credentials');

function copyInto(obj, target) {
  const keys = Object.keys(obj);
  let i = keys.length;
  while (i--) {
    const k = keys[i];
    target[k] = obj[k];
  }
  return target;
}

// Adapted from util._extend, which is too fringe to use.
function clone(obj) {
  return copyInto(obj, {});
}

const CLIENT_PROPERTIES = {
  product: 'amqplib',
  version: require('../package.json').version,
  platform: fmt('Node.JS %s', process.version),
  information: 'https://amqp-node.github.io/amqplib/',
  capabilities: {
    publisher_confirms: true,
    exchange_exchange_bindings: true,
    'basic.nack': true,
    consumer_cancel_notify: true,
    'connection.blocked': true,
    authentication_failure_close: true,
  },
};

// Construct the main frames used in the opening handshake
function openFrames(vhost, query, credentials, extraClientProperties) {
  if (!vhost) vhost = '/';
  else vhost = QS.unescape(vhost);

  query = query || {};

  function intOrDefault(val, def) {
    return val === undefined ? def : parseInt(val, 10);
  }

  const clientProperties = Object.create(CLIENT_PROPERTIES);

  return {
    // start-ok
    clientProperties: copyInto(extraClientProperties, clientProperties),
    mechanism: credentials.mechanism,
    response: credentials.response(),
    locale: query.locale || 'en_US',

    // tune-ok
    channelMax: intOrDefault(query.channelMax, 0),
    frameMax: intOrDefault(query.frameMax, 131072),
    heartbeat: intOrDefault(query.heartbeat, 0),

    // open
    virtualHost: vhost,
    capabilities: '',
    insist: 0,
  };
}

// Decide on credentials based on what we're supplied.
function credentialsFromUrl(parts) {
  let user = 'guest',
    passwd = 'guest';
  if (parts.username != '' || parts.password != '') {
    user = parts.username ? unescape(parts.username) : '';
    passwd = parts.password ? unescape(parts.password) : '';
  }
  return credentials.plain(user, passwd);
}

function connect(url, socketOptions, openCallback) {
  // tls.connect uses `util._extend()` on the options given it, which
  // copies only properties mentioned in `Object.keys()`, when
  // processing the options. So I have to make copies too, rather
  // than using `Object.create()`.
  const sockopts = clone(socketOptions || {});
  url = url || 'amqp://localhost';

  const noDelay = !!sockopts.noDelay;
  const timeout = sockopts.timeout;
  const keepAlive = !!sockopts.keepAlive;
  // 0 is default for node
  const keepAliveDelay = sockopts.keepAliveDelay || 0;

  const extraClientProperties = sockopts.clientProperties || {};

  let protocol, fields;
  if (typeof url === 'object') {
    protocol = `${url.protocol || 'amqp'}:`;
    sockopts.host = url.hostname;
    sockopts.servername = sockopts.servername || url.hostname;
    sockopts.port = url.port || (protocol === 'amqp:' ? 5672 : 5671);

    let user, pass;
    // Only default if both are missing, to have the same behaviour as
    // the stringly URL.
    if (url.username == undefined && url.password == undefined) {
      user = 'guest';
      pass = 'guest';
    } else {
      user = url.username || '';
      pass = url.password || '';
    }

    const config = {
      locale: url.locale,
      channelMax: url.channelMax,
      frameMax: url.frameMax,
      heartbeat: url.heartbeat,
    };

    fields = openFrames(url.vhost, config, sockopts.credentials || credentials.plain(user, pass), extraClientProperties);
  } else {
    const parts = URL(url, true); // yes, parse the query string
    const host = parts.hostname.replace(/^\[|\]$/g, '');
    protocol = parts.protocol;
    sockopts.host = host;
    sockopts.servername = sockopts.servername || host;
    sockopts.port = parseInt(parts.port, 10) || (protocol === 'amqp:' ? 5672 : 5671);
    const vhost = parts.pathname ? parts.pathname.substr(1) : null;
    fields = openFrames(vhost, parts.query, sockopts.credentials || credentialsFromUrl(parts), extraClientProperties);
  }

  let sockok = false;
  let sock;

  function onConnect() {
    sockok = true;
    sock.setNoDelay(noDelay);
    if (keepAlive) sock.setKeepAlive(keepAlive, keepAliveDelay);

    const c = new Connection(sock);
    c.open(fields, function (err, _ok) {
      // disable timeout once the connection is open, we don't want
      // it fouling things
      if (timeout) sock.setTimeout(0);
      if (err === null) {
        openCallback(null, c);
      } else {
        // The connection isn't closed by the server on e.g. wrong password
        sock.end();
        sock.destroy();
        openCallback(err);
      }
    });
  }

  if (protocol === 'amqp:') {
    sock = require('node:net').connect(sockopts, onConnect);
  } else if (protocol === 'amqps:') {
    sock = require('node:tls').connect(sockopts, onConnect);
  } else {
    throw new Error(`Expected amqp: or amqps: as the protocol; got ${protocol}`);
  }

  if (timeout) {
    sock.setTimeout(timeout, function () {
      sock.end();
      sock.destroy();
      openCallback(new Error('connect ETIMEDOUT'));
    });
  }

  sock.once('error', function (err) {
    if (!sockok) openCallback(err);
  });
}

module.exports.connect = connect;
module.exports.credentialsFromUrl = credentialsFromUrl;
