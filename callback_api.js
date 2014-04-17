var raw_connect = require('./lib/connect').connect;
var CallbackModel = require('./lib/callback_model').CallbackModel;

function connect(url, connOptions, cb) {
  raw_connect(url, connOptions).then(function(c) {
    cb(null, new CallbackModel(c));
  }, cb);
};

module.exports.connect = connect;
