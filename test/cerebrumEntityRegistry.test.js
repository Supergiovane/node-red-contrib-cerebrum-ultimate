const { expect } = require('chai')

/* global describe, it */

const {
  buildCerebrumEntityRegistryContext,
  resolveCerebrumSemanticEntity,
  upsertCerebrumSemanticEntity
} = require('../nodes/utils/cerebrumEntityRegistry')

describe('Cerebrum semantic entity registry', () => {
  it('keeps unrelated native IDs separate even when labels and areas match', () => {
    let entities = []
    entities = upsertCerebrumSemanticEntity(entities, { adapterId: 'knx', objectId: '1/2/3', label: 'Ingresso', area: 'hall', kind: 'presence' }).entities
    entities = upsertCerebrumSemanticEntity(entities, { adapterId: 'unifi-protect', providerId: 'controller-1', objectId: 'camera-7', label: 'Ingresso', area: 'hall', kind: 'camera' }).entities

    expect(entities).to.have.length(2)
    expect(entities.map(item => item.id)).to.include.members(['entity:knx:1/2/3', 'entity:unifi-protect:controller-1:camera-7'])
  })

  it('links integrations only through an explicit semantic identity', () => {
    let entities = upsertCerebrumSemanticEntity([], {
      semanticId: 'home:entry-camera',
      adapterId: 'unifi-protect',
      providerId: 'main',
      objectId: 'cam-1',
      label: 'Ingresso',
      kind: 'camera',
      capabilities: ['snapshot', 'events'],
      access: 'observe',
      at: '2026-09-09T08:00:00.000Z'
    }).entities
    entities = upsertCerebrumSemanticEntity(entities, {
      semanticId: 'home:entry-camera',
      adapterId: 'home-assistant',
      providerId: 'ha-main',
      objectId: 'camera.ingresso',
      label: 'Telecamera ingresso',
      capabilities: ['state'],
      access: 'read',
      at: '2026-09-09T08:01:00.000Z'
    }).entities

    expect(entities).to.have.length(1)
    expect(entities[0].identity).to.equal('explicit')
    expect(entities[0].bindings).to.have.length(2)
    expect(entities[0].capabilities).to.include.members(['snapshot', 'events', 'state'])
    expect(resolveCerebrumSemanticEntity(entities, { adapterId: 'home-assistant', providerId: 'ha-main', objectId: 'camera.ingresso' }).id).to.equal('home:entry-camera')
    expect(buildCerebrumEntityRegistryContext(entities)).to.include('unifi-protect/main:cam-1')
  })

  it('upgrades and merges a source-scoped binding when an explicit identity arrives', () => {
    let entities = upsertCerebrumSemanticEntity([], { adapterId: 'matter', objectId: 'node-2/light-1', label: 'Lampada' }).entities
    const updated = upsertCerebrumSemanticEntity(entities, { semanticId: 'home:kitchen-light', adapterId: 'matter', objectId: 'node-2/light-1', label: 'Lampada cucina' })
    entities = updated.entities

    expect(entities).to.have.length(1)
    expect(entities[0].id).to.equal('home:kitchen-light')
    expect(entities[0].bindings).to.have.length(1)
  })

  it('keeps source-scoped IDs unambiguous when native identifiers contain colons', () => {
    let entities = upsertCerebrumSemanticEntity([], { adapterId: 'alpha:beta', objectId: 'device:one' }).entities
    entities = upsertCerebrumSemanticEntity(entities, { adapterId: 'alpha', providerId: 'beta', objectId: 'device:one' }).entities

    expect(entities).to.have.length(2)
    expect(new Set(entities.map(entity => entity.id)).size).to.equal(2)
    expect(entities[0].id).to.equal('entity:alpha%3Abeta:device%3Aone')
  })

  it('selects registry context by the current question before recency', () => {
    let entities = upsertCerebrumSemanticEntity([], { adapterId: 'matter', objectId: 'old-kitchen-light', label: 'Lampada cucina', at: '2026-09-09T08:00:00.000Z' }).entities
    entities = upsertCerebrumSemanticEntity(entities, { adapterId: 'unifi-protect', objectId: 'new-camera', label: 'Ingresso', at: '2026-09-09T09:00:00.000Z' }).entities

    const context = buildCerebrumEntityRegistryContext(entities, { question: 'stato lampada cucina', maxEntities: 1 })
    expect(context).to.include('old-kitchen-light')
    expect(context).not.to.include('new-camera')
  })
})
