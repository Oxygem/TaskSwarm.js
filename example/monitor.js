#!/usr/bin/env node

var fs = require('fs'),
    Swarm = require('../');


var monitor = new Swarm.Monitor({
    debug: true,
    redis: {
        host: 'localhost',
        port: 6379
    }
});
