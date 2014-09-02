#!/usr/bin/env node

var fs = require('fs'),
    swarm = require('../');


var worker1 = new swarm.Worker({
    debug_netev: true,
    debug: true,
    host: 'localhost',
    port: 6000,
    redis: {
        host: 'localhost',
        port: 6379
    }
});

// For each file in ./tasks load & add to worker
var files = fs.readdirSync('example/tasks');
for(var i=0; i<files.length; i++) {
    worker1.addTaskFunction(files[i].replace('.js', ''), require('./tasks/' + files[i]));
}


var worker2 = new swarm.Worker({
    debug_netev: true,
    debug: true,
    host: 'localhost',
    port: 6001,
    redis: {
        host: 'localhost',
        port: 6379
    }
});

// For each file in ./tasks load & add to worker
var files = fs.readdirSync('example/tasks');
for(var i=0; i<files.length; i++) {
    worker2.addTaskFunction(files[i].replace('.js', ''), require('./tasks/' + files[i]));
}
