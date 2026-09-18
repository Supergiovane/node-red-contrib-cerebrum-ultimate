'use strict'
/* eslint-env mocha */
const assert = require('assert').strict
const { createCerebrumLlmPolicy, normalizeLlmIntervalMinutes } = require('../nodes/utils/cerebrumLlmPolicy')
const { parseCerebrumRuntimeState, createEmptyCerebrumRuntimeState } = require('../nodes/utils/cerebrumRuntimeState')

describe('LLM cost policy', () => {
  it('permits chat, explicit JavaScript and submitted household events without lending authority to concurrent or expired work', async () => {
    const policy = createCerebrumLlmPolicy({ enabled: () => true })
    assert.throws(policy.assertAllowed, /only during/)
    for (const reason of ['chat', 'javascript', 'household_event']) {
      let release, delayed
      const task = policy.run(reason, async () => {
        policy.assertAllowed()
        assert.equal(policy.reason(), reason)
        assert.equal(policy.range(), null)
        delayed = new Promise(resolve => { release = resolve }).then(() => policy.allowed())
      })
      assert.equal(policy.allowed(), false)
      await task; release()
      assert.equal(await delayed, false)
      assert.equal(policy.reason(), '')
    }
    assert.throws(policy.assertAllowed, /only during/)
  })

  it('does not authorize unsolicited integration events or periodic reviews', async () => {
    const policy = createCerebrumLlmPolicy({ enabled: () => true })
    for (const reason of ['event', 'state', 'observation', 'interval', 'review', '']) {
      await assert.rejects(policy.run(reason, () => assert.fail('No implicit event authority')), /Invalid LLM authorization/)
    }
    assert.equal(policy.allowed(), false)
  })

  it('retires interval authorization even with an overdue legacy checkpoint and after restart', async () => {
    let time = 200000
    const make = () => createCerebrumLlmPolicy({ mode: 'interval', intervalMinutes: 1, enabled: () => true, now: () => time })
    let policy = make()
    policy.restore({ lastAttemptAt: 1, lastContextAt: 2, lastSuccessAt: 3 })
    for (let week = 0; week < 3; week++) {
      time += 7 * 86400000
      assert.equal(await policy.tick(() => assert.fail('No background review')), false)
      await assert.rejects(policy.run('interval', () => assert.fail('No interval authority')), /Invalid LLM authorization/)
      const saved = policy.snapshot()
      assert.equal(saved.mode, 'chat')
      assert.equal(saved.nextRunAt, '')
      policy = make(); policy.restore(saved)
    }
    await policy.run('chat', () => assert.equal(policy.range(), null, 'Old context timestamps do not expand chat history'))
  })

  it('blocks model work when disabled and expires permissions even when the task fails', async () => {
    let enabled = false
    const policy = createCerebrumLlmPolicy({ enabled: () => enabled })
    for (const reason of ['chat', 'javascript', 'household_event']) await policy.run(reason, () => assert.throws(policy.assertAllowed, /only during/))
    enabled = true
    for (const reason of ['chat', 'javascript', 'household_event']) {
      await assert.rejects(policy.run(reason, () => { policy.assertAllowed(); throw Error('Provider failed') }), /Provider failed/)
      assert.equal(policy.allowed(), false)
    }
  })

  it('preserves legacy backup metadata without restarting old reviews', async () => {
    const checkpoint = createEmptyCerebrumRuntimeState()
    delete checkpoint.llmPolicy
    assert.equal(parseCerebrumRuntimeState(JSON.stringify(checkpoint)).llmPolicy.lastAttemptAt, 0)
    checkpoint.llmPolicy = { lastAttemptAt: 12345, lastContextAt: 12346, lastSuccessAt: 12347, error: 'Failure' }
    assert.deepEqual(parseCerebrumRuntimeState(JSON.stringify(checkpoint)).llmPolicy, checkpoint.llmPolicy)
    assert.equal(normalizeLlmIntervalMinutes(99999), 10080)
    assert.equal(normalizeLlmIntervalMinutes(-10), 1)
    let saved
    let time = 200000
    const policy = createCerebrumLlmPolicy({ enabled: () => true, now: () => time, persist: state => { saved = state } })
    policy.restore(checkpoint.llmPolicy)
    await policy.run('chat', () => policy.markContext())
    assert.equal(saved.lastContextAt, 200000)
    assert.equal(saved.lastAttemptAt, 12345)
    time = 300000
    await policy.run('household_event', () => policy.markContext())
    assert.equal(saved.lastContextAt, 200000, 'Household events do not advance the user-chat checkpoint')
  })
})
