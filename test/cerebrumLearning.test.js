const { expect } = require('chai')
const { EventEmitter } = require('events')
const fs = require('fs')
const os = require('os')
const path = require('path')

const {
  buildCerebrumLearningPromptContext,
  buildCerebrumHomeAssistantStateContext,
  getCerebrumHomeAutomationRegistry,
  inspectCerebrumLearningFlow,
  normalizeCerebrumFlowSendEvent,
  normalizeCerebrumHomeAutomationEvent
} = require('../nodes/utils/cerebrumLearning')
const { buildCerebrumSetupDoctorSnapshot, summarizeCerebrumFlowWiring } = require('../nodes/cerebrumUltimate').__test

describe('Cerebrum discovery and Home Assistant round trip', () => {
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

  it('asks Setup Doctor for ha-api when the Home Assistant add-on is detected', () => {
    const snapshot = inspectCerebrumLearningFlow({ flowNodes: [], env: { SUPERVISOR_TOKEN: 'present' } })
    expect(snapshot.homeAssistant).to.include({
      addonDetected: true,
      apiNodePresent: false,
      ready: false,
      recommendationCode: 'add_ha_api'
    })
    const doctor = buildCerebrumSetupDoctorSnapshot({
      language: 'it',
      gateway: { configured: true, connectionState: 'connected' },
      llm: { enabled: true, provider: 'ollama', baseUrl: 'http://localhost/api/chat', model: 'local' },
      catalog: [{ ga: '1/1/1', dpt: '1.001', label: 'Luce', semantic: { kind: 'light' } }],
      wiring: summarizeCerebrumFlowWiring({ wires: [[], [], [], [], [], []] }),
      integrations: { cerebrum: snapshot },
      providerProbe: { state: 'reachable', modelCount: 1 }
    })
    const check = doctor.checks.find(item => item.id === 'homeAssistant')
    expect(check).to.include({ status: 'warn', blocking: false })
    expect(check.detail).to.include('ha-api')
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
