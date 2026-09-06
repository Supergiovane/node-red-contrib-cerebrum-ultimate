'use strict'

const crypto = require('crypto')

const MAX_PATTERNS = 240
const MAX_DAYS = 28
const MAX_CATEGORIES = 8
const MAX_ORIGINS = 8
const MAX_SAME_TIME_TRANSITIONS = 8
const MAX_DAILY_OCCURRENCES = 1000000
const MISSING_VALUES = new Set(['', 'unknown', 'unavailable', 'undefined', 'null', 'nan'])
// Deliberately remove control characters from retained labels.
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/g // eslint-disable-line no-control-regex

const text = (value, limit = 160) => String(value === undefined || value === null ? '' : value)
  .replace(CONTROL_CHARACTERS, ' ')
  .trim()
  .slice(0, limit)
const timestamp = value => {
  if (value === undefined || value === null || value === '') return NaN
  const parsed = value instanceof Date ? value.getTime() : typeof value === 'number' ? value : Date.parse(value)
  return Number.isFinite(parsed) ? parsed : NaN
}
const count = (value, maximum = MAX_DAILY_OCCURRENCES) => Number.isSafeInteger(value) && value >= 0 ? Math.min(maximum, value) : 0
const hash = value => crypto.createHash('sha256').update(value).digest('hex').slice(0, 32)
const localDay = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
const dayType = date => [0, 6].includes(date.getDay()) ? 'weekend' : 'weekday'
const scalar = value => {
  if (!['string', 'number', 'boolean'].includes(typeof value)) return null
  if (typeof value === 'number' && !Number.isFinite(value)) return null
  const raw = String(value).trim()
  if (raw.length > 2000 || MISSING_VALUES.has(raw.toLowerCase())) return null
  return raw
}
const numeric = value => {
  // Empty strings, booleans, partial numbers and JSON values are not measurements.
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value)) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}
const windowAt = at => {
  const supplied = timestamp(at)
  const now = Number.isFinite(supplied) ? supplied : Date.now()
  const end = new Date(now)
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  start.setDate(start.getDate() - MAX_DAYS + 1)
  return { now, start: start.getTime(), from: localDay(start), to: localDay(end) }
}
const validDay = value => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T12:00:00`)
  return Number.isFinite(date.getTime()) && localDay(date) === value
}

// Only daily sufficient statistics are retained. Category names are stored once
// per bucket; daily arrays contain counts, keeping 240 x 28 days compact.
const normalizePatterns = (patterns, window) => {
  const result = []
  const seen = new Set()
  for (const source of Array.isArray(patterns) ? patterns : []) {
    if (!source || typeof source !== 'object' || !source.entityId ||
        !['weekday', 'weekend'].includes(source.dayType) || !Number.isInteger(source.hour) || source.hour < 0 || source.hour > 23) continue
    const entityId = text(source.entityId, 360)
    const id = `pattern-${hash(JSON.stringify([entityId, source.dayType, source.hour]))}`
    if (seen.has(id)) continue
    const categories = (Array.isArray(source.categories) ? source.categories : []).slice(0, MAX_CATEGORIES)
      .map(item => ({ key: text(item && item.key, 32), value: text(item && item.value, 120) }))
    const days = []
    const seenDays = new Set()
    for (const daily of Array.isArray(source.days) ? source.days : []) {
      const date = text(daily && daily.date, 10)
      if (!daily || !validDay(date) || date < window.from || date > window.to || seenDays.has(date)) continue
      const occurrences = count(daily.occurrences)
      const first = timestamp(daily.firstObserved)
      const last = timestamp(daily.lastObserved)
      if (!occurrences || !Number.isFinite(first) || !Number.isFinite(last) || first > last ||
          localDay(new Date(first)) !== date || localDay(new Date(last)) !== date) continue
      const samples = daily.numeric
      const validNumeric = samples && count(samples.count) > 0 && samples.count <= occurrences &&
        [samples.min, samples.max, samples.mean].every(value => typeof value === 'number' && Number.isFinite(value)) &&
        samples.min <= samples.mean && samples.mean <= samples.max
      days.push({
        date,
        occurrences,
        firstObserved: new Date(first).toISOString(),
        lastObserved: new Date(last).toISOString(),
        numeric: validNumeric ? { count: count(samples.count), min: samples.min, max: samples.max, mean: samples.mean } : null,
        categoryCounts: categories.map((_, index) => Math.min(occurrences, count(daily.categoryCounts && daily.categoryCounts[index]))),
        unlistedValues: Math.min(occurrences, count(daily.unlistedValues)),
        capped: daily.capped === true
      })
      seenDays.add(date)
    }
    days.sort((left, right) => left.date.localeCompare(right.date))
    if (!days.length) continue
    const retainedDays = days.slice(-MAX_DAYS)
    const activeCategories = categories.map((item, index) => ({ item, index }))
      .filter(({ index }) => retainedDays.some(daily => daily.categoryCounts[index] > 0))
    retainedDays.forEach(daily => {
      daily.categoryCounts = activeCategories.map(({ index }) => daily.categoryCounts[index])
    })
    const firstObserved = retainedDays[0].firstObserved
    const lastObserved = retainedDays[retainedDays.length - 1].lastObserved
    const originObservations = (Array.isArray(source.originObservations) ? source.originObservations : [])
      .filter(item => item && Number.isFinite(timestamp(item.at)) && timestamp(item.at) >= window.start && timestamp(item.at) <= window.now)
      .sort((left, right) => timestamp(left.at) - timestamp(right.at))
      .slice(-MAX_ORIGINS)
      .map(item => ({ at: new Date(timestamp(item.at)).toISOString(), value: text(item.value, 120), evidenceId: text(item.evidenceId, 160) }))
    result.push({
      id,
      entityId,
      source: text(source.source, 80),
      objectId: text(source.objectId, 240),
      label: text(source.label || source.objectId || entityId, 160),
      area: text(source.area, 120),
      kind: text(source.kind, 120),
      dayType: source.dayType,
      hour: source.hour,
      categories: activeCategories.map(({ item }) => item),
      days: retainedDays,
      firstObserved,
      lastObserved,
      lastTransitionKeys: (Array.isArray(source.lastTransitionKeys) ? source.lastTransitionKeys : [])
        .filter(key => typeof key === 'string' && /^[0-9a-f]{32}$/.test(key)).slice(-MAX_SAME_TIME_TRANSITIONS),
      originObservations
    })
    seen.add(id)
  }
  return result.sort((left, right) => timestamp(left.lastObserved) - timestamp(right.lastObserved)).slice(-MAX_PATTERNS)
}

const weightedMean = (left, leftCount, right, rightCount) => {
  const total = leftCount + rightCount
  // Subtraction is safe for equal signs; weighted opposing terms avoid an
  // overflowing difference for measurements close to the numeric extremes.
  const mean = Math.sign(left) === Math.sign(right)
    ? left + (right - left) * (rightCount / total)
    : left * (leftCount / total) + right * (rightCount / total)
  return Math.max(Math.min(left, right), Math.min(Math.max(left, right), mean))
}

const addNumeric = (current, value) => {
  if (!current) return { count: 1, min: value, max: value, mean: value }
  const nextCount = current.count + 1
  return {
    count: nextCount,
    min: Math.min(current.min, value),
    max: Math.max(current.max, value),
    mean: weightedMean(current.mean, current.count, value, 1)
  }
}

/**
 * Record an observed transition, never a polling sample or an inferred duration.
 * The caller excludes Cerebrum's own actions. `previous` may be the previous
 * entity or its scalar value; a missing/unknown previous value is not a change.
 * Timestamps use the Node-RED host's local weekday and hour, including DST.
 */
const recordBehaviorTransition = (patterns, { entity, previous, at } = {}) => {
  if (!Array.isArray(patterns)) return patterns
  const window = windowAt(at)
  const retained = normalizePatterns(patterns, window)
  patterns.splice(0, patterns.length, ...retained)
  const value = scalar(entity && entity.value)
  const previousValue = scalar(previous && typeof previous === 'object' ? previous.value : previous)
  const observed = timestamp(entity && entity.observedAt)
  const entityId = text(entity && entity.id, 360)
  if (!entity || entity.fresh !== true || !entityId || String(entity.id).length > 360 || value === null ||
      previousValue === null || value === previousValue || !Number.isFinite(observed) || observed < window.start || observed > window.now) return patterns
  const date = new Date(observed)
  const type = dayType(date)
  const hour = date.getHours()
  const id = `pattern-${hash(JSON.stringify([entityId, type, hour]))}`
  let pattern = patterns.find(item => item.id === id)
  const transitionKey = hash(JSON.stringify([entityId, observed, previousValue, value]))
  // Reject older replayed transitions even after restart. For equal timestamps,
  // retain a small exact set; excess same-millisecond events are not counted.
  if (pattern && (observed < timestamp(pattern.lastObserved) ||
      (observed === timestamp(pattern.lastObserved) &&
       (pattern.lastTransitionKeys.includes(transitionKey) || pattern.lastTransitionKeys.length >= MAX_SAME_TIME_TRANSITIONS)))) return patterns
  if (!pattern) {
    pattern = { id, entityId, source: '', objectId: '', label: '', area: '', kind: '', dayType: type, hour, categories: [], days: [], originObservations: [], lastTransitionKeys: [] }
    patterns.push(pattern)
  }
  for (const [field, limit] of [['source', 80], ['objectId', 240], ['label', 160], ['area', 120], ['kind', 120]]) pattern[field] = text(entity[field] || pattern[field], limit)
  const day = localDay(date)
  const iso = date.toISOString()
  let daily = pattern.days.find(item => item.date === day)
  if (!daily) {
    daily = { date: day, occurrences: 0, firstObserved: iso, lastObserved: iso, numeric: null, categoryCounts: [], unlistedValues: 0, capped: false }
    pattern.days.push(daily)
  }
  if (daily.occurrences >= MAX_DAILY_OCCURRENCES) {
    daily.capped = true
    return patterns
  }
  daily.occurrences++
  daily.lastObserved = iso
  const number = numeric(value)
  if (number !== null) daily.numeric = addNumeric(daily.numeric, number)
  else {
    const key = hash(value)
    let index = pattern.categories.findIndex(item => item.key === key)
    if (index < 0 && pattern.categories.length < MAX_CATEGORIES) {
      index = pattern.categories.length
      pattern.categories.push({ key, value: text(value, 120) })
    }
    if (index < 0) daily.unlistedValues++
    else daily.categoryCounts[index] = count(daily.categoryCounts[index]) + 1
  }
  if (observed !== timestamp(pattern.lastObserved)) pattern.lastTransitionKeys = []
  pattern.lastTransitionKeys.push(transitionKey)
  pattern.firstObserved = pattern.days[0].firstObserved
  pattern.lastObserved = iso
  // These concise samples are self-contained provenance. Their evidence IDs may
  // refer to an event that the separate working-evidence store has since trimmed.
  pattern.originObservations.push({ at: iso, value: text(value, 120), evidenceId: text(entity.evidenceId, 160) })
  pattern.originObservations = pattern.originObservations.slice(-MAX_ORIGINS)
  patterns.sort((left, right) => timestamp(left.lastObserved) - timestamp(right.lastObserved))
  if (patterns.length > MAX_PATTERNS) patterns.splice(0, patterns.length - MAX_PATTERNS)
  return patterns
}

/** Return a detached, bounded projection; never promote a pattern to a policy. */
const summarizeBehaviorPatterns = (patterns, at) => {
  const window = windowAt(at)
  return normalizePatterns(patterns, window).map(pattern => {
    const occurrences = pattern.days.reduce((total, daily) => total + daily.occurrences, 0)
    const observedDays = pattern.days.length
    let measurement = null
    for (const daily of pattern.days) {
      if (!daily.numeric) continue
      const sample = daily.numeric
      if (!measurement) measurement = { ...sample }
      else {
        const combined = measurement.count + sample.count
        measurement = {
          count: combined,
          min: Math.min(measurement.min, sample.min),
          max: Math.max(measurement.max, sample.max),
          mean: weightedMean(measurement.mean, measurement.count, sample.mean, sample.count)
        }
      }
    }
    const categoricalValues = pattern.categories.map((item, index) => ({ value: item.value, occurrences: pattern.days.reduce((total, daily) => total + count(daily.categoryCounts[index]), 0) }))
      .filter(item => item.occurrences > 0).sort((left, right) => right.occurrences - left.occurrences)
    const unlistedValues = pattern.days.reduce((total, daily) => total + daily.unlistedValues, 0)
    const status = observedDays >= 3 ? 'recurring' : 'candidate'
    const hour = `${String(pattern.hour).padStart(2, '0')}:00`
    return {
      id: pattern.id,
      entityId: pattern.entityId,
      source: pattern.source,
      objectId: pattern.objectId,
      label: pattern.label,
      area: pattern.area,
      kind: pattern.kind,
      dayType: pattern.dayType,
      hour: pattern.hour,
      observedDays,
      occurrences,
      status,
      firstObserved: pattern.firstObserved,
      lastObserved: pattern.lastObserved,
      numeric: measurement,
      categoricalValues,
      unlistedValues,
      originObservations: pattern.originObservations,
      evidenceIds: [...new Set(pattern.originObservations.map(item => item.evidenceId).filter(Boolean))],
      summary: `${pattern.label || pattern.objectId || pattern.entityId}: ${occurrences} observed transitions on ${observedDays} distinct ${pattern.dayType} days in the local ${hour} hour; ${status} pattern.`,
      dataCoverage: `Retained local dates ${window.from} to ${window.to}. Counts describe received transitions only, not time in a state or continuous sensor coverage. Missing days do not prove inactivity. Recurrence is not a preference, habit confirmation or action permission. Older replays and excess same-timestamp events are excluded.${unlistedValues ? ' Some categorical values exceed the eight-value detail limit.' : ''}${pattern.days.some(daily => daily.capped) ? ' Daily transition counts reached their storage cap.' : ''}`
    }
  }).sort((left, right) => timestamp(right.lastObserved) - timestamp(left.lastObserved))
}

module.exports = { recordBehaviorTransition, summarizeBehaviorPatterns }
