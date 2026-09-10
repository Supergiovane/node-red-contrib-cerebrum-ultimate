/* global describe, it */
const { expect } = require('chai')
const { EventEmitter } = require('events')
const fs = require('fs')
const os = require('os')
const path = require('path')

const {
  buildCerebrumRuntimePromptContext,
  buildCerebrumHomeAssistantStateContext,
  getCerebrumHomeAutomationRegistry,
  inspectCerebrumRuntime,
  normalizeCerebrumHomeAutomationEvent
} = require('../nodes/utils/cerebrumLearning')
const { normalizeCerebrumAdapterHistoryEvent } = require('../nodes/utils/cerebrumEventHistory')

describe('Cerebrum discovery and Home Assistant round trip', () => {
  it('inventories only compatible installed packages through getNodeList and keeps provider readiness', () => {
    let getNodeListCalls = 0
    const RED = {
      nodes: {
        eachNode: () => { throw new Error('eachNode must not be used for inventory') },
        getNode: () => { throw new Error('getNode must not be used for inventory') },
        getType: () => { throw new Error('getType must not be used for inventory') },
        getNodeList: () => {
          getNodeListCalls += 1
          return [
            { id: 'knx/module', module: 'node-red-contrib-knx-ultimate', version: '4.0.0', enabled: true, loaded: true, types: ['knxUltimate', 'knxUltimate-config'] },
            { id: 'protect/module', module: 'node-red-contrib-unifi-ultimate', version: '3.1.0', enabled: true, loaded: true, types: ['unifi-protect-config', 'unifi-protect-device'] },
            { id: 'ha/module', module: 'node-red-contrib-home-assistant-websocket', version: '0.80.0', enabled: true, loaded: true, types: ['ha-api'] },
            { id: 'type-only/module', module: 'type-only-module', version: '1.0.0', enabled: true, loaded: true, types: ['vendorUltimateBridge'] },
            { id: 'disabled/module', module: 'node-red-contrib-disabled-ultimate', version: '1.0.0', enabled: false, loaded: true, types: ['disabledUltimateDevice'] },
            { id: 'unrelated/module', module: 'unrelated-module', version: '9.9.9', enabled: true, loaded: true, types: ['function', 'inject'] }
          ]
        }
      }
    }
    const adapterRegistry = {
      adapters: new Map([['home-assistant', { id: 'home-assistant', title: 'Home Assistant', access: 'read-write-confirmed', capabilities: ['events'] }]]),
      providers: new Map([['ha-provider', { id: 'ha-provider', adapterId: 'home-assistant', isReady: () => true, listEntities: () => [], callService: () => {} }]])
    }
    const cameraRegistry = {
      adapters: new Map([['unifi-ultimate', { id: 'unifi-ultimate', title: 'UniFi Protect', capabilities: ['smart-detect'] }]]),
      providers: new Map([['protect-provider', { id: 'protect-provider', adapterId: 'unifi-ultimate', connected: true, listCameras: () => [], takeSnapshot: () => {} }]])
    }
    const snapshot = inspectCerebrumRuntime({
      RED,
      currentNode: { id: 'cerebrum', type: 'cerebrumUltimate', serverKNX: { id: 'knx-config' }, _busConnectionState: 'connected' },
      flowNodes: [{ id: 'must-not-leak', type: 'function', wires: [['also-secret']] }],
      adapterRegistry,
      cameraRegistry,
      env: {}
    })

    expect(getNodeListCalls).to.equal(1)
    expect(snapshot.inventoryOnly).to.equal(true)
    expect(snapshot.nodeSets.map(item => item.module)).to.have.members([
      'node-red-contrib-knx-ultimate',
      'node-red-contrib-unifi-ultimate',
      'node-red-contrib-disabled-ultimate'
    ])
    expect(snapshot.nodeTypes.some(item => item.type === 'vendorultimatebridge')).to.equal(false)
    expect(snapshot.nodeTypes.find(item => item.type === 'disabledultimatedevice')).to.include({ installed: true, usable: false })
    expect(snapshot.nodeTypes.some(item => item.type === 'function')).to.equal(false)
    expect(snapshot.nodeTypes[0]).not.to.have.property('deployedCount')
    expect(snapshot).not.to.have.any.keys('nodes', 'currentNode', 'flowNodeCount', 'discovery')
    expect(JSON.stringify(snapshot)).not.to.include('must-not-leak')
    expect(JSON.stringify(snapshot)).not.to.include('unrelated-module')
    expect(snapshot.integrations.find(item => item.id === 'home-assistant')).to.include({ installed: true, deployed: true, usable: true, readyProviderCount: 1 })
    expect(snapshot.integrations.find(item => item.id === 'unifi-ultimate')).to.include({ installed: true, deployed: true, usable: true, readyProviderCount: 1 })
    expect(snapshot.integrations.find(item => item.id === 'knx')).to.include({ usable: true })
    const context = buildCerebrumRuntimePromptContext(snapshot)
    expect(context).to.include('unifi-ultimate')
    expect(context).to.include('usable=true')
    expect(context).not.to.include('node-red-contrib-home-assistant-websocket')
    expect(context).not.to.include('deployed flow nodes')
    expect(context).not.to.include('unrelated-module')
  })

  it('normalizes Home Assistant state events without retaining the raw message', () => {
    const event = normalizeCerebrumHomeAutomationEvent({
      payload: {
        event: {
          event_type: 'state_changed',
          time_fired: '2026-09-01T08:30:00+02:00',
          data: {
            entity_id: 'light.kitchen',
            old_state: { state: 'off' },
            new_state: { state: 'on', entity_id: 'light.kitchen', attributes: { friendly_name: 'Kitchen light' } }
          }
        }
      }
    }, { adapterId: 'home-assistant', providerId: 'bridge' })

    expect(event).to.include({
      adapterId: 'home-assistant',
      providerId: 'bridge',
      entityId: 'light.kitchen',
      resourceType: 'light',
      resourceName: 'Kitchen light',
      state: 'on',
      previousState: 'off'
    })
  })

  it('redacts integration credentials before events enter either local archive', () => {
    const event = normalizeCerebrumAdapterHistoryEvent({
      event: {
        adapterId: 'unifi-protect',
        eventType: 'motion',
        cameraId: 'camera-1',
        raw: {
          camera: 'Ingresso',
          password: 'never-store-this',
          headers: { authorization: 'Bearer never-store-this' },
          nested: { apiKey: 'never-store-this', useful: 'person' }
        }
      }
    })

    expect(event.details).to.deep.equal({ camera: 'Ingresso', nested: { useful: 'person' } })
    expect(JSON.stringify(event)).not.to.include('never-store-this')
  })

  it('keeps Node-RED access inventory-only and ships no runtime observer', () => {
    expect(fs.existsSync(path.join(__dirname, '..', 'nodes', 'plugins', 'cerebrum-runtime-plugin.js'))).to.equal(false)
    expect(require('../nodes/utils/cerebrumLearning')).not.to.have.property('normalizeCerebrumFlowSendEvent')
  })

  it('builds a bounded request-relevant read-only Home Assistant state catalog', () => {
    const context = buildCerebrumHomeAssistantStateContext({
      question: 'temperatura cucina',
      states: [
        { entity_id: 'light.kitchen', state: 'off', attributes: { friendly_name: 'Kitchen light' } },
        { entity_id: 'sensor.kitchen_temperature', state: '21.7', last_changed: '2026-09-01T08:00:00Z', attributes: { friendly_name: 'Temperatura cucina', device_class: 'temperature', unit_of_measurement: '°C', access_token: 'must-not-leak' } },
        { entity_id: 'cover.bedroom', state: 'closed', attributes: { friendly_name: 'Bedroom cover' } }
      ],
      maxEntities: 1,
      maxChars: 2000
    })
    expect(context).to.include('HOME ASSISTANT STATE SNAPSHOT')
    expect(context).to.include('sensor.kitchen_temperature')
    expect(context).to.include('state=21.7 °C')
    expect(context).not.to.include('cover.bedroom |')
    expect(context).not.to.include('must-not-leak')
  })

  it('routes dynamic get_states requests through Cerebrum output 6 and correlates the ha-api response', async () => {
    const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cerebrum-ha-round-trip-'))
    let Constructor
    const sent = []
    const noop = () => {}
    const flowNodes = [
      { id: 'cerebrum-ha-test', type: 'cerebrumUltimate', wires: [[], [], [], [], [], ['ha-api-test']] },
      { id: 'ha-api-test', type: 'ha-api', wires: [['cerebrum-ha-test']] }
    ]
    const RED = {
      auth: { needsPermission: () => noop },
      httpAdmin: { get: noop, post: noop, use: noop },
      settings: { userDir, httpAdminRoot: '/' },
      nodes: {
        createNode (node) {
          const emitter = new EventEmitter()
          node.id = 'cerebrum-ha-test'
          node.type = 'cerebrumUltimate'
          node.credentials = {}
          node.on = emitter.on.bind(emitter)
          node.emit = emitter.emit.bind(emitter)
          node.send = outputs => sent.push(outputs)
          node.status = () => {}
          node.warn = () => {}
          node.error = () => {}
          node.log = () => {}
        },
        eachNode: callback => flowNodes.forEach(callback),
        getNode: () => undefined,
        registerType (type, ctor) {
          if (type === 'cerebrumUltimate') Constructor = ctor
        }
      },
      util: { cloneMessage: message => JSON.parse(JSON.stringify(message)) }
    }
    require('../nodes/cerebrumUltimate')(RED)
    const cerebrum = new Constructor({
      name: 'Cerebrum HA',
      server: '',
      unifiProtectConfig: '',
      llmEnabled: false,
      etsExposedGAs: [],
      etsReadOnlyGAs: [],
      wires: flowNodes[0].wires
    })
    const registry = getCerebrumHomeAutomationRegistry()
    const providerId = 'cerebrum-ultimate:cerebrum-ha-test:home-assistant'
    const provider = registry.providers.get(providerId)
    expect(provider.isReady()).to.equal(true)
    const pending = provider.listEntities()

    const request = sent[sent.length - 1][5]
    expect(request.payload).to.deep.include({ protocol: 'websocket', location: 'payload', locationType: 'msg' })
    expect(request.payload.data).to.deep.equal({ type: 'get_states' })
    cerebrum.emit('input', {
      payload: [{ entity_id: 'sensor.temperature', state: '21.5' }],
      cerebrum: request.cerebrum
    })
    expect(await pending).to.deep.equal([{ entity_id: 'sensor.temperature', state: '21.5' }])

    let deniedError
    try {
      await provider.callService({ domain: 'light', service: 'turn_on' })
    } catch (error) {
      deniedError = error
    }
    expect(deniedError).to.be.an('error')
    expect(deniedError.message).to.include('confirmation authorization')

    await new Promise(resolve => cerebrum.emit('close', resolve))
    expect(registry.providers.has(providerId)).to.equal(false)
    fs.rmSync(userDir, { recursive: true, force: true })
  })
})
