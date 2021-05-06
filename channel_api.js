var raw_connect = require('./lib/connect').connect;
var ChannelModel = require('./lib/channel_model').ChannelModel;

function connect(url, connOptions) {
  return new Promise(function (resolve, reject) {
    raw_connect(url, connOptions, function (err, result) {
      if (err) {
        reject(err);
      } else {
        resolve(result);
      }
    })
  })
  .then(function(conn) {
    return new ChannelModel(conn);
  });
};

module.exports.connect = connect;
module.exports.credentials = require('./lib/credentials');
module.exports.IllegalOperationError = require('./lib/error').IllegalOperationError;
