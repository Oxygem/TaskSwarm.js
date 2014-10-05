// TaskSwarm
// File: task-swarm/monitor.js
// Desc: monitors tasks and requeues when necessary

'use strict';

var net = require('net'),
    util = require('util'),
    events = require('events'),
    redis = require('haredis'),
    utils = require('./utils.js');


var Monitor = function(config) {
    events.EventEmitter.call(this);
    this.log_prefix = '[Monitor] ';
    this.paused = false;
    this.type = 'monitor';

    // Defaults
    config.checkTaskInterval = config.checkTaskInterval || 15000,
    config.fetchWorkerInterval = config.fetchWorkerInterval || 15000,
    config.taskTimeout = config.taskTimeout || 15000,
    config.partitionPercentage = config.partitionPercentage || 60;
    // Set Redis config
    this.config = utils.redisConfig(config);

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
                    utils.log.call(this, 'Not enough workers! Assuming network partition...');
                    this.paused = true; // stop checking tasks
                }
            });
        }
        utils.error.call(this, 'Redis Error', err);
    }.bind(this));

    var requeueTask = function(task_id) {
        utils.log.call(this, 'Requeueing task...', task_id);
        var task_key = this.config.redis.taskPrefix + task_id;

        // Get the task data
        this.redis.hget(task_key, ['data'], function(err, reply) {
            // Atomically remove task-id hash and push original task_data to new-task list
            this.redis.multi()
            .srem(this.config.redis.taskSet, task_id)
            .hdel(task_key, ['state', 'start', 'update', 'worker', 'data'])
            .lpush(this.config.redis.newQueue, reply)
            .exec(function(err, reply) {
                utils.log.call(this, 'Task requeued', task_id);
            }.bind(this));
        }.bind(this));
    };

    var removeTask = function(task_id) {
        utils.log.call(this, 'Removing task...', task_id);

        // Atomically remove task-id hash and task_id list from tasks list
        this.redis.multi()
        .srem(this.config.redis.taskSet, task_id)
        .hdel(this.config.redis.taskPrefix + task_id, ['state', 'start', 'update', 'worker', 'data'])
        .exec(function(err, reply) {
            utils.log.call(this, 'Task removed', task_id);
        }.bind(this));
    };

    // Move a task for manual cleanup
    var moveEndTask = function(task_id) {
        // Move off tasks into end-task, external must remove hashes
        this.redis.multi()
        .srem(this.config.reids.taskSet, task_id)
        .lpush(this.config.redis.endQueue, task_id)
        .exec(function(err, reply) {
            utils.log.call(this, 'Task moved to end queue', task_id);
        }.bind(this));
    };

    var checkTasks = function(task_ids) {
        utils.log.call(this, 'Checking tasks', task_ids);

        // Loop each task, requeuing or removing as required
        for(var i=0; i<task_ids.length; i++) {
            (function(i) {
                // Get task state and update
                var task_id = task_ids[i];
                this.redis.hmget(this.config.redis.taskPrefix + task_id, ['state', 'update', 'data'], function(err, reply) {

                    var state = reply[0],
                        update = reply[1],
                        task_data = JSON.parse(reply[2]),
                        data = JSON.parse(task_data.data);

                    // Check update within time limit
                    if(state === 'RUNNING') {
                        var now = new Date().getTime();
                        // Requeue if not
                        if(now - update > this.config.taskTimeout) {
                            requeueTask.call(this, task_id);
                        }
                    // Clean up
                    } else if(state === 'END') {
                        // If the task is to be manually cleaned up
                        if(data.manual_end) {
                            moveEndTask.call(this, task_id);
                        } else {
                            removeTask.call(this, task_id);
                        }
                    // Unknown state
                    } else {
                        // Log alien state
                        utils.error.call(this, 'Task in alien state', task_id);
                    }
                }.bind(this));
            }.bind(this))(i);
        }
    };

    var checkAllTasks = function() {
        if(this.paused) return;

        // Get all task ID's from Redis
        this.redis.smembers(this.config.redis.taskSet, function(err, reply) {
            if(reply.length > 0)
                checkTasks.call(this, reply);
        }.bind(this));
    };

    // Loops
    setInterval(checkAllTasks.bind(this), this.config.checkTaskInterval);
    setInterval(utils.getWorkerList.bind(this), this.config.fetchWorkerInterval);

    utils.log.call(this, 'Monitor started!');
};

util.inherits(Monitor, events.EventEmitter);
module.exports = Monitor;
