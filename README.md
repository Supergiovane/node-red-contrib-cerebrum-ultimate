<p align="center">
  <img src="img/logo-supervibe.png" alt="Max Supervibe" width="200">
</p>

<p align="center">
  <img src="img/cerebrum-ultimate-logo.png" alt="Cerebrum Ultimate" width="900">
</p>

## Proactive home intelligence for Node-RED

Cerebrum Ultimate observes your Node-RED smart home, learns from events and evaluates situations even when nobody is chatting. It maintains a persistent model of the home, answers questions and can act within the permissions you define. KNX Ultimate, Home Assistant, HUE, Matter, UniFi Protect and TTS Ultimate are optional fully functional integrations.

<br/>

[![NPM version][npm-version-image]][npm-url]
[![Node.js version][node-version-image]][npm-url]
[![Node-RED Flow Library][flows-image]][flows-url]
[![NPM downloads per month][npm-downloads-month-image]][npm-url]
[![NPM downloads total][npm-downloads-total-image]][npm-url]
[![MIT License][license-image]][license-url]
[![JavaScript Style Guide][standard-image]][standard-url]
[![YouTube][youtube-image]][youtube-url]

<p align="center">
  <a href="https://www.youtube.com/channel/UCA9RsLps1IthT7fDSeUbRZw/playlists" title="Visit Max Supervibe on YouTube">
    <img src="img/max-supervibe-youtube.png" alt="Max Supervibe on YouTube" width="70%">
  </a>
</p>

## IMPORTANT NOTICE

> When Cerebrum Ultimate is set to use cloud AI Models, the AI Models will receive data that are read from your local Node-RED. If you wish to maintain all data private, please use a local provider, like Ollama, LM Studio etc., that are natively supported by Cerebrum Ultimate.

## DEV POWERED BY GPT6-ASTRA

> The development of Cerebrum Ultimate is enhanced by OpenAI GPT6-ASTRA.

## What you can do

- Talk to your smart home in natural language.
- Ask for summaries, current states and recent events.
- Keep Cerebrum observing and reasoning without a chat request.
- Define which situations deserve attention, notifications or permitted actions.
- Receive supervised suggestions based on recurring habits.
- Create reminders and scheduled checks.
- Use cameras and voice when compatible nodes are available.
- Generate reviewable Node-RED flows with the **Node-RED Flow Builder**.
- Write and revise JavaScript from a prompt in **Cerebrum Function**, based on the native Node-RED Function.
- Back up and restore the Cerebrum configuration from the Web interface.

## Cerebrum Function (BETA)

**Cerebrum Function** combines the native Node-RED Function editor and runtime with prompt-based JavaScript authoring. It preserves **On Start**, **On Message**, **On Stop**, outputs, context, timers, async messaging, timeout, the Function library and configured external modules. The original Function node remains available.

1. Configure and deploy a **Cerebrum** node with its AI provider and model enabled.
2. Drag **cerebrum function (BETA)** from the **function** palette category. In **Setup**, check the selected Cerebrum and configure outputs, timeout or modules as needed. The first deployed Cerebrum with AI enabled is selected automatically; saved selections are preserved.
3. Open the **Cerebrum** tab, enter your request and optionally add an example `msg` JSON object. For example: “Double the numeric payload, preserving the other message fields,” with `{"payload": 21}`. The selected Cerebrum supplies its AI configuration and authorized ETS catalog automatically.
4. Click **Generate proposal**. An animated icon shows progress; the request and example fields are hidden until generation finishes or is cancelled. Review the proposed code using the code-section selector. Only the proposal is displayed, initially showing the first changed section.
5. Click the light green **Apply to editors** button to insert the proposal and open the corresponding code tab. The light red **Discard proposal** button removes the proposal. Use **Done** and **Deploy** to activate accepted code.

To revise a Function, reopen it and describe the change in the **Cerebrum** tab. Existing code is supplied to the model, including the lifecycle sections. Proposals are syntax-checked without execution and cannot overwrite code, outputs or module selections changed during generation. Check wiring if the proposed output count changes. **Cancel generation** stops waiting for a proposal; a model request already sent may still finish. **Cancel** in the node dialog discards editor changes.

Incoming messages execute the saved JavaScript locally with **no AI call**. You can also write code manually without an AI-enabled Cerebrum. Data access through `cerebrum` requires the selected Cerebrum to be deployed, but does not require its model to be enabled. Device operations use the downstream nodes wired into the flow. Prompts and example messages are saved with the flow; complete authoring requests and model responses are retained in Cerebrum's common archive.

In **On Message**, type `cerebrum.` to discover the read-only API. Inside `cerebrum.knx.get("…")` or `cerebrum.knx.state("…")`, completion shows authorized group addresses with names, DPTs and read-only flags. Search by address or name. State keys and saved automation names are suggested in their respective `get` calls. Completion works in Monaco and Ace, including the expanded editor. Use the refresh icon next to the expand button to reload the catalog after imports or configuration changes.

| API | Returned data |
| --- | --- |
| `cerebrum.available`, `cerebrum.info()` | Availability and identity of the selected Cerebrum |
| `cerebrum.knx.list()`, `.find(query)`, `.get(address)` | Authorized group addresses with name, DPT, area, aliases, read-only flag and observed state |
| `cerebrum.knx.state(address)` | Latest observed state for an authorized KNX address, or `null` |
| `cerebrum.states.list()`, `.get(key)` | Observed integration states, including keys such as `knx:1/2/3` |
| `cerebrum.functions.list()`, `.get(name)` | Managed JavaScript automation metadata; `get` also includes its `code` |

Choose an address from your catalog and use its observed value:

```javascript
if (!cerebrum.available) return null;
const sensor = cerebrum.knx.get("1/2/3"); // Replace using your catalog suggestions.
if (!sensor?.state?.fresh) return null;
msg.payload = sensor.state.value;
msg.topic = sensor.name;
return msg;
```

The API is synchronous, returns independent copies and is also available in **On Start** and **On Stop**. It follows the selected Cerebrum across redeployments and access changes. Methods throw when Cerebrum is unavailable; unknown or unauthorized objects return `null`. Observed states include `verifiedAt`, `ageMs` and `fresh`: reading does not query the bus or guarantee the current physical state. `cerebrum.functions` inspects saved automations without running them.

For a working Inject → Function → Debug flow, import [16 - Cerebrum Function](examples/16%20-%20Cerebrum%20Function.json). It doubles a payload of `21` to `42` without requiring AI at runtime.

Based on the official [Node-RED 5.0.7 Function](https://github.com/node-red/node-red/tree/5.0.7/packages/node_modules/@node-red/nodes/core/function), with [upstream attribution and license](nodes/vendor/node-red-function/README.md). Supported Node-RED versions start at 3.1.1; `node.linkcall` requires Node-RED 5 or later.

## Autonomous thinking and working memory

The **Cerebrum** Web menu opens on an animated brain. Its six connected neurons lead to Conversation, Learning, Memory, Goals, Web Research and Operations. Select a neuron or its section card to explore; use **Neural map** or the main **Cerebrum** menu to return. The animation is a visual navigation map. It supports keyboard navigation, a pause control and reduced-motion preferences.

Observation, background reasoning and autonomous actions are built into Cerebrum, with no separate switches to enable. Background reasoning runs while the LLM assistant is enabled. Cerebrum collects device events, maintains current world state, consolidates observations into episodes and keeps track of situations that need another check. A chat request is one reason to think; incoming events and due situation checks are others.

Native integration IDs remain the operational identity used for authorization and execution. Cerebrum also maintains a cross-integration entity registry above them: one semantic entity may have KNX, Home Assistant, HUE, Matter or UniFi bindings when an adapter supplies an explicit shared `semanticId`. Similar names or rooms alone never merge devices. State transitions and integration events become deterministic, evidence-linked observations before any LLM reasoning; hypotheses and correlated episodes remain distinguishable from those source facts.

The persistent world model lives in `cerebrumultimatestorage/cerebrum/memory/cerebrum-world-model-NODEID.json`. The model receives a bounded working view of relevant entities, episodes and situations, rather than the complete memory file. Raw archives and learned home memory remain separate sources. This lets knowledge survive between reasoning passes without accumulating every previous pass in the prompt.

In the node editor, **AI Assistant → Maximum managed context (KB)** controls the application context ceiling. Leave it at `0` to use the selected model's known or detected maximum automatically; enter a positive value to set a lower ceiling. For an otherwise unknown OpenAI-compatible model, the value declares the endpoint's effective context limit. Cerebrum never uses it to exceed a known or locally detected physical model window.

### Shared conversation and situational context

Web chat and Telegram use the same household memory. Every incoming message and outgoing reply is written in full to `cerebrumultimatestorage/cerebrum/memory/shared/cerebrum-memory.jsonl`, together with KNX and integration observations, model/tool results, catalog records and changes to learned home/world context. This append-only archive is flushed on each write and has no automatic expiry or total size cap. It is included as a streamed file in full ZIP backups.

Recent conversations and explicit memories are shared across channels. The model can search the complete archive and read individual records, including messages outside the recent prompt. V3 chat records still present on disk migrate before the working view is bounded; records already discarded by older versions cannot be reconstructed. The editable `.knxctx` V4 file is a bounded working view, not the complete archive. Clearing one chat or reinitializing that view does not erase the historical archive.

An explicit request to save actuator positions uses shared memory, with the scene name, observed values, device references and time. Restoring a scene consults current ETS details and follows the configured command validation and confirmation. ETS, shared-memory and KNX-history lookups have no fixed number of useful passes. The model can follow search → related objects → exact details, paginate results and revisit earlier evidence; unchanged query cycles terminate with an explicit uncertainty prompt. Working context is sized to the active model window, and ETS details are no longer capped at 24 acquired objects. Complete query results are recorded in the common file archive. New requests in the same chat and node shutdown cancel ongoing reasoning between calls. Historical values and assistant replies are not treated as live device state or proof of execution.

Current KNX capabilities are supplied separately from conversation history: gateway/link state, catalog availability, selected readable/writable objects and the configured command policy. Missing ETS details trigger retrieval; an empty or unconfigured selection is reported as a node configuration issue. Earlier chat claims about unavailable commands do not override newly saved ETS access.

ZIP backups include the current saved GA selection and read-only permissions in both the Cerebrum configuration file and the portable Node-RED flow. Restoring maps them to the destination node and refreshes the ETS selection screen immediately. Permissions remain on disk across node/gateway changes and restarts, even while the destination catalog is unavailable; only matching catalog objects can be used. Older backups recover access from their source flow when the configuration has no selection. If neither contains it, existing destination permissions are preserved; an explicitly empty selection remains empty.

### Persistence across Node-RED restarts

Cerebrum restores its retained knowledge and ongoing work from files automatically. No Node-RED context-storage setting is required.

| File under `cerebrumultimatestorage/cerebrum/` | Retained data |
| --- | --- |
| `memory/cerebrum-world-model-NODEID.json` | House model, evidence, behaviour patterns, goals, plans, reviews, Web sources, research reservations and action verification. |
| `memory/cerebrum-world-model-NODEID.json.observations.jsonl` | Observations saved immediately before the next reasoning cycle; replayed once using the checkpoint sequence. |
| `memory/cerebrum-runtime-state-NODEID.json` | Learned model context limits, hourly Web reservations, camera notification cooldowns and opening-duration baselines. |
| `memory/cerebrum-chat-context.knxctx` | Shared conversation memories, recent exchanges and camera watches. |
| `memory/cerebrum-home-memory.md` and `memory/cerebrum-habit-learning.json` | Shared household memory, recipient/language, occupant decisions and habits still being learned. |
| `schedules/cerebrum-schedules-NODEID.json`, `operations/`, `history/`, `adapter-history/` | Scheduled work and retained activity archives. |

New observations are appended and flushed to disk individually; consolidation saves their applied sequence before compacting the journal. A restart between those steps does not duplicate learning. Chat memories save immediately. Frequent home-state updates share a fixed 1.5-second save deadline, and shutdown performs a final checkpoint and waits for pending archive writes. Atomic file replacement and filesystem flushes protect completed checkpoints. A partially written journal tail is preserved separately before replaying complete records; invalid memory files are retained rather than silently overwritten.

Web reservations and autonomous action claims are saved before execution. A restart preserves their budgets and uncertain outcomes; it does not blindly repeat device commands. Completed research stages retain their sources even when a later request is interrupted. The Web backup includes the world checkpoint, observation journal and runtime state together. Working views remain bounded independently; historical archives follow the configured disk retention.

### Comfort goals and autonomous activity

Use **AI Education (user managed)** to describe what matters in your home: what Cerebrum should observe, when to notify you, which actions are permitted and any quiet hours or limits. For example: “Watch for lights left on in empty rooms. Notify me only after 30 minutes, between 07:00 and 23:00. Keep observing when occupancy is uncertain.” Notifications use the current Cerebrum recipient configuration. Learned observations do not change these user-managed rules.

AI Education is stored per node in `cerebrumultimatestorage/cerebrum/config/cerebrum-ai-education-<node-id>.md`. Press **Done** in the node editor to save the file and apply the instructions. **Cancel** discards unsaved changes; no Deploy is needed to apply saved Education. Deploy a new node before editing its file. The runtime reads the file for conversation and autonomous guidance; existing flow-property text migrates automatically only when the file is absent. An existing file, including an empty one, remains authoritative. The file is included in Cerebrum backups and restored to the destination node's filename. Older backups can recover education from the source node's migration flow; if no education was included, the destination keeps its current instructions.

Cerebrum also formulates its own comfort goals during daily reviews. Each goal names the observed need, expected occupant benefit, measurable criterion, baseline, current readings, practical plan, supporting observations and next review time. Goals move through observing, active, paused and retired states; an assessment records what the available evidence supports. An active or executed plan does not prove that occupants are happier. AI Education remains the only user instruction field; goals live in learned memory and can be revised as the house changes.

The engine aggregates received state transitions by entity, local hour and weekday/weekend across the last 28 days. A pattern becomes recurring only after observations on at least three distinct days. It retains numeric summaries, bounded categorical counts and timestamped source samples. Counts measure received transitions, not occupancy duration or continuous sensor coverage. Cerebrum's own matching command feedback is excluded from this learning. A reversal within ten minutes of an action pauses its linked goal and opens a review; the engine treats it as a possible occupant correction, another automation or device behaviour.

With **Web access** enabled, Cerebrum can research lighting, thermal comfort, indoor air quality, quiet routines, accessible controls, energy savings that preserve comfort, and SMART-home updates. A weekly discovery review runs without a chat request; goals can trigger focused research sooner. Search queries are constructed from fixed public topics and the integration family, never household labels, routines, occupants or AI Education. The engine retains excerpts from supported primary domains with URLs, retrieval dates and expiry, then evaluates applicability against local devices. Retrieved material is external evidence, not instructions or action permission. Source availability, dates and applicability still need evaluation by the model; a search does not guarantee a usable recommendation.

Describe the permitted actions in **AI Education**, the single user-managed instruction field for both conversation and autonomous behavior. Cerebrum can then act automatically within those instructions. The initial action path supports validated KNX state writes and Home Assistant `light`, `switch` and `input_boolean` state changes. Existing integration command permissions still apply: command access must be enabled and command confirmation must be disabled for autonomous execution. Read-only entities remain read-only. Confirming a learned habit does not itself authorize a device change.

The engine limits reasoning to 24 evaluations per rolling hour with at least 60 seconds between evaluations. Each evaluation can continue local recall and research as evidence requires, with paginated local queries and detection of repeated unchanged evidence cycles. There is no fixed model-call count per evaluation. Working context remains selective and scales with the model window; shutdown or disabling autonomy stops the loop between calls. Goal planning and practical action evaluation use separate passes. Autonomous research is limited to two sessions per rolling day, with one search and at most one page opening per session, sharing the existing Web-operation budget. Successful topics have a seven-day cooldown; unsuccessful attempts wait six hours. These count logical operations; redirects and search fallback can make additional HTTP requests. Reservations persist before research starts. Knowledge expires after fourteen days. Up to twelve goals can be active/observing, with forty retained goals, 240 pattern buckets and 48 Web-source records.

Notifications and actions share a limit of six per hour and a 30-minute cooldown per target. Each request passes through the normal model context budget. These limits meter background work; background calls use the selected AI provider and can consume tokens even when nobody is chatting. The previous proactive suggestion evaluator stays inactive to avoid duplicate evaluations.

### Read the world model locally

The Node-RED admin API exposes a read-only, bounded view:

```text
GET /cerebrumUltimate/world-model/:nodeId?operation=search&query=kitchen&limit=8&offset=0
```

Use `operation=search`, `get`, `episodes`, `situations`, `areas`, `habits`, `expectations`, `goals`, `patterns`, `knowledge` or `evidence`; `query` filters text, `entityIds` selects entities, and `limit`/`offset` page through results. `status` exposes collection counts and recent research outcomes. Responses are paginated and bounded; full memory files are not injected into prompts. The route uses Node-RED's `cerebrumUltimate.read` permission and respects the configured admin root. It reads the local store without calling the LLM or executing actions. An HTTP endpoint is a view of this memory service; continuous observation and reasoning are driven by the runtime engine.

The Web dashboard uses `operation=overview` for actual runtime activity, counts and retention information, and `operation=inspect&collection=goals&limit=12&offset=0` for complete retained records. Human inspection keeps full provenance and reviews instead of using the shortened LLM projection. Search (`q`) and status filters run on the server. Pages contain at most twenty records and 96 KiB; an oversized record is explicitly reported. Reading these views never starts reasoning, research or device actions.

### Understand what Cerebrum knows

The **Cerebrum** menu separates the retained knowledge into readable views:

| View | What you can inspect |
| --- | --- |
| Cerebrum Learning | Learned instructions, observed behaviour, conversation text and camera watches. |
| Cerebrum Memory | Current device observations and their freshness, situations needing attention, expected events, evidence and episodes; shared habits, occupant corrections and known objects. |
| Goals | Self-generated comfort objectives, plans, current assessments and status. |
| Web Research | Retained source text, source URLs, retrieval times and research outcomes. |
| Cerebrum Operations | Action records and outcomes, followed by the retained KNX/LLM/tool activity log. |
| JavaScript automations | Actual functions created by Cerebrum: purpose, active/paused/error status, last execution, editable `.js` source, pause/resume and deletion. Deterministic handlers execute locally without LLM calls. |

Learning, memory, goals, research and activity lists use read-only textareas: one record per line, with date/time and readable text. Long text is preserved, with internal line breaks flattened. World-model collections load their pages locally into the same text field; there are no record cards or expandable JSON details. The technical activity endpoint retains its existing 2,000-record limit. Full records and metadata remain in the files and backups; these UI changes do not alter stored memories. Advanced file editors remain available separately.

## Example flows

The package includes 15 ready-to-import flows for conversations, summaries, independent sessions, reminders, Web research, flow events, Home Assistant, Telegram, TTS and supervised KNX use.

Open **Node-RED → Menu → Import → Examples → node-red-contrib-cerebrum-ultimate** and start with **01 - First Conversation**. Each flow contains a short instruction directly in the workspace; integrations that require another package are clearly marked and never include credentials or gateway addresses.

## Compatible nodes detected

Open the Cerebrum node and use **Compatible nodes detected**. Cerebrum shows the integrations available in the current Node-RED project.

For integrations such as KNX Ultimate and UniFi Protect, the same field lets you select an existing configuration, edit it or create a new one. Nothing is required if you do not use that integration.

## KNX: ETS Access, Areas, Tests and Test Results

The KNX test workspace is designed for commissioning and troubleshooting. It helps answer practical questions such as:

- Is the correct command group address being used?
- Does the actuator publish its new status after a command?
- Does the status address answer an explicit read request?
- Does the returned value match the requested value?

This is useful when checking a new installation, after changing an ETS project, or when a light, shutter, HVAC function or other actuator does not behave as expected.

Install KNX Ultimate, select or create its gateway under **Compatible nodes detected**, and make sure the gateway contains your ETS group addresses. Cerebrum then provides this guided path:

`ETS Access → Areas → Test plans → Test Results`

Open **KNX → ETS Access** in the Cerebrum Web UI to choose the group addresses Cerebrum may use. Selected addresses are readable; selected addresses not marked **Read only** are writable after the normal local validation and, when enabled, user confirmation. Existing selections stored in the Node-RED flow are migrated automatically when this page is first saved.

### 1. Areas

An area limits the test to a clear part of the installation, such as the living room, the first floor, the lighting system or the HVAC system. This makes it easier to select the correct addresses and avoids testing unrelated devices.

Open **KNX → Areas** to:

- Select an area suggested from the ETS structure, or create one.
- Give it a clear name and choose the group addresses that belong to it.
- If AI is enabled, Cerebrum can help suggest the most relevant addresses.

An area must contain at least one group address before it can be used in a test.

### 2. Tests

Cerebrum can perform two kinds of checks.

#### Read-only diagnosis

A read-only diagnosis does not operate any actuator. It examines the KNX traffic already observed for the selected area and reports:

- which group addresses have recently been active;
- which addresses have remained silent;
- whether recent anomalies belong to that area;
- whether the observed activity matches the selected diagnostic profile.

This is the safest first check. A silent address is not automatically faulty: the related device may simply have had no reason to transmit during the observation period.

#### Active functional test

An active test checks the complete command-and-feedback path. For each configured step, Cerebrum can:

1. Send the requested value to the command address.
2. Wait for the status address to publish a spontaneous update.
3. Read the same status address and wait for its response.
4. Compare both feedback values with the value that was expected.

In KNX terms, this means sending a command telegram, observing the status `GroupValue_Write`, then sending a `GroupValue_Read` and checking the returned `GroupValue_Response`.

For example, when testing a living-room light, Cerebrum sends **On** to its command address, waits for the status address to report **On**, reads that status once more and checks that the response is still **On**. This verifies much more than simply seeing the light switch.

These two feedback checks help distinguish common problems. For example, an actuator may update its status spontaneously but not answer reads, answer reads but not publish changes, return an unexpected value, or provide no feedback at all.

Open **KNX → Tests**, select an area and start a new plan. Standard templates are available for lights, shading, HVAC and the main actuators. Before running the test you can:

- review and change every command and status address;
- check the DPT (KNX data type) and expected value;
- add pauses between operations;
- save the plan for later use;
- run it once or repeat it until you stop it.

> Active tests send real telegrams to the KNX bus. Cerebrum always shows a confirmation before starting: review the plan and make sure the installation is safe to operate.

The tests verify KNX communication and configured feedback. They do not replace electrical, mechanical or on-site safety checks.

### 3. Test Results

Open **KNX → Test Results** to follow a running test or inspect a saved report:

- **Pass** means all configured checks for that step succeeded.
- **Warning** means a possible issue needs attention; in an active test, this usually means that only one of the two feedback checks succeeded.
- **Fail** means feedback was missing, arrived too late or contained a different value.

If a step has no status address, Cerebrum can confirm only that the command telegram was sent. A successful write-only step does **not** prove that the physical actuator moved or that the load switched.

Each report contains the command used, the received feedback, timing details and practical suggestions. You can reopen the source plan, delete an old result or export the report as a PDF for commissioning records.

## Home Assistant

Connect Cerebrum's dedicated **Home Assistant** output to a Home Assistant `ha-api` node, then return the API output to Cerebrum's input:

```text
Cerebrum output 6 (Home Assistant) → API (ha-api) → Cerebrum input
```

Select the Home Assistant server in `ha-api` and deploy the flow. If Cerebrum reports a missing connection, check the output 6 → `ha-api` → Cerebrum input wiring. Cerebrum correlates API responses internally; no additional bridge node is required.

## Safety and privacy

Cerebrum separates observation, suggestion, authorization and execution. A learned habit alone never authorizes a command. Autonomous changes follow the instructions in AI Education and the existing integration command permissions. KNX group addresses marked read-only cannot receive writes.

Home data used in chat or background reasoning is sent to the configured AI provider. For a fully local setup, use a compatible local provider such as Ollama or LM Studio.

### Autonomous KNX history queries

The conversational model has a read-only `historyActions` tool for the daily KNX archive. It can autonomously query a precise ISO 8601 time range, filter by destination or source address, event type, DPT and free text, optionally request raw hex, and receive both decoded telegrams and aggregate counts in a following reasoning pass. Empty dates query the latest 20 minutes. Requests are clamped to the configured archive retention (30 days by default) and never expose a general filesystem API.

Each pass accepts up to two queries with at most 200 returned telegrams per query, and the model can continue with additional, narrower history queries whenever the evidence requires them. There is no fixed number of history passes; unchanged query cycles trigger an uncertainty prompt. Results are bounded to the active model context and, like other prompt data, are sent to the configured AI provider.

### Recorded camera events and snapshots

Camera providers may expose `queryEvents()` and `takeEventSnapshot()` in addition to the existing live-event and current-snapshot operations. During an authorized chat, Cerebrum can search recorded events by camera, event/object type and ISO 8601 range, inspect an explicit continuation offset when more controller pages exist, then request the JPEG attached to an exact returned event. A request such as “show me the snapshot of the last detected movement” therefore performs recorded-event query → exact event selection → event snapshot; it never substitutes a current camera image.

With `node-red-contrib-unifi-ultimate`, recorded history is enabled by the optional local **History user/password** in the selected UniFi Protect config node. The official Protect Integration API key supports live events and current snapshots but does not expose the recorded archive, so the UniFi config node owns the separate local session. Cerebrum receives only normalized event evidence and image bytes; credentials, cookies, private endpoints and raw controller responses remain inside the provider. Other camera packages can implement the same vendor-neutral methods.

### Local JavaScript automations

In the Node-RED node editor, **History updates to LLM** defaults to **Only during user chat** (also for existing flows without this setting). Observation, raw history storage, current states, local learning and JavaScript callbacks continue without background model calls. An open Web page or a Telegram session ID is not an active chat: a user request authorizes only its own reasoning and tool follow-ups.

Choose **During chat and at an interval** to also authorize periodic history/comfort reviews, from **1 to 10080 minutes (7 days)**. `1440` means one day. The first review waits the configured interval; the checkpoint preserves the last attempt across restarts. Missed intervals are not replayed, failures wait until the next interval, and a due review waits while a chat is being processed. Review timing and errors are retained in the runtime checkpoint. Each configured Cerebrum node owns its interval.

The model receives aggregates and a bounded evidence selection from the collected period, plus current world memory; raw history remains locally archived and available to chat retrieval within the configured retention window. This is not a bulk upload of every telegram or a guarantee that every archived event has been analyzed. Useful tool follow-ups can require multiple model calls within an authorized task. Explicit `assistant.run` calls in active `.js` files remain independent of the interval; ordinary callbacks and `speak` use no LLM. Startup notifications are generated locally. AI tools outside chat wait for an authorized context or report the policy restriction.

Ask Cerebrum in chat what to automate. For deterministic reminders, schedules and event rules, it can create a real `.js` function and keep it running locally. Saving **AI Education** queues generation of missing functions for the next user chat or configured periodic review. Saved instructions are also checked locally after startup. **Check AI Education** queues a retry under the same policy; compilation status and errors are retained in the runtime checkpoint. The Web sidebar’s **JavaScript automations** page displays these actual functions, their purpose, status and last run. It starts empty; no example files or programming task are presented to the user.

Open a function to inspect, edit or download its JavaScript. **Pause** stops future callbacks and cancels pending named timers; **Resume** validates the current source and permissions. Saving an active function applies the new code; saving a paused function leaves it paused. **Delete automation** stops the function, removes its `.js` file and retains its source in the common archive. Background planning cannot overwrite, resume or recreate an existing/deleted filename. Unsaved edits survive section navigation, and stale saves are rejected. An external source edit stops execution until you review and resume it.

Sources live under `cerebrumultimatestorage/cerebrum/automations/<node-id>/`. A single `<node-id>.runtime.json` file beside that directory holds statuses, revisions, durable memory and timer checkpoints. Source revisions and execution records are retained in shared memory; ZIP backups include both sources and runtime metadata. Restored functions start paused for review. Existing local files are retained and start paused when no runtime registration exists.

Functions run in a supervised QuickJS WebAssembly worker without access to Node, RED, files or the network. Supported triggers are KNX/integration state changes, incoming plugin events, daily/interval/one-time schedules and named timers. Effects are notifications and currently supported KNX/HA writes. Current command permissions, ETS selection, read-only access and DPT checks still apply; per-command confirmation prevents unattended writes. HA writes currently support lights, switches and input booleans. The interpreter has CPU, memory and output limits and stops a function on an error. Missed jobs are skipped, and uncertain deliveries are not automatically retried.

Deterministic local executions do not invoke the LLM. A function can explicitly use `assistant.run` at its deadline for fresh Web research, sensor reads and a generated reply or TTS announcement. A daily weather announcement therefore has a visible `.js` schedule and uses the model only when the task fires. `speak` sends prepared text directly to the existing TTS output. The model is also used to author/revise functions; the authoring API is only added to its context when needed. Legacy semantic schedules are preserved for inspection/cancellation but suspended; create their replacements as real `.js` functions. Autonomous LLM reasoning follows the configured history review interval. After updating this package, restart Node-RED and reload the Web page to load the new runtime and assets.

### Isolated local Node-RED runtime inspection

The advanced **Allow the AI to inspect the local Node-RED runtime with JavaScript** option is off by default. Cerebrum itself reads Node-RED's registry locally and builds a sanitized capability inventory containing installed node sets, deployed flow nodes, registered home-automation/camera adapters, provider readiness and supported operations. When the option is enabled, the conversational model may query that immutable data-only snapshot with synchronous JavaScript through `runtime`, `node`, `RED.nodes.eachNode/getNode/getType/listTypes/listNodeSets`, `RED.integrations`, `question` and `sessionId`. Live Node-RED objects, context stores, provider functions, credentials, filesystem, network, deployment and message sending are not exposed to model-generated code.

The JavaScript runs with a short timeout and without host references. Its input and bounded result are still model context, so prefer a local model when even the sanitized runtime inventory must remain local. The option is intended for ad-hoc filtering and correlation of the capability snapshot; ordinary integration discovery is added to Cerebrum's context automatically and does not require model-generated JavaScript.

Execution is synchronous and bounded to one action per model pass, at most two execution passes, 12,000 source characters, 500 ms per script and a 64 KB serialized result. These limits protect responsiveness and context size; the available `node` and `RED` methods are also restricted to the read-only snapshot API listed above.

## Local memory and backup

Cerebrum saves its memory automatically, including habits that are still being learned, so progress is not lost when Node-RED restarts. Confirmed routines remain available in the **Cerebrum Memory** Web interface, where they can be reviewed or removed. **Settings → Import / Export** provides an easy way to create and restore backups.

Set **History retention (days)** in the node editor under **AI Assistant** (`historyRetentionDays`, default **30**, valid range 1–36500). Existing flows without this property also use 30 days. On deploy, after restore and every hour, Cerebrum removes expired records from the shared conversation/observation/context/operation archive and deletes old daily KNX, adapter and operation files. Daily files covering the cutoff date remain until the following day; queries use the exact retention window. Cleanup also runs when the AI is disabled or idle. Deletion is permanent; increasing the value later cannot recover deleted history. Saved instructions, AI Education, learned habits and the current world/runtime state are kept separately and are not expired by this option.

Web, Telegram and nodes using the same storage directory share one archive. Configure the same retention on these nodes: a shorter enabled retention can delete records for every channel/node. Shared-archive compaction streams into a temporary file, preserves retained record IDs and replaces the original atomically; it needs temporary free space for retained data. Existing archives and backups remain readable; newly compacted shared archives require a Cerebrum version supporting history retention. Backups made before deletion retain their original contents; restored archives are cleaned according to the destination node's retention.

The **Download ZIP** button prepares a compressed `.zip` archive on disk and starts a native browser download. **Restore ZIP** lets you select that archive directly, without extracting it. The enclosed `cerebrum-backup.json` uses backup format **3**, with daily archives stored separately under `archives/` inside the ZIP. Keep the complete ZIP: its JSON manifest alone cannot restore the histories. The backup includes the selected node's AI configuration (areas, GA roles, ETS access, profiles, tests and results), shared conversations/instructions/camera watches, home memory and learning checkpoint, the node's persistent world model, observation journal and runtime state, scheduled tasks, all retained KNX and adapter event archives, the operations archive, the last prompt diagnostic and any legacy area file. World-model restoration uses the destination node's local filename and participates in backup validation and rollback. Pending archive writes finish before the snapshot is taken. History already deleted by the normal retention policy cannot be recovered by a backup.

The ZIP includes `cerebrum-backup.json`, `cerebrum-flows.json`, `required-packages.json`, `README.txt` and the daily archive files. The manifest also embeds the **Node-RED migration flows**: the containing flow tab, recursively referenced config nodes, linked tabs and subflows, node settings, chat adapter code, integration credentials, the ETS text (including a CSV/ESF originally loaded from a file), a runtime ETS catalog snapshot and the package dependency list. **Cerebrum AI provider API keys are excluded**; destination AI keys are left unchanged. Other integration credentials are included, so keep the backup private. Export requires the Node-RED `flows.write` permission. Browser downloads use a single-use link that expires after ten minutes.

The manifest's `files.aiEducation` entry contains the complete user-managed AI Education file, including its size and SHA-256 digest. New migration flows omit the old `aiEducation` property. Restore validates the education file before changing data and restores the previous instructions if a later write fails.

To move Cerebrum to another installation:

1. Click **Download ZIP** in the source node’s Web settings.
2. Unzip the archive and install Cerebrum and the integration packages listed in `required-packages.json` on the destination.
3. Import `cerebrum-flows.json` in the Node-RED editor, review connections and deploy. Preserve the source IDs where possible, particularly IDs used by camera subscriptions and external integrations.
4. Open the destination Cerebrum node's Web settings and choose **Restore ZIP** with the original ZIP archive. This restores its data and archives, remapping storage filenames to the destination node ID, and replaces the shared learning/memory used by other Cerebrum nodes on that storage.
5. Re-enter the AI provider API key and verify external service addresses. The data survives subsequent Node-RED restarts.

Importing Cerebrum data does not deploy or overwrite Node-RED flows automatically: node options and integration credentials are restored by the editor import in step 3. Each backup covers one selected Cerebrum node plus the shared memory; export each Cerebrum node separately if you have several. Custom context stores, external certificates/files/modules, environment variables, installed AI models and the external services themselves belong to the surrounding Node-RED installation and must be provisioned there as well. The backup is not an operating-system or whole-Node-RED disk image.

Previous version 1 and 2 JSON backups and earlier ZIP backups remain importable. Version 1 backups cannot recover the archives and flow settings they never contained. Versions 2 and 3 check file sizes and SHA-256 digests before changing data, reject unsafe filenames, replace destination archives instead of merging stale history, and roll back on write errors. ZIP imports also validate CRC-32 checksums. ZIP size and total archive size have no fixed byte limit: export snapshots, uploads, decompressed daily archives and rollback copies use temporary files rather than accumulating history in RAM. Imports arrive in small chunks. Archive paths are mapped to private temporary filenames, then to the selected node's known storage directories. Temporary files are removed after completion or failure; abandoned uploads and pending downloads expire after ten minutes. The system temporary directory needs enough free disk space for these files. Only the JSON metadata and legacy JSON uploads retain the 256 MiB memory bound; it does not include the separately stored daily archives. New ZIP backups require a Cerebrum version supporting format 3.

The adjacent **Cerebrum Operations** view provides a compact activity log for the configured retention window (30 days by default). It combines the existing daily KNX traffic archive with LLM requests, catalog/history/Web/JavaScript tools, KNX reads and writes, schedules, camera/TTS/memory actions and autonomous activities such as state reconciliation, habit learning, habit proposals and proactive notifications. Each line shows the recorded time, activity text and outcome. Complete direction and diagnostic metadata remain in the archive. The node-operation archive is stored per Cerebrum node under `cerebrumultimatestorage/cerebrum/operations/`; credentials and obvious secret fields are redacted, and expired daily files are removed automatically.

## Adapter API

Optional packages can register an adapter and one or more providers without importing KNX Ultimate:

```js
const { getAdapterRegistry } = require("node-red-contrib-cerebrum-ultimate");

const registry = getAdapterRegistry();
registry.registerAdapter({
  id: "my-adapter",
  title: "My adapter",
  kind: "home-automation",
  capabilities: ["states", "events"],
  operations: ["events", "list-entities", "read-entity"],
  access: "observe",
});
registry.registerProvider({
  id: "my-controller",
  adapterId: "my-adapter",
  title: "My controller",
  capabilities: ["states"],
  connected: true,
  isReady: () => true,
  subscribe: (listener) => {
    // Return an unsubscribe function.
    return () => {};
  },
});
```

The versioned capability contract distinguishes an installed adapter from a deployed, connected, ready and actually usable provider. Standard operations are `events`, `list-entities`, `read-entity`, `list-services`, `write-entity`, `list-cameras`, `camera-snapshot`, `query-camera-events` and `camera-event-snapshot`; provider methods are detected from the corresponding `subscribe`, `listEntities`, `getEntity`, `listServices`, `callService`, `listCameras`, `takeSnapshot`, `queryEvents` and `takeEventSnapshot` functions. Write operations remain subject to Cerebrum authorization and confirmation rules: declaring an operation never grants permission to control a device.

Provider callbacks must catch their own I/O errors. Providers should expose `connected`, `isReady()` and, when useful, a data-only `health` status. Cerebrum isolates provider, flow-hook, timer, storage and output failures so an adapter cannot terminate Node-RED. The runtime capability snapshot passed to reasoning contains only sanitized metadata and never exposes RED, node instances or provider functions.

## License

Released under the [MIT License][license-url].

[npm-url]: https://www.npmjs.com/package/node-red-contrib-cerebrum-ultimate
[npm-version-image]: https://img.shields.io/npm/v/node-red-contrib-cerebrum-ultimate.svg
[node-version-image]: https://img.shields.io/node/v/node-red-contrib-cerebrum-ultimate?logo=node.js&logoColor=white
[npm-downloads-month-image]: https://img.shields.io/npm/dm/node-red-contrib-cerebrum-ultimate.svg
[npm-downloads-total-image]: https://img.shields.io/npm/dt/node-red-contrib-cerebrum-ultimate.svg
[flows-image]: https://img.shields.io/badge/Node--RED-Flow%20Library-white?logo=nodered&logoColor=8F0000
[flows-url]: https://flows.nodered.org/node/node-red-contrib-cerebrum-ultimate
[license-image]: https://img.shields.io/badge/license-MIT-blue.svg
[license-url]: https://github.com/Supergiovane/node-red-contrib-cerebrum-ultimate/blob/main/LICENSE
[standard-image]: https://img.shields.io/badge/code_style-standard-brightgreen.svg
[standard-url]: https://standardjs.com
[youtube-image]: https://img.shields.io/badge/YouTube-Max%20Supervibe-red?logo=youtube&logoColor=white
[youtube-url]: https://www.youtube.com/channel/UCA9RsLps1IthT7fDSeUbRZw/playlists
