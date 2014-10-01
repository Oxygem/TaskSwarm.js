'use strict';

var events = require('events'),
    util = require('util');

module.exports = function(manager, data) {
    events.EventEmitter.call(this);
    var self = this,
        timeout = 10000 * Math.random();

    manager.log('timing out in ' + timeout);

    // This task echos timeout! after intervals
    var timer = setInterval(function() {
        manager.log('timeout!');
        manager.emit('timeout', 'timeout!');
        // Update Redis to avoid task timeout
        self.emit('_update');
    }, timeout);

    // Stop when requested
    manager.on('stop', function() {
        // Stop task
        clearTimeout(timer);

        // Notify stopped
        self.emit('_stop');
    });
};

util.inherits(module.exports, events.EventEmitter);
