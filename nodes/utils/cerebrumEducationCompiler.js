'use strict'

// Reconcile a saved instruction revision once, independently of world-model
// situations. The local poll reads a hash; it does not call an LLM repeatedly.
function createCerebrumEducationCompiler ({ snapshot, runtime, enabled, compile, now = Date.now, intervalMs = 10000, waitingMessage = 'Enable the AI to generate functions from saved education.' }) {
  let closed = false
  let pending = null
  let rerun = false
  const status = () => runtime().compilationStatus()
  const check = ({ force = false } = {}) => {
    if (closed) return Promise.resolve()
    if (pending) { if (force) rerun = true; return pending }
    let education, previous
    try { education = snapshot(); previous = status() } catch (error) { return Promise.resolve() }
    if (!force && previous.revision === education.revision && ['ready', 'attention', 'error', 'empty'].includes(previous.status)) return Promise.resolve(previous)
    const saveStatus = (state, message = '') => runtime().setCompilationStatus({ revision: education.revision, status: state, message, updatedAt: new Date(now()).toISOString() })
    if (!education.content.trim()) return Promise.resolve(saveStatus('empty'))
    if (!enabled() && previous.revision === education.revision && previous.status === 'waiting') return Promise.resolve(previous)
    if (!enabled()) return Promise.resolve(saveStatus('waiting', waitingMessage))
    saveStatus('generating')
    const cancelled = () => closed || !enabled() || snapshot().revision !== education.revision
    pending = Promise.resolve().then(async () => {
      try {
        const result = await compile({ ...education, isCancelled: cancelled })
        if (cancelled()) { rerun = !closed; return }
        return saveStatus(result.ok ? 'ready' : 'attention', String(result.message || '').slice(0, 1500))
      } catch (error) {
        if (cancelled()) { rerun = !closed; return }
        return saveStatus('error', String(error.message || error).slice(0, 1500))
      }
    }).finally(() => {
      pending = null
      if (rerun && !closed) { rerun = false; check().catch(() => {}) }
    })
    return pending
  }
  const timer = intervalMs > 0 ? setInterval(() => { Promise.resolve().then(() => check()).catch(() => {}) }, intervalMs) : null
  timer?.unref()
  return { check, status, close: () => { closed = true; clearInterval(timer) } }
}

module.exports = { createCerebrumEducationCompiler }
