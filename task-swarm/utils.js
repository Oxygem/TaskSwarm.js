// TaskSwarm
// File: task-swarm/utils.js
// Desc: utility/shared functions!

'use strict';

var net = require('net'),
    colors = require('colors'),
    netev = require('netev');


var red = function(str) { return str.red; },
    blue = function(str) { return str.blue; },
    green = function(str) { return str.green; };

var utils = {
    redisConfig: function(config) {
        // Redis defaults
        config.redis.newQueue = config.redis.newQueue || 'new-task',
        config.redis.taskSet = config.redis.taskSet || 'tasks',
        config.redis.taskPrefix = config.redis.taskPrefix || 'task-',
        config.redis.endQueue = config.redis.endQueue || 'end-task';

        return config;
    },

    log: function(action, data) {
        if(this.config.debug) {
            data = data || '';
            var args = Array.prototype.slice.call(arguments, 2);
            if(args.length == 0) {
                console.log(green(this.log_prefix) + blue(action) + ' ' + data.toString());
            } else {
                args.unshift(green(this.log_prefix) + blue(action) + ' ' + data.toString());
                console.log.apply(console, args);
            }
        }
    },

    error: function(data) {
        var args = Array.prototype.slice.call(arguments, 1);
        if(args.length == 0) {
            console.error(red(this.log_prefix + data.toString()));
        } else {
            args.unshift(red(this.log_prefix + data.toString()));
            console.error.apply(console, args);
        }
    },

    getWorkerList: function() {
        this.redis.smembers('workers', function(err, reply) {
            if(!err) {
                var me = this.config.host + ':' + this.config.port,
                    workers = [];

                // Don't add ourselves!
                for(var i=0; i<reply.length; i++)
                    if(reply[i] != me)
                        workers.push(reply[i]);

                this.workers = workers;
                utils.log.call(this, 'Workers updated', reply);
            }
        }.bind(this));
    },

    pingAllWorkers: function(callback) {
        utils.log.call(this, 'Pinging all workers...');

        var count = this.workers.length, // target pongs
            pongs = 0, // received
            fails = 0; // timeout/similar

        var tryComplete = function() {
            if((pongs + fails) == count) {
                var percent = (pongs / count) * 100;
                utils.log.call(this,
                    percent + '% workers accessible',
                    '(' + pongs + ' pongs, ' + fails + ' fails)'
                );

                callback(percent);
            }
        }.bind(this);

        var pingWorker = function(worker) {
            try {
                worker.emit('ping');
            // Catch lost workers
            } catch(e) {
                fails++;
                return tryComplete();
            }

            var resultCallback = function() {
                pongs++;
                tryComplete();
                worker.removeListener('pong', resultCallback);
            };
            worker.on('pong', resultCallback);
        };

        for(var i=0; i<this.workers.length; i++) {
            var worker = this.workers[i];

            // Are we connected?
            if(this.worker_connections[worker]) {
                pingWorker(this.worker_connections[worker]);
                continue;
            }

            // Connect to the worker
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
                if(this.type == 'worker') {
                    worker_connection.emit('worker-identify', this.config.host + ':' + this.config.port);
                } else {
                    worker_connection.emit('monitor-identify');
                }

                // When we get their identify, ping
                worker_connection.on('worker-identify', function(hostport) {
                    this.worker_connections[hostport] = worker_connection;
                    pingWorker(worker_connection);
                    utils.log.call(this, 'Connected to worker: ' + host + ':' + port);
                }.bind(this));
            }.bind(this));

            // Fail!
            connection.on('error', function() {
                utils.log.call(this, 'Could not reach worker: ' + host + ':' + port);

                fails++;
                tryComplete();
            }.bind(this));
        }
    }
};
module.exports = utils;
