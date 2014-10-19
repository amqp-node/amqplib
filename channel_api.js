var raw_connect = require('./lib/connect').connect;
var ChannelModel = require('./lib/channel_model').ChannelModel;
var defer = require('when').defer;

function connect(url, connOptions) {
  var opened = defer();
  raw_connect(url, connOptions, function(err, conn) {
    if (err === null) opened.resolve(new ChannelModel(conn));
    else opened.reject(err);
  });
  return opened.promise;
};

module.exports.connect = connect;
module.exports.credentials = require('./lib/credentials');
