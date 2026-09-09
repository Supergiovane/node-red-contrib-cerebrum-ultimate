const { expect } = require('chai')

/* global describe, it */

const {
  inspectCerebrumIntegrationProvider,
  inspectCerebrumIntegrationRegistry,
  normalizeCerebrumIntegrationManifest,
  validateCerebrumIntegrationAction
} = require('../nodes/utils/cerebrumIntegrationContract')

describe('Cerebrum integration capability contract', () => {
  it('describes provider operations and health without exposing live methods', () => {
    const manifest = normalizeCerebrumIntegrationManifest({
      id: 'unifi-protect',
      title: 'UniFi Protect',
      kind: 'camera',
      capabilities: ['smart-detect']
    })
    const provider = inspectCerebrumIntegrationProvider({
      manifest,
      kind: 'camera',
      provider: {
        id: 'controller-1',
        adapterId: 'unifi-protect',
        connected: true,
        isReady: () => true,
        listCameras: async () => [],
        takeSnapshot: async () => null,
        queryEvents: async () => ({ events: [] }),
        takeEventSnapshot: async () => null,
        subscribe: () => () => {}
      }
    })

    expect(provider).to.include({ ready: true, usable: true, health: 'healthy' })
    expect(provider.operations.map(operation => operation.id)).to.include.members(['events', 'list-cameras', 'camera-snapshot', 'query-camera-events', 'camera-event-snapshot'])
    expect(JSON.stringify(provider)).not.to.include('async ()')
  })

  it('distinguishes disconnected, not-ready and operation-less providers', () => {
    const unavailable = inspectCerebrumIntegrationProvider({
      provider: { id: 'ha-main', adapterId: 'home-assistant', connected: false, getEntity: () => null }
    })
    const empty = inspectCerebrumIntegrationProvider({
      provider: { id: 'matter-main', adapterId: 'matter', isReady: () => true }
    })

    expect(unavailable).to.include({ usable: false, health: 'unavailable' })
    expect(unavailable.healthReasons).to.include('provider_disconnected')
    expect(empty.healthReasons).to.include('no_supported_operations')
    expect(inspectCerebrumIntegrationProvider({
      provider: { id: 'unifi-main', adapterId: 'unifi', error: new Error('socket'), listCameras: () => [] }
    }).health).to.equal('degraded')
  })

  it('keeps write operations marked as authorized and confirmed', () => {
    const provider = inspectCerebrumIntegrationProvider({
      provider: { id: 'ha-main', adapterId: 'home-assistant', isReady: () => true, callService: () => null }
    })
    const operation = provider.operations.find(item => item.id === 'write-entity')

    expect(operation).to.include({ effect: 'write', requiresAuthorization: true, requiresConfirmation: true })
    expect(validateCerebrumIntegrationAction({ operation, payload: { objectId: 'light.kitchen', operation: 'turn_on', value: true } }).ok).to.equal(true)
    expect(validateCerebrumIntegrationAction({ operation, payload: { objectId: 'light.kitchen', extra: true } }).errors).to.include.members(['missing:operation', 'unknown:extra'])
  })

  it('isolates malformed third-party entries while retaining valid providers', () => {
    const brokenProvider = {}
    Object.defineProperty(brokenProvider, 'adapterId', { get: () => { throw new Error('broken provider getter') } })
    const registry = {
      adapters: new Map([
        ['invalid', { title: 'Missing id' }],
        ['valid', { id: 'valid', operations: [{ id: 'custom-read', method: 'inspect', effect: 'read', schema: { type: 'object', additionalProperties: false, properties: {} } }] }]
      ]),
      providers: new Map([
        ['broken', brokenProvider],
        ['provider', { id: 'provider', adapterId: 'valid', inspect: () => ({}) }]
      ])
    }
    const snapshot = inspectCerebrumIntegrationRegistry(registry)

    expect(snapshot.adapters.map(adapter => adapter.id)).to.deep.equal(['valid'])
    expect(snapshot.providers[0].operations.map(operation => operation.id)).to.deep.equal(['custom-read'])
  })
})
