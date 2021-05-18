const { promisify } = require('util');
const raw_connect = promisify(require('./lib/connect').connect);
var ChannelModel = require('./lib/channel_model').ChannelModel;

function connect(url, connOptions) {
  return raw_connect(url, connOptions).then(conn => new ChannelModel(conn));
}

module.exports.connect = connect;
module.exports.credentials = require('./lib/credentials');
module.exports.IllegalOperationError = require('./lib/error').IllegalOperationError;
