'use strict'
/* eslint-env mocha */

const assert = require('assert').strict
const { EventEmitter } = require('events')
const { createCerebrumFunctionGenerator, registerCerebrumFunctionRoutes, validateFunctionSyntax } = require('../nodes/utils/cerebrumFunctionAssistant')
const { createCerebrumLlmPolicy } = require('../nodes/utils/cerebrumLlmPolicy')

const source = { func: 'return msg;', initialize: 'context.set("count", 0);', finalize: 'node.status({});', outputs: 1 }
const input = () => ({ prompt: 'Multiply the payload by two', functionNodeId: 'function1', current: { ...source, libs: [] }, example: '{"payload": 21}', language: 'it' })
const output = () => ({ ...source, func: 'msg.payload *= 2; return msg;', explanation: 'Moltiplica per due.' })
const reply = proposal => ({ content: JSON.stringify(proposal), provider: 'test', model: 'test-model' })

describe('Cerebrum Function authoring', () => {
  it('uses a scoped user request, preserves lifecycle code, archives full turns and returns an unexecuted proposal', async () => {
    const policy = createCerebrumLlmPolicy({ enabled: () => true })
    const records = []
    const proposal = { ...output(), initialize: 'throw Error("must never execute during authoring");' }
    const generate = createCerebrumFunctionGenerator({
      archive: (...args) => records.push(args),
      request: async options => {
        policy.assertAllowed()
        assert.equal(options.essentialUserContent, options.userContent)
        assert.equal(JSON.parse(options.userContent).current.finalize, source.finalize)
        assert.equal(options.staticContext, '')
        assert(options.systemPrompt.includes('cerebrum.knx.get(address)'))
        assert(options.systemPrompt.includes('No cerebrum write, run, execute, send'))
        return reply(proposal)
      }
    })
    const original = input()
    const result = await policy.run('chat', () => generate(original))
    assert.deepEqual(result.proposal, proposal)
    assert.deepEqual(original, input())
    assert.equal(policy.allowed(), false)
    assert.equal(records[0][0], 'conversation')
    assert.equal(records[0][1].current.func, source.func)
    assert.equal(records[1][1].text, JSON.stringify(proposal))
    assert.equal(records[1][2], 'function-editor:function1')
  })

  it('includes catalog data by default separately and never truncates the current source to fit context', async () => {
    let contexts = 0
    const generate = createCerebrumFunctionGenerator({
      archive: () => {},
      getContext: () => { contexts++; return '1/2/3 | 1.001 | read-only' },
      request: async options => {
        assert.equal(options.staticContext, '1/2/3 | 1.001 | read-only')
        assert(options.systemPrompt.includes('respect read-only'))
        assert.equal(JSON.parse(options.essentialUserContent).current.func, source.func)
        return reply(output())
      }
    })
    await generate(input())
    assert.equal(contexts, 1)
  })

  it('rejects malformed requests before calling the model', async () => {
    const generate = createCerebrumFunctionGenerator({ archive: () => {}, request: () => assert.fail('Invalid request reached the model') })
    for (const invalid of [null, { ...input(), prompt: '' }, { ...input(), example: '[]' }, { ...input(), example: '{' }, { ...input(), prompt: 'a'.repeat(16001) }, { ...input(), current: { ...source, outputs: 501 } }, { ...input(), current: { ...source, libs: [{}] } }]) {
      await assert.rejects(generate(invalid))
    }
  })

  it('preserves all raw model responses while rejecting missing sections, invalid syntax and truncation', async () => {
    const invalid = [reply({ func: 'return msg;', outputs: 1 }), reply({ ...output(), func: 'if (' }), reply({ ...output(), finalize: 'await foo();' }), reply({ ...output(), func: 'const node = {};' }), { content: 'not JSON' }, { ...reply(output()), finishReason: 'length' }]
    for (const response of invalid) {
      const archive = []
      const generate = createCerebrumFunctionGenerator({ request: async () => response, archive: (...record) => archive.push(record) })
      await assert.rejects(generate(input()))
      assert.equal(archive[1][1].text, response.content)
      assert.equal(archive[2][0], 'operation')
    }
    validateFunctionSyntax({ ...source, func: 'await new Promise(resolve => setTimeout(resolve, 1)); return msg;', initialize: 'return Promise.resolve();' })
  })

  it('stops duplicate requests and ignores cancelled results while archiving the completed response', async () => {
    let release
    let onRequest = () => {}
    let cancelled = false
    const archive = []
    const generate = createCerebrumFunctionGenerator({ archive: (...record) => archive.push(record), request: () => new Promise(resolve => { release = resolve; onRequest() }) })
    const pending = generate(input(), { isCancelled: () => cancelled })
    await assert.rejects(generate(input()), /already being generated/)
    cancelled = true
    release(reply(output()))
    await assert.rejects(pending, /cancelled/)
    assert.equal(archive[1][1].role, 'assistant')
    const requestStarted = new Promise(resolve => { onRequest = resolve })
    const next = generate(input())
    await requestStarted
    release(reply(output()))
    assert.equal((await next).ok, true)
  })

  it('accepts fenced JSON without rewriting JavaScript strings or comments', async () => {
    const proposal = { ...output(), func: 'msg.payload = "/*literal comment*/ ,}";\n// preserve this comment\nreturn msg;' }
    const generate = createCerebrumFunctionGenerator({ archive: () => {}, request: async () => ({ content: '```json\n' + JSON.stringify(proposal) + '\n```' }) })
    assert.deepEqual((await generate(input())).proposal, proposal)
    const malformed = createCerebrumFunctionGenerator({ archive: () => {}, request: async () => ({ content: JSON.stringify(proposal).slice(0, -1) + ',}' }) })
    await assert.rejects(malformed(input()), /valid Function proposal/)
  })

  it('does not spend a model call when archival storage or the runtime is unavailable', async () => {
    for (const options of [{ isClosing: () => true }, { archive: () => { throw Error('Disk full') } }]) {
      const generate = createCerebrumFunctionGenerator({ request: () => assert.fail('Unexpected model call'), archive: () => {}, ...options })
      await assert.rejects(generate(input()))
    }
  })

  it('protects the authoring endpoint with both editor and Cerebrum permissions and forwards cancellation', async () => {
    let route
    registerCerebrumFunctionRoutes({ auth: { needsPermission: permission => permission }, httpAdmin: { post: (...args) => { route = args } } }, id => id === 'brain' ? node : null)
    assert.deepEqual(route.slice(0, 3), ['/cerebrumUltimate/function/generate', 'flows.write', 'cerebrumUltimate.write'])
    const handler = route[3]
    const response = () => Object.assign(new EventEmitter(), {
      status (code) { this.code = code; return this },
      json (body) { this.body = body; this.writableEnded = true }
    })
    let res = response()
    await handler({ body: { ...input(), cerebrumNode: 'missing' } }, res)
    assert.equal(res.code, 404)
    const node = { type: 'cerebrumUltimate', llmEnabled: false, generateAiFunction: () => assert.fail() }
    res = response()
    await handler({ body: { ...input(), cerebrumNode: 'brain' } }, res)
    assert.equal(res.code, 409)
    node.llmEnabled = true
    let release
    node.generateAiFunction = (_, options) => new Promise(resolve => { release = () => { assert(options.isCancelled()); resolve({ ok: true }) } })
    res = response()
    const work = handler({ body: { ...input(), cerebrumNode: 'brain' } }, res)
    res.emit('close')
    release()
    await work
    assert.equal(res.body, undefined)
    assert.equal(res.listenerCount('close'), 0)
  })
})
