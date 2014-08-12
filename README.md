# SwarmTasks.js

Swarm-like distributed tasks for Node. Any number of workers "swarming" a centralised Redis store with some auxiliary monitors keeping an eye on things. Ready to survive worker, Redis and monitor failure - and _somewhat_ resiliant to network partitions.


## Synopsis

**workers.js**

```js
var worker = new Swarm.Worker({
    debug_netev: true,
    debug: true,
    host: 'localhost',
    port: 6000,
    redis: {
        host: 'localhost',
        port: 6379
    }
});
```

**monitor.js**

```js
var monitor = new Swarm.Monitor({
    debug: true,
    redis: {
        host: 'localhost',
        port: 6379
    }
});
```


## Example

Checkout the `example/` directory for a full, ready-to-add-tasks-and-go example.


## Structure

+ N workers which do the tasks
+ <N monitors which keep an eye for failed tasks
+ Redis as a global state store


## Failover/HA/Fault-Tolerance Notes

+ Workers listed in Redis, but all keep copy in-memory
+ When workers/monitors are disconnected from Redis, they ping all workers
    * if the % that return data is less than the configured, tasks/monitoring stop
+ If less than the % workers get partitioned, and Redis remains up, tasks *should* be re-queued
+ Ultimately not very tolerant of larger numbers of workers & complicated partitions
+ But should be solid in small groups
+ Redis cluster (untested) may be of use
