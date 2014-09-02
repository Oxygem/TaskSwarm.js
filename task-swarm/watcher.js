// TaskSwarm
// File: task-swarm/watcher.js
// Desc: watch active tasks

'use strict';

var net = require('net'),
    events = require('events'),
    util = require('util'),
    redis = require('redis'),
    netev = require('netev'),
    utils = require('./utils.js');


var Watcher = function(config) {
    events.EventEmitter.call(this);
    this.log_prefix = '[Watcher] ';
    this.type = 'watcher';

    // Set Redis config
    this.config = utils.redisConfig(config);

    // Internal state
    this.worker_connections = {};

    // Redis
    this.redis = redis.createClient(config.redis.port, config.redis.host);
    this.redis.on('ready', function() {
        utils.log.call(this, 'Redis up');
    }.bind(this));
    this.redis.on('error', function(err) {
        utils.error.call(this, 'Redis Error', err);
    }.bind(this));

    this.watch = function(task_id, event_name, callback) {
        utils.log.call(this, 'Watching task', task_id, event_name);

        // Get task from Redis
        this.redis.hget(this.config.redis.taskPrefix + task_id, ['worker'], function(err, worker) {
            if(!worker)
                utils.error.call(this, 'No task found', task_id);

            var subscribe = function(worker) {
                worker.emit('subscribe', task_id, event_name);
                worker.on(task_id + event_name, callback);
            };

            // Connect to the worker if not already connected
            if(this.worker_connections[worker]) {
                return subscribe(this.worker_connections[worker]);
            }
            var bits = worker.split(':'),
                host = bits[0],
                port = bits[1];
            var connection = net.connect({
                host: host,
                port: port
            });

            // When connect, immediately netev up
            connection.on('connect', function() {
                var worker_connection = netev(connection, this.config.debug_netev);
                // Immediately identify
                worker_connection.emit('watcher-identify');

                // When we get their identify, subscribe
                worker_connection.on('worker-identify', function(hostport) {
                    this.worker_connections[hostport] = worker_connection;
                    subscribe(worker_connection);
                    utils.log.call(this, 'Connected to worker: ' + host + ':' + port);
                }.bind(this));

                // Capture non-found tasks (shouldn't happen!)
                worker_connection.on('no-task', function(task_id) {
                    utils.error.call(this, 'Worker does not have task', task_id);
                }.bind(this));
            }.bind(this));

            // Fail!
            connection.on('error', function() {
                utils.log.call(this, 'Could not reach worker: ' + host + ':' + port);
            }.bind(this));
        }.bind(this));
    };

    utils.log.call(this, 'Watcher started!');
};

module.exports = Watcher;
