# Local chat transport

LM Studio and Ollama use a compact conversation controller. Cloud providers retain their existing structured conversation protocol. Select the matching local provider in the Cerebrum node, including when the model runs on another machine on the LAN.

```text
Web / Telegram / authorized assistant task
  -> shared archive + selective working context
  -> local model: final text OR native function call
  -> existing argument / ETS / DPT / permission validators
  -> local tool result -> refreshed working context -> model
```

There is no preliminary LLM classifier. Simple conversation needs one inference. Tool steps continue while they acquire useful evidence, without a fixed local retrieval-pass limit. Repeated unchanged cycles, cancellation and unusable-response recovery still stop as before.

## What changed

- Final answers are ordinary text. Native tool calls are translated into the existing action envelope; models no longer need to emit all the empty action arrays or satisfy a monolithic conversation JSON grammar for a greeting. Household assessments still require an explicit boolean notification decision.
- Only currently available tools are advertised. JavaScript authoring documentation remains on demand through `automationActions` with `operation: "api"`.
- The local system prompt is shorter. Recent shared conversation, explicit saved instructions, current capabilities/state and household reports remain available. The full raw bus-analysis prompt is no longer built for every local conversation; retained history is queried when needed.
- Local token budgeting includes native tool definitions, text, generation space and a framing reserve. Its conservative estimate distinguishes ASCII prose, punctuation and non-ASCII bytes. It is **not** an exact tokenizer; provider overflow errors still cause bounded budget reduction and retry. Essential requests and trusted instructions are never silently cut to make a call fit. Very large requests/education or images can still exceed the model window.
- Local conversation with the **default** reasoning setting requests reasoning off (`reasoning_effort: "none"` in LM Studio, `think: false` in Ollama). Explicit effort selections are preserved. LM Studio `none` is no longer incorrectly converted to `low`. Other generation paths retain their configured behavior.
- Streaming parsers retain native tool calls and their arguments. Incomplete, malformed, unknown or mixed retrieval/effect calls are rejected before effects; command batches and existing combinations of final effects retain their runtime validation. Reasoning text is never promoted into a final answer or executable instruction.
- If the provider explicitly rejects tool support with HTTP 400/422, the node retries using a compact JSON protocol and remembers that incompatibility for the endpoint/model until restart. Authentication, rate-limit and network errors do not trigger that fallback. Providers may still reject or ignore particular reasoning preferences; existing compatibility handling remains in place.

Shared archives, camera source-owned retention, authorization, execution confirmation and local routine permissions are unchanged. No autonomous review, inferred habits or background model activity is introduced. No archive migration is required. Install the changed package and restart Node-RED to use the new backend.

## LAN validation on 2026-09-26

The opt-in harness was run against the user-specified `http://192.168.1.30:1234/v1/chat/completions`, with the already loaded `prism-ml/bonsai-27b` (MLX, 2-bit). The harness used temporary household storage, no real KNX gateway/cameras, no device outputs and no production routines. It did not change the server's loaded model or context configuration.

| Request | Previous path, 32K client budget | New path, 8K client budget |
| --- | --- | --- |
| Short Italian greeting | 48.6 s; two calls; empty-response failure | 16.4 s; one call; final greeting |
| List saved JavaScript routines | 37.4 s; two calls; empty-response failure | 6.3 s; native list call + final answer; correctly found no routines |
| Clarify a request to turn on a light every evening | 93.6 s; two calls; empty-response failure | 23.3 s; one call; asked for the light and time; no effects |

The previous path rejected even the greeting locally at 8K with `context budget exhausted`, without sending a request. The new path also completed an isolated 4K greeting smoke test. For the measured 8K greeting, request size fell from 22,355 to 9,393 bytes (58%); reported input tokens fell from 3,596 to 2,306 (36%). Default local reasoning reported zero reasoning tokens in the final native-tool run.

These are individual end-to-end observations, including inference/prefill, not a statistically controlled latency guarantee. Cache state, server load, model quantization and reply length affect timings. Intermediate experiments showed that merely asking this model for compact JSON could produce invented routine lists; the final benchmark checks that listing actually invokes the backend tool. Model answer quality still needs installation-specific validation. Ollama transport, streaming and error behavior were covered with mocked tests, not a live Ollama server. Live tests did not exercise device writes or production routine creation.

## Reproduce

Run explicitly from the repository against an **already loaded** model:

```sh
node scripts/benchmark-local-chat.js http://192.168.1.30:1234/v1/chat/completions prism-ml/bonsai-27b 8192
```

Each line reports the answer, elapsed time, request bytes, provider token usage, finish reason and tool names. The harness fails its smoke check if the reply is unusable or the routine-list question skips the real tool call. Optional `CEREBRUM_BENCH_QUESTION` selects a single question; `CEREBRUM_BENCH_CAPTURE` writes the last synthetic request to a chosen file. Benchmark HTTP calls are restricted to the supplied inference endpoint, and its automation runtime forbids create/update/pause/resume/delete.

Run `npm test`, `npm run lint` and `npm pack --dry-run` for regression, style, node loading, UI build and packaging checks. Local conversation tests exercise both provider response shapes, streamed calls, explicit effort selection, tool compatibility fallback, malformed/truncated outputs, clarification and prevention of repeated effects.

Provider references: [LM Studio OpenAI-compatible endpoints](https://lmstudio.ai/docs/developer/openai-compat), [LM Studio structured output](https://lmstudio.ai/docs/developer/openai-compat/structured-output), [Ollama tool calling](https://docs.ollama.com/capabilities/tool-calling).
