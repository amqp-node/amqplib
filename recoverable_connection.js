var channel_api = require('./channel_api');
var callback_api = require('./callback_api');
var connection = require('./lib/connection');

function connectChannelApi(url, conn_options, connOk, connFailed) {
    return channel_api.connect(url, conn_options).then(connOk, connFailed);
}

function connectCallbackApi(url, conn_options, connOk, connFailed) {
    return callback_api.connect(url, conn_options, function(err, conn){
        if(err) {
            return connFailed(err);
        } else {
            return connOk(conn);
        }
    });
}

function shouldRecover(error, recover_forced) {
    if(connection.isProtocolError(error)){
        return recover_forced && connection.isConnectionForced(error);
    } else {
        return true;
    }
}

function reconnectAfter(reconnect, timeout, randomised_delay) {
    var actual_timeout = timeout + Math.floor(Math.random() * randomised_delay);
    setTimeout(reconnect, actual_timeout);
}

function recoverableConnection(urls, conn_options, reconnect_options, callback) {
    var recover_forced = reconnect_options && (reconnect_options.recover_forced === true);
    var randomised_delay = (reconnect_options && reconnect_options.randomised_delay) || 0;
    var timeout = (reconnect_options && reconnect_options.timeout) || 2000;
    var attempts = (reconnect_options && reconnect_options.attempts) || 5;
    var api = (reconnect_options && reconnect_options.api) || 'channel_api';

    var attempts_current = attempts;
    var next_url = 0;

    // Connection OK handler
    var onConnectionOK;
    // Connection failure if unable to connect
    var onConnectionFailed;
    // Connection closed. Will recover if server-side close recover configured.
    var onConnectionClosed;
    // Connection error if established connection fails
    var onConnectionError;
    // Reconnect function
    var reconnect;

    onConnectionError = function(error) {
        // Do not recover on protocol errors
        if(! connection.isProtocolError(error)) {
            reconnectAfter(reconnect, timeout, randomised_delay)
        } else {
            return callback(error);
        }
    };

    onConnectionClosed = function(error) {
        if(connection.isConnectionForced(error) && recover_forced) {
            reconnectAfter(reconnect, timeout, randomised_delay)
        } else {
            return;
        }
    };

    onConnectionOK = function(conn) {
        // Connection succeded. Reset attempts.
        attempts_current = attempts;
        conn.on('error', onConnectionError);
        conn.on('close', onConnectionClosed);
        return callback(null, conn);
    };

    onConnectionFailed = function(error) {
        attempts_current--;
        if(attempts_current <= 0) {
            return callback(error);
        } else {
            reconnectAfter(reconnect, timeout, randomised_delay)
        }
    };

    reconnect = function(){
        var url_used;
        if(Array.isArray(urls)){
            if(urls[next_url] === undefined){
                next_url = 0;
            }
            url_used = urls[next_url];
            next_url++;
        } else {
            url_used = urls;
        }
        switch(api) {
        case 'callback_api':
            return connectCallbackApi(url_used, conn_options,
                                      onConnectionOK, onConnectionFailed);
            break;
        default:
            return connectChannelApi(url_used, conn_options,
                                     onConnectionOK, onConnectionFailed);
            break;
        }
    };

    return reconnect();
}

module.exports.recoverableConnection = recoverableConnection;
module.exports.isProtocolError = connection.isProtocolError;
module.exports.isConnectionForced = connection.isConnectionForced;


