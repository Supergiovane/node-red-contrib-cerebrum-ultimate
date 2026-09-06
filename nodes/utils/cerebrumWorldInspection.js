'use strict'

const { CEREBRUM_AUTONOMY_LIMITS } = require('./cerebrumAutonomy')
const { canAct } = require('./cerebrumAutonomyRuntime')

// Human inspection has its own budget. Never reuse the LLM projection here:
// provenance, goal baselines, source text and feedback must remain inspectable.
const CEREBRUM_WORLD_INSPECTION_COLLECTIONS = Object.freeze([
  'entities', 'goals', 'patterns', 'knowledge', 'evidence', 'episodes',
  'situations', 'expectations', 'researchHistory', 'actionHistory', 'habits', 'reasonHistory'
])
const MAX_RESPONSE_BYTES = 96 * 1024
const DEFAULT_LIMIT = 12
const MAX_LIMIT = 20
const RETENTION = Object.freeze({ patternsDays: 28, knowledgeDays: 14, operationsDays: 3, researchHistoryDays: 30 })
const LIMITS = Object.freeze({
  ...CEREBRUM_AUTONOMY_LIMITS,
  goals: 40,
  activeGoals: 12,
  patterns: 240,
  knowledge: 48,
  researchHistory: 60,
  habits: 80,
  reasonHistory: CEREBRUM_AUTONOMY_LIMITS.reasonsPerHour,
  researchSessionsPerDay: 2,
  inspectionPageSize: MAX_LIMIT,
  inspectionResponseBytes: MAX_RESPONSE_BYTES
})
const list = (world, collection) => Array.isArray(world[collection]) ? world[collection] : []
const recordStatus = (record, collection) => {
  if (!record || typeof record !== 'object') return ''
  if (collection === 'entities') return record.fresh === true ? 'fresh' : 'stale'
  return String(record.status || (collection === 'episodes' ? record.outcome : '') || '')
}
const statusesFor = (records, collection) => {
  const counts = new Map()
  for (const record of records) {
    const status = recordStatus(record, collection)
    if (status) counts.set(status, (counts.get(status) || 0) + 1)
  }
  return [...counts].sort(([left], [right]) => left.localeCompare(right)).map(([value, count]) => ({ value, count }))
}
const activityFor = node => {
  const enabled = node._closing !== true && node.cerebrumAutonomyEnabled === true && node.llmEnabled === true
  let actionsReason = 'ready'
  if (!enabled || node.cerebrumAutonomyAllowActions !== true) actionsReason = 'assistant_disabled'
  else if (!String(node.aiEducation || '').trim()) actionsReason = 'education_missing'
  else if (node.llmAllowKnxCommands !== true) actionsReason = 'commands_disabled'
  else if (node.llmRequireCommandConfirmation === true) actionsReason = 'confirmation_required'
  return {
    enabled,
    actionsEnabled: enabled && canAct(node),
    webEnabled: enabled && node.webAccessEnabled === true,
    actionsReason
  }
}
const identity = (world, nodeId) => ({ ok: true, nodeId: String(nodeId || ''), revision: world.sequence, updatedAt: world.updatedAt || '' })

const buildCerebrumWorldOverview = ({ world, node, nodeId = node.id } = {}) => ({
  ...identity(world, nodeId),
  counts: Object.fromEntries(CEREBRUM_WORLD_INSPECTION_COLLECTIONS.map(collection => [collection, list(world, collection).length])),
  statuses: Object.fromEntries(CEREBRUM_WORLD_INSPECTION_COLLECTIONS.map(collection => [collection, statusesFor(list(world, collection), collection)])),
  activity: {
    ...activityFor(node),
    lastTickAt: world.lastTickAt || '',
    lastReasonAt: world.lastReasonAt || '',
    lastError: world.lastError || ''
  },
  retention: RETENTION,
  limits: LIMITS
})

const recordTime = record => {
  if (typeof record === 'string') return Date.parse(record) || 0
  if (!record || typeof record !== 'object') return 0
  for (const key of ['updatedAt', 'completedAt', 'observedAt', 'lastObserved', 'retrievedAt', 'at', 'createdAt']) {
    const value = Date.parse(record[key] || '')
    if (Number.isFinite(value)) return value
  }
  return 0
}
const displayRecord = (record, collection, entities) => {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return record
  const ids = [...new Set([
    record.entityId,
    record.targetId,
    ...(Array.isArray(record.entityIds) ? record.entityIds : [])
  ].filter(value => typeof value === 'string' && value))].slice(0, 40)
  const related = ids.map(id => entities.get(id)).filter(Boolean)
    .map(entity => ({ id: entity.id, label: entity.label || entity.objectId || entity.id, area: entity.area || '', source: entity.source || '', objectId: entity.objectId || '' }))
  return {
    ...record,
    display: {
      title: String(record.summary || record.label || record.title || (related[0] && related[0].label) || record.id || '').slice(0, 300),
      status: recordStatus(record, collection),
      entities: related
    }
  }
}
const integer = (value, fallback, maximum) => {
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? Math.min(maximum, Math.floor(number)) : fallback
}
const byteSize = value => Buffer.byteLength(JSON.stringify(value), 'utf8')

const inspectCerebrumWorldCollection = ({ world, nodeId, collection, query = '', status = '', offset = 0, limit = DEFAULT_LIMIT } = {}) => {
  if (!CEREBRUM_WORLD_INSPECTION_COLLECTIONS.includes(collection)) throw new Error('Unknown Cerebrum world collection')
  const records = list(world, collection)
  const needle = String(query || '').trim().toLocaleLowerCase()
  const requestedStatus = String(status || '').trim()
  const entities = new Map(list(world, 'entities').map(entity => [entity.id, entity]))
  const matches = records.map((record, index) => ({ record: displayRecord(record, collection, entities), index, time: recordTime(record) }))
    .filter(({ record }) => (!requestedStatus || recordStatus(record, collection) === requestedStatus) &&
      (!needle || JSON.stringify(record).toLocaleLowerCase().includes(needle)))
    .sort((left, right) => right.time - left.time || right.index - left.index)
  const start = integer(offset, 0, matches.length)
  const pageSize = Math.max(1, integer(limit, DEFAULT_LIMIT, MAX_LIMIT))
  const result = {
    ...identity(world, nodeId),
    collection,
    items: [],
    statuses: statusesFor(records, collection),
    totalMatches: matches.length,
    returned: 0,
    offset: start,
    nextOffset: null,
    limited: false,
    blockedItems: []
  }
  let cursor = start
  while (cursor < matches.length && cursor - start < pageSize) {
    const record = matches[cursor].record
    const nextOffset = cursor + 1 < matches.length ? cursor + 1 : null
    const candidate = { ...result, items: [...result.items, record], returned: result.items.length + 1, nextOffset }
    if (byteSize(candidate) <= MAX_RESPONSE_BYTES) {
      result.items.push(record)
      cursor++
      continue
    }
    result.limited = true
    // The next page starts with the record that did not fit this page. If one
    // record cannot fit even by itself, name it explicitly and advance once so
    // clients cannot get trapped requesting the same oversized item forever.
    if (cursor === start) {
      result.blockedItems.push({
        id: String((record && record.id) || '').slice(0, 512),
        offset: cursor,
        bytes: byteSize(record),
        reason: 'record_exceeds_response_limit'
      })
      cursor++
    }
    break
  }
  result.returned = result.items.length
  result.nextOffset = cursor < matches.length ? cursor : null
  return result
}

module.exports = { buildCerebrumWorldOverview, inspectCerebrumWorldCollection, CEREBRUM_WORLD_INSPECTION_COLLECTIONS }
