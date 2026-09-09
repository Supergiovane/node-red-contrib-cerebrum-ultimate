const { expect } = require('chai')

/* global describe, it */

const { buildCerebrumObservation } = require('../nodes/utils/cerebrumObservationBuilder')
const {
  consolidateCerebrumEpisodes,
  linkCerebrumLearnedMemory
} = require('../nodes/utils/cerebrumMemoryConsolidator')

describe('Cerebrum durable memory consolidation', () => {
  it('does not correlate unrelated observations merely because their area is unknown', () => {
    const observations = [
      buildCerebrumObservation({ source: 'knx', objectId: '1/1/1', value: 'on', at: '2026-09-09T08:00:00.000Z' }),
      buildCerebrumObservation({ source: 'unifi', objectId: 'camera-1', event: 'person', value: true, at: '2026-09-09T08:00:02.000Z' })
    ]

    expect(consolidateCerebrumEpisodes({ observations }).episodes).to.deep.equal([])
  })

  it('persists and extends a cross-integration episode using shared semantic identity', () => {
    const observations = [
      buildCerebrumObservation({ source: 'knx', objectId: '1/1/1', semanticId: 'home:entrance', value: 'open', at: '2026-09-09T08:00:00.000Z', evidenceId: 'm1' }),
      buildCerebrumObservation({ source: 'unifi', objectId: 'camera-1', semanticId: 'home:entrance', event: 'person', value: true, at: '2026-09-09T08:00:02.000Z', evidenceId: 'm2' })
    ]
    const first = consolidateCerebrumEpisodes({ observations, now: '2026-09-09T08:00:03.000Z' })
    observations.push(buildCerebrumObservation({ source: 'home-assistant', objectId: 'binary_sensor.entry', semanticId: 'home:entrance', value: 'on', at: '2026-09-09T08:00:04.000Z', evidenceId: 'm3' }))
    const second = consolidateCerebrumEpisodes({ episodes: first.episodes, observations, now: '2026-09-09T08:00:05.000Z' })

    expect(first.episodes).to.have.length(1)
    expect(second.episodes).to.have.length(1)
    expect(second.episodes[0].id).to.equal(first.episodes[0].id)
    expect(second.episodes[0].sources).to.have.members(['knx', 'unifi', 'home-assistant'])
    expect(second.changedEpisodes).to.have.length(1)
  })

  it('links compatible habit and behavior-pattern views without merging their evidence', () => {
    const result = linkCerebrumLearnedMemory({
      habits: [{ id: 'habit-1', semanticId: 'home:kitchen-light', dayType: 'weekday', averageMinuteOfDay: 450, evidenceIds: ['habit-evidence'] }],
      patterns: [{ id: 'pattern-1', semanticId: 'home:kitchen-light', dayType: 'weekday', hour: 7, evidenceIds: ['pattern-evidence'] }]
    })

    expect(result.habits[0].relatedPatternIds).to.deep.equal(['pattern-1'])
    expect(result.patterns[0].relatedHabitIds).to.deep.equal(['habit-1'])
    expect(result.habits[0].evidenceIds).to.deep.equal(['habit-evidence'])
  })
})
