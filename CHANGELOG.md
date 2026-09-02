# Changelog

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
- Added direct Home Assistant communication through Cerebrum output 6 and `ha-api`, Home Assistant add-on and round-trip Setup Doctor checks, HUE/Matter/flow discovery, and a public adapter registry for third-party packages.
- Preserved supervised habit learning, read-only KNX enforcement, model-tested startup notification with `msg.boot = true`, autonomous tiered state refresh, complete Cerebrum import/export and dual readable/editor memory views.
- Hardened adapter, provider, timer, storage and output boundaries so integration failures cannot propagate as uncaught Node-RED exceptions.
- Unified optional integrations under **Compatible nodes detected**: KNX Ultimate and UniFi Protect now use native config-node selection/creation, while HUE, Matter, Home Assistant, TTS Ultimate and registered adapters report whether they are detected and active in chat. Each Cerebrum instance exposes only its selected UniFi Protect controller.
- Removed the remaining legacy product names from public text, translations, generated assets and internal standalone identifiers. Chat-adapter resources, memory headers, backup formats, utility modules, UI selectors, downloadable filenames and tests now use Cerebrum-native names; the initial `0.0.x` release intentionally provides no legacy format migration.
