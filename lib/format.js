//
//
//

// Stringifying various things

var defs = require('./defs');
var format = require('util').format;
var Frames = require('./frame');
var inherits = require('util').inherits;

module.exports.closeMessage = function(close) {
  return close.fields.replyCode + ' - ' + close.fields.replyText;
}

module.exports.methodName = function(id) {
  return defs.info(id).name;
};

function inspectFrame(frame, showFields) {
  if (frame === Frames.Heartbeat) {
    return '<Heartbeat>';
  }
  else if (!frame.id) {
    return format('<Content channel:%d size:%d>',
                  frame.channel, frame.size);
  }
  else {
    var info = defs.info(frame.id);
    return format('<%s channel:%d%s>', info.name, frame.channel,
                  (showFields)
                  ? ' ' + JSON.stringify(frame.fields, undefined, 2)
                  : '');
  }
}

module.exports.inspect = inspectFrame;
