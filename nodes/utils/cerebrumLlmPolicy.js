'use strict'
const { AsyncLocalStorage } = require('async_hooks')
const MAX_INTERVAL_MINUTES = 7 * 24 * 60
const normalizeLlmIntervalMinutes = value => Math.max(1, Math.min(MAX_INTERVAL_MINUTES, Math.floor(Number(value) || 1440)))
const normalizeLlmPolicyState = value => {
  const source = value || {}
  const stamp = value => Number.isSafeInteger(value) && value > 0 && value <= 8640000000000000 - MAX_INTERVAL_MINUTES * 60000 ? value : 0
  return {
    lastAttemptAt: stamp(source.lastAttemptAt),
    lastContextAt: stamp(source.lastContextAt),
    lastSuccessAt: stamp(source.lastSuccessAt),
    error: String(source.error || '').slice(0, 500)
  }
}

// A permission belongs to one async task, never to all work on an open UI or
// concurrent chat. Expire it even for callbacks created inside a finished task.
function createCerebrumLlmPolicy ({ enabled, persist = () => {}, now = Date.now }) {
  const scope = new AsyncLocalStorage()
  let state = normalizeLlmPolicyState()
  const allowed = () => enabled() && scope.getStore()?.active === true
  const assertAllowed = () => {
    if (!allowed()) throw Object.assign(new Error('LLM calls are allowed only during a user chat, an explicit JavaScript assistant.run or an explicitly submitted household event.'), { code: 'CEREBRUM_LLM_POLICY' })
  }
  const run = async (reason, work) => {
    if (!['chat', 'javascript', 'household_event'].includes(reason)) throw new Error('Invalid LLM authorization')
    const token = { reason, active: true, toTs: now() }
    try { return await scope.run(token, work) } finally { token.active = false }
  }
  // Chat uses its requested range or the normal recent-history view. An old
  // background checkpoint must not turn a routine request into a house review.
  const range = () => null
  const markContext = () => {
    if (!allowed() || scope.getStore().reason !== 'chat') return
    state.lastContextAt = Math.max(state.lastContextAt, scope.getStore().toTs)
    persist({ ...state })
  }
  return {
    run,
    allowed,
    assertAllowed,
    range,
    markContext,
    // Kept for callers migrating old flows; periodic reasoning is retired.
    tick: async () => false,
    reason: () => allowed() ? scope.getStore().reason : '',
    restore: value => { state = normalizeLlmPolicyState(value) },
    snapshot: () => ({ ...state, mode: 'chat', intervalMinutes: 0, running: false, nextRunAt: '' })
  }
}
module.exports = { createCerebrumLlmPolicy, normalizeLlmIntervalMinutes, normalizeLlmPolicyState }
