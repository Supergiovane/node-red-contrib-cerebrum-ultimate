/* global describe, it */
const { expect } = require('chai')
const { EventEmitter } = require('events')
const fs = require('fs')
const os = require('os')
const path = require('path')

const {
  buildCerebrumLearningPromptContext,
  buildCerebrumRuntimePromptContext,
  buildCerebrumHomeAssistantStateContext,
  getCerebrumHomeAutomationRegistry,
  inspectCerebrumLearningFlow,
  inspectCerebrumRuntime,
  normalizeCerebrumFlowSendEvent,
  normalizeCerebrumHomeAutomationEvent
} = require('../nodes/utils/cerebrumLearning')
const { normalizeCerebrumAdapterHistoryEvent } = require('../nodes/utils/cerebrumEventHistory')
const { hasCerebrumTransientMessageOrigin } = require('../nodes/utils/cerebrumTransientMessageOrigins')

describe('Cerebrum discovery and Home Assistant round trip', () => {
  it('inventories installed, deployed and usable providers without exposing live RED objects', () => {
    const flowNodes = [
      { id: 'cerebrum', type: 'cerebrumUltimate', server: 'knx-config', wires: [] },
      { id: 'matter', type: 'matter-device', wires: [] },
      { id: 'disabled', type: 'disabled-device', disabled: true, wires: [] }
    ]
    const RED = {
      nodes: {
        eachNode: callback => flowNodes.forEach(callback),
        getType: type => type === 'unused-installed-node' ? function InstalledNode () {} : undefined,
        getNodeList: () => [
          { id: 'matter/module', module: 'matter-module', version: '2.0.0', enabled: true, loaded: true, types: ['matter-device'] },
          { id: 'disabled/module', module: 'disabled-module', version: '1.0.0', enabled: true, loaded: true, types: ['disabled-device'] },
          { id: 'unused/module', module: 'unused-module', version: '1.0.0', enabled: true, loaded: true, types: ['unused-installed-node'] }
        ]
      }
    }
    const adapterRegistry = {
      adapters: new Map([['home-assistant', { id: 'home-assistant', title: 'Home Assistant', access: 'read-write-confirmed', capabilities: ['events'] }]]),
      providers: new Map([['ha-provider', { id: 'ha-provider', adapterId: 'home-assistant', isReady: () => true, listEntities: () => [], callService: () => {} }]])
    }
    const cameraRegistry = {
      adapters: new Map([['unifi-protect', { id: 'unifi-protect', title: 'UniFi Protect', capabilities: ['smart-detect'] }]]),
      providers: new Map([['protect-provider', { id: 'protect-provider', adapterId: 'unifi-protect', connected: true, listCameras: () => [], takeSnapshot: () => {} }]])
    }
    const snapshot = inspectCerebrumRuntime({ RED, currentNode: { id: 'cerebrum', type: 'cerebrumUltimate', serverKNX: { id: 'knx-config' }, _busConnectionState: 'connected' }, adapterRegistry, cameraRegistry, env: {} })

    expect(snapshot.nodeTypes.find(item => item.type === 'unused-installed-node')).to.include({ installed: true, deployedCount: 0, usable: false })
    expect(snapshot.nodeTypes.find(item => item.type === 'disabled-device')).to.include({ installed: true, deployedCount: 1, activeDeployedCount: 0, usable: false })
    expect(snapshot.integrations.find(item => item.id === 'home-assistant')).to.include({ installed: true, deployed: true, usable: true, readyProviderCount: 1 })
    expect(snapshot.integrations.find(item => item.id === 'unifi-protect')).to.include({ installed: true, deployed: true, usable: true, readyProviderCount: 1 })
    expect(snapshot.integrations.find(item => item.id === 'knx')).to.include({ usable: true })
    const context = buildCerebrumRuntimePromptContext(snapshot)
    expect(context).to.include('unifi-protect')
    expect(context).to.include('usable=true')
    expect(context).to.include('unused-module')
  })

  it('discovers flow logic, HUE, Matter and a complete ha-api round trip', () => {
    const flowNodes = [
      { id: 'ha-server', type: 'server', addon: true },
      { id: 'cerebrum', type: 'cerebrumUltimate', wires: [[], [], [], [], [], ['ha-api']] },
      { id: 'ha-api', type: 'ha-api', wires: [['cerebrum']] },
      { id: 'ha-events', type: 'server-state-changed', wires: [['cerebrum']] },
      { id: 'logic', type: 'function', func: 'return msg', wires: [] },
      { id: 'hue', type: 'knxUltimateHueController', wires: [] },
      { id: 'matter', type: 'knxUltimateMatterControllerDevice', wires: [] }
    ]
    const snapshot = inspectCerebrumLearningFlow({ flowNodes, env: {} })

    expect(snapshot.logicNodeCount).to.equal(1)
    expect(snapshot.hue.nodeCount).to.equal(1)
    expect(snapshot.matter.nodeCount).to.equal(1)
    expect(snapshot.homeAssistant).to.include({
      addonDetected: true,
      apiNodePresent: true,
      cerebrumNodePresent: true,
      roundTripWired: true,
      ready: true,
      recommendationCode: 'ready'
    })
    expect(snapshot.tools.map(tool => tool.id)).to.include.members([
      'hue.flow-events',
      'matter.flow-events',
      'node-red.flow-logic',
      'home-assistant.api',
      'home-assistant.events'
    ])
    expect(buildCerebrumLearningPromptContext(snapshot)).to.include('CEREBRUM FLOW DISCOVERY')
  })

  it('recommends ha-api when the Home Assistant add-on is detected', () => {
    const snapshot = inspectCerebrumLearningFlow({ flowNodes: [], env: { SUPERVISOR_TOKEN: 'present' } })
    expect(snapshot.homeAssistant).to.include({
      addonDetected: true,
      apiNodePresent: false,
      ready: false,
      recommendationCode: 'add_ha_api'
    })
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

  it('observes useful Node-RED messages without retaining secrets or binary content', () => {
    const event = normalizeCerebrumFlowSendEvent({
      source: { node: { id: 'logic-1', type: 'function', name: 'Evening logic', z: 'tab-1' } },
      destination: { node: { id: 'hue-1', type: 'knxUltimateHueLight' } },
      msg: {
        topic: 'living-room',
        payload: {
          brightness: 42,
          access_token: 'must-not-leak',
          image: Buffer.from('must-not-leak'),
          nested: { active: true }
        }
      }
    }, { at: '2026-09-01T08:30:00.000Z' })

    expect(event).to.include({
      adapterId: 'node-red-flow',
      eventType: 'flow_message',
      resourceId: 'logic-1',
      resourceType: 'function'
    })
    expect(event.details.payload).to.deep.equal({ brightness: 42, nested: { active: true } })
    expect(JSON.stringify(event)).not.to.include('must-not-leak')
  })

  it('registers a passive runtime hook and publishes filtered flow events', () => {
    let pluginDefinition
    let hook
    const RED = {
      plugins: {
        registerPlugin (id, definition) {
          expect(id).to.equal('cerebrumUltimateRuntime')
          pluginDefinition = definition
        }
      },
      hooks: {
        add (id, callback) {
          expect(id).to.equal('onSend.cerebrumUltimate')
          hook = callback
        },
        remove () {}
      }
    }
    require('../nodes/plugins/cerebrum-runtime-plugin')(RED)
    pluginDefinition.onadd()
    const provider = getCerebrumHomeAutomationRegistry().providers.get('cerebrum-ultimate:runtime')
    const received = []
    const unsubscribe = provider.subscribe(event => received.push(event))

    hook([{
      source: { node: { id: 'matter-1', type: 'knxUltimateMatterControllerDevice', name: 'Matter light' } },
      msg: { payload: { on: true } }
    }])
    hook([{
      source: { node: { id: 'protect-1', type: 'unifi-protect-device', name: 'Ingresso' } },
      msg: {
        _msgid: 'protect-message-1',
        payload: { deviceName: 'Ingresso', event: { type: 'motion' } },
        details: { unifiProtect: { source: 'events', deviceId: 'camera-1', eventType: 'motion' } }
      }
    }])
    hook([{
      source: { node: { id: 'logic-1', type: 'function', name: 'Protect relay' } },
      msg: { _msgid: 'protect-message-1', payload: { motion: true } }
    }])
    expect(hasCerebrumTransientMessageOrigin({
      messageId: 'protect-message-1',
      source: 'unifi-protect'
    })).to.equal(true)
    hook([{
      source: { node: { id: 'logic-2', type: 'change', name: 'Protect transform' } },
      msg: {
        _msgid: 'protect-message-2',
        payload: { motion: true },
        details: { unifiProtect: { source: 'events', deviceId: 'camera-1' } }
      }
    }])
    hook([{
      source: { node: { id: 'debug-1', type: 'debug', name: 'Not observed' } },
      msg: { payload: 'ignored' }
    }])

    expect(received).to.have.length(1)
    expect(received[0]).to.include({ adapterId: 'matter', eventType: 'state_changed', resourceId: 'matter-1', state: '{"on":true}' })
    unsubscribe()
    getCerebrumHomeAutomationRegistry().unregisterProvider('cerebrum-ultimate:runtime')
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
