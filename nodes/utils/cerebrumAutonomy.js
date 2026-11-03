// The autonomous world-model engine was retired on 2026-09-11. These validators
// keep legacy autonomy checkpoints and observation journals readable for
// backup, restore and advanced inspection; nothing here resumes that work.
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
const iso = value => new Date(value).toISOString()
const stamp = value => typeof value === 'number' ? value : Date.parse(value || '')
const valueOf = value => typeof value === 'object' && value !== null ? clip(JSON.stringify(value)) : clip(value)
const normalizeObservation = state => ({
  source: clip(state.source, 80),
  objectId: clip(state.objectId, 240),
  semanticId: clip(state.semanticId, 600),
  label: clip(state.label || state.objectId, 240),
  area: clip(state.area, 120),
  kind: clip(state.kind, 120),
  capability: clip(state.capability, 120),
  unit: clip(state.unit, 80),
  access: clip(state.access, 80),
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

module.exports = { validateCerebrumAutonomyStore, validateCerebrumObservationJournal, observationJournalPath, CEREBRUM_AUTONOMY_LIMITS: LIMITS }
