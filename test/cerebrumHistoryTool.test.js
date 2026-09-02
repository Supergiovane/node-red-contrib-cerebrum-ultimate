/* global describe, it */
const { expect } = require('chai')
const {
  CEREBRUM_HISTORY_MAX_EVENTS_PER_ACTION,
  buildCerebrumHistoryResultsContext,
  executeCerebrumHistoryAction,
  matchesCerebrumKnxHistoryAction,
  normalizeCerebrumHistoryActions,
  resolveCerebrumHistoryRange
} = require('../nodes/utils/cerebrumHistoryTool')
const { parseCerebrumConversationResponse } = require('../nodes/cerebrumUltimate').__test

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
