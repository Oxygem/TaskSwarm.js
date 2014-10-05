# Task Swarm

Swarm-like distributed tasks for Node. Any number of workers "swarming" a centralised Redis store with some auxiliary monitors keeping an eye on things. Ready to survive worker, Redis and monitor failure - and _somewhat_ resiliant to network partitions. Tasks can generate events while in progress and these can be subscribed to.

Tasks can be controlled via Redis pub/sub, and task output events are pushed to pub/sub also.


## Synopsis

Shared Redis config:

```js
var REDIS_CONFIG = {
    host: 'localhost',
    port: 6379,
    // Optional + defaults
    newQueue: 'new-task',
    taskSet: 'tasks',
    taskPrefix: 'task-',
    endQueue: 'end-task'
}
```

**workers.js** - fetches new tasks from Redis & excutes them:

```js
var worker = new Swarm.Worker({
    host: 'localhost',
    port: 6000,
    redis: REDIS_CONFIG,
    // Optional + defaults:
    fetchTaskInterval: 2000,
    fetchWorkerInterval: 15000,
    partitionPercentage: 60
});
```

**monitor.js** - monitors all running tasks and requeues if needed:

```js
var monitor = new Swarm.Monitor({
    redis: REDIS_CONFIG,
    // Optional + defaults:
    taskTimeout: 30000,
    checkTaskInterval: 15000,
    fetchWorkerInterval: 15000,
    partitionPercentage: 60
});
```


## Example

Checkout the `example/` directory for a full, ready-to-add-tasks-and-go example.


## Structure

+ N workers which do the tasks
+ <N monitors which keep an eye for failed tasks
+ Redis as a global state store


## Redis Data

Defaults below, all keys/prefixes configurable:

+ New tasks are pushed onto list/queue `new-task`
+ Active task id's in a set `tasks`
+ Task data in relevant hash `task-<task_id>` (`state`, `start`, `update`, `worker` & `data` keys)
    * `state` = `RUNNING` or `END`
+ Ended tasks for manual cleanup (hash remains) in set `end-task`
+ Task events are published under channel `task-<task_id>-events`
+ Workers listen for task control under channel `task-<task_id>-control`


## Failover/HA/Fault-Tolerance Notes

+ Workers listed in Redis, but all keep copy in-memory
+ When workers/monitors are disconnected from Redis, they ping all workers
    * if the % that return data is less than the configured, tasks/monitoring stop
+ If less than the % workers get partitioned, and Redis remains up, tasks *should* be re-queued
+ Ultimately not very tolerant of larger numbers of workers & complicated partitions
+ But should be solid in small groups
+ Redis cluster (untested) may be of use

**partitionPercentage** - means "the min. % of other workers a worker/monitor has to ping to remain active when Redis goes down".

Basically a choice of consitency vs partition resiliance. The lower the percentage the more resiliant the swarm is to network dropouts, however it's also more likely tasks get duplicated during partitions. A high percentage will mean better task consistency, but you'll be less resiliant to network partitions.
