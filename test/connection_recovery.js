'use strict';

var assert = require('assert');
var defs = require('../lib/defs');
var recoverable = require('../recoverable_connection');

var Promise = require('bluebird');
var http = require('http');
var url = require('url');

var MGMT_URL = process.env.MGMT_URL || 'http://localhost:15672/api';

var headers = {'Authorization': 'Basic Z3Vlc3Q6Z3Vlc3Q=', 'content-type': 'application/json'};

var util = require('./util');
var succeed = util.succeed, fail = util.fail, latch = util.latch;

suite("Connection recovery", function() {

    test("recovers connection", function(done) {
        this.timeout(15000);
        var connects = 0;
        var vhost = 'recover_connection';
        new Promise(createVhost(vhost)).then(function() {
            recoverable.recoverableConnection(
                'amqp://localhost/' + encodeURIComponent(vhost),
                {}, {recover_forced: true, timeout: 100},
                function(err, conn){
                    if(err) {
                      return done(err);
                    } else {
                      connects++;
                      if(connects > 1) {
                        conn.close();
                        return done(err);
                      }
                    }
                }).delay(5000).then(function(){
                    return new Promise(closeAllConn(vhost));
                });
        });
    });

    test("recovers callback api connection", function(done) {
        this.timeout(15000);
        var connects = 0;
        var vhost = 'recover_connection';
        new Promise(createVhost(vhost)).then(function() {
            return recoverable.recoverableConnection(
                'amqp://localhost/' + encodeURIComponent(vhost),
                {}, {recover_forced: true, timeout: 100, api: 'callback_api'},
                function(err, conn){
                    if(err) {
                      return done(err);
                    } else {
                      connects++;
                      if(connects > 1) {
                        conn.close(function(_err, ok) {
                            return done(err);
                        });
                      }
                    }
                });
        }).delay(5000).then(function(){
            return new Promise(closeAllConn(vhost));
        });
    });

    test("rotates over multiple hosts", function(done) {
        this.timeout(15000);
        var connects = 0;
        var vhost = 'recover_connection';
        new Promise(createVhost(vhost)).then(function() {
            recoverable.recoverableConnection(
                ['amqp://localhost/' + encodeURIComponent(vhost),
                 'amqp://localhost:5673/' + encodeURIComponent(vhost)],
                {}, {recover_forced: true, timeout: 100},
                function(err, conn){
                    if(err) {
                      return done(err);
                    } else {
                      connects++;
                      if(connects > 1) {
                        conn.close();
                        return done(err);
                      }
                    }
                }).delay(5000).then(function(){
                    return new Promise(closeAllConn(vhost));
                });
        });
    });

    test("waits for timeout", function(done) {
        this.timeout(15000);
        var connects = 0;
        var vhost = 'recover_connection';
        var time;
        new Promise(createVhost(vhost)).then(function() {
            recoverable.recoverableConnection(
                'amqp://localhost/' + encodeURIComponent(vhost),
                {}, {recover_forced: true, timeout: 1000},
                function(err, conn){
                    if(err) {
                      return done(err);
                    } else {
                      connects++;
                      if(connects > 1) {
                        var recover_time = new Date();
                        assert(recover_time.getTime() > (time.getTime() + 1000));
                        conn.close();
                        return done(err);
                      }
                    }
                }).delay(5000).then(function(){
                    time = new Date();
                    return new Promise(closeAllConn(vhost));
                });
        });
    });

    test("gives up after attempts", function(done) {
        this.timeout(15000);
        var connects = 0;
        var vhost = 'recover_connection';
        new Promise(createVhost(vhost)).then(function() {
            recoverable.recoverableConnection(
                ['amqp://localhost/' + encodeURIComponent(vhost),
                 'amqp://localhost:5673/' + encodeURIComponent(vhost)],
                {}, {recover_forced: true, timeout: 100, attempts: 1},
                function(err, conn){
                    if(err) {
                      return done(null);
                      // return done(err);
                    } else {
                      connects++;
                      if(connects > 1) {
                        conn.close();
                        return done(new Error("Recovered after attempts exceeded"));
                      }
                    }
                }).delay(5000).then(function(){
                    return new Promise(closeAllConn(vhost));
                });
        });
    });
});

function closeAllConn(vhost) {
  return function(on_good, on_error) {
    // console.log("Call get");
    var options = make_opts('/vhosts/' + encodeURIComponent(vhost) + '/connections');
    http.get(options, function(res) {
      // console.log("get respo");
      var data = '';
      res.on('data', function(chunk){
        data += chunk;
      });
      res.on('end', function(){
        var connections = JSON.parse(data);
        // console.dir(connections);
        if(connections[0] !== undefined) {
          var conn_name = connections[0].name;
          var options = make_opts('/connections/' + encodeURIComponent(conn_name), 'DELETE');
          http.request(options, function(resp){
            if(Math.floor(resp.statusCode / 100) === 2){
              on_good();
            } else {
              on_error(new Error("Failed to close connection"));
            }
          }).end();
        } else {
          on_good();
        }
      });
    });
  }
}

function createVhost(vhost) {
  var delete_vhost = deleteVhost(vhost);
  return function(on_good, on_error) {
    delete_vhost(function() {
      var options = make_opts('/vhosts/' + encodeURIComponent(vhost), 'PUT');
      http.request(options, function(resp) {
        if(Math.floor(resp.statusCode / 100) === 2){
          set_permissions(vhost, on_good, on_error);
        } else {
          console.dir(resp.statusCode);
          on_error(new Error("Failed to create vhost " + vhost));
        }
      }).end();
    },
    on_error);
  }
}

function deleteVhost(vhost) {
  return function(on_good, on_error) {
    var options = make_opts('/vhosts/' + encodeURIComponent(vhost), 'DELETE');
    http.request(options, function(resp) {
      if((Math.floor(resp.statusCode / 100) === 2) || resp.statusCode === 404){
        on_good();
      } else {
        console.dir(resp.statusCode);
        on_error(new Error("Failed to delete a vhost " + vhost));
      }
    }).end();
  }
}

function make_opts(path, method) {
  var options = url.parse(MGMT_URL + path);
  options.headers = headers;
  if(method) {
    options.method = method;
  }
  return options;
}

function set_permissions(vhost, on_good, on_error) {
  var options = make_opts('/permissions/' + encodeURIComponent(vhost) + '/guest' , 'PUT');
  var data = '{"configure":".*","write":".*","read":".*"}';
  http.request(options, function(resp) {
    if(Math.floor(resp.statusCode / 100) === 2){
      on_good();
    } else {
      console.dir(resp.statusCode);
      on_error(new Error("Failed to set permissions for vhost " + vhost));
    }
  }).end(data);
}