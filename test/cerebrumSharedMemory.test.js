'use strict'
/* eslint-env mocha */
const { expect } = require('chai')
const fs = require('fs')
const os = require('os')
const path = require('path')
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
    expect(() => validateCerebrumSharedArchive({ content: content.replace(record.id, 'm99') })).to.throw('record')
    expect(() => validateCerebrumSharedArchive({ content: content.slice(0, -1) })).to.throw('Incomplete')
    expect((await archive.query({ operation: 'get', text: 'm9999999999999999999999' })).ok).to.equal(false)
  })
})
