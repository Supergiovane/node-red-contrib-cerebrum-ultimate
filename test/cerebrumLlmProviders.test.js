'use strict'
/* eslint-env mocha */

const { expect } = require('chai')
const {
  buildCerebrumOllamaChatBody,
  buildCerebrumAnthropicMessagesBody,
  buildCerebrumOpenAiResponsesBody,
  buildCerebrumOpenAiCompatibleChatBody,
  withCerebrumJsonSchemaResponseFormat
} = require('../nodes/utils/cerebrumLlmProviders')

const image = { mediaType: 'image/jpeg', data: Buffer.from('jpg') }
const prompt = { systemPrompt: 'system', staticContext: 'static', userContent: 'question' }
const schema = { type: 'object', properties: {}, additionalProperties: false }

describe('Cerebrum LLM provider request bodies', () => {
  it('builds an Ollama chat with optional static context, images, window and reasoning', () => {
    const body = buildCerebrumOllamaChatBody({ ...prompt, model: 'llama3.1', images: [image], temperature: 0.2, maxTokens: 900, contextTokens: 8191.6, reasoningFields: { think: false }, format: schema })
    expect(body).to.deep.equal({
      model: 'llama3.1',
      stream: true,
      messages: [
        { role: 'system', content: 'system' },
        { role: 'user', content: 'static' },
        { role: 'user', content: 'question', images: ['anBn'] }
      ],
      options: { temperature: 0.2, num_predict: 900, num_ctx: 8192 },
      think: false,
      format: schema
    })
    const withTools = buildCerebrumOllamaChatBody({ ...prompt, staticContext: '', tools: [{ type: 'function' }], format: schema })
    expect(withTools.messages).to.have.length(2)
    expect(withTools.options).to.not.have.property('num_ctx')
    expect(withTools.tools).to.have.length(1)
    expect(withTools).to.not.have.property('format')
  })

  it('caches Anthropic static context and merges effort with structured output', () => {
    const body = buildCerebrumAnthropicMessagesBody({ ...prompt, model: 'claude-opus-5-5', images: [image], maxTokens: 4000, reasoningFields: { output_config: { effort: 'low' } }, structuredSchema: schema })
    expect(body.system).to.deep.equal([{ type: 'text', text: 'system' }])
    expect(body.messages[0].content).to.deep.equal([
      { type: 'text', text: 'static', cache_control: { type: 'ephemeral' } },
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'anBn' } },
      { type: 'text', text: 'question' }
    ])
    expect(body.output_config).to.deep.equal({ effort: 'low', format: { type: 'json_schema', schema } })
    const plain = buildCerebrumAnthropicMessagesBody({ ...prompt, systemPrompt: '', staticContext: '', model: 'm', maxTokens: 10 })
    expect(plain).to.deep.equal({ model: 'm', max_tokens: 10, messages: [{ role: 'user', content: [{ type: 'text', text: 'question' }] }] })
  })

  it('builds an OpenAI Responses request with caching, reasoning and strict schema', () => {
    const body = buildCerebrumOpenAiResponsesBody({
      ...prompt,
      model: 'gpt-5.4',
      images: [image],
      maxTokens: 2000,
      temperature: '0.3',
      reasoningEffort: 'low',
      explicitPromptCaching: true,
      promptCacheOptions: true,
      promptCacheKey: 'cerebrum-node',
      jsonSchema: { name: 'reply', schema, strict: false },
      structuredSchema: schema
    })
    expect(body.input[0].content).to.deep.equal([
      { type: 'input_text', text: 'static', prompt_cache_breakpoint: { mode: 'explicit' } },
      { type: 'input_text', text: 'question' },
      { type: 'input_image', image_url: 'data:image/jpeg;base64,anBn', detail: 'low' }
    ])
    expect(body).to.include({ instructions: 'system', max_output_tokens: 2000, store: false, truncation: 'disabled', prompt_cache_key: 'cerebrum-node', temperature: 0.3 })
    expect(body.prompt_cache_options).to.deep.equal({ mode: 'explicit', ttl: '30m' })
    expect(body.reasoning).to.deep.equal({ effort: 'low' })
    expect(body.text.format).to.deep.equal({ type: 'json_schema', name: 'reply', strict: false, schema })

    const minimal = buildCerebrumOpenAiResponsesBody({ ...prompt, staticContext: '', model: 'm', maxTokens: 1, explicitPromptCaching: false, promptCacheOptions: true })
    expect(minimal).to.not.have.any.keys('temperature', 'reasoning', 'text', 'prompt_cache_options')
    expect(buildCerebrumOpenAiResponsesBody({ ...prompt, model: 'm', maxTokens: 1, explicitPromptCaching: true, promptCacheOptions: false })).to.not.have.property('prompt_cache_options')
  })

  it('builds an OpenAI-compatible chat and adds the JSON schema response format without mutating it', () => {
    const body = buildCerebrumOpenAiCompatibleChatBody({ ...prompt, model: 'local', temperature: 0.2, stream: false, images: [image], reasoningFields: { reasoning_effort: 'none' }, tools: [{ type: 'function' }] })
    expect(body.messages[2].content).to.deep.equal([
      { type: 'text', text: 'question' },
      { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,anBn', detail: 'low' } }
    ])
    expect(body).to.include({ model: 'local', temperature: 0.2, stream: false, reasoning_effort: 'none' })
    expect(body.tools).to.have.length(1)

    const textOnly = buildCerebrumOpenAiCompatibleChatBody({ ...prompt, staticContext: '', model: 'local', stream: true })
    expect(textOnly.messages).to.deep.equal([{ role: 'system', content: 'system' }, { role: 'user', content: 'question' }])
    const withSchema = withCerebrumJsonSchemaResponseFormat(textOnly, { schema }, schema)
    expect(withSchema.response_format).to.deep.equal({ type: 'json_schema', json_schema: { name: 'knx_ai_response', strict: true, schema } })
    expect(textOnly).to.not.have.property('response_format')
  })
})
