const { expect } = require('chai')

/* global describe, it */

const {
  buildCerebrumObservation,
  correlateCerebrumObservations
} = require('../nodes/utils/cerebrumObservationBuilder')

describe('Cerebrum deterministic observation builder', () => {
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
