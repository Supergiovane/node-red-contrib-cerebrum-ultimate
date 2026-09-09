'use strict'

const CEREBRUM_TRANSIENT_MESSAGE_ORIGINS_KEY = Symbol.for('node-red.cerebrum.transient-message-origins.v1')
const CEREBRUM_TRANSIENT_MESSAGE_ORIGIN_TTL_MS = 5 * 60 * 1000
const CEREBRUM_TRANSIENT_MESSAGE_ORIGIN_MAX_ENTRIES = 4096

const cleanText = (value, max = 200) => String(value === undefined || value === null ? '' : value)
  .trim()
  .slice(0, Math.max(0, Number(max) || 0))

const getCerebrumTransientMessageOriginStore = () => {
  const existing = globalThis[CEREBRUM_TRANSIENT_MESSAGE_ORIGINS_KEY]
  if (existing && existing.version === 1 && existing.entries instanceof Map) return existing
  const store = { version: 1, entries: new Map(), lastPrunedAt: 0 }
  globalThis[CEREBRUM_TRANSIENT_MESSAGE_ORIGINS_KEY] = store
  return store
}

const originKey = ({ messageId, source } = {}) => {
  const id = cleanText(messageId)
  const normalizedSource = cleanText(source, 120).toLowerCase()
  return id && normalizedSource ? `${normalizedSource}\u0000${id}` : ''
}

const pruneCerebrumTransientMessageOrigins = (store, now, { force = false } = {}) => {
  if (!force && store.entries.size < CEREBRUM_TRANSIENT_MESSAGE_ORIGIN_MAX_ENTRIES &&
    now - Number(store.lastPrunedAt || 0) < 60 * 1000) return
  store.entries.forEach((seenAt, key) => {
    if (now - Number(seenAt || 0) > CEREBRUM_TRANSIENT_MESSAGE_ORIGIN_TTL_MS) store.entries.delete(key)
  })
  store.lastPrunedAt = now
}

const rememberCerebrumTransientMessageOrigin = ({ messageId, source, at = Date.now() } = {}) => {
  const key = originKey({ messageId, source })
  if (!key) return false
  const now = Number.isFinite(Number(at)) ? Number(at) : Date.now()
  const store = getCerebrumTransientMessageOriginStore()
  pruneCerebrumTransientMessageOrigins(store, now)
  store.entries.delete(key)
  store.entries.set(key, now)
  while (store.entries.size > CEREBRUM_TRANSIENT_MESSAGE_ORIGIN_MAX_ENTRIES) {
    store.entries.delete(store.entries.keys().next().value)
  }
  return true
}

const hasCerebrumTransientMessageOrigin = ({ messageId, source, at = Date.now() } = {}) => {
  const key = originKey({ messageId, source })
  if (!key) return false
  const now = Number.isFinite(Number(at)) ? Number(at) : Date.now()
  const store = getCerebrumTransientMessageOriginStore()
  pruneCerebrumTransientMessageOrigins(store, now)
  const seenAt = Number(store.entries.get(key) || 0)
  if (!seenAt || now - seenAt > CEREBRUM_TRANSIENT_MESSAGE_ORIGIN_TTL_MS) {
    store.entries.delete(key)
    return false
  }
  return true
}

module.exports = {
  CEREBRUM_TRANSIENT_MESSAGE_ORIGINS_KEY,
  CEREBRUM_TRANSIENT_MESSAGE_ORIGIN_MAX_ENTRIES,
  CEREBRUM_TRANSIENT_MESSAGE_ORIGIN_TTL_MS,
  getCerebrumTransientMessageOriginStore,
  hasCerebrumTransientMessageOrigin,
  rememberCerebrumTransientMessageOrigin
}
