// TaskSwarm
// File: task-swarm/worker.js
// Desc: the worker

'use strict';

var net = require('net'),
    events = require('events'),
    util = require('util'),
    redis = require('redis'),
    netev = require('netev'),
    utils = require('./utils.js');


var Worker = function(config) {
    var self = this;

    events.EventEmitter.call(this);
    this.log_prefix = '[Worker ' + config.host + ':' + config.port + '] ';
    this.type = 'worker';

    // Defaults & set config
    config.fetchTaskInterval = config.fetchTaskInterval || 1500,
    config.fetchWorkerInterval = config.fetchWorkerInterval || 15000,
    config.partitionPercentage = config.partitionPercentage || 60;
    this.config = config;

    // Internal state
    this.workers = [],
    this.worker_connections = {},
    this.tasks = {},
    this.task_functions = {};

    // Start the other workers connect to
    this.server = net.Server();
    this.server.listen(this.config.port, this.config.host);
    this.server.on('connection', function(stream) {
        addWorker.call(this, stream);
    }.bind(this));
    this.server.on('error', function(err) {
        utils.error.call(this, err.toString());
        process.exit(1);
    }.bind(this));
    this.server.on('listening', function() {
        utils.log.call(this, 'Listening for other workers', 'port ' + this.config.port);
    }.bind(this));

    // Redis
    this.redis = redis.createClient(config.redis.port, config.redis.host);
    this.redis.on('ready', function() {
        // Add/set ourselves in Redis
        this.redis.sadd('workers', this.config.host + ':' + this.config.port);
        this.redis_up = true;
        utils.getWorkerList.call(this);
        utils.log.call(this, 'Redis up');
    }.bind(this));
    // When we disconnect from Redis - ping all workers
    // if % returned is < configured amount of in-memory host list, stop tasks
    this.redis.on('error', function(err) {
        if(this.redis_up) {
            this.redis_up = false;
            setTimeout(function() {
                utils.pingAllWorkers.call(this, function(percentage) {
                    if(percentage < this.config.partitionPercentage) {
                        this.stopAllTasks();
                    } else {
                        utils.log.call(this, percentage + '% of workers accessible, not pausing');
                    }
                }.bind(this));
            // HORRIBLE HACK
            // without this, we basically spam connections on Redis down
            // nothing particularly negative, but pointless bandwidth
            // need: a way for independant workers to cooperate when Redis is down
            // maybe: give all workers a unique timeout, shared via Redis like the list?
            }.bind(this), Math.random() * 1000);
        }
        utils.error.call(this, 'Redis Error', err);
    }.bind(this));

    // Add another worker (which may also be a monitor!)
    var addWorker = function(stream) {
        // Immediately netev this!
        var worker = netev(stream, this.config.debug_netev, this.config.port);

        // Assign internally once they identify
        worker.on('worker-identify', function(hostport) {
            worker.emit('worker-identify', this.config.host + ':' + this.config.port);
            this.worker_connections[hostport] = worker;

            // Reply to pings
            worker.on('ping', function() {
                worker.emit('pong');
            });

            utils.log.call(this, 'Worker connected: ' + hostport);
        }.bind(this));

        // Oh, you're not a worker but a monitor. Pings only!
        worker.on('monitor-identify', function(hostport) {
            // Reply to pings
            worker.on('ping', function() {
                worker.emit('pong');
            });

            utils.log.call(this, 'Monitor connected: ' + hostport);
        }.bind(this));
    };

    // Add & start a task on this worker
    var addTask = function(task) {
        // Events used to send signals to the task (which normally refers to the object as 'manager')
        // + some helper functions for nice debugging
        var evs = new events.EventEmitter();
        evs.log = function() {
            var args = Array.prototype.slice.call(arguments, 0);
            args.unshift('[task: ' + task.id + ']');
            utils.log.apply(this, args);
        }.bind(this),
        evs.error = function() {
            var args = Array.prototype.slice.call(arguments, 0);
            args.unshift('[task: ' + task.id + ']');
            utils.error.apply(this, args);
        }.bind(this);

        // Create new 'process' object from task_functions
        // tasks are eventemitters, so we subscribe to it
        var process = new this.task_functions[task.function](evs, task);

        // Subscribe to its _events
        process.on('_stop', function() {
            utils.log.call(this, 'task stopped', hostname, task.id);
            // Set state to STOPPED in Redis (distributor cleans up)
            this.redis.hset('task-' + task.id, 'state', 'STOPPED');
        }.bind(this));
        process.on('_update', function() {
            this.redis.hset('task-' + task.id, 'update', new Date().getTime());
        }.bind(this));
        process.on('_end', function() {
            utils.log.call(this, 'task ended', task.id);
            this.redis.hset('task-' + task.id, 'state', 'END');
        }.bind(this));

        // Store the task internally
        this.tasks[task.id] = {
            process: process,
            events: evs
        };

        utils.log.call(this, 'task added', task.id);
    };

    // Check Redis for new tasks, prepare for worker
    var getNewTasks = function() {
        this.redis.rpop('new-task', function(err, reply) {
            if(!reply) return;
            if(err)
                return utils.error.call(this, err);

            var task_data;
            try {
                task_data = JSON.parse(reply);
            } catch(e) {
                return utils.error.call(this, 'invalid task JSON', reply);
            }
            if(!task_data.id || !task_data.function || !task_data.data) {
                return utils.error.call(this, 'invalid task', task_data);
            }

            var task_key = 'task-' + task_data.id,
                now = new Date().getTime();

            // Copy task_id into Redis list & task_data atomically
            this.redis.multi()
                .sadd('tasks', task_data.id)
                .hset(task_key, 'state', 'RUNNING')
                .hset(task_key, 'start', now)
                .hset(task_key, 'update', now)
                .hset(task_key, 'worker', this.config.host + ':' + this.config.port)
                .hset(task_key, 'data', JSON.stringify(task_data))
                // On callback we can now add the task locally
                .exec(function(err, replies) {
                    addTask.call(this, task_data);
                }.bind(this));
        }.bind(this));
    };

    this.addTaskFunction = function(task_name, object) {
        this.task_functions[task_name] = object;
        utils.log.call(this, 'task added', task_name);
    };

    this.stopTask = function(task_id) {
        var task = this.tasks[task_id];
        if(!task) return false;

        // Send stop event to task
        task.events.emit('stop');
        utils.log.call(this, 'requested task stop', task_id);
    };

    this.stopAllTasks = function() {
        utils.log.call(this, 'stopping all tasks...');
        for(var key in this.tasks) {
            this.stopTask(key);
        }
    };

    // Loops
    setInterval(getNewTasks.bind(this), this.config.fetchTaskInterval);
    setInterval(utils.getWorkerList.bind(this), this.config.fetchWorkerInterval);

    utils.log.call(this, 'Worker started!');
};

util.inherits(Worker, events.EventEmitter);
module.exports = Worker;