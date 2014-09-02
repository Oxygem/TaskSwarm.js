#!/usr/bin/env node

var fs = require('fs'),
    swarm = require('../');


var task_id = process.argv[2],
    event_name = process.argv[3];
if(!task_id || !event_name) {
    console.log('Usage example/watcher.js <task_id> <event_name>');
    process.exit(1);
}

var watcher = new swarm.Watcher({
    debug_netev: true,
    debug: true,
    redis: {
        host: 'localhost',
        port: 6379
    }
});

watcher.watch(task_id, event_name, function() {
    console.log(arguments);
});
