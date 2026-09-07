'use strict'
/* eslint-env mocha */
const { expect } = require('chai')
const { createCerebrumReasoningProgress, selectCerebrumReasoningResults } = require('../nodes/utils/cerebrumReasoning')
const { executeCerebrumCatalogActions, collectCerebrumCatalogObjects, buildCerebrumKnxAvailabilityContext } = require('../nodes/utils/cerebrumCatalogRetrieval')
const { packCerebrumSemanticContext } = require('../nodes/utils/cerebrumSemanticContext')
const { fitCerebrumPrompt } = require('../nodes/utils/cerebrumContextBudget')

describe('Cerebrum progressive reasoning', () => {
  it('distinguishes missing gateways, empty catalogs and ETS access configuration from session context', () => {
    const access = { gateway: { configured: true }, configured: true, totalCount: 10, requestedSelectionCount: 2, selectedCount: 2, readOnlyCount: 1 }
    const cases = [
      [{ gateway: { configured: false } }, 'gateway_missing'],
      [{ totalCount: 0 }, 'catalog_empty'],
      [{ configured: false }, 'access_not_configured'],
      [{ requestedSelectionCount: 0, selectedCount: 0 }, 'nothing_selected'],
      [{ selectedCount: 0 }, 'selection_not_in_catalog'],
      [{}, 'available']
    ]
    for (const [override, status] of cases) {
      const context = buildCerebrumKnxAvailabilityContext({ access: { ...access, ...override }, allowCommands: true })
      const current = JSON.parse(context.split('\n')[1])
      expect(current).to.include({ catalogStatus: status, gatewayConnection: 'unknown', scope: 'node_across_all_chat_channels' })
      expect(context).to.include('supersede earlier chat claims')
    }
    const facts = options => JSON.parse(buildCerebrumKnxAvailabilityContext({ access, ...options }).split('\n')[1])
    expect(facts({ allowCommands: true, gatewayConnection: 'connected', requireConfirmation: false })).to.include({ readableObjects: 2, writableObjects: 1, commandPolicy: 'enabled_with_ets_validation', writeConfirmationRequired: false })
    expect(facts({ allowCommands: false }).commandPolicy).to.equal('disabled_in_node_configuration')
    expect(facts({ allowCommands: true, safeReadOnly: true }).commandPolicy).to.equal('read_only_for_this_request')
    expect(facts({ access: { ...access, readOnlyCount: 2 } }).writableObjects).to.equal(0)
  })

  it('retains current KNX capabilities when old conversation and optional context are compacted', () => {
    const capabilities = buildCerebrumKnxAvailabilityContext({ access: { gateway: { configured: true }, configured: true, totalCount: 2, requestedSelectionCount: 2, selectedCount: 2 }, allowCommands: true })
    const essential = capabilities + '\nCURRENT REQUEST: Riprova ad aprire entrambe.'
    const fitted = fitCerebrumPrompt({ systemPrompt: 'Use current runtime capabilities.', userContent: 'Older chat: KNX commands unavailable in this session.\n'.repeat(1000), essentialUserContent: essential, staticContext: 'Optional observations.\n'.repeat(1000), contextTokens: 8192, maxTokens: 1000 })
    expect(fitted.userContent).to.include(capabilities).and.include('Riprova ad aprire entrambe')
    expect(fitted.userContent).not.to.include('Older chat:')
  })

  it('allows pagination and revisiting evidence, stops unchanged cycles and permits changed evidence', () => {
    const progress = createCerebrumReasoningProgress()
    const query = offset => [{ operation: 'search', query: 'tapparella', offset }]
    for (let page = 0; page < 15; page++) expect(progress('catalog', query(page), [page])).to.equal(true)
    expect(progress('catalog', query(0), [0])).to.equal(true)
    expect(progress('catalog', query(14), [14])).to.equal(true)
    expect(progress('catalog', query(0), [0])).to.equal(false)
    expect(progress('catalog', query(0), ['updated catalog'])).to.equal(true)
    expect(progress('catalog', [{ ...query(0)[0], reason: 'a different explanation' }], ['updated catalog'])).to.equal(false)
  })

  it('retains every acquired ETS object, packs larger windows and can fetch earlier pages again', () => {
    const catalog = Array.from({ length: 60 }, (_, i) => ({ ga: `1/2/${i}`, label: `Tapparella ${i}`, dpt: '5.001', readOnly: false }))
    const results = []
    for (let offset = 0; offset < 60; offset += 10) results.push(...executeCerebrumCatalogActions({ catalog, actions: [{ operation: 'search', query: 'Tapparella', offset, limit: 10 }] }))
    const details = collectCerebrumCatalogObjects(results)
    expect(details).to.have.length(60)
    const packed = budget => packCerebrumSemanticContext({ catalog, detailReferences: details.map(item => item.ga), byteBudget: budget })
    expect(packed(40000).includedDetailGAs).to.have.length(60)
    expect(packed(1500).includedDetailGAs.length).to.be.lessThan(60)
    expect(executeCerebrumCatalogActions({ catalog, actions: [results[0].action], priorResults: results })[0].items).to.deep.equal(results[0].items)
  })

  it('bounds only the working view and never cuts an evidence record or changes the stored results', () => {
    const records = Array.from({ length: 30 }, (_, offset) => ({ offset, value: '🏡照明'.repeat(40) }))
    const original = JSON.stringify(records)
    const view = selectCerebrumReasoningResults(records, 2200)
    expect(Buffer.byteLength(JSON.stringify(view.results))).to.be.at.most(2200)
    expect(view.results[0]).to.deep.equal(records.at(-1))
    expect(view.omitted + view.results.length).to.equal(30)
    expect(JSON.stringify(records)).to.equal(original)
  })
})
