'use strict'
const { normalizeLlmPolicyState } = require('./cerebrumLlmPolicy')

const CEREBRUM_RUNTIME_STATE_MAX_BYTES = 512 * 1024
const HOUR_MS = 60 * 60 * 1000
const MONTH_MS = 30 * 24 * HOUR_MS
const MAX_DATE_MS = 8640000000000000
const HASH_RE = /^[a-f0-9]{64}$/i
// Control characters must never be accepted inside persisted identifiers.
const CONTROL_CHARACTER_RE = /[\u0000-\u001f\u007f]/ // eslint-disable-line no-control-regex
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const isTimestamp = value => Number.isSafeInteger(value) && value >= 0 && value <= MAX_DATE_MS
const isIdentifier = (value, maxBytes) => typeof value === 'string' && value.length > 0 && value === value.trim() && !CONTROL_CHARACTER_RE.test(value) && Buffer.byteLength(value, 'utf8') <= maxBytes
const isValue = value => value === null || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value)) || (typeof value === 'string' && Buffer.byteLength(value, 'utf8') <= 160)
const positiveLimit = value => Number.isSafeInteger(value) && value > 0
const boundedText = (value, maxBytes) => {
  if (typeof value !== 'string') return ''
  let text = value.slice(0, maxBytes)
  while (Buffer.byteLength(text, 'utf8') > maxBytes) text = text.slice(0, -1)
  return text
}
const validNow = value => isTimestamp(value) && value > 0 ? value : Date.now()
const entries = value => value instanceof Map ? Array.from(value.entries()) : Array.isArray(value) ? value : []
const timestamp = value => isTimestamp(value) ? value : 0

const createEmptyCerebrumRuntimeState = ({ now = Date.now() } = {}) => ({
  version: 1,
  updatedAt: new Date(validNow(now)).toISOString(),
  webRequestTimestamps: [],
  webAccessLastSuccessAt: 0,
  webAccessLastError: '',
  cameraWatchLastTriggered: [],
  learnedContextLimits: [],
  llmPolicy: normalizeLlmPolicyState(),
  proactiveStates: []
})

const normalizeCerebrumRuntimeState = (value, { now = Date.now() } = {}) => {
  const currentTime = validNow(now)
  const source = isRecord(value) ? value : {}
  const target = createEmptyCerebrumRuntimeState({ now: currentTime })
  target.llmPolicy = normalizeLlmPolicyState(source.llmPolicy)
  const updatedAt = typeof source.updatedAt === 'string' ? Date.parse(source.updatedAt) : NaN
  if (Number.isFinite(updatedAt)) target.updatedAt = new Date(updatedAt).toISOString()
  target.webRequestTimestamps = (Array.isArray(source.webRequestTimestamps) ? source.webRequestTimestamps : [])
    .filter(at => isTimestamp(at) && at > currentTime - HOUR_MS && at <= currentTime)
    .sort((left, right) => left - right)
    .slice(-500)
  target.webAccessLastSuccessAt = timestamp(source.webAccessLastSuccessAt)
  target.webAccessLastError = boundedText(source.webAccessLastError, 500)

  const cameraTriggers = new Map()
  entries(source.cameraWatchLastTriggered).forEach(entry => {
    if (!Array.isArray(entry) || entry.length !== 2) return
    const [id, at] = entry
    if (!isIdentifier(id, 160) || !isTimestamp(at) || at <= currentTime - MONTH_MS || at > currentTime) return
    cameraTriggers.set(id, Math.max(cameraTriggers.get(id) || 0, at))
  })
  target.cameraWatchLastTriggered = Array.from(cameraTriggers.entries())
    .sort((left, right) => left[1] - right[1])
    .slice(-1000)

  const contextLimits = new Map()
  entries(source.learnedContextLimits).forEach(entry => {
    if (!Array.isArray(entry) || entry.length !== 2) return
    const [key, limit] = entry
    if (typeof key !== 'string' || !HASH_RE.test(key) || !positiveLimit(limit)) return
    const normalizedKey = key.toLowerCase()
    contextLimits.delete(normalizedKey)
    contextLimits.set(normalizedKey, limit)
  })
  target.learnedContextLimits = Array.from(contextLimits.entries()).slice(-64)

  const proactiveStates = new Map()
  const states = source.proactiveStates instanceof Map
    ? Array.from(source.proactiveStates.values())
    : Array.isArray(source.proactiveStates) ? source.proactiveStates : []
  states.forEach(state => {
    if (!isRecord(state) || !isIdentifier(state.ga, 32) || typeof state.open !== 'boolean') return
    const previous = proactiveStates.get(state.ga)
    const lastSeenAt = timestamp(state.lastSeenAt)
    if (previous && previous.lastSeenAt > lastSeenAt) return
    proactiveStates.set(state.ga, {
      ga: state.ga,
      open: state.open,
      openedAt: state.open ? timestamp(state.openedAt) : 0,
      lastSeenAt,
      lastSentAt: timestamp(state.lastSentAt),
      // Infinity means no further checks until a new state transition. JSON
      // cannot represent Infinity; this finite sentinel preserves comparison.
      nextCheckAt: state.nextCheckAt === Number.POSITIVE_INFINITY || state.nextCheckAt === Number.MAX_SAFE_INTEGER
        ? Number.MAX_SAFE_INTEGER
        : timestamp(state.nextCheckAt),
      value: typeof state.value === 'string' ? boundedText(state.value, 160) : isValue(state.value) ? state.value : null,
      confidence: Number.isFinite(state.confidence) ? Math.max(0, Math.min(1, state.confidence)) : 0
    })
  })
  target.proactiveStates = Array.from(proactiveStates.values())
    .sort((left, right) => left.lastSeenAt - right.lastSeenAt)
    .slice(-600)

  // Include pretty-print overhead so the caller can use the same atomic JSON
  // writer as other memory files without producing an unreadable checkpoint.
  while (Buffer.byteLength(`${JSON.stringify(target, null, 2)}\n`, 'utf8') > CEREBRUM_RUNTIME_STATE_MAX_BYTES) {
    if (target.proactiveStates.length) target.proactiveStates.shift()
    else if (target.cameraWatchLastTriggered.length) target.cameraWatchLastTriggered.shift()
    else break
  }
  return target
}

const parseCerebrumRuntimeState = (content, options = {}) => {
  if (typeof content !== 'string' || Buffer.byteLength(content, 'utf8') > CEREBRUM_RUNTIME_STATE_MAX_BYTES) {
    throw new Error('Cerebrum runtime state must be a JSON file of at most 512 KiB')
  }
  let source
  try { source = JSON.parse(content) } catch (error) { throw new Error(`Invalid Cerebrum runtime state JSON: ${error.message}`) }
  const fail = field => { throw new Error(`Invalid Cerebrum runtime state: ${field}`) }
  if (!isRecord(source) || source.version !== 1) fail('expected version 1')
  if (typeof source.updatedAt !== 'string' || !Number.isFinite(Date.parse(source.updatedAt))) fail('updatedAt')
  if (!Array.isArray(source.webRequestTimestamps) || !source.webRequestTimestamps.every(isTimestamp)) fail('webRequestTimestamps')
  if (!isTimestamp(source.webAccessLastSuccessAt)) fail('webAccessLastSuccessAt')
  if (typeof source.webAccessLastError !== 'string' || Buffer.byteLength(source.webAccessLastError, 'utf8') > 500) fail('webAccessLastError')
  if (!Array.isArray(source.cameraWatchLastTriggered) || !source.cameraWatchLastTriggered.every(entry => Array.isArray(entry) && entry.length === 2 && isIdentifier(entry[0], 160) && isTimestamp(entry[1]))) fail('cameraWatchLastTriggered')
  if (!Array.isArray(source.learnedContextLimits) || !source.learnedContextLimits.every(entry => Array.isArray(entry) && entry.length === 2 && typeof entry[0] === 'string' && HASH_RE.test(entry[0]) && positiveLimit(entry[1]))) fail('learnedContextLimits')
  if (!Array.isArray(source.proactiveStates)) fail('proactiveStates')
  source.proactiveStates.forEach(state => {
    if (!isRecord(state) || !isIdentifier(state.ga, 32) || typeof state.open !== 'boolean') fail('proactiveStates identity')
    if (![state.openedAt, state.lastSeenAt, state.lastSentAt].every(isTimestamp)) fail('proactiveStates timestamps')
    if (!isTimestamp(state.nextCheckAt) && state.nextCheckAt !== Number.MAX_SAFE_INTEGER) fail('proactiveStates nextCheckAt')
    if (!isValue(state.value)) fail('proactiveStates value')
    if (typeof state.confidence !== 'number' || !Number.isFinite(state.confidence) || state.confidence < 0 || state.confidence > 1) fail('proactiveStates confidence')
  })
  return normalizeCerebrumRuntimeState(source, options)
}

module.exports = {
  CEREBRUM_RUNTIME_STATE_MAX_BYTES,
  createEmptyCerebrumRuntimeState,
  normalizeCerebrumRuntimeState,
  parseCerebrumRuntimeState
}
