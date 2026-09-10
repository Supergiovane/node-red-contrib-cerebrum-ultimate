# Live-event CPU measurements

The September 10 investigation reproduced expensive processing in the KNX event path: a single sensor update repeatedly cloned and normalized the entire home memory and semantic registry. Observation correlation also repeatedly parsed timestamps while scanning older groups.

Live updates now replace only the affected collection and state/entity records. Imported memory and user edits still receive full validation. Correlation stops once older groups cannot fall within its time window. Event retention, state freshness, observation evidence, habit learning, autonomous policy and device permissions are preserved.

The synthetic benchmark runs the actual Cerebrum node with 300 KNX sensors, 300 initial observations and two batches of 600 events. It includes filesystem archiving, world-model ticks and memory checkpoints. It uses a temporary storage directory and simulated integration responses, with no device or model calls. It verifies raw-event counts and observation evidence references.

Measured locally on Node.js 24.13.0, with the Node CPU profiler enabled for both runs:

| Traffic | Before: CPU ms/event | After: CPU ms/event | Reduction |
| --- | ---: | ---: | ---: |
| Repeated values | 7.738 | 2.509 | 68% |
| Changing values | 19.430 | 5.817 | 70% |

These are process CPU measurements for synthetic traffic, not the CPU percentage of the deployed Proxmox VM. Disk synchronization still contributes to elapsed time. Actual utilization depends on event rate, catalog size, storage and the other work running in Node-RED. Measure the deployed process after installing this build and restarting Node-RED.

Run from the repository with dependencies installed:

```sh
node scripts/benchmark-ingestion.js 300 600
```

To collect a CPU profile as well:

```sh
node --cpu-prof --cpu-prof-dir=/tmp scripts/benchmark-ingestion.js 300 600
```

Arguments are entity count (1–600) and events per batch (at least the entity count). Reported CPU includes user and system time; elapsed time also includes disk waits. Run comparisons on the same host without competing benchmarks.
