// TaskSwarm
// File: task-swarm/worker.js
// Desc: the worker

'use strict';

var net = require('net'),
    events = require('events'),
    util = require('util'),
    redis = require('haredis'),
    netev = require('netev'),
    Promise = require('promise'),
    utils = require('./utils.js');


var Worker = function(config) {
    events.EventEmitter.call(this);
    this.log_prefix = '[Worker ' + config.host + ':' + config.port + '] ';
    this.type = 'worker';

    // Defaults
    config.fetchTaskInterval = config.fetchTaskInterval || 2000,
    config.fetchWorkerInterval = config.fetchWorkerInterval || 15000,
    config.partitionPercentage = config.partitionPercentage || 60;
    // Set Redis config
    this.config = utils.redisConfig(config);

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
        utils.log.call(this, 'Listening for workers & watchers', 'port ' + this.config.port);
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
            utils.pingAllWorkers.call(this, function(percentage) {
                if(percentage < this.config.partitionPercentage) {
                    utils.log.call(this, 'Not enough workers! Assuming network partition...');
                    this.stopAllTasks();
                }
            }.bind(this));
        }
        utils.error.call(this, 'Redis Error', err);
        if(typeof err == 'object') console.log(err.stack);
    }.bind(this));

    // On pubsub messages: externally control tasks
    this.redis.on('message', function(channel, message) {
        // Slice the start & end of the channel to get the task_id
        var task_id = channel.slice(this.config.redis.taskPrefix.length, -8);

        // No such task?
        if(!this.tasks[task_id])
            return utils.error.call(this, 'Invalid task control request: ' + task_id + ', message: ' + message);

        // Task control: stop
        if(message == 'stop') {
            this.stopTask(task_id);
        // Task control: reload (from task-data in task hash)
        } else if(message == 'reload') {
            this.reloadTask(task_id);
        // Task control: JSON event (sent to task)
        } else if(message.indexOf('{') == 0) {
            try {
                data = JSON.parse(message);
                if(!data.event_name || !data.event)
                    return utils.error.call(this, 'Missing task control event name or data', data);
                // Pass to our task
                this.tasks[task_id].events.emit(data.event_name, data.event);
            } catch(e) {
                utils.error.call(this, 'Invalid task control JSON: ' + e);
            }
        }
    }.bind(this));

    // Add another worker (which may also be a monitor!)
    var addWorker = function(stream) {
        // Immediately netev this!
        var worker = netev(stream, this.config.debug_netev, this.config.port);

        // Assign internally once they identify
        worker.on('worker-identify', function(hostport) {
            worker.emit('worker-identify', this.config.host + ':' + this.config.port);

            // Reply to pings
            worker.on('ping', function() {
                worker.emit('pong');
            });

            utils.log.call(this, 'Worker connected: ' + hostport);
        }.bind(this));

        // Oh, you're not a worker but a monitor. Pings only!
        worker.on('monitor-identify', function() {
            worker.emit('worker-identify', this.config.host + ':' + this.config.port);

            // Reply to pings
            worker.on('ping', function() {
                worker.emit('pong');
            });
            utils.log.call(this, 'Monitor connected');
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
        var process = new this.task_functions[task.function](evs, task),
            task_key = this.config.redis.taskPrefix + task.id;

        // Subscribe to its _events
        process.on('_stop', function() {
            utils.log.call(this, 'Task stopped', task.id);
        }.bind(this));
        process.on('_update', function() {
            this.redis.hset(task_key, 'update', new Date().getTime());
        }.bind(this));
        process.on('_end', function() {
            utils.log.call(this, 'Task ended', task.id);
            this.redis.hset(task_key, 'state', 'END');
        }.bind(this));

        // Subscribe to Redis pubsub for external task control
        this.redis.subscribe(task_key + '-control');

        // Push other events to Redis pubsub
        var redis = this.redis;
        process.onAny(function() {
            redis.publish(task_key + '-events', JSON.stringify({
                event: this.event, data: arguments
            }));
        });

        // Store the task internally
        this.tasks[task.id] = {
            process: process,
            events: evs
        };

        // Start the task
        evs.emit('start');
        utils.log.call(this, 'task added', task.id);
    };

    // Check Redis for new tasks, prepare for worker
    var getNewTasks = function() {
        this.redis.rpop(this.config.redis.newQueue, function(err, reply) {
            if(!reply) return;
            if(err)
                return utils.error.call(this, err);

            var task_data;
            try {
                task_data = JSON.parse(reply);
            } catch(e) {
                return utils.error.call(this, 'Invalid task JSON', reply);
            }
            if(!task_data.id || !task_data.function || !task_data.data) {
                return utils.error.call(this, 'Invalid task', task_data);
            }

            var task_key = this.config.redis.taskPrefix + task_data.id,
                now = new Date().getTime();

            // Copy task_id into Redis list & task_data atomically
            this.redis.multi()
                .sadd(this.config.redis.taskSet, task_data.id)
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
        utils.log.call(this, 'Task function added', task_name);
    };

    this.reloadTask = function(task_id) {
        var task = this.tasks[task_id];
        if(!task) return false;
        utils.log.call(this, 'Reloading task', task_id);

        // Stop the task
        this.stopTask(task_id).then(function() {
            // When stopped, this.addTask w/ data from Redis hset
            this.redis.hget(this.config.redis.taskPrefix + task_id, 'data', function(err, reply) {
                var data = JSON.parse(reply);
                addTask.call(this, data);
            }.bind(this));
        }.bind(this));
    };

    this.stopTask = function(task_id) {
        var task = this.tasks[task_id];
        if(!task) return false;
        utils.log.call(this, 'Stopping task', task_id);

        // Create a promise to return
        var taskHasStopped = new Promise(function(resolve, reject) {
            var timeout, wrapper;

            // Reject if not stopped in 5s
            timeout = setTimeout(function() {
                this.tasks[task_id].process.removeListener('_stop', wrapper);
                reject();
            }.bind(this), 5000);

            // Wrapper around resolve
            wrapper = function() {
                clearTimeout(timeout);
                this.tasks[task_id].process.removeListener('_stop', wrapper);
                resolve();
            }.bind(this);

            // Subscribe to task's _stop
            this.tasks[task_id].process.on('_stop', wrapper);
        }.bind(this));

        // Send stop event to task
        task.events.emit('stop');

        // Return our promise
        return taskHasStopped;
    };

    this.stopAllTasks = function() {
        utils.log.call(this, 'Stopping all tasks...');
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
