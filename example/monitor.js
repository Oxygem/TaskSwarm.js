#!/usr/bin/env node

var fs = require('fs'),
    Swarm = require('../');


var monitor = new Swarm.Monitor({
    debug: true,
    debug_netev: true,
    redis: {
        host: 'localhost',
        port: 6379
    }
});
