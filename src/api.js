import { promisify } from 'node:util'

import { connect as raw_connect } from './connect.js'
import { ChannelModel } from './channel_model.js'
import { CallbackModel } from './callback_model.js'

// Unified connect function that supports both callback and promise styles
export function connect(url, options, cb) {
  // Handle different argument patterns
  if (typeof url === 'function') {
    cb = url
    url = undefined
    options = undefined
  } else if (typeof options === 'function') {
    cb = options
    options = undefined
  }

  // If callback is provided, use callback style
  if (typeof cb === 'function') {
    return raw_connect(url, options, function (err, conn) {
      if (err === null) {
        cb(null, new CallbackModel(conn))
      } else {
        cb(err)
      }
    })
  }

  // Otherwise return a promise
  return promisify((cb) => raw_connect(url, options, cb))().then(
    (conn) => new ChannelModel(conn)
  )
}
