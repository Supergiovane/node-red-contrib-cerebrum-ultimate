'use strict'
/* eslint-env mocha */
const { expect } = require('chai')
const {
  normalizeOpenAiReasoningEffortForModel,
  postOpenAiCompatibleChatWithFallbacks,
  postOpenAiResponsesWithFallbacks
} = require('../nodes/cerebrumUltimate').__test

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
