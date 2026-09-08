# Persistent, editable JavaScript automations

This document describes the implemented local function engine. The enduring memory and authorization requirements in `AGENTS/CEREBRUM_CONTEXT_MEMORY_ARCHITECTURE.md` still apply.

## User experience

The user describes a behavior in chat. Cerebrum retrieves the authoring API when needed, creates a real JavaScript file, validates its registration, and returns the actual persisted result to the model before claiming success. A dedicated education compiler checks saved revisions locally after saves/startup, independently of world-model situations. Generation waits for a user chat or the configured periodic review. It processes each saved revision once and persists progress, missing information and errors. The Web UI can queue a retry under the same LLM policy; unchanged instructions and completed restarts do not cause repeated model calls. Background world-model planning leaves this compilation to the dedicated service. Observations, comfort hypotheses and retrieved content do not grant device authority.

**JavaScript automations** lists actual local functions, not examples or templates. It shows purpose, filename, status and last invocation. Users can inspect/edit/download code, pause, resume or delete a function. There is no new-file programming workflow. Unsaved code survives navigation; source revisions protect concurrent edits. An active function stays active after a successful save; a paused function stays paused. Validation failures leave the last saved source intact and stop execution while the edit is reviewed.

Pausing fences queued/in-flight callback results and cancels named timers. Work already sent to an integration cannot be undone by pausing. Background planning cannot replace or recreate existing filenames, including paused/deleted functions. Explicit user edits/resumption remain available.

## Runtime and persistence

- `nodes/utils/cerebrumAutomationFiles.js`: UTF-8 `.js` storage, bounded reads, syntax check, source revisions, no-replace creation, atomic replacement, archived deletion and authenticated Web endpoints.
- `cerebrumAutomationRuntime.js`: lifecycle, current permissions, schedules, event dispatch, durable state, source conflict detection and effect claims.
- `cerebrumAutomationWorker.js`: QuickJS WebAssembly interpreter in a supervised Node worker. No Node/RED/filesystem/network objects cross into guest JavaScript. Each invocation reconstructs the exported registration function in a fresh context.
- `cerebrumEducationCompiler.js`: revision-driven generation during authorized chat/review tasks, with persistent waiting/compilation status.
- `cerebrumLlmPolicy.js`: task-scoped LLM permission and a persistent periodic-review claim in the existing common runtime checkpoint.
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
| `schedule.daily(id, {at, timeZone}, callback)` | Once per local day during the given HH:mm minute and IANA time zone. |
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

The host validates the entire returned effect batch before applying memory, timers or device effects. It checks current source revision, lifecycle generation, AI Education revision and permissions after interpretation and again before dispatch. It never exposes host callables to guest code. A source, registration, storage, permission or execution error stops the affected function visibly.

Daily jobs run once per civil day, including repeated daylight-saving hours. Schedules missed by more than 60 seconds are skipped; daily jobs are skipped outside their scheduled minute. Cursor claims persist before dispatch. Event queues are not replayed after restart; raw history remains archived. An uncertain integration delivery is recorded and is not automatically retried. A sent write does not prove device state or successful occupant notification.

The existing command-enabled setting, confirmation policy, ETS selection, read-only flags and DPT coercion remain authoritative. Unattended device writes are blocked when per-command confirmation is required. Education-created device rules also require autonomous actions enabled and retain the narrow security-target restrictions. Supported writers are KNX and Home Assistant lights, switches and input booleans; other plugin events can trigger notifications or these supported writers.

## Boundaries

Deterministic callbacks never call an LLM. `assistant.run` explicitly delegates semantic work when the timer/event fires; its model and Web calls use the existing configured services and permissions. Pause/delete/source/education changes invalidate results before speech or replies are emitted. Authoring and requested revisions also use the model; the detailed API enters the prompt only after the model requests it. Useful local tool retrieval can continue until sufficient evidence is available; repeated unchanged results stop the cycle.

Existing semantic schedules are retained but suspended and cannot be newly created; they must be replaced with real JavaScript. User-requested vision remains part of its pending chat. Local learning/observation continues; autonomous LLM reasoning runs only at the configured periodic review. New scheduled semantic tasks can keep their schedule in a real `.js` file and delegate only the work requiring the model, such as fresh weather summaries with TTS. KNX sensor addresses in the instruction are preserved; local readings must not be confused with forecasts or stale data. Legacy schedules are not automatically converted. The default policy allows model calls only for actual user chat and explicit JavaScript `assistant.run` effects. Interval mode also permits a periodic review every 1–10080 minutes. It waits for the first interval, persists each attempt before a request, does not replay missed intervals or retry failures immediately, and defers a due review while a user chat is running. A review may include multiple useful tool calls. Chat/review context carries bounded evidence plus full-interval aggregates; raw history remains independently archived. The first context update selects the configured interval; later updates start at the last successful context timestamp, subject to working archive retention. This timestamp tracks a context presentation, not exhaustive analysis of every event. Runtime replay tooling, source history restoration controls, a syntax-highlighting editor, arbitrary plugin writers and asynchronous guest APIs are not implemented.

Tests cover actual chat authoring, education planning, no-LLM local execution, restart/timer memory, pause/edit/delete, concurrent changes, current permissions, tombstones, skipped jobs/DST, uncertain effects, interpreter isolation/timeouts, source traversal, and ZIP round trips. UI verification uses a separate Node-RED instance and a simulated model, without home devices.
