/* global describe, it */
'use strict'

const { expect } = require('chai')
const {
  CEREBRUM_OPERATIONS_RETENTION_DAYS,
  buildCerebrumOperationsSnapshot,
  normalizeCerebrumOperation,
  parseCerebrumOperationRecord,
  serializeCerebrumOperationRecord
} = require('../nodes/utils/cerebrumOperations')

describe('Cerebrum operations audit', function () {
  it('normalizes and redacts sensitive operation details', function () {
    const entry = normalizeCerebrumOperation({
      ts: Date.parse('2026-09-02T10:00:00Z'),
      category: 'tool',
      source: 'codeActions',
      operation: 'run',
      status: 'succeeded',
      title: 'Local JavaScript execution',
      details: {
        reason: 'inspect node state',
        apiKey: 'secret-value',
        nested: { authorization: 'Bearer private', answer: 42 },
        image: 'ignored'
      }
    })
    expect(entry.category).to.equal('tool')
    expect(entry.details.apiKey).to.equal('[redacted]')
    expect(entry.details.nested.authorization).to.equal('[redacted]')
    expect(entry.details.nested.answer).to.equal(42)
    expect(entry.details).not.to.have.property('image')
  })

  it('round-trips one JSONL operation record', function () {
    const line = serializeCerebrumOperationRecord({
      ts: Date.parse('2026-09-02T10:00:00Z'),
      category: 'autonomous',
      source: 'habit-learner',
      operation: 'habit_observed',
      title: 'Observed a temporal habit'
    })
    const parsed = parseCerebrumOperationRecord(line)
    expect(parsed).to.include({
      category: 'autonomous',
      source: 'habit-learner',
      operation: 'habit_observed'
    })
    expect(parsed.id).to.be.a('string').and.not.equal('')
  })

  it('merges node operations and KNX telegrams newest first', function () {
    const snapshot = buildCerebrumOperationsSnapshot({
      fromTs: Date.parse('2026-08-30T12:00:00Z'),
      toTs: Date.parse('2026-09-02T12:00:00Z'),
      operations: [{
        ts: Date.parse('2026-09-02T10:00:00Z'),
        category: 'llm',
        operation: 'conversation',
        title: 'LLM answer'
      }],
      telegrams: [{
        ts: Date.parse('2026-09-02T11:00:00Z'),
        event: 'GroupValue_Write',
        source: '1.1.1',
        destination: '1/2/3',
        payload: true
      }],
      knxTotal: 3,
      limit: 2
    })
    expect(snapshot.retentionDays).to.equal(CEREBRUM_OPERATIONS_RETENTION_DAYS)
    expect(snapshot.counts).to.include({ total: 4, knx: 3, llm: 1 })
    expect(snapshot.items.map(item => item.category)).to.deep.equal(['knx', 'llm'])
    expect(snapshot.truncated).to.equal(true)
  })
})
