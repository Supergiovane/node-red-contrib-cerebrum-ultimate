const fs = require('fs')
const path = require('path')
const { queryCerebrumWorldMemory } = require('./cerebrumWorkingMemory')
const { createCerebrumComfortGoals } = require('./cerebrumComfortGoals')
const { recordBehaviorTransition, summarizeBehaviorPatterns } = require('./cerebrumBehaviorPatterns')

const MINUTE = 60000
const HOUR = 60 * MINUTE
const LIMITS = Object.freeze({ entities: 600, situations: 100, evidence: 1200, episodes: 300, expectations: 160, actionHistory: 144, reasonsPerHour: 24, effectsPerHour: 6 })
const MAX_STORE_BYTES = 8 * 1024 * 1024
const MAX_JOURNAL_BYTES = 8 * 1024 * 1024
const observationJournalPath = filePath => `${filePath}.observations.jsonl`
const validateCerebrumAutonomyStore = store => {
  if (!store || store.version !== 1 || !Number.isSafeInteger(store.sequence) || store.sequence < 0 ||
      !['entities', 'situations', 'evidence', 'episodes', 'habits', 'expectations', 'actionHistory', 'reasonHistory'].every(key => Array.isArray(store[key]))) {
    throw new Error('Invalid autonomy store')
  }
  for (const key of ['entities', 'situations', 'evidence', 'episodes', 'habits', 'expectations', 'actionHistory']) {
    if (store[key].some(item => !item || typeof item !== 'object' || typeof item.id !== 'string')) throw new Error(`Invalid autonomy ${key}`)
  }
  for (const key of ['goals', 'patterns', 'knowledge', 'researchHistory']) {
    if (store[key] !== undefined && (!Array.isArray(store[key]) || store[key].some(item => !item || typeof item !== 'object' || typeof item.id !== 'string'))) throw new Error(`Invalid autonomy ${key}`)
  }
  for (const [key, limit] of Object.entries({ goals: 40, patterns: 240, knowledge: 48, researchHistory: 60 })) {
    if ((store[key] || []).length > limit) throw new Error(`Autonomy ${key} exceeds its storage limit`)
  }
  if ((store.goals || []).some(goal => !Array.isArray(goal.entityIds) || goal.entityIds.length > 6 || goal.entityIds.some(id => typeof id !== 'string') || !Array.isArray(goal.reviews) || goal.reviews.length > 8)) throw new Error('Invalid comfort goal structure')
  if (store.observationSequence !== undefined && (!Number.isSafeInteger(store.observationSequence) || store.observationSequence < 0)) throw new Error('Invalid autonomy observation sequence')
  if (Buffer.byteLength(JSON.stringify(store), 'utf8') > MAX_STORE_BYTES) throw new Error('Autonomy store exceeds its storage limit')
  return store
}
const clip = (value, size = 500) => String(value === undefined || value === null ? '' : value).slice(0, size)
const copy = value => JSON.parse(JSON.stringify(value))
const iso = value => new Date(value).toISOString()
const stamp = value => typeof value === 'number' ? value : Date.parse(value || '')
const valueOf = value => typeof value === 'object' && value !== null ? clip(JSON.stringify(value)) : clip(value)
const entityKey = value => `${clip(value.source, 80)}:${clip(value.objectId, 240)}`
const normalizeObservation = state => ({
  source: clip(state.source, 80),
  objectId: clip(state.objectId, 240),
  label: clip(state.label || state.objectId, 240),
  area: clip(state.area, 120),
  kind: clip(state.kind, 120),
  value: valueOf(state.value),
  observedAt: iso(stamp(state.observedAt)),
  verifiedAt: Number.isFinite(stamp(state.verifiedAt)) ? iso(stamp(state.verifiedAt)) : '',
  changedAt: Number.isFinite(stamp(state.changedAt)) ? iso(stamp(state.changedAt)) : '',
  refreshIntervalSeconds: Number(state.refreshIntervalSeconds) || 60
})
// The journal and the world checkpoint form one store: replay only records
// newer than the checkpoint's sequence. Never discard a malformed archive.
const validateCerebrumObservationJournal = content => {
  if (typeof content !== 'string' || Buffer.byteLength(content, 'utf8') > MAX_JOURNAL_BYTES) throw new Error('Invalid or oversized autonomy observation journal')
  const records = []
  let sequence = 0
  for (const line of content.split('\n')) {
    if (!line.trim()) continue
    const entry = JSON.parse(line)
    const state = entry && entry.state
    if (!Number.isSafeInteger(entry && entry.sequence) || entry.sequence <= sequence || !state ||
        typeof state.source !== 'string' || !state.source || typeof state.objectId !== 'string' || !state.objectId ||
        !Number.isFinite(stamp(state.observedAt))) throw new Error('Invalid autonomy observation journal record')
    sequence = entry.sequence
    records.push({ sequence, state: normalizeObservation(state) })
    if (records.length > LIMITS.evidence) throw new Error('Autonomy observation journal exceeds its record limit')
  }
  return records
}
const syncDirectory = directory => {
  // Some supported filesystems cannot fsync a directory. File contents still
  // receive fsync; other errors must reach the caller instead of claiming save.
  let fd
  try {
    fd = fs.openSync(directory, 'r')
    fs.fsyncSync(fd)
  } catch (error) {
    if (!['EINVAL', 'ENOTSUP', 'EISDIR', 'EPERM', 'EACCES'].includes(error.code)) throw error
  } finally {
    if (fd !== undefined) fs.closeSync(fd)
  }
}
const writeAtomic = (filePath, content) => {
  const directory = path.dirname(filePath)
  const temp = `${filePath}.${process.pid}.tmp`
  let fd
  try {
    fs.mkdirSync(directory, { recursive: true })
    fd = fs.openSync(temp, 'w', 0o600)
    fs.writeFileSync(fd, content, 'utf8')
    fs.fsyncSync(fd)
    fs.closeSync(fd)
    fd = undefined
    fs.renameSync(temp, filePath)
    syncDirectory(directory)
  } catch (error) {
    if (fd !== undefined) { try { fs.closeSync(fd) } catch (_) {} }
    try { fs.unlinkSync(temp) } catch (_) {}
    throw error
  }
}
const localDay = now => {
  const date = new Date(now)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
const isFresh = (entity, now) => {
  const age = now - stamp(entity.observedAt)
  const allowance = Math.min(30 * MINUTE, Math.max(2 * MINUTE, Number(entity.refreshIntervalSeconds || 60) * 2000))
  return entity.source !== 'unknown' && !['', 'unknown', 'unavailable', 'undefined', 'null'].includes(entity.value.toLowerCase()) && Number.isFinite(age) && age >= -5000 && age <= allowance
}

// This store contains bounded working knowledge. The original home/event archives
// remain owned by their existing stores and are never trimmed by this engine.
const createCerebrumAutonomy = ({ filePath, readSnapshot, reason, execute, notify, research, researchEnabled = () => false, enabled = () => true, now = Date.now, log = () => {} }) => {
  if (!filePath || typeof readSnapshot !== 'function' || typeof reason !== 'function') throw new Error('Autonomy requires filePath, readSnapshot and reason')
  let store
  try {
    if (fs.statSync(filePath).size > MAX_STORE_BYTES) throw new Error('Autonomy store exceeds its storage limit')
    store = validateCerebrumAutonomyStore(JSON.parse(fs.readFileSync(filePath, 'utf8')))
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error(`Cannot safely read autonomy store: ${error.message}`)
    store = { version: 1, sequence: 0, createdAt: iso(now()), updatedAt: iso(now()), lastTickAt: '', lastReasonAt: '', lastDailyAt: '', lastError: '', entities: [], situations: [], evidence: [], episodes: [], habits: [], expectations: [], actionHistory: [], reasonHistory: [] }
  }
  if (!Array.isArray(store.patterns)) store.patterns = []
  if (store.observationSequence === undefined) store.observationSequence = 0
  let closed = false
  let inFlight = null
  let lastPersisted = ''
  const journalPath = observationJournalPath(filePath)
  let pendingStates = []
  let journalBytes = 0
  let journalNeedsCompaction = false
  let nextObservationSequence = store.observationSequence
  let journalFailed = false
  let journalRecoveryMessage = ''
  try {
    if (fs.statSync(journalPath).size > MAX_JOURNAL_BYTES) throw new Error('Autonomy observation journal exceeds its storage limit')
    let content = fs.readFileSync(journalPath, 'utf8')
    let records
    try {
      records = validateCerebrumObservationJournal(content)
    } catch (error) {
      // A process can stop inside append(), before the final newline/fsync.
      // Recover only that unterminated JSON fragment. A malformed COMPLETE
      // record or an invalid structured record must still stop startup.
      if (!content || content.endsWith('\n')) throw error
      const boundary = content.lastIndexOf('\n') + 1
      let unfinishedJson = false
      try { JSON.parse(content.slice(boundary)) } catch (parseError) { unfinishedJson = parseError instanceof SyntaxError }
      if (!unfinishedJson) throw error
      const complete = content.slice(0, boundary)
      records = validateCerebrumObservationJournal(complete)
      let recoveryPath = `${journalPath}.incomplete-${Date.now()}-${process.pid}`
      let suffix = 0
      while (fs.existsSync(recoveryPath)) recoveryPath = `${journalPath}.incomplete-${Date.now()}-${process.pid}-${++suffix}`
      // Preserve the original bytes, including any interrupted UTF-8 sequence,
      // durably before replacing the active journal with its complete prefix.
      fs.copyFileSync(journalPath, recoveryPath, fs.constants.COPYFILE_EXCL)
      const recoveryFd = fs.openSync(recoveryPath, 'r+')
      try { fs.fsyncSync(recoveryFd) } finally { fs.closeSync(recoveryFd) }
      syncDirectory(path.dirname(recoveryPath))
      writeAtomic(journalPath, complete)
      content = complete
      journalRecoveryMessage = `Recovered complete autonomy observations after an interrupted append; original journal preserved in ${path.basename(recoveryPath)}.`
    }
    pendingStates = records.filter(entry => entry.sequence > store.observationSequence)
    nextObservationSequence = Math.max(nextObservationSequence, records.at(-1)?.sequence || 0)
    journalBytes = Buffer.byteLength(content, 'utf8')
    journalNeedsCompaction = records.length !== pendingStates.length || (content.length > 0 && !content.endsWith('\n'))
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error(`Cannot safely read autonomy observation journal: ${error.message}`)
  }
  const id = prefix => `${prefix}-${++store.sequence}`
  const report = error => {
    store.lastError = clip(error.message || error, 1000)
    try { log(store.lastError) } catch (_) {}
  }
  if (journalRecoveryMessage) report(journalRecoveryMessage)
  const trim = () => {
    store.entities = store.entities.slice(-LIMITS.entities)
    // Keep the latest observation for every retained entity so evidence IDs in
    // the world model never point to an already discarded observation.
    const referenced = new Set(store.entities.map(entity => entity.evidenceId))
    const protectedEvidence = store.evidence.filter(item => referenced.has(item.id)).slice(-LIMITS.evidence)
    const protectedIds = new Set(protectedEvidence.map(item => item.id))
    const remaining = Math.max(0, LIMITS.evidence - protectedEvidence.length)
    const spare = remaining ? store.evidence.filter(item => !protectedIds.has(item.id)).slice(-remaining) : []
    store.evidence = [...spare, ...protectedEvidence].sort((a, b) => stamp(a.at) - stamp(b.at))
    const evidenceIds = new Set(store.evidence.map(item => item.id))
    for (const situation of store.situations) situation.evidenceIds = (situation.evidenceIds || []).filter(item => evidenceIds.has(item)).slice(-32)
    const active = store.situations.filter(item => item.status !== 'resolved')
    const resolved = store.situations.filter(item => item.status === 'resolved')
    store.situations = [...resolved.slice(-Math.max(0, LIMITS.situations - active.length)), ...active].slice(-LIMITS.situations)
    for (const key of ['episodes', 'expectations', 'actionHistory']) store[key] = store[key].slice(-LIMITS[key])
    store.reasonHistory = store.reasonHistory.filter(at => now() - stamp(at) < HOUR).slice(-LIMITS.reasonsPerHour)
    store.patterns = store.patterns.slice(-240)
    store.knowledge = (store.knowledge || []).slice(-48)
    store.researchHistory = (store.researchHistory || []).slice(-60)
  }
  const persist = () => {
    trim()
    const content = JSON.stringify(store)
    if (Buffer.byteLength(content, 'utf8') > MAX_STORE_BYTES) throw new Error('Autonomy store exceeds its storage limit; effects aborted')
    try {
      if (content !== lastPersisted) {
        writeAtomic(filePath, content)
        lastPersisted = content
      }
      if (journalNeedsCompaction) {
        // Commit the applied sequence with the derived knowledge FIRST. If a
        // restart happens before compaction, old journal entries are skipped.
        const journal = pendingStates.map(entry => JSON.stringify(entry) + '\n').join('')
        writeAtomic(journalPath, journal)
        journalBytes = Buffer.byteLength(journal, 'utf8')
        journalNeedsCompaction = false
      }
    } catch (error) {
      throw new Error(`Autonomy persistence failed; effects aborted: ${error.message}`)
    }
  }
  const addEvidence = (type, entity, summary, at, extra = {}) => {
    const entry = { id: id('evidence'), entityId: entity ? entity.id : '', type, at: iso(at), summary: clip(summary, 800), ...extra }
    store.evidence.push(entry)
    return entry.id
  }
  const openSituation = ({ key, kind, summary, entityIds = [], evidenceIds = [], at, dueAt = at }) => {
    let situation = store.situations.find(item => item.key === key && item.status === 'open')
    if (!situation) {
      // Claims and verification must never be evicted by an event storm.
      if (store.situations.filter(item => item.status !== 'resolved').length >= LIMITS.situations) return null
      situation = { id: id('situation'), key, kind, summary: clip(summary, 1000), status: 'open', entityIds: [], evidenceIds: [], createdAt: iso(at), updatedAt: iso(at), dueAt: iso(dueAt), lastReasonAt: '', expected: null, claim: null }
      store.situations.push(situation)
    }
    situation.entityIds = [...new Set([...situation.entityIds, ...entityIds])].slice(-40)
    situation.evidenceIds = [...new Set([...situation.evidenceIds, ...evidenceIds])].slice(-32)
    situation.updatedAt = iso(at)
    situation.summary = clip(summary, 1000)
    return situation
  }
  const episode = (situation, outcome, summary, at) => {
    store.episodes.push({ id: id('episode'), situationId: situation.id, at: iso(at), summary: clip(summary, 1200), outcome, entityIds: [...situation.entityIds], evidenceIds: [...situation.evidenceIds] })
  }
  const resolve = (situation, outcome, summary, at) => {
    situation.status = 'resolved'
    situation.updatedAt = iso(at)
    situation.outcome = outcome
    episode(situation, outcome, summary, at)
    const history = situation.claim && store.actionHistory.find(item => item.id === situation.claim.id)
    if (history) history.status = outcome
  }
  const observe = (snapshot, at, partial = false) => {
    const previous = new Map(store.entities.map(entity => [entity.id, entity]))
    const observed = new Map()
    for (const providedState of (Array.isArray(snapshot.states) ? snapshot.states : []).slice(-LIMITS.entities)) {
      let state = providedState
      if (!state || !state.source || !state.objectId) continue
      const key = entityKey(state)
      const old = previous.get(key)
      if (old && stamp(state.observedAt) < stamp(old.observedAt)) {
        if (partial) continue
        // After an abrupt restart, the append journal can contain a newer
        // observation than the shared house-memory checkpoint. Do not rewind
        // that recovered state to the older snapshot while sources reconnect.
        state = old
      }
      const entity = { id: key, source: clip(state.source, 80), objectId: clip(state.objectId, 240), label: clip(state.label || state.objectId, 240), area: clip(state.area, 120), kind: clip(state.kind, 120), value: valueOf(state.value), observedAt: clip(state.observedAt, 64), verifiedAt: clip(state.verifiedAt, 64), changedAt: clip(state.changedAt, 64), refreshIntervalSeconds: Number(state.refreshIntervalSeconds) || 60, fresh: false, evidenceId: (old && old.evidenceId) || '' }
      entity.fresh = isFresh(entity, at)
      const changed = old && old.value !== entity.value
      if (!old || changed || old.fresh !== entity.fresh) {
        const type = !entity.fresh ? 'source_stale' : changed ? 'state_changed' : 'state_observed'
        const summary = !entity.fresh ? `${entity.label}: state unavailable or stale; presence/activity cannot be inferred.` : `${entity.label}: ${changed ? `${old.value} → ` : ''}${entity.value}`
        entity.evidenceId = addEvidence(type, entity, summary, at, { value: entity.value, previousValue: old ? old.value : '', observedAt: entity.observedAt })
        openSituation({ key: entity.fresh ? `area:${entity.area || `${entity.source}:${entity.kind || 'other'}`}` : `source_stale:${key}`, kind: entity.fresh ? 'state_change' : 'source_stale', summary, entityIds: [key], evidenceIds: [entity.evidenceId], at })
      }
      if (changed && entity.fresh) {
        const recentAction = [...store.actionHistory].reverse().find(item => item.disposition === 'act' && item.targetId === key && !['action_rejected', 'cancelled'].includes(item.status) && stamp(entity.observedAt) >= stamp(item.at) && stamp(entity.observedAt) - stamp(item.at) <= 10 * MINUTE)
        const ownEffect = recentAction && recentAction.requestedValue === entity.value
        if (!ownEffect) recordBehaviorTransition(store.patterns, { entity, previous: old, at })
        if (recentAction && old.value === recentAction.requestedValue && entity.value !== recentAction.requestedValue) {
          const evidenceId = addEvidence('plan_contradicted', entity, 'State reversed soon after Cerebrum acted. A manual override, another automation or device behaviour may explain it; reassess the plan rather than restoring the old command.', at, { claimId: recentAction.id, value: entity.value })
          const goal = store.goals.find(item => item.id === recentAction.goalId)
          if (goal && !['paused', 'retired'].includes(goal.status)) {
            goal.status = 'paused'
            goal.assessment = 'A recent action was reversed; comfort benefit is uncertain. Review the cause before resuming this plan.'
            goal.updatedAt = iso(at)
          }
          const review = openSituation({ key: `reversal:${recentAction.id}`, kind: 'goal_feedback', summary: 'A recent Cerebrum action was reversed. Respect the current state, consider an occupant correction and reassess the linked comfort goal; do not counteract the reversal.', entityIds: [key], evidenceIds: [evidenceId, entity.evidenceId], at })
          if (review && goal) review.goalId = goal.id
        }
      }
      observed.set(key, entity)
    }
    // A disappeared source is unknown, not evidence that a room became empty.
    for (const [key, old] of previous) {
      if (observed.has(key)) continue
      if (partial) {
        observed.set(key, old)
        continue
      }
      const entity = { ...old, fresh: false }
      if (old.fresh) {
        entity.evidenceId = addEvidence('source_stale', entity, `${entity.label}: absent from current snapshot; state unknown.`, at)
        openSituation({ key: `source_stale:${key}`, kind: 'source_stale', summary: `${entity.label}: source absent`, entityIds: [key], evidenceIds: [entity.evidenceId], at })
      }
      observed.set(key, entity)
    }
    store.entities = [...observed.values()].slice(-LIMITS.entities)
    if (!partial) store.habits = (Array.isArray(snapshot.habits) ? snapshot.habits : []).slice(-80).map(habit => ({ id: clip(habit.id, 420), source: clip(habit.source, 80), objectId: clip(habit.objectId, 240), label: clip(habit.label, 240), area: clip(habit.area, 120), kind: clip(habit.kind, 120), value: valueOf(habit.value), status: clip(habit.status, 40), dayType: clip(habit.dayType, 40), averageMinuteOfDay: Number(habit.averageMinuteOfDay), deviationMinutes: Number(habit.deviationMinutes) || 0, confidence: Number(habit.confidence) || 0, userOverride: habit.userOverride ? { dayType: clip(habit.userOverride.dayType, 40), timeMinute: habit.userOverride.timeMinute, value: valueOf(habit.userOverride.value) } : null }))
    store.updatedAt = iso(at)
  }
  const checkExpectations = (at, finalize = true) => {
    const today = localDay(at)
    const weekend = [0, 6].includes(new Date(at).getDay())
    for (const habit of store.habits) {
      if (habit.status !== 'confirmed' || !habit.id || !habit.objectId || !habit.source) continue
      const override = habit.userOverride || {}
      const dayType = override.dayType || habit.dayType
      if (dayType === 'weekday' && weekend) continue
      if (dayType === 'weekend' && !weekend) continue
      const minute = override.timeMinute !== null && override.timeMinute !== undefined && override.timeMinute !== '' ? Number(override.timeMinute) : habit.averageMinuteOfDay
      if (!Number.isFinite(minute) || minute < 0 || minute > 1439) continue
      const key = `${habit.id}:${today}`
      if (store.expectations.some(item => item.id === key)) continue
      const expected = new Date(at)
      expected.setHours(Math.floor(minute / 60), Math.round(minute % 60), 0, 0)
      const grace = Math.max(5, Math.min(60, habit.deviationMinutes * 2)) * MINUTE
      store.expectations.push({ id: key, habitId: habit.id, entityId: entityKey(habit), expectedValue: override.value || habit.value, windowStartAt: iso(expected.getTime() - grace), dueAt: iso(expected.getTime() + grace), status: 'pending', createdAt: iso(at) })
    }
    for (const expectation of store.expectations) {
      if (expectation.status !== 'pending') continue
      const entity = store.entities.find(item => item.id === expectation.entityId)
      const start = stamp(expectation.windowStartAt)
      const deadline = stamp(expectation.dueAt)
      if (entity && entity.fresh && entity.value === expectation.expectedValue && stamp(entity.observedAt) >= start && stamp(entity.observedAt) <= deadline) {
        expectation.status = 'observed'
        expectation.evidenceId = entity.evidenceId
        continue
      }
      if (!finalize || at < deadline) continue
      const unknown = !entity || !entity.fresh || stamp(entity.observedAt) < start
      expectation.status = unknown ? 'unknown' : 'missed'
      const summary = unknown ? 'Expected routine cannot be checked because fresh source evidence is unavailable.' : `Expected routine value ${expectation.expectedValue} was not observed in its time window; current value ${entity.value}. This is a deviation, not an instruction to perform the habit.`
      expectation.evidenceId = addEvidence(unknown ? 'expectation_unknown' : 'expected_event_missing', entity || { id: expectation.entityId }, summary, at, { expectationId: expectation.id, expectedValue: expectation.expectedValue })
      openSituation({ key: `expectation:${expectation.id}`, kind: unknown ? 'expectation_unknown' : 'missed_expectation', summary, entityIds: [expectation.entityId], evidenceIds: [expectation.evidenceId, ...(entity ? [entity.evidenceId] : [])], at })
    }
  }
  const verify = at => {
    for (const situation of store.situations) {
      if (!['claimed', 'verifying'].includes(situation.status) || !situation.claim) continue
      if (situation.claim.disposition === 'notify') {
        resolve(situation, 'delivery_unknown', 'Notification had a durable claim but no recorded completion; it will not be sent again.', at)
        continue
      }
      situation.status = 'verifying'
      const entity = situation.expected && store.entities.find(item => item.id === entityKey(situation.expected))
      const freshFeedback = entity && entity.fresh && stamp(entity.verifiedAt) > stamp(situation.claim.at) && stamp(entity.verifiedAt) > stamp(situation.claim.previousVerifiedAt)
      if (freshFeedback && entity.value === valueOf(situation.expected.value)) {
        const evidenceId = addEvidence('action_feedback', entity, 'Fresh device feedback confirmed the expected action result.', at, { value: entity.value })
        situation.evidenceIds.push(evidenceId)
        resolve(situation, 'verified', 'Command result confirmed by a subsequent fresh device state.', at)
      } else if (at >= stamp(situation.claim.verifyBy)) {
        const outcome = freshFeedback ? 'action_mismatch' : 'action_unverified'
        const evidenceId = addEvidence(outcome, entity, freshFeedback ? 'Fresh feedback differs from the requested result.' : 'No fresh device feedback confirmed the command.', at)
        situation.evidenceIds.push(evidenceId)
        resolve(situation, outcome, 'Verification deadline elapsed; command will not be replayed automatically.', at)
        openSituation({ key: `followup:${situation.id}`, kind: outcome, summary: `${situation.summary}: ${outcome}. Inspect before deciding any further action.`, entityIds: [...situation.entityIds], evidenceIds: [...situation.evidenceIds], at, dueAt: at + 10 * MINUTE })
      }
    }
  }
  const validate = (decision, situation, at) => {
    if (!decision || !['observe', 'resolve', 'notify', 'act'].includes(decision.disposition)) throw new Error('Invalid autonomy disposition')
    if (!Array.isArray(decision.evidenceIds) || decision.evidenceIds.length > 32) throw new Error('Decision requires bounded evidence IDs')
    const known = new Map(store.evidence.map(item => [item.id, item]))
    if (decision.evidenceIds.some(item => typeof item !== 'string' || !known.has(item))) throw new Error('Decision contains unknown evidence IDs')
    if (decision.disposition !== 'observe' && !decision.evidenceIds.length) throw new Error('Decision requires evidence')
    if (decision.evidenceIds.some(item => known.get(item).entityId && !situation.entityIds.includes(known.get(item).entityId))) throw new Error('Decision cites evidence outside its situation')
    if (decision.disposition === 'act') {
      if (situation.goalId && !store.goals.some(goal => goal.id === situation.goalId && goal.status === 'active')) throw new Error('Comfort goal is no longer active')
      if (!decision.action || !decision.expected) throw new Error('Action requires a target and expected feedback')
      for (const target of [decision.action, decision.expected]) {
        if (!target.source || !target.objectId || target.value === undefined || target.value === null) throw new Error('Invalid action or expectation target')
        const entity = store.entities.find(item => item.id === entityKey(target))
        if (!entity || !situation.entityIds.includes(entity.id) || !entity.fresh || !isFresh(entity, at)) throw new Error('Action target is unknown, stale, or outside its situation')
        if (!decision.evidenceIds.includes(entity.evidenceId)) throw new Error('Action must cite the current target state evidence')
      }
      if (decision.evidenceIds.some(item => { const entity = store.entities.find(entity => entity.id === known.get(item).entityId); return entity && !entity.fresh })) throw new Error('Action relies on stale source evidence')
    }
    return { disposition: decision.disposition, summary: clip(decision.summary, 1200), nextCheckSeconds: Math.max(60, Math.min(86400, Number(decision.nextCheckSeconds) || 900)), evidenceIds: [...new Set(decision.evidenceIds)], action: decision.action ? { source: clip(decision.action.source, 80), objectId: clip(decision.action.objectId, 240), value: copy(decision.action.value) } : null, expected: decision.expected ? { source: clip(decision.expected.source, 80), objectId: clip(decision.expected.objectId, 240), value: copy(decision.expected.value) } : null }
  }
  const comfort = createCerebrumComfortGoals({ store, id, persist, openSituation, research, researchEnabled: () => !closed && enabled() && researchEnabled(), now })
  const drainObservations = (at, habits = store.habits) => {
    if (!pendingStates.length) return
    const entries = pendingStates.slice().sort((a, b) => stamp(a.state.observedAt) - stamp(b.state.observedAt) || a.sequence - b.sequence)
    // Replay at the original observation time: a restart hours later must not
    // turn a received, timely transition into an unknown/stale measurement.
    observe({ states: store.entities, habits }, Math.min(at, stamp(entries[0].state.observedAt)), false)
    for (const entry of entries) {
      const observedAt = Math.min(at, stamp(entry.state.observedAt))
      checkExpectations(observedAt, false)
      observe({ states: [entry.state] }, observedAt, true)
      checkExpectations(observedAt, false)
    }
    store.observationSequence = Math.max(store.observationSequence, ...entries.map(entry => entry.sequence))
    pendingStates = []
    journalNeedsCompaction = true
    // The latest state still needs a current freshness assessment. Replaying
    // historical evidence does not authorize an action on an old sensor value.
    observe({ states: store.entities, habits }, at, false)
    checkExpectations(at, false)
  }
  const worldSnapshot = () => ({ ...copy(store), patterns: summarizeBehaviorPatterns(store.patterns, now()) })
  const runTick = async () => {
    if (closed) return { ok: false, status: 'closed' }
    try {
      if (journalFailed) throw new Error('Observation journal save failed; autonomous effects remain paused')
      let at = now()
      const incoming = await readSnapshot()
      if (closed) return { ok: true, status: 'cancelled' }
      at = now()
      // Create today's expectations before replaying queued transitions; a brief
      // on/off event must still count even if the final snapshot is already off.
      drainObservations(at, incoming.habits)
      observe(incoming, at)
      checkExpectations(at)
      verify(at)
      comfort.schedule(at)
      store.lastTickAt = iso(at)
      if (store.lastDailyAt !== localDay(at)) {
        const entities = store.entities.filter(item => item.fresh).slice(0, 40)
        const evidenceId = addEvidence('review_due', null, 'Daily review is due. Review observed state and open expectations; do not infer missing facts.', at)
        openSituation({ key: `daily:${localDay(at)}`, kind: 'daily_review', summary: 'Daily comfort review: compare behaviour across days, review self-generated goals and find measurable improvements for occupants. Prefer comfort and easy manual control over energy savings. Retire unhelpful hypotheses.', entityIds: entities.map(item => item.id), evidenceIds: [evidenceId, ...entities.slice(0, 24).map(item => item.evidenceId)], at })
        store.lastDailyAt = localDay(at)
      }
      persist()
      if (!enabled()) return { ok: true, status: 'disabled' }
      if (at - stamp(store.lastReasonAt) < MINUTE || store.reasonHistory.length >= LIMITS.reasonsPerHour) return { ok: true, status: 'rate_limited' }
      const situation = store.situations.filter(item => item.status === 'open' && stamp(item.dueAt) <= at).sort((a, b) => stamp(a.dueAt) - stamp(b.dueAt))[0]
      if (!situation) return { ok: true, status: 'idle' }
      if (situation.kind === 'goal_action_review' && !store.goals.some(goal => goal.id === situation.goalId && goal.status === 'active')) {
        resolve(situation, 'goal_inactive', 'Comfort plan paused or retired; no action evaluation is needed.', at)
        persist()
        return { ok: true, status: 'goal_inactive' }
      }
      store.lastReasonAt = iso(at)
      store.reasonHistory.push(iso(at))
      situation.lastReasonAt = iso(at)
      // Reserve attention before awaiting the model, including failed requests.
      situation.dueAt = iso(at + 15 * MINUTE)
      persist()
      const answer = await reason({ world: worldSnapshot(), situation: copy(situation), research: comfort.requestResearch })
      if (closed || !enabled()) return { ok: true, status: 'cancelled' }
      at = now()
      const latest = await readSnapshot()
      if (closed || !enabled()) return { ok: true, status: 'cancelled' }
      if (journalFailed) throw new Error('Observation journal save failed; autonomous effects remain paused')
      at = now()
      drainObservations(at, latest.habits)
      observe(latest, at)
      const decision = validate(answer, situation, at)
      const goalId = comfort.applyUpdate(answer.goalUpdate, at)
      if (goalId) {
        situation.goalId = goalId
        episode(situation, 'goal_reviewed', `Self-generated comfort goal ${goalId}: ${store.goals.find(goal => goal.id === goalId).assessment}`, at)
      }
      situation.summary = decision.summary || situation.summary
      situation.evidenceIds = [...new Set([...situation.evidenceIds, ...decision.evidenceIds])].slice(-32)
      situation.updatedAt = iso(at)
      if (decision.disposition === 'resolve') resolve(situation, 'resolved', decision.summary, at)
      else if (decision.disposition === 'observe') {
        situation.dueAt = iso(at + decision.nextCheckSeconds * 1000)
        episode(situation, 'observing', decision.summary, at)
      } else {
        const targetId = decision.action ? entityKey(decision.action) : `notification:${situation.key}`
        const effects = store.actionHistory.filter(item => at - stamp(item.at) < HOUR)
        if (effects.length >= LIMITS.effectsPerHour || effects.some(item => item.targetId === targetId && at - stamp(item.at) < 30 * MINUTE)) {
          situation.dueAt = iso(at + 30 * MINUTE)
          persist()
          return { ok: true, status: 'effect_rate_limited' }
        }
        if (decision.disposition === 'act' && typeof execute !== 'function') throw new Error('Autonomous execution is unavailable')
        if (decision.disposition === 'notify' && typeof notify !== 'function') throw new Error('Autonomous notification is unavailable')
        const expectedEntity = decision.expected && store.entities.find(item => item.id === entityKey(decision.expected))
        const claim = { id: id('claim'), situationId: situation.id, goalId: situation.goalId || '', requestedValue: decision.action ? valueOf(decision.action.value) : '', at: iso(at), disposition: decision.disposition, targetId, status: 'claimed', verifyBy: iso(at + Math.max(2 * MINUTE, Math.min(10 * MINUTE, decision.nextCheckSeconds * 1000))), previousVerifiedAt: (expectedEntity && expectedEntity.verifiedAt) || iso(0) }
        situation.claim = claim
        situation.expected = decision.expected
        situation.status = 'claimed'
        store.actionHistory.push({ ...claim })
        // No callback that can affect the house runs before this durable claim.
        persist()
        if (closed || !enabled()) {
          resolve(situation, 'cancelled', 'Autonomy disabled before the effect.', now())
          persist()
          return { ok: true, status: 'cancelled' }
        }
        try {
          if (decision.disposition === 'notify') {
            const delivered = await notify({ text: decision.summary, situation: copy(situation) })
            resolve(situation, delivered ? 'notified' : 'notification_failed', decision.summary, now())
          } else {
            const result = await execute({ decision: copy(decision), situation: copy(situation) })
            situation.status = 'verifying'
            situation.executionResult = { ok: !(result === false || (result && result.ok === false)), detail: clip(result && (result.error || result.summary || result.status), 800) }
            episode(situation, 'verification_pending', decision.summary, now())
          }
        } catch (error) {
          if (error.noEffect === true) resolve(situation, 'action_rejected', clip(error.message), now())
          else if (decision.disposition === 'notify') resolve(situation, 'delivery_unknown', clip(error.message), now())
          else {
            situation.status = 'verifying'
            situation.executionResult = { ok: false, detail: clip(error.message, 800) }
            episode(situation, 'execution_uncertain', 'Execution callback failed; verify device feedback without replaying the command.', now())
          }
          report(error)
        }
      }
      persist()
      return { ok: true, status: situation.status, situationId: situation.id, disposition: decision.disposition }
    } catch (error) {
      report(error)
      try { persist() } catch (persistError) { report(persistError) }
      return { ok: false, status: 'error', error: store.lastError }
    }
  }
  return {
    tick: () => {
      if (inFlight) return inFlight
      inFlight = runTick().finally(() => { inFlight = null })
      return inFlight
    },
    ingestState: state => {
      if (closed || !state || !state.source || !state.objectId || !Number.isFinite(stamp(state.observedAt))) return false
      if (journalFailed) return false
      let fd
      try {
        const sequence = nextObservationSequence + 1
        if (!Number.isSafeInteger(sequence)) throw new Error('Autonomy observation sequence exhausted')
        const entry = { sequence, state: normalizeObservation(state) }
        const content = JSON.stringify(entry) + '\n'
        const bytes = Buffer.byteLength(content, 'utf8')
        if (pendingStates.length >= LIMITS.evidence || journalBytes + bytes > MAX_JOURNAL_BYTES) {
          // A long LLM/network request cannot cause a full queue to drop state
          // transitions: compact locally without making another model call.
          drainObservations(now())
          persist()
        } else if (journalNeedsCompaction) persist()
        fs.mkdirSync(path.dirname(journalPath), { recursive: true })
        const existed = fs.existsSync(journalPath)
        fd = fs.openSync(journalPath, 'a', 0o600)
        fs.writeFileSync(fd, content, 'utf8')
        fs.fsyncSync(fd)
        fs.closeSync(fd)
        fd = undefined
        if (!existed) syncDirectory(path.dirname(journalPath))
        nextObservationSequence = sequence
        journalBytes += bytes
        pendingStates.push(entry)
        return true
      } catch (error) {
        if (fd !== undefined) { try { fs.closeSync(fd) } catch (_) {} }
        // Do not append after a possibly partial write or dispatch effects with
        // an incomplete local history. The existing files remain recoverable.
        journalFailed = true
        report(`Autonomy observation persistence failed; effects paused: ${error.message}`)
        return false
      }
    },
    snapshot: worldSnapshot,
    query: options => queryCerebrumWorldMemory({ world: worldSnapshot(), ...options }),
    checkpoint: () => {
      drainObservations(now())
      persist()
    },
    reset: () => {
      if (inFlight) throw new Error('Cannot reset autonomy while a tick is running')
      drainObservations(now())
      // Reset derived attention only. Durable effects remain to prevent replay.
      store.situations = store.situations.filter(item => ['claimed', 'verifying'].includes(item.status))
      store.episodes = []
      store.goals = []
      store.patterns = []
      store.knowledge = []
      store.lastDailyAt = ''
      store.lastError = ''
      persist()
      return copy(store)
    },
    close: async () => {
      closed = true
      const errors = []
      // Node-RED may enforce its shutdown timeout before a provider responds.
      // Save all accepted observations BEFORE waiting for outstanding network
      // work, then save any completion/verification result once it settles.
      try {
        drainObservations(now())
        persist()
      } catch (error) { errors.push(error) }
      // A failed checkpoint must not let an import/restart proceed while the
      // old tick can still complete and write to the same persistence files.
      try {
        if (inFlight) await inFlight
      } catch (error) { errors.push(error) }
      try { persist() } catch (error) { errors.push(error) }
      if (errors.length === 1) throw errors[0]
      if (errors.length > 1) throw new AggregateError(errors, `Autonomy close failed: ${[...new Set(errors.map(error => error.message || String(error)))].join('; ')}`)
      return copy(store)
    }
  }
}

module.exports = { createCerebrumAutonomy, validateCerebrumAutonomyStore, validateCerebrumObservationJournal, observationJournalPath, CEREBRUM_AUTONOMY_LIMITS: LIMITS }
