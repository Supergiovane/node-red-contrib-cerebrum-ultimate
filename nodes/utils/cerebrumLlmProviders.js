'use strict'

// Request bodies for each chat provider. Prompt fitting, transport, retries and
// usage accounting stay with the caller; these builders only shape the payload.

const toBase64 = image => image.data.toString('base64')
const toDataUrl = image => `data:${image.mediaType};base64,${toBase64(image)}`

const buildCerebrumOllamaChatBody = ({ model, systemPrompt, staticContext, userContent, images = [], temperature, maxTokens, contextTokens = 0, reasoningFields = {}, tools = null, format = null }) => {
  const body = Object.assign({
    model,
    stream: true,
    messages: [
      { role: 'system', content: systemPrompt },
      ...(staticContext ? [{ role: 'user', content: staticContext }] : []),
      Object.assign(
        { role: 'user', content: userContent },
        images.length ? { images: images.map(toBase64) } : {}
      )
    ],
    options: Object.assign(
      { temperature, num_predict: maxTokens },
      contextTokens > 0 ? { num_ctx: Math.round(contextTokens) } : {}
    )
  }, reasoningFields)
  if (tools?.length) body.tools = tools
  else if (format) body.format = format
  return body
}

const buildCerebrumAnthropicMessagesBody = ({ model, systemPrompt, staticContext, userContent, images = [], maxTokens, reasoningFields = {}, structuredSchema = null }) => {
  const userBlocks = []
  if (staticContext) userBlocks.push({ type: 'text', text: staticContext, cache_control: { type: 'ephemeral' } })
  images.forEach(image => {
    userBlocks.push({
      type: 'image',
      source: { type: 'base64', media_type: image.mediaType, data: toBase64(image) }
    })
  })
  userBlocks.push({ type: 'text', text: userContent })
  const body = Object.assign({
    model,
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: userBlocks }]
  }, reasoningFields)
  if (systemPrompt) body.system = [{ type: 'text', text: systemPrompt }]
  if (structuredSchema) {
    body.output_config = Object.assign({}, body.output_config || {}, {
      format: { type: 'json_schema', schema: structuredSchema }
    })
  }
  return body
}

const buildCerebrumOpenAiResponsesBody = ({ model, systemPrompt, staticContext, userContent, images = [], maxTokens, temperature, reasoningEffort = 'default', explicitPromptCaching = false, promptCacheOptions = false, promptCacheKey, jsonSchema = null, structuredSchema = null }) => {
  const inputContent = []
  if (staticContext) {
    inputContent.push(Object.assign(
      { type: 'input_text', text: staticContext },
      explicitPromptCaching ? { prompt_cache_breakpoint: { mode: 'explicit' } } : {}
    ))
  }
  inputContent.push({ type: 'input_text', text: userContent })
  images.forEach(image => {
    inputContent.push({ type: 'input_image', image_url: toDataUrl(image), detail: 'low' })
  })
  const body = {
    model,
    instructions: systemPrompt,
    input: [{ role: 'user', content: inputContent }],
    max_output_tokens: maxTokens,
    store: false,
    truncation: 'disabled',
    prompt_cache_key: promptCacheKey
  }
  if (explicitPromptCaching && promptCacheOptions) body.prompt_cache_options = { mode: 'explicit', ttl: '30m' }
  if (Number.isFinite(Number(temperature))) body.temperature = Number(temperature)
  if (reasoningEffort !== 'default') body.reasoning = { effort: reasoningEffort }
  if (jsonSchema && jsonSchema.schema) {
    body.text = {
      format: {
        type: 'json_schema',
        name: String(jsonSchema.name || 'knx_ai_response'),
        strict: jsonSchema.strict !== false,
        schema: structuredSchema
      }
    }
  }
  return body
}

const buildCerebrumOpenAiCompatibleChatBody = ({ model, temperature, stream, systemPrompt, staticContext, userContent, images = [], reasoningFields = {}, tools = null }) => {
  const body = Object.assign({
    model,
    temperature,
    stream,
    messages: [
      { role: 'system', content: systemPrompt },
      ...(staticContext ? [{ role: 'user', content: staticContext }] : []),
      {
        role: 'user',
        content: images.length
          ? [
              { type: 'text', text: userContent },
              ...images.map(image => ({ type: 'image_url', image_url: { url: toDataUrl(image), detail: 'low' } }))
            ]
          : userContent
      }
    ]
  }, reasoningFields)
  if (tools?.length) body.tools = tools
  return body
}

const withCerebrumJsonSchemaResponseFormat = (body, jsonSchema, structuredSchema) => Object.assign({}, body, {
  response_format: {
    type: 'json_schema',
    json_schema: {
      name: String(jsonSchema.name || 'knx_ai_response'),
      strict: jsonSchema.strict !== false,
      schema: structuredSchema
    }
  }
})

module.exports = {
  buildCerebrumOllamaChatBody,
  buildCerebrumAnthropicMessagesBody,
  buildCerebrumOpenAiResponsesBody,
  buildCerebrumOpenAiCompatibleChatBody,
  withCerebrumJsonSchemaResponseFormat
}
