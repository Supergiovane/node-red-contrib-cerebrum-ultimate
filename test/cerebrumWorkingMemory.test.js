/* global describe, it */
'use strict'

const { expect } = require('chai')
const {
  CEREBRUM_MEMORY_QUERY_MAX_BYTES,
  CEREBRUM_MEMORY_QUERY_MAX_ITEMS,
  buildCerebrumWorkingMemory,
  queryCerebrumWorldMemory
} = require('../nodes/utils/cerebrumWorkingMemory')

const readRecords = (text, section) => text.split('\n').filter(line => line.startsWith(`${section} `)).map(line => JSON.parse(line.slice(section.length + 1)))
const makeWorld = () => ({
  entities: [
    { id: 'knx:1/2/3', source: 'knx', objectId: '1/2/3', label: 'Luce giardino', area: 'Giardino', kind: 'light', value: true, observedAt: '2026-09-06T18:00:00Z', verifiedAt: '2026-09-06T18:05:00Z', changedAt: '2026-09-06T17:00:00Z', fresh: true, evidenceId: 'ev-light' },
    { id: 'ha:binary_sensor.garden_presence', source: 'ha', objectId: 'binary_sensor.garden_presence', label: 'Presenza giardino', area: 'Giardino', kind: 'occupancy', value: 'unavailable', fresh: false, observedAt: '2026-09-05T18:00:00Z', evidenceId: 'ev-presence' },
    { id: 'ha:light.kitchen', source: 'ha', objectId: 'light.kitchen', label: 'Luce cucina', area: 'Cucina', kind: 'light', value: false, observedAt: '2026-09-06T19:00:00Z', fresh: true, evidenceId: 'ev-kitchen' }
  ],
  situations: [{ id: 'sit-garden', kind: 'persistent_state', summary: 'Luce giardino rimasta accesa', status: 'open', entityIds: ['knx:1/2/3'], evidenceIds: ['ev-light'], dueAt: '2026-09-06T18:10:00Z' }],
  evidence: [{ id: 'ev-light', entityId: 'knx:1/2/3', at: '2026-09-06T18:00:00Z' }],
  episodes: [{ id: 'ep-garden', situationId: 'sit-garden', at: '2026-09-05T18:00:00Z', summary: 'Luce giardino verificata ieri', outcome: 'observed', evidenceIds: ['ev-light'] }],
  expectations: [{ id: 'exp-garden', entityId: 'knx:1/2/3', expectedValue: false, dueAt: '2026-09-06T18:30:00Z', status: 'open' }],
  habits: [{ id: 'habit-garden', source: 'knx', objectId: '1/2/3', label: 'Giardino spento dopo cena', confidence: 0.8, samples: 16, status: 'confirmed' }]
})

describe('Cerebrum bounded working memory', function () {
  it('retains exact evidence, freshness and expectations while prioritizing the current question', function () {
    const world = makeWorld()
    const memory = buildCerebrumWorkingMemory({ world, question: 'Perché la luce del giardino è rimasta accesa?' })
    const entities = readRecords(memory.text, 'ENTITY')
    expect(entities[0]).to.deep.equal(world.entities[0])
    expect(entities.find(item => item.id === 'ha:binary_sensor.garden_presence')).to.include({ value: 'unavailable', fresh: false, observedAt: '2026-09-05T18:00:00Z' })
    expect(readRecords(memory.text, 'EXPECTATION')[0]).to.deep.equal(world.expectations[0])
    expect(readRecords(memory.text, 'AREA')).to.have.length(2)
    expect(memory.stats.packedBytes).to.equal(Buffer.byteLength(memory.text, 'utf8'))
    expect(memory.stats.omitted.entities).to.equal(0)
  })

  it('brings a situation and related room sensors into autonomous attention without a question', function () {
    const world = makeWorld()
    world.situations[0].summary = 'Persistent state'
    world.entities = world.entities.concat(Array.from({ length: 200 }, (_, index) => ({ id: `ha:other_${index}`, label: 'Other light', area: 'Other room', value: true, observedAt: '2026-09-06T20:00:00Z', fresh: true })))
    const memory = buildCerebrumWorkingMemory({ world, situation: world.situations[0], byteBudget: 2400 })
    expect(readRecords(memory.text, 'SITUATION')[0].id).to.equal('sit-garden')
    expect(readRecords(memory.text, 'ENTITY').slice(0, 2).map(item => item.id)).to.deep.equal(['knx:1/2/3', 'ha:binary_sensor.garden_presence'])
    expect(readRecords(memory.text, 'EPISODE')[0].id).to.equal('ep-garden')
    expect(memory.stats.omitted.entities).to.be.greaterThan(190)
  })

  it('honors the true UTF-8 byte boundary and emits complete JSON records at every budget', function () {
    const world = makeWorld()
    world.entities.push(...Array.from({ length: 500 }, (_, index) => ({ id: `ha:unicode_${index}`, label: `照明🌍 Ètage ${index}`, area: `Pièce 🏡 ${index % 12}`, value: '開啟', observedAt: '2026-09-06T18:00:00Z', fresh: false })))
    for (const budget of [0, 1, 120, 300, 501, 700, 1024, 2047, 4096, 12000]) {
      const memory = buildCerebrumWorkingMemory({ world, question: '照明', byteBudget: budget })
      expect(Buffer.byteLength(memory.text, 'utf8')).to.be.at.most(budget)
      expect(memory.stats.packedBytes).to.be.at.most(budget)
      expect(memory.text).not.to.include('\ufffd')
      for (const line of memory.text.split('\n').slice(1).filter(Boolean)) expect(() => JSON.parse(line.slice(line.indexOf(' ') + 1))).not.to.throw()
      for (const section of Object.keys(memory.stats.included)) {
        expect(memory.stats.included[section] + memory.stats.omitted[section]).to.be.at.least(memory.stats.included[section])
      }
      if (memory.text) expect(readRecords(memory.text, 'OMITTED')[0]).to.deep.equal(memory.stats.omitted)
    }
  })

  it('uses available context for more than 24 entities and preserves small-window prioritization', function () {
    const world = makeWorld()
    world.entities.push(...Array.from({ length: 100 }, (_, index) => ({ id: `ha:other_${index}`, area: 'Other', value: true })))
    const large = buildCerebrumWorkingMemory({ world, byteBudget: 128000 })
    const small = buildCerebrumWorkingMemory({ world, question: 'giardino', byteBudget: 1800 })
    expect(large.stats.included.entities).to.equal(103)
    expect(small.stats.packedBytes).to.be.at.most(1800)
    expect(readRecords(small.text, 'ENTITY')[0].id).to.equal('knx:1/2/3')
  })

  it('omits oversized fields explicitly instead of turning partial text into a fact', function () {
    const world = makeWorld()
    world.entities[0].label = '🌍'.repeat(10000)
    world.entities[0].value = { huge: 'x'.repeat(2000000) }
    world.rawMemory = 'Must never be read or serialized'.repeat(100000)
    const record = readRecords(buildCerebrumWorkingMemory({ world }).text, 'ENTITY').find(item => item.id === 'knx:1/2/3')
    expect(record).not.to.have.property('label')
    expect(record).not.to.have.property('value')
    expect(record.omittedFields).to.deep.equal(['label', 'value'])
    expect(record.evidenceId).to.equal('ev-light')
  })

  it('keeps resolved situations out of active attention while retaining their episodes', function () {
    const world = makeWorld()
    world.situations[0].status = 'resolved'
    const memory = buildCerebrumWorkingMemory({ world })
    expect(readRecords(memory.text, 'SITUATION')).to.deep.equal([])
    expect(readRecords(memory.text, 'EPISODE')).to.have.length(1)
    expect(queryCerebrumWorldMemory({ world, operation: 'situations' }).items[0].status).to.equal('resolved')
  })
})

describe('Cerebrum read-only world retrieval', function () {
  it('looks up exact source-qualified identities without crossing integrations or prototypes', function () {
    const world = makeWorld()
    world.entities.push({ id: 'ha:1/2/3', source: 'ha', objectId: '1/2/3', value: false })
    expect(queryCerebrumWorldMemory({ world, operation: 'get', entityIds: ['knx:1/2/3'] }).items.map(item => item.id)).to.deep.equal(['knx:1/2/3'])
    for (const entityId of ['1/2/3', 'KNX:1/2/3', '__proto__', 'constructor']) {
      expect(queryCerebrumWorldMemory({ world, operation: 'get', entityIds: [entityId] }).items).to.deep.equal([])
    }
    expect(queryCerebrumWorldMemory({ world, operation: 'get' }).ok).to.equal(false)
    expect(queryCerebrumWorldMemory({ world, operation: '__proto__' }).ok).to.equal(false)
  })

  it('retrieves every native binding linked by one explicit semantic identity', function () {
    const world = makeWorld()
    world.entities[0].semanticId = 'home:garden-light'
    world.entities.push({ id: 'ha:light.garden', semanticId: 'home:garden-light', source: 'ha', objectId: 'light.garden', label: 'Luce giardino HA', value: true })

    expect(queryCerebrumWorldMemory({ world, operation: 'get', entityIds: ['home:garden-light'] }).items.map(item => item.id)).to.have.members([
      'knx:1/2/3',
      'ha:light.garden'
    ])
  })

  it('retrieves episodes through exact situation/evidence links and combines entity and text filters', function () {
    const world = makeWorld()
    world.episodes.push({ id: 'ep-unrelated', summary: 'Giardino', situationId: 'missing', evidenceIds: ['ev-kitchen'] })
    const episode = queryCerebrumWorldMemory({ world, operation: 'episodes', query: 'giardino', entityIds: ['knx:1/2/3'] })
    expect(episode.items.map(item => item.id)).to.deep.equal(['ep-garden'])
    expect(queryCerebrumWorldMemory({ world, operation: 'episodes', entityIds: ['ha:1/2/3'] }).items).to.deep.equal([])
    expect(queryCerebrumWorldMemory({ world, operation: 'search', query: 'cucina', entityIds: ['knx:1/2/3'] }).items).to.deep.equal([])
    expect(queryCerebrumWorldMemory({ world, operation: 'habits', entityIds: ['knx:1/2/3'] }).items[0].id).to.equal('habit-garden')
  })

  it('paginates all results without repetition within item and serialized byte limits', function () {
    const world = { entities: Array.from({ length: 47 }, (_, index) => ({ id: `ha:${String(index).padStart(3, '0')}`, label: '照明'.repeat(250), area: '屋外', value: '🌍'.repeat(200), observedAt: '2026-09-06T18:00:00Z' })) }
    let offset = 0
    const ids = []
    do {
      const result = queryCerebrumWorldMemory({ world, limit: 999999, offset })
      expect(Buffer.byteLength(JSON.stringify(result), 'utf8')).to.be.at.most(CEREBRUM_MEMORY_QUERY_MAX_BYTES)
      expect(result.returned).to.be.at.most(CEREBRUM_MEMORY_QUERY_MAX_ITEMS)
      expect(result.returned).to.be.greaterThan(0)
      expect(result.totalMatches).to.equal(47)
      expect(result.omitted + result.returned).to.equal(47)
      ids.push(...result.items.map(item => item.id))
      offset = result.nextOffset
    } while (offset !== null)
    expect(ids).to.have.length(47)
    expect(new Set(ids).size).to.equal(47)
  })

  it('does not modify the world when retrieving or exposing nested results', function () {
    const world = makeWorld()
    world.entities[0].value = { on: true, level: 25 }
    const before = JSON.stringify(world)
    buildCerebrumWorkingMemory({ world, situation: world.situations[0] })
    const result = queryCerebrumWorldMemory({ world, operation: 'get', entityIds: ['knx:1/2/3'] })
    result.items[0].value.level = 99
    expect(JSON.stringify(world)).to.equal(before)
  })

  it('returns a small area directory and validates malformed bounds', function () {
    const world = makeWorld()
    expect(queryCerebrumWorldMemory({ world, operation: 'areas', query: 'giardino' }).items).to.deep.equal([{ id: 'Giardino', entityCount: 2 }])
    expect(queryCerebrumWorldMemory({ world, limit: -5, offset: -2 }).returned).to.equal(1)
    expect(queryCerebrumWorldMemory({ world, offset: 999999 }).items).to.deep.equal([])
    expect(queryCerebrumWorldMemory({ world: null }).items).to.deep.equal([])
  })
})
