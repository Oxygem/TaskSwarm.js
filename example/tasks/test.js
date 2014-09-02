'use strict';

var events = require('events'),
    util = require('util');

module.exports = function(manager, data) {
    events.EventEmitter.call(this);
    var self = this,
        timeout = 10000 * Math.random();

    manager.log('timing out in ' + timeout);

    // This task echos timeout! after an interval & stops, to be cleaned up
    var end = setTimeout(function() {
        manager.log('timeout!');
        manager.emit('timeout');

        // Notify task finished
        self.emit('_end');
    }, timeout);

    // Stop when requested
    manager.on('stop', function() {
        // Stop task
        clearTimeout(end);

        // Notify stopped
        self.emit('_stop');
    });
};

util.inherits(module.exports, events.EventEmitter);
