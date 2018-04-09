'use strict';

var mgmt_helpers = require('./mgmt_helpers');
var Promise = require('bluebird');
var http = require('http');

var URL = process.env.URL || 'amqp://localhost';
var MGMT_URL = process.env.MGMT_URL || 'http://localhost:15672/api';



function closeAllConn(vhost) {
  return function(on_good, on_error) {
    // console.log("Call get");
    http.get({
      headers: {'Authorization': 'Basic Z3Vlc3Q6Z3Vlc3Q='},
      hostname: 'localhost',
      port: 15672,
      path: '/api/vhosts/' + encodeURIComponent(vhost) + '/connections'
    }, function(res) {
      // console.log("get respo");
      let data = '';
      res.on('data', function(chunk){
        data += chunk;
      });
      res.on('end', function(){
        var connections = JSON.parse(data);
        var conn_name = JSON.parse(data)[0].name;
        http.request({
            headers: {'Authorization': 'Basic Z3Vlc3Q6Z3Vlc3Q='},
            hostname: 'localhost',
            port: 15672,
            path: '/api/connections/' + encodeURIComponent(conn_name),
            method: 'DELETE'
        }, function(resp){
          if(resp.statusCode == 204){
            on_good();
          } else {
            on_error(new Error("Failed to close connection"));
          }
        }).end();
      });
    });
  }
}

function createVhost(vhost) {
  var delete_vhost = deleteVhost(vhost);

  return function(on_good, on_error) {
    delete_vhost(function() {
      http.request({
        headers: {'Authorization': 'Basic Z3Vlc3Q6Z3Vlc3Q=', 'content-type': 'application/json'},
        hostname: 'localhost',
        port: 15672,
        path: '/api/vhosts/' + encodeURIComponent(vhost),
        method: 'PUT'
      }, function(resp) {
        if(resp.statusCode === 201){
          on_good();
        } else {
          console.dir(resp);
          on_error(new Error("Failed to create vhost " + vhost));
        }
      }).end();
    },
    on_error);
  }
}

function deleteVhost(vhost) {
  return function(on_good, on_error) {
    http.request({
      headers: {'Authorization': 'Basic Z3Vlc3Q6Z3Vlc3Q=', 'content-type': 'application/json'},
      hostname: 'localhost',
      port: 15672,
      path: '/api/vhosts/' + encodeURIComponent(vhost),
      method: 'DELETE'
    }, function(resp) {
      if(resp.statusCode === 204 || resp.statusCode === 404){
        on_good();
      } else {
        console.dir(resp);
        on_error(new Error("Failed to delete a vhost " + vhost));
      }
    }).end();
  }
}

function deleteExchange(vhost, exchange) {
  return function(on_good, on_error) {
    http.request({
      headers: {'Authorization': 'Basic Z3Vlc3Q6Z3Vlc3Q=', 'content-type': 'application/json'},
      hostname: 'localhost',
      port: 15672,
      path: '/api/exchanges/' + encodeURIComponent(vhost) + "/" + encodeURIComponent(exchange),
      method: 'DELETE'
    }, function(resp) {
      if(resp.statusCode === 204){
        on_good();
      } else {
        console.dir(resp);
        on_error(new Error("Failed to delete an exchange " + exchange + " on vhost " + vhost));
      }
    }).end();
  }
}

function deleteQueue(vhost, queue) {
  return function(on_good, on_error) {
    http.request({
      headers: {'Authorization': 'Basic Z3Vlc3Q6Z3Vlc3Q=', 'content-type': 'application/json'},
      hostname: 'localhost',
      port: 15672,
      path: '/api/queues/' + encodeURIComponent(vhost) + "/" + encodeURIComponent(queue),
      method: 'DELETE'
    }, function(resp) {
      if(resp.statusCode === 204){
        on_good();
      } else {
        console.dir(resp);
        on_error(new Error("Failed to delete a queue " + queue + " on vhost " + vhost));
      }
    }).end();
  }
}

function assertPrefetch(vhost, prefetch) {
  return function(on_good, on_error) {
    http.get({
      headers: {'Authorization': 'Basic Z3Vlc3Q6Z3Vlc3Q='},
      hostname: 'localhost',
      port: 15672,
      path: '/api/vhosts/' + encodeURIComponent(vhost) + '/channels'
    }, function(res) {
      let data = '';
      res.on('data', function(chunk){
        data += chunk;
      });
      res.on('end', function(){
        var channels = JSON.parse(data);
        var prefetch_count = JSON.parse(data)[0].prefetch_count;
        if (prefetch_count === prefetch) {
          on_good();
        } else {
          on_error(new Error("Channel prefetch " + prefetch_count + " does not match expected prefetch " + prefetch));
        }
      });
    });
  }
}

function assertBinding(vhost, dest, source, routing_key) {
  return function(on_good, on_error) {
    http.get({
      headers: {'Authorization': 'Basic Z3Vlc3Q6Z3Vlc3Q='},
      hostname: 'localhost',
      port: 15672,
      path: '/api/exchanges/' + encodeURIComponent(vhost) + '/' + encodeURIComponent(source) + "/bindings/source"
    }, function(res) {
      let data = '';
      res.on('data', function(chunk){
        data += chunk;
      });
      res.on('end', function(){
        var bindings = JSON.parse(data);
        var matching_bindings = bindings.filter(function(binding){
          return binding.source == source &&
                 binding.destination == dest &&
                 binding.routing_key == routing_key;
        });
        if(matching_bindings.length === 1) {
          on_good();
        } else {
          on_error(new Error("Bindings do not match. Binding: " +
                             JSON.stringify({source: source, destination: dest, routing_key: routing_key}) +
                             " Matched: " + matching_bindings.toString()));
        }
      });
    });
  }
}


module.exports = {
    closeAllConn: closeAllConn,
    createVhost: createVhost,
    deleteVhost: deleteVhost,
    deleteExchange: deleteExchange,
    deleteQueue: deleteQueue,
    assertPrefetch: assertPrefetch,
    assertBinding: assertBinding
};
