import { promisify } from 'node:util'

import { connect as raw_connect } from './src/connect.js'

import { ChannelModel } from './src/channel_model.js'

export * as credentials from './src/credentials.js'
export { IllegalOperationError } from './src/error.js'

export function connect(url, connOptions) {
  return promisify(function (cb) {
    return raw_connect(url, connOptions, cb)
  })().then(function (conn) {
    return new ChannelModel(conn)
  })
}
