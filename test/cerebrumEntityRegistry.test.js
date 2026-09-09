const { expect } = require('chai')

/* global describe, it */

const {
  buildCerebrumEntityRegistryContext,
  normalizeCerebrumEntityRegistry,
  resolveCerebrumSemanticEntity,
  synchronizeCerebrumSemanticEntities,
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

  it('keeps catalog synchronization idempotent without refreshing timestamps', () => {
    const firstSeenAt = '2026-09-09T08:00:00.000Z'
    const synchronizedAt = '2026-09-09T09:00:00.000Z'
    const initial = upsertCerebrumSemanticEntity([], {
      adapterId: 'knx',
      objectId: '1/2/3',
      label: 'Presenza ingresso',
      area: 'ingresso',
      kind: 'presence',
      capability: 'dpt:1.001',
      access: 'observe',
      confidence: 0.8,
      at: firstSeenAt
    }).entities

    const result = synchronizeCerebrumSemanticEntities(initial, [{
      adapterId: 'knx',
      objectId: '1/2/3',
      label: 'Presenza ingresso',
      area: 'ingresso',
      kind: 'presence',
      capability: 'dpt:1.001',
      access: 'observe',
      confidence: 0.8
    }], { at: synchronizedAt })

    expect(result.changed).to.equal(false)
    expect(result.changedEntities).to.deep.equal([])
    expect(result.unchanged).to.equal(1)
    expect(result.entities).to.deep.equal(initial)
    expect(result.entities[0].updatedAt).to.equal(firstSeenAt)
    expect(result.entities[0].bindings[0].lastSeenAt).to.equal(firstSeenAt)
  })

  it('updates only timestamps belonging to semantic catalog changes', () => {
    const firstSeenAt = '2026-09-09T08:00:00.000Z'
    const synchronizedAt = '2026-09-09T09:00:00.000Z'
    const initial = upsertCerebrumSemanticEntity([], {
      adapterId: 'knx',
      objectId: '1/2/3',
      label: 'Ingresso',
      area: 'hall',
      kind: 'presence',
      at: firstSeenAt
    }).entities

    const entityOnlyChange = synchronizeCerebrumSemanticEntities(initial, [{
      adapterId: 'knx',
      objectId: '1/2/3',
      label: 'Ingresso',
      area: 'vestibolo',
      kind: 'presence'
    }], { at: synchronizedAt })

    expect(entityOnlyChange.changed).to.equal(true)
    expect(entityOnlyChange.updated).to.equal(1)
    expect(entityOnlyChange.changedEntities).to.have.length(1)
    expect(entityOnlyChange.entities[0].updatedAt).to.equal(synchronizedAt)
    expect(entityOnlyChange.entities[0].bindings[0].lastSeenAt).to.equal(firstSeenAt)

    const bindingChangeAt = '2026-09-09T10:00:00.000Z'
    const bindingChange = synchronizeCerebrumSemanticEntities(entityOnlyChange.entities, [{
      adapterId: 'knx',
      objectId: '1/2/3',
      label: 'Sensore ingresso',
      area: 'vestibolo',
      kind: 'presence'
    }], { at: bindingChangeAt })

    expect(bindingChange.entities[0].updatedAt).to.equal(bindingChangeAt)
    expect(bindingChange.entities[0].bindings[0].firstSeenAt).to.equal(firstSeenAt)
    expect(bindingChange.entities[0].bindings[0].lastSeenAt).to.equal(bindingChangeAt)
  })

  it('timestamps entities and bindings created by a catalog synchronization', () => {
    const synchronizedAt = '2026-09-09T09:00:00.000Z'
    const result = synchronizeCerebrumSemanticEntities([], [{
      adapterId: 'knx',
      objectId: '4/5/6',
      label: 'Temperatura cucina',
      kind: 'temperature'
    }], { at: synchronizedAt })

    expect(result.created).to.equal(1)
    expect(result.changed).to.equal(true)
    expect(result.changedEntities).to.have.length(1)
    expect(result.entities[0].createdAt).to.equal(synchronizedAt)
    expect(result.entities[0].updatedAt).to.equal(synchronizedAt)
    expect(result.entities[0].bindings[0].firstSeenAt).to.equal(synchronizedAt)
    expect(result.entities[0].bindings[0].lastSeenAt).to.equal(synchronizedAt)
  })

  it('retains live upsert timestamp refresh semantics', () => {
    const firstSeenAt = '2026-09-09T08:00:00.000Z'
    const observedAgainAt = '2026-09-09T08:05:00.000Z'
    let entities = upsertCerebrumSemanticEntity([], {
      adapterId: 'knx',
      objectId: '1/2/3',
      label: 'Ingresso',
      at: firstSeenAt
    }).entities

    entities = upsertCerebrumSemanticEntity(entities, {
      adapterId: 'knx',
      objectId: '1/2/3',
      label: 'Ingresso',
      at: observedAgainAt
    }).entities

    expect(entities[0].updatedAt).to.equal(observedAgainAt)
    expect(entities[0].bindings[0].firstSeenAt).to.equal(firstSeenAt)
    expect(entities[0].bindings[0].lastSeenAt).to.equal(observedAgainAt)
  })

  it('bulk-syncs every binding in a full multi-integration registry without changing stable data', () => {
    const initialAt = '2026-09-09T08:00:00.000Z'
    const adapterFor = index => index < 400 ? 'knx' : (index < 800 ? 'home-assistant' : 'unifi-protect')
    const registry = normalizeCerebrumEntityRegistry(Array.from({ length: 1200 }, (_, index) => {
      const adapterId = adapterFor(index)
      return {
        id: `entity:${adapterId}:${index}`,
        label: `Device ${index}`,
        area: `area-${index % 20}`,
        kind: 'sensor',
        capabilities: ['state'],
        access: ['observe'],
        confidence: 0.75,
        bindings: [{
          source: adapterId,
          adapterId,
          objectId: String(index),
          label: `Device ${index}`,
          capabilities: ['state'],
          access: 'observe',
          confidence: 0.75,
          firstSeenAt: initialAt,
          lastSeenAt: initialAt
        }],
        createdAt: initialAt,
        updatedAt: initialAt
      }
    }))
    const catalog = Array.from({ length: 1200 }, (_, index) => ({
      adapterId: adapterFor(index),
      objectId: String(index),
      label: `Device ${index}`,
      area: `area-${index % 20}`,
      kind: 'sensor',
      capability: 'state',
      access: 'observe',
      confidence: 0.75
    }))

    const result = synchronizeCerebrumSemanticEntities(registry, catalog, { at: '2026-09-09T12:00:00.000Z' })

    expect(result.entities).to.have.length(1200)
    expect(result.changed).to.equal(false)
    expect(result.unchanged).to.equal(1200)
    expect(result.changedEntities).to.deep.equal([])
    expect(result.entities).to.deep.equal(registry)
  })
})
