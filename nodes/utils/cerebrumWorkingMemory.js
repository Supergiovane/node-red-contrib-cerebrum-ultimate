'use strict'

const CEREBRUM_WORKING_MEMORY_DEFAULT_BYTES = 12000
const CEREBRUM_MEMORY_QUERY_MAX_BYTES = 12000
const CEREBRUM_MEMORY_QUERY_MAX_ITEMS = 20
const SECTION_NAMES = ['areas', 'situations', 'entities', 'expectations', 'goals', 'patterns', 'knowledge', 'evidence', 'episodes', 'habits']
const SECTION_LABELS = { areas: 'AREA', situations: 'SITUATION', entities: 'ENTITY', expectations: 'EXPECTATION', goals: 'GOAL', patterns: 'PATTERN', knowledge: 'KNOWLEDGE', evidence: 'EVIDENCE', episodes: 'EPISODE', habits: 'HABIT' }
const FIELDS = {
  entities: ['id', 'semanticId', 'source', 'objectId', 'label', 'area', 'kind', 'capability', 'unit', 'access', 'value', 'observedAt', 'verifiedAt', 'changedAt', 'refreshIntervalSeconds', 'fresh', 'available', 'evidenceId'],
  situations: ['id', 'kind', 'summary', 'status', 'goalId', 'researchTopic', 'entityIds', 'evidenceIds', 'createdAt', 'updatedAt', 'dueAt', 'lastReasonAt', 'expected'],
  expectations: ['id', 'habitId', 'entityId', 'expectedValue', 'windowStartAt', 'dueAt', 'status'],
  goals: ['id', 'origin', 'topic', 'status', 'entityIds', 'evidenceIds', 'patternIds', 'sourceIds', 'comfortConfirmed', 'createdAt', 'updatedAt', 'dueAt', 'summary', 'comfortBenefit', 'successCriterion', 'plan', 'assessment', 'baseline', 'current', 'support', 'reviews'],
  patterns: ['id', 'entityId', 'semanticId', 'source', 'objectId', 'label', 'area', 'kind', 'dayType', 'hour', 'status', 'observedDays', 'occurrences', 'firstObserved', 'lastObserved', 'numeric', 'categoricalValues', 'unlistedValues', 'originObservations', 'evidenceIds', 'relatedHabitIds', 'summary', 'dataCoverage'],
  knowledge: ['id', 'url', 'retrievedAt', 'expiresAt', 'origin', 'topic', 'goalId', 'title', 'excerptOnly', 'text'],
  evidence: ['id', 'entityId', 'type', 'at', 'summary', 'value', 'previousValue', 'observedAt'],
  episodes: ['id', 'type', 'status', 'hypothesis', 'origin', 'situationId', 'at', 'startedAt', 'endedAt', 'area', 'sources', 'summary', 'outcome', 'confidence', 'importance', 'entityIds', 'evidenceIds', 'observationIds'],
  habits: ['id', 'type', 'description', 'summary', 'source', 'objectId', 'semanticId', 'entityIds', 'label', 'area', 'kind', 'value', 'status', 'confidence', 'samples', 'supportingObservations', 'contradictingObservations', 'observationDays', 'observationSpanDays', 'dayType', 'averageMinuteOfDay', 'deviationMinutes', 'firstSeenAt', 'updatedAt', 'lastObserved', 'evidenceIds', 'relatedPatternIds']
}

const byteLength = value => Buffer.byteLength(value, 'utf8')
const recordList = value => (Array.isArray(value) ? value : value instanceof Map ? Array.from(value.values()) : value && typeof value === 'object' ? Object.values(value) : [])
  .filter(item => item && typeof item === 'object' && !Array.isArray(item))
const finiteInteger = (value, fallback, min, max) => Number.isFinite(Number(value)) ? Math.max(min, Math.min(max, Math.floor(Number(value)))) : fallback
const normalizeText = value => (typeof value === 'string' ? value.slice(0, 4096) : '')
  .normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^\p{L}\p{N}./:_-]+/gu, ' ').trim()
const STOP_WORDS = new Set('a an and are at by can did do for from has have how i in is it la le lo il gli un una di da del della delle dei nel nella con che e è per come cosa mi the to was were what when where why will with'.split(' '))
const queryWords = query => Array.from(new Set(normalizeText(query).split(/\s+/).filter(word => word.length > 1 && !STOP_WORDS.has(word)))).slice(0, 32)
const stringList = value => (Array.isArray(value) ? value : []).filter(item => typeof item === 'string')
const identifier = record => typeof record.id === 'string' ? record.id : ''
const timestamp = record => Date.parse(record.verifiedAt || record.observedAt || record.updatedAt || record.lastObserved || record.retrievedAt || record.at || record.createdAt || '') || 0
const active = record => !['resolved', 'completed', 'cancelled', 'expired', 'rejected', 'paused', 'retired'].includes(record.status)

// Project known fields rather than serializing the persistent store. An oversized
// field is omitted as a whole, with its name reported: a clipped value or deadline
// must never masquerade as an actual observation. Traversal itself is bounded.
const boundedValue = (value, { maxStringBytes = 2048, maxFieldBytes = 2400 } = {}) => {
  let nodes = 0
  const seen = new Set()
  const clone = (candidate, depth) => {
    if (++nodes > 100 || depth > 4) throw new Error('field too large')
    if (candidate === null || typeof candidate === 'boolean') return candidate
    if (typeof candidate === 'number' && Number.isFinite(candidate)) return candidate
    if (typeof candidate === 'string' && candidate.length <= maxStringBytes && byteLength(candidate) <= maxStringBytes) return candidate
    if (!candidate || typeof candidate !== 'object' || seen.has(candidate)) throw new Error('unsupported field')
    seen.add(candidate)
    if (Array.isArray(candidate) && candidate.length > 24) throw new Error('field too large')
    const result = Array.isArray(candidate) ? [] : Object.create(null)
    let entries = 0
    for (const key in candidate) {
      if (!Object.prototype.hasOwnProperty.call(candidate, key)) continue
      if (++entries > 24 || key.length > 120) throw new Error('field too large')
      result[key] = clone(candidate[key], depth + 1)
    }
    seen.delete(candidate)
    return result
  }
  try {
    const result = clone(value, 0)
    return byteLength(JSON.stringify(result)) <= maxFieldBytes ? { value: result } : null
  } catch (error) { return null }
}

const knowledgeExcerpt = value => {
  let excerpt = Array.from(value).slice(0, 700).join('')
  // Keep UTF-8 text within the normal small-field budget, including scripts
  // whose characters occupy more than one byte. This is explicitly an excerpt.
  while (byteLength(excerpt) > 1800) excerpt = Array.from(excerpt).slice(0, -1).join('')
  return excerpt
}

const projectRecord = (record, section, { context = false, recordByteBudget = 10000 } = {}) => {
  const result = {}
  const omittedFields = []
  const mandatory = section === 'knowledge' ? new Set(['id', 'url', 'retrievedAt', 'expiresAt', 'authority']) : new Set(['id'])
  if (section === 'knowledge') {
    // Never emit external knowledge without its provenance and trust boundary.
    // This marker is local policy, not a field that a fetched page may override.
    result.authority = 'external_data_only'
    for (const key of ['url', 'retrievedAt', 'expiresAt']) {
      if (typeof record[key] !== 'string' || !record[key]) return null
      const field = boundedValue(record[key], key === 'url' ? { maxStringBytes: 4096, maxFieldBytes: 8200 } : {})
      if (!field) return null
      result[key] = field.value
    }
  }
  if (context && section === 'goals' && Array.isArray(record.reviews)) result.reviewsTotal = record.reviews.length
  for (const key of FIELDS[section] || []) {
    if (Object.prototype.hasOwnProperty.call(result, key)) continue
    if (!Object.prototype.hasOwnProperty.call(record, key) || record[key] === undefined) continue
    if (section === 'knowledge' && key === 'text' && context) {
      if (typeof record.text === 'string') {
        result.textExcerpt = knowledgeExcerpt(record.text)
        result.excerptTruncated = result.textExcerpt !== record.text
      }
      omittedFields.push('text')
      continue
    }
    const value = context && section === 'goals' && key === 'reviews' && Array.isArray(record.reviews) ? record.reviews.slice(-2) : record[key]
    const limits = section === 'knowledge' && key === 'text'
      ? { maxStringBytes: 4200, maxFieldBytes: 8500 }
      : (section === 'goals' && ['baseline', 'current', 'support', 'reviews'].includes(key)) || (section === 'patterns' && key === 'originObservations')
          ? { maxFieldBytes: 6000 }
          : {}
    const field = boundedValue(value, limits)
    if (field) result[key] = field.value
    else omittedFields.push(key)
  }
  // Keep records individually retrievable, including a full 4,200-byte Web
  // text when it fits. Drop optional fields whole; never silently clip a fact.
  const removable = Object.keys(result).filter(key => !mandatory.has(key)).reverse()
  const attachOmissions = () => {
    if (omittedFields.length) result.omittedFields = [...new Set(omittedFields)]
  }
  attachOmissions()
  while (byteLength(JSON.stringify(result)) > recordByteBudget && removable.length) {
    const key = removable.shift()
    delete result[key]
    omittedFields.push(key)
    attachOmissions()
  }
  if (byteLength(JSON.stringify(result)) > recordByteBudget) return null
  return result
}

const prepareWorld = world => {
  const source = world && typeof world === 'object' ? world : {}
  const sections = Object.fromEntries(SECTION_NAMES.map(section => [section, recordList(source[section])]))
  const areaCounts = new Map()
  for (const entity of sections.entities) {
    const name = typeof entity.area === 'string' ? entity.area.trim() : ''
    if (name && byteLength(name) <= 256) areaCounts.set(name, (areaCounts.get(name) || 0) + 1)
  }
  sections.areas = Array.from(areaCounts, ([id, entityCount]) => ({ id, entityCount }))
  const situationsById = new Map(sections.situations.map(record => [identifier(record), record]))
  const evidenceById = new Map(sections.evidence.map(record => [identifier(record), record]))
  const goalsById = new Map(sections.goals.map(record => [identifier(record), record]))
  const linkedIds = (record, section) => {
    if (section === 'entities') return [identifier(record), typeof record.semanticId === 'string' ? record.semanticId : ''].filter(Boolean)
    const ids = stringList(record.entityIds)
    if (typeof record.entityId === 'string') ids.push(record.entityId)
    if (typeof record.semanticId === 'string') ids.push(record.semanticId)
    if (typeof record.goalId === 'string') {
      const goal = goalsById.get(record.goalId)
      if (goal) ids.push(...stringList(goal.entityIds))
    }
    if (section === 'knowledge') {
      // A cached source may be reused by a later goal without changing the
      // source's original goalId; both explicit relationships remain searchable.
      for (const goal of sections.goals) if (stringList(goal.sourceIds).includes(identifier(record))) ids.push(...stringList(goal.entityIds))
    }
    if (section === 'habits' && record.source && record.objectId) ids.push(`${record.source}:${record.objectId}`)
    if (section === 'episodes') {
      const situation = situationsById.get(record.situationId)
      if (situation) ids.push(...stringList(situation.entityIds))
      for (const evidenceId of stringList(record.evidenceIds)) {
        const evidence = evidenceById.get(evidenceId)
        if (evidence && typeof evidence.entityId === 'string') ids.push(evidence.entityId)
      }
    }
    return [...new Set(ids)]
  }
  return { sections, linkedIds }
}

const rankRecords = (records, { section, words, preferredIds, preferredRecordIds = new Set(), preferredAreas = new Set(), linkedIds }) => records.map(record => {
  const text = normalizeText(['id', 'semanticId', 'label', 'area', 'kind', 'type', 'summary', 'description', 'source', 'objectId', 'topic', 'comfortBenefit', 'successCriterion', 'title', 'url', 'text'].map(key => typeof record[key] === 'string' ? record[key].slice(0, 600) : '').join(' '))
  const queryScore = words.reduce((total, word) => total + (text.includes(word) ? 10 : 0), 0)
  const score = queryScore + (preferredRecordIds.has(identifier(record)) ? 5000 : 0) + (linkedIds(record, section).some(id => preferredIds.has(id)) ? 1000 : 0) + (preferredAreas.has(record.area || (section === 'areas' && record.id)) ? 50 : 0)
  return { record, score, queryScore }
}).sort((left, right) => right.score - left.score || timestamp(right.record) - timestamp(left.record) || identifier(left.record).localeCompare(identifier(right.record)))

/** Bounded, optional working memory. Trusted instructions and the current task
 * belong in the caller's mandatory prompt, never in this evictable snapshot. */
const buildCerebrumWorkingMemory = ({ world, question = '', situation = null, byteBudget = CEREBRUM_WORKING_MEMORY_DEFAULT_BYTES, includeCurrentSituation = true } = {}) => {
  const budget = finiteInteger(byteBudget, CEREBRUM_WORKING_MEMORY_DEFAULT_BYTES, 0, Number.MAX_SAFE_INTEGER)
  const { sections, linkedIds } = prepareWorld(world)
  if (situation && typeof situation === 'object' && identifier(situation)) {
    sections.situations = [situation, ...sections.situations.filter(record => identifier(record) !== identifier(situation))]
  }
  sections.situations = sections.situations.filter(active)
  sections.expectations = sections.expectations.filter(active)
  sections.goals = sections.goals.filter(record => active(record) || (situation && identifier(record) === situation.goalId))
  sections.habits = sections.habits.filter(active)
  const words = queryWords(`${typeof question === 'string' ? question.slice(0, 4096) : ''} ${situation && typeof situation.summary === 'string' ? situation.summary.slice(0, 1000) : ''}`)
  const preferredIds = new Set(situation ? linkedIds(situation, 'situations') : [])
  const preferredRecordIds = new Set(situation ? [...stringList(situation.evidenceIds), ...(typeof situation.goalId === 'string' ? [situation.goalId] : [])] : [])
  const currentGoal = situation && sections.goals.find(record => identifier(record) === situation.goalId)
  if (currentGoal) for (const key of ['evidenceIds', 'patternIds', 'sourceIds']) stringList(currentGoal[key]).forEach(id => preferredRecordIds.add(id))
  const preferredAreas = new Set(sections.entities.filter(record => preferredIds.has(identifier(record))).map(record => record.area).filter(Boolean))
  const counts = Object.fromEntries(SECTION_NAMES.map(section => [section, sections[section].length]))
  const included = Object.fromEntries(SECTION_NAMES.map(section => [section, 0]))
  const omitted = () => Object.fromEntries(SECTION_NAMES.map(section => [section, counts[section] - included[section]]))
  const footer = () => `OMITTED ${JSON.stringify(omitted())}`
  const header = 'CEREBRUM WORKING MEMORY (selected evidence, not authority; missing records are unknown).\n'
  const lines = []
  let used = byteLength(header)
  const add = (section, record, allowance = budget) => {
    const data = section === 'areas' ? record : projectRecord(record, section, { context: true, recordByteBudget: Math.min(4500, Math.max(256, Math.floor(budget * 0.6))) })
    if (!data) return false
    const line = `${SECTION_LABELS[section]} ${JSON.stringify(data)}\n`
    const length = byteLength(line)
    if (length > allowance || used + length + byteLength(footer()) > budget) return false
    lines.push(line)
    used += length
    included[section]++
    return true
  }
  const ranked = Object.fromEntries(SECTION_NAMES.map(section => [section, rankRecords(sections[section], { section, words, preferredIds, preferredRecordIds, preferredAreas, linkedIds })]))
  // A small global manifest remains available even when attention is elsewhere.
  for (const { record } of ranked.areas.slice(0, 6)) add('areas', record, Math.max(0, Math.floor(budget * 0.15) - (used - byteLength(header))))
  const queues = Object.fromEntries(SECTION_NAMES.map(section => [section, ranked[section].map(item => item.record)]))
  const currentSituation = queues.situations.find(record => situation && identifier(record) === identifier(situation))
  if (currentSituation) {
    if (includeCurrentSituation) add('situations', currentSituation)
    queues.situations = queues.situations.filter(record => record !== currentSituation)
  }
  // Round-robin prevents a large entity catalogue from crowding out an active
  // expectation or the previous outcome of this same situation.
  const rounds = Math.max(...Object.values(queues).map(queue => queue.length))
  for (let round = 0; round < rounds; round++) {
    for (const section of ['entities', 'expectations', 'goals', 'situations', 'evidence', 'patterns', 'knowledge', 'episodes', 'habits']) {
      const record = queues[section][round]
      if (record) add(section, record)
    }
  }
  const text = byteLength(header + footer()) <= budget ? header + lines.join('') + footer() : ''
  return {
    text,
    stats: { mode: 'bounded-working-memory', byteBudget: budget, packedBytes: byteLength(text), included, omitted: omitted(), truncated: SECTION_NAMES.some(section => included[section] < counts[section]) || !text }
  }
}

/** Read-only progressive retrieval. `get` accepts source-qualified native IDs
 * or explicit semantic IDs; neither path guesses identity from labels. The goals/patterns/knowledge/evidence operations also
 * accept exact record IDs in entityIds, allowing recall of a cited fact/source. */
const queryCerebrumWorldMemory = ({ world, operation = 'search', query = '', entityIds = [], limit = 8, offset = 0, byteBudget = CEREBRUM_MEMORY_QUERY_MAX_BYTES } = {}) => {
  const operations = { search: 'entities', get: 'entities', episodes: 'episodes', situations: 'situations', areas: 'areas', habits: 'habits', expectations: 'expectations', goals: 'goals', patterns: 'patterns', knowledge: 'knowledge', evidence: 'evidence' }
  if (typeof operation !== 'string' || !Object.prototype.hasOwnProperty.call(operations, operation)) return { ok: false, error: 'Unsupported memory operation. Use search, get, episodes, situations, areas, habits, expectations, goals, patterns, knowledge or evidence.' }
  const section = operations[operation]
  const budget = finiteInteger(byteBudget, CEREBRUM_MEMORY_QUERY_MAX_BYTES, 768, CEREBRUM_MEMORY_QUERY_MAX_BYTES)
  const count = finiteInteger(limit, 8, 1, CEREBRUM_MEMORY_QUERY_MAX_ITEMS)
  const start = finiteInteger(offset, 0, 0, 1000000)
  const ids = new Set(stringList(entityIds).slice(0, CEREBRUM_MEMORY_QUERY_MAX_ITEMS).filter(id => id.length <= 600))
  if (operation === 'get' && ids.size === 0) return { ok: false, operation, error: 'get requires exact source-qualified entityIds or semantic IDs.' }
  const { sections, linkedIds } = prepareWorld(world)
  const words = queryWords(query)
  const acceptsRecordIds = ['goals', 'patterns', 'knowledge', 'evidence'].includes(operation)
  let ranked = rankRecords(sections[section], { section, words, preferredIds: ids, preferredRecordIds: acceptsRecordIds ? ids : new Set(), linkedIds })
  if (ids.size && section !== 'areas') ranked = ranked.filter(({ record }) => (acceptsRecordIds && ids.has(identifier(record))) || linkedIds(record, section).some(id => ids.has(id)))
  if (words.length && operation !== 'get') ranked = ranked.filter(({ queryScore }) => queryScore > 0)
  const items = []
  let cursor = Math.min(start, ranked.length)
  let oversized = 0
  const result = () => ({ ok: true, operation, items, totalMatches: ranked.length, returned: items.length, offset: start, nextOffset: cursor < ranked.length ? cursor : null, omitted: ranked.length - items.length, oversized })
  while (cursor < ranked.length && items.length < count) {
    const record = ranked[cursor].record
    const item = section === 'areas' ? { ...record } : projectRecord(record, section, { recordByteBudget: Math.min(10000, budget - 400) })
    if (!item) {
      oversized++
      cursor++
      continue
    }
    items.push(item)
    if (byteLength(JSON.stringify(result())) > budget - 64) {
      items.pop()
      if (items.length) break
      oversized++
    }
    cursor++
  }
  return result()
}

module.exports = {
  CEREBRUM_WORKING_MEMORY_DEFAULT_BYTES,
  CEREBRUM_MEMORY_QUERY_MAX_BYTES,
  CEREBRUM_MEMORY_QUERY_MAX_ITEMS,
  buildCerebrumWorkingMemory,
  queryCerebrumWorldMemory
}
