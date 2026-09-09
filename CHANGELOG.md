# Changelog

## 0.3.0 — 2026-09-09

- Added a versioned, integration-neutral runtime capability contract with sanitized health, readiness and supported-operation snapshots for RED, KNX, Home Assistant, UniFi/camera and third-party adapters. Capability discovery does not grant device authority.
- Added persistent deterministic episodes derived from evidence-linked observations across integrations, plus non-destructive links between compatible habit and behaviour-pattern views.
- Added process-local capability leadership so Cerebrum nodes sharing household memory keep ingesting locally while avoiding duplicate periodic autonomous reasoning.
- Added vendor-neutral recorded-camera queries and exact event snapshots. Cerebrum can iteratively page normalized historical evidence, select an exact event and return its recorded JPEG without exposing provider credentials or substituting a live image; UniFi Protect supplies the operations through its selected runtime provider.

## 0.2.2 — 2026-09-09

- Added **Cerebrum Function (BETA)**, based on the official Node-RED Function editor and runtime, preserving lifecycle code, outputs, contexts, timers, async messaging, timeouts, the Function library and external modules. Included upstream attribution and Apache-2.0 license.
- Added prompt-based JavaScript generation and revision using the Cerebrum selected in **Setup**, with automatic selection and authorized ETS catalog inclusion. Show an animated wait icon while hiding the request/example fields; preview only proposed code and use light green/red apply/discard buttons. Applying opens the corresponding code tab. Protect edits made during generation and archive complete authoring turns.
- Added the read-only `cerebrum` API and Monaco/Ace completion for authorized KNX addresses, DPTs, observed integration states and saved automation metadata/source, including expanded editors. Local data reads require no model calls and follow current access configuration and redeployments.
- Added usage instructions, an importable example, generation/data/editor regression checks and Function runtime compatibility coverage for Node-RED 3 and 5.

## 0.2.1 — 2026-09-08

- Added configurable history retention under **AI Assistant**, defaulting to **30 days**, with no explanatory panel. Shared memory and daily KNX, adapter and operation archives are cleaned periodically; retained record references, saved instructions, learned habits and backup compatibility are preserved.

- Replaced Learning, Memory, Goals, Web Research and Operations detail cards with read-only textareas: one complete record per line with date/time and text. Removed expandable JSON/details, explanatory panels and list filters; world-model pages load into a single list. File editing and backups remain available.

- Simplified the JavaScript automations page: the title now leads directly to the toolbar, with explanatory text and compilation/review summaries removed. File controls and the source editor remain available.

- Added **History updates to LLM** in the node editor: **Only during user chat** is the default, including existing flows without the setting; **During chat and at an interval** additionally permits history and comfort reviews every **1–10080 minutes (up to seven days)**. Explicit `assistant.run` calls in active JavaScript functions remain independently authorized.
- Restricted model access to the authorized request and its tool follow-ups. An open Web page or saved Telegram session does not authorize background calls, and concurrent background work cannot borrow a chat's permission. Local observation, raw archives, learning and deterministic JavaScript functions continue without model calls.
- Made periodic reviews wait for their first interval and persist each attempt across restarts. Due reviews wait during active chat; missed intervals are not replayed and failures do not trigger immediate retries.
- Added full-period aggregate counts and bounded historical evidence to chat/review context while retaining the complete local archive. The interval controls when analysis starts; useful tool follow-ups may require multiple model calls, so it is not a token or spending cap.
- Deferred AI Education generation and Web UI retries to the next authorized chat or periodic review, with persisted waiting status. Startup notifications are generated locally without testing the model.
- Suspended legacy semantic schedules while retaining them for inspection and cancellation; new scheduled work must use real `.js` functions. Preserved existing device permissions, backup compatibility and pending user-requested camera analysis.

## 0.2.0 — 2026-09-08

- Added persistent **JavaScript automations** authored by Cerebrum from chat or explicit AI Education instructions. The Web UI displays actual functions with editable/downloadable `.js` source, active/paused/error status, last execution, pause/resume and deletion; no bundled sample files.
- Fixed missing `.js` generation after saving AI Education: compilation now runs on save and reconciles existing instructions after startup, with persistent progress/errors and explicit retry in the Web UI. Revision tracking avoids repeated model calls for unchanged instructions.
- Added a bounded QuickJS WebAssembly worker for local schedules and plugin event handlers without LLM calls, with durable memory/timers and existing device permission checks. Local `speak` delivers prepared TTS; scheduled `assistant.run` retrieves fresh weather/research summaries and calls the model only when triggered, using existing sensor reads, Web limits and cancellation checks.
- Archived source revisions and operations, and included JavaScript sources and runtime metadata in ZIP backups; restored functions start paused. Preserved manual edits, user pauses/deletions, revision conflict checks and cancellation of pending work.

## 0.1.5 — 2026-09-07

- Recognize the full 1,050,000-token GPT-5.5/GPT-5.5 Pro context window instead of falling back to 8,192 tokens. Added a free **Maximum managed context (KB)** editor field: zero follows the model maximum automatically, while positive values cap all conversational and autonomous requests without exceeding known or detected physical limits.
- Simplified the Web Learning screen to show learned instructions first, with conversations, observed behaviour and file tools in collapsed details. Memory, Goals, Web Research and Activity now keep primary information visible while filters, collection statistics and complete record details remain expandable.
- Fixed GA selection loss during ZIP migration: preserve flow-based access on the first export, copy current file-backed selections/read-only permissions into portable flows, recover legacy access from the source flow, and refresh the ETS screen after restore. Saved selections survive destination node/gateway changes and restarts, including while the catalog is unavailable.
- Added explicit current KNX capability diagnostics to every conversational pass and context fallback. Distinguishes missing gateways/catalogs, unconfigured or unmatched ETS selections, read-only objects and disabled commands from details awaiting retrieval; newly saved access supersedes older chat unavailability claims.

- Added a shared, append-only household archive for complete Web/Telegram conversations, KNX/integration observations, tool results and context changes, with immediate flush, archive search, record retrieval and full ZIP backup/restore.
- Shared recent conversation and durable memories across channels, migrated available V3 records, and updated the Learning views to native V4.
- Enabled explicitly requested actuator snapshots, kept complete saved values in prompts and retained memory across context retries. Removed fixed ETS/shared-memory/history retrieval-round counts, preserved evidence across Web and routine phases, and merged shared device observations into conversational awareness. Local retrieval uses an iterative, cancellable controller with unchanged-cycle detection; semantic details and world context scale with the model window. Autonomous reasoning can follow multiple local recall/research steps, including pagination, and records full reasoning/recall evidence to the shared archive.

## 0.1.2 — 2026-09-07

- Moved user-managed AI Education from the flow property to a per-node Markdown file, with automatic migration and file saving when pressing Done in the node editor. Cancel discards unsaved edits; save errors keep the editor open.
- Included AI Education in backup validation, restore and rollback, with recovery from older migration flows and preservation of destination instructions when an older backup contains none.

## 0.1.1 — 2026-09-07

- Fixed ZIP backups failing when retained histories exceed 256 MiB. Version 3 stores daily archives as separate ZIP entries, prepares downloads on disk and uses native browser downloads.
- Removed fixed ZIP upload/download and total archive byte limits. Restore stages uploads, decoded archives and rollback copies on disk, preserves integrity checks and keeps previous JSON/ZIP backups importable.

## 0.1.0 — 2026-09-07

- Unified the Web dashboard with the neural-map palette, reorganized navigation and responsive layouts, and made the Neural Map the default opening page while preserving direct links to other sections.
- Simplified the Node-RED editor by removing the redundant Cerebrum Learning panel and using the default Node-RED button colors.
- Removed Setup Doctor from the editor, Web dashboard and backend, including automatic provider probes, while preserving chat onboarding and integration discovery.
- Added direct ZIP backup downloads and ZIP restore, with the complete backup, ready-to-import Node-RED flows, package requirements and migration instructions in one archive. Previous version 1 and 2 JSON backups remain supported.
- Removed the separate flow-extraction button; migration flows are available directly as `cerebrum-flows.json` inside the ZIP. Restoring Cerebrum data remains separate from importing and deploying Node-RED flows.
- Added ZIP integrity and decompression-limit checks, plus regression coverage for damaged archives and complete restoration across node IDs and restarts. Updated translations, documentation and packaged Web assets.

## 0.0.11 — 2026-09-06

- Added autonomous observation, comfort goals and smart-home Web research guided by AI Education.
- Improved persistent memory, backup recovery and model context limits.
- Refreshed the Cerebrum Web pages with readable insights and animated brain navigation.
- Fixed authenticated Web summaries and automatic model endpoint selection.

## 0.0.10 — 2026-09-05

- Adapt OpenAI requests specifically for GPT-6 Astra: omit unsupported sampling/logprob parameters before the first request and map `none`/`minimal` reasoning to `low`, preserving other models and supported effort levels.
- Added version 2 Cerebrum backups with all retained KNX/adapter/operation archives, learning checkpoints and diagnostics, plus portable Node-RED flows, integration credentials, ETS data and package requirements. Cerebrum AI provider keys remain excluded.
- Added checked archive restoration across different node IDs, rollback on write failures, pending-write synchronization and chunked uploads for large backups. Version 1 imports remain supported.
- Added a Web flow-extraction action and migration instructions explaining how to restore node settings and the surrounding integrations.

## 0.0.9 — 2026-09-03

- Added an atomic checkpoint for home routines that are still being learned or awaiting confirmation, preserving every collected sample across Node-RED restarts.
- Kept confirmed, corrected, rejected and paused routines in the normal Web-editable Cerebrum Memory, while clearing their temporary acquisition checkpoint so deleted routines are not restored.
- Isolated memory recovery from unrelated startup archives so a history-loading problem cannot prevent learned routines from being restored.

## 0.0.8 — 2026-09-02

- Clarified the operations timeline with explicit direction badges for LLM/tool KNX commands, autonomous reads, outgoing local-interface telegrams, incoming bus traffic and commands that were never sent.
- Added a dedicated operation-status filter and distinct outcome colors, including green for sent operations and blue for observed events.
- Expanded the README with a prominent privacy notice for cloud AI providers, guidance for keeping data local and clearer wording for optional integrations.

## 0.0.7 — 2026-09-02

- Fixed autonomous KNX state refreshes in Universal mode so every `GroupValue_Read` carries the mandatory `msg.readstatus = true` flag and cannot fall through to a bus write.
- Added **Cerebrum Operations** beside Cerebrum Memory in the Web dashboard. It merges the last three days of KNX telegrams with a persistent audit of LLM requests, structured tools, KNX commands and reads, schedules, camera/TTS/memory actions, autonomous state refreshes, habit learning and proactive notifications.
- Added category totals, search, filters, outcome and duration indicators, expandable technical details, automatic refresh while open, fixed three-day audit retention and credential redaction.

## 0.0.6 — 2026-09-02

- Added a read-only `historyActions` tool that lets the conversational model autonomously query decoded KNX archive records by time range, source/destination, event, DPT and text, then refine the query in a second reasoning pass.
- Added an opt-in privileged local JavaScript tool for the conversational model. Generated synchronous code can inspect the live Node-RED runtime through direct `node` and `RED` access, and its bounded result is returned to the model for the next reasoning pass.
- Added explicit editor and documentation warnings that privileged JavaScript is not a security sandbox and that runtime results are sent to the configured AI provider.

## 0.0.5 — 2026-09-01

- Fixed Cerebrum web dashboard links under the Home Assistant add-on by preserving the dynamic Ingress prefix instead of routing requests to the Home Assistant root.

## 0.0.4 — 2026-09-01

- Added the branded Max Supervibe README, Cerebrum artwork, npm badges and a concise first-time-user guide.
- Added 15 safe, importable Node-RED example flows covering conversations, memory, schedules, Web intelligence, Home Assistant, Telegram, TTS and supervised KNX workflows.
- Expanded npm discovery metadata with AI, LLM, local AI, semantic memory, tool calling, human-in-the-loop and intelligent-automation keywords.

## 0.0.1 — 2026-09-01

- Extracted Cerebrum into the standalone `node-red-contrib-cerebrum-ultimate` package and introduced the new `cerebrumUltimate` node type.
- Made KNX Ultimate optional; Cerebrum starts and learns from other integrations without a KNX gateway, while reusing ETS/DPT metadata when a gateway is selected.
- Added an independent bounded storage root under `cerebrumultimatestorage`, with no migration from legacy assistant files.
- Added direct Home Assistant communication through Cerebrum output 6 and `ha-api`, Home Assistant add-on and round-trip detection, HUE/Matter/flow discovery, and a public adapter registry for third-party packages.
- Preserved supervised habit learning, read-only KNX enforcement, model-tested startup notification with `msg.boot = true`, autonomous tiered state refresh, complete Cerebrum import/export and dual readable/editor memory views.
- Hardened adapter, provider, timer, storage and output boundaries so integration failures cannot propagate as uncaught Node-RED exceptions.
- Unified optional integrations under **Compatible nodes detected**: KNX Ultimate and UniFi Protect now use native config-node selection/creation, while HUE, Matter, Home Assistant, TTS Ultimate and registered adapters report whether they are detected and active in chat. Each Cerebrum instance exposes only its selected UniFi Protect controller.
- Removed the remaining legacy product names from public text, translations, generated assets and internal standalone identifiers. Chat-adapter resources, memory headers, backup formats, utility modules, UI selectors, downloadable filenames and tests now use Cerebrum-native names; the initial `0.0.x` release intentionally provides no legacy format migration.
