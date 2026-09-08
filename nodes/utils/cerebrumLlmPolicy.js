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
function createCerebrumLlmPolicy ({ mode = 'chat', intervalMinutes, enabled, persist = () => {}, now = Date.now }) {
  const scope = new AsyncLocalStorage()
  const intervalMs = normalizeLlmIntervalMinutes(intervalMinutes) * 60000
  let state = normalizeLlmPolicyState()
  let running = false
  let chats = 0
  const allowed = () => enabled() && scope.getStore()?.active === true
  const assertAllowed = () => {
    if (!allowed()) throw Object.assign(new Error('LLM calls are allowed only during a user chat, an explicit JavaScript assistant.run, or the configured periodic review.'), { code: 'CEREBRUM_LLM_POLICY' })
  }
  const run = async (reason, work) => {
    if (!['chat', 'javascript', 'interval'].includes(reason)) throw new Error('Invalid LLM authorization')
    if (reason === 'chat') chats++
    const token = { reason, active: true, toTs: now(), fromTs: state.lastContextAt || Math.max(0, now() - intervalMs) }
    try { return await scope.run(token, work) } finally { token.active = false; if (reason === 'chat') chats-- }
  }
  const save = () => persist({ ...state })
  const range = () => {
    const token = scope.getStore()
    if (!allowed() || token.reason === 'javascript') return null
    return { fromTs: token.fromTs, toTs: token.toTs, label: 'locally collected history since the previous context update (bounded selection; full archive remains queryable)', explicit: false }
  }
  const markContext = () => {
    if (!range()) return
    state.lastContextAt = Math.max(state.lastContextAt, scope.getStore().toTs)
    save()
  }
  const tick = async work => {
    if (mode !== 'interval' || !enabled() || running || chats > 0) return false
    const at = now()
    if (!state.lastAttemptAt) { state.lastAttemptAt = at; save(); return false }
    if (at - state.lastAttemptAt < intervalMs) return false
    running = true
    try {
      // Persist the claim before spending money; failures wait a full interval,
      // including after restart. Never catch up by replaying missed timer ticks.
      state.lastAttemptAt = at
      state.error = ''
      save()
      await run('interval', work)
      state.lastSuccessAt = at
    } catch (error) {
      state.error = String(error.message || error).slice(0, 500)
    } finally { running = false; save() }
    return true
  }
  return {
    run,
    allowed,
    assertAllowed,
    range,
    markContext,
    tick,
    reason: () => allowed() ? scope.getStore().reason : '',
    restore: value => { state = normalizeLlmPolicyState(value) },
    snapshot: () => ({ ...state, mode: mode === 'interval' ? 'interval' : 'chat', intervalMinutes: intervalMs / 60000, running, nextRunAt: mode === 'interval' && state.lastAttemptAt ? new Date(state.lastAttemptAt + intervalMs).toISOString() : '' })
  }
}
module.exports = { createCerebrumLlmPolicy, normalizeLlmIntervalMinutes, normalizeLlmPolicyState }
