'use strict'

const crypto = require('crypto')

const CEREBRUM_OPERATIONS_RETENTION_DAYS = 3
const CEREBRUM_OPERATIONS_DEFAULT_LIMIT = 1200
const CEREBRUM_OPERATIONS_MAX_LIMIT = 5000
const CEREBRUM_OPERATION_DETAILS_MAX_CHARS = 12000
const CEREBRUM_OPERATION_CATEGORIES = new Set(['llm', 'tool', 'autonomous', 'knx', 'system'])

const clampText = (value, maxChars = 500) => String(value === undefined || value === null ? '' : value)
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, Math.max(0, Number(maxChars) || 0))

const isSecretKey = key => /(api[-_]?key|access[-_]?token|authorization|credential|cookie|password|private[-_]?key|refresh[-_]?token|secret)/i.test(String(key || ''))

const sanitizeCerebrumOperationValue = (value, depth = 0, seen = new Set()) => {
  if (value === null || value === undefined) return value
  if (typeof value === 'string') return clampText(value, 1200)
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (typeof value === 'bigint') return String(value)
  if (Buffer.isBuffer(value)) return `[binary ${value.length} bytes]`
  if (typeof value !== 'object') return clampText(value, 1200)
  if (depth >= 4 || seen.has(value)) return '[nested]'
  seen.add(value)
  if (Array.isArray(value)) {
    const out = value.slice(0, 50).map(item => sanitizeCerebrumOperationValue(item, depth + 1, seen))
    seen.delete(value)
    return out
  }
  const out = {}
  Object.keys(value).slice(0, 80).forEach(key => {
    const normalizedKey = clampText(key, 120)
    if (!normalizedKey || /^(data|image|snapshot|buffer|base64)$/i.test(normalizedKey)) return
    out[normalizedKey] = isSecretKey(normalizedKey)
      ? '[redacted]'
      : sanitizeCerebrumOperationValue(value[key], depth + 1, seen)
  })
  seen.delete(value)
  return out
}

const boundDetails = value => {
  const sanitized = sanitizeCerebrumOperationValue(value && typeof value === 'object' ? value : {})
  let encoded = '{}'
  try { encoded = JSON.stringify(sanitized) } catch (error) { return {} }
  if (encoded.length <= CEREBRUM_OPERATION_DETAILS_MAX_CHARS) return sanitized
  return {
    truncated: true,
    preview: encoded.slice(0, CEREBRUM_OPERATION_DETAILS_MAX_CHARS)
  }
}

const resolveCerebrumOperationAction = entry => {
  const source = entry && typeof entry === 'object' ? entry : {}
  const details = source.details && typeof source.details === 'object' ? source.details : {}
  const event = clampText(details.event, 120).toLowerCase()
  const operation = clampText(source.operation, 120).toLowerCase()
  const actor = clampText(source.source, 160).toLowerCase()
  if (event === 'groupvalue_write' || operation === 'groupvalue_write' || operation === 'write' || operation === 'command') return 'knx_write'
  if (event === 'groupvalue_read' || operation === 'groupvalue_read' || operation === 'read' || operation === 'knx_state_read') return 'knx_read'
  if (event === 'groupvalue_response' || operation === 'groupvalue_response' || operation === 'response') return 'knx_response'
  if (actor === 'speechactions' || operation === 'proactive_notification' || operation === 'boot_notification' || operation === 'habit_suggestion') return 'notification'
  if (actor === 'webactions' || actor === 'cameraactions') return 'tool_request'
  return 'activity'
}

const classifyCerebrumOperationTransport = entry => {
  const source = entry && typeof entry === 'object' ? entry : {}
  const details = source.details && typeof source.details === 'object' ? source.details : {}
  const category = clampText(source.category, 40).toLowerCase()
  const actor = clampText(source.source, 160).toLowerCase()
  const operation = clampText(source.operation, 120).toLowerCase()
  const status = clampText(source.status, 60).toLowerCase()
  const action = resolveCerebrumOperationAction(source)
  if (category === 'knx') {
    return {
      direction: details.echoed === true ? 'outbound' : 'inbound',
      action
    }
  }
  const dispatched = new Set(['sent', 'submitted', 'started', 'succeeded', 'timed_out']).has(status)
  if ((actor === 'knxactions' || (actor === 'state-reconciler' && operation === 'knx_state_read')) && action.startsWith('knx_')) {
    return { direction: dispatched ? 'outbound' : 'internal', action }
  }
  if (action === 'notification' && status === 'sent') return { direction: 'outbound', action }
  if (action === 'tool_request' && dispatched) return { direction: 'outbound', action }
  return { direction: 'internal', action }
}

const normalizeCerebrumOperation = (entry, { now = Date.now() } = {}) => {
  const source = entry && typeof entry === 'object' ? entry : {}
  const parsedTs = typeof source.ts === 'number'
    ? source.ts
    : new Date(String(source.at || '')).getTime()
  const ts = Number.isFinite(parsedTs) && parsedTs > 0 ? parsedTs : Number(now)
  const requestedCategory = clampText(source.category, 40).toLowerCase()
  const category = CEREBRUM_OPERATION_CATEGORIES.has(requestedCategory) ? requestedCategory : 'system'
  const operation = clampText(source.operation, 120) || 'activity'
  const status = clampText(source.status, 60).toLowerCase() || 'observed'
  const normalized = {
    id: clampText(source.id, 160),
    ts,
    at: new Date(ts).toISOString(),
    category,
    source: clampText(source.source, 160) || 'Cerebrum',
    operation,
    status,
    title: clampText(source.title, 300) || operation,
    summary: clampText(source.summary, 1200),
    sessionId: clampText(source.sessionId, 240),
    durationMs: Math.max(0, Math.round(Number(source.durationMs) || 0)),
    details: boundDetails(source.details)
  }
  const transport = classifyCerebrumOperationTransport(normalized)
  normalized.direction = transport.direction
  normalized.action = transport.action
  if (!normalized.id) {
    normalized.id = crypto.createHash('sha256')
      .update(JSON.stringify([
        normalized.ts,
        normalized.category,
        normalized.source,
        normalized.operation,
        normalized.title,
        normalized.summary,
        normalized.sessionId,
        normalized.details
      ]))
      .digest('hex')
      .slice(0, 24)
  }
  return normalized
}

const serializeCerebrumOperationRecord = entry => JSON.stringify(normalizeCerebrumOperation(entry))

const parseCerebrumOperationRecord = line => {
  const source = String(line || '').trim()
  if (!source) return null
  try { return normalizeCerebrumOperation(JSON.parse(source)) } catch (error) { return null }
}

const mapKnxTelegramToOperation = telegram => {
  const source = telegram && typeof telegram === 'object' ? telegram : {}
  const payload = source.payload && typeof source.payload === 'object'
    ? JSON.stringify(source.payload)
    : String(source.payload === undefined ? '' : source.payload)
  const label = clampText(source.devicename, 240)
  const destination = clampText(source.destination, 80)
  const event = clampText(source.event, 120) || 'KNX telegram'
  return normalizeCerebrumOperation({
    id: `knx:${clampText(source.ts, 30)}:${clampText(source.source, 80)}:${destination}:${event}:${clampText(payload, 120)}`,
    ts: Number(source.ts || 0),
    category: 'knx',
    source: 'KNX bus',
    operation: event,
    status: 'observed',
    title: `${event}: ${clampText(source.source, 80) || '?'} → ${destination || '?'}`,
    summary: [label, clampText(source.dpt, 80), clampText(payload, 300), clampText(source.payloadmeasureunit, 80)].filter(Boolean).join(' · '),
    details: {
      event,
      source: source.source,
      destination: source.destination,
      dpt: source.dpt,
      deviceName: source.devicename,
      payload: source.payload,
      payloadMeasureUnit: source.payloadmeasureunit,
      echoed: source.echoed,
      repeated: source.repeated,
      rawHex: source.rawHex
    }
  })
}

const buildCerebrumOperationsSnapshot = ({
  operations = [],
  telegrams = [],
  knxTotal = 0,
  fromTs,
  toTs,
  limit = CEREBRUM_OPERATIONS_DEFAULT_LIMIT
} = {}) => {
  const maxItems = Math.max(1, Math.min(CEREBRUM_OPERATIONS_MAX_LIMIT, Math.round(Number(limit) || CEREBRUM_OPERATIONS_DEFAULT_LIMIT)))
  const operationItems = (Array.isArray(operations) ? operations : [])
    .map(item => normalizeCerebrumOperation(item))
    .sort((left, right) => Number(right.ts || 0) - Number(left.ts || 0))
  const knxItems = (Array.isArray(telegrams) ? telegrams : []).map((telegram, index) => {
    const item = mapKnxTelegramToOperation(telegram)
    item.id = `${item.id}:${index}`
    return item
  }).sort((left, right) => Number(right.ts || 0) - Number(left.ts || 0))
  // A busy KNX bus must not hide every LLM/tool/autonomous audit entry. Keep
  // space for KNX, then fill the rest with node operations and the newest
  // telegrams before restoring chronological order in the combined timeline.
  const reservedKnxSlots = knxItems.length > 0
    ? Math.min(knxItems.length, Math.ceil(maxItems * 0.25))
    : 0
  const selectedOperations = operationItems.slice(0, Math.max(0, maxItems - reservedKnxSlots))
  const selectedKnx = knxItems.slice(0, Math.max(0, maxItems - selectedOperations.length))
  let remainingSlots = Math.max(0, maxItems - selectedOperations.length - selectedKnx.length)
  if (remainingSlots > 0) {
    selectedOperations.push(...operationItems.slice(selectedOperations.length, selectedOperations.length + remainingSlots))
    remainingSlots = Math.max(0, maxItems - selectedOperations.length - selectedKnx.length)
  }
  if (remainingSlots > 0) selectedKnx.push(...knxItems.slice(selectedKnx.length, selectedKnx.length + remainingSlots))
  const items = selectedOperations.concat(selectedKnx)
    .sort((left, right) => Number(right.ts || 0) - Number(left.ts || 0))
  const counts = { total: operationItems.length + Math.max(knxItems.length, Number(knxTotal) || 0), llm: 0, tool: 0, autonomous: 0, knx: Math.max(knxItems.length, Number(knxTotal) || 0), system: 0 }
  operationItems.forEach(item => {
    if (Object.prototype.hasOwnProperty.call(counts, item.category)) counts[item.category] += 1
  })
  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    retentionDays: CEREBRUM_OPERATIONS_RETENTION_DAYS,
    from: new Date(Number(fromTs || (Date.now() - (CEREBRUM_OPERATIONS_RETENTION_DAYS * 86400000)))).toISOString(),
    to: new Date(Number(toTs || Date.now())).toISOString(),
    counts,
    returnedItems: items.length,
    truncated: counts.total > items.length,
    balancedSelection: counts.total > items.length && operationItems.length > 0 && knxItems.length > 0,
    items
  }
}

module.exports = {
  CEREBRUM_OPERATION_DETAILS_MAX_CHARS,
  CEREBRUM_OPERATIONS_DEFAULT_LIMIT,
  CEREBRUM_OPERATIONS_MAX_LIMIT,
  CEREBRUM_OPERATIONS_RETENTION_DAYS,
  buildCerebrumOperationsSnapshot,
  classifyCerebrumOperationTransport,
  mapKnxTelegramToOperation,
  normalizeCerebrumOperation,
  parseCerebrumOperationRecord,
  sanitizeCerebrumOperationValue,
  serializeCerebrumOperationRecord
}
