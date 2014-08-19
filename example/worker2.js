#!/usr/bin/env node

var fs = require('fs'),
    Swarm = require('../');


var worker1 = new Swarm.Worker({
    debug_netev: true,
    debug: true,
    host: 'localhost',
    port: 6002,
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
