'use strict'

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { Worker } = require('worker_threads')
const { checkAutomationPath, validAutomationName } = require('./cerebrumAutomationFiles')

const fail = (text, status = 422) => Object.assign(new Error(text), { status })
const clone = value => JSON.parse(JSON.stringify(value))
const hash = value => crypto.createHash('sha256').update(String(value)).digest('hex')
const idOk = id => typeof id === 'string' && id.length > 0 && id.length <= 200 && !/[\u0000-\u001f]/.test(id) // eslint-disable-line no-control-regex
const entityOk = id => idOk(id) && /^[a-z][a-z0-9-]*:.+/.test(id)
const MAX_TIMER_DELAY_MS = 0x7fffffff
const clockFormatters = new Map()

function parseAutomationCheckpoint (content) {
  if (typeof content !== 'string' || Buffer.byteLength(content) > 2 * 1024 * 1024) throw fail('Automation checkpoint exceeds 2 MiB')
  const value = JSON.parse(content)
  const record = item => item && typeof item === 'object' && !Array.isArray(item)
  const invalid = () => { throw fail('Invalid automation runtime checkpoint') }
  if (value?.version !== 1 || !record(value.entries)) invalid()
  if (value.compilation !== undefined && (!record(value.compilation) || !['pending', 'generating', 'ready', 'attention', 'error', 'empty', 'waiting'].includes(value.compilation.status) || typeof value.compilation.revision !== 'string' || Buffer.byteLength(JSON.stringify(value.compilation)) > 8000)) invalid()
  for (const [name, entry] of Object.entries(value.entries)) {
    if (!validAutomationName(name) || !record(entry) || !['active', 'paused', 'error', 'deleted'].includes(entry.status) || !Number.isSafeInteger(entry.generation) || entry.generation < 0) invalid()
    if (entry.status === 'deleted') continue
    if (!/^[a-f0-9]{64}$/.test(entry.revision) || !['user', 'education'].includes(entry.authority)) invalid()
    if (entry.authority === 'education' && !/^[a-f0-9]{64}$/.test(entry.educationHash)) invalid()
    if (entry.targets !== undefined && (!Array.isArray(entry.targets) || entry.targets.length > 40 || !entry.targets.every(entityOk))) invalid()
    if (entry.memory !== undefined && (!record(entry.memory) || Buffer.byteLength(JSON.stringify(entry.memory)) > 32 * 1024)) invalid()
    for (const field of ['timers', 'cursors']) {
      if (entry[field] === undefined) continue
      if (!record(entry[field]) || Object.keys(entry[field]).length > 40 || !Object.keys(entry[field]).every(idOk)) invalid()
      if (!Object.values(entry[field]).every(item => field === 'timers' ? Number.isSafeInteger(item) && item > 0 && item <= 8640000000000000 : typeof item === 'boolean' || typeof item === 'string' || Number.isSafeInteger(item))) invalid()
    }
    if (entry.rules !== undefined) validateProgram({ description: entry.description || '', targets: entry.targets || [], registrations: entry.rules, effects: [] })
  }
  return value
}

function createInterpreter () {
  let worker
  let serial = 0
  let closed = false
  const pending = new Map()
  const stop = error => {
    const old = worker
    worker = null
    for (const request of pending.values()) { clearTimeout(request.timer); request.reject(error) }
    pending.clear()
    return old?.terminate()
  }
  return {
    run: (source, input) => new Promise((resolve, reject) => {
      if (closed) return reject(fail('Local automations are closed'))
      if (!worker) {
        worker = new Worker(path.join(__dirname, 'cerebrumAutomationWorker.js'))
        const current = worker
        worker.on('message', message => {
          if (worker !== current) return
          const request = pending.get(message.id)
          if (!request) return
          pending.delete(message.id)
          clearTimeout(request.timer)
          if (message.error) request.reject(fail(message.error))
          else request.resolve(message.result)
        })
        worker.on('error', error => { if (worker === current) stop(error) })
        worker.on('exit', code => { if (worker === current) stop(fail(`JavaScript worker stopped (${code})`)) })
      }
      const id = ++serial
      const timer = setTimeout(() => stop(fail('JavaScript execution timed out')), 3000)
      pending.set(id, { resolve, reject, timer })
      worker.postMessage({ id, source, input })
    }),
    close: async () => { closed = true; await stop(fail('Local automations are closed')) }
  }
}

function validateProgram (program) {
  if (!program || typeof program.description !== 'string' || program.description.length > 1000) throw fail('Provide a short automation description')
  if (!Array.isArray(program.targets) || program.targets.length > 40 || !program.targets.every(entityOk)) throw fail('Declare exact writable entity IDs with cerebrum.targets([...])')
  if (!Array.isArray(program.registrations) || !program.registrations.length || program.registrations.length > 40) throw fail('Register between 1 and 40 handlers')
  const ids = new Set()
  for (const rule of program.registrations) {
    if (!idOk(rule.id) || ids.has(rule.id)) throw fail('Invalid or duplicate handler ID')
    ids.add(rule.id)
    if (rule.kind === 'state') {
      if (!Array.isArray(rule.entityIds) || !rule.entityIds.length || rule.entityIds.length > 40 || !rule.entityIds.every(entityOk)) throw fail('onState requires exact source:objectId dependencies')
    } else if (rule.kind === 'event') {
      if (!rule.filter || !idOk(rule.filter.source) || (rule.filter.objectId !== undefined && !idOk(rule.filter.objectId)) || (rule.filter.event !== undefined && !idOk(rule.filter.event))) throw fail('onEvent requires a source and optional objectId/event filter')
    } else if (rule.kind === 'daily') {
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(rule.at)) throw fail('Daily schedule needs HH:mm')
      try { new Intl.DateTimeFormat('en', { timeZone: rule.timeZone }).format() } catch (_) { throw fail('Invalid time zone') }
      if (!rule.timeZone) throw fail('Daily schedule needs an IANA time zone')
    } else if (rule.kind === 'every') {
      if (!Number.isSafeInteger(rule.milliseconds) || rule.milliseconds < 1000 || rule.milliseconds > 366 * 86400000) throw fail('Interval must be between 1 second and 366 days')
    } else if (rule.kind === 'at') {
      if (!Number.isSafeInteger(rule.timestamp) || rule.timestamp <= 0 || rule.timestamp > 8640000000000000) throw fail('Schedule timestamp must be epoch milliseconds')
    } else if (rule.kind !== 'timer') throw fail('Unsupported automation trigger')
  }
  if (!Array.isArray(program.effects) || program.effects.length > 20) throw fail('Invalid automation effects')
  return program
}

const clockFormatter = timeZone => {
  if (!clockFormatters.has(timeZone)) {
    if (clockFormatters.size >= 128) clockFormatters.clear()
    clockFormatters.set(timeZone, new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23'
    }))
  }
  return clockFormatters.get(timeZone)
}

const zonedClockParts = (timeZone, now) => {
  const parts = clockFormatter(timeZone).formatToParts(now)
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]))
  return {
    year: Number(values.year),
    month: Number(values.month),
    dayOfMonth: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    day: `${values.year}-${values.month}-${values.day}`,
    time: `${values.hour}:${values.minute}`
  }
}

const localClock = (rule, now) => zonedClockParts(rule.timeZone, now)

const zonedOffsetAt = (timeZone, timestamp) => {
  const minuteTimestamp = Math.floor(timestamp / 60000) * 60000
  const parts = zonedClockParts(timeZone, minuteTimestamp)
  return Date.UTC(parts.year, parts.month - 1, parts.dayOfMonth, parts.hour, parts.minute) - minuteTimestamp
}

// Resolve a civil minute without assuming a fixed UTC offset. Sampling both
// sides of the date captures normal, half-hour and DST offsets; validating the
// candidates rejects a civil minute skipped by a forward clock transition.
const resolveZonedMinuteCandidates = ({ timeZone, year, month, dayOfMonth, hour, minute }) => {
  const intended = Date.UTC(year, month - 1, dayOfMonth, hour, minute)
  const offsets = new Set()
  for (const hours of [-48, -36, -24, -12, 0, 12, 24, 36, 48]) {
    offsets.add(zonedOffsetAt(timeZone, intended + (hours * 60 * 60 * 1000)))
  }
  return [...offsets]
    .map(offset => intended - offset)
    .filter(candidate => {
      const actual = zonedClockParts(timeZone, candidate)
      return actual.year === year && actual.month === month && actual.dayOfMonth === dayOfMonth && actual.hour === hour && actual.minute === minute
    })
    .sort((left, right) => left - right)
}

const nextDailyDeadline = (rule, entry, timestamp) => {
  const current = zonedClockParts(rule.timeZone, timestamp)
  if (entry.cursors?.[rule.id] !== current.day && current.time === rule.at) return timestamp
  const [hour, minute] = rule.at.split(':').map(Number)
  const localDate = Date.UTC(current.year, current.month - 1, current.dayOfMonth)
  for (let offset = 0; offset < 8; offset++) {
    const date = new Date(localDate + (offset * 24 * 60 * 60 * 1000))
    const year = date.getUTCFullYear()
    const month = date.getUTCMonth() + 1
    const dayOfMonth = date.getUTCDate()
    const day = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(dayOfMonth).padStart(2, '0')}`
    if (entry.cursors?.[rule.id] === day) continue
    // A daily rule is never replayed after its civil minute has passed. This
    // also matters during a backward DST transition: restarting at 02:40 in
    // the first 02:00 hour must not run 02:30 in the repeated hour.
    if (offset === 0 && current.time > rule.at) continue
    const candidate = resolveZonedMinuteCandidates({ timeZone: rule.timeZone, year, month, dayOfMonth, hour, minute })
      .find(value => value >= timestamp)
    if (candidate !== undefined) return candidate
  }
  return Number.POSITIVE_INFINITY
}

const nextRuleDeadline = (rule, entry, timestamp) => {
  if (rule.kind === 'daily') return nextDailyDeadline(rule, entry, timestamp)
  if (rule.kind === 'every') {
    const cursor = entry.cursors?.[rule.id]
    return Number.isSafeInteger(cursor) ? Math.max(timestamp, cursor) : timestamp
  }
  if (rule.kind === 'at') return entry.cursors?.[rule.id] ? Number.POSITIVE_INFINITY : Math.max(timestamp, rule.timestamp)
  if (rule.kind === 'timer') {
    const deadline = entry.timers?.[rule.id]
    return Number.isSafeInteger(deadline) ? Math.max(timestamp, deadline) : Number.POSITIVE_INFINITY
  }
  return Number.POSITIVE_INFINITY
}

function createCerebrumAutomationRuntime ({ files, filePath, archive = () => {}, states = () => ({}), authorize = () => {}, write = async () => {}, notify = async () => {}, speak = async () => { throw fail('TTS is unavailable') }, assistant = async () => { throw fail('Assistant execution is unavailable') }, education = () => '', now = Date.now, intervalMs = 1000, setTimeoutFn = setTimeout, clearTimeoutFn = clearTimeout, onEventFiltersChanged = null }) {
  const interpreter = createInterpreter()
  let closed = false
  let checkpoint = { version: 1, entries: {} }
  checkAutomationPath(filePath)
  if (fs.existsSync(filePath)) {
    if (fs.statSync(filePath).size > 2 * 1024 * 1024) throw fail('Automation checkpoint is too large')
    checkpoint = parseAutomationCheckpoint(fs.readFileSync(filePath, 'utf8'))
  }
  let compilation = checkpoint.compilation || { status: 'pending', revision: '' }
  const entries = Object.assign(Object.create(null), checkpoint.entries)
  const programs = new Map()
  const jobs = new Map()
  const initializing = new Set()
  const edits = new Map()
  const archivedEntries = new Map()
  const automaticScheduling = Number(intervalMs) > 0
  let schedulerTimer = null
  let schedulerDeadline = 0
  let tickInFlight = null
  let schedulerRearmPending = false
  let eventFilterNotificationQueued = false
  let lastEventFilterFingerprint = '[]'

  const registrationsFor = (name, entry) => programs.get(name)?.registrations || (Array.isArray(entry.rules) ? entry.rules : [])
  const eventFilters = () => {
    const filters = []
    for (const [name, entry] of Object.entries(entries)) {
      if (entry.status !== 'active') continue
      for (const rule of registrationsFor(name, entry)) {
        if (rule.kind === 'event') filters.push({ ...clone(rule.filter), automation: name, handlerId: rule.id, kind: 'event' })
        if (rule.kind === 'state') {
          const bySource = new Map()
          for (const entityId of rule.entityIds) {
            const separator = entityId.indexOf(':')
            const source = entityId.slice(0, separator)
            if (!bySource.has(source)) bySource.set(source, [])
            bySource.get(source).push(entityId)
          }
          for (const [source, entityIds] of bySource) filters.push({ automation: name, handlerId: rule.id, kind: 'state', source, entityIds: [...entityIds] })
        }
      }
    }
    return filters.sort((left, right) => `${left.source}\u0000${left.automation}\u0000${left.handlerId}`.localeCompare(`${right.source}\u0000${right.automation}\u0000${right.handlerId}`))
  }
  const eventSources = () => [...new Set(eventFilters().map(item => item.source))].sort()
  const scheduleEventFiltersChanged = () => {
    if (closed || eventFilterNotificationQueued || typeof onEventFiltersChanged !== 'function') return
    eventFilterNotificationQueued = true
    queueMicrotask(() => {
      eventFilterNotificationQueued = false
      if (closed) return
      const filters = eventFilters()
      const fingerprint = JSON.stringify(filters)
      if (fingerprint === lastEventFilterFingerprint) return
      lastEventFilterFingerprint = fingerprint
      try {
        Promise.resolve(onEventFiltersChanged({ filters, sources: [...new Set(filters.map(item => item.source))].sort() })).catch(() => {})
      } catch (error) { /* integration refresh failures must not affect automation state */ }
    })
  }
  const nextWakeAt = () => {
    const timestamp = now()
    let deadline = Number.POSITIVE_INFINITY
    for (const [name, entry] of Object.entries(entries)) {
      if (entry.status !== 'active') continue
      if (!programs.has(name)) return timestamp
      for (const rule of registrationsFor(name, entry)) deadline = Math.min(deadline, nextRuleDeadline(rule, entry, timestamp))
    }
    return deadline
  }
  const clearScheduler = () => {
    if (schedulerTimer !== null) clearTimeoutFn(schedulerTimer)
    schedulerTimer = null
    schedulerDeadline = 0
  }
  function requestSchedulerRearm () {
    if (!automaticScheduling || closed) return
    if (tickInFlight) {
      schedulerRearmPending = true
      return
    }
    schedulerRearmPending = false
    clearScheduler()
    const deadline = nextWakeAt()
    if (!Number.isFinite(deadline)) return
    schedulerDeadline = deadline
    const delay = Math.min(MAX_TIMER_DELAY_MS, Math.max(0, deadline - now()))
    schedulerTimer = setTimeoutFn(() => {
      schedulerTimer = null
      const expectedDeadline = schedulerDeadline
      schedulerDeadline = 0
      if (closed) return
      // A very distant deadline is split only because Node timers have a
      // finite range. Re-arm without touching source files or authority.
      if (now() < expectedDeadline) {
        requestSchedulerRearm()
        return
      }
      return tick().catch(() => {})
    }, delay)
    schedulerTimer?.unref?.()
  }
  const persist = () => {
    checkAutomationPath(filePath)
    const snapshot = { version: 1, entries, compilation }
    const content = JSON.stringify(snapshot)
    if (Buffer.byteLength(content) > 2 * 1024 * 1024) throw fail('Automation checkpoint exceeds 2 MiB')
    for (const [name, entry] of Object.entries(entries)) {
      const serialized = JSON.stringify(entry)
      if (archivedEntries.get(name) !== serialized) {
        archive({ phase: 'runtime', name, entry })
        archivedEntries.set(name, serialized)
      }
    }
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    const temp = `${filePath}.${crypto.randomUUID()}.tmp`
    try {
      const fd = fs.openSync(temp, 'wx', 0o600)
      try { fs.writeFileSync(fd, content); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
      fs.renameSync(temp, filePath)
    } finally { fs.rmSync(temp, { force: true }) }
  }
  const available = () => { if (closed) throw fail('Local automations are closed', 409) }
  const current = (name, generation) => !closed && entries[name]?.status === 'active' && entries[name].generation === generation
  const inspect = async (source, handler = '', event = {}, entry = {}) => {
    if (typeof source !== 'string' || Buffer.byteLength(source) > 128 * 1024) throw fail('JavaScript source exceeds 128 KiB')
    const snapshot = states()
    if (Buffer.byteLength(JSON.stringify(snapshot)) > 1024 * 1024) throw fail('Local state snapshot exceeds 1 MiB')
    return validateProgram(await interpreter.run(source, { now: now(), handler, event, states: snapshot, memory: clone(entry.memory || {}) }))
  }
  const setError = (name, error) => {
    if (!entries[name] || closed) return
    entries[name].status = 'error'
    entries[name].generation++
    entries[name].error = String(error.message || error)
    programs.delete(name)
    persist()
    requestSchedulerRearm()
    scheduleEventFiltersChanged()
  }
  const detail = file => {
    const entry = entries[file.name]
    return { ...file, ...(entry && entry.status !== 'deleted' ? { revision: file.revision || entry.revision, status: entry.status, description: entry.description, author: entry.author, lastRunAt: entry.lastRunAt || '', error: entry.error || '', generation: entry.generation } : { status: 'paused', description: '', author: 'user' }), runtimeAvailable: true }
  }
  const list = () => {
    const listing = files.list()
    return { ...listing, files: listing.files.map(detail), compilation: clone(compilation) }
  }
  const read = options => detail(files.read(options))
  const assertRevision = ({ name, revision }) => {
    const file = files.read({ name })
    if (file.revision !== revision) throw fail('This JavaScript file has changed. Refresh before continuing.', 409)
    return file
  }
  const checkAuthority = entry => {
    if (entry.authority === 'education' && entry.educationHash !== hash(education())) throw fail('AI Education changed. Review this automation before resuming.')
    authorize({ targets: entry.targets || [], authority: entry.authority, sessionId: entry.sessionId })
  }
  const activate = async (name, { cancelled = () => false } = {}) => {
    available()
    const entry = entries[name]
    const generation = entry.generation
    const file = files.read({ name })
    const program = await inspect(file.content)
    available()
    if (entry.generation !== generation || cancelled()) throw fail('Automation update was cancelled', 409)
    if (files.read({ name }).revision !== file.revision) throw fail('Source changed during validation', 409)
    entry.targets = program.targets
    checkAuthority(entry)
    entry.revision = file.revision
    entry.description = program.description
    entry.status = 'active'
    entry.error = ''
    entry.cursors ||= {}
    for (const id of Object.keys(entry.cursors)) {
      const oldRule = entry.rules?.find(rule => rule.id === id)
      const newRule = program.registrations.find(rule => rule.id === id)
      if (oldRule && JSON.stringify(oldRule) !== JSON.stringify(newRule)) delete entry.cursors[id]
    }
    entry.rules = program.registrations
    entry.timers ||= {}
    entry.memory ||= {}
    for (const rule of program.registrations) {
      if (entry.cursors[rule.id] !== undefined) continue
      if (rule.kind === 'daily') { const clock = localClock(rule, now()); entry.cursors[rule.id] = clock.time > rule.at ? clock.day : '' }
      if (rule.kind === 'every') entry.cursors[rule.id] = now() + rule.milliseconds
      if (rule.kind === 'at' && rule.timestamp < now() - 60000) entry.cursors[rule.id] = true
    }
    persist()
    programs.set(name, { source: file.content, ...program })
    requestSchedulerRearm()
    scheduleEventFiltersChanged()
    return read({ name })
  }
  const pause = options => {
    available()
    const file = assertRevision(options)
    edits.set(file.name, (edits.get(file.name) || 0) + 1)
    const entry = entries[file.name] ||= { generation: 0, author: 'user', authority: 'user', revision: file.revision }
    entry.generation++
    entry.status = 'paused'
    entry.timers = {}
    for (const rule of entry.rules || []) if (rule.kind === 'every') delete entry.cursors?.[rule.id]
    programs.delete(file.name)
    persist()
    requestSchedulerRearm()
    scheduleEventFiltersChanged()
    return read({ name: file.name })
  }
  const manage = async options => {
    if (!['pause', 'resume', 'delete'].includes(options.operation)) throw fail('Invalid automation operation')
    const file = pause(options) // Synchronous fence precedes every async step.
    const entry = entries[file.name]
    if (options.operation === 'pause') return file
    if (options.operation === 'delete') {
      files.remove(options)
      entries[file.name] = { status: 'deleted', generation: entry.generation, description: entry.description || '', deletedAt: new Date(now()).toISOString() }
      persist()
      requestSchedulerRearm()
      scheduleEventFiltersChanged()
      return { name: file.name, status: 'deleted' }
    }
    // Explicit user resumption accepts current education, while retaining the
    // original authority class and all current command permission checks.
    entry.educationHash = hash(education())
    const generation = entry.generation
    try { return await activate(file.name, options) } catch (error) { if (entry.generation === generation) setError(file.name, error); throw error }
  }
  const save = async (options, context = {}) => {
    available()
    if (!validAutomationName(options.name)) throw fail('Invalid .js filename')
    const existing = entries[options.name]
    const wasActive = existing?.status === 'active'
    if (context.authority === 'education' && existing) throw fail('Autonomous planning cannot replace, resume or recreate an existing automation; the user manages it')
    const oldFile = options.origin === 'new' ? null : assertRevision(options)
    if (oldFile) pause(options)
    const edit = (edits.get(options.name) || 0) + 1
    edits.set(options.name, edit)
    const program = await inspect(options.content)
    available()
    if (context.cancelled?.() || edits.get(options.name) !== edit) throw fail('Automation creation was cancelled', 409)
    const authority = context.authority || existing?.authority || 'user'
    const file = files.save({ ...options, author: context.author || 'user' })
    entries[file.name] = {
      generation: (entries[file.name]?.generation || 0) + 1,
      status: 'paused',
      revision: file.revision,
      description: program.description,
      author: context.author || 'user',
      authority,
      sessionId: context.sessionId || existing?.sessionId || '',
      educationHash: hash(education()),
      targets: program.targets,
      memory: existing?.memory || {},
      timers: {},
      cursors: existing?.cursors || {},
      ...(existing?.rules ? { rules: existing.rules } : {}),
      request: String(context.request || '').slice(0, 4000),
      lastRunAt: existing?.lastRunAt || ''
    }
    persist()
    // Editing a paused automation leaves it paused. AI creation starts locally.
    if (context.activate === true || wasActive || context.wasActive === true) {
      const generation = entries[file.name].generation
      try { return await activate(file.name, context) } catch (error) { if (entries[file.name]?.generation === generation) setError(file.name, error); throw error }
    }
    requestSchedulerRearm()
    return read({ name: file.name })
  }
  const run = async (name, handler, event, occurrence) => {
    const entry = entries[name]
    if (!entry || !current(name, entry.generation)) return
    const generation = entry.generation
    try {
      const program = programs.get(name)
      if (!program) return
      if (files.read({ name }).revision !== entry.revision) throw fail('Source changed outside Cerebrum. Review it and resume to apply the changes.')
      checkAuthority(entry)
      const result = await inspect(program.source, handler, event, entry)
      if (!current(name, generation)) return
      if (files.read({ name }).revision !== entry.revision) throw fail('Source changed during execution')
      if (JSON.stringify(result.registrations) !== JSON.stringify(program.registrations) || JSON.stringify(result.targets) !== JSON.stringify(program.targets)) throw fail('Handler registration must not depend on time, state or memory')
      checkAuthority(entry)
      const memory = clone(entry.memory || {})
      const timers = { ...entry.timers }
      // Validate the entire effect batch before changing durable state or devices.
      for (const effect of result.effects) {
        if (effect.kind === 'memory') {
          if (!idOk(effect.key) || ['__proto__', 'constructor', 'prototype'].includes(effect.key)) throw fail('Invalid memory key')
          memory[effect.key] = effect.value
        } else if (effect.kind === 'timer' || effect.kind === 'cancelTimer') {
          if (!program.registrations.some(rule => rule.id === effect.id && rule.kind === 'timer')) throw fail('Unknown timer handler')
          if (effect.kind === 'cancelTimer') delete timers[effect.id]
          else {
            if (!Number.isSafeInteger(effect.timestamp) || effect.timestamp < now() + 1000 || effect.timestamp > now() + 366 * 86400000) throw fail('Timer deadline must be between 1 second and 366 days from now')
            if (timers[effect.id] === undefined) timers[effect.id] = effect.timestamp
          }
        } else if (effect.kind === 'write') {
          if (!entry.targets.includes(effect.entityId)) throw fail('Write target was not declared by this automation')
          authorize({ targets: [effect.entityId], authority: entry.authority, value: effect.value, validateValue: true })
        } else if (effect.kind === 'assistant') {
          if (typeof effect.instruction !== 'string' || !effect.instruction.trim() || effect.instruction.length > 8000 || result.effects.filter(item => item.kind === 'assistant').length > 1) throw fail('Use one assistant task with an instruction of 1–8000 characters')
        } else if (['notify', 'speak'].includes(effect.kind)) {
          if (typeof effect.text !== 'string' || !effect.text.trim() || effect.text.length > 4000) throw fail('Notification must contain 1–4000 characters')
        } else throw fail('Unsupported automation effect')
      }
      if (Buffer.byteLength(JSON.stringify(memory)) > 32 * 1024) throw fail('Automation memory exceeds 32 KiB')
      entry.memory = memory
      entry.timers = timers
      entry.lastRunAt = new Date(now()).toISOString()
      persist()
      requestSchedulerRearm()
      for (const effect of result.effects) {
        if (!current(name, generation)) return
        if (!['write', 'notify', 'speak', 'assistant'].includes(effect.kind)) continue
        checkAuthority(entry)
        // Claims survive restarts. An uncertain delivery is never blindly retried.
        archive({ phase: 'effect_claimed', name, revision: entry.revision, occurrence, effect })
        if (effect.kind === 'write') await write({ ...effect, authority: entry.authority, name, sessionId: entry.sessionId })
        else if (effect.kind === 'assistant') {
          await assistant({
            instruction: effect.instruction,
            name,
            sessionId: entry.sessionId,
            isCancelled: () => {
              if (!current(name, generation)) return true
              try { checkAuthority(entry); return files.read({ name }).revision !== entry.revision } catch (_) { return true }
            }
          })
        } else if (effect.kind === 'speak') await speak({ text: effect.text, name, sessionId: entry.sessionId })
        else if (await notify({ text: effect.text, name, sessionId: entry.sessionId }) === false) throw fail('Notification could not be delivered')
        archive({ phase: 'effect_sent', name, occurrence, effect })
      }
    } catch (error) { if (current(name, generation)) setError(name, error) }
  }
  const enqueue = (name, handler, event, occurrence) => {
    const queue = jobs.get(name) || { promise: Promise.resolve(), count: 0 }
    if (queue.count >= 200) { setError(name, fail('Too many pending local events')); return }
    const generation = entries[name]?.generation
    queue.count++
    queue.promise = queue.promise.then(() => current(name, generation) ? run(name, handler, event, occurrence) : undefined).catch(error => { archive({ phase: 'runtime_error', name, error: error.message }) }).finally(() => { queue.count--; if (!queue.count) jobs.delete(name) })
    jobs.set(name, queue)
  }
  const ingest = event => {
    if (closed || !event || !idOk(event.source)) return
    for (const [name, program] of programs) {
      if (entries[name]?.status !== 'active') continue
      for (const rule of program.registrations) {
        const key = `${event.source}:${event.objectId}`
        const matched = rule.kind === 'state' ? event.changed === true && rule.entityIds.includes(key) : rule.kind === 'event' && Object.entries(rule.filter).every(([field, value]) => event[field] === value)
        if (matched) enqueue(name, rule.id, clone(event), crypto.randomUUID())
      }
    }
  }
  const tickCore = async () => {
    if (closed) return
    for (const [name, entry] of Object.entries(entries)) {
      if (entry.status !== 'active') continue
      if (!programs.has(name)) {
        if (initializing.has(name)) continue
        initializing.add(name)
        try {
          if (files.read({ name }).revision !== entry.revision) throw fail('Source changed outside Cerebrum. Review it and resume.')
          await activate(name)
        } catch (error) { if (!closed && entry.status === 'active') setError(name, error) } finally { initializing.delete(name) }
      }
      const program = programs.get(name)
      if (!program || entry.status !== 'active' || closed) continue
      try {
        const timestamp = now()
        const hasDueRule = program.registrations.some(rule => {
          if (rule.kind === 'daily') {
            const clock = localClock(rule, timestamp)
            return clock.time >= rule.at && entry.cursors[rule.id] !== clock.day
          }
          if (rule.kind === 'every') return timestamp >= entry.cursors[rule.id]
          if (rule.kind === 'at') return !entry.cursors[rule.id] && timestamp >= rule.timestamp
          if (rule.kind === 'timer') return entry.timers[rule.id] && timestamp >= entry.timers[rule.id]
          return false
        })
        if (!hasDueRule) continue
        if (files.read({ name }).revision !== entry.revision) throw fail('Source changed outside Cerebrum. Review it and resume.')
        checkAuthority(entry)
        for (const rule of program.registrations) {
          let due = false
          let occurrence = ''
          if (rule.kind === 'daily') {
            const clock = localClock(rule, now())
            if (clock.time >= rule.at && entry.cursors[rule.id] !== clock.day) {
              entry.cursors[rule.id] = clock.day
              // Do not replay missed daily jobs after downtime or DST jumps.
              due = clock.time === rule.at
              occurrence = `${rule.id}:${clock.day}`
              persist()
            }
          } else if (rule.kind === 'every' && now() >= entry.cursors[rule.id]) {
            occurrence = `${rule.id}:${entry.cursors[rule.id]}`
            due = now() - entry.cursors[rule.id] <= 60000
            entry.cursors[rule.id] = now() + rule.milliseconds
            persist()
          } else if (rule.kind === 'at' && !entry.cursors[rule.id] && now() >= rule.timestamp) {
            entry.cursors[rule.id] = true
            due = now() - rule.timestamp <= 60000
            occurrence = `${rule.id}:${rule.timestamp}`
            persist()
          } else if (rule.kind === 'timer' && entry.timers[rule.id] && now() >= entry.timers[rule.id]) {
            occurrence = `${rule.id}:${entry.timers[rule.id]}`
            due = now() - entry.timers[rule.id] <= 60000
            delete entry.timers[rule.id]
            persist()
          }
          if (due) enqueue(name, rule.id, { type: 'schedule', at: now() }, occurrence)
        }
      } catch (error) { setError(name, error) }
    }
  }
  const tick = () => {
    if (closed) return Promise.resolve()
    if (tickInFlight) return tickInFlight
    tickInFlight = tickCore().finally(() => {
      tickInFlight = null
      if (schedulerRearmPending || automaticScheduling) requestSchedulerRearm()
    })
    return tickInFlight
  }
  requestSchedulerRearm()
  return {
    list,
    read,
    save,
    manage,
    ingest,
    tick,
    eventFilters,
    eventSources,
    compilationStatus: () => clone(compilation),
    setCompilationStatus: value => { available(); compilation = clone(value); archive({ phase: 'education_compilation', ...compilation }); persist(); return clone(compilation) },
    summary: () => Object.entries(entries).map(([name, entry]) => ({ name, status: entry.status, description: entry.description, revision: entry.revision })),
    drain: async () => { await Promise.all([...jobs.values()].map(queue => queue.promise)) },
    close: async () => {
      closed = true
      clearScheduler()
      programs.clear()
      await interpreter.close()
      await Promise.allSettled([tickInFlight, ...[...jobs.values()].map(queue => queue.promise)].filter(Boolean))
    }
  }
}

module.exports = { createCerebrumAutomationRuntime, createInterpreter, validateProgram, parseAutomationCheckpoint, nextDailyDeadline, nextRuleDeadline }
