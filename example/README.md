# Task Swarm Example

+ `worker1.js` - two workers
+ `worker2.js` - one worker
+ `monitor.js` - one monitors

To run the example:

```sh
# Run each in a separate tab/etc
example/worker1.js
example/worker2.js
example/monitor.js
redis-server
```

To input tasks, `telnet 6379` into Redis &:

```
LPUSH new-task '{"id": "<task_id12>", "function": "test", "data": "{}"}'
```
