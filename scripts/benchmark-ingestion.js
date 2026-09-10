'use strict'

// Synthetic KNX traffic through the real node, including local archiving.
// No gateway, model or network calls; all runtime files go to a temporary home.
const assert = require('assert')
const { EventEmitter } = require('events')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { performance } = require('perf_hooks')

async function main () {
  const entityCount = Number(process.argv[2] || 300)
  const eventCount = Number(process.argv[3] || 600)
  let peakHeapBytes = 0
  let peakRssBytes = 0
  let peakTransitionEdges = 0
  assert(Number.isInteger(entityCount) && entityCount > 0 && entityCount <= 600, 'Use 1..600 entities')
  assert(Number.isInteger(eventCount) && eventCount >= entityCount, 'Use at least one event per entity')
  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cerebrum-ingestion-benchmark-'))
  const noop = () => {}
  const failures = []
  const gateway = {
    id: 'benchmark-gateway',
    csv: Array.from({ length: entityCount }, (_, index) => ({
      ga: `1/${Math.floor(index / 256)}/${index % 256}`,
      dpt: '9.001',
      devicename: `Casa/Stanza ${index}/Temperatura`
    })),
    addClient: noop,
    removeClient: noop
  }
  let Constructor
  let node
  const RED = {
    auth: { needsPermission: () => noop },
    httpAdmin: { get: noop, post: noop, use: noop },
    settings: { userDir, httpAdminRoot: '/' },
    nodes: {
      getNode: id => id === gateway.id ? gateway : undefined,
      registerType: (type, value) => { if (type === 'cerebrumUltimate') Constructor = value },
      createNode: target => {
        const emitter = new EventEmitter()
        Object.assign(target, {
          id: 'ingestion-benchmark',
          type: 'cerebrumUltimate',
          credentials: {},
          on: emitter.on.bind(emitter),
          emit: emitter.emit.bind(emitter),
          status: noop,
          warn: message => failures.push(String(message)),
          error: message => failures.push(String(message)),
          send: outputs => {
            const request = outputs[5]
            if (request?.cerebrum?.direction === 'request') {
              queueMicrotask(() => target.emit('input', { ...request, payload: [] }, noop, noop))
            }
          },
          log: noop
        })
      }
    },
    util: { cloneMessage: message => JSON.parse(JSON.stringify(message)) }
  }
  try {
    require('../nodes/cerebrumUltimate')(RED)
    node = new Constructor({
      name: 'Ingestion benchmark',
      server: gateway.id,
      llmEnabled: false,
      llmAllowKnxCommands: false,
      etsExposeConfigured: true,
      etsExposedGAs: gateway.csv.map(item => item.ga),
      etsReadOnlyGAs: gateway.csv.map(item => item.ga)
    })
    node.sysLogger = { warn: message => failures.push(String(message)), error: message => failures.push(String(message)), info: noop, debug: noop }
    await node._autonomyRuntime.tick()
    const sampleMemory = () => {
      const memory = process.memoryUsage()
      peakHeapBytes = Math.max(peakHeapBytes, memory.heapUsed)
      peakRssBytes = Math.max(peakRssBytes, memory.rss)
      peakTransitionEdges = Math.max(peakTransitionEdges, node._transitionStats.size)
    }
    const ingest = (index, value) => node.handleSend({
      knx: { event: 'GroupValue_Response', source: '1.1.1', destination: gateway.csv[index % entityCount].ga, dpt: '9.001' },
      payload: value
    })
    for (let index = 0; index < entityCount; index++) {
      ingest(index, 20)
      if (index % 50 === 49) sampleMemory()
    }
    await node._autonomyRuntime.tick()
    const results = []
    for (const scenario of ['unchanged', 'changing']) {
      const started = performance.now()
      const cpu = process.cpuUsage()
      for (let index = 0; index < eventCount; index++) {
        ingest(index, scenario === 'unchanged' ? 20 : 21 + Math.floor(index / entityCount) % 2)
        if (index % 50 === 49) {
          sampleMemory()
          await new Promise(resolve => setImmediate(resolve))
        }
      }
      await node._autonomyRuntime.tick()
      await node.getCerebrumMemoryFile()
      const used = process.cpuUsage(cpu)
      const cpuMs = (used.user + used.system) / 1000
      results.push({
        scenario,
        events: eventCount,
        elapsedMs: Math.round(performance.now() - started),
        cpuMs: Math.round(cpuMs),
        cpuMsPerEvent: Number((cpuMs / eventCount).toFixed(3))
      })
    }
    assert.strictEqual(node._homeMemory.states.length, entityCount)
    assert(node._homeMemory.observations.length > 0)
    assert(node._autonomyRuntime.snapshot().evidence.length > 0)
    const archivePath = path.join(userDir, 'cerebrumultimatestorage', 'cerebrum', 'memory', 'shared', 'cerebrum-memory.jsonl')
    const records = fs.readFileSync(archivePath, 'utf8').trim().split('\n').map(line => JSON.parse(line))
    const raw = records.filter(record => record.kind === 'knx')
    const observations = records.filter(record => record.kind === 'observation')
    assert.strictEqual(raw.length, entityCount + eventCount * 2, 'Every raw event must remain archived')
    assert.strictEqual(observations.length, entityCount + eventCount, 'Unchanged values refresh state without inventing transitions')
    const evidenceIds = new Set(raw.map(record => record.id))
    for (const observation of observations) {
      assert(observation.data.evidenceIds.every(id => evidenceIds.has(id)), 'Observation evidence must resolve to raw history')
    }
    assert.deepStrictEqual(failures, [])
    sampleMemory()
    if (typeof global.gc === 'function') global.gc()
    const memory = {
      peakHeapMiB: Number((peakHeapBytes / 1024 ** 2).toFixed(1)),
      peakRssMiB: Number((peakRssBytes / 1024 ** 2).toFixed(1)),
      retainedHeapMiB: typeof global.gc === 'function' ? Number((process.memoryUsage().heapUsed / 1024 ** 2).toFixed(1)) : null,
      peakTransitionEdges,
      retainedTransitionEdges: node._transitionStats.size,
      retainedRateSeries: node._gaRateSeries.size
    }
    process.stdout.write(JSON.stringify({ entityCount, nodeVersion: process.version, results, memory }, null, 2) + '\n')
  } finally {
    if (node) await new Promise(resolve => node.emit('close', resolve))
    fs.rmSync(userDir, { recursive: true, force: true })
  }
}

main().catch(error => { process.stderr.write(`${error.stack}\n`); process.exitCode = 1 })
