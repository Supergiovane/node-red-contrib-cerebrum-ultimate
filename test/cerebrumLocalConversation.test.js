'use strict'
/* eslint-env mocha */
const assert = require('assert').strict
const { buildCerebrumLocalConversation, decodeCerebrumLocalResponse, estimateCerebrumLocalTokens, isCerebrumNativeToolsUnsupported, buildCerebrumLocalJsonFallback } = require('../nodes/utils/cerebrumLocalConversation')
const { fitCerebrumPrompt } = require('../nodes/utils/cerebrumContextBudget')
const { parseOpenAiCompatibleEventStream, parseOllamaEventStream, parseCerebrumConversationResponse, resolveCerebrumReasoningRequestFields } = require('../nodes/cerebrumUltimate').__test
const { classifyCerebrumResponseIssue } = require('../nodes/utils/cerebrumConversationResponse')

const protocol = extra => buildCerebrumLocalConversation({ identity: 'Cerebrum', language: 'it', enabled: { memoryActions: true, automationActions: true, commands: true }, retentionDays: 30, ...extra })
const call = (name, args) => ({ function: { name, arguments: args } })

describe('Cerebrum local conversation protocol', () => {
  it('advertises only available tools and removes mutation operations in read-only tasks', () => {
    const built = protocol({ safeReadOnly: true, enabled: { commands: true, memoryActions: true } })
    assert.deepEqual(built.nativeTools.map(tool => tool.function.name), ['commands', 'memoryActions'])
    assert.deepEqual(built.nativeTools[0].function.parameters.properties.actions.items.properties.event.enum, ['GroupValue_Read'])
    assert.deepEqual(built.nativeTools[1].function.parameters.properties.operation.enum, ['search', 'get'])
    assert.equal(protocol({ safeReadOnly: true, memoryFinalPass: true, enabled: { memoryActions: true } }).nativeTools.length, 0)
  })

  it('translates both providers into the existing validated envelope', () => {
    const { nativeTools } = protocol()
    for (const args of [{ operation: 'list' }, '{"operation":"list"}']) {
      const content = decodeCerebrumLocalResponse({ content: '', tool_calls: [call('automationActions', args)] }, nativeTools)
      assert.deepEqual(parseCerebrumConversationResponse(content).automationActions, [{ operation: 'list' }])
    }
    const content = decodeCerebrumLocalResponse({ tool_calls: [call('commands', { event: 'GroupValue_Read', destination: '1/2/3', dpt: '1.001', payload: null, routinePhase: 'inspect' })] }, nativeTools)
    assert.equal(parseCerebrumConversationResponse(content).routine.phase, 'inspect')
  })

  it('rejects malformed, unknown and mixed tool families as a whole', () => {
    const { nativeTools } = protocol()
    for (const calls of [[call('automationActions', '{')], [call('automationActions', 'null')], [call('automationActions', '[]')], [call('webActions', '{}')], [call('automationActions', '{"operation":"list"}'), call('commands', '{}')]]) {
      assert.throws(() => decodeCerebrumLocalResponse({ tool_calls: calls }, nativeTools))
    }
  })

  it('preserves batches and combinations of final effects for the existing validators', () => {
    const nativeTools = protocol({ enabled: { commands: true, speechActions: true } }).nativeTools
    const actions = ['1/2/3', '1/2/4'].map(destination => ({ event: 'GroupValue_Write', destination, dpt: '1.001', payload: true }))
    const decoded = parseCerebrumConversationResponse(decodeCerebrumLocalResponse({ tool_calls: [call('commands', { actions }), call('speechActions', { text: 'Richiesta inviata.' })] }, nativeTools))
    assert.deepEqual(decoded.commands, actions)
    assert.equal(decoded.speechActions.length, 1)
  })

  it('preserves a complete clarification even if the provider attaches native effects', () => {
    const content = '{"reply":"Quale stanza?","routine":{"phase":"clarify"}}'
    const decoded = decodeCerebrumLocalResponse({ content, tool_calls: [call('automationActions', { operation: 'create', name: 'bad.js' })] }, protocol().nativeTools)
    assert.deepEqual(parseCerebrumConversationResponse(decoded).automationActions, [])
    assert.equal(parseCerebrumConversationResponse(decoded).routine.phase, 'clarify')
  })

  it('falls back only for explicit unsupported-tool errors and retains the request', () => {
    assert(isCerebrumNativeToolsUnsupported(new Error('HTTP 400: This model does not support tools')))
    for (const message of ['HTTP 401: tools not allowed', 'HTTP 429: tools unsupported', 'HTTP 400: invalid arguments in tools', 'network error']) assert(!isCerebrumNativeToolsUnsupported(new Error(message)))
    const options = { systemPrompt: 'Rules', userContent: 'Current request', conversationTools: protocol().nativeTools }
    const fallback = buildCerebrumLocalJsonFallback(options)
    assert.equal(fallback.userContent, options.userContent)
    assert.equal(fallback.conversationTools, null)
    assert(fallback.systemPrompt.includes('TRANSPORT:'))
    assert(options.conversationTools.length)
  })

  it('keeps prose/code intact and never promotes private reasoning to the answer', () => {
    const { nativeTools } = protocol()
    const text = 'Esempio: `function () { return 1 }`.'
    assert.equal(parseCerebrumConversationResponse(decodeCerebrumLocalResponse({ content: text }, nativeTools)).reply, text)
    assert.equal(parseCerebrumConversationResponse(decodeCerebrumLocalResponse({ content: '{"temperature":20}' }, nativeTools)).reply, '{"temperature":20}')
    assert.equal(decodeCerebrumLocalResponse({ content: '', reasoning_content: '{"reply":"not final"}' }, nativeTools), '')
    assert.equal(decodeCerebrumLocalResponse({ content: '{"reply":' }, nativeTools), '{"reply":')
  })

  it('retains streamed tool arguments and fails closed for interrupted calls', () => {
    const stream = [
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'one', function: { name: 'automationActions', arguments: '{"opera' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'tion":"list"}' } }] }, finish_reason: 'tool_calls' }] }
    ].map(event => `data: ${JSON.stringify(event)}`).join('\n')
    const result = parseOpenAiCompatibleEventStream(stream)
    assert.equal(result.choices[0].message.tool_calls[0].function.arguments, '{"operation":"list"}')
    assert.equal(parseOpenAiCompatibleEventStream(stream.split('\n')[0]).choices[0].finish_reason, 'incomplete')
    const chunk = JSON.stringify({ message: { content: '', tool_calls: [call('automationActions', { operation: 'list' })] }, done: false })
    const ollama = parseOllamaEventStream(chunk + '\n' + JSON.stringify({ message: { content: '' }, done: true, done_reason: 'stop' }))
    assert.equal(ollama.message.tool_calls[0].function.arguments.operation, 'list')
    assert.equal(parseOllamaEventStream(chunk).done_reason, 'incomplete')
    assert.equal(classifyCerebrumResponseIssue({ content: '{"automationActions":[{}]}', finishReason: 'length' }), 'token_limit')
  })

  it('honors none for LM Studio without changing explicit cloud effort mappings', () => {
    assert.deepEqual(resolveCerebrumReasoningRequestFields({ provider: 'lmstudio', effort: 'none' }), { reasoning_effort: 'none' })
    assert.deepEqual(resolveCerebrumReasoningRequestFields({ provider: 'lmstudio', effort: 'high' }), { reasoning_effort: 'high' })
  })

  it('fits local prose with complete trusted input and complete UTF-8 catalog rows', () => {
    const request = 'TRUSTED REQUEST: Accendi la luce solo dopo conferma.'
    const input = {
      systemPrompt: protocol().systemPrompt,
      schema: protocol().nativeTools,
      userContent: 'old optional history '.repeat(4000),
      essentialUserContent: request,
      staticContext: '灯光💡 | 1/2/3 | read-only\n'.repeat(2000),
      contextTokens: 8192,
      maxTokens: 1200,
      estimateTokens: estimateCerebrumLocalTokens
    }
    const fit = fitCerebrumPrompt(input)
    assert.equal(fit.userContent, request)
    assert.equal(fit.systemPrompt, input.systemPrompt)
    assert(!fit.staticContext.includes('\ufffd'))
    assert(fit.inputTokens + fit.overhead + fit.maxTokens <= 8192)
    assert(estimateCerebrumLocalTokens('灯光💡') >= 10)
    assert.throws(() => fitCerebrumPrompt({ ...input, essentialUserContent: '灯光💡'.repeat(3000) }), /no request was sent/)
  })
})
