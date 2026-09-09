'use strict'
/* eslint-env mocha */
const { expect } = require('chai')
const { rejects } = require('assert').strict
const yazl = require('yazl')
const yauzl = require('yauzl')
const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')
const { EventEmitter } = require('events')
const { Writable } = require('stream')
const { backupFile, createBackupUploads, readSupplementalFiles, validateSupplementalFiles, replaceSupplementalFiles, buildMigrationFlows } = require('../nodes/utils/cerebrumBackup')
const { createBackupZip, decodeBackupUpload } = require('../nodes/utils/cerebrumBackupZip')
const { getAiEducationFilePath } = require('../nodes/utils/cerebrumAiEducation')
const Module = require('module')
// Keep the admin-route singleton isolated from other suites' mocked RED hosts.
const runtimePath = require.resolve('../nodes/cerebrumUltimate')
const runtimeModule = new Module(runtimePath, module)
runtimeModule.filename = runtimePath
runtimeModule.paths = module.paths
runtimeModule._compile(fs.readFileSync(runtimePath, 'utf8'), runtimePath)
const register = runtimeModule.exports
const { parseCerebrumChatContextFileStrict } = require('../nodes/utils/cerebrumChatContext')

const noop = () => {}
const copy = value => JSON.parse(JSON.stringify(value))

describe('Cerebrum portable backup', () => {
  let root
  let instances
  const routes = new Map()
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
      httpAdmin: { get: (url, ...handlers) => routes.set(url, handlers.at(-1)), post: (url, permission, handler) => routes.set(url, handler), use: noop },
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
  async function request (node, action, body = {}) {
    const response = { statusCode: 200, headers: {} }
    const chunks = []
    const res = new Writable({ write: (chunk, encoding, callback) => { chunks.push(chunk); callback() } })
    res.on('finish', () => { response.body = Buffer.concat(chunks) })
    res.status = code => { response.statusCode = code; return res }
    res.set = (key, value) => { response.headers[key.toLowerCase()] = value; return res }
    res.json = value => { response.body = value }
    res.send = value => { response.body = value }
    const endpoint = action.startsWith('ai-education') ? action : `config/${action}`
    await routes.get(`/cerebrumUltimate/sidebar/${endpoint}`)({ body: { nodeId: node.id, ...body }, query: { nodeId: node.id, ...body }, user: { username: 'backup-user' } }, res)
    return response
  }
  async function zipEntries (entries) {
    const zip = new yazl.ZipFile()
    for (const [name, content, options] of entries) zip.addBuffer(Buffer.from(content), name, options)
    zip.end()
    const chunks = []
    for await (const chunk of zip.outputStream) chunks.push(chunk)
    return Buffer.concat(chunks)
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

  const supplementalLocations = (id, includeWorldModel = true) => ({
    history: path.join(root, id, 'history'),
    adapterHistory: path.join(root, id, 'adapter-history'),
    operations: path.join(root, id, 'operations'),
    habitLearning: path.join(root, id, 'memory', 'habit-learning.json'),
    lastChatPrompt: path.join(root, id, 'debug', 'last-prompt.txt'),
    legacyAreas: path.join(root, id, 'areas.json'),
    ...(includeWorldModel ? { worldModel: path.join(root, id, 'memory', `cerebrum-world-model-${id}.json`) } : {})
  })
  const writeSupplementalFile = ({ filePath, content }) => {
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, content)
  }
  const seedSupplemental = (locations, worldModel) => {
    writeSupplementalFile({ filePath: locations.habitLearning, content: '{"version":1,"habits":[]}' })
    if (worldModel !== undefined) writeSupplementalFile({ filePath: locations.worldModel, content: worldModel })
    return readSupplementalFiles(locations)
  }

  it('applies default and custom history retention to disk archives while the AI is disabled, including after restart and restore', async function () {
    this.timeout(10000)
    const { serializeCerebrumCompactHistoryRecord } = require('../nodes/utils/cerebrumEventHistory')
    const { addCerebrumChatInstruction } = require('../nodes/utils/cerebrumChatContext')
    const source = create('history-retention')
    await source.applyHistoryRetention()
    expect(source.historyRetentionDays).to.equal(30)
    expect(source.llmEnabled).to.equal(false)
    const now = Date.now()
    const oldTs = now - 32 * 86400000
    const recentTs = now - 20 * 86400000
    const oldDay = new Date(oldTs).toISOString().slice(0, 10)
    const recentDay = new Date(recentTs).toISOString().slice(0, 10)
    for (const group of ['history', 'adapter-history', 'operations']) {
      const extension = group === 'operations' ? 'jsonl' : 'knxctx'
      seed(source, `${group}/${source.id}/${oldDay}.${extension}`, '')
      seed(source, `${group}/${source.id}/${recentDay}.${extension}`, '')
      seed(source, `${group}/${source.id}/notes.txt`, 'unrelated')
    }
    seed(source, `history/${source.id}/${recentDay}.knxctx`, serializeCerebrumCompactHistoryRecord({ ts: recentTs, at: new Date(recentTs).toISOString(), destination: '1/2/3', source: '1.1.1', event: 'GroupValue_Write', payload: 37 }, 'knx') + '\n')
    source._chatContext = addCerebrumChatInstruction(source._chatContext, { text: 'Keep Relax at 37%', at: new Date(oldTs).toISOString() })
    source._sharedMemoryArchive.append({ kind: 'conversation', at: new Date(oldTs).toISOString(), data: { text: 'expired marker' } })
    const retained = source._sharedMemoryArchive.append({ kind: 'conversation', at: new Date(recentTs).toISOString(), data: { text: 'retained marker' } })
    await source.applyHistoryRetention()
    for (const group of ['history', 'adapter-history', 'operations']) {
      const extension = group === 'operations' ? 'jsonl' : 'knxctx'
      expect(fs.existsSync(path.join(storage(source), group, source.id, `${oldDay}.${extension}`))).to.equal(false)
      expect(fs.existsSync(path.join(storage(source), group, source.id, `${recentDay}.${extension}`))).to.equal(true)
      expect(fs.existsSync(path.join(storage(source), group, source.id, 'notes.txt'))).to.equal(true)
    }
    expect((await source.querySharedMemory({ text: 'expired', kind: 'conversation' })).totalMatches).to.equal(0)
    expect((await source.querySharedMemory({ operation: 'get', text: retained.id })).ok).to.equal(true)
    const snapshot = source.getCerebrumOperationsSnapshot()
    expect(snapshot.retentionDays).to.equal(30)
    expect(snapshot.items.some(item => item.category === 'knx' && item.details.destination === '1/2/3')).to.equal(true)
    const backup = await decodeBackupUpload(await createBackupZip(await source.exportAiConfig()))
    const target = create('short-history-retention', { historyRetentionDays: '7' })
    await target.importAiConfig(backup)
    expect(target.historyStoreRetentionDays).to.equal(7)
    expect(target._chatContext.instructions.some(item => item.text === 'Keep Relax at 37%')).to.equal(true)
    expect((await target.querySharedMemory({ operation: 'get', text: retained.id })).ok).to.equal(false)
    expect(target.getCerebrumOperationsSnapshot().retentionDays).to.equal(7)
    const dayFile = path.join(storage(target), 'history', target.id, `${recentDay}.knxctx`)
    expect(fs.existsSync(dayFile)).to.equal(false)
    const expired = target._sharedMemoryArchive.append({ kind: 'conversation', at: new Date(recentTs).toISOString(), data: { text: 'restart marker' } })
    await close(target)
    const restarted = create('short-history-retention', { historyRetentionDays: 7 })
    await restarted._historyRetentionPromise
    expect((await restarted.querySharedMemory({ operation: 'get', text: expired.id })).ok).to.equal(false)
    expect(restarted._chatContext.instructions.some(item => item.text === 'Keep Relax at 37%')).to.equal(true)
  })

  it('round trips editable JavaScript source through ZIP, node migration and restart', async function () {
    this.timeout(10000)
    const source = create('javascript-source')
    const saved = await source.saveAutomationFile({ name: 'promemoria.js', origin: 'new', revision: '', content: 'module.exports = c => { c.describe("Promemoria"); c.schedule.every("check", 60000, () => c.notify("Controllo")) }' })
    await source.manageAutomationFile({ ...saved, operation: 'resume' })
    expect(source.getAutomationFile({ name: saved.name }).status).to.equal('active')
    const backup = await decodeBackupUpload(await createBackupZip(await source.exportAiConfig()))
    expect(backup.supplementalFiles.automationSources.map(file => file.name)).to.deep.equal(['promemoria.js'])
    const target = create('javascript-target')
    await target.importAiConfig(backup)
    expect(target.getAutomationFile({ name: saved.name })).to.include({ content: saved.content, revision: saved.revision, status: 'paused', runtimeAvailable: true })
    await close(target)
    const restarted = create('javascript-target')
    expect(restarted.getAutomationFile({ name: saved.name }).content).to.equal(saved.content)
    const oldBackup = await source.exportAiConfig()
    delete oldBackup.supplementalFiles.automationSources
    delete oldBackup.supplementalFiles.automationRuntime
    await restarted.importAiConfig(oldBackup)
    expect(restarted.getAutomationFile({ name: saved.name }).content).to.equal(saved.content)
    expect(backup.supplementalFiles.automationRuntime).to.be.an('object')
    const traversal = await source.exportAiConfig()
    traversal.supplementalFiles.automationSources[0].name = '../outside.js'
    await rejects(restarted.importAiConfig(traversal), /automationSources filename/)
    expect(restarted.getAutomationFile({ name: saved.name }).content).to.equal(saved.content)
    const damaged = await source.exportAiConfig()
    damaged.supplementalFiles.automationRuntime = backupFile('automationRuntime', 'runtime.json', JSON.stringify({ version: 1, entries: { 'promemoria.js': { status: 'active', generation: 0, revision: 'invalid', authority: 'user' } } }))
    await rejects(restarted.importAiConfig(damaged), /Invalid automation runtime checkpoint/)
    expect(restarted.getAutomationFile({ name: saved.name }).content).to.equal(saved.content)
  })

  it('keeps startup, education polling and local world observation off the LLM until a seven-day review is due', async function () {
    this.timeout(12000)
    const simpleGet = require('simple-get')
    const transport = simpleGet.concat
    const originalNow = Date.now
    let time = Date.parse('2026-09-08T08:00:00Z')
    Date.now = () => time
    let calls = 0
    const prompts = []
    simpleGet.concat = (options, callback) => {
      calls++
      prompts.push(JSON.stringify(JSON.parse(options.body)))
      const response = { disposition: 'observe', summary: 'Local observations reviewed; comfort remains a hypothesis.', nextCheckSeconds: 86400, evidenceIds: [], action: null, expected: null, queries: [], goalUpdate: null, research: null }
      callback(null, { statusCode: 200, headers: {} }, Buffer.from(JSON.stringify({ choices: [{ message: { content: JSON.stringify(response) } }] })))
    }
    try {
      const config = { llmEnabled: true, llmProvider: 'openai_compat', llmBaseUrl: 'https://llm.invalid/v1/chat/completions', llmModel: 'test', llmContextLength: 32768, llmMaxTokens: 2400, llmBackgroundMode: 'interval', llmBackgroundIntervalMinutes: 10080 }
      const node = create('policy-week', config)
      const output = []
      node.send = messages => output.push(messages)
      node.handleSend({ knx: { event: 'GroupValue_Write', source: '1.1.1', destination: '1/2/3', dpt: '1.001' }, payload: true, devicename: 'Weekly archive marker' })
      await node._educationCompiler.check()
      await node._autonomyRuntime.tick()
      await new Promise(resolve => setTimeout(resolve, 2700))
      expect(calls).to.equal(0)
      expect(output.some(messages => messages[2]?.cerebrum?.llmTest === 'skipped_by_policy')).to.equal(true)
      time += 10080 * 60000 - 1
      await node.runLlmPolicyTick()
      expect(calls).to.equal(0)
      time++
      await node.runLlmPolicyTick()
      expect(calls).to.equal(1)
      expect(prompts[0]).to.include('Weekly archive marker').and.include('full-interval aggregates')
      expect(node.getLlmPolicyStatus().lastContextAt).to.equal(time)
      await node._autonomyRuntime.tick()
      await node.runLlmPolicyTick()
      expect(calls).to.equal(1)
      const saved = await node.exportAiConfig()
      expect(JSON.parse(saved.supplementalFiles.runtimeState.content).llmPolicy.lastAttemptAt).to.equal(time)
      await close(node)
      const restarted = create('policy-week', config)
      await restarted.runLlmPolicyTick()
      await restarted._autonomyRuntime.tick()
      expect(calls).to.equal(1)
    } finally { simpleGet.concat = transport; Date.now = originalNow }
  })

  it('compiles the saved 08:40 weather/TTS education into real JavaScript without executing the task now', async function () {
    this.timeout(10000)
    const simpleGet = require('simple-get')
    const transport = simpleGet.concat
    const education = 'Alle 08:40 di ogni giorno, annuncia via TTS il riassunto delle previsioni meteo del giorno, facendo attenzione a pronunciare correttamente le unità di misura e le date/ora; il sensore KNX locale di pioggia è 2/3/0, mentre quello di temperatura locale è 2/3/1.'
    const code = `module.exports = c => { c.describe("Meteo delle 08:40"); c.schedule.daily("meteo", {at:"08:40",timeZone:"Europe/Rome"}, () => c.assistant.run(${JSON.stringify(education)})) }`
    let calls = 0
    const outputs = []
    const originalNow = Date.now
    let time = Date.parse('2026-09-08T06:39:00Z')
    Date.now = () => time
    simpleGet.concat = (options, callback) => {
      calls++
      const prompt = JSON.stringify(JSON.parse(options.body).messages)
      if (calls <= 3) expect(prompt).to.include('EDUCATION COMPILATION').and.include('2/3/0').and.include('2/3/1')
      else if (calls > 4) expect(prompt).to.include('LOCAL AUTOMATION EXECUTION').and.include('2/3/0').and.include('2/3/1')
      const action = calls === 1
        ? { operation: 'api', name: '', revision: '', code: '', offset: 0 }
        : calls === 2 ? { operation: 'create', name: 'meteo-mattino.js', revision: '', code, offset: 0 } : null
      const response = { reply: action ? '' : 'Ho creato meteo-mattino.js alle 08:40.', language: 'it', automationActions: action ? [action] : [], commands: [], cameraActions: [], speechActions: [], memoryActions: [], catalogActions: [], webActions: [], scheduleActions: [], historyActions: [], codeActions: [] }
      if (calls === 5) response.speechActions = [{ text: 'Martedì otto settembre, ore otto e quaranta. La previsione meteo non è disponibile.', reason: 'Annuncio programmato' }]
      callback(null, { statusCode: 200, headers: {} }, Buffer.from(JSON.stringify({ choices: [{ message: { content: JSON.stringify(response) } }] })))
    }
    try {
      const node = create('education-weather', { llmEnabled: true, llmProvider: 'openai_compat', llmBaseUrl: 'https://llm.invalid/v1/chat/completions', llmModel: 'test', llmMaxTokens: 2400, llmContextLength: 32768 })
      node.send = output => outputs.push(output)
      await node.updateAiEducationFile({ ...(await node.getAiEducationFile()), content: education })
      await node._educationCompiler.check()
      expect(calls).to.equal(0)
      expect(node.listAutomationFiles().compilation.status).to.equal('waiting')
      await node.compileEducationAutomations()
      expect(calls).to.equal(0)
      await node.sidebarAsk('Genera le funzioni richieste in Educazione AI.')
      expect(calls).to.equal(4)
      const file = node.getAutomationFile({ name: 'meteo-mattino.js' })
      expect(file).to.include({ content: code, status: 'active', author: 'cerebrum' })
      expect(node.listAutomationFiles().compilation.status).to.equal('ready')
      expect(outputs.some(output => output[3] || output[4])).to.equal(false)
      await node._educationCompiler.check()
      expect(calls).to.equal(4)
      time += 60000
      await node._automationRuntime.tick(); await node._automationRuntime.drain()
      expect(calls).to.equal(5)
      const speech = outputs.find(output => output[4])
      expect(speech[4][0].payload).to.include('ore otto e quaranta')
      const backup = await node.exportAiConfig()
      expect(JSON.parse(backup.supplementalFiles.automationRuntime.content).compilation.status).to.equal('ready')
      await close(node)
      const restarted = create('education-weather', { llmEnabled: true, llmProvider: 'openai_compat', llmBaseUrl: 'https://llm.invalid/v1/chat/completions', llmModel: 'test' })
      await restarted._educationCompiler.check()
      expect(calls).to.equal(5)
      expect(restarted.getAutomationFile({ name: file.name }).status).to.equal('active')
    } finally { simpleGet.concat = transport; Date.now = originalNow }
  })

  it('lets the conversational model create a visible local function that the user can pause, edit and delete', async function () {
    this.timeout(10000)
    const simpleGet = require('simple-get')
    const transport = simpleGet.concat
    const prompts = []
    const source = 'module.exports = c => { c.describe("Promemoria creato da Cerebrum"); c.schedule.every("reminder", 60000, () => c.notify("Controlla la finestra")) }'
    simpleGet.concat = (options, callback) => {
      const body = JSON.parse(options.body)
      prompts.push(JSON.stringify(body.messages))
      const action = prompts.length === 1
        ? { operation: 'api', name: '', revision: '', code: '', offset: 0 }
        : prompts.length === 2 ? { operation: 'create', name: 'promemoria.js', revision: '', code: source, offset: 0 } : null
      const response = { reply: action ? '' : 'Ho creato il promemoria locale.', language: 'it', automationActions: action ? [action] : [], commands: [], cameraActions: [], speechActions: [], memoryActions: [], catalogActions: [], webActions: [], scheduleActions: [], historyActions: [], codeActions: [] }
      callback(null, { statusCode: 200, headers: {} }, Buffer.from(JSON.stringify({ choices: [{ message: { content: JSON.stringify(response) } }] })))
    }
    try {
      const node = create('chat-automation', { llmEnabled: true, llmProvider: 'openai_compat', llmBaseUrl: 'https://llm.invalid/v1/chat/completions', llmModel: 'test', llmMaxTokens: 1600, llmContextLength: 32768 })
      node.cerebrumAutonomyEnabled = false
      const answer = await node.sidebarAsk('Ricordami ogni minuto di controllare la finestra, usando una funzione locale.')
      expect(answer.answer).to.include('promemoria locale')
      expect(prompts).to.have.length(3)
      expect(prompts[0]).not.to.include('cerebrum.timers.define')
      expect(prompts[1]).to.include('cerebrum.timers.define')
      expect(prompts[2]).to.include('LOCAL AUTOMATION TOOL RESULTS').and.include('active')
      const file = node.getAutomationFile({ name: 'promemoria.js' })
      expect(file).to.include({ content: source, status: 'active', author: 'cerebrum' })
      expect(node.listAutomationFiles().files).to.have.length(1)
      await node.manageAutomationFile({ ...file, operation: 'pause' })
      node.llmEnabled = false
      const edited = await node.saveAutomationFile({ ...file, content: source.replace('60000', '120000') })
      expect(edited.status).to.equal('paused')
      await node.manageAutomationFile({ ...edited, operation: 'resume' })
      expect(node.getAutomationFile({ name: file.name }).status).to.equal('active')
      await node.manageAutomationFile({ ...edited, operation: 'delete' })
      expect(node.listAutomationFiles().files).to.have.length(0)
      expect(prompts).to.have.length(3)
    } finally { simpleGet.concat = transport }
  })

  it('persists Web conversations and retrieves their actuator context through Telegram after restart and ZIP restore', async function () {
    this.timeout(15000)
    const simpleGet = require('simple-get')
    const transport = simpleGet.concat
    const prompts = []
    const scene = 'Relax: Persiana soggiorno, stato 1/2/3 DPT 5.001 = 37; comando 1/2/4 DPT 5.001; osservato 2026-09-07T10:00:00Z'
    const config = { llmEnabled: true, llmProvider: 'openai_compat', llmBaseUrl: 'https://llm.invalid/v1/chat/completions', llmModel: 'test-model', llmMaxTokens: 1000, llmContextLength: 32768 }
    let phase = 'save'
    let recordId
    simpleGet.concat = (options, callback) => {
      const body = JSON.parse(options.body)
      prompts.push(JSON.stringify(body.messages))
      const action = phase === 'save'
        ? { operation: 'remember', text: scene, all: false, reason: 'Salvataggio richiesto' }
        : phase === 'search'
          ? { operation: 'search', text: 'Relax', kind: 'conversation', offset: 0, all: false, reason: 'Recupera dal web' }
          : phase === 'get'
            ? { operation: 'get', text: recordId, offset: 0, all: false, reason: 'Leggi record completo' }
            : null
      const response = { reply: phase === 'save' ? 'Ho salvato Relax al 37%.' : action ? '' : 'Relax è stato salvato dal web al 37%.', language: 'it', commands: [], cameraActions: [], speechActions: [], memoryActions: action ? [action] : [], catalogActions: [], webActions: [], scheduleActions: [], historyActions: [], codeActions: [] }
      phase = phase === 'search' ? 'get' : 'answer'
      callback(null, { statusCode: 200, headers: {} }, Buffer.from(JSON.stringify({ choices: [{ message: { content: JSON.stringify(response) } }] })))
    }
    try {
      let node = create('shared-conversation', config)
      node.cerebrumAutonomyEnabled = false
      const saved = await node.sidebarAsk('Salva la posizione della persiana soggiorno come Relax')
      expect(saved.answer).to.include('salvato')
      expect(node._chatContext.instructions.some(item => item.text === scene)).to.equal(true)
      expect((await node.querySharedMemory({ text: 'Relax', kind: 'conversation' })).items.some(item => item.channel === 'sidebar')).to.equal(true)
      const rawFile = path.join(storage(node), 'memory/shared/cerebrum-memory.jsonl')
      expect(fs.readFileSync(rawFile, 'utf8')).to.include('Salva la posizione').and.include('Ho salvato Relax al 37%')
      await close(node)
      node = create('shared-conversation', config)
      node.cerebrumAutonomyEnabled = false
      const records = await node.querySharedMemory({ text: 'Relax', kind: 'conversation' })
      recordId = records.items.find(item => item.data?.role === 'assistant' || item.excerpt?.includes('"role":"assistant"')).id
      phase = 'search'
      const reply = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Telegram response missing')), 5000)
        node.send = outputs => {
          if (outputs[2] && outputs[2].cerebrum?.type === 'llm') { clearTimeout(timer); resolve(outputs[2]) }
        }
        node.emit('input', { topic: 'ask', sessionId: 'telegram:42', payload: 'Richiama la posizione Relax salvata dal web' })
      })
      expect(JSON.stringify(reply.payload)).to.include('37%')
      expect(prompts[1]).to.include(scene).and.include('Salva la posizione')
      expect(prompts.at(-1)).to.include('SHARED ARCHIVE RESULTS').and.include('Ho salvato Relax al 37%')
      const backup = await decodeBackupUpload(await createBackupZip(await node.exportAiConfig()))
      const target = create('shared-restored')
      await target.importAiConfig(backup)
      expect((await target.querySharedMemory({ text: 'Relax', kind: 'conversation' })).items.some(item => item.channel === 'telegram:42')).to.equal(true)
    } finally { simpleGet.concat = transport }
  })

  it('queries recorded camera events before returning the exact historical snapshot', async function () {
    this.timeout(10000)
    const simpleGet = require('simple-get')
    const transport = simpleGet.concat
    const registry = require('../nodes/utils/cerebrumCamera').getCerebrumCameraAdapterRegistry()
    const providerId = 'camera-history-test:controller-1'
    const image = Buffer.from([0xff, 0xd8, 0xff, 0xd9])
    const historyCalls = []
    const snapshotCalls = []
    const currentSnapshotCalls = []
    const prompts = []
    registry.registerAdapter({ id: 'camera-history-test', title: 'Recorded camera test' })
    registry.registerProvider({
      id: providerId,
      adapterId: 'camera-history-test',
      controllerId: 'controller-1',
      title: 'Recorded camera test',
      capabilities: ['camera_catalog', 'event_history', 'event_snapshot'],
      async listCameras () {
        return [{ id: 'controller-1:camera-1', name: 'Ingresso principale', online: false }]
      },
      async queryEvents (request) {
        historyCalls.push(request)
        return {
          events: [{
            providerId,
            eventId: 'event-42',
            cameraId: 'controller-1:camera-1',
            cameraName: 'Ingresso principale',
            eventType: 'smartDetectZone',
            objectTypes: ['person'],
            at: '2026-09-09T08:00:00.000Z',
            endAt: '2026-09-09T08:00:04.000Z',
            active: false,
            thumbnailAvailable: true
          }],
          hasMore: false,
          nextOffset: null
        }
      },
      async takeEventSnapshot (request) {
        snapshotCalls.push(request)
        return { data: image, mediaType: 'image/jpeg', eventId: request.eventId }
      },
      async takeSnapshot (request) {
        currentSnapshotCalls.push(request)
        throw new Error('A current snapshot must not be used for historical evidence')
      },
      subscribe: () => () => {}
    })
    let modelCall = 0
    simpleGet.concat = (options, callback) => {
      modelCall += 1
      prompts.push(JSON.stringify(JSON.parse(options.body).messages))
      const cameraActions = modelCall === 1
        ? [{
            type: 'query_events',
            providerId,
            camera: 'Ingresso principale',
            eventId: '',
            eventType: 'motion',
            scopeName: '',
            objectTypes: [],
            from: '',
            to: '',
            offset: 0,
            limit: 20,
            cooldownSeconds: 0,
            sendSnapshot: false,
            reason: 'Trova l’ultimo movimento registrato'
          }]
        : [{
            type: 'event_snapshot',
            providerId,
            camera: 'Ingresso principale',
            eventId: 'event-42',
            eventType: '',
            scopeName: '',
            objectTypes: [],
            from: '',
            to: '',
            offset: 0,
            limit: 20,
            cooldownSeconds: 0,
            sendSnapshot: false,
            reason: 'Mostra l’immagine dell’evento più recente'
          }]
      const response = {
        reply: '',
        language: 'it',
        commands: [],
        cameraActions,
        speechActions: [],
        memoryActions: [],
        catalogActions: [],
        webActions: [],
        scheduleActions: [],
        historyActions: [],
        codeActions: [],
        automationActions: []
      }
      callback(null, { statusCode: 200, headers: {} }, Buffer.from(JSON.stringify({ choices: [{ message: { content: JSON.stringify(response) } }] })))
    }
    try {
      const node = create('recorded-camera-chat', {
        llmEnabled: true,
        llmProvider: 'openai_compat',
        llmBaseUrl: 'https://llm.invalid/v1/chat/completions',
        llmModel: 'test-model',
        llmMaxTokens: 1200,
        llmContextLength: 32768
      })
      node.cerebrumAutonomyEnabled = false
      const result = await node.sidebarAsk('Fammi vedere lo snapshot dell’ultimo movimento rilevato all’ingresso')

      expect(modelCall).to.equal(2)
      expect(historyCalls).to.have.length(1)
      expect(historyCalls[0]).to.include({
        cameraId: 'controller-1:camera-1',
        offset: 0,
        limit: 20
      })
      expect(historyCalls[0].eventTypes).to.deep.equal(['motion'])
      expect(snapshotCalls).to.deep.equal([{
        eventId: 'event-42',
        cameraId: 'controller-1:camera-1',
        cameraName: 'Ingresso principale',
        reason: 'Mostra l’immagine dell’evento più recente'
      }])
      expect(currentSnapshotCalls).to.have.length(0)
      expect(prompts[1]).to.include('CAMERA HISTORY TOOL RESULTS').and.include('eventId=event-42')
      const debugPrompt = fs.readFileSync(node._lastChatPromptDebugFile, 'utf8')
      expect(debugPrompt).to.include('Transient camera-history evidence omitted')
      expect(debugPrompt).not.to.include('eventId=event-42')
      const backup = await decodeBackupUpload(await createBackupZip(await node.exportAiConfig()))
      expect(backup.supplementalFiles.lastChatPrompt.content).to.include('Transient camera-history evidence omitted')
      expect(backup.supplementalFiles.lastChatPrompt.content).not.to.include('eventId=event-42')
      expect(backup.supplementalFiles.lastChatPrompt.content).not.to.include('[CH1]')
      expect(backup.supplementalFiles.lastChatPrompt.content).not.to.include('2026-09-09T08:00:00.000Z')
      expect(result.metadata).to.include({ type: 'camera_event_snapshot', eventId: 'event-42' })
      expect(result.metadata.image).to.include({ mediaType: 'image/jpeg' })
      expect(result.metadata.image.data).to.equal(image)
      expect(result.answer).to.include('Ingresso principale')

      const archived = fs.readFileSync(node._sharedMemoryArchive.filePath, 'utf8')
        .trim()
        .split('\n')
        .map(JSON.parse)
      const historyAudit = archived.find(record => record.kind === 'operation' && record.data?.operation === 'camera_history_query')
      expect(historyAudit.data.result).not.to.have.property('events')
      expect(historyAudit.data.result).to.include({ ok: true, returnedEvents: 1, hasMore: false })
      const archivedReply = archived.find(record => record.kind === 'conversation' && record.data?.metadata?.type === 'camera_event_snapshot')
      expect(archivedReply.data.metadata.image).to.deep.equal({
        mediaType: 'image/jpeg',
        filename: 'ingresso-principale-snapshot.jpg',
        byteLength: 4,
        stored: false
      })
    } finally {
      registry.unregisterProvider(providerId)
      simpleGet.concat = transport
    }
  })

  it('uses UniFi Protect live events without copying the feed into Cerebrum memory', async function () {
    this.timeout(10000)
    const registry = require('../nodes/utils/cerebrumCamera').getCerebrumCameraAdapterRegistry()
    const providerId = 'unifi-ultimate:protect-live-only'
    let listener
    registry.registerAdapter({ id: 'unifi-ultimate', title: 'UniFi Ultimate / Protect' })
    registry.registerProvider({
      id: providerId,
      adapterId: 'unifi-ultimate',
      controllerId: 'protect-live-only',
      eventRetention: 'none',
      capabilities: ['camera_catalog', 'snapshot', 'motion', 'event_history', 'event_snapshot'],
      async listCameras () {
        return [{
          id: 'protect-live-only:camera-1',
          name: 'Ingresso',
          adapterId: 'unifi-ultimate',
          providerId,
          online: true
        }]
      },
      subscribe (callback) {
        listener = callback
        return () => { listener = null }
      }
    })
    try {
      const node = create('protect-live-only', { unifiProtectConfig: 'protect-live-only' })
      node.cerebrumAutonomyEnabled = false
      await node.refreshCameraAdapterRegistry({ force: true })
      expect(listener).to.be.a('function')

      const appended = []
      const append = node._sharedMemoryArchive.append.bind(node._sharedMemoryArchive)
      node._sharedMemoryArchive.append = entry => {
        appended.push(entry)
        return append(entry)
      }
      const observationsBefore = node._homeMemory.observations.length
      const episodesBefore = node._homeMemory.episodes.length

      listener({
        source: 'unifi-ultimate',
        adapterId: 'unifi-ultimate',
        providerId,
        cameraId: 'protect-live-only:camera-1',
        cameraName: 'Ingresso',
        eventId: 'motion-1',
        eventType: 'motion',
        active: true,
        at: '2026-09-09T12:00:00.000Z',
        raw: { controllerPayload: 'must-not-be-saved' }
      })

      expect(appended).to.deep.equal([])
      expect(node._homeMemory.observations).to.have.length(observationsBefore)
      expect(node._homeMemory.episodes).to.have.length(episodesBefore)
      const historyDir = path.join(storage(node), 'adapter-history', node.id)
      expect(fs.existsSync(historyDir)).to.equal(false)

      const outputs = []
      node.send = output => outputs.push(output)
      node.emit('input', {
        payload: { camera: { id: 'camera-1' }, verbose: true },
        details: { unifiProtect: { deviceType: 'camera', deviceId: 'camera-1', source: 'interval' } }
      })
      require('../nodes/utils/cerebrumTransientMessageOrigins').rememberCerebrumTransientMessageOrigin({
        messageId: 'protect-relay-direct-input',
        source: 'unifi-protect'
      })
      node.emit('input', {
        _msgid: 'protect-relay-direct-input',
        payload: { motion: true }
      })
      await new Promise(resolve => setImmediate(resolve))
      expect(outputs).to.deep.equal([])
      expect(appended).to.deep.equal([])
    } finally {
      registry.unregisterProvider(providerId)
    }
  })

  it('continues beyond four ETS passes, revisits earlier evidence and still requires write confirmation', async function () {
    this.timeout(10000)
    const simpleGet = require('simple-get')
    const transport = simpleGet.concat
    const prompts = []
    const node = create('shared-ets', { llmEnabled: true, llmProvider: 'openai_compat', llmBaseUrl: 'https://llm.invalid/v1/chat/completions', llmModel: 'test-model', llmMaxTokens: 1000, llmContextLength: 32768, llmAllowKnxCommands: true, llmRequireCommandConfirmation: true, etsExposeConfigured: true, etsExposedGAs: ['1/2/3', '1/2/4'], etsReadOnlyGAs: ['1/2/3'] })
    node.cerebrumAutonomyEnabled = false
    node.serverKNX = { id: 'gateway', csv: [{ ga: '1/2/3', dpt: '5.001', devicename: 'Persiana soggiorno posizione stato' }, { ga: '1/2/4', dpt: '5.001', devicename: 'Persiana soggiorno posizione comando' }], removeClient: noop }
    const writes = []
    node.send = outputs => {
      const messages = Array.isArray(outputs[3]) ? outputs[3] : outputs[3] ? [outputs[3]] : []
      writes.push(...messages.filter(message => message.event === 'GroupValue_Write'))
    }
    const actions = [
      { operation: 'list_areas' },
      { operation: 'search', query: 'Termine inesistente' },
      { operation: 'search', query: 'Persiana soggiorno', purpose: 'inspect' },
      { operation: 'related', destinations: ['1/2/3'], purpose: 'write' },
      { operation: 'get', destinations: ['1/2/4'], purpose: 'write' },
      { operation: 'get', destinations: ['1/2/3'], purpose: 'read' },
      { operation: 'search', query: 'Persiana soggiorno', purpose: 'inspect' }
    ]
    simpleGet.concat = (options, callback) => {
      prompts.push(JSON.stringify(JSON.parse(options.body).messages))
      const action = actions.shift()
      const response = { reply: action ? '' : 'Propongo di riportare la persiana soggiorno al 37%.', language: 'it', commands: action ? [] : [{ event: 'GroupValue_Write', destination: '1/2/4', dpt: '5.001', payload: 37 }], catalogActions: action ? [action] : [] }
      callback(null, { statusCode: 200, headers: {} }, Buffer.from(JSON.stringify({ choices: [{ message: { content: JSON.stringify(response) } }] })))
    }
    try {
      const reply = await node.sidebarAsk('Riporta la persiana soggiorno al 37%')
      expect(prompts).to.have.length(8)
      expect(prompts.at(-1)).to.include('1/2/4').and.include('5.001')
      expect(reply.metadata.awaitingConfirmation).to.equal(true)
      expect(reply.metadata.rejectedCommands).to.deep.equal([])
      expect(writes).to.deep.equal([])
    } finally { simpleGet.concat = transport }
  })

  it('recognizes newly saved ETS access in the same chat and retrieves both actuators after earlier unavailability', async function () {
    this.timeout(10000)
    const simpleGet = require('simple-get')
    const transport = simpleGet.concat
    const node = create('ets-reconfigured', { llmEnabled: true, llmProvider: 'openai_compat', llmBaseUrl: 'https://llm.invalid/v1/chat/completions', llmModel: 'test-model', llmMaxTokens: 1000, llmContextLength: 32768, llmAllowKnxCommands: true, llmRequireCommandConfirmation: true })
    node.cerebrumAutonomyEnabled = false
    node.serverKNX = { id: 'gateway', linkStatus: 'connected', csv: [{ ga: '1/2/4', dpt: '5.001', devicename: 'Tapparella grande soggiorno posizione' }, { ga: '1/2/5', dpt: '5.001', devicename: 'Tenda a rullo soggiorno posizione' }], removeClient: noop }
    const prompts = []
    const writes = []
    node.send = outputs => writes.push(...(Array.isArray(outputs[3]) ? outputs[3] : outputs[3] ? [outputs[3]] : []).filter(message => message.event === 'GroupValue_Write'))
    simpleGet.concat = (options, callback) => {
      const prompt = JSON.parse(options.body).messages.map(message => message.content).join('\n')
      prompts.push(prompt)
      const response = prompts.length === 1
        ? { reply: 'La selezione ETS non è configurata per questo nodo.', language: 'it' }
        : prompts.length === 2
          ? { catalogActions: [{ operation: 'get', destinations: ['1/2/4', '1/2/5'], purpose: 'write' }] }
          : { reply: 'Propongo l’apertura di entrambe.', language: 'it', commands: ['1/2/4', '1/2/5'].map(destination => ({ event: 'GroupValue_Write', destination, dpt: '5.001', payload: 0 })) }
      callback(null, { statusCode: 200, headers: {} }, Buffer.from(JSON.stringify({ choices: [{ message: { content: JSON.stringify(response) } }] })))
    }
    try {
      await node.sidebarAsk('Apri la tapparella grande e la tenda a rullo del soggiorno')
      expect(prompts[0]).to.include('access_not_configured')
      const saved = await node.saveEtsAccessConfiguration({ configured: true, exposedGAs: ['1/2/4', '1/2/5'], readOnlyGAs: [] })
      expect(saved.etsAccess).to.include({ selectedCount: 2, requestedSelectionCount: 2 })
      const reply = await node.sidebarAsk('Riprova, entrambe')
      expect(prompts).to.have.length(3)
      expect(prompts[1]).to.include('"catalogStatus":"available"')
      expect(prompts[1]).to.include('supersede earlier chat claims').and.include('details still need retrieval')
      expect(prompts.at(-1)).to.include('KNX-DETAILS/2').and.include('1/2/4').and.include('1/2/5')
      expect(reply.metadata.awaitingConfirmation).to.equal(true)
      expect(reply.metadata.rejectedCommands).to.deep.equal([])
      expect(writes).to.deep.equal([])
    } finally { simpleGet.concat = transport }
  })

  it('continues shared-memory and history queries across a Web continuation without fixed local round counts', async function () {
    this.timeout(10000)
    const simpleGet = require('simple-get')
    const transport = simpleGet.concat
    const node = create('progressive-memory', { llmEnabled: true, llmProvider: 'openai_compat', llmBaseUrl: 'https://llm.invalid/v1/chat/completions', llmModel: 'test-model', llmMaxTokens: 1000, llmContextLength: 32768, historyStoreToDisk: true, webAccessEnabled: true, webMaxCallsPerHour: 1 })
    node.cerebrumAutonomyEnabled = false
    // Exercise Web orchestration with its configured quota exhausted: no network.
    node._webRequestTimestamps = [Date.now()]
    const records = Array.from({ length: 6 }, (_, index) => node._sharedMemoryArchive.append({ kind: 'conversation', channel: 'web', data: { text: `Scena ${index}: posizione ${30 + index}%` } }))
    const steps = records.map(record => ({ memoryActions: [{ operation: 'get', text: record.id, offset: 0 }] }))
    steps.splice(3, 0, { webActions: [{ operation: 'search', query: 'KNX documentation' }] })
    for (let index = 0; index < 4; index++) steps.push({ historyActions: [{ operation: 'query', query: `stato ${index}`, limit: 2 }] })
    const prompts = []
    simpleGet.concat = (options, callback) => {
      prompts.push(JSON.stringify(JSON.parse(options.body).messages))
      const step = steps.shift()
      const response = step || { reply: 'Ho consultato tutte le posizioni salvate.', language: 'it' }
      callback(null, { statusCode: 200, headers: {} }, Buffer.from(JSON.stringify({ choices: [{ message: { content: JSON.stringify(response) } }] })))
    }
    try {
      const reply = await node.sidebarAsk('Consulta tutte le scene e verifica lo storico')
      expect(reply.answer).to.include('tutte le posizioni')
      expect(prompts).to.have.length(12)
      expect(prompts[4]).to.include('Scena 0').and.include('Scena 2')
      expect(prompts.at(-1)).to.include('Scena 5').and.include('stato 3')
      const archived = fs.readFileSync(node._sharedMemoryArchive.filePath, 'utf8').trim().split('\n').map(JSON.parse)
      expect(archived.filter(record => record.data.operation === 'memory_query')).to.have.length(6)
      expect(archived.filter(record => record.data.operation === 'history_query')).to.have.length(4)
    } finally { simpleGet.concat = transport }
  })

  it('ends repeated unchanged ETS queries with an uncertainty prompt', async function () {
    this.timeout(10000)
    const simpleGet = require('simple-get')
    const transport = simpleGet.concat
    const node = create('stalled-ets', { llmEnabled: true, llmProvider: 'openai_compat', llmBaseUrl: 'https://llm.invalid/v1/chat/completions', llmModel: 'test-model', llmMaxTokens: 1000, llmContextLength: 32768, etsExposeConfigured: true, etsExposedGAs: ['1/2/3'] })
    node.cerebrumAutonomyEnabled = false
    node.serverKNX = { id: 'gateway', csv: [{ ga: '1/2/3', dpt: '5.001', devicename: 'Persiana soggiorno' }], removeClient: noop }
    let calls = 0
    simpleGet.concat = (options, callback) => {
      calls++
      const stalled = JSON.stringify(JSON.parse(options.body).messages).includes('Repeated ETS queries produced no new evidence')
      const response = stalled ? { reply: 'Non ho trovato il dispositivo richiesto.', language: 'it' } : { catalogActions: [{ operation: 'search', query: 'dispositivo inesistente' }] }
      callback(null, { statusCode: 200, headers: {} }, Buffer.from(JSON.stringify({ choices: [{ message: { content: JSON.stringify(response) } }] })))
    }
    try {
      const reply = await node.sidebarAsk('Cerca un dispositivo che non esiste')
      expect(reply.answer).to.include('Non ho trovato')
      expect(calls).to.equal(3)
    } finally { simpleGet.concat = transport }
  })

  it('cancels superseded chat reasoning before executing its next tool or returning a stale reply', async function () {
    this.timeout(10000)
    const simpleGet = require('simple-get')
    const transport = simpleGet.concat
    const node = create('cancel-reasoning', { llmEnabled: true, llmProvider: 'openai_compat', llmBaseUrl: 'https://llm.invalid/v1/chat/completions', llmModel: 'test-model', llmMaxTokens: 1000, llmContextLength: 32768 })
    node.cerebrumAutonomyEnabled = false
    let releaseFirst, markStarted, finishReply
    const started = new Promise(resolve => { markStarted = resolve })
    const completed = new Promise(resolve => { finishReply = resolve })
    const answers = []
    let calls = 0
    simpleGet.concat = (options, callback) => {
      calls++
      const deliver = response => callback(null, { statusCode: 200, headers: {} }, Buffer.from(JSON.stringify({ choices: [{ message: { content: JSON.stringify(response) } }] })))
      if (calls === 1) {
        releaseFirst = () => deliver({ memoryActions: [{ operation: 'search', text: 'vecchia richiesta' }] })
        markStarted()
      } else deliver({ reply: 'Ciao!', language: 'it' })
    }
    node.send = outputs => {
      if (outputs[2]?.cerebrum?.type === 'llm') { answers.push(outputs[2].payload); finishReply() }
    }
    try {
      node.emit('input', { topic: 'ask', sessionId: 'telegram:42', payload: 'Consulta la vecchia richiesta' })
      await started
      node.emit('input', { topic: 'ask', sessionId: 'telegram:42', payload: 'Ora dimmi ciao' })
      await completed
      releaseFirst()
      await new Promise(resolve => setImmediate(resolve))
      expect(calls).to.equal(2)
      expect(answers).to.have.length(1)
      expect(JSON.stringify(answers[0])).to.include('Ciao!')
      const archive = fs.readFileSync(node._sharedMemoryArchive.filePath, 'utf8')
      expect(archive).not.to.include('"operation":"memory_query"')
    } finally { simpleGet.concat = transport }
  })

  it('migrates AI Education to a file, edits it independently of flows and keeps the saved file across restarts', async () => {
    const legacy = 'Rispetta il silenzio notturno.\nAvvisa solo quando serve 🏠.\n'
    let node = create('education', { aiEducation: legacy })
    const first = await request(node, 'ai-education')
    expect(first.statusCode).to.equal(200)
    expect(first.body.content).to.equal(legacy)
    expect(first.body.path).to.equal(getAiEducationFilePath(node.cerebrumStorageDir, node.id))
    expect(fs.readFileSync(first.body.path, 'utf8')).to.equal(legacy)
    const updated = await request(node, 'ai-education/save', { content: 'Nuove istruzioni\n', revision: first.body.revision })
    expect(updated.statusCode).to.equal(200)
    expect(node.aiEducation).to.equal('Nuove istruzioni\n')
    const stale = await request(node, 'ai-education/save', { content: 'stale overwrite', revision: first.body.revision })
    expect(stale.statusCode).to.equal(409)
    expect(node.aiEducation).to.equal('Nuove istruzioni\n')
    const oversized = await request(node, 'ai-education/save', { content: 'x'.repeat(16001), revision: updated.body.revision })
    expect(oversized.statusCode).to.equal(413)
    fs.writeFileSync(first.body.path, 'Modificata direttamente nel file')
    expect(node.aiEducation).to.equal('Modificata direttamente nel file')
    await close(node)
    node = create('education', { aiEducation: legacy })
    expect(node.aiEducation).to.equal('Modificata direttamente nel file')
    const current = await node.getAiEducationFile()
    await node.updateAiEducationFile({ content: '', revision: current.revision })
    await close(node)
    node = create('education', { aiEducation: legacy })
    expect(node.aiEducation).to.equal('')
  })

  it('backs up and restores AI Education as an authoritative file across node IDs and restarts', async () => {
    const source = create('education-source', { aiEducation: 'Regole originali obsolete' })
    const original = await source.getAiEducationFile()
    await source.updateAiEducationFile({ content: 'Educazione attuale: non accendere le luci di notte.\n', revision: original.revision })
    const exported = await request(source, 'export', { format: 'zip' })
    const backup = await decodeBackupUpload(exported.body)
    expect(backup.files.aiEducation.content).to.equal(source.aiEducation)
    expect(JSON.parse(backup.migration.flows.content).find(item => item.id === source.id)).not.to.have.property('aiEducation')
    let target = create('education-target', { aiEducation: 'Regole destinazione' })
    await target.importAiConfig(backup)
    expect(target.aiEducation).to.equal(source.aiEducation)
    const targetFile = (await target.getAiEducationFile()).path
    expect(targetFile).to.include('education-target.md')
    expect(fs.existsSync(path.join(path.dirname(targetFile), backup.files.aiEducation.name))).to.equal(false)
    await close(target)
    target = create('education-target', { aiEducation: 'Regole destinazione ancora nei vecchi flow' })
    expect(target.aiEducation).to.equal(source.aiEducation)
    backup.files.aiEducation = backupFile('aiEducation', 'ignored.md', '')
    await target.importAiConfig(backup)
    expect(target.aiEducation).to.equal('')
  })

  it('preserves the latest saved ETS selection and read-only permissions through ZIP migration and restart', async () => {
    const stale = { etsExposeConfigured: false, etsExposedGAs: [], etsReadOnlyGAs: [] }
    const access = { configured: true, exposedGAs: ['3/1/7', '3/1/8'], readOnlyGAs: ['3/1/8'] }
    const gateway = id => ({
      id,
      removeClient: noop,
      csv: [
        { ga: '3/1/7', dpt: '5.001', devicename: 'Tapparella soggiorno comando' },
        { ga: '3/1/8', dpt: '5.001', devicename: 'Tapparella soggiorno stato' },
        { ga: '3/1/15', dpt: '5.001', devicename: 'Tenda non selezionata' }
      ]
    })
    const source = create('ets-source', stale)
    source.serverKNX = gateway('gateway')
    await source.saveEtsAccessConfiguration(access)
    const download = await request(source, 'export', { format: 'zip' })
    expect(download.statusCode).to.equal(200)
    const backup = await decodeBackupUpload(download.body)
    expect(JSON.parse(backup.files.aiConfiguration.content).etsAccess).to.deep.equal(access)
    const migrated = JSON.parse(backup.migration.flows.content).find(item => item.id === source.id)
    expect(migrated).to.deep.include({ etsExposeConfigured: true, etsExposedGAs: access.exposedGAs, etsReadOnlyGAs: access.readOnlyGAs })
    // The portable flow already has current access, before the data ZIP is restored.
    let target = create('ets-target', { ...migrated, id: 'ets-target', server: 'new-gateway' })
    target.serverKNX = gateway('new-gateway')
    expect(await target.getEtsAccessSnapshot()).to.deep.include({ ...access, selectedCount: 2, readOnlyCount: 1 })
    await target.saveEtsAccessConfiguration({ configured: true, exposedGAs: ['3/1/15'], readOnlyGAs: [] })
    const upload = await request(target, 'import-chunk', { index: 0, total: 1, chunk: download.body.toString('base64') })
    expect(upload.statusCode).to.equal(200)
    const imported = await request(target, 'import', { uploadId: upload.body.uploadId })
    expect(imported.statusCode).to.equal(200)
    expect(imported.body.etsAccessRestored).to.equal(true)
    expect(imported.body.etsAccess).to.deep.include({ ...access, selectedCount: 2, readOnlyCount: 1, catalogIncluded: true })
    expect(imported.body.etsAccess.items.map(({ ga, selected, readOnly }) => ({ ga, selected, readOnly }))).to.have.deep.members([
      { ga: '3/1/7', selected: true, readOnly: false },
      { ga: '3/1/8', selected: true, readOnly: true },
      { ga: '3/1/15', selected: false, readOnly: false }
    ])
    await close(target)
    // Persisted selection survives stale editor properties and a missing gateway.
    target = create('ets-target', stale)
    expect(await target.getEtsAccessSnapshot()).to.deep.include({ ...access, selectedCount: 0, requestedSelectionCount: 2 })
    target.serverKNX = gateway('new-gateway')
    expect(await target.getEtsAccessSnapshot()).to.deep.include({ ...access, selectedCount: 2, readOnlyCount: 1 })
    expect(JSON.parse((await target.exportAiConfig()).files.aiConfiguration.content).etsAccess).to.deep.equal(access)
  })

  it('recovers legacy ETS access only from the source flow and preserves destination access when absent', async () => {
    const source = create('ets-legacy', { etsExposeConfigured: true, etsExposedGAs: ['1/2/3', '1/2/4'], etsReadOnlyGAs: ['1/2/3'] })
    const backup = await source.exportAiConfig()
    const configuration = JSON.parse(backup.files.aiConfiguration.content)
    const expected = { configured: true, exposedGAs: ['1/2/3', '1/2/4'], readOnlyGAs: ['1/2/3'] }
    expect(configuration.etsAccess).to.deep.equal(expected)
    expect(await source.getEtsAccessSnapshot()).to.deep.include(expected)
    delete configuration.etsAccess
    const setConfiguration = () => { backup.files.aiConfiguration = backupFile('aiConfiguration', 'ignored.json', JSON.stringify(configuration)) }
    setConfiguration()
    const flows = JSON.parse(backup.migration.flows.content)
    flows.unshift({ id: 'another-cerebrum', type: 'cerebrumUltimate', etsExposeConfigured: true, etsExposedGAs: ['9/9/9'], etsReadOnlyGAs: [] })
    backup.migration.flows = backupFile('nodeRedFlows', 'cerebrum-flows.json', JSON.stringify(flows))
    const target = create('ets-legacy-target', { etsExposeConfigured: true, etsExposedGAs: ['1/1/1'], etsReadOnlyGAs: [] })
    expect((await target.importAiConfig(backup)).etsAccess).to.deep.include(expected)
    configuration.etsAccess = null
    setConfiguration()
    expect((await target.importAiConfig(backup)).etsAccess).to.deep.include(expected)
    // No matching source is not permission to copy access from another node.
    backup.node.id = 'missing-source'
    const preserved = await target.importAiConfig(backup)
    expect(preserved.etsAccessRestored).to.equal(false)
    expect(preserved.etsAccess).to.deep.include(expected)
    delete backup.node.id
    delete configuration.nodeId
    setConfiguration()
    expect((await target.importAiConfig(backup)).etsAccessRestored).to.equal(false)
    // An explicit disabled/empty saved selection takes precedence over flows.
    configuration.etsAccess = { configured: false, exposedGAs: [], readOnlyGAs: [] }
    setConfiguration()
    const disabled = await target.importAiConfig(backup)
    expect(disabled.etsAccessRestored).to.equal(true)
    expect(disabled.etsAccess).to.deep.include(configuration.etsAccess)
  })

  it('migrates a null file-backed ETS selection from flow properties without clearing it on export', async () => {
    const config = { etsExposeConfigured: true, etsExposedGAs: ['1/2/3'], etsReadOnlyGAs: ['1/2/3'] }
    let node = create('ets-null', config)
    await close(node)
    seed(node, 'config/cerebrum-config-ets-null.json', JSON.stringify({ version: 4, etsAccess: null }))
    node = create('ets-null', config)
    const expected = { configured: true, exposedGAs: ['1/2/3'], readOnlyGAs: ['1/2/3'] }
    expect(await node.getEtsAccessSnapshot()).to.deep.include(expected)
    const backup = await node.exportAiConfig()
    expect(JSON.parse(backup.files.aiConfiguration.content).etsAccess).to.deep.equal(expected)
    await close(node)
    node = create('ets-null', { etsExposeConfigured: false, etsExposedGAs: [], etsReadOnlyGAs: [] })
    expect(await node.getEtsAccessSnapshot()).to.deep.include(expected)
  })

  it('rejects malformed backup ETS access without replacing saved permissions', async () => {
    const backup = await create('ets-invalid-source').exportAiConfig()
    const configuration = JSON.parse(backup.files.aiConfiguration.content)
    const target = create('ets-invalid-target', { etsExposeConfigured: true, etsExposedGAs: ['1/2/3'], etsReadOnlyGAs: ['1/2/3'] })
    const expected = await target.getEtsAccessSnapshot()
    for (const etsAccess of [
      { configured: true, exposedGAs: '1/2/3', readOnlyGAs: [] },
      { configured: true, exposedGAs: ['1/2/3'], readOnlyGAs: ['1/2/4'] },
      { configured: 'true', exposedGAs: ['1/2/3'], readOnlyGAs: [] }
    ]) {
      backup.files.aiConfiguration = backupFile('aiConfiguration', 'ignored.json', JSON.stringify({ ...configuration, etsAccess }))
      await rejects(target.importAiConfig(backup), error => error.status === 400 && /ETS/.test(error.message))
      expect(await target.getEtsAccessSnapshot()).to.deep.equal(expected)
    }
  })

  it('recovers AI Education from the source node in old backups and preserves it when absent', async () => {
    const source = create('legacy-education')
    const backup = await source.exportAiConfig()
    delete backup.files.aiEducation
    const flows = JSON.parse(backup.migration.flows.content)
    flows.find(item => item.id === source.id).aiEducation = 'Educazione dal vecchio flow'
    flows.push({ id: 'another-cerebrum', type: 'cerebrumUltimate', aiEducation: 'Do not import this other node' })
    backup.migration.flows = backupFile('nodeRedFlows', 'cerebrum-flows.json', JSON.stringify(flows))
    const target = create('legacy-education-target', { aiEducation: 'Educazione locale' })
    await target.importAiConfig(backup)
    expect(target.aiEducation).to.equal('Educazione dal vecchio flow')
    delete flows.find(item => item.id === source.id).aiEducation
    backup.migration.flows = backupFile('nodeRedFlows', 'cerebrum-flows.json', JSON.stringify(flows))
    await target.importAiConfig(backup)
    expect(target.aiEducation).to.equal('Educazione dal vecchio flow')
    backup.version = 1
    await target.importAiConfig(backup)
    expect(target.aiEducation).to.equal('Educazione dal vecchio flow')
  })

  it('rejects damaged AI Education and restores its previous file after a later import failure', async () => {
    const source = create('education-rollback-source', { aiEducation: 'Nuova educazione' })
    seed(source, 'history/education-rollback-source/2026-09-07.knxctx', 'archive')
    const backup = await source.exportAiConfig()
    const target = create('education-rollback-target', { aiEducation: 'Educazione da conservare' })
    const damaged = copy(backup)
    damaged.files.aiEducation.content += 'tamper'
    await rejects(target.importAiConfig(damaged), /aiEducation/)
    expect(target.aiEducation).to.equal('Educazione da conservare')
    const rename = fs.renameSync
    let failed = false
    fs.renameSync = function (from, to) {
      if (!failed && to.includes('history/education-rollback-target/')) { failed = true; throw new Error('simulated later archive failure') }
      return rename.apply(this, arguments)
    }
    try { await rejects(target.importAiConfig(backup), /later archive failure/) } finally { fs.renameSync = rename }
    expect(target.aiEducation).to.equal('Educazione da conservare')
    await close(target)
    expect(create('education-rollback-target').aiEducation).to.equal('Educazione da conservare')
  })

  it('fails visibly on unreadable education without replacing the file or using stale flow instructions', async () => {
    const node = create('education-invalid', { aiEducation: 'Legacy authority' })
    const educationPath = (await node.getAiEducationFile()).path
    const invalid = Buffer.from([0xff, 0xfe])
    fs.writeFileSync(educationPath, invalid)
    expect(node.aiEducation).to.equal('')
    await rejects(node.exportAiConfig(), /UTF-8/)
    expect(fs.readFileSync(educationPath).equals(invalid)).to.equal(true)
  })

  it('round trips the world model to the locally selected destination node filename', () => {
    const worldModel = JSON.stringify({ version: 1, entities: [{ id: 'kitchen', value: 'on' }], episodes: [{ id: 'morning', summary: 'Attività in cucina' }], situations: [{ id: 'quiet', nextCheckAt: '2026-09-06T10:00:00Z' }] })
    const source = supplementalLocations('source')
    const files = seedSupplemental(source, worldModel)
    expect(files.worldModel).to.include({ id: 'worldModel', name: 'cerebrum-world-model-source.json', content: worldModel })
    const target = supplementalLocations('target')
    replaceSupplementalFiles(files, target, writeSupplementalFile)
    expect(fs.readFileSync(target.worldModel, 'utf8')).to.equal(worldModel)
    expect(fs.existsSync(path.join(path.dirname(target.worldModel), files.worldModel.name))).to.equal(false)
    const restored = readSupplementalFiles(target)
    expect(restored.worldModel).to.include({ content: worldModel, sha256: files.worldModel.sha256, bytes: files.worldModel.bytes })
    expect(() => validateSupplementalFiles(restored)).not.to.throw()
  })

  it('skips optional world-model entries or locations without deleting existing destination state', () => {
    const files = seedSupplemental(supplementalLocations('legacy', false))
    expect(files).not.to.have.property('worldModel')
    expect(() => validateSupplementalFiles(files)).not.to.throw()
    const target = supplementalLocations('target')
    seedSupplemental(target, '{"version":1,"marker":"keep"}')
    replaceSupplementalFiles(files, target, writeSupplementalFile)
    expect(fs.readFileSync(target.worldModel, 'utf8')).to.include('keep')
    files.worldModel = backupFile('worldModel', 'ignored.json', '{"version":1}')
    expect(() => replaceSupplementalFiles(files, supplementalLocations('without-world', false), writeSupplementalFile)).not.to.throw()
  })

  it('rejects damaged world-model content before changing destination files', () => {
    const files = seedSupplemental(supplementalLocations('source'), '{"version":1,"marker":"source"}')
    files.worldModel.content += 'damage'
    const target = supplementalLocations('target')
    const original = seedSupplemental(target, '{"version":1,"marker":"original"}')
    expect(() => replaceSupplementalFiles(files, target, writeSupplementalFile)).to.throw('worldModel')
    expect(readSupplementalFiles(target)).to.deep.equal(original)
  })

  it('restores the prior world model after a later supplemental write fails, including an originally absent model', () => {
    const files = seedSupplemental(supplementalLocations('source'), '{"version":1,"marker":"new"}')
    files.lastChatPrompt = backupFile('lastChatPrompt', 'last-prompt.txt', 'new prompt')
    for (const existing of [true, false]) {
      const target = supplementalLocations(existing ? 'existing-target' : 'empty-target')
      const previous = seedSupplemental(target, existing ? '{"version":1,"marker":"original"}' : undefined)
      expect(() => replaceSupplementalFiles(files, target, entry => {
        if (entry.filePath === target.lastChatPrompt) throw new Error('simulated later write error')
        writeSupplementalFile(entry)
      })).to.throw('simulated later write error')
      expect(fs.readFileSync(target.worldModel, 'utf8')).to.include('new')
      replaceSupplementalFiles(previous, target, writeSupplementalFile)
      expect(readSupplementalFiles(target)).to.deep.equal(previous)
      expect(fs.existsSync(target.worldModel)).to.equal(existing)
    }
  })

  it('round trips every archive, checkpoint and learning data to a new node ID, including after restart', async () => {
    const source = create('source')
    source._chatContext.sessions = [{ id: 'chat-person', turns: [{ question: 'Accendi cucina', reply: 'Fatto' }], instructions: [{ text: 'Preferisco luce calda' }], cameraWatches: [{ id: 'watch', cameraId: 'camera-1', eventType: 'motion' }] }]
    source._scheduleStore.tasks = [{ id: 'reminder', kind: 'monitor', title: 'Controlla cucina', instruction: 'Controlla cucina', sessionId: 'chat-person', status: 'active', startAt: new Date(Date.now() + 86400000).toISOString(), nextRunAt: new Date(Date.now() + 86400000).toISOString(), intervalMinutes: 60 }]
    source._homeMemory.habits = [{ id: 'learning-progress', type: 'temporal_state_pattern', status: 'learning', source: 'adapter', objectId: 'light.kitchen', value: 'on', samples: 2, observationDays: 2 }]
    const observedAt = Date.now()
    source._webRequestTimestamps = [observedAt - 1000, observedAt]
    source._webAccessLastSuccessAt = observedAt
    source._cameraWatchLastTriggered.set('watch', observedAt)
    source._proactiveStates.set('1/2/3', { ga: '1/2/3', open: true, openedAt: observedAt - 60000, lastSeenAt: observedAt, lastSentAt: observedAt, nextCheckAt: Infinity, value: true, confidence: 0.9 })
    expect(source._autonomyRuntime.ingestState({ source: 'adapter', objectId: 'light.kitchen', label: 'Kitchen light', kind: 'light', area: 'Kitchen', value: 'on', observedAt: new Date(observedAt).toISOString() })).to.equal(true)
    await source.saveEtsAccessConfiguration({ configured: true, exposedGAs: [], readOnlyGAs: [] })
    const day = new Date().toISOString().slice(0, 10)
    seed(source, `history/source/${day}.knxctx`, 'knx-data\n')
    seed(source, `adapter-history/source/${day}.knxctx`, 'adapter-data\n')
    seed(source, `history/source/${day}.jsonl`, '{"legacy":true}\n')
    seed(source, 'debug/cerebrum-last-chat-prompt-source.txt', 'last prompt\n')
    source.recordCerebrumOperation({ category: 'autonomous', operation: 'migration-marker', status: 'succeeded', title: 'Migration marker' })
    const download = await request(source, 'export', { format: 'zip' })
    expect(download.statusCode).to.equal(200)
    expect(download.headers).to.include({ 'content-type': 'application/zip', 'cache-control': 'no-store' })
    expect(download.headers['content-disposition']).to.match(/^attachment; filename=".*\.zip"$/)
    const backup = await decodeBackupUpload(download.body)
    expect(backup.version).to.equal(2)
    const runtimeState = JSON.parse(backup.supplementalFiles.runtimeState.content)
    expect(runtimeState.webRequestTimestamps).to.deep.equal([observedAt - 1000, observedAt])
    expect(runtimeState.cameraWatchLastTriggered).to.deep.equal([['watch', observedAt]])
    expect(runtimeState.proactiveStates[0].nextCheckAt).to.equal(Number.MAX_SAFE_INTEGER)
    expect(backup.supplementalFiles.worldObservations.content).to.be.a('string')
    expect(JSON.parse(backup.supplementalFiles.worldModel.content).entities.some(entity => entity.id === 'adapter:light.kitchen' && entity.value === 'on')).to.equal(true)
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
    let uploadId
    const chunkSize = 137
    const total = Math.ceil(download.body.length / chunkSize)
    for (let index = 0; index < total; index++) {
      const response = await request(target, 'import-chunk', { uploadId, index, total, chunk: download.body.subarray(index * chunkSize, (index + 1) * chunkSize).toString('base64') })
      expect(response.statusCode).to.equal(200)
      uploadId = response.body.uploadId
    }
    const imported = await request(target, 'import', { uploadId })
    expect(imported.statusCode).to.equal(200)
    expect(imported.body.ok).to.equal(true)
    expect(fs.existsSync(path.join(storage(target), 'history/target/2000-01-01.knxctx'))).to.equal(false)
    expect(target.llmApiKey).to.equal('DESTINATION-KEY')
    expect(target.llmModel).to.equal('saved-model')
    expect(target._chatContext.instructions[0].text).to.equal('Preferisco luce calda')
    expect(target._chatContext.turns[0].question).to.equal('Accendi cucina')
    expect(target._chatContext.sessions[0].cameraWatches[0].cameraId).to.equal('camera-1')
    expect(target._scheduleStore.tasks[0]).to.include({ id: 'reminder', title: 'Controlla cucina', sessionId: 'chat-person' })
    expect(target._homeMemory.habits[0]).to.include({ id: 'learning-progress', samples: 2 })
    expect(target._webRequestTimestamps).to.deep.equal([observedAt - 1000, observedAt])
    expect(target._cameraWatchLastTriggered.get('watch')).to.equal(observedAt)
    expect(target._proactiveStates.get('1/2/3')).to.include({ open: true, openedAt: observedAt - 60000, nextCheckAt: Number.MAX_SAFE_INTEGER })
    for (const [group, dir] of [['history', 'history'], ['adapterHistory', 'adapter-history'], ['operations', 'operations']]) {
      for (const file of backup.supplementalFiles[group]) expect(fs.readFileSync(path.join(storage(target), dir, 'target', file.name), 'utf8')).to.equal(file.content)
    }
    expect(fs.readFileSync(path.join(storage(target), 'debug/cerebrum-last-chat-prompt-target.txt'), 'utf8')).to.equal('last prompt\n')
    await close(target)
    target = create('target', { ...migratedConfig, id: 'target' })
    expect(target._homeMemory.habits[0]).to.include({ id: 'learning-progress', samples: 2 })
    expect(target._webRequestTimestamps).to.deep.equal([observedAt - 1000, observedAt])
    expect(target._webAccessLastSuccessAt).to.equal(observedAt)
    expect(target._cameraWatchLastTriggered.get('watch')).to.equal(observedAt)
    expect(target._proactiveStates.get('1/2/3')).to.include({ open: true, openedAt: observedAt - 60000, nextCheckAt: Number.MAX_SAFE_INTEGER })
    expect(target._autonomyRuntime.snapshot().entities.some(entity => entity.id === 'adapter:light.kitchen' && entity.value === 'on')).to.equal(true)
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
    expect(error).to.be.instanceOf(Error)
    expect(error.message).to.include('Archive write failed')
    expect(error.message).to.include('simulated append error')
  })

  it('includes directly usable migration files in a compressed ZIP', async () => {
    const node = create('zip-source')
    const backup = await node.exportAiConfig()
    backup.node.name = 'Casa è memoria 🏠'
    const bytes = await createBackupZip(backup)
    expect(bytes.length).to.be.lessThan(Buffer.byteLength(JSON.stringify(backup)))
    const zip = await yauzl.fromBufferPromise(bytes, { lazyEntries: true })
    const files = {}
    for await (const entry of zip.eachEntry()) {
      const chunks = []
      for await (const chunk of await zip.openReadStreamPromise(entry)) chunks.push(chunk)
      files[entry.fileName] = Buffer.concat(chunks).toString('utf8')
    }
    expect(Object.keys(files)).to.have.members(['cerebrum-backup.json', 'cerebrum-flows.json', 'required-packages.json', 'README.txt', 'archives/sharedMemory/cerebrum-memory.jsonl'])
    expect(JSON.parse(files['cerebrum-flows.json'])).to.deep.equal(JSON.parse(backup.migration.flows.content))
    expect(JSON.parse(files['required-packages.json'])).to.deep.equal(backup.migration.dependencies)
    expect(files['README.txt']).to.include('Ripristina ZIP')
    expect(JSON.parse(files['cerebrum-backup.json']).version).to.equal(3)
    expect(await decodeBackupUpload(bytes)).to.deep.equal(backup)
    expect(await decodeBackupUpload(Buffer.from(JSON.stringify(backup)))).to.deep.equal(backup)
    expect((await request(node, 'export')).body.format).to.equal('cerebrum-ultimate-backup')
  })

  it('downloads and restores over 512 MiB of history, including individual files over 256 MiB', async function () {
    this.timeout(60000)
    const source = create('large-source')
    const block = 'KNX history marker è casa 🏠\n'.repeat(1024)
    const content = Buffer.from(block.repeat(Math.ceil(1024 * 1024 / Buffer.byteLength(block))))
    const copies = 260
    const contentBytes = content.length * copies
    const expectedHash = crypto.createHash('sha256')
    for (let index = 0; index < copies; index++) expectedHash.update(content)
    const digest = expectedHash.digest('hex')
    const names = Array.from({ length: 2 }, (_, index) => `${new Date(Date.now() - index * 86400000).toISOString().slice(0, 10)}.knxctx`)
    for (const name of names) {
      seed(source, `history/large-source/${name}`, '')
      const fd = fs.openSync(path.join(storage(source), 'history/large-source', name), 'w')
      try { for (let index = 0; index < copies; index++) fs.writeSync(fd, content) } finally { fs.closeSync(fd) }
    }
    expect(contentBytes).to.be.greaterThan(256 * 1024 * 1024)
    expect(contentBytes * names.length).to.be.greaterThan(512 * 1024 * 1024)
    const prepared = await request(source, 'export', { format: 'zip', download: true })
    expect(prepared.statusCode).to.equal(200)
    expect(prepared.body.downloadId).to.match(/^[a-f0-9]{64}$/)
    expect((await request({ id: 'different-node' }, 'download', prepared.body)).statusCode).to.equal(404)
    const download = await request(source, 'download', prepared.body)
    expect(download.statusCode).to.equal(200)
    expect(Number(download.headers['content-length'])).to.equal(download.body.length)
    expect((await request(source, 'download', prepared.body)).statusCode).to.equal(404)
    expect(download.body.length).to.be.lessThan(256 * 1024 * 1024)
    const zip = await yauzl.fromBufferPromise(download.body, { lazyEntries: true })
    for await (const entry of zip.eachEntry()) {
      if (entry.fileName === 'cerebrum-backup.json') expect(entry.uncompressedSize).to.be.lessThan(1024 * 1024)
    }
    const target = create('large-target')
    const chunkSize = 48 * 1024
    const total = Math.ceil(download.body.length / chunkSize)
    let uploadId
    for (let index = 0; index < total; index++) {
      const response = await request(target, 'import-chunk', { uploadId, index, total, chunk: download.body.subarray(index * chunkSize, (index + 1) * chunkSize).toString('base64') })
      expect(response.statusCode).to.equal(200)
      uploadId = response.body.uploadId
    }
    const imported = await request(target, 'import', { uploadId })
    expect(imported.statusCode).to.equal(200)
    for (const name of names) {
      const filePath = path.join(storage(target), 'history/large-target', name)
      expect(fs.statSync(filePath).size).to.equal(contentBytes)
      const restoredHash = crypto.createHash('sha256')
      for await (const chunk of fs.createReadStream(filePath)) restoredHash.update(chunk)
      expect(restoredHash.digest('hex')).to.equal(digest)
    }
  })

  it('keeps version 2 ZIPs importable and checks every version 3 archive reference', async () => {
    const source = create('zip-references')
    seed(source, 'history/zip-references/2026-09-07.knxctx', 'archive marker 🏠\n')
    const backup = await source.exportAiConfig()
    delete backup.supplementalFiles.sharedMemory // Exercise a legacy archive manifest.
    const legacy = await zipEntries([['cerebrum-backup.json', JSON.stringify(backup)]])
    expect(await decodeBackupUpload(legacy)).to.deep.equal(backup)
    const manifest = copy(backup)
    manifest.version = 3
    const file = manifest.supplementalFiles.history[0]
    const archive = file.content
    delete file.content
    file.zipEntry = `archives/history/${file.name}`
    const encode = (extra = []) => zipEntries([['cerebrum-backup.json', JSON.stringify(manifest)], ...extra])
    await rejects(decodeBackupUpload(Buffer.from(JSON.stringify(manifest))), /Unsupported/)
    await rejects(decodeBackupUpload(await encode()), /reference/)
    await rejects(decodeBackupUpload(await encode([[file.zipEntry, 'damaged']])), /damaged/)
    await rejects(decodeBackupUpload(await encode([[file.zipEntry, archive], ['archives/history/2000-01-01.knxctx', 'extra']])), /Unreferenced/)
    const originalEntry = file.zipEntry
    file.zipEntry = 'archives/operations/2026-09-07.knxctx'
    await rejects(decodeBackupUpload(await encode([[originalEntry, archive]])), /reference/)
    file.zipEntry = originalEntry
    expect(await decodeBackupUpload(await encode([[file.zipEntry, archive]]))).to.deep.equal(backup)
    const oversized = await zipEntries([
      ['archives/history/2026-09-05.knxctx', 'a'],
      ['archives/history/2026-09-06.knxctx', 'b'],
      ['archives/history/2026-09-07.knxctx', 'c'],
      ['cerebrum-backup.json', JSON.stringify(manifest)]
    ])
    // Declared sizes must match the actual decoded archive streams.
    let offset = 0
    for (let index = 0; index < 3; index++) {
      offset = oversized.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]), offset)
      oversized.writeUInt32LE(180 * 1024 * 1024, offset + 24)
      offset++
    }
    await rejects(decodeBackupUpload(oversized), /ZIP|size/)
  })

  it('accepts old JSON and rejects unrelated, truncated or damaged ZIP backups', async () => {
    const backup = { format: 'cerebrum-ultimate-backup', version: 1, node: { name: 'Casa 🏠' } }
    expect(await decodeBackupUpload(Buffer.from(JSON.stringify(backup)))).to.deep.equal(backup)
    const bytes = await createBackupZip(backup)
    await rejects(decodeBackupUpload(bytes.subarray(0, -15)), /Invalid.*ZIP/)
    await rejects(decodeBackupUpload(await zipEntries([['README.txt', 'No backup']])), /Missing cerebrum-backup.json/)
    await rejects(decodeBackupUpload(await zipEntries([['cerebrum-backup.json', '{}']])), /Unsupported/)
    const damaged = Buffer.from(bytes)
    const centralHeader = damaged.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]))
    damaged.writeUInt32LE((damaged.readUInt32LE(centralHeader + 16) ^ 1) >>> 0, centralHeader + 16)
    await rejects(decodeBackupUpload(damaged), /Damaged.*ZIP/)
  })

  it('bounds JSON metadata and rejects duplicate names, paths, symlinks and encryption', async () => {
    const content = JSON.stringify({ format: 'cerebrum-ultimate-backup', version: 1, repeated: 'x'.repeat(10000) })
    await rejects(decodeBackupUpload(await zipEntries([['cerebrum-backup.json', content], ['cerebrum-backup.json', content]])), /duplicate/)
    await rejects(decodeBackupUpload(await zipEntries([['cerebrum-backup.json', content, { mode: 0o120777 }]])), /Unsupported/)
    const zip = await zipEntries([['cerebrum-backup.json', content]])
    const centralHeader = zip.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]))
    const unsafe = Buffer.from(zip)
    unsafe.write('../', centralHeader + 46)
    await rejects(decodeBackupUpload(unsafe), /Invalid.*ZIP/)
    const encrypted = Buffer.from(zip)
    encrypted.writeUInt16LE(encrypted.readUInt16LE(centralHeader + 8) | 1, centralHeader + 8)
    await rejects(decodeBackupUpload(encrypted), /Unsupported/)
    const oversized = Buffer.from(zip)
    oversized.writeUInt32LE(256 * 1024 * 1024 + 1, centralHeader + 24)
    await rejects(decodeBackupUpload(oversized), /exceeds 256 MiB/)
    const dishonestSize = Buffer.from(zip)
    dishonestSize.writeUInt32LE(10, centralHeader + 24)
    await rejects(decodeBackupUpload(dishonestSize), /ZIP|exceeds/)
  })

  it('validates ZIP file checksums before replacing any destination data', async () => {
    const node = create('zip-damage')
    const backup = await node.exportAiConfig()
    const memoryPath = path.join(storage(node), 'memory', backup.files.homeMemory.name)
    const originalMemory = fs.readFileSync(memoryPath, 'utf8')
    backup.files.homeMemory.content += 'damage'
    const zip = await createBackupZip(backup)
    const chunk = await request(node, 'import-chunk', { index: 0, total: 1, chunk: zip.toString('base64') })
    const response = await request(node, 'import', chunk.body)
    expect(response.statusCode).to.equal(400)
    expect(response.body.error).to.include('homeMemory')
    expect(fs.readFileSync(memoryPath, 'utf8')).to.equal(originalMemory)
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

  it('accepts uploads over 256 MiB on disk and removes their temporary files after use or write failure', function () {
    this.timeout(15000)
    const uploads = createBackupUploads()
    const bytes = Buffer.alloc(48 * 1024, 42)
    const chunk = bytes.toString('base64')
    const total = Math.floor(256 * 1024 * 1024 / bytes.length) + 1
    let uploadId
    for (let index = 0; index < total; index++) {
      uploadId = uploads.append({ owner: 'one', nodeId: 'a', uploadId, index, total, chunk }).uploadId
    }
    const upload = uploads.takeFile({ owner: 'one', nodeId: 'a', uploadId })
    try { expect(fs.statSync(upload.filePath).size).to.equal(bytes.length * total) } finally { upload.cleanup() }
    expect(fs.existsSync(path.dirname(upload.filePath))).to.equal(false)
    const append = fs.appendFileSync
    let failedPath
    fs.appendFileSync = filePath => { failedPath = filePath; throw new Error('simulated full disk') }
    try {
      expect(() => uploads.append({ owner: 'one', nodeId: 'a', index: 0, total: 1, chunk })).to.throw('full disk')
    } finally { fs.appendFileSync = append }
    expect(fs.existsSync(path.dirname(failedPath))).to.equal(false)
  })
})
