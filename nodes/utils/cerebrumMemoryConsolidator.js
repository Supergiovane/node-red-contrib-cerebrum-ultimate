'use strict'

const { correlateCerebrumObservations } = require('./cerebrumObservationBuilder')

const CEREBRUM_HOME_EPISODE_MAX_ITEMS = 160
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]+/g // eslint-disable-line no-control-regex

const text = (value, max = 800) => String(value === undefined || value === null ? '' : value)
  .replace(CONTROL_CHARACTERS, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, max)

const list = (value, max = 80) => Array.from(new Set((Array.isArray(value) ? value : [value])
  .map(item => text(item, 600))
  .filter(Boolean)))
  .slice(-max)

const timestamp = value => Date.parse(value || '') || 0
const iso = value => {
  const parsed = timestamp(value)
  return parsed > 0 ? new Date(parsed).toISOString() : ''
}

const normalizeCerebrumEpisode = value => {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  const id = text(source.id, 200)
  const startedAt = iso(source.startedAt || source.at)
  const endedAt = iso(source.endedAt || source.at || source.startedAt)
  if (!id || !startedAt || !endedAt) return null
  return {
    id,
    type: text(source.type || 'episode', 120),
    status: text(source.status || 'derived', 40),
    hypothesis: source.hypothesis === true,
    origin: text(source.origin || 'unknown', 120),
    at: endedAt,
    area: text(source.area, 160),
    startedAt: timestamp(startedAt) <= timestamp(endedAt) ? startedAt : endedAt,
    endedAt: timestamp(startedAt) <= timestamp(endedAt) ? endedAt : startedAt,
    sources: list(source.sources || source.source, 16),
    entityIds: list(source.entityIds || source.entityId, 80),
    evidenceIds: list(source.evidenceIds || source.evidenceId, 80),
    observationIds: list(source.observationIds || source.observationId, 80),
    confidence: Math.max(0, Math.min(1, Number(source.confidence) || 0)),
    importance: Math.max(0, Math.min(1, Number(source.importance) || 0)),
    summary: text(source.summary, 1200),
    createdAt: iso(source.createdAt || startedAt),
    updatedAt: iso(source.updatedAt || endedAt)
  }
}

const normalizeCerebrumEpisodes = (value, maxEpisodes = CEREBRUM_HOME_EPISODE_MAX_ITEMS) => {
  const byId = new Map()
  ;(Array.isArray(value) ? value : []).forEach(value => {
    const episode = normalizeCerebrumEpisode(value)
    if (episode) byId.set(episode.id, episode)
  })
  return Array.from(byId.values())
    .sort((left, right) => timestamp(left.endedAt) - timestamp(right.endedAt))
    .slice(-Math.max(1, Math.min(500, Number(maxEpisodes) || CEREBRUM_HOME_EPISODE_MAX_ITEMS)))
}

const episodeFingerprint = episode => JSON.stringify({
  area: episode.area,
  startedAt: episode.startedAt,
  endedAt: episode.endedAt,
  sources: episode.sources,
  entityIds: episode.entityIds,
  evidenceIds: episode.evidenceIds,
  observationIds: episode.observationIds,
  summary: episode.summary
})

const mergeEpisode = (existing, candidate, now) => {
  const observationIds = list([...(existing.observationIds || []), ...(candidate.observationIds || [])], 80)
  const area = candidate.area || existing.area
  const candidateDetail = text(candidate.summary, 1200).replace(/^\d+ related observations(?: in [^:]+)?:?\s*/i, '')
  return normalizeCerebrumEpisode({
    ...existing,
    ...candidate,
    id: existing.id,
    area,
    startedAt: timestamp(existing.startedAt) <= timestamp(candidate.startedAt) ? existing.startedAt : candidate.startedAt,
    endedAt: timestamp(existing.endedAt) >= timestamp(candidate.endedAt) ? existing.endedAt : candidate.endedAt,
    sources: list([...(existing.sources || []), ...(candidate.sources || [])], 16),
    entityIds: list([...(existing.entityIds || []), ...(candidate.entityIds || [])], 80),
    evidenceIds: list([...(existing.evidenceIds || []), ...(candidate.evidenceIds || [])], 80),
    observationIds,
    confidence: Math.max(Number(existing.confidence) || 0, Number(candidate.confidence) || 0),
    importance: Math.max(Number(existing.importance) || 0, Number(candidate.importance) || 0),
    summary: `${observationIds.length} related observations${area ? ` in ${area}` : ''}${candidateDetail ? `: ${candidateDetail}` : ''}`,
    createdAt: existing.createdAt || candidate.createdAt,
    updatedAt: now
  })
}

/** Project immutable observations into durable episodes without deleting either. */
const consolidateCerebrumEpisodes = ({ episodes, observations, windowMs = 5000, maxEpisodes = CEREBRUM_HOME_EPISODE_MAX_ITEMS, now = new Date().toISOString() } = {}) => {
  const current = normalizeCerebrumEpisodes(episodes, maxEpisodes)
  const candidates = normalizeCerebrumEpisodes(correlateCerebrumObservations(observations, { windowMs, maxEpisodes }), maxEpisodes)
  const changedEpisodes = []
  candidates.forEach(candidate => {
    const observationIds = new Set(candidate.observationIds)
    const index = current.findIndex(existing => existing.id === candidate.id || existing.observationIds.some(id => observationIds.has(id)))
    if (index < 0) {
      const created = normalizeCerebrumEpisode({ ...candidate, createdAt: now, updatedAt: now })
      current.push(created)
      changedEpisodes.push(created)
      return
    }
    const previous = current[index]
    const merged = mergeEpisode(previous, candidate, now)
    if (episodeFingerprint(previous) !== episodeFingerprint(merged)) {
      current[index] = merged
      changedEpisodes.push(merged)
    }
  })
  return {
    episodes: normalizeCerebrumEpisodes(current, maxEpisodes),
    changedEpisodes: normalizeCerebrumEpisodes(changedEpisodes, maxEpisodes)
  }
}

const learnedIdentity = item => text(item && (item.semanticId || (item.source && item.objectId ? `${item.source}:${item.objectId}` : item.entityId)), 600)
const dayTypesOverlap = (habit, pattern) => {
  const habitDay = text(habit && habit.dayType, 40)
  const patternDay = text(pattern && pattern.dayType, 40)
  return habitDay === 'everyday' || !habitDay || !patternDay || habitDay === patternDay
}

/** Link the two established learned views while retaining their public shapes. */
const linkCerebrumLearnedMemory = ({ habits, patterns } = {}) => {
  const linkedHabits = (Array.isArray(habits) ? habits : []).map(habit => ({ ...habit, relatedPatternIds: [] }))
  const linkedPatterns = (Array.isArray(patterns) ? patterns : []).map(pattern => ({ ...pattern, relatedHabitIds: [] }))
  linkedHabits.forEach(habit => {
    const identity = learnedIdentity(habit)
    if (!identity) return
    const overrideMinute = habit.userOverride && habit.userOverride.timeMinute !== null && habit.userOverride.timeMinute !== undefined && String(habit.userOverride.timeMinute).trim() !== ''
    const minute = Number(overrideMinute ? habit.userOverride.timeMinute : habit.averageMinuteOfDay)
    linkedPatterns.forEach(pattern => {
      if (learnedIdentity(pattern) !== identity || !dayTypesOverlap(habit, pattern)) return
      const patternMinute = Number(pattern.hour) * 60 + 30
      const timeDistance = Math.abs(minute - patternMinute)
      if (Number.isFinite(minute) && Number.isFinite(patternMinute) && Math.min(timeDistance, 1440 - timeDistance) > 90) return
      const patternId = text(pattern.id, 200)
      const habitId = text(habit.id, 420)
      if (patternId) habit.relatedPatternIds.push(patternId)
      if (habitId) pattern.relatedHabitIds.push(habitId)
    })
  })
  return { habits: linkedHabits, patterns: linkedPatterns }
}

module.exports = {
  CEREBRUM_HOME_EPISODE_MAX_ITEMS,
  consolidateCerebrumEpisodes,
  linkCerebrumLearnedMemory,
  normalizeCerebrumEpisode,
  normalizeCerebrumEpisodes
}
