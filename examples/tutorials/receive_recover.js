#!/usr/bin/env node

var amqp = require('amqplib');
var recoverable = require('amqplib/recoverable_connection');
var shouldRecoverForced = false;

// Check if we should recover from the error
function shouldRecover(error, recover_forced) {
  if(recoverable.isProtocolError(error)){
    return recover_forced && recoverable.isConnectionForced(error);
  } else {
    return true;
  }
}


// Callback to maybe reconnect when connection error occurs
function onConnectionError(error) {
  console.warn("Connection error");
  console.warn(err);
  // Do not recover on protocol errors
  if(! recoverable.isProtocolError(error)) {
    console.log("Recovering connection after 2 seconds");
    setTimeout(connect, 2000);
  } else {
    throw err;
  }
};

// Callback to maybe reconnect when connection is closed by the server
function onConnectionClosed(error) {
  if(recoverable.isConnectionForced(error) && shouldRecoverForced) {
    console.warn("Connection forced.");
    console.log("Recovering connection after 2 seconds");
    setTimeout(connect, 2000);
  } else {
    return;
  }
};

// Callback to maybe reconnect when a client fails to connect
function connectionFailure(error){
  console.warn("Connection failure");
  console.warn(error);
  console.log("Reconnecting in 2 seconds");
  setTimeout(connect, 2000);
}

// Connection established callback
function connectionOK(conn) {
  conn.on('error', onConnectionError);
  conn.on('close', onConnectionClosed);

  // Application logic goes here
  return conn.createChannel().then(function(ch) {

    var ok = ch.assertQueue('hello', {durable: false});

    ok = ok.then(function(_qok) {
      return ch.consume('hello', function(msg, ch) {
        console.log(" [x] Received '%s'", msg.content.toString());
        ch.ack(msg);
      });
    });

    return ok.then(function(_consumeOk) {
      console.log(' [*] Waiting for messages. To exit press CTRL+C');
    });
  });
}


// Function to call to (re)connect
function connect() {
  amqp.connect('amqp://localhost').then(connectionOK, connectionFailure);
}

connect();
