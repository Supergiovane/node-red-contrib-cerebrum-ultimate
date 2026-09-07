'use strict'
/* eslint-env mocha */
const { expect } = require('chai')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { createCerebrumAutonomyRuntime, canAct } = require('../nodes/utils/cerebrumAutonomyRuntime')
const { fitCerebrumPrompt } = require('../nodes/utils/cerebrumContextBudget')
const { normalizeCerebrumCommandCandidates, coerceCerebrumCommandPayload } = require('../nodes/cerebrumUltimate').__test

describe('Cerebrum autonomous runtime integration', () => {
  let dir, node, runtime, time, states, requests, commands, services, reads, decide
  const iso = () => new Date(time).toISOString()
  const make = options => createCerebrumAutonomyRuntime({
    node,
    filePath: path.join(dir, 'world.json'),
    readSnapshot: () => ({ states, habits: [] }),
    now: () => time,
    callLLMChat: async request => {
      requests.push(request)
      const fitted = fitCerebrumPrompt({ ...request, schema: request.jsonSchema, contextTokens: 32768, maxTokens: request.maxTokensOverride })
      expect(fitted.inputBytes + fitted.overhead + fitted.maxTokens).to.be.at.most(32768)
      const situationData = request.essentialUserContent.split('\n').find(line => line.startsWith('{'))
      expect(situationData, 'the essential prompt must include the situation JSON').to.be.a('string')
      const situation = JSON.parse(situationData)
      expect(situation).to.include.all.keys('id', 'kind', 'entityIds', 'evidenceIds')
      const decision = decide(situation, request)
      return { content: JSON.stringify(decision) }
    },
    parseJson: JSON.parse,
    getCatalog: () => [{ ga: '1/2/3', dpt: '1.001', label: 'Kitchen light', readOnly: false }],
    normalizeCommands: normalizeCerebrumCommandCandidates,
    coercePayload: coerceCerebrumCommandPayload,
    sendCommands: sent => { commands.push(...sent); return true },
    readKnx: async id => { reads.push(id) },
    callHa: async request => { services.push(request) },
    getHa: async id => { reads.push(id) },
    notify: async () => true,
    recordOperation: () => {},
    contextTokens: () => 32768,
    ...options
  })
  const decision = (situation, extra = {}) => ({ disposition: 'observe', summary: 'Continue observing the kitchen.', nextCheckSeconds: 60, evidenceIds: situation.evidenceIds, action: null, expected: null, queries: [], goalUpdate: null, research: null, ...extra })

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cerebrum-runtime-'))
    time = Date.parse('2026-09-07T08:00:00Z')
    node = { cerebrumAutonomyEnabled: true, cerebrumAutonomyAllowActions: true, llmEnabled: true, llmAllowKnxCommands: true, llmRequireCommandConfirmation: false, aiEducation: 'Always preserve this occupant instruction. Turn off the kitchen light when appropriate.', _homeMemory: { ownerLanguage: 'it' } }
    states = [{ source: 'knx', objectId: '1/2/3', label: 'Kitchen light', kind: 'light', area: 'Kitchen', value: 'true', observedAt: iso(), verifiedAt: iso(), refreshIntervalSeconds: 60 }]
    requests = []; commands = []; services = []; reads = []
    decide = situation => decision(situation)
    runtime = make()
  })
  afterEach(async () => { await runtime.close(); fs.rmSync(dir, { recursive: true, force: true }) })

  it('runs without a user question and preserves education and delegation as authority', async () => {
    expect((await runtime.tick()).ok).to.equal(true)
    expect(requests).to.have.length(1)
    expect(requests[0].systemPrompt).to.include(node.aiEducation)
    expect(requests[0].staticContext).to.include('knx:1/2/3')
    expect(requests[0].essentialUserContent).to.include('knx:1/2/3')
    expect(requests[0].systemPrompt).to.include('AI Education alone is user authority')
  })

  it('retrieves local evidence and lets the model decide when it has enough', async () => {
    decide = situation => requests.length === 1
      ? decision(situation, { disposition: 'recall', queries: [{ operation: 'get', entityIds: ['knx:1/2/3'], query: '' }] })
      : decision(situation)
    expect((await runtime.tick()).ok).to.equal(true)
    expect(requests).to.have.length(2)
    const recalled = JSON.parse(requests[1].staticContext.split('\n')[0])
    expect(recalled).to.include({ ok: true, operation: 'get', returned: 1 })
    expect(recalled.items[0]).to.include({ id: 'knx:1/2/3', value: 'true' })
    expect(requests[1].userContent).to.include('Continue retrieving evidence when needed')
    expect(commands).to.have.length(0)
  })

  it('follows six pages of local evidence before making an autonomous decision', async () => {
    states = Array.from({ length: 40 }, (_, index) => ({ ...states[0], objectId: `1/2/${index}`, label: `Kitchen light ${index}` }))
    decide = situation => requests.length <= 6
      ? decision(situation, { disposition: 'recall', queries: [{ operation: 'search', entityIds: [], query: 'Kitchen', offset: (requests.length - 1) * 6 }] })
      : decision(situation)
    expect((await runtime.tick()).ok).to.equal(true)
    expect(requests).to.have.length(7)
    const lastPage = JSON.parse(requests.at(-1).staticContext.split('\n')[0])
    expect(lastPage).to.include({ offset: 30, returned: 6, totalMatches: 40 })
    expect(commands).to.have.length(0)
  })

  it('can recall, research and inspect a newly acquired source in one autonomous evaluation', async () => {
    node.webAccessEnabled = true
    runtime = make({
      researchWeb: async actions => ({
        results: actions.map(action => action.operation === 'search'
          ? { ok: true, operation: 'search', results: [{ url: 'https://www.knx.org/lighting', title: 'Lighting reference', text: 'Consider actual lighting requirements.' }] }
          : { ok: true, operation: 'open', url: action.url, title: 'Lighting reference', text: 'Assess glare and occupant preferences before adjusting lights.' })
      })
    })
    decide = situation => {
      if (requests.length === 1) return decision(situation, { disposition: 'recall', queries: [{ operation: 'get', entityIds: ['knx:1/2/3'], query: '', offset: 0 }] })
      if (requests.length === 2) return decision(situation, { disposition: 'research', research: { topic: 'lighting_comfort', goalId: '' } })
      if (requests.length === 3) return decision(situation, { disposition: 'recall', queries: [{ operation: 'knowledge', entityIds: [runtime.snapshot().knowledge[0].id], query: '', offset: 0 }] })
      return decision(situation)
    }
    expect((await runtime.tick()).ok).to.equal(true)
    expect(requests).to.have.length(4)
    const recalled = JSON.parse(requests.at(-1).staticContext.split('\n')[0])
    expect(recalled).to.include({ operation: 'knowledge', returned: 1 })
    expect(recalled.items[0].text).to.include('Assess glare')
    expect(commands).to.have.length(0)
  })

  it('stops an unchanged recall cycle and asks for a decision with uncertainty', async () => {
    decide = (situation, request) => request.userContent.includes('Repeated tool queries')
      ? decision(situation, { summary: 'Insufficient evidence; continue observing.' })
      : decision(situation, { disposition: 'recall', queries: [{ operation: 'get', entityIds: ['knx:1/2/3'], query: '', offset: 0 }] })
    expect((await runtime.tick()).ok).to.equal(true)
    expect(requests).to.have.length(3)
    expect(requests.at(-1).userContent).to.include('no new evidence')
    expect(commands).to.have.length(0)
  })

  it('does not continue tool reasoning after autonomy is disabled during a model call', async () => {
    decide = situation => {
      node.cerebrumAutonomyEnabled = false
      return decision(situation, { disposition: 'recall', queries: [{ operation: 'get', entityIds: ['knx:1/2/3'], query: '', offset: 0 }] })
    }
    await runtime.tick()
    expect(requests).to.have.length(1)
    expect(commands).to.have.length(0)
  })

  it('sends a locally validated KNX command and requests actual device feedback', async () => {
    decide = situation => decision(situation, { disposition: 'act', action: { source: 'knx', objectId: '1/2/3', value: 'false' }, expected: { source: 'knx', objectId: '1/2/3', value: 'false' } })
    expect((await runtime.tick()).ok).to.equal(true)
    expect(commands).to.have.length(1)
    expect(commands[0]).to.include({ destination: '1/2/3', dpt: '1.001', payload: false })
    expect(reads).to.deep.equal(['1/2/3'])
    expect(runtime.snapshot().situations.some(item => item.status === 'verifying')).to.equal(true)
  })

  it('rejects writes to read-only catalog objects', async () => {
    runtime = make({ getCatalog: () => [{ ga: '1/2/3', dpt: '1.001', readOnly: true }] })
    decide = situation => decision(situation, { disposition: 'act', action: { source: 'knx', objectId: '1/2/3', value: 'false' }, expected: { source: 'knx', objectId: '1/2/3', value: 'false' } })
    await runtime.tick()
    expect(commands).to.have.length(0)
    expect(runtime.snapshot().lastError).to.include('read-only')
  })

  it('requires every configured execution guard even if the model asks to act', async () => {
    for (const override of [{ cerebrumAutonomyAllowActions: false }, { aiEducation: '' }, { llmAllowKnxCommands: false }, { llmRequireCommandConfirmation: true }, { cerebrumAutonomyEnabled: false }]) expect(canAct({ ...node, ...override })).to.equal(false)
    node.cerebrumAutonomyAllowActions = false
    decide = situation => decision(situation, { disposition: 'act', action: { source: 'knx', objectId: '1/2/3', value: 'false' }, expected: { source: 'knx', objectId: '1/2/3', value: 'false' } })
    expect((await runtime.tick()).ok).to.equal(false)
    expect(commands).to.have.length(0)
    expect(services).to.have.length(0)
    expect(reads).to.have.length(0)
    expect(runtime.snapshot().lastError).to.include('outside permitted capabilities')
  })

  it('routes Home Assistant state changes through authorized service calls and readback', async () => {
    states = [{ ...states[0], source: 'home-assistant', objectId: 'light.kitchen', value: 'on' }]
    decide = situation => decision(situation, { disposition: 'act', action: { source: 'home-assistant', objectId: 'light.kitchen', value: 'off' }, expected: { source: 'home-assistant', objectId: 'light.kitchen', value: 'off' } })
    expect((await runtime.tick()).ok).to.equal(true)
    expect(services).to.have.length(1)
    expect(services[0]).to.deep.include({ domain: 'light', service: 'turn_off', target: { entity_id: 'light.kitchen' }, authorization: { confirmed: true, source: 'cerebrumUltimate' } })
    expect(reads).to.deep.equal(['light.kitchen'])
  })
})
