/* global Uint8Array, FileReader, Blob */

'use strict';
var EventEmitter = require('events').EventEmitter;
var inherits = require('util').inherits;
var defs = require('./defs');
var FRAME_OVERHEAD = defs.FRAME_OVERHEAD;
var constants = defs.constants;
var encodeMethod = defs.encodeMethod;
var encodeProperties = defs.encodeProperties;
var frame = require('./frame');
var HEARTBEAT = frame.HEARTBEAT;
var makeBodyFrame = frame.makeBodyFrame;
var parseFrame = frame.parseFrame;
var decodeFrame = frame.decodeFrame;
var Heart = require('./heartbeat').Heart;
var methodName = require('./format').methodName;
var closeMsg = require('./format').closeMessage;
var inspect = require('./format').inspect;
var BitSet = require('./bitset').BitSet;
var fmt = require('util').format;
var IllegalOperationError = require('./error').IllegalOperationError;
var stackCapture = require('./error').stackCapture;

var SINGLE_CHUNK_THRESHOLD = 2048;

function WebSocketConnection(webSocket) {
  EventEmitter.call(this);
  this.webSocket = webSocket;
  this.rest = new Buffer(0);
  this.frameMax = constants.FRAME_MIN_SIZE;
  this.sentSinceLastCheck = false;
  this.recvSinceLastCheck = false;
  this.expectSocketClose = false;
  this.freeChannels = new BitSet();
  this.channels = [{
    channel: {
      accept: channel0(this)
    },
    webSocket: webSocket
  }];
}

inherits(WebSocketConnection, EventEmitter);

function invalidOp(msg, stack) {
  return function() {
    throw new IllegalOperationError(msg, stack);
  };
}

function invalidateSend(conn, msg, stack) {
  conn.sendMethod = conn.sendContent = conn.sendMessage = invalidOp(msg, stack);
}

function channel0(connection) {
  return function(f) {
    if(f.id === defs.ConnectionClose) {
      connection.sendMethod(0, defs.ConnectionCloseOk, {});
      var emsg = fmt('Connection closed: %s', closeMsg(f));
      var s = stackCapture(emsg);
      var e = new Error(emsg);
      e.code = f.fields.replyCode;
      if(isFatalError(e)) {
        connection.emit('error', e);
      }
      connection.toClosed(s, e);
    } else if(f.id === defs.ConnectionBlocked) {
      connection.emit('blocked', f.fields.reason);
    } else if(f.id === defs.ConnectionUnblocked) {
      connection.emit('unblocked');
    } else if(f !== HEARTBEAT) {
      connection.closeWithError(fmt('Unexpected frame on channel 0'),
        constants.UNEXPECTED_FRAME,
        new Error(fmt('Unexpected frame on channel 0: %s', inspect(f, false))));
    }
  };
}

var C = WebSocketConnection.prototype;

// This changed between versions, as did the codec, methods, etc. AMQP
// 0-9-1 is fairly similar to 0.8, but better, and nothing implements
// 0.8 that doesn't implement 0-9-1. In other words, it doesn't make
// much sense to generalise here.
C.sendProtocolHeader = function() {
  this.sendBytes(frame.PROTOCOL_HEADER);
};

//   The frighteningly complicated opening protocol (spec section 2.2.4):
//
//      Client -> Server
//
//        protocol header ->
//          <- start
//        start-ok ->
//      .. next two zero or more times ..
//          <- secure
//        secure-ok ->
//          <- tune
//        tune-ok ->
//        open ->
//          <- open-ok
//
// If I'm only supporting SASL's PLAIN mechanism (which I am for the time
// being), it gets a bit easier since the server won't in general send
// back a `secure`, it'll just send `tune` after the `start-ok`.
// (SASL PLAIN: http://tools.ietf.org/html/rfc4616)
C.open = function(credentials, openCallback0) {
  var self = this;
  var openCallback = openCallback0 || function() {};
  var tunedOptions = Object.create({
    // start-ok
    mechanism: 'PLAIN',
    response: new Buffer(['',
      credentials.username,
      credentials.password
    ].join(String.fromCharCode(0))),
    locale: 'en_US',
    clientProperties: {
      product: 'amqplib (browser WebSocket client)',
      version: '0.0.1',
      platform: 'Chrome',
      information: 'http://squaremo.github.io/amqp.node',
      capabilities: {
        publisher_confirms: true,
        exchange_exchange_bindings: true,
        'basic.nack': true,
        consumer_cancel_notify: true,
        'connection.blocked': true,
        authentication_failure_close: true
      }
    },

    // tune-ok
    channelMax: 0,
    frameMax: 0x1000,
    heartbeat: 60,

    // open
    virtualHost: '/',
    capabilities: '',
    insist: 0
  });

  var send = function(Method) {
    try {
      self.sendMethod(0, Method, tunedOptions);
    } catch(err) {
      openCallback(err);
    }
  };

  var negotiate = function(srv, desired) {
    return Math[(srv === 0 || desired === 0) ? 'max' : 'min'](srv, desired);
  };

  var messageToBuffer = function(message, cb) {
    if(!(message.data instanceof Blob)) {
      return console.log('Message is not binary: ', message);
    }
    var reader = new FileReader();
    reader.onloadend = function() {
      message = Buffer.from(new Uint8Array(reader.result));
      var i = 0;
      var j;
      while((j = message.indexOf(206, i)+1) !== 0) {
        var frame = self.recvFrame(message.slice(i,j));
        i = j;
        cb(null, frame);
      }
    };
    reader.readAsArrayBuffer(message.data);
  };

  var start0 = function(rawMessage) {
    messageToBuffer(rawMessage, function(err, frame) {
      if(frame.channel !== 0) {
        openCallback(new Error(fmt('Frame on channel != 0 during handshake: %s',
          inspect(frame, false))));
      } else if(frame.id !== defs.ConnectionStart) {
        openCallback(new Error(fmt('Expected %s; got %s',
          methodName(defs.ConnectionStart), inspect(frame, false))));
      } else {
        var mechanisms = frame.fields.mechanisms.toString().split(' ');
        if(mechanisms.indexOf(allFields.mechanism) < 0) {
          return openCallback(new Error(fmt(
            'SASL mechanism %s is not provided by the server',
              allFields.mechanism)));
        }
        self.webSocket.removeEventListener('message', start0);
        self.webSocket.addEventListener('message', start1);
        send(defs.ConnectionStartOk);
      }
    });
  };

  var start1 = function(rawMessage) {
    messageToBuffer(rawMessage, function(err, frame) {
      switch(frame.id) {
        case defs.ConnectionSecure:
          openCallback(
            new Error('Wasn\'t expecting to have to go through secure'));
          break;
        case defs.ConnectionClose:
          openCallback(new Error(fmt('Handshake terminated by server: %s',
            closeMsg(frame))));
          break;
        case defs.ConnectionTune:
          var fields = frame.fields;
          tunedOptions.frameMax = negotiate(fields.frameMax,
            allFields.frameMax);
          tunedOptions.channelMax = negotiate(fields.channelMax,
            allFields.channelMax);
          tunedOptions.heartbeat = negotiate(fields.heartbeat,
            allFields.heartbeat);
          self.webSocket.removeEventListener('message', start1);
          self.webSocket.addEventListener('message', start2);
          send(defs.ConnectionTuneOk);
          send(defs.ConnectionOpen);
          break;
        default:
          openCallback(new Error(fmt('Expected connection.secure, ' +
            'connection.close, or connection.tune during handshake; got %s',
              inspect(frame, false))));
          break;
      }
    });
  };

  var start2 = function(rawMessage) {
    messageToBuffer(rawMessage, function(err, frame) {
      if(frame.id !== defs.ConnectionOpenOk) {
        return openCallback(new Error(fmt('Expected %s; got %s',
          methodName(defs.ConnectionStart), inspect(frame, false))));
      }
      self.channelMax = tunedOptions.channelMax || 0xffff;
      self.frameMax = tunedOptions.frameMax || 0xffffffff;
      self.heartbeat = tunedOptions.heartbeat;
      self.heartbeater = self.startHeartbeater();
      self.accept = function(frame) {
        var rec = this.channels[frame.channel];
        if(rec) {
          return rec.channel.accept(frame);
        } else {
          this.closeWithError(fmt('Frame on unknown channel %d', frame.channel),
            constants.CHANNEL_ERROR,
            new Error(fmt('Frame on unknown channel: %s',
              inspect(frame, false)))
          );
        }
      }
      self.webSocket.removeEventListener('message', start2);
      self.webSocket.addEventListener('message', function(rawMessage) {
        messageToBuffer(rawMessage, function(err, frame) {
          var rec = self.channels[frame.channel];
          if(rec) {
            return rec.channel.accept(frame);
          }
        });
      });
      openCallback(null, true);
    });
  };

  this.webSocket.addEventListener('message', start0);
  this.sendProtocolHeader();
};

// Closing things: AMQP has a closing handshake that applies to
// closing both connects and channels. As the initiating party, I send
// Close, then ignore all frames until I see either CloseOK --
// which signifies that the other party has seen the Close and shut
// the connection or channel down, so it's fine to free resources; or
// Close, which means the other party also wanted to close the
// whatever, and I should send CloseOk so it can free resources,
// then go back to waiting for the CloseOk. If I receive a Close
// out of the blue, I should throw away any unsent frames (they will
// be ignored anyway) and send CloseOk, then clean up resources. In
// general, Close out of the blue signals an error (or a forced
// closure, which may as well be an error).
//
//  RUNNING [1] --- send Close ---> Closing [2] ---> recv Close --+
//     |                               |                         [3]
//     |                               +------ send CloseOk ------+
//  recv Close                   recv CloseOk
//     |                               |
//     V                               V
//  Ended [4] ---- send CloseOk ---> Closed [5]
//
// [1] All frames accepted; getting a Close frame from the server
// moves to Ended; client may initiate a close by sending Close
// itself.
// [2] Client has initiated a close; only CloseOk or (simulataneously
// sent) Close is accepted.
// [3] Simultaneous close
// [4] Server won't send any more frames; accept no more frames, send
// CloseOk.
// [5] Fully closed, client will send no more, server will send no
// more. Signal 'close' or 'error'.
//
// There are two signalling mechanisms used in the API. The first is
// that calling `close` will return a promise, that will either
// resolve once the connection or channel is cleanly shut down, or
// will reject if the shutdown times out.
//
// The second is the 'close' and 'error' events. These are
// emitted as above. The events will fire *before* promises are
// resolved.

// Close the connection without even giving a reason. Typical.
C.close = function(closeCallback) {
  var k = closeCallback && function() { closeCallback(null); };
  this.closeBecause('Cheers, thanks', constants.REPLY_SUCCESS, k);
};

C.closeBecause = function(reason, code, k) {
  this.sendMethod(0, defs.ConnectionClose, {
    replyText: reason,
    replyCode: code,
    methodId: 0, classId: 0
  });
  var s = stackCapture('closeBecause called: ' + reason);
  this.toClosing(s, k);
};

C.closeWithError = function(reason, code, error) {
  this.emit('error', error);
  this.closeBecause(reason, code);
};

C.onSocketError = function(err) {
  if(!this.expectSocketClose) {
    this.expectSocketClose = true;
    this.emit('error', err);
    var s = stackCapture('Socket error');
    this.toClosed(s, err);
  }
};

C.toClosing = function(capturedStack, k) {
  var send = this.sendMethod.bind(this);
  this.accept = function(f) {
    if(f.id === defs.ConnectionCloseOk) {
      if(k) k();
      var s = stackCapture('ConnectionCloseOk received');
      this.toClosed(s, undefined);
    } else if(f.id === defs.ConnectionClose) {
      send(0, defs.ConnectionCloseOk, {});
    }
  };
  invalidateSend(this, 'Connection closing', capturedStack);
};

C._closeChannels = function(capturedStack) {
  for (var i = 1; i < this.channels.length; i++) {
    var ch = this.channels[i];
    if(ch !== null) {
      ch.channel.toClosed(capturedStack); // %%% or with an error? not clear
    }
  }
};

C.toClosed = function(capturedStack, maybeErr) {
  this._closeChannels(capturedStack);
  var info = fmt('Connection closed (%s)', maybeErr ?
    maybeErr.toString() : 'by client');
  invalidateSend(this, info, capturedStack);
  this.accept = invalidOp(info, capturedStack);
  this.close = function(cb) {
    cb && cb(new IllegalOperationError(info, capturedStack));
  };
  if(this.heartbeater) {
    this.heartbeater.clear();
  }
  this.expectSocketClose = true;
  this.webSocket.close();
  this.emit('close', maybeErr);
};

C.startHeartbeater = function() {
  if(this.heartbeat === 0) return null;
  else {
    var self = this;
    var hb = new Heart(this.heartbeat, this.checkSend.bind(this),
      this.checkRecv.bind(this));
    hb.on('timeout', function() {
      var hberr = new Error('Heartbeat timeout');
      var s = stackCapture('Heartbeat timeout');
      self.toClosed(s, hberr);
    });
    hb.on('beat', function() {
      self.sendHeartbeat();
    });
    return hb;
  }
};

C.freshChannel = function(channel) {
  var self = this;
  var next = this.freeChannels.nextClearBit(1);
  if(next < 0 || next > this.channelMax) {
    throw new Error('No channels left to allocate');
  }
  this.freeChannels.set(next);
  this.channels[next] = {
    channel: channel,
    webSocket: self.webSocket
  };
  return next;
};

C.releaseChannel = function(channel) {
  this.freeChannels.clear(channel);
  this.channels[channel] = null;
};

C.checkSend = function() {
  var check = this.sentSinceLastCheck;
  this.sentSinceLastCheck = false;
  return check;
}

C.checkRecv = function() {
  var check = this.recvSinceLastCheck;
  this.recvSinceLastCheck = false;
  return check;
}

C.sendBytes = function(bytes) {
  this.sentSinceLastCheck = true;
  this.webSocket.send(bytes);
};

C.sendHeartbeat = function() {
  return this.sendBytes(frame.HEARTBEAT_BUF);
};

C.sendMethod = function(channel, Method, fields) {
  var frame = encodeMethod(Method, channel, fields);
  this.sentSinceLastCheck = true;
  return this.channels[channel].webSocket.send(frame);
};

C.sendMessage = function(channel, Method, fields, Properties, props, content) {
  if(!Buffer.isBuffer(content)) {
    throw new TypeError('content is not a buffer');
  }
  var mframe = encodeMethod(Method, channel, fields);
  var pframe = encodeProperties(Properties, channel, content.length, props);
  var webSocket = this.channels[channel].webSocket;
  this.sentSinceLastCheck = true;
  var methodHeaderLen = mframe.length + pframe.length;
  var bodyLen = (content.length > 0) ? content.length + FRAME_OVERHEAD : 0;
  var allLen = methodHeaderLen + bodyLen;
  var offset;
  if(allLen < SINGLE_CHUNK_THRESHOLD) {
    var all = new Buffer(allLen);
    offset = mframe.copy(all, 0);
    offset += pframe.copy(all, offset);
    if(bodyLen > 0) {
      makeBodyFrame(channel, content).copy(all, offset);
    }
    return webSocket.send(all);
  } else {
    if(methodHeaderLen < SINGLE_CHUNK_THRESHOLD) {
      var both = new Buffer(methodHeaderLen);
      offset = mframe.copy(both, 0);
      pframe.copy(both, offset);
      webSocket.send(both);
    } else {
      webSocket.send(mframe);
      webSocket.send(pframe);
    }
    return this.sendContent(channel, content);
  }
};

C.sendContent = function(channel, body) {
  if(!Buffer.isBuffer(body)) {
    throw new TypeError(fmt('Expected buffer; got %s', body));
  }
  var writeResult = true;
  var webSocket = this.channels[channel].webSocket;
  var maxBody = this.frameMax - FRAME_OVERHEAD;
  for(var offset=0; offset<body.length; offset+=maxBody) {
    var end = offset + maxBody;
    var slice = (end > body.length) ? body.slice(offset) :
      body.slice(offset, end);
    var bodyFrame = makeBodyFrame(channel, slice);
    webSocket.send(bodyFrame);
    writeResult = true;
  }
  this.sentSinceLastCheck = true;
  return writeResult;
};

C.recvFrame = function(incoming) {
  var self = this;
  var frame = parseFrame(this.rest, this.frameMax);
  if(!frame) {
    if(!incoming) {
      return false;
    } else {
      self.recvSinceLastCheck = true;
      self.rest = Buffer.concat([self.rest, incoming]);
      return self.recvFrame();
    }
  } else {
    this.rest = frame.rest;
    return decodeFrame(frame);
  }
};

function isFatalError(error) {
  switch(error && error.code) {
    case defs.constants.CONNECTION_FORCED:
    case defs.constants.REPLY_SUCCESS:
      return false;
    default:
      return true;
  }
}

module.exports.WebSocketConnection = WebSocketConnection;
module.exports.isFatalError = isFatalError;
