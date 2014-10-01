// TaskSwarm
// File: index.js
// Desc: export the worker & monitor

module.exports = {
    Worker: require('./task-swarm/worker'),
    Monitor: require('./task-swarm/monitor')
}
