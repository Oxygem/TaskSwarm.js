// TaskSwarm
// File: task-swarm/monitor.js
// Desc: monitors tasks and requeues when necessary

'use strict';

var net = require('net'),
    util = require('util'),
    events = require('events'),
    redis = require('redis'),
    utils = require('./utils.js');


var Monitor = function(config) {
    events.EventEmitter.call(this);
    this.log_prefix = '[Monitor] ';
    this.paused = false;
    this.type = 'monitor';

    // Defaults & set config
    config.checkTaskInterval = config.checkTaskInterval || 30000,
    config.fetchWorkerInterval = config.fetchWorkerInterval || 15000;
    this.config = config;

    // Internal state
    this.workers = [],
    this.worker_connections = {};

    // Redis
    this.redis = redis.createClient(config.redis.port, config.redis.host);
    this.redis.on('ready', function() {
        this.redis_up = true;
        this.paused = false; // never pause when Redis is up
        utils.getWorkerList.call(this);
        utils.log.call(this, 'Redis up');
    }.bind(this));
    // When we disconnect from Redis - ping all workers
    // if % returned is < configured amount of in-memory host list, stop tasks
    this.redis.on('error', function(err) {
        if(this.redis_up) {
            this.redis_up = false;
            utils.pingAllWorkers.call(this, function(percentage) {
                if(percentage < this.config.partitionPercentage) {
                    this.paused = true; // stop checking tasks
                }
            });
        }
        utils.error.call(this, 'Redis Error', err);
    }.bind(this));

    var checkAllTasks = function() {
        if(this.paused) return;

        // Get all task ID's from Redis
        this.redis.smembers('tasks', function(err, reply) {
            console.log(reply);
        }.bind(this));

        // Check each one, requeueing if dead
    };

    // Loops
    setInterval(checkAllTasks.bind(this), config.checkTaskInterval);
    setInterval(utils.getWorkerList.bind(this), this.config.fetchWorkerInterval);

    utils.log.call(this, 'Monitor started!');
};

util.inherits(Monitor, events.EventEmitter);
module.exports = Monitor;
