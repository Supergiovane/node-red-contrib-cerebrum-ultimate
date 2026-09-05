'use strict'
/* eslint-env mocha */
const { expect } = require('chai')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { EventEmitter } = require('events')
const { backupFile, createBackupUploads, validateSupplementalFiles, buildMigrationFlows } = require('../nodes/utils/cerebrumBackup')
const register = require('../nodes/cerebrumUltimate')
const { parseCerebrumChatContextFileStrict } = require('../nodes/utils/cerebrumChatContext')

const noop = () => {}
const copy = value => JSON.parse(JSON.stringify(value))

describe('Cerebrum portable backup', () => {
  let root
  let instances
  function create (id, config = {}, credentials = { llmApiKey: 'AI-SECRET-EXCLUDED' }) {
    let Constructor
    const flow = [
      { id: 'tab', type: 'tab', label: 'Home' },
      { id, type: 'cerebrumUltimate', z: 'tab', server: 'gateway', wires: [['chat']], llmEnabled: false, llmModel: 'saved-model', chatInputCode: 'return msg;', ...config },
      { id: 'chat', type: 'function', z: 'tab', func: 'return msg;', wires: [], gateway: 'gateway' },
      { id: 'gateway', type: 'knxUltimate-config', name: 'Gateway', csv: [] },
      { id: 'unrelated-tab', type: 'tab' },
      { id: 'unrelated', type: 'function', z: 'unrelated-tab', gateway: 'gateway', func: 'not part of Cerebrum' }
    ]
    const RED = {
      auth: { needsPermission: () => noop },
      httpAdmin: { get: noop, post: noop, use: noop },
      settings: { userDir: path.join(root, id), httpAdminRoot: '/' },
      nodes: {
        getNode: () => undefined,
        getCredentials: nodeId => nodeId === id ? credentials : nodeId === 'gateway' ? { password: 'INTEGRATION-SECRET-INCLUDED' } : undefined,
        eachNode: visit => flow.forEach(visit),
        registerType: (type, ctor) => { if (type === 'cerebrumUltimate') Constructor = ctor },
        createNode: node => {
          const emitter = new EventEmitter()
          Object.assign(node, { id, type: 'cerebrumUltimate', credentials, on: emitter.on.bind(emitter), emit: emitter.emit.bind(emitter), status: noop, warn: noop, error: noop, send: noop, log: noop })
        }
      },
      util: { cloneMessage: copy }
    }
    register(RED)
    const node = new Constructor(flow[1])
    instances.add(node)
    return node
  }
  async function close (node) {
    await new Promise(resolve => node.emit('close', resolve))
    instances.delete(node)
  }
  const storage = node => path.join(node.cerebrumStorageDir, 'cerebrum')
  const seed = (node, relative, content) => {
    const target = path.join(storage(node), relative)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, content)
  }
  beforeEach(() => { root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'cerebrum-backup-test-')); instances = new Set() })
  afterEach(async () => {
    for (const node of instances) await close(node)
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('round trips every archive, checkpoint and learning data to a new node ID, including after restart', async () => {
    const source = create('source')
    source._chatContext.sessions = [{ id: 'chat-person', turns: [{ question: 'Accendi cucina', reply: 'Fatto' }], instructions: [{ text: 'Preferisco luce calda' }], cameraWatches: [{ id: 'watch', cameraId: 'camera-1', eventType: 'motion' }] }]
    source._scheduleStore.tasks = [{ id: 'reminder', kind: 'monitor', title: 'Controlla cucina', instruction: 'Controlla cucina', sessionId: 'chat-person', status: 'active', startAt: new Date(Date.now() + 86400000).toISOString(), nextRunAt: new Date(Date.now() + 86400000).toISOString(), intervalMinutes: 60 }]
    source._homeMemory.habits = [{ id: 'learning-progress', type: 'temporal_state_pattern', status: 'learning', source: 'adapter', objectId: 'light.kitchen', value: 'on', samples: 2, observationDays: 2 }]
    await source.saveEtsAccessConfiguration({ configured: true, exposedGAs: [], readOnlyGAs: [] })
    const day = new Date().toISOString().slice(0, 10)
    seed(source, `history/source/${day}.knxctx`, 'knx-data\n')
    seed(source, `adapter-history/source/${day}.knxctx`, 'adapter-data\n')
    seed(source, `history/source/${day}.jsonl`, '{"legacy":true}\n')
    seed(source, 'debug/cerebrum-last-chat-prompt-source.txt', 'last prompt\n')
    source.recordCerebrumOperation({ category: 'autonomous', operation: 'migration-marker', status: 'succeeded', title: 'Migration marker' })
    const backup = await source.exportAiConfig()
    expect(backup.version).to.equal(2)
    expect(JSON.stringify(backup)).not.to.include('AI-SECRET-EXCLUDED')
    expect(JSON.stringify(backup)).to.include('INTEGRATION-SECRET-INCLUDED')
    const flows = JSON.parse(backup.migration.flows.content)
    expect(flows.map(item => item.id)).to.have.members(['source', 'tab', 'chat', 'gateway'])
    expect(flows.find(item => item.id === 'source')).to.include({ llmModel: 'saved-model', chatInputCode: 'return msg;' })
    expect(flows.find(item => item.id === 'source')).not.to.have.property('credentials')
    await close(source)
    const migratedConfig = flows.find(item => item.id === 'source')
    let target = create('target', { ...migratedConfig, id: 'target' }, { llmApiKey: 'DESTINATION-KEY' })
    seed(target, 'history/target/2000-01-01.knxctx', 'stale')
    expect((await target.importAiConfig(backup)).ok).to.equal(true)
    expect(fs.existsSync(path.join(storage(target), 'history/target/2000-01-01.knxctx'))).to.equal(false)
    expect(target.llmApiKey).to.equal('DESTINATION-KEY')
    expect(target.llmModel).to.equal('saved-model')
    expect(target._chatContext.sessions[0].instructions[0].text).to.equal('Preferisco luce calda')
    expect(target._chatContext.sessions[0].cameraWatches[0].cameraId).to.equal('camera-1')
    expect(target._scheduleStore.tasks[0]).to.include({ id: 'reminder', title: 'Controlla cucina', sessionId: 'chat-person' })
    expect(target._homeMemory.habits[0]).to.include({ id: 'learning-progress', samples: 2 })
    for (const [group, dir] of [['history', 'history'], ['adapterHistory', 'adapter-history'], ['operations', 'operations']]) {
      for (const file of backup.supplementalFiles[group]) expect(fs.readFileSync(path.join(storage(target), dir, 'target', file.name), 'utf8')).to.equal(file.content)
    }
    expect(fs.readFileSync(path.join(storage(target), 'debug/cerebrum-last-chat-prompt-target.txt'), 'utf8')).to.equal('last prompt\n')
    await close(target)
    target = create('target', { ...migratedConfig, id: 'target' })
    expect(target._homeMemory.habits[0]).to.include({ id: 'learning-progress', samples: 2 })
    expect(target.getCerebrumOperationsSnapshot({ limit: 20 }).items.some(item => item.operation === 'migration-marker')).to.equal(true)
    const restored = await target.exportAiConfig()
    expect(JSON.parse(restored.files.aiConfiguration.content).etsAccess).to.deep.equal(JSON.parse(backup.files.aiConfiguration.content).etsAccess)
    expect(restored.supplementalFiles.history).to.deep.equal(backup.supplementalFiles.history)
    expect(JSON.parse(restored.files.schedules.content).tasks).to.deep.equal(JSON.parse(backup.files.schedules.content).tasks)
    expect(parseCerebrumChatContextFileStrict(restored.files.chatLearning.content).sessions).to.deep.equal(parseCerebrumChatContextFileStrict(backup.files.chatLearning.content).sessions)
  })

  it('embeds external ETS text, global settings and cross-tab/subflow dependencies without copying unrelated tabs', () => {
    const etsPath = path.join(root, 'project.csv')
    const csv = '"Name"\t"Address"\n"Kitchen"\t"1/2/3"\n'
    fs.writeFileSync(etsPath, csv)
    const catalog = [{ ga: '1/2/3', dpt: '1.001', devicename: 'Kitchen' }]
    const flows = [
      { id: 'global', type: 'global-config', env: [{ name: 'HOME', value: 'Kitchen', type: 'str' }] },
      { id: 'home', type: 'tab' },
      { id: 'c', type: 'cerebrumUltimate', z: 'home', server: 'gateway' },
      { id: 'out', type: 'link out', z: 'home', links: ['in'] },
      { id: 'in', type: 'link in', z: 'remote', links: ['out'] },
      { id: 'remote', type: 'tab' },
      { id: 'instance', type: 'subflow:sub', z: 'remote' },
      { id: 'sub', type: 'subflow' },
      { id: 'inside', type: 'function', z: 'sub', func: 'return msg;' },
      { id: 'gateway', type: 'knxUltimate-config', csv: etsPath },
      { id: 'other', type: 'function', z: 'unrelated', server: 'gateway' },
      { id: 'unrelated', type: 'tab' }
    ]
    const result = buildMigrationFlows({ settings: { userDir: root }, nodes: { eachNode: visit => flows.forEach(visit), getNode: id => id === 'gateway' ? { csv: catalog } : undefined, getCredentials: () => undefined, getNodeList: () => [{ module: 'node-red-contrib-knx-ultimate', version: '4.0.0', types: ['knxUltimate-config'] }, { module: 'node-red', version: '4.1.0', types: ['function'] }] } }, { id: 'c' }, {})
    const exported = JSON.parse(result.flows.content)
    expect(exported.map(item => item.id)).to.have.members(['c', 'global', 'home', 'gateway', 'out', 'in', 'remote', 'instance', 'sub', 'inside'])
    expect(exported.find(item => item.id === 'gateway').csv).to.equal(csv)
    expect(result.flows.content).not.to.include(etsPath)
    expect(result.dependencies['node-red-contrib-knx-ultimate']).to.equal('4.0.0')
    expect(result.dependencies).not.to.have.property('node-red')
    expect(JSON.parse(result.etsCatalogs.content)).to.deep.equal([{ id: 'gateway', catalog }])
    expect(flows.find(item => item.id === 'gateway').csv).to.equal(etsPath)
  })

  it('still imports version 1 backups without deleting destination archives', async () => {
    const source = create('source')
    const backup = await source.exportAiConfig()
    backup.version = 1
    delete backup.supplementalFiles
    delete backup.migration
    Object.values(backup.files).forEach(file => { delete file.sha256 })
    const target = create('target')
    seed(target, 'history/target/2000-01-01.knxctx', 'keep legacy destination history')
    expect((await target.importAiConfig(backup)).ok).to.equal(true)
    expect(fs.readFileSync(path.join(storage(target), 'history/target/2000-01-01.knxctx'), 'utf8')).to.equal('keep legacy destination history')
  })

  it('rejects damaged files before changing destination memory or archives', async () => {
    const node = create('source')
    const backup = await node.exportAiConfig()
    backup.files.homeMemory.content += 'damage'
    let error
    try { await node.importAiConfig(backup) } catch (caught) { error = caught }
    expect(error.message).to.include('damaged')
    expect((await node.exportAiConfig()).files.homeMemory.content).not.to.include('damage')
  })

  it('rejects traversal, duplicate filenames and missing archive groups', async () => {
    const backup = await create('source').exportAiConfig()
    const files = backup.supplementalFiles
    files.history = [backupFile('history/../../escape', '../../escape', 'bad')]
    expect(() => validateSupplementalFiles(files)).to.throw('filename')
    files.history = [backupFile('history/2026-09-05.knxctx', '2026-09-05.knxctx', 'one')]
    files.history.push(copy(files.history[0]))
    expect(() => validateSupplementalFiles(files)).to.throw('duplicate')
    files.history = []
    delete files.operations
    expect(() => validateSupplementalFiles(files)).to.throw('Missing backup archive')
  })

  it('rolls back overwritten archives when a later file write fails', async () => {
    const source = create('source')
    seed(source, 'history/source/2026-09-05.knxctx', 'source')
    seed(source, 'adapter-history/source/2026-09-05.knxctx', 'new adapter')
    const backup = await source.exportAiConfig()
    const target = create('target')
    seed(target, 'history/target/2026-09-05.knxctx', 'original')
    const originalRename = fs.renameSync
    let failed = false
    fs.renameSync = function (from, to) {
      if (!failed && to.includes('adapter-history/target/')) { failed = true; throw new Error('simulated disk error') }
      return originalRename.apply(this, arguments)
    }
    let error
    try { await target.importAiConfig(backup) } catch (caught) { error = caught } finally { fs.renameSync = originalRename }
    expect(error.message).to.include('simulated disk error')
    expect(fs.readFileSync(path.join(storage(target), 'history/target/2026-09-05.knxctx'), 'utf8')).to.equal('original')
    expect(fs.existsSync(path.join(storage(target), 'adapter-history/target/2026-09-05.knxctx'))).to.equal(false)
  })

  it('waits for in-flight KNX archive writes before exporting', async () => {
    const node = create('source')
    const originalAppend = fs.appendFile
    let finish
    fs.appendFile = (...args) => { finish = () => originalAppend(...args) }
    let pending
    try {
      node.handleSend({ knx: { event: 'GroupValue_Write', source: '1.1.1', destination: '1/2/3', dpt: '1.001' }, payload: true, devicename: 'Pending archive marker' })
      expect(finish).to.be.a('function')
      let completed = false
      pending = node.exportAiConfig().then(backup => { completed = true; return backup })
      await Promise.resolve()
      expect(completed).to.equal(false)
      finish()
      const backup = await pending
      expect(backup.supplementalFiles.history.some(file => file.content.includes('Pending archive marker'))).to.equal(true)
    } finally { fs.appendFile = originalAppend }
  })

  it('does not report a complete backup after a failed archive append', async () => {
    const node = create('source')
    const originalAppend = fs.appendFile
    fs.appendFile = (file, content, encoding, callback) => callback(new Error('simulated append error'))
    try {
      node.handleSend({ knx: { event: 'GroupValue_Write', destination: '1/2/3', dpt: '1.001' }, payload: true })
    } finally { fs.appendFile = originalAppend }
    let error
    try { await node.exportAiConfig() } catch (caught) { error = caught }
    expect(error.message).to.include('cannot guarantee completeness')
  })

  it('assembles uploads without corrupting Unicode and isolates users and nodes', () => {
    const uploads = createBackupUploads()
    const bytes = Buffer.from(JSON.stringify({ message: 'Memoria è casa 🏠' }))
    const first = uploads.append({ owner: 'one', nodeId: 'a', index: 0, total: 2, chunk: bytes.subarray(0, 24).toString('base64') })
    expect(() => uploads.take({ ...first, owner: 'two', nodeId: 'a' })).to.throw()
    expect(() => uploads.take({ ...first, owner: 'one', nodeId: 'b' })).to.throw()
    expect(() => uploads.take({ ...first, owner: 'one', nodeId: 'a' })).to.throw('Incomplete')
    uploads.append({ ...first, owner: 'one', nodeId: 'a', index: 1, total: 2, chunk: bytes.subarray(24).toString('base64') })
    expect(uploads.take({ ...first, owner: 'one', nodeId: 'a' })).to.deep.equal({ message: 'Memoria è casa 🏠' })
    expect(() => uploads.take({ ...first, owner: 'one', nodeId: 'a' })).to.throw()
  })
})
