var raw_connect = require('./lib/connect').connect;
var ChannelModel = require('./lib/channel_model').ChannelModel;

function connect(url, connOptions) {
  return raw_connect(url, connOptions).then(ChannelModel);
};

module.exports.connect = connect;
