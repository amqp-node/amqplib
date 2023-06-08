//
//
//

// Stringifying various things


import * as defs from './defs.js';
import { format } from 'util';
import { inherits } from 'util';
import { HEARTBEAT } from './frame.js';

export function closeMessage(close) {
  const code = close.fields.replyCode;
  return format('%d (%s) with message "%s"',
                code, defs.constant_strs[code],
                close.fields.replyText);
}

export function methodName(id) {
  return defs.info(id).name;
};

export function inspect(frame, showFields) {
  if (frame === HEARTBEAT) {
    return '<Heartbeat>';
  }
  else if (!frame.id) {
    return format('<Content channel:%d size:%d>',
                  frame.channel, frame.size);
  }
  else {
    const info = defs.info(frame.id);
    return format('<%s channel:%d%s>', info.name, frame.channel,
                  (showFields)
                  ? ' ' + JSON.stringify(frame.fields, undefined, 2)
                  : '');
  }
}
