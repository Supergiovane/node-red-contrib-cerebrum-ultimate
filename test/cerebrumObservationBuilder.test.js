const { expect } = require('chai')

/* global describe, it */

const {
  buildCerebrumObservation,
  correlateCerebrumObservations
} = require('../nodes/utils/cerebrumObservationBuilder')

describe('Cerebrum deterministic observation builder', () => {
  it('keeps timestamp-window and entity correlation boundaries with interleaved, unsorted observations', () => {
    const observation = (id, area, seconds) => buildCerebrumObservation({
      source: 'knx',
      objectId: id,
      area,
      label: '\u0000Cucina\nè 🏠\u007f',
      value: seconds,
      evidenceId: `m${seconds}`,
      at: new Date(Date.parse('2026-09-10T06:00:00.000Z') + seconds * 1000).toISOString()
    })
    const observations = [observation('a', 'hall', 0), observation('b', 'kitchen', 1), observation('c', 'hall', 4), observation('d', 'hall', 6), observation('d', '', 11)]
    const shuffled = [observations[4], observations[1], observations[3], observations[0], observations[2]]
    const before = JSON.parse(JSON.stringify(shuffled))
    const episodes = correlateCerebrumObservations(shuffled, { windowMs: 5000 })
    expect(episodes.map(item => item.observationIds)).to.deep.equal([
      [observations[0].id, observations[2].id],
      [observations[3].id, observations[4].id]
    ])
    expect(shuffled).to.deep.equal(before)
    expect(observations[0].label).to.equal('Cucina è 🏠')
  })

  it('keeps facts, semantic identity and archive evidence distinct from hypotheses', () => {
    const observation = buildCerebrumObservation({
      source: 'unifi-protect',
      adapterId: 'unifi-protect',
      providerId: 'main',
      cameraId: 'camera-1',
      semanticId: 'home:entry-camera',
      cameraName: 'Ingresso',
      area: 'entrance',
      kind: 'camera',
      eventType: 'smartDetectZone',
      value: true,
      previousValue: false,
      evidenceId: 'm123',
      at: '2026-09-09T08:00:00.000Z',
      confidence: 1
    })

    expect(observation).to.include({ status: 'observed', hypothesis: false, semanticId: 'home:entry-camera' })
    expect(observation.entityIds).to.deep.equal(['unifi-protect:camera-1', 'home:entry-camera'])
    expect(observation.evidenceIds).to.deep.equal(['m123'])
    expect(observation.summary).to.include('false → true')
  })

  it('correlates nearby facts without deleting their original evidence', () => {
    const observations = [
      buildCerebrumObservation({ source: 'knx', objectId: '1/2/3', label: 'Porta', area: 'hall', value: 'open', at: '2026-09-09T08:00:00.000Z', evidenceId: 'm1' }),
      buildCerebrumObservation({ source: 'unifi-protect', objectId: 'camera-1', label: 'Camera', area: 'hall', event: 'person', value: true, at: '2026-09-09T08:00:03.000Z', evidenceId: 'm2' })
    ]
    const episodes = correlateCerebrumObservations(observations, { windowMs: 5000 })

    expect(episodes).to.have.length(1)
    expect(episodes[0].observationIds).to.deep.equal(observations.map(item => item.id))
    expect(episodes[0].evidenceIds).to.deep.equal(['m1', 'm2'])
  })
})
