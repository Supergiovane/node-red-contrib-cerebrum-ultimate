# Persistent, editable JavaScript automations

This document describes the implemented local function engine. The enduring memory and authorization requirements in `AGENTS/CEREBRUM_CONTEXT_MEMORY_ARCHITECTURE.md` still apply.

## User experience

The user describes a behavior in chat. Cerebrum retrieves installation facts and the authoring API, asks focused questions about material missing details, then creates and validates a real JavaScript file. A `routine.phase = "clarify"` response clears every action array locally and waits for the next user turn; a short answer continues the original request. Clear requests do not require an extra questionnaire or approval. The tool returns the actual persisted status before the model claims success. Saving AI Education provides context for later explicit requests; it does not compile routines automatically or add an unrelated model call to chat.

**JavaScript automations** lists actual local functions, not examples or templates. It shows purpose, filename, status and last invocation. Users can inspect/edit/download code, pause, resume or delete a function. There is no new-file programming workflow. Unsaved code survives navigation; source revisions protect concurrent edits. An active function stays active after a successful save; a paused function stays paused. Validation failures leave the last saved source intact and stop execution while the edit is reviewed.

Pausing fences queued/in-flight callback results and cancels named timers. Work already sent to an integration cannot be undone by pausing. Background planning cannot replace or recreate existing filenames, including paused/deleted functions. Explicit user edits/resumption remain available.

## Runtime and persistence

- `nodes/utils/cerebrumAutomationFiles.js`: UTF-8 `.js` storage, bounded reads, syntax check, source revisions, no-replace creation, atomic replacement, archived deletion and authenticated Web endpoints.
- `cerebrumAutomationRuntime.js`: lifecycle, current permissions, schedules, event dispatch, durable state, source conflict detection and effect claims.
- `cerebrumAutomationWorker.js`: QuickJS WebAssembly interpreter in a supervised Node worker. No Node/RED/filesystem/network objects cross into guest JavaScript. Each invocation reconstructs the exported registration function in a fresh context.
- `cerebrumLlmPolicy.js`: task-scoped permission for user chat and explicit JavaScript assistant tasks. Old interval settings cannot authorize work.
- `cerebrumAutomationAssistant.js`: semantic work at a local deadline, using existing read-only retrieval/Web/sensor reads and TTS integration.
- `cerebrumAutomationTool.js`: structured tool transport for actual JavaScript source and file management; JSON carries tool arguments, not the automation program.

One source file per behavior is stored at `cerebrum/automations/<node-id>/<name>.js`. The single adjacent `<node-id>.runtime.json` checkpoint contains statuses, source revisions, descriptions, origin/session routing, AI Education revision, registered trigger definitions, cursor claims, named deadlines and durable script memory. Ordinary restarts retain active/paused states and timer deadlines. Source edits outside Cerebrum stop the function until explicit resumption.

Source changes, deleted source, changed runtime entries and claimed/sent effects are retained in the common append-only archive. Existing raw KNX/adapter history and shared household memory remain intact; this incremental change does not migrate or delete existing memory files. The working checkpoint is replaceable bookkeeping, while the `.js` file is the program.

ZIP backups include source files and the checkpoint. Backups without these optional groups remain importable and preserve existing destination files. Restored functions start paused; source and runtime validation use the destination node's paths. Deletion removes the current `.js` file but retains source and a tombstone in the archive/checkpoint.

## JavaScript contract

A file exports a synchronous `register(cerebrum)` function through `module.exports`. Registration is deterministic and side-effect free. Its named callbacks are synchronous. No promises, Node APIs, imports, `setTimeout`, `setInterval` or host object access are exposed.

| API | Behavior |
| --- | --- |
| `describe(text)` | Short purpose in the user's language. |
| `targets(entityIds)` | Declare exact permitted write targets, using `source:objectId`. |
| `onState(id, entityIds, callback)` | Incoming observed value transitions, including first observation. |
| `onEvent(id, filter, callback)` | Incoming plugin events; filter requires `source`, with optional `objectId` and `event`. |
| `schedule.daily(id, {at, timeZone}, callback)` | Once per local day at the given HH:mm and IANA time zone, with up to five minutes of tolerance for a delayed live wake. |
| `schedule.every(id, milliseconds, callback)` | Local recurring timer; minimum 1 second. |
| `schedule.at(id, epochMilliseconds, callback)` | One-time local deadline. |
| `timers.define(id, callback)` | Register a named durable timer handler. |
| `timers.ensureAt(id, epochMilliseconds)` | Inside callbacks, install a deadline if none exists. |
| `timers.cancel(id)` | Cancel a pending named deadline. |
| `now()` | Host epoch milliseconds. |
| `state.get(entityId)` | Current local state or null, including value, changedAt, verifiedAt and freshness. |
| `memory.get(key)` / `memory.set(key, value)` | Durable JSON-compatible state, up to 32 KiB per function. |
| `speak(text)` | Send prepared text through the existing TTS output, with no LLM call. |
| `assistant.run(instruction)` | At the callback deadline, invoke the configured model for fresh research, sensor reads and a reply/TTS; never dispatch model device writes or schedule/memory mutations. |
| `notify(text)` | Reply through the originating user's channel; education functions use the household recipient. |
| `actions.write(entityId, value)` | Request a currently authorized KNX or supported HA write. |

Callbacks receive normalized event data: source, objectId, event, value, at and changed. Camera events also include object types, scope and event identity. Raw plugin data continues to be archived by the existing ingestion path.

Scripts must explicitly handle null/stale states and string-valued observations. `changedAt`/`verifiedAt` are observation timestamps; check freshness before state-dependent effects. Use local recurring checks where a condition already present at creation or missed during downtime must be reconsidered. Registration itself never runs a notification or device command.

## Execution behavior and limits

QuickJS has a 16 MiB memory limit, 512 KiB stack, 250 ms execution budget and an external worker timeout. Source is bounded at 128 KiB; output at 64 KiB; local state input at 1 MiB. A function can register up to 40 handlers and return up to 20 effects per invocation. Queue pressure stops the affected function. These are local execution/resource limits, not limits on useful retrieval/reasoning passes.

The host validates the entire returned effect batch before applying memory, timers or device effects. It checks current source revision, lifecycle generation, AI Education revision and permissions after interpretation and again before dispatch. It never exposes host callables to guest code. A source, registration, storage, permission or interpreter error stops the affected function visibly. A delivery failure from the model, TTS, notifications or a device integration ends that invocation and is shown in the routine's error details and archive, while future scheduled occurrences remain active. The failed effect and the rest of its batch are not retried. A later successful invocation clears the error; restarting alone does not clear it.

The scheduler keeps one timeout for the next deadline and sleeps completely when only event triggers exist. It does not poll more frequently to improve reliability. An armed daily occurrence remains selected across event-driven rearms, including a short delay past midnight. Live wakes delayed by at most five minutes execute once; larger delays are recorded as `schedule_skipped`. Recurring intervals keep their original cadence and coalesce missed occurrences without a burst of catch-up calls. Daily jobs still run once per civil day, including repeated daylight-saving hours.

Restart/resume remains conservative: one-time, interval and named deadlines older than 60 seconds are skipped, and a daily occurrence outside its scheduled minute is not replayed. Paused/error routines remain stopped until explicitly resumed. Cursor claims persist before dispatch. Event queues are not replayed after restart; raw history remains archived. An uncertain integration delivery is recorded and is not automatically retried. A sent write does not prove device state or successful occupant notification. Named timer limits are checked against the callback's captured `now()`, so interpreter latency does not invalidate a valid one-second timer.

The existing command-enabled setting, confirmation policy, ETS selection, read-only flags and DPT coercion remain authoritative. Unattended device writes are blocked when per-command confirmation is required. Existing routines created from explicit AI Education retain their instruction-revision and security-target restrictions. Supported writers are KNX and Home Assistant lights, switches and input booleans; other plugin events can trigger notifications or these supported writers.

## Boundaries

Deterministic callbacks never call an LLM. `assistant.run` explicitly delegates semantic work when the timer/event fires; its model and Web calls use the existing configured services and permissions. Pause/delete/source/education changes invalidate results before speech or replies are emitted. Authoring and requested revisions also use the model; the detailed API enters the prompt only after the model requests it. Useful local tool retrieval can continue until sufficient evidence is available; repeated unchanged results stop the cycle.

Existing semantic schedules are retained but suspended and cannot be newly created; replace them with requested JavaScript routines. User-requested vision remains part of its pending chat. Model calls are authorized only by user chat or explicit JavaScript `assistant.run`; legacy periodic-review settings are inactive. Raw history and current device states remain available, but autonomous habit learning, episode consolidation, comfort goals and house reviews no longer run.

A scheduled semantic task keeps its schedule in `.js` and delegates only work requiring the model, such as fresh weather summaries with TTS. Local sensor readings must remain distinct from forecasts and stale data. Existing routines and manual edits remain authoritative; old habit/world files are preserved as archival backup data. Runtime replay tooling, source history restoration controls, syntax highlighting, arbitrary plugin writers and asynchronous guest APIs are not implemented.
