'use strict'
/* eslint-env mocha */
const { expect } = require('chai')
const { fitCerebrumPrompt, resolveCloudContextTokens, withCerebrumContextRetry } = require('../nodes/utils/cerebrumContextBudget')
const {
  normalizeOpenAiReasoningEffortForModel,
  resolveCerebrumOperationalContextLimit,
  postOpenAiCompatibleChatWithFallbacks,
  postOpenAiResponsesWithFallbacks
} = require('../nodes/cerebrumUltimate').__test

describe('Cerebrum context protection', () => {
  it('uses bounded cloud windows, snapshots and smaller configured limits', () => {
    expect(resolveCloudContextTokens({ model: 'gpt-6-astra-2026-09-05' })).to.equal(1050000)
    expect(resolveCloudContextTokens({ model: ' GPT-5.5-2026-04-23 ' })).to.equal(1050000)
    expect(resolveCloudContextTokens({ model: 'gpt-5.5-pro' })).to.equal(1050000)
    expect(resolveCloudContextTokens({ model: 'gpt-4o-mini', contextLength: 4096 })).to.equal(4096)
    expect(resolveCloudContextTokens({ model: 'gpt-4o-mini', contextLength: 9999999 })).to.equal(128000)
    for (const contextLength of [0, -1, Infinity, NaN]) {
      expect(resolveCloudContextTokens({ model: 'unknown', contextLength })).to.equal(8192)
    }
    for (const provider of ['openai', 'openai_compat', 'anthropic', 'ollama', 'lmstudio']) {
      expect(resolveCerebrumOperationalContextLimit({ provider, contextLength: 4096 }).tokens).to.equal(4096)
    }
    expect(resolveCerebrumOperationalContextLimit({ provider: 'openai_compat', model: 'gpt-6-astra' }).tokens).to.equal(1050000)
    expect(resolveCerebrumOperationalContextLimit({ provider: 'openai_compat', model: 'gpt-5.5', maxContextKb: 512 }).tokens).to.equal(512 * 1024)
    expect(resolveCerebrumOperationalContextLimit({ provider: 'openai_compat', model: 'gpt-5.5', maxContextKb: 2048 }).tokens).to.equal(1050000)
    expect(resolveCerebrumOperationalContextLimit({ provider: 'openai_compat', model: 'custom-model', maxContextKb: 64 }).tokens).to.equal(64 * 1024)
    expect(resolveCerebrumOperationalContextLimit({ provider: 'ollama', contextLength: 131072, maxContextKb: 64 }).tokens).to.equal(64 * 1024)
  })

  it('bounds large memory/catalogs without mutating input or losing trusted instructions', () => {
    for (const contextTokens of [8192, 32768, 128000, 1050000]) {
      const input = {
        contextTokens,
        maxTokens: 10000,
        systemPrompt: 'Never write to a read-only address.',
        staticContext: '灯光💡 | 1/2/3 | read-only\n'.repeat(100000),
        userContent: 'old memory '.repeat(200000),
        essentialUserContent: 'TRUSTED CURRENT USER REQUEST: Accendi la luce.',
        schema: { type: 'object', description: 'Output JSON' }
      }
      const original = { ...input }
      const fitted = fitCerebrumPrompt(input)
      expect(input).to.deep.equal(original)
      expect(fitted.systemPrompt).to.equal(input.systemPrompt)
      expect(fitted.userContent).to.equal(input.essentialUserContent)
      expect(fitted.staticContext).not.to.include('\ufffd')
      expect(fitted.inputBytes + fitted.overhead + fitted.maxTokens).to.be.at.most(contextTokens)
      expect(fitted.reduced).to.equal(true)
    }
  })

  it('keeps small prompts intact and includes schema and image reserves', () => {
    const result = fitCerebrumPrompt({ systemPrompt: 'Rules', staticContext: 'Memory', userContent: 'Hello', contextTokens: 32768, maxTokens: 1000, imageCount: 1, schema: { description: 'x'.repeat(1000) } })
    expect(result).to.include({ systemPrompt: 'Rules', staticContext: 'Memory', userContent: 'Hello', reduced: false, maxTokens: 1000 })
    expect(result.overhead).to.be.greaterThan(9192)
  })

  it('reduces only the catalog when the dynamic request and memory still fit', () => {
    const userContent = 'User preferences and the current request'
    const result = fitCerebrumPrompt({ contextTokens: 8192, maxTokens: 1000, userContent, staticContext: 'row\n'.repeat(10000), essentialUserContent: 'Current request only' })
    expect(result.userContent).to.equal(userContent)
    expect(result.staticContext).to.include('Context omitted')
    expect(result.inputBytes + result.overhead + result.maxTokens).to.be.at.most(8192)
  })

  it('fails closed for oversized essential requests, system prompts and schemas, including zero budgets', () => {
    for (const extra of [{ userContent: 'x'.repeat(9000) }, { systemPrompt: 'x'.repeat(9000) }, { schema: { description: 'x'.repeat(9000) } }, { contextTokens: 0 }, { imageCount: 1 }]) {
      expect(() => fitCerebrumPrompt({ contextTokens: 8192, maxTokens: 1000, ...extra })).to.throw('no request was sent')
    }
  })

  it('rebuilds requests after the reported HTTP 400 and remembers a smaller budget', async () => {
    const limits = []
    const learned = []
    const response = await withCerebrumContextRetry({
      contextTokens: 32768,
      onLimit: limit => learned.push(limit),
      request: async limit => {
        limits.push(limit)
        if (limits.length === 1) throw new Error('HTTP 400: Your input exceeds the context window of this model. Please adjust your input and try again.')
        return fitCerebrumPrompt({ contextTokens: limit, userContent: 'hello' })
      }
    })
    expect(limits).to.deep.equal([32768, 16384])
    expect(learned).to.deep.equal([16384])
    expect(response.inputBytes + response.overhead + response.maxTokens).to.be.at.most(16384)
  })

  it('limits retries and does not retry unrelated failures', async () => {
    for (const message of ['HTTP 401: invalid key', 'HTTP 429: rate limit', 'HTTP 429: input too large', 'HTTP 400: maximum context length is 4,096 tokens']) {
      let calls = 0
      try {
        await withCerebrumContextRetry({ contextTokens: 32768, request: async () => { calls++; throw new Error(message) } })
        throw new Error('Expected request failure')
      } catch (error) {
        expect(error.message).to.equal(message)
      }
      expect(calls).to.equal(message.includes('context') ? 3 : 1)
    }
  })
})

describe('Cerebrum GPT-6 Astra requests', () => {
  it('sends a compatible Responses request on the first attempt without mutating its input', async () => {
    for (const model of ['gpt-6-astra', 'gpt-6-astra-2026-09-05']) {
      for (const effort of ['none', 'minimal']) {
        const body = {
          model,
          temperature: 0.2,
          top_p: 0.9,
          top_logprobs: 2,
          reasoning: { effort, summary: 'auto' },
          include: ['message.output_text.logprobs', 'reasoning.encrypted_content'],
          input: 'Test',
          max_output_tokens: 1000,
          store: false,
          text: { format: { type: 'json_schema', name: 'test', schema: { type: 'object' } } }
        }
        const original = JSON.parse(JSON.stringify(body))
        let calls = 0
        const response = { output: [], status: 'completed' }
        const result = await postOpenAiResponsesWithFallbacks({
          body,
          post: async ({ body: sent }) => {
            calls++
            expect(sent).not.to.have.any.keys('temperature', 'top_p', 'top_logprobs')
            expect(sent.reasoning).to.deep.equal({ effort: 'low', summary: 'auto' })
            expect(sent.include).to.deep.equal(['reasoning.encrypted_content'])
            expect(sent.text).to.deep.equal(original.text)
            expect(sent).to.include({ model, max_output_tokens: 1000, store: false })
            return response
          }
        })
        expect(result).to.equal(response)
        expect(calls).to.equal(1)
        expect(body).to.deep.equal(original)
      }
    }
  })

  it('also handles Astra through a Chat Completions compatible endpoint', async () => {
    await postOpenAiCompatibleChatWithFallbacks({
      model: 'gpt-6-astra',
      body: { model: 'gpt-6-astra', messages: [], reasoning_effort: 'minimal', temperature: 0.2, top_p: 0.9, logprobs: true, top_logprobs: 2 },
      post: async ({ body }) => {
        expect(body).to.deep.equal({ model: 'gpt-6-astra', messages: [], reasoning_effort: 'low' })
        return { choices: [] }
      }
    })
  })

  it('preserves supported efforts and the default setting', async () => {
    for (const effort of ['low', 'medium', 'high', 'xhigh', 'max', 'default']) {
      expect(normalizeOpenAiReasoningEffortForModel('gpt-6-astra', effort)).to.equal(effort)
    }
    for (const effort of ['none', 'minimal']) expect(normalizeOpenAiReasoningEffortForModel('gpt-6-astra', effort)).to.equal('low')
    await postOpenAiResponsesWithFallbacks({
      body: { model: 'gpt-6-astra', input: 'Test' },
      post: async ({ body }) => {
        expect(body).not.to.have.property('reasoning')
        return {}
      }
    })
  })

  it('preserves other models and their existing reasoning mappings', async () => {
    for (const model of ['gpt-5.4', 'gpt-5.6-sol', 'gpt-6-other', 'local-astra']) {
      const body = { model, temperature: 0.2, top_p: 0.8, reasoning: { effort: 'none' } }
      await postOpenAiResponsesWithFallbacks({ body, post: async ({ body: sent }) => { expect(sent).to.deep.equal(body); return {} } })
      const chat = { model, temperature: 0.2, reasoning_effort: 'minimal' }
      await postOpenAiCompatibleChatWithFallbacks({ model, body: chat, post: async ({ body: sent }) => { expect(sent).to.deep.equal(chat); return {} } })
    }
    expect(normalizeOpenAiReasoningEffortForModel('gpt-5.4', 'minimal')).to.equal('none')
    expect(normalizeOpenAiReasoningEffortForModel('gpt-5.4', 'max')).to.equal('xhigh')
    expect(normalizeOpenAiReasoningEffortForModel('gpt-5.6-sol', 'max')).to.equal('max')
  })
})
