var raw_connect = require('./lib/connect').connect;
var CallbackModel = require('./lib/callback_model').CallbackModel;

// Supports three shapes:
// connect(url, options, callback)
// connect(url, callback)
// connect(callback)
function connect(url, options, cb) {
  if (typeof url === 'function')
    cb = url, url = false, options = false;
  else if (typeof options === 'function')
    cb = options, options = false;

  raw_connect(url, options).then(function(c) {
    cb(null, new CallbackModel(c));
  }, cb).then(null, function(err) {
    setImmediate(function() { throw err; });
  });;
};

module.exports.connect = connect;
