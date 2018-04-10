'use strict';

var Promise = require('bluebird');
var http = require('http');
const url = require('url');

const MGMT_URL = process.env.MGMT_URL || 'http://localhost:15672/api';

const headers = {'Authorization': 'Basic Z3Vlc3Q6Z3Vlc3Q=', 'content-type': 'application/json'};


function make_opts(path, method) {
  var options = url.parse(MGMT_URL + path);
  options.headers = headers;
  if(method) {
    options.method = method;
  }
  return options;
}

function closeAllConn(vhost) {
  return function(on_good, on_error) {
    // console.log("Call get");
    var options = make_opts('/vhosts/' + encodeURIComponent(vhost) + '/connections');
    http.get(options, function(res) {
      // console.log("get respo");
      let data = '';
      res.on('data', function(chunk){
        data += chunk;
      });
      res.on('end', function(){
        var connections = JSON.parse(data);
        var conn_name = JSON.parse(data)[0].name;
        var options = make_opts('/connections/' + encodeURIComponent(conn_name), 'DELETE');
        http.request(options, function(resp){
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
      var options = make_opts('/vhosts/' + encodeURIComponent(vhost), 'PUT');
      http.request(options, function(resp) {
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
    var options = make_opts('/vhosts/' + encodeURIComponent(vhost), 'DELETE');
    http.request(options, function(resp) {
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
    var options = make_opts('/exchanges/' + encodeURIComponent(vhost) + "/" + encodeURIComponent(exchange), 'DELETE');
    http.request(options, function(resp) {
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
    var options = make_opts('/queues/' + encodeURIComponent(vhost) + "/" + encodeURIComponent(queue), 'DELETE');
    http.request(options, function(resp) {
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
    var options = make_opts('/vhosts/' + encodeURIComponent(vhost) + '/channels');
    http.get(options, function(res) {
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

function assertBinding(vhost, dest, source, routing_key, args) {
  return function(on_good, on_error) {
    var options = make_opts('/exchanges/' + encodeURIComponent(vhost) + '/' + encodeURIComponent(source) + '/bindings/source');
    http.get(options, function(res) {
      let data = '';
      res.on('data', function(chunk){
        data += chunk;
      });
      res.on('end', function(){
        var bindings = JSON.parse(data);
        var matching_bindings = bindings.filter(function(binding){
          var argt;
          if(args == undefined) {
            argt = {};
          } else {
            argt = args;
          }
          return binding.source == source &&
                 binding.destination == dest &&
                 binding.routing_key == routing_key &&
                 JSON.stringify(binding.arguments) == JSON.stringify(argt);
        });
        if(matching_bindings.length === 1) {
          on_good();
        } else {
          on_error(new Error("Bindings do not match. Binding: " +
                             JSON.stringify({source: source, destination: dest, routing_key: routing_key, arguments: args}) +
                             "\n Matched: " + JSON.stringify(matching_bindings)) +
                             "\n All bindings: " + JSON.stringify(bindings));
        }
      });
    });
  }
}

function assertExchangeArguments(vhost, ex_name, type, args) {
  return function(on_good, on_error) {
    var options = make_opts('/exchanges/' + encodeURIComponent(vhost) + '/' + encodeURIComponent(ex_name));
    http.get(options, function(res) {
      let data = '';
      res.on('data', function(chunk){
        data += chunk;
      });
      res.on('end', function(){
        var exchange = JSON.parse(data);
        var match = exchange.name == ex_name &&
                    exchange.type == type &&
                    JSON.stringify(exchange.arguments) == JSON.stringify(args);
        if(match){
          on_good();
        } else {
           on_error(new Error("Exchange does not match. Exchange: " +
                              JSON.stringify({name: ex_name, type: type, arguments: args}) +
                              "\n Actual: " + JSON.stringify(exchange)));
        }
      });
    });
  }
}

function assertQueueArguments(vhost, q_name, args) {
  return function(on_good, on_error) {
    var options = make_opts('/queues/' + encodeURIComponent(vhost) + '/' + encodeURIComponent(q_name));
    http.get(options, function(res) {
      let data = '';
      res.on('data', function(chunk){
        data += chunk;
      });
      res.on('end', function(){
        var queue = JSON.parse(data);
        var match = queue.name == q_name &&
                    JSON.stringify(queue.arguments) == JSON.stringify(args);
        if(match){
          on_good();
        } else {
           on_error(new Error("Exchange does not match. Exchange: " +
                              JSON.stringify({name: q_name, arguments: args}) +
                              "\n Actual: " + JSON.stringify(queue)));
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
    assertBinding: assertBinding,
    assertExchangeArguments: assertExchangeArguments,
    assertQueueArguments: assertQueueArguments
};
