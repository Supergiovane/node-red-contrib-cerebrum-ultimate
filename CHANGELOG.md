# Changelog

## 0.0.2 — 2026-09-01

- Added the branded Max Supervibe README, Cerebrum artwork, npm badges and a concise first-time-user guide.
- Added 15 safe, importable Node-RED example flows covering conversations, memory, schedules, Web intelligence, Home Assistant, Telegram, TTS and supervised KNX workflows.
- Expanded npm discovery metadata with AI, LLM, local AI, semantic memory, tool calling, human-in-the-loop and intelligent-automation keywords.

## 0.0.1 — 2026-09-01

- Extracted Cerebrum into the standalone `node-red-contrib-cerebrum-ultimate` package and introduced the new `cerebrumUltimate` node type.
- Made KNX Ultimate optional; Cerebrum starts and learns from other integrations without a KNX gateway, while reusing ETS/DPT metadata when a gateway is selected.
- Added an independent bounded storage root under `cerebrumultimatestorage`, with no migration from legacy assistant files.
- Added the standalone `cerebrumHomeAssistant` bridge, Home Assistant add-on and `ha-api` Setup Doctor checks, HUE/Matter/flow discovery, and a public adapter registry for third-party packages.
- Preserved supervised habit learning, read-only KNX enforcement, model-tested startup notification with `msg.boot = true`, autonomous tiered state refresh, complete Cerebrum import/export and dual readable/editor memory views.
- Hardened adapter, provider, timer, storage and output boundaries so integration failures cannot propagate as uncaught Node-RED exceptions.
- Unified optional integrations under **Compatible nodes detected**: KNX Ultimate and UniFi Protect now use native config-node selection/creation, while HUE, Matter, Home Assistant, TTS Ultimate and registered adapters report whether they are detected and active in chat. Each Cerebrum instance exposes only its selected UniFi Protect controller.
- Removed the remaining legacy product names from public text, translations, generated assets and internal standalone identifiers. Chat-adapter resources, memory headers, backup formats, utility modules, UI selectors, downloadable filenames and tests now use Cerebrum-native names; the initial `0.0.x` release intentionally provides no legacy format migration.
