# Live-event CPU and memory measurements

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

## Background memory growth with the dashboard closed

The follow-up investigation reproduced growth in the live KNX correlation cache. Its 500-edge limit ran only when a dashboard summary was requested. With no dashboard reads, correlations between addresses accumulated without that limit. The rate-series cache had the same issue with its 300-series limit. Anomaly summaries were limited to 120 only in the returned view.

The ingestion path now keeps the most recently touched technical entries within those limits. The existing state tick also expires stale graph samples, rate samples and recent history when traffic stops. These caches are disposable dashboard projections; raw events, semantic observations, episodes and learned habits keep their existing archive and retention behavior. Autonomy snapshots normalize only the states, habits and episodes that the world-model tick consumes.

Measured locally on Node.js 24.13.0, comparing commit `a40f263` with this change using the same instrumented script, 600 sensors, 600 warm-up events and two batches of 1,200 events, with no dashboard reads:

| Measurement | Before | After |
| --- | ---: | ---: |
| Retained graph correlations | 132,000 | 500 |
| Retained rate series | 601 | 300 |
| Sampled peak JavaScript heap | 240.0 MiB | 104.1 MiB |
| Retained JavaScript heap after GC | 167.8 MiB | 25.2 MiB |
| Sampled peak process RSS | 427.9 MiB | 291.8 MiB |

The benchmark verified all 3,000 raw telegrams, 1,800 observations and their evidence references. Heap retention fell about 85%; sampled peak RSS fell about 32%. The script samples memory every 50 telegrams and after verification, so the reported peaks are sampled maxima. `--expose-gc` permits one final collection in the benchmark to distinguish retained objects from temporary allocations; production code does not force garbage collection. Process RSS and JavaScript heap are different from Proxmox's total VM memory reading. The VM's idle CPU/RAM behavior still needs measurement after installing the build and restarting Node-RED.

```sh
node --expose-gc --max-old-space-size=512 scripts/benchmark-ingestion.js 600 1200
```

## Relaxed background timers

| Work | Previous cadence | Current cadence |
| --- | --- | --- |
| Derived home-memory Markdown checkpoint during traffic | 1.5 seconds | 10 seconds |
| Local state/world-model check and periodic-review eligibility | 15 seconds | 30 seconds |
| AI Education file polling | 10 seconds | 30 seconds |
| KNX connection fallback polling | 1 second | 5 seconds, with a configured gateway |
| Home-automation registry fallback refresh | 30 seconds | 60 seconds |
| Suspended legacy semantic scheduler and proactive LLM checks | 15 and 30 seconds | No timer |

Checkpoints retain the first scheduled deadline during continuous traffic and flush at shutdown; raw event/observation archiving remains immediate. Registry notifications and Education saves/chat/review checks still run directly. JavaScript automations use their existing deadline timer. The local observation and review eligibility cadence can add up to 30 seconds of detection delay; the configured LLM invocation policy, device permissions and automation deadlines are preserved.

## Snapshot-request memory spikes

A camera request also prepares conversational history. The previous KNX and adapter query loaders read each entire daily archive into a string and split it into an array of every line, even when the prompt included only a few recent records. This created a temporary allocation spike independently of JPEG size. The sidebar HTTP response also serialized a `Buffer` as an array of individual byte numbers.

Queries now scan 64 KiB chunks with a maximum 1 MiB record, preserving UTF-8 boundaries, legacy JSONL, final lines without a newline and complete aggregate counts. File descriptors close on errors and early termination. Top-count selection keeps a small sorted result instead of copying and sorting the entire counter table. The same reader serves operation-history files. Raw files and their retention policy are unchanged; exact aggregate counters still scale with the number of distinct event categories/values.

At `POST /cerebrumUltimate/sidebar/ask`, `metadata.image.data` is now a Base64 string with `metadata.image.encoding: "base64"`, plus the existing media type and filename. HTTP consumers should decode that encoding instead of expecting `{type:"Buffer",data:[...]}`. Internal `sidebarAsk()` and Node-RED/Telegram output retain the original binary image; no resizing or recompression is applied and JPEG bytes stay out of the memory archive.

The local event-snapshot benchmark exercises the real chat, prompt-history, provider and HTTP response paths, with a simulated model/provider and temporary files. It first queries recorded events and then retrieves the exact event image, preparing history in both model passes. Node.js 24.13.0, 192.8 MiB of history (231,000 events), one 4 MiB image, comparing `a40f263` with the fixes:

| Measurement | Before | After |
| --- | ---: | ---: |
| Whole-file history reads | 2 | 0 |
| Sampled peak JavaScript heap | 411.0 MiB | 28.7 MiB |
| Sampled peak process RSS | 958.5 MiB | 138.9 MiB |
| JavaScript heap after final GC | 12.3 MiB | 12.4 MiB |
| HTTP response size | 16.0 MiB | 5.3 MiB |

The observed RSS peak falls about 86%. Similar final heap usage identifies temporary allocation pressure in this reproduction, rather than a retained JPEG leak. These are local process measurements, not a measurement of the user's VM. The benchmark checks exact image bytes, full history counts in both model passes, one event query, one exact event-image retrieval, no substitution with a current image and cleanup of pending requests. Regression coverage additionally checks full KNX/adapter counts in the snapshot prompt and prevents bulk history reads.

```sh
node --expose-gc --max-old-space-size=768 scripts/benchmark-snapshot.js 192 4 event
```

Arguments are approximate history size in MiB (up to 512), image size in MiB (up to 6), and `event` (default) or `current`. Sampling occurs at file-read, model/provider and JSON-serialization boundaries. With `--expose-gc`, the benchmark collects before and after the request; production code does not force GC. No real cameras, model APIs or user storage are accessed.
