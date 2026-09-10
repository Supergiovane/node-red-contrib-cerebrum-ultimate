'use strict'
/* eslint-env mocha */
const assert = require('assert').strict
const fs = require('fs')
const os = require('os')
const path = require('path')
const { createCerebrumAutomationFiles } = require('../nodes/utils/cerebrumAutomationFiles')
const { createCerebrumAutomationRuntime, createInterpreter, nextDailyDeadline, nextRuleDeadline } = require('../nodes/utils/cerebrumAutomationRuntime')
const { executeAutomationAction } = require('../nodes/utils/cerebrumAutomationTool')

describe('Persistent local JavaScript automations', function () {
  this.timeout(10000)
  let root, files, runtime, at, messages, writes, archive, allowed, education
  const make = options => createCerebrumAutomationRuntime({
    files,
    filePath: path.join(root, 'runtime.json'),
    now: () => at,
    intervalMs: 0,
    archive: record => archive.push(JSON.parse(JSON.stringify(record))),
    states: () => ({ 'knx:1/2/3': { value: 'true', fresh: true, changedAt: new Date(at).toISOString() } }),
    education: () => education,
    authorize: ({ targets }) => { if (targets.length && !allowed) throw new Error('Current device permissions deny writing') },
    write: async request => writes.push(request),
    notify: async request => { messages.push(request); return true },
    ...options
  })
  const create = (code, extra = {}) => executeAutomationAction(runtime, { operation: 'create', name: 'rule.js', code, ...extra }, { sessionId: 'chat:42', authority: 'user' })
  const manage = operation => runtime.manage({ ...runtime.read({ name: 'rule.js' }), operation })
  const step = async milliseconds => { at += milliseconds; await runtime.tick(); await runtime.drain() }
  const event = { source: 'knx', objectId: '1/2/3', event: 'GroupValue_Response', value: true, changed: true }
  const fakeScheduler = () => {
    let sequence = 0
    const pending = new Map()
    const setTimeoutFn = (callback, delay) => {
      const handle = { id: ++sequence, callback, delay, unref () {} }
      pending.set(handle.id, handle)
      return handle
    }
    const clearTimeoutFn = handle => { if (handle) pending.delete(handle.id) }
    const next = () => [...pending.values()].sort((left, right) => left.delay - right.delay)[0]
    const fire = async (handle = next()) => {
      assert.ok(handle, 'expected an armed scheduler deadline')
      pending.delete(handle.id)
      at += handle.delay
      await handle.callback()
    }
    return { pending, setTimeoutFn, clearTimeoutFn, next, fire }
  }
  beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cerebrum-local-js-')))
    files = createCerebrumAutomationFiles({ directory: path.join(root, 'sources') })
    at = Date.parse('2026-09-08T19:00:00Z')
    messages = []; writes = []; archive = []; allowed = true; education = 'Notify on the observed window state.'
    runtime = make()
  })
  afterEach(async () => { await runtime.close(); fs.rmSync(root, { recursive: true, force: true }) })

  it('creates actual AI-authored source and runs schedules without an LLM dependency', async () => {
    const result = await create('module.exports = c => { c.describe("Promemoria"); c.schedule.every("minute", 60000, () => c.notify("Controlla la finestra")) }')
    assert.equal(result.status, 'active')
    assert.equal(runtime.list().files[0].author, 'cerebrum')
    assert.match(fs.readFileSync(runtime.read({ name: 'rule.js' }).path, 'utf8'), /module.exports/)
    await step(60000)
    assert.equal(messages[0].text, 'Controlla la finestra')
    assert.equal(messages[0].sessionId, 'chat:42')
    assert.ok(runtime.list().files[0].lastRunAt)
    let offset = 0
    let source = ''
    do {
      const page = await executeAutomationAction(runtime, { operation: 'get', name: 'rule.js', offset }, { byteBudget: 768 })
      assert.ok(Buffer.byteLength(JSON.stringify(page)) <= 768)
      source += page.content
      offset = page.nextOffset
    } while (offset !== null)
    assert.equal(source, runtime.read({ name: 'rule.js' }).content)
    await runtime.tick(); await runtime.drain()
    assert.equal(messages.length, 1)
  })

  it('keeps 08:40 scheduling local and invokes semantic weather/TTS work only when due', async () => {
    const tasks = []; const speech = []
    await runtime.close()
    at = Date.parse('2026-09-08T06:39:00Z')
    runtime = make({ assistant: async request => { tasks.push(request); assert.equal(request.isCancelled(), false) }, speak: async request => speech.push(request) })
    await create('module.exports = c => { c.schedule.daily("weather", {at:"08:40",timeZone:"Europe/Rome"}, () => c.assistant.run("Annuncia via TTS il meteo aggiornato; pioggia KNX 2/3/0 e temperatura 2/3/1; pronuncia unità e date")); c.onEvent("voice",{source:"test"},()=>c.speak("Diciotto gradi Celsius")) }')
    await step(59000); assert.equal(tasks.length, 0)
    await step(1000); assert.equal(tasks.length, 1)
    assert.match(tasks[0].instruction, /2\/3\/0/)
    await step(1000); assert.equal(tasks.length, 1)
    runtime.ingest({ source: 'test' }); await runtime.drain()
    assert.equal(speech[0].text, 'Diciotto gradi Celsius')
    await manage('pause'); assert.equal(tasks[0].isCancelled(), true)
    await step(86400000); assert.equal(tasks.length, 1)
  })

  it('arms one event-driven timer at the next deadline and validates source changes only when due', async () => {
    await runtime.close()
    const scheduler = fakeScheduler()
    let sourceReads = 0
    const monitoredFiles = {
      ...files,
      read: options => { sourceReads++; return files.read(options) }
    }
    runtime = make({ files: monitoredFiles, intervalMs: 1, setTimeoutFn: scheduler.setTimeoutFn, clearTimeoutFn: scheduler.clearTimeoutFn })
    await create('module.exports = c => c.schedule.every("future", 60000, () => c.notify("due"))')
    assert.equal(scheduler.pending.size, 1)
    assert.equal(scheduler.next().delay, 60000)
    const readsAfterActivation = sourceReads

    const file = files.read({ name: 'rule.js' })
    fs.writeFileSync(file.path, file.content.replace('"due"', '"external"'))
    await scheduler.fire()
    await runtime.drain()
    assert.equal(messages.length, 0)
    assert.match(runtime.read({ name: 'rule.js' }).error, /Source changed/)
    assert.ok(sourceReads > readsAfterActivation)
    assert.equal(scheduler.pending.size, 0)
  })

  it('keeps event-only automations asleep, exposes copied filters, and rearms when an event creates a timer', async () => {
    await runtime.close()
    const scheduler = fakeScheduler()
    runtime = make({ intervalMs: 1, setTimeoutFn: scheduler.setTimeoutFn, clearTimeoutFn: scheduler.clearTimeoutFn })
    await create('module.exports = c => { c.onEvent("camera", {source:"unifi-ultimate",objectId:"camera-1",event:"motion"}, () => {}); c.onState("observe", ["knx:1/2/3"], () => c.timers.ensureAt("later", c.now()+10000)); c.timers.define("later", () => c.notify("timer")) }')
    assert.equal(scheduler.pending.size, 0)
    assert.deepEqual(runtime.eventSources(), ['knx', 'unifi-ultimate'])
    const filters = runtime.eventFilters()
    assert.deepEqual(filters.map(item => ({ kind: item.kind, source: item.source })), [
      { kind: 'state', source: 'knx' },
      { kind: 'event', source: 'unifi-ultimate' }
    ])
    filters[0].source = 'tampered'
    filters[0].entityIds.push('knx:9/9/9')
    assert.deepEqual(runtime.eventSources(), ['knx', 'unifi-ultimate'])

    runtime.ingest(event)
    await runtime.drain()
    assert.equal(scheduler.pending.size, 1)
    assert.equal(scheduler.next().delay, 10000)
    await scheduler.fire()
    await runtime.drain()
    assert.equal(messages[0].text, 'timer')
    assert.equal(scheduler.pending.size, 0)
  })

  it('notifies event-filter changes asynchronously, deduplicates them, and isolates callback failures', async () => {
    await runtime.close()
    const scheduler = fakeScheduler()
    const changes = []
    runtime = make({
      intervalMs: 1,
      setTimeoutFn: scheduler.setTimeoutFn,
      clearTimeoutFn: scheduler.clearTimeoutFn,
      onEventFiltersChanged: snapshot => {
        changes.push(snapshot)
        if (changes.length === 1) throw new Error('consumer unavailable')
      }
    })
    await create('module.exports = c => c.onEvent("camera", {source:"unifi-ultimate",event:"motion"}, () => {})')
    await new Promise(resolve => setImmediate(resolve))
    assert.deepEqual(changes.map(change => change.sources), [['unifi-ultimate']])
    assert.deepEqual(runtime.eventSources(), ['unifi-ultimate'])

    await manage('pause')
    await new Promise(resolve => setImmediate(resolve))
    assert.deepEqual(changes.map(change => change.sources), [['unifi-ultimate'], []])
    await manage('resume')
    await new Promise(resolve => setImmediate(resolve))
    assert.deepEqual(changes.map(change => change.sources), [['unifi-ultimate'], [], ['unifi-ultimate']])

    const file = files.read({ name: 'rule.js' })
    fs.writeFileSync(file.path, file.content.replace('motion', 'external'))
    runtime.ingest({ source: 'unifi-ultimate', event: 'motion' })
    await runtime.drain()
    await new Promise(resolve => setImmediate(resolve))
    assert.deepEqual(changes.map(change => change.sources), [['unifi-ultimate'], [], ['unifi-ultimate'], []])
    assert.match(runtime.read({ name: 'rule.js' }).error, /Source changed/)

    await manage('delete')
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(changes.length, 4)
  })

  it('computes exact civil deadlines across repeated and missing DST minutes', () => {
    const rule = { id: 'night', kind: 'daily', at: '02:30', timeZone: 'Europe/Rome' }
    const firstFallOccurrence = Date.parse('2026-10-25T00:30:00Z')
    assert.equal(nextDailyDeadline(rule, { cursors: { night: '' } }, Date.parse('2026-10-25T00:29:00Z')), firstFallOccurrence)
    assert.equal(nextDailyDeadline(rule, { cursors: { night: '' } }, Date.parse('2026-10-25T00:40:00Z')), Date.parse('2026-10-26T01:30:00Z'))
    assert.equal(nextDailyDeadline(rule, { cursors: { night: '' } }, Date.parse('2026-10-25T01:20:00Z')), Date.parse('2026-10-25T01:30:00Z'))
    assert.equal(nextDailyDeadline(rule, { cursors: { night: '2026-10-25' } }, firstFallOccurrence), Date.parse('2026-10-26T01:30:00Z'))
    assert.equal(nextDailyDeadline(rule, { cursors: { night: '' } }, Date.parse('2026-03-29T00:29:00Z')), Date.parse('2026-03-30T00:30:00Z'))

    const timestamp = Date.parse('2026-09-08T19:00:00Z')
    assert.equal(nextRuleDeadline({ id: 'every', kind: 'every', milliseconds: 60000 }, { cursors: { every: timestamp + 5000 } }, timestamp), timestamp + 5000)
    assert.equal(nextRuleDeadline({ id: 'once', kind: 'at', timestamp: timestamp + 3000 }, { cursors: {} }, timestamp), timestamp + 3000)
    assert.equal(nextRuleDeadline({ id: 'later', kind: 'timer' }, { timers: { later: timestamp + 1000 } }, timestamp), timestamp + 1000)
    assert.equal(nextRuleDeadline({ id: 'event', kind: 'event' }, {}, timestamp), Number.POSITIVE_INFINITY)
  })

  it('cancels a pending deadline when the runtime closes', async () => {
    await runtime.close()
    const scheduler = fakeScheduler()
    runtime = make({ intervalMs: 1, setTimeoutFn: scheduler.setTimeoutFn, clearTimeoutFn: scheduler.clearTimeoutFn })
    await create('module.exports = c => c.schedule.every("future", 60000, () => c.notify("due"))')
    assert.equal(scheduler.pending.size, 1)
    await runtime.close()
    assert.equal(scheduler.pending.size, 0)
  })

  it('persists timer deadlines and memory across restart without duplicate interval effects', async () => {
    await create('module.exports = c => { c.describe("Window"); c.onState("observe", ["knx:1/2/3"], () => { c.memory.set("seen", true); c.timers.ensureAt("later", c.now()+10000) }); c.timers.define("later", () => { if (c.memory.get("seen")) c.notify("Still open") }) }')
    runtime.ingest(event); await runtime.drain()
    await step(4000)
    runtime.ingest(event); await runtime.drain() // ensureAt must not postpone.
    await runtime.close(); runtime = make()
    await step(6000)
    assert.equal(messages.length, 1)
    await runtime.close(); runtime = make()
    await step(1000)
    assert.equal(messages.length, 1)
  })

  it('pauses and resumes across restart, edits active code, and archives deletion', async () => {
    await create('module.exports = c => { c.describe("Ping"); c.schedule.every("pulse", 1000, () => c.notify("one")) }')
    await manage('pause')
    await runtime.close(); runtime = make()
    await step(1000); assert.equal(messages.length, 0)
    assert.equal(runtime.read({ name: 'rule.js' }).status, 'paused')
    await manage('resume'); await step(1000)
    assert.equal(messages[0].text, 'one')
    const file = runtime.read({ name: 'rule.js' })
    const updated = await runtime.save({ ...file, content: file.content.replace('"one"', '"two"') })
    assert.equal(updated.status, 'active')
    await step(1000); assert.equal(messages[1].text, 'two')
    await manage('delete'); await step(1000)
    assert.equal(runtime.list().files.length, 0)
    assert.equal(runtime.summary()[0].status, 'deleted')
    assert.equal(messages.length, 2)
  })

  it('fences an in-flight callback and queued events when the user pauses', async () => {
    await create('module.exports = c => { c.onState("change", ["knx:1/2/3"], () => { let n=0; for(let i=0;i<300000;i++) n++; c.notify(String(n)) }) }')
    runtime.ingest(event)
    await new Promise(resolve => setImmediate(resolve))
    runtime.ingest(event)
    await manage('pause')
    await runtime.drain()
    assert.equal(messages.length, 0)
    assert.equal(runtime.read({ name: 'rule.js' }).status, 'paused')
  })

  it('keeps a pause authoritative when a code save is still being validated', async () => {
    await create('module.exports = c => c.schedule.every("pulse", 1000, () => c.notify("one"))')
    const file = runtime.read({ name: 'rule.js' })
    const saving = runtime.save({ ...file, content: file.content.replace('one', 'two') })
    await manage('pause')
    await assert.rejects(saving, /cancelled/)
    assert.equal(runtime.read({ name: 'rule.js' }).revision, file.revision)
    await step(1000); assert.equal(messages.length, 0)
  })

  it('stops on external source changes and preserves stale editor buffers with a conflict', async () => {
    await create('module.exports = c => c.schedule.every("pulse", 1000, () => c.notify("one"))')
    const file = runtime.read({ name: 'rule.js' })
    fs.writeFileSync(file.path, file.content.replace('one', 'external'))
    await step(1000)
    assert.equal(messages.length, 0)
    assert.equal(runtime.read({ name: 'rule.js' }).status, 'error')
    await assert.rejects(runtime.save({ ...file, content: '// stale' }), error => error.status === 409)
    await manage('resume'); await step(1000)
    assert.equal(messages[0].text, 'external')
  })

  it('checks current permissions on execution and rejects undeclared device targets', async () => {
    await create('module.exports = c => { c.targets(["knx:1/2/4"]); c.onState("change", ["knx:1/2/3"], () => c.actions.write("knx:1/2/4", false)) }')
    allowed = false
    runtime.ingest(event); await runtime.drain()
    assert.equal(writes.length, 0)
    assert.equal(runtime.read({ name: 'rule.js' }).status, 'error')
    allowed = true; await manage('resume')
    runtime.ingest(event); await runtime.drain()
    assert.equal(writes.length, 1)
    const file = runtime.read({ name: 'rule.js' })
    await runtime.save({ ...file, content: file.content.replace('write("knx:1/2/4"', 'write("knx:9/9/9"') })
    runtime.ingest(event); await runtime.drain()
    assert.equal(writes.length, 1)
    assert.match(runtime.read({ name: 'rule.js' }).error, /not declared/)
  })

  it('invalidates changed education and prevents background replacement or resurrection', async () => {
    const code = 'module.exports = c => c.schedule.every("pulse", 1000, () => c.notify("one"))'
    await executeAutomationAction(runtime, { operation: 'create', name: 'rule.js', code }, { authority: 'education' })
    education = 'Pause former instructions.'
    await step(1000)
    assert.equal(messages.length, 0)
    assert.match(runtime.read({ name: 'rule.js' }).error, /Education changed/)
    await manage('delete')
    const recreated = await executeAutomationAction(runtime, { operation: 'create', name: 'rule.js', code }, { authority: 'education' })
    assert.equal(recreated.ok, false)
    assert.equal(runtime.list().files.length, 0)
  })

  it('matches plugin events without invoking callbacks for unrelated sources', async () => {
    await create('module.exports = c => c.onEvent("camera", {source:"unifi-ultimate",objectId:"camera-1",event:"motion"}, event => { if(event.value) c.notify("Movimento") })')
    runtime.ingest({ source: 'knx', objectId: 'camera-1', event: 'motion', value: true })
    runtime.ingest({ source: 'unifi-ultimate', objectId: 'camera-1', event: 'motion', value: false })
    runtime.ingest({ source: 'unifi-ultimate', objectId: 'camera-1', event: 'motion', value: true })
    await runtime.drain()
    assert.equal(messages.length, 1)
  })

  it('runs daily schedules once per civil day and skips missed jobs and repeated DST hours', async () => {
    at = Date.parse('2026-10-25T00:29:00Z')
    await create('module.exports = c => c.schedule.daily("night", {at:"02:30",timeZone:"Europe/Rome"}, () => c.notify("daily"))')
    await step(60000); assert.equal(messages.length, 1)
    await manage('pause'); await manage('resume'); await step(1000)
    assert.equal(messages.length, 1)
    await step(3599000); assert.equal(messages.length, 1)
    await runtime.close(); runtime = make()
    await step(25 * 3600000); assert.equal(messages.length, 1)
  })

  it('does not retry uncertain effects after restart', async () => {
    await runtime.close(); runtime = make({ notify: async () => { throw Error('Delivery uncertain') } })
    await create('module.exports = c => c.schedule.at("once", 1788894001000, () => c.notify("once"))')
    // Use the current clock rather than coupling the assertion to a timestamp.
    const file = runtime.read({ name: 'rule.js' })
    await runtime.save({ ...file, content: file.content.replace('1788894001000', String(at + 1000)) })
    await step(1000)
    assert.equal(runtime.read({ name: 'rule.js' }).status, 'error')
    assert.ok(archive.some(record => record.phase === 'effect_claimed'))
    await runtime.close(); runtime = make(); await step(1000)
    assert.equal(messages.length, 0)
  })

  it('rejects registration effects, async handlers, host access and infinite loops', async () => {
    for (const code of [
      'module.exports = c => { c.notify("bad"); c.schedule.every("p",1000,()=>{}) }',
      'module.exports = async c => c.schedule.every("p",1000,()=>{})',
      'module.exports = c => { require("fs"); c.schedule.every("p",1000,()=>{}) }',
      'module.exports = c => { process.exit(); c.schedule.every("p",1000,()=>{}) }',
      'while(true) {}'
    ]) {
      assert.equal((await create(code)).ok, false)
      assert.equal(runtime.list().files.length, 0)
    }
    const interpreter = createInterpreter()
    try {
      const result = await interpreter.run('module.exports = c => c.schedule.every("p", 1000, () => c.notify([typeof process, typeof require, typeof node, typeof RED].join(",")))', { now: at, handler: 'p', event: {}, states: {}, memory: {} })
      assert.equal(result.effects[0].text, 'undefined,undefined,undefined,undefined')
    } finally { await interpreter.close() }
  })
})
