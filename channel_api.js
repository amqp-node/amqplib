const raw_connect = require('./lib/connect').connect;
const ChannelModel = require('./lib/channel_model').ChannelModel;
const promisify = require('node:util').promisify;
const recovery = require('./lib/recovery');

function connect(url, connOptions) {
  const {connectionOptions, recovery: recoveryOptions} = recovery.splitConnectionOptions(connOptions);
  if (recovery.recoveryEnabled(recoveryOptions)) {
    const openModel = () => promisify((cb) => raw_connect(url, connectionOptions, cb))().then((conn) => new ChannelModel(conn));

    return recovery.connectWithRecoveryPromise(openModel, recoveryOptions);
  }

  return promisify((cb) => raw_connect(url, connectionOptions, cb))().then((conn) => new ChannelModel(conn));
}

module.exports.connect = connect;
module.exports.credentials = require('./lib/credentials');
module.exports.IllegalOperationError = require('./lib/error').IllegalOperationError;
