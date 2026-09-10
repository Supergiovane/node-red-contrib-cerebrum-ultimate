/* global describe, it */
const { expect } = require('chai')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { createCerebrumHistoryAccumulator, readCerebrumCompactHistoryLines } = require('../nodes/utils/cerebrumEventHistory')
const {
  CEREBRUM_HISTORY_MAX_EVENTS_PER_ACTION,
  buildCerebrumHistoryResultsContext,
  executeCerebrumHistoryAction,
  matchesCerebrumKnxHistoryAction,
  normalizeCerebrumHistoryActions,
  resolveCerebrumHistoryRange
} = require('../nodes/utils/cerebrumHistoryTool')
const { parseCerebrumConversationResponse } = require('../nodes/cerebrumUltimate').__test

describe('Cerebrum bounded history file reads', () => {
  it('keeps exact totals and ranks late frequent values among many distinct combinations', () => {
    const accumulator = createCerebrumHistoryAccumulator({ kind: 'knx', limit: 3 })
    const event = { ts: Date.now(), event: 'GroupValue_Response', source: '1.1.1', destination: '1/2/3' }
    for (let payload = 0; payload < 10000; payload++) accumulator.add({ ...event, payload })
    for (let repeat = 0; repeat < 5; repeat++) accumulator.add({ ...event, payload: 9999 })
    const result = accumulator.finish()
    expect(result.summary.totalEvents).to.equal(10005)
    expect(result.summary.byCombination).to.have.length(40)
    expect(result.summary.byCombination[0]).to.deep.equal({ key: '1/2/3 | GroupValue_Response | 9999', count: 6 })
    expect(result.summary.byCombination[1]).to.deep.equal({ key: '1/2/3 | GroupValue_Response | 0', count: 1 })
    expect(result.events.map(item => item.payload)).to.deep.equal([9999, 9999, 9999])
  })

  it('preserves UTF-8 split across chunks, CRLF, a final partial line and a stable file boundary', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cerebrum-history-lines-'))
    const file = path.join(dir, 'events.knxctx')
    const expected = ['x'.repeat(65535) + '🏠 temperatura è 21', 'second', 'final without newline']
    try {
      fs.writeFileSync(file, expected.join('\r\n'))
      const reader = readCerebrumCompactHistoryLines(file)
      expect(reader.next().value).to.equal(expected[0])
      fs.appendFileSync(file, '\nlater event')
      expect([...reader]).to.deep.equal(expected.slice(1))
    } finally { fs.rmSync(dir, { recursive: true, force: true }) }
  })

  it('bounds oversized records and closes the file on errors and early query termination', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cerebrum-history-lines-'))
    const file = path.join(dir, 'events.knxctx')
    const open = fs.openSync
    let fd
    try {
      fs.writeFileSync(file, 'one\n' + 'x'.repeat(1024 * 1024 + 1))
      fs.openSync = (...args) => { fd = open(...args); return fd }
      const reader = readCerebrumCompactHistoryLines(file)
      expect(reader.next().value).to.equal('one')
      reader.return()
      expect(() => fs.fstatSync(fd)).to.throw(/bad file descriptor/i)
      expect(() => [...readCerebrumCompactHistoryLines(file)]).to.throw(/oversized record/)
      expect(() => fs.fstatSync(fd)).to.throw(/bad file descriptor/i)
    } finally {
      fs.openSync = open
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('Cerebrum KNX history tool', function () {
  it('normalizes bounded read-only archive queries', function () {
    const normalized = normalizeCerebrumHistoryActions([{
      operation: 'query',
      from: '2026-09-01T08:00:00+02:00',
      to: '2026-09-01T09:00:00+02:00',
      destinations: ['1/2/3', '1/2/3'],
      sources: ['1.1.10'],
      events: ['GroupValue_Write'],
      dpts: ['1.001'],
      query: 'living room light',
      includeRaw: true,
      limit: 999,
      reason: 'inspect the requested interval'
    }])
    expect(normalized.rejected).to.deep.equal([])
    expect(normalized.accepted[0]).to.include({
      operation: 'query',
      from: '2026-09-01T08:00:00+02:00',
      to: '2026-09-01T09:00:00+02:00',
      query: 'living room light',
      includeRaw: true,
      limit: CEREBRUM_HISTORY_MAX_EVENTS_PER_ACTION
    })
    expect(normalized.accepted[0].destinations).to.deep.equal(['1/2/3'])
  })

  it('resolves the default interval and clamps it to retention', function () {
    const nowTs = Date.parse('2026-09-02T12:00:00Z')
    const defaultRange = resolveCerebrumHistoryRange({ action: {}, nowTs, retentionDays: 10 })
    expect(defaultRange.to).to.equal('2026-09-02T12:00:00.000Z')
    expect(defaultRange.from).to.equal('2026-09-02T11:40:00.000Z')

    const clamped = resolveCerebrumHistoryRange({
      action: { from: '2026-08-01T00:00:00Z', to: '2026-09-01T00:00:00Z' },
      nowTs,
      retentionDays: 10
    })
    expect(clamped.from).to.equal('2026-08-23T12:00:00.000Z')
    expect(clamped.clamped).to.equal(true)
    expect(() => resolveCerebrumHistoryRange({
      action: { from: 'not-a-date' },
      nowTs,
      retentionDays: 10
    })).to.throw(/ISO 8601/i)
    expect(() => resolveCerebrumHistoryRange({
      action: { from: '2026-09-02T10:00:00' },
      nowTs,
      retentionDays: 10
    })).to.throw(/timezone/i)
  })

  it('matches exact KNX fields and semantic text together', function () {
    const event = {
      event: 'GroupValue_Write',
      source: '1.1.10',
      destination: '1/2/3',
      dpt: '1.001',
      devicename: 'Living Room Main Light',
      payload: true
    }
    expect(matchesCerebrumKnxHistoryAction(event, {
      destinations: ['1/2/3'],
      sources: [],
      events: ['groupvalue_write'],
      dpts: ['1.001'],
      query: 'living room light'
    })).to.equal(true)
    expect(matchesCerebrumKnxHistoryAction(event, {
      destinations: ['9/9/9'],
      sources: [],
      events: [],
      dpts: [],
      query: ''
    })).to.equal(false)
  })

  it('queries decoded records and returns a bounded model-ready result', function () {
    const nowTs = Date.parse('2026-09-02T12:00:00Z')
    const candidates = [
      {
        ts: Date.parse('2026-09-02T11:50:00Z'),
        event: 'GroupValue_Write',
        source: '1.1.10',
        destination: '1/2/3',
        dpt: '1.001',
        devicename: 'Living Room Light',
        payload: true,
        rawHex: '01'
      },
      {
        ts: Date.parse('2026-09-02T11:51:00Z'),
        event: 'GroupValue_Write',
        source: '1.1.11',
        destination: '2/2/2',
        dpt: '1.001',
        devicename: 'Kitchen Light',
        payload: false,
        rawHex: '00'
      }
    ]
    const result = executeCerebrumHistoryAction({
      action: {
        operation: 'query',
        from: '2026-09-02T11:40:00Z',
        to: '2026-09-02T12:00:00Z',
        destinations: ['1/2/3'],
        events: ['GroupValue_Write'],
        limit: 20,
        includeRaw: false,
        reason: 'inspect light writes'
      },
      nowTs,
      retentionDays: 10,
      queryArchive: ({ filter, limit }) => {
        const events = candidates.filter(filter).slice(-limit)
        return { events, summary: { totalEvents: events.length, byEvent: [{ key: 'GroupValue_Write', count: events.length }] } }
      }
    })
    expect(result).to.include({ ok: true, totalMatches: 1, returnedEvents: 1 })
    expect(result.events[0]).to.include({ destination: '1/2/3', payload: true })
    expect(result.events[0]).not.to.have.property('rawHex')
    expect(buildCerebrumHistoryResultsContext([result])).to.include('LOCAL KNX HISTORY TOOL RESULTS')
  })

  it('parses history actions from structured model output', function () {
    const envelope = parseCerebrumConversationResponse(JSON.stringify({
      reply: '',
      history_actions: [{ operation: 'query', from: '', to: '', destinations: [], sources: [], events: [], dpts: [], query: '', includeRaw: false, limit: 80, reason: 'inspect' }]
    }))
    expect(envelope.historyActions).to.have.length(1)
    expect(envelope.historyActions[0]).to.include({ operation: 'query', limit: 80 })
  })
})
