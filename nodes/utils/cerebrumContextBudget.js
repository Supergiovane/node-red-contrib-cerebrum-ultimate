'use strict'

const positiveInteger = value => Number.isFinite(Number(value)) && Number(value) > 0 ? Math.floor(Number(value)) : 0

const resolveCloudContextTokens = ({ model, contextLength } = {}) => {
  // Official model pages, checked 2026-09-07. Match aliases and dated snapshots
  // exactly; unknown compatible endpoints must not inherit a guessed large limit.
  const id = String(model || '').trim().toLowerCase().replace(/-\d{4}-\d{2}-\d{2}$/, '')
  const known = {
    'gpt-6-astra': 1050000,
    'gpt-5.6-sol': 1050000,
    'gpt-5.6-terra': 1050000,
    'gpt-5.5': 1050000,
    'gpt-5.5-pro': 1050000,
    'gpt-5.4': 1050000,
    'gpt-4o': 128000,
    'gpt-4o-mini': 128000
  }[id] || 0
  const configured = positiveInteger(contextLength)
  return known && configured ? Math.min(known, configured) : configured || known || 8192
}

const bytes = value => Buffer.byteLength(String(value || ''), 'utf8')
const prefix = (text, limit) => {
  // Decode only complete UTF-8 characters; never introduce a replacement character.
  const buffer = Buffer.from(text, 'utf8')
  let end = Math.min(buffer.length, Math.max(0, limit))
  while (end > 0 && end < buffer.length && (buffer[end] & 0xc0) === 0x80) end--
  return buffer.subarray(0, end).toString('utf8')
}

const fitCerebrumPrompt = ({ systemPrompt = '', staticContext = '', userContent = '', essentialUserContent = null, contextTokens, maxTokens, schema, imageCount = 0, estimateTokens = bytes, framingTokens = 1024 } = {}) => {
  systemPrompt = String(systemPrompt)
  staticContext = String(staticContext)
  userContent = String(userContent)
  const window = positiveInteger(contextTokens)
  // Default to a byte/token reserve. Local callers use a cautious text estimate
  // and provider overflow feedback; neither estimate is an exact tokenizer.
  const overhead = Math.max(256, positiveInteger(framingTokens), Math.ceil(window * 0.05)) + estimateTokens(schema ? JSON.stringify(schema) : '') + Math.max(0, imageCount) * 8192
  const essential = essentialUserContent === null ? userContent : String(essentialUserContent)
  const minimumInput = estimateTokens(systemPrompt) + estimateTokens(essential) + 4
  const availableOutput = window - overhead - minimumInput
  if (availableOutput < 256) {
    throw new Error(`Cerebrum context budget exhausted (${window} tokens): system instructions, current request, schema and image reserve do not fit. Shorten the request or configure the model's actual context limit; no request was sent.`)
  }
  const output = Math.min(positiveInteger(maxTokens) || 10000, availableOutput, Math.max(256, Math.floor(window * 0.25)))
  const budget = window - overhead - output
  const inputSize = () => estimateTokens(systemPrompt) + estimateTokens(staticContext) + estimateTokens(userContent) + 4
  const originalSize = inputSize()
  let reduced = output !== maxTokens
  if (originalSize > budget) {
    // Keep the entire system prompt and trusted request. Optional memory/history
    // can be replaced only when the caller supplies an explicit essential block.
    if (estimateTokens(systemPrompt) + estimateTokens(userContent) + 4 > budget) userContent = essential
    const remaining = budget - estimateTokens(systemPrompt) - estimateTokens(userContent) - 4
    const marker = '\n[Context omitted to fit the model window; do not infer missing records.]'
    if (estimateTokens(staticContext) > remaining) {
      // Catalogs are line-oriented: discard the last partial record as well.
      let low = 0
      let high = bytes(staticContext)
      const allowance = Math.max(0, remaining - estimateTokens(marker))
      while (low < high) {
        const mid = Math.ceil((low + high) / 2)
        if (estimateTokens(prefix(staticContext, mid)) <= allowance) low = mid
        else high = mid - 1
      }
      const head = prefix(staticContext, low)
      staticContext = remaining >= estimateTokens(marker) ? head.slice(0, Math.max(0, head.lastIndexOf('\n'))) + marker : ''
    }
    reduced = true
  }
  const inputBytes = bytes(systemPrompt) + bytes(staticContext) + bytes(userContent) + 4
  const inputTokens = inputSize()
  if (inputTokens > budget) throw new Error('Cerebrum context budget exhausted; no request was sent.')
  return { systemPrompt, staticContext, userContent, maxTokens: output, inputBytes, inputTokens, overhead, reduced }
}

const withCerebrumContextRetry = async ({ contextTokens, request, onLimit }) => {
  let limit = contextTokens
  for (let attempt = 0; ; attempt++) {
    try {
      return await request(limit)
    } catch (error) {
      const message = String((error && error.message) || '')
      const status = Number(error && (error.status || error.statusCode)) || Number((message.match(/HTTP\s+(\d{3})/) || [])[1])
      if (status && ![400, 413, 422].includes(status)) throw error
      const overflow = /context_length_exceeded|input exceeds the context window|maximum context length|prompt is too long|exceeds? (?:the )?(?:available )?context (?:size|window)|input.*too (?:long|large)|context (?:length|size).*(?:exceeded|exceed)|trying to keep.*tokens.*context|larger than.*context/i.test(message)
      if (!overflow || attempt >= 2) throw error
      // Remember a lower budget per endpoint/model, including errors without
      // numeric limits. Never retry authentication, rate-limit or network errors.
      const reported = message.match(/maximum context length (?:is|of)\s*([\d,]+)/i)
      const reportedLimit = reported ? positiveInteger(reported[1].replace(/,/g, '')) : 0
      limit = Math.floor(Math.min(limit / 2, reportedLimit || limit))
      if (onLimit) onLimit(limit)
    }
  }
}

module.exports = { fitCerebrumPrompt, resolveCloudContextTokens, withCerebrumContextRetry }
