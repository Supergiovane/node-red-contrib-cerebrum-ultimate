# Cerebrum Ultimate

Cerebrum Ultimate is the supervised home-automation intelligence for Node-RED. It learns repeated household routines from bounded local state and event history, asks the occupant before accepting a habit, and never turns an inferred habit directly into an unsupervised write.

The package is intentionally independent from any single automation ecosystem. Its central `Cerebrum` node runs without KNX and discovers the integrations available in the current Node-RED project:

- Node-RED flow logic and observable flow events;
- Home Assistant through the included `Cerebrum Home Assistant` bridge and an `ha-api` round trip;
- HUE and Matter nodes already present in the flows;
- KNX Ultimate, when installed, as an optional gateway and ETS/DPT authority;
- external camera or automation packages that register a provider through the public adapter registry.

## Compatible nodes detected

Open the Cerebrum node and use **Cerebrum (BETA) → Compatible nodes detected** to review every detected integration. Config-backed integrations use the native Node-RED selector, so the same field can select, create or edit a config node.

- KNX Ultimate uses an optional `knxUltimate-config` gateway.
- UniFi Protect uses an optional `unifi-protect-config` controller. Only the controller selected on that Cerebrum node is exposed to its chat and camera tools.
- HUE, Matter, Home Assistant, TTS Ultimate and vendor-neutral adapters are listed with their detected/ready state and continue to use their existing flow or adapter contract.

Neither selector adds a package dependency: Cerebrum still installs and loads when KNX Ultimate and UniFi Ultimate are absent.

## Safety model

Cerebrum separates observation, proposal, confirmation and execution. Repeated patterns must span multiple distinct days and a minimum observation period before the user is asked to accept or correct them. Confirmed habits remain proposals: every actual operation is validated again against the selected integration and requires the configured user confirmation.

For KNX, the selected ETS catalog is authoritative. Group addresses marked read-only can be observed and queried but are rejected for every write path.

## Home Assistant

Place `Cerebrum Home Assistant` in a flow and connect:

`Cerebrum Home Assistant → API (ha-api) → Cerebrum Home Assistant`

Home Assistant event/state nodes can also feed the bridge input. Setup Doctor detects the Home Assistant add-on environment and reports a missing `ha-api`, missing bridge or incomplete round trip.

## Local memory

Runtime data is stored independently under:

`<Node-RED userDir>/cerebrumultimatestorage/cerebrum/`

The Web workspace includes editable authoritative data and simplified read-only views for Cerebrum Memory and Cerebrum Learning. Import/export includes configuration, Cerebrum Learning, home memory, schedules and their readable companion files.

## Adapter API

Optional packages can register an adapter and one or more providers without importing KNX Ultimate:

```js
const { getAdapterRegistry } = require('node-red-contrib-cerebrum-ultimate')

const registry = getAdapterRegistry()
registry.registerAdapter({
  id: 'my-adapter',
  title: 'My adapter',
  capabilities: ['states', 'events'],
  access: 'observe'
})
registry.registerProvider({
  id: 'my-controller',
  adapterId: 'my-adapter',
  title: 'My controller',
  capabilities: ['states'],
  subscribe: listener => {
    // Return an unsubscribe function.
    return () => {}
  }
})
```

Provider callbacks must catch their own I/O errors. Cerebrum also isolates provider, flow-hook, timer, storage and output failures so an adapter cannot terminate Node-RED.

## Status

This is the first standalone `0.0.x` preview. It deliberately does not migrate or read the legacy assistant's storage or runtime type.

## Complete English user guide

This section consolidates the English documentation that previously lived in the KNX Ultimate wiki. It has been adapted to the standalone Cerebrum node, its new names and storage paths, and its optional-integration model.

### Node outputs

The `Cerebrum` node has five outputs:

1. **Summary / Stats** — traffic and observed-event statistics in `msg.payload`.
2. **Anomalies** — detected anomalies in `msg.payload`.
3. **Cerebrum Assistant** — chat, onboarding, habit proposals, proactive notifications and model answers.
4. **KNX operations** — validated Universal Mode messages for the selected optional KNX Ultimate gateway.
5. **TTS Ultimate** — one announcement message for each model-selected spoken response.

Assistant and KNX-operation messages preserve a clone of the original input in `msg.inputMessage` whenever one is available. Adapter mapping, cloning and output errors are contained and reported instead of escaping into the Node-RED runtime.

At startup, output 3 emits a supervision notice with `msg.boot = true`. If the LLM is enabled, Cerebrum asks the selected model to generate the notice as a live inference test. The result is exposed in `msg.cerebrum.llmTest` as `passed`, `disabled` or `failed`, together with the provider and model when available. A localized fallback is still emitted if the model is disabled or the request fails. This test never reads or writes an actuator.

### Setup Doctor and safe first run

Setup Doctor checks the deployed Cerebrum node, LLM enablement, provider, model, API key, provider reachability, flow wiring, compatible integrations, cameras and the optional TTS output. Its provider preflight uses the model-list endpoint and does not send a chat inference.

KNX, ETS, cameras, UniFi Protect, HUE, Matter, Home Assistant and TTS are optional. Their absence does not make the Cerebrum core unavailable. When an integration is expected, Setup Doctor explains the missing step. For Home Assistant this includes detecting the add-on environment and identifying a missing `ha-api`, bridge or return wire.

Setup Doctor reads the last deployed flow. Deploy provider, model, compatible-node selection and wiring changes before pressing **Refresh**.

Send `/start` or `/help` from a chat to receive deterministic localized onboarding on output 3. It does not call the LLM, operate actuators, use cameras, generate TTS or change persistent memory. With the Telegram preset, suggested actions appear as buttons and run only after the user explicitly selects one.

### Compatible nodes detected

Open **Cerebrum (BETA) → Compatible nodes detected** in the node editor. The list distinguishes between:

- detected packages and runtime adapters;
- config-node-backed integrations that require an explicit selection;
- integrations already used by the current chat context;
- flow-based integrations whose availability comes from deployed nodes or wiring.

For config-backed integrations, Node-RED's native typed-input selector can select an existing config node, edit it, or create a new one. Cerebrum does not duplicate the integration's configuration form.

#### KNX Ultimate

When `node-red-contrib-knx-ultimate` is installed, select or create a `knxUltimate-config` gateway. The selected gateway supplies live telegrams, the ETS catalog and DPT validation. Cerebrum still starts normally if the package or gateway is absent.

The ETS inventory reports unique group-address signals, ETS areas/groups and an approximate count of logical functions. It does not claim a physical-device count because that cannot be derived reliably from an ETS CSV.

#### UniFi Protect

When `node-red-contrib-unifi-ultimate` exposes its integration, select or create a `unifi-protect-config` controller. Only providers belonging to the controller selected on this Cerebrum node are available to its camera tools and chat context. Cerebrum must not silently aggregate cameras from other controllers.

#### Other compatible nodes

HUE, Matter, Home Assistant, TTS Ultimate and vendor-neutral adapters appear with their detected and ready state. Packages can integrate through the public adapter registry described above. A provider must return an unsubscribe function from subscriptions and contain its own I/O failures.

### Commands and chat input

Send one of these values in `msg.topic`:

- `summary` or an empty topic: emit the current summary immediately;
- `reset`: clear the node's internal history, counters, learned home memory, persisted chat context and schedules; user-authored AI Education remains unchanged;
- `ask`: send a question to the configured LLM;
- `confirm` or `cancel`: accept or cancel a pending operation without another LLM call;
- `clear_chat`: clear recent turns, learned instructions, pending commands and schedules belonging to the current session while leaving other sessions and AI Education unchanged.

For `ask`, put the question in `msg.prompt` (preferred), a string `msg.payload`, `msg.payload.content` or `msg.payload.text`.

Sessions are resolved from `msg.cerebrum.sessionId`, `msg.sessionId` or a supported chat adapter's chat identifier. The most recently active session is remembered as the recipient for spontaneous Cerebrum messages.

If a model request lasts longer than approximately 1.2 seconds, output 3 emits a localized transient “I'm thinking…” message with:

```js
msg.cerebrum.type = 'thinking'
msg.cerebrum.transient = true
```

The final answer follows normally. Transient progress is never saved as a conversation turn or learned memory.

### Input and output message adapters

The **Cerebrum input and output pins** editor section loads presets from `resources/CerebrumChatAdapterMappings.js`. A preset installs bounded synchronous mappings before input processing and before assistant output. Mapping syntax and execution errors are caught and reported without stopping Node-RED.

The included `windkh/node-red-contrib-telegrambot` preset connects a Telegram receiver to Cerebrum and output 3 to a Telegram sender. Confirmation uses a one-time reply keyboard; legacy callback-query messages remain accepted.

The included RedBot / `node-red-contrib-chatbot` Telegram preset connects `chatbot-telegram-receive` to Cerebrum and output 3 to `chatbot-telegram-send`. RedBot postbacks are normalized as inbound messages, so a separate callback node is not required.

Telegram voice handling is available with an OpenAI-compatible provider. Cerebrum uses the configured provider connection for bounded transcription and speech generation, strips token-bearing download URLs before messages reach outputs or prompts, and falls back to the complete text answer when speech is unavailable. Native voice replies begin with a localized AI-generated-voice disclosure.

### Web Intelligence

When **Allow the AI to use the Web** is enabled, the model may choose a structured Web tool when the current request requires fresh public information. It does not use keyword lists or a fixed background polling cycle. A user turn or scheduled run can perform at most three Web operations, and all outbound Web requests share the configured rolling hourly budget.

If an essential subject, place, time range or outcome is missing, Cerebrum asks one concise clarification and performs no Web operation until the user answers. Future checks exist only when the user explicitly creates a schedule.

Web-backed answers contain runtime-validated citations with a sanitized source URL and retrieval time, plus publication time when available. External pages are untrusted data and cannot alter tool permissions. Only bounded public HTTPS resources are accepted; private, local, link-local and cloud-metadata targets, unsafe redirects, authenticated browsing and cookies are blocked.

Web access never expands integration permissions. Queries expose the requested search text and the server's public IP to external services, but Cerebrum does not automatically add home events, ETS data, camera content, chat identifiers, learned memory or credentials.

### Natural-language plans, reminders and monitors

Users can create, list or cancel one-time and recurring reminders, monitors and future home commands in normal language. The model chooses the structured `scheduleActions` tool from the complete request; there are no schedule keyword lists or rigid intent classifiers.

Schedules belong to a chat session and survive Node-RED restarts. Their files are:

```text
<Node-RED userDir>/cerebrumultimatestorage/cerebrum/schedules/cerebrum-schedules-<node-id>.json
<Node-RED userDir>/cerebrumultimatestorage/cerebrum/schedules/cerebrum-schedules-<node-id>.md
```

The JSON file is authoritative and the Markdown file is its human-readable mirror. A task can run once, repeat at intervals of at least five minutes and optionally expire. A session can list or cancel only its own active tasks unless its user explicitly requests cancellation of all tasks belonging to that session.

When a task becomes due, Cerebrum runs a separate model pass with the stored instruction. A monitor remains silent when its condition is false. All current permissions are checked again: Web budgets, selected camera controller, TTS wiring, KNX ETS/DPT validation, read-only protection and operation confirmation still apply.

### Bounded context and local retrieval

Continuous collection is deterministic and event-first; it does not ask the LLM. Cerebrum observes bounded, sanitized Node-RED, KNX, HUE, Matter, Home Assistant and registered-adapter events. Credentials, authorization headers, opaque media and binary payloads are discarded.

A 15-second reconciler handles stale or missing state instead of continuously polling everything. Home Assistant uses adaptive hot/warm/cold snapshot intervals. When KNX state access is enabled, stale recognized state objects can be refreshed with deterministic `GroupValue_Read` operations, at most one per tick and 60 per hour. The reconciler never emits an autonomous write.

Each prompt receives a relevance-ranked, size-bounded slice of current state, recent exact events, memory, schedules, Web results, retrieved catalog objects and camera metadata. The complete ETS catalog remains local and is queried through bounded retrieval actions. Search covers exact addresses, names, aliases, hierarchy, areas, semantics, DPTs and value labels with accent-insensitive and typo-tolerant ranking.

Without an explicit time range, event retrieval covers the latest 20 minutes. Complete Function-node source is included only when the user explicitly asks for Function-code review. Provider-reported token counts are used when available; otherwise the UI marks them as estimates.

### Cerebrum Memory and Cerebrum Learning

The shared files are:

```text
<Node-RED userDir>/cerebrumultimatestorage/cerebrum/memory/cerebrum-chat-context.knxctx
<Node-RED userDir>/cerebrumultimatestorage/cerebrum/memory/cerebrum-home-memory.md
```

Open **Cerebrum → Cerebrum Learning** in the Web UI to switch between:

- **Native file**, the editable authoritative records;
- **Simplified text**, a localized read-only explanation of sessions, learned instructions and camera watches.

Copy follows the selected view. Download and restore always preserve the complete native file. Saving is bounded, atomic and revision-checked so one browser cannot overwrite newer learning. Reinitialization requires explicit confirmation. The context is limited to 50 sessions and 512 KB.

Open **Cerebrum → Cerebrum Memory** to switch between editable authoritative JSON and localized read-only simplified text. It contains learned habits, occupant decisions, observations, notifications, semantic home objects, the adaptive state cache and reconciler diagnostics. Saving validates the data and regenerates the readable sections. The file is atomically maintained and capped at 5 MB.

The memory is deliberately bounded to at most 120 significant observations, 80 aggregate habits, 120 occupant decisions, 80 notifications, 300 semantic objects and 600 current states. Older low-priority entries are removed first; Cerebrum does not preserve an unlimited raw event stream in home memory.

The Web UI **Settings** page contains only **Import / Export**. Its strict backup includes persisted Cerebrum configuration, Cerebrum Learning, home memory, schedules and readable companion files. It does not accept legacy assistant exports.

### Habit learning and occupant control

Cerebrum learns bounded weekday/weekend patterns from KNX writes and HUE, Matter or Home Assistant state changes. A pattern must reach all of these thresholds before the LLM is asked to phrase a proposal:

- at least eight consistent observations;
- observations on at least six distinct dates;
- a minimum 14-day span;
- confidence of at least 0.70.

Repeated events on the same day cannot accelerate the proposal. The occupant can confirm, reject or correct it naturally, and both the decision and original wording are persisted. Only a confirmed habit can later produce an anticipatory suggestion, up to 30 minutes before its usual time.

A habit proposal or anticipation is not execution authority. Actual operations still pass through the selected integration's validation and user-confirmation boundary. Cerebrum emits no more than three proactive messages per hour.

AI Education contains standing policy written by the user. It is limited to 16,000 characters, stored in the Node-RED node configuration and applied with Deploy. The model can read it but cannot alter it. Durable facts and preferences requested in chat belong to learned chat memory; reminders, monitors and future commands belong to schedules.

Example AI Education:

```text
Call me Alex and answer in the same language I use.
Keep replies short unless I ask for technical details.
Notify my most recent chat when a cover, window, or door remains open for at least 120 minutes.
Do not notify me between 23:00 and 07:00 and do not repeat the same alert within six hours.
The office cover may remain open during the day: do not notify me about it.
When "living-room light" is ambiguous, ask which light I mean.
Never say that an actuator changed until a status object confirms it.
```

### KNX object access and safety

KNX operations exist only when a compatible KNX Ultimate package and a gateway are selected. The selected ETS catalog is the sole authority for KNX objects and DPTs.

The **ETS object access** editor lets the user filter the imported catalog, select objects and mark them read-only. Selected objects are readable. A selected object is writable only when it is not marked read-only. Unknown addresses, DPT mismatches, invalid values, excessive operation sets and every write to a read-only address are rejected locally before output 4.

For DPT 1.xxx writes, `true`/`false`, `1`/`0` and `on`/`off` are normalized to real booleans before validation.

#### Fresh reads

For an explicit current-state request, Cerebrum can issue exact `GroupValue_Read` messages for selected ETS objects, including read-only feedback objects. Output 4 carries `msg.destination`, `msg.dpt`, `msg.event = "GroupValue_Read"` and `msg.readstatus = true`. Reads do not require write confirmation and can never be converted into writes by the fallback normalizer.

#### Confirmed writes

When confirmation is enabled, Cerebrum first previews each validated address, DPT and payload. It emits no write until the same chat session confirms within five minutes. A new request replaces the older pending plan. Immediately before output, every command is validated again.

While confirmation is pending, output 3 exposes `msg.cerebrum.confirmationRequest`, including its status, session, expiry, command count and confirm/cancel actions. Chat adapters can use each action's label and callback data to build buttons.

#### Multi-step routines

A state-aware request such as “Good night” can use two isolated stages. The first stage may issue up to 20 exact reads. The second receives those fresh values and may prepare up to 12 writes, but cannot request another read cycle. The complete routine has one confirmation boundary. After confirmation, operations are revalidated and observed briefly for matching bus feedback. Lack of immediate feedback is reported as unverified, not as proof of actuator failure.

Recommended wiring for KNX control:

1. Install KNX Ultimate and select or create a gateway in the compatible-nodes section.
2. Import the ETS CSV into that gateway.
3. Select the allowed ETS objects and mark feedback/read-only addresses correctly.
4. Enable LLM assistance and KNX operations; keep confirmation enabled.
5. Connect output 3 to the chat sender.
6. Connect output 4 to a KNX Ultimate node in **Universal mode**.
7. Confirm operations from the same session and verify execution from a status group address.

A message on output 4 proves only that an operation passed Cerebrum's local validation and entered the flow. It does not prove that an actuator executed it.

### Camera adapters

Compatible camera packages register providers and cameras through the adapter registry. Cerebrum can retrieve a current snapshot, ask a vision-capable model what is visible, and create persistent notifications for supported motion, line-crossing, intrusion or loiter events. Chat presets can emit snapshots as native images with captions.

Camera watches are stored in `cerebrum-chat-context.knxctx` and restored after Node-RED restarts. Snapshot images are not written to event history. Only bounded metadata is archived. For a config-backed provider such as UniFi Protect, all camera operations are constrained to the explicitly selected controller.

### Home Assistant bridge

Use this round trip:

```text
Cerebrum Home Assistant → API (ha-api) → Cerebrum Home Assistant
```

Home Assistant event and state nodes can also feed the bridge input. The bridge normalizes state updates for Cerebrum and contains malformed messages or API errors. It does not make Home Assistant a required dependency of this package.

### TTS Ultimate announcements

Wire output 5 to one or more `ttsultimate` nodes from the optional `node-red-contrib-tts-ultimate` package. Normal Node-RED wiring controls destination and fan-out; Link nodes can cross flow tabs.

The model chooses whether to prepare an announcement from the current request, learned instructions and AI Education. Output 5 contains the exact spoken text in `msg.payload`, uses `msg.topic = "cerebrum_announcement"`, and sets `msg.cerebrum.type = "tts_announcement"` with source-node, session and reason metadata.

### Web workspace

Open the Web workspace from the Cerebrum node editor. It is bound to the deployed node that opened it and does not silently switch to another Cerebrum instance.

Main pages include:

- **Overview** — live summary, observed activity and system condition;
- **Areas** — inspect and maintain logical areas when a compatible catalog provides them;
- **Tests** and **Test Results** — build, run and review deterministic field tests;
- **Cerebrum → Conversation** — ask questions in natural language;
- **Cerebrum → Cerebrum Learning** — edit the native context or read its simplified view;
- **Cerebrum → Cerebrum Memory** — edit authoritative JSON or read the simplified view;
- **Flow Builder (BETA)** — generate a reviewable Node-RED flow from a description;
- **Settings → Import / Export** — back up or restore all Cerebrum files.

Flow Builder uses the nodes actually installed in the current Node-RED project. Generated ids, wiring and config-node references are validated and reconstructed server-side. Always review generated flows before deploying them.

### LLM providers

Cerebrum supports OpenAI-compatible Chat Completions endpoints, Anthropic, Ollama and Bionic LM Studio. Available editor fields include provider, endpoint, API key, model and optional reasoning effort. Model support for reasoning effort varies; if a provider rejects that preference, Cerebrum retries without it.

Legacy completion-only models are excluded when the model list is refreshed. If a provider rejects custom temperature or token-limit fields, Cerebrum retries after removing or replacing only the incompatible field.

#### Ollama quick setup

1. Select **Ollama**.
2. Use `http://localhost:11434/api/chat`, or `host.docker.internal` instead of `localhost` when Node-RED runs in Docker.
3. Refresh the model list. If none is installed, open the model library and install one such as `llama3.1`.
4. Ensure Ollama is running through its desktop application or `ollama serve`.

Cerebrum respects the maximum context reported by Ollama and bounds operational prompt components before the request.

#### Bionic LM Studio quick setup

1. Start the LM Studio API server from **Developer** or with `lms server start`.
2. Select **Bionic LM Studio**.
3. Use `http://localhost:1234/v1/chat/completions`, replacing `localhost` with `host.docker.internal` in Docker.
4. Refresh the model list. An API key is optional unless authentication is enabled in LM Studio.

Cerebrum preserves an already loaded model's active context and lets LM Studio JIT-load an inactive model with its saved defaults.

### Security and privacy

If a remote LLM is enabled, the bounded context required to answer a request can be sent to the configured endpoint. Use a trusted local provider when strict on-premises processing is required.

Integration events are data, not instructions. Runtime adapters, Web pages, camera metadata, ETS names and Node-RED messages cannot override AI Education, local validation, selected controllers, read-only protection or confirmation policy. Secrets, authorization headers, security codes and API keys must never be learned or added to prompt context.

Optional provider, hook, timer, storage, mapping and output failures are isolated. They should produce a controlled error or degraded feature, never terminate Node-RED.
