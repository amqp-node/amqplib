import { connect as raw_connect } from "./lib/connect.js"
import { CallbackModel } from "./lib/callback_model.js"

// Supports three shapes:
// connect(url, options, callback)
// connect(url, callback)
// connect(callback)
export function connect(url, options, cb) {
  if (typeof url === 'function')
    cb = url, url = false, options = false;
  else if (typeof options === 'function')
    cb = options, options = false;

  raw_connect(url, options, function(err, c) {
    if (err === null) cb(null, new CallbackModel(c));
    else cb(err);
  });
};

export * as credentials from './lib/credentials.js';
export { IllegalOperationError } from './lib/error.js';
