//
//
//

// General-purpose API for glueing everything together.

'use strict';

var URL = require('url-parse');
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

const recoverDefaults = {
  recover: false,
  recoverAfter: 5000,
  recoverAfterRandom: 0,
  recoverTimeout: 5000,
  recoverRetries: 0,
  recoverTopology: true,
  recoverOnServerClose: false,
  recoverOnMissedHeartbeat: false
};

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
function openFrames(vhost, query, credentials, extraClientProperties) {
  if (!vhost)
    vhost = '/';
  else
    vhost = QS.unescape(vhost);

  var query = query || {};

  function intOrDefault(val, def) {
    return (val === undefined) ? def : parseInt(val);
  }

  var clientProperties = Object.create(CLIENT_PROPERTIES);

  return {
    // start-ok
    'clientProperties': copyInto(extraClientProperties, clientProperties),
    'mechanism': credentials.mechanism,
    'response': credentials.response(),
    'locale': query.locale || 'en_US',

    // tune-ok
    'channelMax': intOrDefault(query.channelMax, 0),
    'frameMax': intOrDefault(query.frameMax, 0x1000),
    'heartbeat': intOrDefault(query.heartbeat, 0),

    // open
    'virtualHost': vhost,
    'capabilities': '',
    'insist': 0
  };
}

// Decide on credentials based on what we're supplied.
function credentialsFromUrl(parts) {
  var user = 'guest', passwd = 'guest';
  if (parts.username != '' || parts.password != '') {
    user = (parts.username) ? unescape(parts.username) : '';
    passwd = (parts.password) ? unescape(parts.password) : '';
  }
  return credentials.plain(user, passwd);
}

function reconnect(conn, callback) {
  connect(conn.urls, conn.socketOptions, callback, conn);
}

function shuffleRoundRobin(urls, index) {
  var next_index
  // Initial value
  if(index === undefined) {
    next_index = 0;
  } else {
  // Round-robin
    next_index = index + 1;
  }
  // Go back to 0
  if(next_index >= urls.length) {
    next_index = 0;
  }
  return next_index;
}

function shuffleRandom(urls, _index) {
  return Math.floor(Math.random() * urls.length);
}

function connect(urls, socketOptions, openCallback, conn) {
  // tls.connect uses `util._extend()` on the options given it, which
  // copies only properties mentioned in `Object.keys()`, when
  // processing the options. So I have to make copies too, rather
  // than using `Object.create()`.
  var sockopts = clone(socketOptions || {});
  var url;
  urls = urls || 'amqp://localhost';

  if(Array.isArray(urls)){
    var host_index;
    if(conn === undefined) {
      host_index = undefined;
    } else {
      host_index = conn.host_index;
    }
    if(socketOptions.hostShuffle === undefined ||
       socketOptions.hostShuffle === "round-robin") {
      socketOptions.hostShuffle = shuffleRoundRobin;
    } else if (socketOptions.hostShuffle === "random") {
      socketOptions.hostShuffle = shuffleRandom;
    }
    host_index = socketOptions.hostShuffle(urls, host_index);
    url = urls[host_index];
  } else {
    // Urls is not an array
    url = urls;
  }

  var noDelay = !!sockopts.noDelay;
  var timeout = sockopts.timeout;
  var keepAlive = !!sockopts.keepAlive;
  // 0 is default for node
  var keepAliveDelay = sockopts.keepAliveDelay || 0;

  var extraClientProperties = sockopts.clientProperties || {};

  var protocol, fields;
  if (typeof url === 'object') {
    protocol = (url.protocol || 'amqp') + ':';
    sockopts.host = url.hostname;
    sockopts.port = url.port || ((protocol === 'amqp:') ? 5672 : 5671);

    var user, pass;
    // Only default if both are missing, to have the same behaviour as
    // the stringly URL.
    if (url.username == undefined && url.password == undefined) {
      user = 'guest'; pass = 'guest';
    } else {
      user = url.username || '';
      pass = url.password || '';
    }

    var config = {
      locale: url.locale,
      channelMax: url.channelMax,
      frameMax: url.frameMax,
      heartbeat: url.heartbeat,
    };

    fields = openFrames(url.vhost, config, sockopts.credentials || credentials.plain(user, pass), extraClientProperties);
  } else {
    var parts = URL(url, true); // yes, parse the query string
    protocol = parts.protocol;
    sockopts.host = parts.hostname;
    sockopts.port = parseInt(parts.port) || ((protocol === 'amqp:') ? 5672 : 5671);
    var vhost = parts.pathname ? parts.pathname.substr(1) : null;
    fields = openFrames(vhost, parts.query, sockopts.credentials || credentialsFromUrl(parts), extraClientProperties);
  }

  var sockok = false;
  var sock;

  function onConnect() {
    sockok = true;
    sock.setNoDelay(noDelay);
    if (keepAlive) sock.setKeepAlive(keepAlive, keepAliveDelay);

    var c;
    if(conn == undefined){
      c = new Connection(sock);
    } else {
      c = conn.changeSocket(sock);
    }
    c.urls = urls;
    c.host_index = host_index;
    c.socketOptions = socketOptions;
    // Auto-reconnect
    if(c.recover === undefined) {
      if(sockopts.recover === undefined) {
        c.recover = recoverDefaults.recover;
      } else {
        c.recover = sockopts.recover;
      }
    }
    // Time to wait before reconnecting
    if(c.recoverAfter === undefined) {
      if(sockopts.recoverAfter === undefined) {
        c.recoverAfter = recoverDefaults.recoverAfter;
      } else {
        c.recoverAfter = sockopts.recoverAfter;
      }
    }
    // Random fraction of time to wait before reconnecting
    if(c.recoverAfterRandom === undefined) {
      if(sockopts.recoverAfterRandom === undefined) {
        c.recoverAfterRandom = recoverDefaults.recoverAfterRandom;
      } else {
        c.recoverAfterRandom = sockopts.recoverAfterRandom;
      }
    }
    // Time to wait after reconnect fails
    if(c.recoverTimeout === undefined) {
      if(sockopts.recoverTimeout === undefined) {
        c.recoverTimeout = recoverDefaults.recoverTimeout;
      } else {
        c.recoverTimeout = sockopts.recoverTimeout;
      }
    }
    // N times to retry reconnecting
    if(c.recoverRetries === undefined) {
      if(sockopts.recoverRetries === undefined) {
        c.recoverRetries = recoverDefaults.recoverRetries;
      } else {
        c.recoverRetries = sockopts.recoverRetries;
      }
    }
    // Recover exchanges/queues/bindings
    if(c.recoverTopology === undefined) {
      if(sockopts.recoverTopology === undefined) {
        c.recoverTopology = recoverDefaults.recoverTopology;
      } else {
        c.recoverTopology = sockopts.recoverTopology;
      }
    }
    // Reconnect on server-side connection close (e.g. from management UI)
    if(c.recoverOnServerClose === undefined) {
      if(sockopts.recoverOnServerClose === undefined) {
        c.recoverOnServerClose = recoverDefaults.recoverOnServerClose;
      } else {
        c.recoverOnServerClose = sockopts.recoverOnServerClose;
      }
    }
    // Reconnect if client misses a heartbeat from the server
    if(c.recoverOnMissedHeartbeat === undefined) {
      if(sockopts.recoverOnMissedHeartbeat === undefined) {
        c.recoverOnMissedHeartbeat = recoverDefaults.recoverOnMissedHeartbeat;
      } else {
        c.recoverOnMissedHeartbeat = sockopts.recoverOnMissedHeartbeat;
      }
    }


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

  if (timeout) {
    sock.setTimeout(timeout, function() {
      sock.end();
      sock.destroy();
      openCallback(new Error('connect ETIMEDOUT'));
    });
  }

  sock.once('error', function(err) {
    if (!sockok) openCallback(err);
  });

}

module.exports.connect = connect;
module.exports.reconnect = reconnect;
module.exports.credentialsFromUrl = credentialsFromUrl;
