'use strict';

var events2 = require('eventemitter2'),
    util = require('util');

module.exports = function(manager, data) {
    events2.EventEmitter2.call(this);
    var timeout = 10000 * Math.random();

    manager.on('start', function() {
        manager.log('timing out in ' + timeout);

        // This task echos timeout! after an interval & stops, to be cleaned up
        var end = setTimeout(function() {
            manager.log('timeout!');

            // Arbitrary pubsub emit
            this.emit('testing', 'an argument');

            // Notify task finished
            this.emit('_end');
        }.bind(this), timeout);

        // Arbitrary pubsub emit
        this.emit('start');
    }.bind(this));

    // Stop when requested
    manager.on('stop', function() {
        // Stop task
        clearTimeout(end);

        // Notify stopped
        this.emit('_stop');
    }.bind(this));
};

util.inherits(module.exports, events2.EventEmitter2);
