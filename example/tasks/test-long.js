'use strict';

var events2 = require('eventemitter2'),
    util = require('util');

module.exports = function(manager, data) {
    events2.EventEmitter2.call(this);
    var timeout = 10000 * Math.random(),
        timer;

    manager.on('start', function() {
        manager.log('timing out in ' + timeout);

        // This task echos timeout! after intervals
        timer = setInterval(function() {
            manager.log('timeout!');
            manager.emit('timeout', 'timeout!');
            // Update Redis to avoid task timeout
            this.emit('_update');
        }.bind(this), timeout);
    }.bind(this));

    // Stop when requested
    manager.on('stop', function() {
        // Stop task
        clearTimeout(timer);

        // Notify stopped
        this.emit('_stop');
    }.bind(this));
};

util.inherits(module.exports, events2.EventEmitter2);
