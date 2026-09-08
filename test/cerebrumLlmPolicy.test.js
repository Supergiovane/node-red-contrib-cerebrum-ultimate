'use strict'
/* eslint-env mocha */
const assert = require('assert').strict
const { createCerebrumLlmPolicy, normalizeLlmIntervalMinutes } = require('../nodes/utils/cerebrumLlmPolicy')
const { parseCerebrumRuntimeState, createEmptyCerebrumRuntimeState } = require('../nodes/utils/cerebrumRuntimeState')

describe('LLM cost policy', () => {
  it('defaults to chat and prevents background work borrowing a concurrent chat permission', async () => {
    const policy = createCerebrumLlmPolicy({ enabled: () => true })
    assert.throws(policy.assertAllowed, /only during/)
    let release, delayed
    const chat = policy.run('chat', async () => {
      policy.assertAllowed()
      delayed = new Promise(resolve => { release = resolve }).then(() => policy.allowed())
    })
    assert.equal(policy.allowed(), false)
    await chat; release()
    assert.equal(await delayed, false)
    assert.equal(await policy.tick(() => assert.fail('Background call')), false)
    await policy.run('javascript', async () => { policy.assertAllowed(); assert.equal(policy.range(), null) })
    assert.throws(policy.assertAllowed, /only during/)
  })

  it('waits seven days, persists the claim, and makes no catch-up or immediate retry after restart/failure', async () => {
    let time = Date.parse('2026-09-08T08:00:00Z'); let saved; let calls = 0
    const week = 10080 * 60000
    const make = () => createCerebrumLlmPolicy({ mode: 'interval', intervalMinutes: 10080, enabled: () => true, now: () => time, persist: state => { saved = state } })
    let policy = make()
    await policy.tick(() => calls++)
    assert.equal(calls, 0)
    time += week - 1
    await policy.tick(() => calls++)
    assert.equal(calls, 0)
    policy = make(); policy.restore(saved)
    time++
    await policy.tick(() => { calls++; assert.equal(saved.lastAttemptAt, time); throw Error('Provider down') })
    assert.equal(calls, 1)
    policy = make(); policy.restore(saved)
    await policy.tick(() => calls++)
    assert.equal(calls, 1)
    time += week * 3
    await policy.tick(() => { calls++; policy.markContext() })
    await policy.tick(() => calls++)
    assert.equal(calls, 2)
    assert.equal(saved.lastSuccessAt, time)
    assert.equal(saved.lastContextAt, time)
    assert.equal(saved.error, '')
  })

  it('blocks all scopes when disabled and prevents overlapping periodic reviews', async () => {
    let enabled = false; let time = 100000
    const policy = createCerebrumLlmPolicy({ mode: 'interval', intervalMinutes: 1, enabled: () => enabled, now: () => time })
    await policy.run('chat', () => assert.throws(policy.assertAllowed, /only during/))
    await policy.tick(() => assert.fail('Disabled'))
    enabled = true
    await policy.tick(() => assert.fail('Initial tick'))
    time += 60000
    await policy.run('chat', async () => {
      assert.equal(await policy.tick(() => assert.fail('Review during chat')), false)
    })
    let release
    const work = policy.tick(() => new Promise(resolve => { release = resolve }))
    await policy.tick(() => assert.fail('Overlapping tick'))
    release(); await work
  })

  it('fails closed on checkpoint errors and preserves optional policy state in old/new backups', async () => {
    let calls = 0
    const policy = createCerebrumLlmPolicy({ mode: 'interval', intervalMinutes: 1, enabled: () => true, now: () => 200000, persist: () => { throw Error('Disk full') } })
    policy.restore({ lastAttemptAt: 1 })
    await assert.rejects(policy.tick(() => calls++), /Disk full/)
    assert.equal(calls, 0)
    const checkpoint = createEmptyCerebrumRuntimeState()
    delete checkpoint.llmPolicy
    assert.equal(parseCerebrumRuntimeState(JSON.stringify(checkpoint)).llmPolicy.lastAttemptAt, 0)
    checkpoint.llmPolicy = { lastAttemptAt: 12345, lastContextAt: 12346, lastSuccessAt: 12347, error: 'Failure' }
    assert.deepEqual(parseCerebrumRuntimeState(JSON.stringify(checkpoint)).llmPolicy, checkpoint.llmPolicy)
    assert.equal(normalizeLlmIntervalMinutes(99999), 10080)
    assert.equal(normalizeLlmIntervalMinutes(-10), 1)
  })
})
