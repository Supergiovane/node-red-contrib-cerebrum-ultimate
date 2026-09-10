'use strict'
/* eslint-env mocha */

const assert = require('assert').strict
const { EventEmitter } = require('events')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { parseCerebrumHomeMemoryMarkdownStrict } = require('../nodes/utils/homeMemory')

// Record real timer registrations without changing Node's clock or scheduling.
// Patches only surround synchronous construction/ingestion and are then restored.
const captureTimers = work => {
  const timers = new Map()
  const original = { setTimeout: global.setTimeout, setInterval: global.setInterval }
  for (const name of Object.keys(original)) {
    global[name] = (callback, delay, ...args) => {
      const timer = original[name](callback, delay, ...args)
      timers.set(timer, { kind: name, callback, delay })
      return timer
    }
  }
  try { return { result: work(), timers } } finally { Object.assign(global, original) }
}

describe('Cerebrum background resource use', function () {
  this.timeout(15000)
  let node, userDir
  const noop = () => {}
  const construct = gateway => {
    userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cerebrum-resources-'))
    let Constructor
    const RED = {
      auth: { needsPermission: () => noop },
      httpAdmin: { get: noop, post: noop, use: noop },
      settings: { userDir, httpAdminRoot: '/' },
      nodes: {
        getNode: id => id === gateway?.id ? gateway : undefined,
        registerType: (type, value) => { if (type === 'cerebrumUltimate') Constructor = value },
        createNode: target => {
          const emitter = new EventEmitter()
          Object.assign(target, {
            id: 'resource-test',
            type: 'cerebrumUltimate',
            credentials: {},
            on: emitter.on.bind(emitter),
            emit: emitter.emit.bind(emitter),
            status: noop,
            warn: noop,
            error: noop,
            log: noop,
            send: outputs => {
              const request = outputs[5]
              if (request?.cerebrum?.direction === 'request') queueMicrotask(() => target.emit('input', { ...request, payload: [] }))
            }
          })
        }
      },
      util: { cloneMessage: message => JSON.parse(JSON.stringify(message)) }
    }
    require('../nodes/cerebrumUltimate')(RED)
    node = new Constructor({
      server: gateway?.id || '',
      llmEnabled: false,
      llmAllowKnxCommands: false,
      etsExposeConfigured: true,
      etsExposedGAs: (gateway?.csv || []).map(item => item.ga),
      etsReadOnlyGAs: (gateway?.csv || []).map(item => item.ga)
    })
    return node
  }
  const records = () => fs.readFileSync(node._sharedMemoryArchivePath, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
  const telegram = (destination, payload = 20) => ({ knx: { destination, source: '1.1.1', event: 'GroupValue_Response', dpt: '9.001' }, payload })

  afterEach(async () => {
    if (node) await new Promise(resolve => node.emit('close', resolve))
    if (userDir) fs.rmSync(userDir, { recursive: true, force: true })
    node = null
    userDir = null
  })

  it('keeps background checks relaxed and does not arm suspended work or an absent gateway', () => {
    const { timers } = captureTimers(() => construct())
    assert.equal(node._busConnectionWatchTimer, null)
    assert.equal(node._proactiveCheckTimer, null)
    assert.equal(node._scheduleTickTimer, null)
    assert.equal(node._scheduleStartupTimer, null)
    assert.equal(timers.get(node._cerebrumStateTimer).delay, 30000)
    assert.equal(timers.get(node._homeAutomationRegistrySyncTimer).delay, 60000)
    assert.equal([...timers.values()].some(timer => timer.kind === 'setInterval' && timer.delay < 30000), false)
  })

  it('bounds live graph and rate caches with the dashboard closed while retaining every raw telegram', async () => {
    construct()
    for (let index = 0; index < 360; index++) {
      node.handleSend(telegram(`1/${Math.floor(index / 256)}/${index % 256}`))
      assert(node._transitionStats.size <= 500, 'Graph cache must be bounded during ingestion')
      assert(node._gaRateSeries.size <= 300, 'Rate cache must be bounded during ingestion')
      if (index % 30 === 29) await new Promise(resolve => setImmediate(resolve))
    }
    assert(node._transitionStats.size > 0)
    assert.equal(node._lastSummary, null, 'No dashboard read should be needed for the bounds')
    assert.equal(records().filter(record => record.kind === 'knx').length, 360)
  })

  it('coalesces derived memory saves at a fixed deadline while immediately archiving observations', async () => {
    const gateway = { id: 'test-gateway', csv: [{ ga: '1/2/3', dpt: '9.001', devicename: 'Kitchen temperature' }], addClient: noop, removeClient: noop }
    const initial = captureTimers(() => construct(gateway))
    assert.equal(initial.timers.get(node._busConnectionWatchTimer).delay, 5000)
    await node._autonomyRuntime.tick()
    // Finish the startup save before testing a new batch of live events.
    if (node._homeMemoryWriteTimer) {
      const timer = node._homeMemoryWriteTimer
      clearTimeout(timer)
      initial.timers.get(timer).callback()
    }
    const first = captureTimers(() => node.handleSend(telegram('1/2/3', 20)))
    const timer = node._homeMemoryWriteTimer
    assert.equal(first.timers.get(timer).delay, 10000)
    node.handleSend(telegram('1/2/3', 21))
    assert.equal(node._homeMemoryWriteTimer, timer, 'Traffic must not move the first save deadline')
    const archive = records()
    assert.equal(archive.filter(record => record.kind === 'knx').length, 2)
    assert.equal(archive.filter(record => record.kind === 'observation').length, 2)
    clearTimeout(timer)
    first.timers.get(timer).callback()
    const saved = parseCerebrumHomeMemoryMarkdownStrict(fs.readFileSync(path.join(userDir, 'cerebrumultimatestorage', 'cerebrum', 'memory', 'cerebrum-home-memory.md'), 'utf8'))
    assert.equal(saved.states.find(state => state.key === 'knx:1/2/3').value, '21')
    assert.equal(node._homeMemoryWriteTimer, null)
  })
})
