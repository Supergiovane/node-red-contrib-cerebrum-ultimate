'use strict'
/* eslint-env mocha */
const assert = require('assert').strict
const { createCerebrumEducationCompiler } = require('../nodes/utils/cerebrumEducationCompiler')
const { runCerebrumAutomationAssistant } = require('../nodes/utils/cerebrumAutomationAssistant')

describe('AI Education compilation', () => {
  let compiler, state, education, enabled, calls, compile
  const make = () => createCerebrumEducationCompiler({
    snapshot: () => ({ ...education }),
    enabled: () => enabled,
    intervalMs: 0,
    runtime: () => ({ compilationStatus: () => state, setCompilationStatus: next => { state = next; return state } }),
    compile: async input => { calls++; return compile(input) }
  })
  beforeEach(() => {
    state = { status: 'pending', revision: '' }
    education = { content: 'Alle 08:40 annuncia via TTS il meteo.', revision: 'first' }
    enabled = true; calls = 0
    compile = async () => ({ ok: true, message: 'meteo.js created' })
    compiler = make()
  })
  afterEach(() => compiler.close())

  it('processes already saved instructions on startup, once per revision across restarts', async () => {
    await compiler.check()
    assert.equal(state.status, 'ready')
    for (let i = 0; i < 30; i++) await compiler.check()
    compiler.close(); compiler = make(); await compiler.check()
    assert.equal(calls, 1)
    education = { content: 'New instruction', revision: 'second' }
    await compiler.check()
    assert.equal(calls, 2)
  })

  it('waits for the AI and exposes failures without repeated paid retries', async () => {
    enabled = false; await compiler.check()
    assert.equal(calls, 0); assert.equal(state.status, 'waiting')
    enabled = true; compile = async () => { throw Error('Provider unavailable') }
    await compiler.check(); await compiler.check()
    assert.equal(calls, 1); assert.equal(state.status, 'error')
    assert.match(state.message, /Provider unavailable/)
    compile = async () => ({ ok: true })
    await compiler.check({ force: true })
    assert.equal(calls, 2); assert.equal(state.status, 'ready')
  })

  it('cancels an outdated compilation and processes the latest saved text', async () => {
    let release, first
    compile = async input => {
      if (input.revision === 'first') { first = input; await new Promise(resolve => { release = resolve }) }
      return { ok: true, message: input.content }
    }
    const work = compiler.check()
    await Promise.resolve()
    education = { revision: 'second', content: 'Alle 09:10' }
    compiler.check({ force: true })
    assert.equal(first.isCancelled(), true)
    release(); await work
    await compiler.check()
    assert.equal(state.revision, 'second')
    assert.equal(state.message, 'Alle 09:10')
  })

  it('reports missing information and closes without sending further model requests', async () => {
    compile = async () => ({ ok: false, message: 'Quale città?' })
    await compiler.check(); assert.equal(state.status, 'attention')
    assert.equal(state.message, 'Quale città?')
    compiler.close(); await compiler.check({ force: true })
    assert.equal(calls, 1)
  })
})

describe('Scheduled semantic automation work', () => {
  it('uses fresh research and verified sensor reads before TTS, without dispatching model writes', async () => {
    const order = []
    let pass = 0
    await runCerebrumAutomationAssistant({
      instruction: 'Read rain 2/3/0 and temperature 2/3/1; announce today’s forecast',
      isCancelled: () => false,
      reason: async request => {
        order.push('reason')
        if (pass++ === 0) return { webActions: [{ operation: 'search' }] }
        assert.equal(request.routineInspection.readResults[0].value, 18.5)
        return { commands: [{ event: 'GroupValue_Write' }], speechActions: [{ text: 'Diciotto virgola cinque gradi Celsius.' }] }
      },
      research: async () => {
        order.push('weather')
        return { response: { routine: { active: true }, commands: [{ event: 'GroupValue_Read', destination: '2/3/1' }, { event: 'GroupValue_Write' }], reasoningState: { progress: () => true } } }
      },
      read: async commands => { order.push('read'); assert.equal(commands.length, 1); return { sent: true, metadata: [{ value: 18.5 }] } },
      speak: async actions => { order.push('tts'); assert.match(actions[0].text, /gradi Celsius/) },
      notify: async () => assert.fail('Unexpected reply')
    })
    assert.deepEqual(order, ['reason', 'weather', 'read', 'reason', 'tts'])
  })

  it('suppresses an announcement if the function is paused during model work', async () => {
    let cancelled = false
    await assert.rejects(runCerebrumAutomationAssistant({
      instruction: 'Weather TTS',
      isCancelled: () => cancelled,
      reason: async () => { cancelled = true; return { speechActions: [{ text: 'Old announcement' }] } },
      speak: async () => assert.fail('Stale speech'),
      notify: async () => assert.fail('Stale reply')
    }), /cancelled/)
  })

  it('dispatches one evidence-bound camera snapshot without sending a duplicate text reply', async () => {
    const calls = []
    await runCerebrumAutomationAssistant({
      instruction: 'Mostra lo snapshot dell’ultimo movimento della Tettoia Est',
      isCancelled: () => false,
      reason: async () => ({
        content: 'Ultimo movimento della Tettoia Est.',
        language: 'it',
        cameraActions: [{
          type: 'event_snapshot',
          providerId: 'unifi-ultimate:protect',
          cameraId: 'protect:tettoia-est',
          cameraName: 'Tettoia Est',
          eventId: 'event-42',
          historicalEvidenceVerified: true
        }]
      }),
      camera: async request => { calls.push(request) },
      speak: async () => assert.fail('Unexpected speech'),
      notify: async () => assert.fail('Unexpected duplicate reply')
    })
    assert.equal(calls.length, 1)
    assert.equal(calls[0].reply, 'Ultimo movimento della Tettoia Est.')
    assert.equal(calls[0].actions[0].eventId, 'event-42')
  })

  it('rejects persistent camera-watch actions from scheduled model work', async () => {
    await assert.rejects(runCerebrumAutomationAssistant({
      instruction: 'Create a watch',
      isCancelled: () => false,
      reason: async () => ({ cameraActions: [{ type: 'watch', cameraName: 'Tettoia Est' }] }),
      camera: async () => assert.fail('Unexpected camera dispatch'),
      speak: async () => assert.fail('Unexpected speech'),
      notify: async () => assert.fail('Unexpected reply')
    }), /cannot create or change camera watches/)
  })
})
