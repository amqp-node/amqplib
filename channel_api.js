import { connect } from "./lib/connect.js";
import { ChannelModel } from "./lib/channel_model.js";
import { promisify } from "util";

export function connect(url, connOptions) {
  return promisify(function(cb) {
    return raw_connect(url, connOptions, cb);
  })()
  .then(function(conn) {
    return new ChannelModel(conn);
  });
};

export * as credentials from './lib/credentials';
export { IllegalOperationError } from './lib/error';
