var raw_connect = require('./lib/connect').connect;
var ChannelModel = require('./lib/channel_model').ChannelModel;
var Promise = require('bluebird');

function connect(url, connOptions) {
  return Promise.fromCallback(function(cb) {
    return raw_connect(url, connOptions, cb);
  })
  .then(function(conn) {
    return new ChannelModel(conn);
  });
};

module.exports.connect = connect;
module.exports.credentials = require('./lib/credentials');
module.exports.IllegalOperationError = require('./lib/error').IllegalOperationError;
