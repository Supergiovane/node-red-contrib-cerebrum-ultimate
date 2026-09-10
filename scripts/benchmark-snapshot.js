'use strict'

// Real chat -> camera -> HTTP response, with synthetic history and local stubs.
// No real cameras, model requests or user storage are accessed.
const assert = require('assert').strict
const fs = require('fs')
const os = require('os')
const path = require('path')
const { EventEmitter } = require('events')
const simpleGet = require('simple-get')
const { getCerebrumCameraAdapterRegistry } = require('../nodes/utils/cerebrumCamera')
const { serializeCerebrumCompactHistoryRecord } = require('../nodes/utils/cerebrumEventHistory')

async function main () {
  const historyMiB = Number(process.argv[2] || 96)
  const imageMiB = Number(process.argv[3] || 4)
  const mode = String(process.argv[4] || 'event')
  assert(historyMiB > 0 && historyMiB <= 512 && imageMiB > 0 && imageMiB <= 6)
  assert(['event', 'current'].includes(mode))
  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cerebrum-snapshot-benchmark-'))
  const original = { concat: simpleGet.concat, readFileSync: fs.readFileSync, readSync: fs.readSync, toJSON: Buffer.prototype.toJSON }
  const registry = getCerebrumCameraAdapterRegistry()
  const routes = new Map()
  const noop = () => {}
  let node; let Constructor; let peakHeap = 0; let peakRss = 0; let historyReads = 0; let modelCalls = 0; let snapshotCalls = 0
  let eventQueries = 0
  const sample = () => {
    const memory = process.memoryUsage()
    peakHeap = Math.max(peakHeap, memory.heapUsed)
    peakRss = Math.max(peakRss, memory.rss)
  }
  const providerId = 'benchmark-camera:provider'
  const image = Buffer.alloc(Math.round(imageMiB * 1024 ** 2), 127)
  const eventAt = new Date(Date.now() - 60000).toISOString()
  try {
    registry.registerProvider({
      id: providerId,
      adapterId: 'benchmark-camera',
      eventRetention: 'none',
      listCameras: async () => [{ id: 'benchmark-camera:entrance', name: 'Entrance', online: true }],
      takeSnapshot: async () => { assert.equal(mode, 'current'); snapshotCalls++; sample(); return { data: image, mediaType: 'image/jpeg' } },
      queryEvents: async () => {
        eventQueries++
        return { events: [{ providerId, cameraId: 'benchmark-camera:entrance', cameraName: 'Entrance', eventId: 'benchmark-event', eventType: 'motion', at: eventAt, thumbnailAvailable: true }], hasMore: false }
      },
      takeEventSnapshot: async request => {
        assert.equal(mode, 'event')
        assert.equal(request.eventId, 'benchmark-event')
        snapshotCalls++
        sample()
        return { data: image, mediaType: 'image/jpeg', eventId: request.eventId }
      }
    })
    require('../nodes/cerebrumUltimate')({
      auth: { needsPermission: () => noop },
      httpAdmin: { get: noop, post: (url, ...handlers) => routes.set(url, handlers.at(-1)), use: noop },
      settings: { userDir },
      nodes: {
        getNode: noop,
        registerType: (type, value) => { if (type === 'cerebrumUltimate') Constructor = value },
        createNode: target => {
          const emitter = new EventEmitter()
          Object.assign(target, {
            id: 'snapshot-benchmark',
            type: 'cerebrumUltimate',
            credentials: { llmApiKey: 'benchmark-only' },
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
      util: { cloneMessage: value => structuredClone(value) }
    })
    node = new Constructor({ llmEnabled: true, llmProvider: 'openai_compat', llmBaseUrl: 'https://llm.invalid/v1/chat/completions', llmModel: 'test-model', llmMaxTokens: 1200, llmContextLength: 32768 })
    node.cerebrumAutonomyEnabled = false
    await node._autonomyRuntime.tick()
    const historyDir = path.join(node.cerebrumStorageDir, 'cerebrum', 'history', node.id)
    fs.mkdirSync(historyDir, { recursive: true })
    const now = new Date()
    const day = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-')
    const historyFile = path.join(historyDir, `${day}.knxctx`)
    const row = serializeCerebrumCompactHistoryRecord({ ts: Date.now() - 60000, event: 'GroupValue_Response', source: '1.1.1', destination: '1/2/3', dpt: '9.001', devicename: 'Temperature', payload: 20, dptdesc: 'x'.repeat(800) }, 'knx') + '\n'
    const batch = row.repeat(1000)
    const batches = Math.ceil(historyMiB * 1024 ** 2 / Buffer.byteLength(batch))
    const fd = fs.openSync(historyFile, 'w')
    try { for (let index = 0; index < batches; index++) fs.writeSync(fd, batch) } finally { fs.closeSync(fd) }
    simpleGet.concat = (options, callback) => {
      modelCalls++
      sample()
      assert(options.body.includes(`kind=knx | total=${batches * 1000}`), 'All historical events must remain counted')
      const cameraAction = mode === 'current'
        ? { type: 'snapshot', camera: 'Entrance' }
        : modelCalls === 1
          ? { type: 'query_events', camera: 'Entrance', eventType: 'motion' }
          : { type: 'event_snapshot', camera: 'Entrance', providerId, eventId: 'benchmark-event' }
      const answer = { reply: '', language: 'en', cameraActions: [cameraAction], commands: [] }
      callback(null, { statusCode: 200, headers: {} }, Buffer.from(JSON.stringify({ choices: [{ message: { content: JSON.stringify(answer) } }] })))
    }
    fs.readFileSync = (...args) => { const result = original.readFileSync(...args); if (args[0] === historyFile) { historyReads++; sample() }; return result }
    let chunkReads = 0
    fs.readSync = (...args) => { const result = original.readSync(...args); if (++chunkReads % 64 === 0) sample(); return result }
    Buffer.prototype.toJSON = function () { const result = original.toJSON.call(this); sample(); return result }
    if (global.gc) global.gc()
    sample()
    const before = process.memoryUsage()
    let responseBytes = 0
    let statusCode = 200
    const res = {
      status: code => { statusCode = code; return res },
      json: result => {
        assert.equal(statusCode, 200, result.error)
        assert.equal(result.metadata.type, mode === 'event' ? 'camera_event_snapshot' : 'camera_snapshot', result.answer)
        const data = result.metadata.image.data
        assert(Buffer.isBuffer(data) ? data.equals(image) : Buffer.from(data, 'base64').equals(image))
        responseBytes = Buffer.byteLength(JSON.stringify(result))
        sample()
      }
    }
    await routes.get('/cerebrumUltimate/sidebar/ask')({ body: { nodeId: node.id, question: mode === 'event' ? 'Show the snapshot of the last recorded motion at Entrance' : 'Send me a snapshot of Entrance' } }, res)
    assert.equal(modelCalls, mode === 'event' ? 2 : 1)
    assert.equal(eventQueries, mode === 'event' ? 1 : 0)
    assert.equal(snapshotCalls, 1)
    assert.equal(node._pendingCameraRequests.size, 0)
    assert.equal(node._sidebarAskCaptures.size, 0)
    sample()
    if (global.gc) global.gc()
    const mib = bytes => Number((bytes / 1024 ** 2).toFixed(1))
    process.stdout.write(JSON.stringify({ nodeVersion: process.version, mode, historyMiB: mib(fs.statSync(historyFile).size), historyRecords: batches * 1000, imageMiB, modelCalls, eventQueries, snapshotCalls, wholeHistoryReads: historyReads, beforeHeapMiB: mib(before.heapUsed), peakHeapMiB: mib(peakHeap), peakRssMiB: mib(peakRss), retainedHeapMiB: global.gc ? mib(process.memoryUsage().heapUsed) : null, responseMiB: mib(responseBytes) }, null, 2) + '\n')
  } finally {
    simpleGet.concat = original.concat
    fs.readFileSync = original.readFileSync
    fs.readSync = original.readSync
    Buffer.prototype.toJSON = original.toJSON
    registry.unregisterProvider(providerId)
    if (node) await new Promise(resolve => node.emit('close', resolve))
    fs.rmSync(userDir, { recursive: true, force: true })
  }
}

main().catch(error => { process.stderr.write(`${error.stack}\n`); process.exitCode = 1 })
