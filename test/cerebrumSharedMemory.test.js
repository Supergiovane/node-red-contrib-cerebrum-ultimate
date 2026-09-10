'use strict'
/* eslint-env mocha */
const { expect } = require('chai')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { rejects } = require('assert').strict
const { normalizeCerebrumHistoryRetentionDays } = require('../nodes/utils/cerebrumHistoryRetention')
const { createCerebrumSharedArchive, validateCerebrumSharedArchive } = require('../nodes/utils/cerebrumSharedArchive')
const { addCerebrumChatInstruction, addCerebrumChatTurn, buildCerebrumChatContextFile, buildCerebrumChatPromptContext, buildCerebrumSharedMemoryPromptContext, clearCerebrumChatSession, createEmptyCerebrumChatContext, parseCerebrumChatContextFileStrict, removeCerebrumChatInstructions } = require('../nodes/utils/cerebrumChatContext')

describe('Cerebrum shared household memory', () => {
  let root
  beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'cerebrum-shared-memory-')) })
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

  it('shares saved actuator values and conversation context across Web, Telegram, restart and chat clearing', () => {
    const scene = 'Relax: Persiana soggiorno, stato 1/2/3 DPT 5.001 = 37%, comando 1/2/4, osservato 2026-09-07T10:00:00Z'
    let context = addCerebrumChatInstruction(createEmptyCerebrumChatContext(), { sessionId: 'sidebar', text: scene })
    context = addCerebrumChatTurn(context, { sessionId: 'sidebar', question: 'Salva Relax', reply: 'Valori salvati: 37%.' })
    const restored = parseCerebrumChatContextFileStrict(buildCerebrumChatContextFile({ context }).content)
    const prompt = buildCerebrumChatPromptContext({ context: restored, sessionId: 'telegram:42', currentQuestion: 'Richiama Relax' })
    expect(prompt).to.include(scene).and.include('Salva Relax').and.include('37%')
    expect(buildCerebrumChatPromptContext({ context: clearCerebrumChatSession(restored, 'sidebar'), sessionId: 'telegram:42' })).to.include(scene)
    const forgotten = removeCerebrumChatInstructions(restored, { sessionId: 'telegram:42', text: scene })
    expect(forgotten.instructions).to.have.length(0)
  })

  it('keeps paginated archive searches stable while new conversations and tool logs are appended', async () => {
    const archive = createCerebrumSharedArchive(path.join(root, 'common.jsonl'))
    const records = Array.from({ length: 8 }, (_, index) => archive.append({ kind: 'conversation', data: { text: `Relax ${index}` } }))
    const snapshotBytes = archive.snapshotBytes()
    const seen = []
    let offset = 0
    do {
      const result = await archive.query({ text: 'Relax', limit: 2, offset, snapshotBytes })
      seen.push(...result.items.map(item => item.id))
      archive.append({ kind: 'operation', data: { text: 'Relax query tool log' } })
      offset = result.nextOffset
    } while (offset !== null)
    expect(seen).to.deep.equal(records.map(record => record.id).reverse())
    const fresh = await archive.query({ text: 'Relax' })
    expect(fresh.totalMatches).to.equal(12)
  })

  it('appends an ordered batch with valid byte offsets using one durable write sequence', () => {
    const filePath = path.join(root, 'common.jsonl')
    const archive = createCerebrumSharedArchive(filePath)
    const originals = {
      openSync: fs.openSync,
      fstatSync: fs.fstatSync,
      writeSync: fs.writeSync,
      fsyncSync: fs.fsyncSync
    }
    const calls = { open: 0, fstat: 0, write: 0, fsync: 0 }
    try {
      fs.openSync = function (...args) { calls.open++; return originals.openSync.apply(this, args) }
      fs.fstatSync = function (...args) { calls.fstat++; return originals.fstatSync.apply(this, args) }
      fs.writeSync = function (...args) { calls.write++; return originals.writeSync.apply(this, args) }
      fs.fsyncSync = function (...args) { calls.fsync++; return originals.fsyncSync.apply(this, args) }
      const records = archive.appendMany([
        { kind: 'knx', at: '2026-09-09T10:00:00.000Z', data: { destination: '1/2/3', value: 'è' } },
        { kind: 'adapter', channel: 'unifi', at: '2026-09-09T10:00:01.000Z', data: { camera: 'Ingresso', icon: '🏠' } },
        { kind: 'observation', nodeId: 'cerebrum-1', at: '2026-09-09T10:00:02.000Z', data: { text: 'Movimento' } }
      ])
      expect(calls).to.deep.equal({ open: 1, fstat: 2, write: 1, fsync: 1 })
      expect(records.map(record => record.kind)).to.deep.equal(['knx', 'adapter', 'observation'])
      expect(new Set(records.map(record => record.id)).size).to.equal(records.length)
      let position = 0
      for (const [index, line] of fs.readFileSync(filePath, 'utf8').trimEnd().split('\n').entries()) {
        const saved = JSON.parse(line)
        expect(saved).to.deep.equal(records[index])
        expect(saved.id).to.match(/^m[0-9a-f-]{36}$/)
        expect(saved.offset).to.equal(position)
        position += Buffer.byteLength(`${line}\n`)
      }
      expect(() => validateCerebrumSharedArchive({ filePath })).not.to.throw()
    } finally {
      Object.assign(fs, originals)
    }
    const single = archive.append({ kind: 'conversation', data: { text: 'compatibile' } })
    expect(single).to.include({ version: 2, kind: 'conversation' })
    expect(single.offset).to.equal(fs.readFileSync(filePath).length - Buffer.byteLength(`${JSON.stringify(single)}\n`))
    expect(() => validateCerebrumSharedArchive({ filePath })).not.to.throw()
  })

  it('truncates a partially written batch and durably preserves all earlier raw records', async () => {
    const filePath = path.join(root, 'common.jsonl')
    const archive = createCerebrumSharedArchive(filePath)
    const original = archive.append({ kind: 'conversation', data: { text: 'raw evidence before batch' } })
    const originalBytes = fs.readFileSync(filePath)
    const writeSync = fs.writeSync
    const fsyncSync = fs.fsyncSync
    let failed = false
    let rollbackFsyncs = 0
    try {
      fs.writeSync = function (fd, buffer, offset, length, ...rest) {
        if (!failed) {
          failed = true
          writeSync.call(this, fd, buffer, offset, Math.max(1, Math.floor(length / 2)), ...rest)
          throw new Error('simulated partial batch write')
        }
        return writeSync.call(this, fd, buffer, offset, length, ...rest)
      }
      fs.fsyncSync = function (...args) { rollbackFsyncs++; return fsyncSync.apply(this, args) }
      expect(() => archive.appendMany([
        { kind: 'knx', data: { value: 1 } },
        { kind: 'knx', data: { value: 2 } }
      ])).to.throw('simulated partial batch write')
    } finally {
      fs.writeSync = writeSync
      fs.fsyncSync = fsyncSync
    }
    expect(rollbackFsyncs).to.equal(1)
    expect(fs.readFileSync(filePath)).to.deep.equal(originalBytes)
    expect(() => validateCerebrumSharedArchive({ filePath })).not.to.throw()
    expect((await archive.query()).items.map(item => item.id)).to.deep.equal([original.id])
    const fresh = archive.append({ kind: 'conversation', data: { text: 'raw evidence after rollback' } })
    expect(fresh.offset).to.equal(originalBytes.length)
  })

  it('migrates every legacy turn to the archive before bounding the shared working view', async () => {
    const archive = createCerebrumSharedArchive(path.join(root, 'common.jsonl'))
    const lines = ['CEREBRUM_CHAT_CONTEXT\t3', 'CREATED_AT\tnow', 'UPDATED_AT\tnow']
    for (let index = 0; index < 60; index++) lines.push(`SESSION\tchat-${index}\tnow`, `TURN\tnow\tRicordo unico ${index}\tRisposta completa ${index}`, `INSTRUCTION\tnow\tPreferenza ${index}`, 'END_SESSION')
    const context = parseCerebrumChatContextFileStrict(lines.join('\n'), { onTurn: turn => archive.append({ kind: 'conversation', data: turn, channel: turn.channel }) })
    expect(context.turns).to.have.length(24)
    expect(context.instructions).to.have.length(60)
    expect((await archive.query({ text: 'Ricordo', kind: 'conversation' })).totalMatches).to.equal(60)
    const content = buildCerebrumChatContextFile({ context }).content
    expect(content).to.include('GLOBAL_TURN').and.include('GLOBAL_INSTRUCTION')
    const { formatChatLearningSimpleText } = await import('../ui/cerebrumUltimate-vue/src/chatLearningView.mjs')
    expect(formatChatLearningSimpleText(content, { language: 'it' })).to.include('Memoria condivisa — tutti i canali').and.include('Preferenza 0')
  })

  it('retains complete messages beyond the former 512 KiB limit and retrieves them after restart from another channel', async () => {
    const filePath = path.join(root, 'common.jsonl')
    let archive = createCerebrumSharedArchive(filePath)
    const text = `Salvataggio attuatori unico\n${'dati è 🏠\n'.repeat(60000)}1/2/3=37; 1/2/4=61`
    const saved = archive.append({ kind: 'conversation', channel: 'sidebar', data: { question: text, reply: 'Salvato' } })
    for (let index = 0; index < 60; index++) archive.append({ kind: 'conversation', channel: `telegram:${index}`, data: { question: `Messaggio ${index}` } })
    expect(fs.statSync(filePath).size).to.be.greaterThan(512 * 1024)
    archive = createCerebrumSharedArchive(filePath)
    const found = await archive.query({ text: 'Salvataggio attuatori unico', kind: 'conversation' })
    expect(found.items[0]).to.include({ id: saved.id, complete: false, channel: 'sidebar' })
    let offset = 0
    let full = ''
    do {
      const part = await archive.query({ operation: 'get', text: saved.id, offset })
      expect(part.ok).to.equal(true)
      full += part.content
      offset = part.nextOffset
    } while (offset !== null)
    expect(JSON.parse(full)).to.deep.equal({ question: text, reply: 'Salvato' })
  })

  it('uses one file from two nodes and preserves a torn tail before accepting later writes', async () => {
    const filePath = path.join(root, 'common.jsonl')
    const web = createCerebrumSharedArchive(filePath)
    web.append({ kind: 'conversation', channel: 'web', data: { text: 'Before crash' } })
    fs.appendFileSync(filePath, '{"incomplete":')
    const telegram = createCerebrumSharedArchive(filePath)
    expect(telegram.recoveredBytes).to.be.greaterThan(0)
    telegram.append({ kind: 'conversation', channel: 'telegram:42', data: { text: 'After restart' } })
    web.append({ kind: 'knx', data: { destination: '1/2/3', payload: 37 } })
    expect((await telegram.query()).totalMatches).to.equal(3)
    expect(fs.readdirSync(root).some(name => name.includes('.incomplete-'))).to.equal(true)
  })

  it('selects relevant older memories without cutting actuator records mid-value', () => {
    const scene = `Relax ${'dettaglio '.repeat(185)}1/2/3=37; 1/2/4=61`
    let context = addCerebrumChatInstruction({}, { text: scene, at: '2026-01-01' })
    for (let index = 0; index < 30; index++) context = addCerebrumChatInstruction(context, { text: `Preferenza irrilevante ${index}`, at: '2026-09-07' })
    const prompt = buildCerebrumSharedMemoryPromptContext({ context, currentQuestion: 'Richiama Relax', maxChars: 2400 })
    expect(prompt).to.include(scene)
    const compact = buildCerebrumSharedMemoryPromptContext({ context, currentQuestion: 'Relax', maxChars: 1000 })
    expect(compact).not.to.include('Relax')
    expect(compact).to.include('omitted')
    expect(() => addCerebrumChatInstruction(context, { text: 'x'.repeat(2001) })).to.throw('2000')
  })

  it('validates archive record offsets and rejects corrupt restores without a size cap', async () => {
    const filePath = path.join(root, 'common.jsonl')
    const archive = createCerebrumSharedArchive(filePath)
    const record = archive.append({ kind: 'conversation', data: { text: 'Memoria è 🏠' } })
    archive.append({ kind: 'knx', data: { value: 37 } })
    expect(() => validateCerebrumSharedArchive({ filePath })).not.to.throw()
    const content = fs.readFileSync(filePath, 'utf8')
    expect(() => validateCerebrumSharedArchive({ content: content.replace(record.id, 'invalid') })).to.throw('record')
    expect(() => validateCerebrumSharedArchive({ content: content.replace('"offset":0', '"offset":99') })).to.throw('record')
    expect(() => validateCerebrumSharedArchive({ content: content.slice(0, -1) })).to.throw('Incomplete')
    expect((await archive.query({ operation: 'get', text: 'm9999999999999999999999' })).ok).to.equal(false)
  })

  it('defaults retention to 30 days and rejects malformed or unsafe settings', () => {
    for (const value of [undefined, null, '', 0, -1, 1.5, 'invalid', Infinity, 36501, true, []]) expect(normalizeCerebrumHistoryRetentionDays(value)).to.equal(30)
    for (const value of [1, '7', 30, 90, 36500]) expect(normalizeCerebrumHistoryRetentionDays(value)).to.equal(Number(value))
  })

  it('expires all historical kinds across channels, preserving the cutoff, future and unknown timestamps', async () => {
    const archive = createCerebrumSharedArchive(path.join(root, 'common.jsonl'))
    const now = Date.parse('2026-09-08T12:00:00Z')
    const cutoff = now - 30 * 86400000
    const removed = ['conversation', 'knx', 'adapter', 'operation', 'context', 'instruction'].map((kind, index) => archive.append({ kind, nodeId: `node-${index}`, channel: index % 2 ? 'web' : 'telegram:42', at: new Date(cutoff - 1).toISOString(), data: { text: 'expired è 🏠' } }))
    const retained = [cutoff, now, now + 86400000].map(at => archive.append({ kind: 'conversation', at: new Date(at).toISOString(), data: { text: 'retained è 🏠' } }))
    retained.push(archive.append({ kind: 'context', at: 'unknown', data: { text: 'undated' } }))
    const originalSize = archive.snapshotBytes()
    const result = await archive.prune({ retentionDays: 30, now })
    expect(result.removed).to.equal(removed.length)
    expect(archive.snapshotBytes()).to.be.lessThan(originalSize)
    expect(() => validateCerebrumSharedArchive({ filePath: archive.filePath })).not.to.throw()
    expect((await archive.query()).items.map(item => item.id)).to.deep.equal(retained.map(record => record.id).reverse())
    for (const record of removed) expect((await archive.query({ operation: 'get', text: record.id })).ok).to.equal(false)
    expect(fs.readdirSync(root)).to.deep.equal(['common.jsonl', 'common.jsonl.retention-state.json'])
  })

  it('compacts legacy offsets without changing retained IDs and invalidates old search snapshots', async () => {
    const filePath = path.join(root, 'common.jsonl')
    const now = Date.parse('2026-09-08T12:00:00Z')
    const old = JSON.stringify({ version: 1, id: 'm0', at: '2025-01-01', kind: 'conversation', data: { text: 'old 🏠' } }) + '\n'
    const saved = { version: 1, id: `m${Buffer.byteLength(old)}`, at: new Date(now).toISOString(), kind: 'conversation', data: { text: 'Relax 37% è 🏠' } }
    fs.writeFileSync(filePath, old + JSON.stringify(saved) + '\n')
    expect(() => validateCerebrumSharedArchive({ filePath })).not.to.throw()
    expect(() => validateCerebrumSharedArchive({ content: old.replace('m0', 'm99') })).to.throw('record')
    const archive = createCerebrumSharedArchive(filePath)
    const view = archive.snapshot()
    await archive.query({ text: 'Relax' }) // Populate the old offset cache.
    await archive.prune({ retentionDays: 30, now })
    expect((await archive.query({ snapshot: view })).snapshotExpired).to.equal(true)
    expect(JSON.parse((await archive.query({ operation: 'get', text: saved.id })).content)).to.deep.equal(saved.data)
    const restarted = createCerebrumSharedArchive(filePath)
    const appended = restarted.append({ kind: 'conversation', data: { text: 'new' } })
    expect(appended.id).not.to.equal('m0').and.not.to.equal(saved.id)
    expect(JSON.parse((await restarted.query({ operation: 'get', text: saved.id })).content)).to.deep.equal(saved.data)
    expect(() => validateCerebrumSharedArchive({ filePath })).not.to.throw()
  })

  it('preserves concurrent writes from another node while streaming a large archive', async () => {
    const filePath = path.join(root, 'common.jsonl')
    const archive = createCerebrumSharedArchive(filePath)
    const other = createCerebrumSharedArchive(filePath)
    for (let index = 0; index < 150; index++) archive.append({ kind: 'knx', at: '2025-01-01', data: { text: 'x'.repeat(1000) } })
    const pending = archive.prune({ retentionDays: 30 })
    const same = other.prune({ retentionDays: 30 })
    expect(same).to.equal(pending)
    const added = other.append({ kind: 'conversation', channel: 'telegram:42', data: { text: 'arrived during cleanup' } })
    await pending
    expect((await archive.query()).items.map(item => item.id)).to.deep.equal([added.id])
    expect(() => validateCerebrumSharedArchive({ filePath })).not.to.throw()
  })

  it('backs off with a bounded timer while scanning retained archive data', async () => {
    const archive = createCerebrumSharedArchive(path.join(root, 'common.jsonl'))
    archive.appendMany(Array.from({ length: 80 }, (_, index) => ({
      kind: 'context',
      at: '2026-09-08T12:00:00Z',
      data: { index, text: 'x'.repeat(2048) }
    })))
    // An archive from a previous process without a valid checkpoint needs its
    // initial scan; archives whose timestamp bound is known skip that work.
    const reopened = createCerebrumSharedArchive(archive.filePath)
    const originalSetTimeout = global.setTimeout
    const delays = []
    try {
      global.setTimeout = (callback, delay, ...args) => {
        delays.push(delay)
        return originalSetTimeout(callback, 0, ...args)
      }
      expect(await reopened.prune({ retentionDays: 30, now: Date.parse('2026-09-09T12:00:00Z') })).to.deep.equal({ removed: 0, reclaimedBytes: 0 })
    } finally {
      global.setTimeout = originalSetTimeout
    }
    expect(delays.length).to.be.greaterThan(1)
    expect(new Set(delays)).to.deep.equal(new Set([10]))
    expect(() => validateCerebrumSharedArchive({ filePath: archive.filePath })).not.to.throw()
  })

  it('skips archive reads after a clean checkpoint and still applies shorter retention to backdated appends', async () => {
    const filePath = path.join(root, 'common.jsonl')
    let archive = createCerebrumSharedArchive(filePath)
    const recent = archive.append({ kind: 'knx', at: '2026-09-08T12:00:00Z', data: { value: 1 } })
    expect(archive.checkpointRetention()).to.equal(true)
    archive = createCerebrumSharedArchive(filePath)
    const older = archive.append({ kind: 'conversation', at: '2026-08-25T12:00:00Z', data: { text: 'backdated' } })
    expect(archive.checkpointRetention()).to.equal(true)
    archive = createCerebrumSharedArchive(filePath)
    const read = fs.readSync
    try {
      fs.readSync = () => { throw new Error('Retained archive should not be read') }
      expect(await archive.prune({ retentionDays: 30, now: Date.parse('2026-09-10T12:00:00Z') })).to.deep.equal({ removed: 0, reclaimedBytes: 0 })
    } finally { fs.readSync = read }
    expect((await archive.prune({ retentionDays: 10, now: Date.parse('2026-09-10T12:00:00Z') })).removed).to.equal(1)
    expect((await archive.query({ operation: 'get', text: older.id })).ok).to.equal(false)
    expect((await archive.query({ operation: 'get', text: recent.id })).ok).to.equal(true)
    expect((await archive.prune({ retentionDays: 10, now: Date.parse('2026-09-20T12:00:00Z') })).removed).to.equal(1)
  })

  it('invalidates the timestamp checkpoint on external edits and writes from another instance', async () => {
    const filePath = path.join(root, 'common.jsonl')
    const archive = createCerebrumSharedArchive(filePath)
    archive.append({ kind: 'knx', at: '2026-09-08T12:00:00Z', data: { value: 1 } })
    expect(archive.checkpointRetention()).to.equal(true)
    const original = fs.readFileSync(filePath, 'utf8')
    fs.writeFileSync(filePath, original.replace('2026-09-08', '2026-08-01'))
    fs.utimesSync(filePath, new Date(0), new Date(0))
    const reopened = createCerebrumSharedArchive(filePath)
    expect((await reopened.prune({ retentionDays: 30, now: Date.parse('2026-09-10T12:00:00Z') })).removed).to.equal(1)
    const recent = reopened.append({ kind: 'knx', at: '2026-09-08T12:00:00Z', data: { value: 2 } })
    expect(reopened.checkpointRetention()).to.equal(true)
    const other = createCerebrumSharedArchive(filePath)
    other.append({ kind: 'knx', at: '2025-01-01T00:00:00Z', data: { value: 3 } })
    expect((await reopened.prune({ retentionDays: 30, now: Date.parse('2026-09-10T12:00:00Z') })).removed).to.equal(1)
    expect((await reopened.query()).items.map(item => item.id)).to.deep.equal([recent.id])
  })

  it('checks a concurrently appended tail before caching a previously unknown archive', async () => {
    const filePath = path.join(root, 'common.jsonl')
    const writer = createCerebrumSharedArchive(filePath)
    writer.appendMany(Array.from({ length: 80 }, (_, index) => ({ kind: 'context', at: '2026-09-08T12:00:00Z', data: { index, text: 'x'.repeat(2048) } })))
    const archive = createCerebrumSharedArchive(filePath)
    const pending = archive.prune({ retentionDays: 30, now: Date.parse('2026-09-10T12:00:00Z') })
    writer.append({ kind: 'knx', at: '2025-01-01T00:00:00Z', data: { value: 3 } })
    expect((await pending).removed).to.equal(1)
    expect((await archive.query()).totalMatches).to.equal(80)
    const reopened = createCerebrumSharedArchive(filePath)
    const read = fs.readSync
    try {
      fs.readSync = () => { throw new Error('Completed scan should have a reusable checkpoint') }
      await reopened.prune({ retentionDays: 30, now: Date.parse('2026-09-10T12:00:00Z') })
    } finally { fs.readSync = read }
    expect(() => validateCerebrumSharedArchive({ filePath })).not.to.throw()
  })

  it('treats the retention checkpoint as optional and validates nonstandard serialized records normally', async () => {
    const archive = createCerebrumSharedArchive(path.join(root, 'common.jsonl'))
    const saved = archive.append({ kind: 'knx', at: '2026-09-08T12:00:00Z', data: { value: 1 } })
    const rename = fs.renameSync
    try {
      fs.renameSync = () => { throw new Error('Cache is unwritable') }
      expect(archive.checkpointRetention()).to.equal(false)
      expect(await archive.prune({ retentionDays: 30, now: Date.parse('2026-09-10T12:00:00Z') })).to.deep.equal({ removed: 0, reclaimedBytes: 0 })
    } finally { fs.renameSync = rename }
    expect(fs.readdirSync(root)).to.deep.equal(['common.jsonl'])
    expect((await archive.query({ operation: 'get', text: saved.id })).ok).to.equal(true)
    archive.append({ kind: 'knx', at: new Date('2025-01-01'), data: { value: 2 } })
    expect((await archive.prune({ retentionDays: 30, now: Date.parse('2026-09-10T12:00:00Z') })).removed).to.equal(1)
    archive.append({ kind: 'knx', data: { toJSON: () => undefined } })
    await rejects(archive.prune({ retentionDays: 30, now: Date.parse('2026-09-10T12:00:00Z') }), /Invalid shared memory/)
  })

  it('includes retained backdated tail records in a cached timestamp bound without compaction', async () => {
    const filePath = path.join(root, 'common.jsonl')
    const writer = createCerebrumSharedArchive(filePath)
    writer.appendMany(Array.from({ length: 80 }, () => ({ kind: 'knx', at: '2026-09-08T12:00:00Z', data: { text: 'x'.repeat(2048) } })))
    const archive = createCerebrumSharedArchive(filePath)
    const pending = archive.prune({ retentionDays: 30, now: Date.parse('2026-09-10T12:00:00Z') })
    const tail = writer.append({ kind: 'knx', at: '2026-08-25T12:00:00Z', data: { value: 3 } })
    expect((await pending).removed).to.equal(0)
    const reopened = createCerebrumSharedArchive(filePath)
    expect((await reopened.prune({ retentionDays: 10, now: Date.parse('2026-09-10T12:00:00Z') })).removed).to.equal(1)
    expect((await reopened.query({ operation: 'get', text: tail.id })).ok).to.equal(false)
    expect((await reopened.query()).totalMatches).to.equal(80)
  })

  it('cancels compaction cooperatively without replacing the original or leaving a temporary file', async () => {
    const archive = createCerebrumSharedArchive(path.join(root, 'common.jsonl'))
    archive.appendMany(Array.from({ length: 80 }, (_, index) => ({
      kind: 'context',
      at: '2025-01-01T00:00:00Z',
      data: { index, text: 'x'.repeat(2048) }
    })))
    const original = fs.readFileSync(archive.filePath)
    const originalSetTimeout = global.setTimeout
    let cancelled = false
    try {
      global.setTimeout = (callback, delay, ...args) => {
        cancelled = true
        return originalSetTimeout(callback, 0, ...args)
      }
      expect(await archive.prune({
        retentionDays: 30,
        now: Date.parse('2026-09-09T12:00:00Z'),
        isCancelled: () => cancelled
      })).to.deep.equal({ removed: 0, reclaimedBytes: 0, cancelled: true })
    } finally {
      global.setTimeout = originalSetTimeout
    }
    expect(fs.readFileSync(archive.filePath)).to.deep.equal(original)
    expect(fs.readdirSync(root)).to.deep.equal(['common.jsonl'])
    expect(() => validateCerebrumSharedArchive({ filePath: archive.filePath })).not.to.throw()
  })

  it('keeps the original intact on corruption or failed replacement and cleans up temporary files', async () => {
    const archive = createCerebrumSharedArchive(path.join(root, 'common.jsonl'))
    archive.append({ kind: 'knx', at: '2025-01-01', data: { text: 'old' } })
    const original = fs.readFileSync(archive.filePath, 'utf8')
    fs.appendFileSync(archive.filePath, '{broken}\n')
    await rejects(archive.prune({ retentionDays: 30 }))
    expect(fs.readFileSync(archive.filePath, 'utf8')).to.equal(original + '{broken}\n')
    fs.writeFileSync(archive.filePath, original)
    const rename = fs.renameSync
    try {
      fs.renameSync = () => { throw new Error('simulated rename failure') }
      await rejects(archive.prune({ retentionDays: 30 }), /rename failure/)
    } finally { fs.renameSync = rename }
    expect(fs.readFileSync(archive.filePath, 'utf8')).to.equal(original)
    expect(fs.readdirSync(root)).to.deep.equal(['common.jsonl'])
    await archive.prune({ retentionDays: 30 })
    expect(archive.snapshotBytes()).to.equal(0)
    const fresh = archive.append({ kind: 'conversation', data: { text: 'fresh' } })
    expect((await archive.query()).items[0].id).to.equal(fresh.id)
  })

  it('does not overwrite an archive restored during asynchronous cleanup', async () => {
    const filePath = path.join(root, 'common.jsonl')
    const archive = createCerebrumSharedArchive(filePath)
    for (let index = 0; index < 100; index++) archive.append({ kind: 'knx', at: '2025-01-01', data: { text: 'x'.repeat(1000) } })
    const pending = archive.prune({ retentionDays: 30 })
    const replacement = createCerebrumSharedArchive(path.join(root, 'restore.jsonl'))
    const restored = replacement.append({ kind: 'conversation', data: { text: 'restored' } })
    fs.renameSync(replacement.filePath, filePath)
    await rejects(pending, /replaced during retention/)
    expect((await archive.query()).items[0].id).to.equal(restored.id)
    expect(fs.readdirSync(root)).to.deep.equal(['common.jsonl'])
  })
})
