'use strict'
/* eslint-env mocha */
const { expect } = require('chai')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { createCerebrumAutonomy, observationJournalPath, CEREBRUM_AUTONOMY_LIMITS: LIMITS } = require('../nodes/utils/cerebrumAutonomy')

const MINUTE = 60000
const HOUR = 60 * MINUTE

describe('Persistent Cerebrum autonomy', () => {
  let directory
  let currentTime
  let states
  let habits
  let reasons
  let executions
  let notifications
  let enabled
  let decide
  let dispatch
  let deliver
  let runtime
  const at = () => new Date(currentTime).toISOString()
  const state = (overrides = {}) => ({ source: 'homeassistant', objectId: 'light.kitchen', label: 'Kitchen light', area: 'kitchen', kind: 'light', value: 'true', observedAt: at(), verifiedAt: at(), changedAt: at(), refreshIntervalSeconds: 60, ...overrides })
  const decision = (situation, overrides = {}) => ({ disposition: 'observe', summary: 'Review the kitchen later.', nextCheckSeconds: 60, evidenceIds: [...situation.evidenceIds], action: null, expected: null, ...overrides })
  const actionDecision = situation => decision(situation, { disposition: 'act', summary: 'Turn off the kitchen light.', action: { source: 'homeassistant', objectId: 'light.kitchen', value: false }, expected: { source: 'homeassistant', objectId: 'light.kitchen', value: false } })
  const makeRuntime = (overrides = {}) => createCerebrumAutonomy({
    filePath: path.join(directory, 'autonomy.json'),
    readSnapshot: () => ({ states, habits }),
    now: () => currentTime,
    enabled: () => enabled,
    reason: async input => { reasons.push(input); return decide(input) },
    execute: async input => { executions.push(input); return dispatch(input) },
    notify: async input => { notifications.push(input); return deliver(input) },
    ...overrides
  })

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cerebrum-autonomy-'))
    currentTime = new Date(2026, 8, 7, 8, 0, 0).getTime()
    states = [state()]
    habits = []
    reasons = []
    executions = []
    notifications = []
    enabled = true
    decide = ({ situation }) => decision(situation)
    dispatch = () => ({ ok: true })
    deliver = () => true
    runtime = makeRuntime()
  })

  afterEach(() => fs.rmSync(directory, { recursive: true, force: true }))

  it('observes and reasons on its own clock with no conversation input', async () => {
    expect((await runtime.tick()).ok).to.equal(true)
    expect(reasons).to.have.length(1)
    expect(reasons[0].situation.kind).to.equal('state_change')
    expect(runtime.snapshot().entities[0]).to.include({ id: 'homeassistant:light.kitchen', fresh: true })
    expect(runtime.snapshot().situations.some(item => item.kind === 'daily_review')).to.equal(true)
    currentTime += MINUTE
    await runtime.tick()
    expect(reasons).to.have.length(2)
    expect(fs.existsSync(path.join(directory, 'autonomy.json'))).to.equal(true)
  })

  it('retains rapid observed transitions even when the next snapshot has the original value', async () => {
    enabled = false
    states = [state({ value: 'false' })]
    await runtime.tick()
    currentTime += 1000
    runtime.ingestState(state({ value: 'true' }))
    currentTime += 1000
    runtime.ingestState(state({ value: 'false' }))
    states = [state({ value: 'false' })]
    await runtime.tick()
    expect(runtime.snapshot().evidence.filter(item => item.type === 'state_changed').map(item => item.value)).to.deep.equal(['true', 'false'])
    expect(runtime.snapshot().situations.filter(item => item.key === 'area:kitchen')).to.have.length(1)
    expect(runtime.snapshot().entities[0].value).to.equal('false')
  })

  it('saves observations before a tick and replays a restart journal exactly once without rewinding newer state', async () => {
    enabled = false
    states = [state({ value: 'false' })]
    await runtime.tick()
    const filePath = path.join(directory, 'autonomy.json')
    const journalPath = observationJournalPath(filePath)
    currentTime += 1000
    expect(runtime.ingestState(state({ value: 'true' }))).to.equal(true)
    currentTime += 1000
    expect(runtime.ingestState(state({ value: 'false' }))).to.equal(true)
    const latestObservation = at()
    const journal = fs.readFileSync(journalPath, 'utf8')
    expect(journal.trim().split('\n').map(line => JSON.parse(line).state.value)).to.deep.equal(['true', 'false'])
    expect(JSON.parse(fs.readFileSync(filePath, 'utf8')).evidence.some(item => item.type === 'state_changed')).to.equal(false)

    // Simulate termination before a tick/close. The shared house snapshot is
    // intentionally older than the durable observations, as after a crash.
    currentTime += 3 * HOUR
    runtime = makeRuntime()
    await runtime.tick()
    const recovered = runtime.snapshot()
    expect(recovered.evidence.filter(item => item.type === 'state_changed').map(item => item.value)).to.deep.equal(['true', 'false'])
    expect(recovered.entities[0]).to.include({ value: 'false', observedAt: latestObservation, fresh: false })
    expect(recovered.patterns.map(item => item.occurrences)).to.deep.equal([2])
    expect(fs.readFileSync(journalPath, 'utf8')).to.equal('')

    // A crash after checkpoint rename but before journal compaction leaves
    // exactly this pair. Previously committed transitions must not be counted.
    fs.writeFileSync(journalPath, journal)
    runtime = makeRuntime()
    await runtime.tick()
    expect(runtime.snapshot().evidence.filter(item => item.type === 'state_changed')).to.have.length(2)
    expect(runtime.snapshot().patterns.map(item => item.occurrences)).to.deep.equal([2])
    expect(fs.readFileSync(journalPath, 'utf8')).to.equal('')
  })

  it('saves queued observations on close before a pending model request finishes', async () => {
    let release
    decide = () => new Promise(resolve => { release = resolve })
    const running = runtime.tick()
    await new Promise(resolve => setImmediate(resolve))
    currentTime += 1000
    expect(runtime.ingestState(state({ value: 'false' }))).to.equal(true)
    const filePath = path.join(directory, 'autonomy.json')
    let settled = false
    const closing = runtime.close().finally(() => { settled = true })
    try {
      const saved = JSON.parse(fs.readFileSync(filePath, 'utf8'))
      expect(saved.entities[0].value).to.equal('false')
      expect(saved.evidence.some(item => item.type === 'state_changed' && item.value === 'false')).to.equal(true)
      expect(fs.readFileSync(observationJournalPath(filePath), 'utf8')).to.equal('')
      await new Promise(resolve => setImmediate(resolve))
      expect(settled).to.equal(false)
    } finally {
      release(actionDecision(reasons[0].situation))
      await closing
    }
    expect((await running).status).to.equal('cancelled')
    expect(executions).to.have.length(0)
    enabled = false
    runtime = makeRuntime()
    await runtime.tick()
    expect(runtime.snapshot().entities[0].value).to.equal('false')
  })

  it('recovers complete journal records from a torn append and preserves the original bytes', async () => {
    enabled = false
    states = [state({ value: 'false' })]
    await runtime.tick()
    currentTime += 1000
    expect(runtime.ingestState(state({ value: 'true' }))).to.equal(true)
    const journalPath = observationJournalPath(path.join(directory, 'autonomy.json'))
    const complete = fs.readFileSync(journalPath)
    const torn = Buffer.concat([complete, Buffer.from('{"sequence":2,"state":{"label":"'), Buffer.from([0xe2, 0x82])])
    fs.writeFileSync(journalPath, torn)
    const warnings = []
    runtime = makeRuntime({ log: message => warnings.push(message) })
    const archived = fs.readdirSync(directory).filter(name => name.startsWith(`${path.basename(journalPath)}.incomplete-`))
    expect(archived).to.have.length(1)
    expect(fs.readFileSync(path.join(directory, archived[0])).equals(torn)).to.equal(true)
    expect(fs.readFileSync(journalPath).equals(complete)).to.equal(true)
    expect(warnings.some(message => message.includes('interrupted append'))).to.equal(true)
    await runtime.tick()
    expect(runtime.snapshot().entities[0].value).to.equal('true')
    expect(runtime.snapshot().patterns.map(item => item.occurrences)).to.deep.equal([1])
  })

  it('refuses complete malformed or semantically invalid journal records without replacing them', async () => {
    enabled = false
    await runtime.tick()
    currentTime += 1000
    expect(runtime.ingestState(state({ value: 'false' }))).to.equal(true)
    const journalPath = observationJournalPath(path.join(directory, 'autonomy.json'))
    const complete = fs.readFileSync(journalPath, 'utf8')
    for (const invalid of ['{broken}\n', JSON.stringify({ sequence: 2, state: null })]) {
      const content = complete + invalid
      fs.writeFileSync(journalPath, content)
      expect(() => makeRuntime()).to.throw('Cannot safely read autonomy observation journal')
      expect(fs.readFileSync(journalPath, 'utf8')).to.equal(content)
    }
    expect(fs.readdirSync(directory).some(name => name.includes('.incomplete-'))).to.equal(false)
  })

  it('detects a missed confirmed habit using time, while stale sensors yield unknown evidence', async () => {
    enabled = false
    habits = [{ id: 'breakfast', source: 'homeassistant', objectId: 'light.kitchen', status: 'confirmed', value: 'true', dayType: 'weekday', averageMinuteOfDay: 480, deviationMinutes: 0 }]
    states = [state({ value: 'false' })]
    await runtime.tick()
    expect(runtime.snapshot().expectations[0].status).to.equal('pending')
    currentTime += 6 * MINUTE
    states = [state({ value: 'false' })]
    await runtime.tick()
    expect(runtime.snapshot().expectations[0].status).to.equal('missed')
    expect(runtime.snapshot().situations.some(item => item.kind === 'missed_expectation')).to.equal(true)

    currentTime += 24 * HOUR
    await runtime.tick()
    const latest = runtime.snapshot().expectations.at(-1)
    expect(latest.status).to.equal('unknown')
    expect(runtime.snapshot().evidence.find(item => item.id === latest.evidenceId).type).to.equal('expectation_unknown')
    expect(runtime.snapshot().entities[0].fresh).to.equal(false)
  })

  it('counts short routine events in a window, ignores unconfirmed habits, and does not confuse a habit with a command', async () => {
    enabled = false
    habits = [
      { id: 'confirmed', source: 'homeassistant', objectId: 'light.kitchen', status: 'confirmed', value: 'true', dayType: 'weekday', averageMinuteOfDay: 480 },
      { id: 'learning', source: 'homeassistant', objectId: 'light.kitchen', status: 'learning', value: 'true', averageMinuteOfDay: 480 }
    ]
    states = [state({ value: 'false' })]
    await runtime.tick()
    currentTime += 1000
    runtime.ingestState(state({ value: 'true' }))
    currentTime += 1000
    runtime.ingestState(state({ value: 'false' }))
    states = [state({ value: 'false' })]
    await runtime.tick()
    expect(runtime.snapshot().expectations).to.have.length(1)
    expect(runtime.snapshot().expectations[0].status).to.equal('observed')
    expect(executions).to.have.length(0)
  })

  it('persists the effect claim before dispatch and waits for fresh verified feedback', async () => {
    decide = ({ situation }) => actionDecision(situation)
    dispatch = ({ situation }) => {
      const durable = JSON.parse(fs.readFileSync(path.join(directory, 'autonomy.json'), 'utf8'))
      expect(durable.situations.find(item => item.id === situation.id).status).to.equal('claimed')
      expect(durable.actionHistory).to.have.length(1)
      return { ok: true }
    }
    await runtime.tick()
    expect(executions).to.have.length(1)
    const situationId = executions[0].situation.id
    expect(runtime.snapshot().situations.find(item => item.id === situationId).status).to.equal('verifying')
    currentTime += 1000
    states = [state({ value: 'false', verifiedAt: executions[0].situation.claim.at })]
    await runtime.tick()
    expect(runtime.snapshot().situations.find(item => item.id === situationId).status).to.equal('verifying')
    currentTime += 1000
    states = [state({ value: 'false' })]
    await runtime.tick()
    expect(runtime.snapshot().situations.find(item => item.id === situationId).outcome).to.equal('verified')
    expect(runtime.snapshot().actionHistory[0].status).to.equal('verified')
  })

  it('recovers a persisted claim by verifying, and never replays the command after restart', async () => {
    decide = ({ situation }) => actionDecision(situation)
    await runtime.tick()
    const durablePath = path.join(directory, 'autonomy.json')
    const durable = JSON.parse(fs.readFileSync(durablePath, 'utf8'))
    durable.situations.find(item => item.claim).status = 'claimed'
    fs.writeFileSync(durablePath, JSON.stringify(durable))
    runtime = makeRuntime()
    enabled = false
    currentTime += 1000
    states = [state({ value: 'false' })]
    await runtime.tick()
    expect(executions).to.have.length(1)
    expect(runtime.snapshot().situations.find(item => item.claim).outcome).to.equal('verified')
  })

  it('records mismatch and timeout without retrying an uncertain execution', async () => {
    decide = ({ situation }) => actionDecision(situation)
    dispatch = () => { throw new Error('connection lost after dispatch') }
    await runtime.tick()
    const originalId = executions[0].situation.id
    enabled = false
    currentTime += 3 * MINUTE
    states = [state({ value: 'true' })]
    await runtime.tick()
    expect(executions).to.have.length(1)
    expect(runtime.snapshot().situations.find(item => item.id === originalId).outcome).to.equal('action_mismatch')
    expect(runtime.snapshot().situations.some(item => item.kind === 'action_mismatch' && item.status === 'open')).to.equal(true)
  })

  it('requires feedback newer than the claim and reports no feedback as unverified', async () => {
    decide = ({ situation }) => actionDecision(situation)
    await runtime.tick()
    enabled = false
    currentTime += 3 * MINUTE
    await runtime.tick()
    expect(runtime.snapshot().situations.find(item => item.claim).outcome).to.equal('action_unverified')
    expect(executions).to.have.length(1)
  })

  it('rejects invented evidence, invented targets, and unavailable device state', async () => {
    decide = ({ situation }) => ({ ...actionDecision(situation), evidenceIds: ['invented'] })
    expect((await runtime.tick()).ok).to.equal(false)
    expect(executions).to.have.length(0)
    currentTime += MINUTE
    decide = ({ situation }) => ({ ...actionDecision(situation), action: { source: 'homeassistant', objectId: 'lock.front_door', value: 'open' } })
    expect((await runtime.tick()).ok).to.equal(false)
    expect(executions).to.have.length(0)
    currentTime += MINUTE
    states = [state({ value: 'unavailable' })]
    decide = ({ situation }) => actionDecision(situation)
    expect((await runtime.tick()).ok).to.equal(false)
    expect(executions).to.have.length(0)
  })

  it('rechecks source state and the enable switch after model latency', async () => {
    decide = ({ situation }) => {
      states = [state({ value: 'false' })]
      return actionDecision(situation)
    }
    expect((await runtime.tick()).ok).to.equal(false)
    expect(executions).to.have.length(0)
    currentTime += MINUTE
    decide = ({ situation }) => { enabled = false; return actionDecision(situation) }
    expect((await runtime.tick()).status).to.equal('cancelled')
    expect(executions).to.have.length(0)
  })

  it('serializes concurrent ticks and cancellation prevents effects from a pending model call', async () => {
    let release
    decide = () => new Promise(resolve => { release = resolve })
    const first = runtime.tick()
    const second = runtime.tick()
    expect(first).to.equal(second)
    await new Promise(resolve => setImmediate(resolve))
    expect(reasons).to.have.length(1)
    const closing = runtime.close()
    release(actionDecision(reasons[0].situation))
    expect((await first).status).to.equal('cancelled')
    await closing
    expect(executions).to.have.length(0)
    expect((await runtime.tick()).status).to.equal('closed')
  })

  it('waits for in-flight work after an initial close checkpoint fails and still attempts the final save', async () => {
    let release
    decide = () => new Promise(resolve => { release = resolve })
    const running = runtime.tick()
    await new Promise(resolve => setImmediate(resolve))
    currentTime += 1000
    expect(runtime.ingestState(state({ value: 'false' }))).to.equal(true)
    const filePath = path.join(directory, 'autonomy.json')
    const blockedTemp = `${filePath}.${process.pid}.tmp`
    fs.mkdirSync(blockedTemp)
    let settled = false
    const closing = runtime.close().then(
      () => { settled = true; return null },
      error => { settled = true; return error }
    )
    try {
      await new Promise(resolve => setImmediate(resolve))
      expect(settled).to.equal(false)
      expect(JSON.parse(fs.readFileSync(filePath, 'utf8')).entities[0].value).to.equal('true')
    } finally {
      fs.rmdirSync(blockedTemp)
      release(actionDecision(reasons[0].situation))
      await closing
    }
    const failure = await closing
    expect(failure).to.be.instanceOf(Error)
    expect(failure.message).to.include('Autonomy persistence failed')
    expect((await running).status).to.equal('cancelled')
    expect(JSON.parse(fs.readFileSync(filePath, 'utf8')).entities[0].value).to.equal('false')
    expect(fs.readFileSync(observationJournalPath(filePath), 'utf8')).to.equal('')
    expect(executions).to.have.length(0)
  })

  it('aborts external effects when a durable claim cannot be saved', async () => {
    decide = ({ situation }) => {
      fs.rmSync(directory, { recursive: true, force: true })
      fs.writeFileSync(directory, 'blocks directory creation')
      return actionDecision(situation)
    }
    const result = await runtime.tick()
    expect(result.ok).to.equal(false)
    expect(result.error).to.include('persistence failed')
    expect(executions).to.have.length(0)
    fs.unlinkSync(directory)
    fs.mkdirSync(directory)
  })

  it('persists notification claims and does not resend uncertain deliveries on restart', async () => {
    decide = ({ situation }) => decision(situation, { disposition: 'notify', summary: 'The kitchen needs attention.' })
    deliver = () => {
      const durable = JSON.parse(fs.readFileSync(path.join(directory, 'autonomy.json'), 'utf8'))
      expect(durable.actionHistory[0].disposition).to.equal('notify')
      throw new Error('delivery status unknown')
    }
    await runtime.tick()
    const originalId = notifications[0].situation.id
    runtime = makeRuntime()
    enabled = false
    currentTime += MINUTE
    await runtime.tick()
    expect(notifications).to.have.length(1)
    expect(runtime.snapshot().situations.find(item => item.id === originalId).outcome).to.equal('delivery_unknown')
  })

  it('bounds attention, effects, evidence, and query output during an event storm', async function () {
    // This deliberately crosses the 1,200-record queue bound with real fsyncs.
    // Its runtime depends on storage latency, not just JavaScript CPU time.
    this.timeout(15000)
    enabled = false
    states = []
    for (let i = 0; i < LIMITS.evidence + 100; i++) {
      currentTime += 10
      runtime.ingestState(state({ objectId: `light.${i % 10}`, area: `room-${i % 10}`, value: String(i) }))
    }
    await runtime.tick()
    const world = runtime.snapshot()
    expect(world.evidence.length).to.be.at.most(LIMITS.evidence)
    expect(world.situations.length).to.be.at.most(LIMITS.situations)
    expect(world.episodes.length).to.be.at.most(LIMITS.episodes)
    expect(world.entities.length).to.be.at.most(LIMITS.entities)
    for (const entity of world.entities) expect(world.evidence.some(item => item.id === entity.evidenceId)).to.equal(true)
    expect(JSON.stringify(runtime.query({ operation: 'search', query: 'light', limit: 10000 })).length).to.be.at.most(12000)

    enabled = true
    decide = ({ situation }) => decision(situation, { disposition: 'notify', summary: 'Review device state.' })
    for (let i = 0; i < 40; i++) {
      currentTime += MINUTE
      states = [state({ objectId: `light.rate${i}`, area: `new-room-${i}`, value: String(i) })]
      await runtime.tick()
    }
    expect(reasons.length).to.be.at.most(LIMITS.reasonsPerHour)
    expect(notifications.length).to.be.at.most(LIMITS.effectsPerHour)
  })

  it('keeps durable effect records when resetting derived attention, and refuses corrupted persistence', async () => {
    decide = ({ situation }) => actionDecision(situation)
    await runtime.tick()
    const reset = runtime.reset()
    expect(reset.actionHistory).to.have.length(1)
    expect(reset.situations.find(item => item.claim).status).to.equal('verifying')
    fs.writeFileSync(path.join(directory, 'autonomy.json'), '{invalid')
    expect(() => makeRuntime()).to.throw('Cannot safely read autonomy store')
  })
})
