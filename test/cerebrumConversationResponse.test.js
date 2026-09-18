'use strict'
/* eslint-env mocha */

const assert = require('assert').strict
const { EventEmitter } = require('events')
const fs = require('fs')
const os = require('os')
const path = require('path')
const simpleGet = require('simple-get')
const { parseCerebrumConversationResponse } = require('../nodes/cerebrumUltimate').__test
const { classifyCerebrumResponseIssue, buildCerebrumResponseFailureText } = require('../nodes/utils/cerebrumConversationResponse')

const answer = extra => ({
  reply: '',
  language: 'it',
  routine: { active: false, name: '', phase: 'none' },
  commands: [],
  cameraActions: [],
  speechActions: [],
  memoryActions: [],
  catalogActions: [],
  webActions: [],
  scheduleActions: [],
  historyActions: [],
  codeActions: [],
  automationActions: [],
  ...extra
})

describe('Cerebrum conversation response parsing', () => {
  it('preserves complete JSON, fences, aliases and braces inside JavaScript strings', () => {
    const source = JSON.stringify(answer({ reply: 'Risposta', automationActions: [{ operation: 'create', code: 'return { text: "braces } [", escaped: "\\\\" };' }] }))
    for (const wrapped of [source, `\uFEFF ${source}`, `\`\`\`json\n${source}\n\`\`\``, `Risposta:\n${source}\nFine.`]) {
      const parsed = parseCerebrumConversationResponse(wrapped)
      assert.equal(parsed.reply, 'Risposta')
      assert.equal(parsed.automationActions.length, 1)
    }
    assert.equal(parseCerebrumConversationResponse('{"answer":"Va bene","locale":"it"}').reply, 'Va bene')
  })

  it('never recovers nested routines or commands from a truncated outer response', () => {
    const source = JSON.stringify(answer({ automationActions: [{ operation: 'create', name: 'test.js', code: 'return 12345' }] }))
    for (const truncated of [source.slice(0, source.indexOf('12345') + 2), source.slice(0, -1), '{"commands":[{"event":"GroupValue_Write","destination":"1/2/3","payload":true}']) {
      assert.throws(() => parseCerebrumConversationResponse(truncated), /Incomplete conversation JSON/)
      assert.throws(() => parseCerebrumConversationResponse(`\`\`\`json\n${truncated}\n\`\`\``), /Incomplete conversation JSON/)
    }
    assert.throws(() => parseCerebrumConversationResponse('[{"reply":"nested"}]'), /complete conversation JSON/)
    assert.throws(() => parseCerebrumConversationResponse('{"reply":"one"} {"reply":"two"}'), /Multiple/)
    assert.throws(() => parseCerebrumConversationResponse('{"reply":{}}'), /must be a string/)
  })

  it('reports provider stops even when their partial text happens to contain valid JSON', () => {
    for (const finishReason of ['length', 'max_tokens', 'max_output_tokens']) {
      assert.equal(classifyCerebrumResponseIssue({ content: '{"reply":"partial"}', finishReason }), 'token_limit')
    }
    assert.equal(classifyCerebrumResponseIssue({ content: 'Provider fallback', responseEmpty: true }), 'empty')
    assert.equal(classifyCerebrumResponseIssue({ content: 'Refused', responseRefused: true }), 'blocked')
    assert.equal(classifyCerebrumResponseIssue({ content: 'Valid', finishReason: 'stop' }), '')
  })

  it('localizes failure explanations without denying recorded operations', () => {
    for (const language of ['en', 'it', 'de', 'fr', 'es', 'zh']) {
      const text = buildCerebrumResponseFailureText({ issue: 'token_limit', language, recovered: true, effects: [{ operation: 'create', name: 'reminder.js' }] })
      assert(text.includes('reminder.js'))
      assert(!text.includes('no plan or action was executed'))
      assert(!text.includes('non è stata eseguita alcuna'))
    }
  })
})

describe('Cerebrum conversation response recovery', function () {
  this.timeout(15000)
  let node, userDir, requests, respond, originalConcat
  const noop = () => {}
  const ask = () => node.sidebarAsk('Mostra le informazioni sulla cucina')
  const wireResponse = (content, finishReason = 'stop') => ({ choices: [{ message: { content }, finish_reason: finishReason }] })

  beforeEach(() => {
    userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cerebrum-response-'))
    requests = []
    originalConcat = simpleGet.concat
    simpleGet.concat = (options, callback) => {
      try {
        const body = JSON.parse(options.body)
        requests.push(body)
        assert(requests.length <= 12, 'Response recovery must not loop indefinitely')
        const result = respond(body, requests.length)
        callback(null, { statusCode: 200, headers: {} }, Buffer.from(JSON.stringify(result)))
      } catch (error) { callback(error) }
    }
    let Constructor
    require('../nodes/cerebrumUltimate')({
      auth: { needsPermission: () => noop },
      httpAdmin: { get: noop, post: noop, use: noop },
      settings: { userDir },
      nodes: {
        getNode: noop,
        registerType: (type, value) => { if (type === 'cerebrumUltimate') Constructor = value },
        createNode: target => {
          const emitter = new EventEmitter()
          Object.assign(target, {
            id: 'response-test',
            type: 'cerebrumUltimate',
            credentials: { llmApiKey: 'test-only' },
            on: emitter.on.bind(emitter),
            emit: emitter.emit.bind(emitter),
            status: noop,
            warn: noop,
            error: noop,
            log: noop,
            send: outputs => {
              const request = outputs[5]
              if (request?.cerebrum?.direction === 'request') queueMicrotask(() => target.emit('input', { ...request, payload: [] }))
            }
          })
        }
      },
      util: { cloneMessage: value => structuredClone(value) }
    })
    node = new Constructor({ llmEnabled: true, llmProvider: 'openai_compat', llmBaseUrl: 'https://llm.invalid/v1/chat/completions', llmModel: 'test-model', llmMaxTokens: 1200, llmContextLength: 32768, llmAllowKnxCommands: false, webAccessEnabled: false })
  })

  afterEach(async () => {
    simpleGet.concat = originalConcat
    if (node) await new Promise(resolve => node.emit('close', resolve))
    if (userDir) fs.rmSync(userDir, { recursive: true, force: true })
    node = null
  })

  it('repairs an empty envelope in the same authorized chat', async () => {
    respond = (body, count) => wireResponse(JSON.stringify(count === 1 ? {} : answer({ reply: 'Ecco la risposta corretta.' })))
    const result = await ask()
    assert.equal(result.answer, 'Ecco la risposta corretta.')
    assert.equal(requests.length, 2)
    assert(requests[1].messages[0].content.includes('RESPONSE RECOVERY:'))
    assert.equal(result.metadata.responseRecoveryCount, 1)
    assert.equal(result.metadata.responseIssue, '')
  })

  it('repairs empty provider text instead of displaying the provider fallback as an answer', async () => {
    respond = (body, count) => wireResponse(count === 1 ? '' : JSON.stringify(answer({ reply: 'Risposta recuperata.' })))
    assert.equal((await ask()).answer, 'Risposta recuperata.')
    assert.equal(requests.length, 2)
  })

  it('discards truncated tool instructions and retains the configured generation limit', async () => {
    respond = (body, count) => wireResponse(count === 1
      ? JSON.stringify(answer({ memoryActions: [{ operation: 'remember', text: 'Must never be saved' }] })).slice(0, -1)
      : JSON.stringify(answer({ reply: 'Risposta completa.' })), count === 1 ? 'length' : 'stop')
    const result = await ask()
    assert.equal(result.answer, 'Risposta completa.')
    assert.equal(result.metadata.memoryActionCount, 0)
    assert.equal(requests.length, 2)
    assert.equal(requests[0].max_tokens, requests[1].max_tokens)
    assert(requests[1].messages[0].content.includes('(token_limit)'))
  })

  it('reports repeated empty responses as failures and stops recovery', async () => {
    respond = () => wireResponse(JSON.stringify(answer()))
    const result = await ask()
    assert.equal(requests.length, 2)
    assert(result.answer.includes('recupero automatico'))
    assert.equal(result.metadata.responseIssue, 'empty')
    const log = node.getCerebrumOperationsSnapshot()
    assert(log.items.some(item => item.operation === 'conversation' && item.status === 'failed'))
  })

  it('does not execute even complete JSON marked incomplete by the provider', async () => {
    respond = () => wireResponse(JSON.stringify(answer({ memoryActions: [{ operation: 'remember', text: 'This is still an incomplete response' }] })), 'length')
    const result = await ask()
    assert.equal(requests.length, 2)
    assert.equal(result.metadata.memoryActionCount, 0)
    assert.equal(result.metadata.responseIssue, 'token_limit')
    assert(result.answer.includes('limite di generazione'))
  })

  it('allows further useful tool passes after a repaired response', async () => {
    respond = (body, count) => wireResponse(JSON.stringify(count === 1 || count === 3
      ? answer()
      : count === 2
        ? answer({ automationActions: [{ operation: 'api' }] })
        : count === 4
          ? answer({ automationActions: [{ operation: 'list' }] })
          : answer({ reply: 'Ho verificato le routine disponibili.' })))
    const result = await ask()
    assert.equal(requests.length, 5)
    assert.equal(result.answer, 'Ho verificato le routine disponibili.')
    assert.equal(result.metadata.responseRecoveryCount, 2)
    assert(!requests[2].messages[0].content.includes('RESPONSE RECOVERY:'))
  })

  it('repairs malformed JSON without a token-limit status, while preserving ordinary prose', async () => {
    const source = JSON.stringify(answer({ automationActions: [{ operation: 'create', code: 'return 12345' }] }))
    respond = (body, count) => wireResponse(count === 1 ? source.slice(0, source.indexOf('12345')) : 'Posso spiegarti le informazioni disponibili.')
    const result = await ask()
    assert.equal(requests.length, 2)
    assert.equal(result.answer, 'Posso spiegarti le informazioni disponibili.')
    assert(requests[1].messages[0].content.includes('(invalid_json)'))
  })

  it('recovers when a model requests only an unavailable tool', async () => {
    respond = (body, count) => wireResponse(JSON.stringify(count === 1
      ? answer({ webActions: [{ operation: 'search', query: 'weather' }] })
      : answer({ reply: 'La ricerca Web è disabilitata.' })))
    const result = await ask()
    assert.equal(result.answer, 'La ricerca Web è disabilitata.')
    assert.equal(requests.length, 2)
    assert(requests[1].messages[0].content.includes('(unusable_tools)'))
  })

  it('acknowledges a successful memory-only action without another model call', async () => {
    respond = () => wireResponse(JSON.stringify(answer({ memoryActions: [{ operation: 'remember', text: 'Preferisco risposte in italiano.', reason: 'Richiesta esplicita' }] })))
    const result = await node.sidebarAsk('Ricorda che preferisco risposte in italiano quando parliamo della cucina')
    assert.equal(requests.length, 1)
    assert.equal(result.answer, 'Memoria aggiornata.')
    assert.equal(result.metadata.memoryActionCount, 1)
  })

  it('reports a saved routine if final response recovery fails, without repeating the save', async () => {
    let saves = 0
    node._automationRuntime.save = async ({ name }) => { saves++; return { name, revision: 'saved', status: 'active' } }
    const action = { operation: 'create', name: 'reminder.js', revision: '', code: 'module.exports = function () {}', offset: 0 }
    respond = (body, count) => wireResponse(JSON.stringify(count === 1 ? answer({ automationActions: [action] }) : answer()))
    const result = await node.sidebarAsk('Crea una routine di promemoria per la cucina alle sette')
    assert.equal(saves, 1)
    assert.equal(requests.length, 3)
    assert(result.answer.includes('Routine salvata: reminder.js'))
    assert(!result.answer.includes('non è stata eseguita'))
    assert.equal(result.metadata.responseIssue, 'empty')
    assert(requests[2].messages.some(message => message.content.includes('reminder.js')))
  })

  it('does not replay a completed automation operation returned by the recovery call', async () => {
    let saves = 0
    node._automationRuntime.save = async ({ name }) => { saves++; return { name, revision: 'saved', status: 'active' } }
    const action = { operation: 'create', name: 'reminder.js', revision: '', code: 'module.exports = function () {}', offset: 0 }
    respond = (body, count) => wireResponse(JSON.stringify(count === 2 ? answer() : answer({ automationActions: [{ ...action, code: count === 1 ? action.code : `${action.code}\n` }] })))
    const result = await node.sidebarAsk('Crea una routine di promemoria per la cucina alle sette')
    assert.equal(requests.length, 3)
    assert.equal(saves, 1)
    assert(result.answer.includes('Routine salvata: reminder.js'))
  })

  it('keeps clarification recovery free of tools', async () => {
    let saves = 0
    node._automationRuntime.save = async () => { saves++; throw new Error('Must not save') }
    respond = (body, count) => wireResponse(JSON.stringify(count === 1
      ? answer({ routine: { phase: 'clarify' } })
      : answer({ automationActions: [{ operation: 'create', name: 'not-authorized.js', code: 'irrelevant' }] })))
    const result = await ask()
    assert.equal(saves, 0)
    assert.equal(requests.length, 2)
    assert.equal(result.metadata.responseIssue, 'unusable_tools')
  })

  it('preserves a clarification boundary even when the provider reports a token limit', async () => {
    let saves = 0
    node._automationRuntime.save = async () => { saves++; throw new Error('Must not save') }
    respond = (body, count) => wireResponse(JSON.stringify(count === 1
      ? answer({ routine: { phase: 'clarify' } })
      : answer({ automationActions: [{ operation: 'create', name: 'not-authorized.js', code: 'irrelevant' }] })), count === 1 ? 'length' : 'stop')
    const result = await ask()
    assert.equal(saves, 0)
    assert.equal(requests.length, 2)
    assert.equal(result.metadata.responseIssue, 'unusable_tools')
  })

  it('does not retry provider refusals or continue after chat cancellation', async () => {
    respond = () => wireResponse('', 'content_filter')
    assert.equal((await ask()).metadata.responseIssue, 'blocked')
    assert.equal(requests.length, 1)
    requests.length = 0
    let requestStarted
    const started = new Promise(resolve => { requestStarted = resolve })
    respond = () => { node._interactiveChatRequests.clear(); requestStarted(); return wireResponse('{}') }
    const pending = ask()
    await started
    assert.equal(requests.length, 1)
    await new Promise(resolve => node.emit('close', resolve))
    node = null
    const result = await pending
    assert(!result.answer.includes('recupero automatico'))
  })
})
