'use strict'
/* eslint-env mocha */

const { expect } = require('chai')
const {
  validateCerebrumAutonomyStore,
  validateCerebrumObservationJournal,
  observationJournalPath,
  CEREBRUM_AUTONOMY_LIMITS: LIMITS
} = require('../nodes/utils/cerebrumAutonomy')

const store = (overrides = {}) => Object.assign({
  version: 1,
  sequence: 3,
  entities: [{ id: 'entity-1' }],
  situations: [],
  evidence: [],
  episodes: [],
  habits: [],
  expectations: [],
  actionHistory: [],
  reasonHistory: []
}, overrides)

const record = (sequence, state = {}) => JSON.stringify({
  sequence,
  state: Object.assign({ source: 'knx', objectId: '1/1/1', observedAt: '2026-09-01T07:00:00.000Z', value: true }, state)
})

describe('Legacy Cerebrum autonomy archives', () => {
  it('names the observation journal beside its checkpoint', () => {
    expect(observationJournalPath('/data/world.json')).to.equal('/data/world.json.observations.jsonl')
  })

  it('accepts a legacy checkpoint, including retired goal and pattern collections', () => {
    const legacy = store({ goals: [{ id: 'goal-1', entityIds: ['entity-1'], reviews: [] }], patterns: [{ id: 'pattern-1' }] })
    expect(validateCerebrumAutonomyStore(legacy)).to.equal(legacy)
  })

  it('refuses checkpoints with missing collections, unnamed records or oversized retired collections', () => {
    expect(() => validateCerebrumAutonomyStore(store({ version: 2 }))).to.throw('Invalid autonomy store')
    expect(() => validateCerebrumAutonomyStore(store({ habits: undefined }))).to.throw('Invalid autonomy store')
    expect(() => validateCerebrumAutonomyStore(store({ entities: [{}] }))).to.throw('Invalid autonomy entities')
    expect(() => validateCerebrumAutonomyStore(store({ patterns: Array.from({ length: 241 }, (_, index) => ({ id: `p${index}` })) })))
      .to.throw('Autonomy patterns exceeds its storage limit')
    expect(() => validateCerebrumAutonomyStore(store({ goals: [{ id: 'goal-1', entityIds: 'entity-1', reviews: [] }] })))
      .to.throw('Invalid comfort goal structure')
  })

  it('normalizes ordered journal records without changing their meaning', () => {
    const records = validateCerebrumObservationJournal(`${record(1)}\n\n${record(4, { value: { on: true } })}\n`)
    expect(records.map(item => item.sequence)).to.deep.equal([1, 4])
    expect(records[0].state).to.include({ source: 'knx', objectId: '1/1/1', label: '1/1/1', value: 'true', refreshIntervalSeconds: 60 })
    expect(records[1].state.value).to.equal('{"on":true}')
  })

  it('refuses malformed, unordered, incomplete and oversized journals', () => {
    expect(() => validateCerebrumObservationJournal('{broken}\n')).to.throw()
    expect(() => validateCerebrumObservationJournal(JSON.stringify({ sequence: 1, state: null }))).to.throw('Invalid autonomy observation journal record')
    expect(() => validateCerebrumObservationJournal(`${record(2)}\n${record(2)}\n`)).to.throw('Invalid autonomy observation journal record')
    expect(() => validateCerebrumObservationJournal(record(1, { objectId: '' }))).to.throw('Invalid autonomy observation journal record')
    expect(() => validateCerebrumObservationJournal(record(1, { observedAt: 'never' }))).to.throw('Invalid autonomy observation journal record')
    const tooMany = Array.from({ length: LIMITS.evidence + 1 }, (_, index) => record(index + 1)).join('\n')
    expect(() => validateCerebrumObservationJournal(tooMany)).to.throw('Autonomy observation journal exceeds its record limit')
    expect(() => validateCerebrumObservationJournal(null)).to.throw('Invalid or oversized autonomy observation journal')
  })
})
