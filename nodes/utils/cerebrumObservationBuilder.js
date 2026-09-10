'use strict'

const crypto = require('crypto')
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/g // eslint-disable-line no-control-regex

const cleanText = (value, max = 500) => String(value === undefined || value === null ? '' : value)
  .replace(CONTROL_CHARACTERS, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, max)

const cleanList = (value, max = 24) => Array.from(new Set((Array.isArray(value) ? value : [value])
  .map(item => cleanText(item, 600))
  .filter(Boolean)))
  .slice(0, max)

const normalizeAt = value => {
  const date = new Date(value || Date.now())
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

const valueText = value => {
  if (typeof value === 'string') return cleanText(value, 500)
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  try { return cleanText(JSON.stringify(value), 500) } catch (error) { return '[unavailable]' }
}

const buildObservationId = value => `observation:${crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 32)}`

/** Build a typed, evidence-linked observation without invoking an LLM. */
const buildCerebrumObservation = (input = {}) => {
  const source = cleanText(input.source || input.adapterId || 'unknown', 120)
  const objectId = cleanText(input.objectId || input.entityId || input.cameraId || input.resourceId, 240)
  const event = cleanText(input.event || input.eventType || 'state_changed', 120)
  if (!objectId || !event) return null
  const at = normalizeAt(input.at)
  const value = valueText(input.value !== undefined ? input.value : input.state)
  const previousValue = input.previousValue !== undefined || input.previousState !== undefined
    ? valueText(input.previousValue !== undefined ? input.previousValue : input.previousState)
    : ''
  const semanticId = cleanText(input.semanticId, 600)
  const nativeEntityId = `${source}:${objectId}`
  const evidenceIds = cleanList(input.evidenceIds || input.evidenceId, 32)
  const label = cleanText(input.label || input.resourceName || input.cameraName || objectId, 240)
  const transition = previousValue && previousValue !== value ? `${previousValue} → ${value}` : value || event
  const identity = { source, objectId, semanticId, event, at, value, previousValue, evidenceIds }
  return {
    id: buildObservationId(identity),
    type: cleanText(input.type || (previousValue && previousValue !== value ? 'state_transition' : 'integration_event'), 120),
    status: 'observed',
    hypothesis: false,
    at,
    startedAt: at,
    endedAt: at,
    source,
    adapterId: cleanText(input.adapterId, 120),
    providerId: cleanText(input.providerId, 200),
    objectId,
    entityId: nativeEntityId,
    semanticId,
    entityIds: cleanList([nativeEntityId, semanticId]),
    evidenceIds,
    event,
    label,
    area: cleanText(input.area, 160),
    kind: cleanText(input.kind || input.resourceType, 120),
    capability: cleanText(input.capability, 120),
    unit: cleanText(input.unit, 80),
    value,
    previousValue,
    confidence: Math.max(0, Math.min(1, Number(input.confidence) || 0)),
    summary: cleanText(`${label}: ${event}${transition ? ` (${transition})` : ''}`, 800)
  }
}

/**
 * Correlate already observed facts into bounded episodes. Correlation adds a
 * derived record and never rewrites the original observations or their proof.
 */
const correlateCerebrumObservations = (value, { windowMs = 5000, maxEpisodes = 120 } = {}) => {
  const observations = (Array.isArray(value) ? value : [])
    .filter(item => item && item.status === 'observed' && Number.isFinite(Date.parse(item.at || '')))
    .sort((left, right) => Date.parse(left.at) - Date.parse(right.at))
  const groups = []
  const window = Math.max(0, Number(windowMs) || 0)
  observations.forEach(observation => {
    const area = cleanText(observation.area, 160)
    const entityIds = new Set(cleanList(observation.entityIds || observation.entityId, 40))
    const observedAt = Date.parse(observation.at)
    let related
    // Groups are created in timestamp order. Once the start is outside the
    // correlation window, every earlier group is outside it too.
    for (let index = groups.length - 1; index >= 0; index--) {
      const group = groups[index]
      if (observedAt - group.startedTs > window) break
      if ((area && group.area && area === group.area) || [...entityIds].some(id => group.entityIds.has(id))) {
        related = group
        break
      }
    }
    if (!related) {
      groups.push({ area, entityIds, observations: [observation], startedTs: observedAt, startedAt: observation.at, endedAt: observation.at })
      return
    }
    related.observations.push(observation)
    related.endedAt = observation.at
    entityIds.forEach(id => related.entityIds.add(id))
    if (!related.area && area) related.area = area
  })
  return groups.filter(group => group.observations.length > 1).slice(-Math.max(1, Math.min(500, Number(maxEpisodes) || 120))).map(group => {
    const entityIds = cleanList(group.observations.flatMap(item => item.entityIds), 40)
    const evidenceIds = cleanList(group.observations.flatMap(item => item.evidenceIds), 40)
    return {
      id: buildObservationId({ type: 'correlated_episode', anchorObservationId: group.observations[0].id, area: group.area }),
      type: 'correlated_episode',
      status: 'derived',
      hypothesis: false,
      origin: 'deterministic-observation-correlation',
      at: group.endedAt,
      area: group.area,
      startedAt: group.startedAt,
      endedAt: group.endedAt,
      sources: cleanList(group.observations.map(item => item.source), 16),
      entityIds,
      evidenceIds,
      observationIds: group.observations.map(item => item.id).slice(-40),
      confidence: evidenceIds.length > 0 ? 1 : 0.8,
      importance: Math.min(1, 0.35 + group.observations.length * 0.1 + Math.max(0, new Set(group.observations.map(item => item.source)).size - 1) * 0.15),
      summary: cleanText(`${group.observations.length} related observations${group.area ? ` in ${group.area}` : ''}: ${group.observations.slice(0, 3).map(item => item.summary || item.label || item.event).filter(Boolean).join('; ')}`, 800)
    }
  })
}

module.exports = {
  buildCerebrumObservation,
  correlateCerebrumObservations
}
