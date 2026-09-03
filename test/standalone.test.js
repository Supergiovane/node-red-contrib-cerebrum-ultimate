'use strict'
/* eslint-env mocha */

const { expect } = require('chai')
const { EventEmitter } = require('events')
const fs = require('fs')
const Module = require('module')
const os = require('os')
const path = require('path')
const vm = require('vm')

const packageRoot = path.resolve(__dirname, '..')
const manifest = require('../package.json')
const publicApi = require('../index')
const {
  CEREBRUM_CAMERA_REGISTRY_ALIAS_KEY,
  CEREBRUM_CAMERA_REGISTRY_KEY,
  getCerebrumCameraAdapterRegistry
} = require('../nodes/utils/cerebrumCamera')
const { parseCerebrumHomeMemoryMarkdownStrict } = require('../nodes/utils/homeMemory')
const {
  buildCerebrumCompatibleNodeSummary,
  buildCerebrumPackageNodeCatalog,
  buildCerebrumSetupDoctorSnapshot,
  buildCerebrumStateRefreshMessage,
  buildCerebrumUniversalMessage,
  isCerebrumCameraProviderSelected,
  normalizeCerebrumEtsAccessConfiguration
} = require('../nodes/cerebrumUltimate').__test

describe('Cerebrum Ultimate standalone package', () => {
  it('publishes only the new standalone node types', () => {
    expect(manifest.name).to.equal('node-red-contrib-cerebrum-ultimate')
    expect(manifest['node-red'].nodes).to.deep.equal({
      cerebrumUltimate: '/nodes/cerebrumUltimate.js'
    })
    expect(manifest.dependencies).not.to.have.property('knxultimate')
    expect(manifest.dependencies).not.to.have.property('node-red-contrib-knx-ultimate')
  })

  it('keeps KNX and ETS optional in Setup Doctor', () => {
    const doctor = buildCerebrumSetupDoctorSnapshot({
      gateway: { configured: false },
      llm: {
        enabled: true,
        provider: 'ollama',
        baseUrl: 'http://localhost:11434/api/chat',
        model: 'local'
      },
      providerProbe: { state: 'reachable', modelCount: 1 }
    })
    const gateway = doctor.checks.find(check => check.id === 'gateway')
    const ets = doctor.checks.find(check => check.id === 'ets')
    expect(gateway).to.include({ status: 'info', blocking: false, weight: 0 })
    expect(ets).to.include({ status: 'info', blocking: false, weight: 0 })
    expect(doctor.status).not.to.equal('blocked')
  })

  it('normalizes persisted ETS access as a selected/read-only ACL', () => {
    expect(normalizeCerebrumEtsAccessConfiguration({
      configured: true,
      exposedGAs: ['1/1/2', '1/1/1', '1/1/2', ''],
      readOnlyGAs: ['1/1/2', '9/9/9', '1/1/2']
    })).to.deep.equal({
      configured: true,
      exposedGAs: ['1/1/1', '1/1/2'],
      readOnlyGAs: ['1/1/2']
    })
  })

  it('builds KNX Ultimate Universal reads with the mandatory readstatus flag', () => {
    const autonomousRead = buildCerebrumStateRefreshMessage({
      destination: '2/6/4',
      dpt: '1.001',
      requestedAt: '2026-09-02T04:23:55.180Z'
    })
    const llmRead = buildCerebrumUniversalMessage({
      command: { destination: '1/2/3', dpt: '9.001', event: 'GroupValue_Read' },
      question: 'Temperatura attuale?',
      sessionId: 'universal-read-test',
      confirmed: false,
      index: 0,
      inputMessage: { payload: 'Temperatura attuale?' }
    })
    const write = buildCerebrumUniversalMessage({
      command: { destination: '1/2/4', dpt: '1.001', event: 'GroupValue_Write', payload: true },
      question: 'Accendi',
      sessionId: 'universal-write-test',
      confirmed: true,
      index: 0,
      inputMessage: { payload: 'Accendi' }
    })

    expect(autonomousRead).to.include({
      topic: '2/6/4',
      destination: '2/6/4',
      dpt: '1.001',
      payload: '',
      event: 'GroupValue_Read',
      readstatus: true
    })
    expect(autonomousRead.cerebrum).to.deep.equal({
      type: 'cerebrum_state_refresh',
      autonomous: true,
      source: 'state_reconciler',
      requestedAt: '2026-09-02T04:23:55.180Z'
    })
    expect(llmRead).to.include({
      destination: '1/2/3',
      event: 'GroupValue_Read',
      readstatus: true
    })
    expect(write).to.include({
      destination: '1/2/4',
      event: 'GroupValue_Write',
      payload: true
    })
    expect(write).not.to.have.property('readstatus')
  })

  it('exposes one stable global adapter registry', () => {
    const first = publicApi.getAdapterRegistry()
    const second = publicApi.getAdapterRegistry()
    expect(first).to.equal(second)
    expect(publicApi.REGISTRY_VERSION).to.equal(1)
  })

  it('shares the established KNX AI camera registry with UniFi Protect', () => {
    const registry = getCerebrumCameraAdapterRegistry()
    expect(CEREBRUM_CAMERA_REGISTRY_KEY).to.equal(Symbol.for('node-red.knx-ai.camera-adapters.v1'))
    expect(globalThis[CEREBRUM_CAMERA_REGISTRY_KEY]).to.equal(registry)
    expect(globalThis[CEREBRUM_CAMERA_REGISTRY_ALIAS_KEY]).to.equal(registry)

    const provider = {
      id: 'unifi-ultimate:protect-contract-test',
      adapterId: 'unifi-ultimate',
      controllerId: 'protect-contract-test',
      listCameras: async () => [],
      takeSnapshot: async () => null,
      subscribe: () => () => {}
    }
    registry.registerAdapter({ id: 'unifi-ultimate', title: 'UniFi Ultimate / Protect' })
    registry.registerProvider(provider)
    expect(getCerebrumCameraAdapterRegistry().providers.get(provider.id)).to.equal(provider)
    registry.unregisterProvider(provider.id)
  })

  it('uses independent storage and admin routes', () => {
    const runtime = fs.readFileSync(path.join(packageRoot, 'nodes', 'cerebrumUltimate.js'), 'utf8')
    expect(runtime).to.include("'cerebrumultimatestorage'")
    expect(runtime).to.include("'/cerebrumUltimate/sidebar'")
    expect(runtime).not.to.include("require('knxultimate').dptlib")
    expect(runtime).not.to.include("needsPermission('knxUltimate-config.read')")
  })

  it('keeps optional config-node integrations inside the compatible-node panel', () => {
    const editor = fs.readFileSync(path.join(packageRoot, 'nodes', 'cerebrumUltimate.html'), 'utf8')
    expect(editor).to.include('icon: "cerebrum-brain.svg"')
    expect(fs.existsSync(path.join(packageRoot, 'nodes', 'icons', 'cerebrum-brain.svg'))).to.equal(true)
    expect(editor).to.include('server: { value: "", type: "knxUltimate-config", required: false }')
    expect(editor).to.include('unifiProtectConfig: { value: "", type: "unifi-protect-config", required: false }')
    expect(editor.indexOf('id="cerebrum-detected-adapters-panel"')).to.be.lessThan(editor.indexOf('id="node-input-server"'))
    expect(editor.indexOf('id="cerebrum-detected-adapters-panel"')).to.be.lessThan(editor.indexOf('id="node-input-unifiProtectConfig"'))
    expect(editor).to.include('id="cerebrum-open-ets-access"')
    expect(editor).to.include('params.set("tab", "etsAccess")')
    expect(editor).not.to.include('id="cerebrum-mount-ets-access"')
    expect(editor).not.to.include('id="cerebrum-ets-ga-list"')
    expect(editor).to.include('outputs: 6')
    expect(editor).to.include("case 5: return this._('cerebrumUltimate.outputs.homeAssistant')")
    expect(editor).to.include('RED.nodes.registerType(\'cerebrumUltimate\'')
  })

  it('provides an independent operation-status filter and color for every audit outcome', () => {
    const dashboard = fs.readFileSync(path.join(packageRoot, 'ui', 'cerebrumUltimate-vue', 'src', 'App.vue'), 'utf8')
    expect(dashboard).to.include('v-model="state.cerebrumOperationsStatusFilter"')
    expect(dashboard).to.include('<option value="all">All statuses</option>')
    ;[
      'observed',
      'sent',
      'succeeded',
      'confirmed',
      'submitted',
      'started',
      'awaiting_confirmation',
      'timed_out',
      'failed',
      'rejected',
      'cancelled',
      'expired'
    ].forEach(status => expect(dashboard).to.include(`.operation-status-${status} {`))
  })

  it('opens the web dashboard through the Home Assistant ingress prefix', () => {
    const editor = fs.readFileSync(path.join(packageRoot, 'nodes', 'cerebrumUltimate.html'), 'utf8')
    const resolverSource = editor.match(/const resolveAdminRoot = \(\) => \{[\s\S]*?\n {12}\};(?=\n {12}const resolveAccessToken)/)
    expect(resolverSource).not.to.equal(null)
    const resolve = (RED, window) => {
      const context = { RED, window, resolvedAdminRoot: '' }
      vm.runInNewContext(`${resolverSource[0]} resolvedAdminRoot = resolveAdminRoot();`, context)
      return context.resolvedAdminRoot
    }

    expect(resolve(
      { settings: { httpAdminRoot: '/' } },
      { location: { pathname: '/api/hassio_ingress/session-token/' } }
    )).to.equal('/api/hassio_ingress/session-token')
    expect(resolve(
      { settings: { httpAdminRoot: '/red' } },
      { location: { pathname: '/red/' } }
    )).to.equal('/red')
  })

  it('selects only the configured UniFi Protect provider while leaving generic adapters automatic', () => {
    const selectedNode = { unifiProtectConfigId: 'protect-a' }
    expect(isCerebrumCameraProviderSelected({
      providerId: 'unifi-ultimate:protect-a',
      provider: { adapterId: 'unifi-ultimate', controllerId: 'protect-a' },
      node: selectedNode
    })).to.equal(true)
    expect(isCerebrumCameraProviderSelected({
      providerId: 'unifi-ultimate:protect-b',
      provider: { adapterId: 'unifi-ultimate', controllerId: 'protect-b' },
      node: selectedNode
    })).to.equal(false)
    expect(isCerebrumCameraProviderSelected({
      providerId: 'camera:generic',
      provider: { adapterId: 'generic-camera' },
      node: selectedNode
    })).to.equal(true)
  })

  it('summarizes KNX, UniFi and flow integrations in one compatible-node list', () => {
    const summary = buildCerebrumCompatibleNodeSummary({
      cameraAdapters: [{ id: 'unifi-ultimate', title: 'UniFi Ultimate / Protect', providerCount: 2, usedProviderCount: 1, cameraCount: 3 }],
      cerebrumDiscovery: {
        hue: { nodeCount: 2 },
        matter: { nodeCount: 1 },
        homeAssistant: { packageDetected: true, ready: false, recommendationCode: 'wire_round_trip', apiNodes: [{}], cerebrumNodes: [{}] }
      },
      wiring: { outputs: [{ id: 'ttsUltimate', connected: true, connectionCount: 1 }] },
      selectedKnxConfigId: 'knx-a',
      selectedUnifiConfigId: 'protect-a',
      knxConfigTypeAvailable: true,
      unifiConfigTypeAvailable: true
    })
    expect(summary.map(item => item.id)).to.include.members([
      'knx-ultimate',
      'unifi-ultimate',
      'hue',
      'matter',
      'home-assistant',
      'tts-ultimate'
    ])
    expect(summary.find(item => item.id === 'unifi-ultimate')).to.include({ configured: true, usedInChat: true, providerCount: 2, usedProviderCount: 1, cameraCount: 3 })
  })

  it('discovers standalone node definitions without reintroducing legacy types', () => {
    const types = buildCerebrumPackageNodeCatalog().map(item => item.type)
    expect(types).to.include('cerebrumUltimate')
    expect(types).not.to.include.members(['knxUltimateAI', 'knxUltimateAIHomeAssistant', 'cerebrumHomeAssistant'])
  })

  it('constructs and closes cleanly without KNX Ultimate or a gateway', async () => {
    const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cerebrum-standalone-'))
    let Constructor
    const noop = () => {}
    const RED = {
      auth: { needsPermission: () => noop },
      httpAdmin: { get: noop, post: noop, use: noop },
      settings: { userDir, httpAdminRoot: '/' },
      nodes: {
        getNode: () => undefined,
        eachNode: noop,
        registerType: (type, constructor) => { if (type === 'cerebrumUltimate') Constructor = constructor },
        createNode: node => {
          const emitter = new EventEmitter()
          node.id = 'standalone-test'
          node.type = 'cerebrumUltimate'
          node.credentials = {}
          node.on = emitter.on.bind(emitter)
          node.emit = emitter.emit.bind(emitter)
          node.status = noop
          node.warn = noop
          node.error = noop
          node.send = noop
          node.log = noop
        }
      },
      util: { cloneMessage: message => JSON.parse(JSON.stringify(message)) }
    }

    require('../nodes/cerebrumUltimate')(RED)
    const node = new Constructor({
      name: 'Standalone',
      server: '',
      unifiProtectConfig: '',
      llmEnabled: false,
      etsExposedGAs: [],
      etsReadOnlyGAs: []
    })
    expect(node.serverKNX).to.equal(undefined)
    expect(node.unifiProtectConfig).to.equal(undefined)
    expect(node.llmAllowRuntimeCode).to.equal(false)
    expect(node.cerebrumStorageDir).to.equal(path.join(userDir, 'cerebrumultimatestorage'))
    expect(node.getSidebarState().node.llmAllowRuntimeCode).to.equal(false)
    expect(node.getSidebarState().etsAccess).to.include({ configured: false, totalCount: 0, catalogIncluded: false })
    expect(node.recordCerebrumOperation({
      category: 'autonomous',
      source: 'standalone-test',
      operation: 'self_check',
      status: 'succeeded',
      title: 'Standalone operation audit test'
    })).to.include({ category: 'autonomous', operation: 'self_check' })
    const operationSnapshot = node.getCerebrumOperationsSnapshot({ limit: 20 })
    expect(operationSnapshot).to.include({ ok: true, retentionDays: 3 })
    expect(operationSnapshot.counts).to.include({ total: 1, autonomous: 1, knx: 0 })
    expect(operationSnapshot.items[0]).to.include({ source: 'standalone-test', operation: 'self_check' })
    expect(fs.existsSync(path.join(userDir, 'cerebrumultimatestorage', 'cerebrum', 'operations', 'standalone-test'))).to.equal(true)
    const savedAccess = await node.saveEtsAccessConfiguration({ configured: true, exposedGAs: [], readOnlyGAs: [] })
    expect(savedAccess.etsAccess).to.include({ configured: true, selectedCount: 0, catalogIncluded: true })
    const persistedConfig = JSON.parse(fs.readFileSync(path.join(userDir, 'cerebrumultimatestorage', 'cerebrum', 'config', 'cerebrum-config-standalone-test.json'), 'utf8'))
    expect(persistedConfig.etsAccess).to.deep.equal({ configured: true, exposedGAs: [], readOnlyGAs: [] })
    await new Promise(resolve => node.emit('close', resolve))
    fs.rmSync(userDir, { recursive: true, force: true })
  })

  it('persists acquired home habits immediately and restores them after a Node-RED restart', async () => {
    const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cerebrum-habit-restart-'))
    const providerListeners = new Set()
    const noop = () => {}
    let Constructor
    let firstNode
    let restartedNode
    const RED = {
      auth: { needsPermission: () => noop },
      httpAdmin: { get: noop, post: noop, use: noop },
      settings: { userDir, httpAdminRoot: '/' },
      nodes: {
        getNode: () => undefined,
        eachNode: noop,
        registerType: (type, constructor) => { if (type === 'cerebrumUltimate') Constructor = constructor },
        createNode: node => {
          const emitter = new EventEmitter()
          node.id = 'habit-restart-test'
          node.type = 'cerebrumUltimate'
          node.credentials = {}
          node.on = emitter.on.bind(emitter)
          node.emit = emitter.emit.bind(emitter)
          node.status = noop
          node.warn = noop
          node.error = noop
          node.send = noop
          node.log = noop
        }
      },
      util: { cloneMessage: message => JSON.parse(JSON.stringify(message)) }
    }
    const registry = publicApi.getAdapterRegistry()
    const unregisterAdapter = registry.registerAdapter({
      id: 'habit-restart-adapter',
      title: 'Habit restart adapter',
      capabilities: ['events']
    })
    const unregisterProvider = registry.registerProvider({
      id: 'habit-restart-provider',
      adapterId: 'habit-restart-adapter',
      subscribe: listener => {
        providerListeners.add(listener)
        return () => providerListeners.delete(listener)
      }
    })
    const closeNode = node => node && new Promise(resolve => node.emit('close', resolve))

    try {
      require('../nodes/cerebrumUltimate')(RED)
      const config = {
        name: 'Habit restart',
        server: '',
        unifiProtectConfig: '',
        llmEnabled: false,
        etsExposedGAs: [],
        etsReadOnlyGAs: []
      }
      firstNode = new Constructor(config)
      expect(providerListeners.size).to.be.greaterThan(0)

      const memoryPath = path.join(userDir, 'cerebrumultimatestorage', 'cerebrum', 'memory', 'cerebrum-home-memory.md')
      const checkpointPath = path.join(userDir, 'cerebrumultimatestorage', 'cerebrum', 'memory', 'cerebrum-habit-learning.json')
      const memoryBeforeLearning = fs.readFileSync(memoryPath, 'utf8')
      const emitProviderEvent = event => providerListeners.forEach(listener => listener(event))
      emitProviderEvent({
        entityId: 'light.kitchen',
        resourceName: 'Kitchen light',
        resourceType: 'light',
        eventType: 'state_changed',
        state: 'off',
        at: '2026-08-03T06:10:00.000Z'
      })
      emitProviderEvent({
        entityId: 'light.kitchen',
        resourceName: 'Kitchen light',
        resourceType: 'light',
        eventType: 'state_changed',
        state: 'on',
        at: '2026-08-03T06:15:00.000Z'
      })

      const learningCheckpoint = JSON.parse(fs.readFileSync(checkpointPath, 'utf8'))
      expect(learningCheckpoint).to.include({ version: 1 })
      expect(learningCheckpoint.habits).to.have.length(1)
      expect(parseCerebrumHomeMemoryMarkdownStrict(fs.readFileSync(memoryPath, 'utf8')).habits).to.deep.equal([])
      expect(learningCheckpoint.habits[0]).to.include({
        type: 'temporal_state_pattern',
        source: 'habit-restart-adapter',
        objectId: 'light.kitchen',
        value: 'on',
        samples: 1
      })

      await closeNode(firstNode)
      firstNode = null
      fs.writeFileSync(memoryPath, memoryBeforeLearning, 'utf8')
      restartedNode = new Constructor(config)
      let restoredSnapshot = await restartedNode.getCerebrumMemoryFile()
      let restoredMemory = JSON.parse(restoredSnapshot.jsonContent)
      expect(restoredMemory.habits).to.have.length(1)
      expect(restoredMemory.habits[0]).to.include({
        type: 'temporal_state_pattern',
        source: 'habit-restart-adapter',
        objectId: 'light.kitchen',
        value: 'on',
        samples: 1
      })

      emitProviderEvent({
        entityId: 'light.kitchen',
        resourceName: 'Kitchen light',
        resourceType: 'light',
        eventType: 'state_changed',
        state: 'off',
        at: '2026-08-10T06:10:00.000Z'
      })
      emitProviderEvent({
        entityId: 'light.kitchen',
        resourceName: 'Kitchen light',
        resourceType: 'light',
        eventType: 'state_changed',
        state: 'on',
        at: '2026-08-10T06:15:00.000Z'
      })
      const continuedCheckpoint = JSON.parse(fs.readFileSync(checkpointPath, 'utf8'))
      expect(continuedCheckpoint.habits[0]).to.include({ samples: 2, observationDays: 2 })

      restoredSnapshot = await restartedNode.getCerebrumMemoryFile()
      restoredMemory = JSON.parse(restoredSnapshot.jsonContent)
      restoredMemory.habits[0].status = 'confirmed'
      restoredMemory.habits[0].decidedAt = '2026-08-10T06:16:00.000Z'
      const confirmedSnapshot = await restartedNode.updateCerebrumMemoryFile({
        jsonContent: JSON.stringify(restoredMemory),
        revision: restoredSnapshot.revision
      })
      const confirmedMemory = parseCerebrumHomeMemoryMarkdownStrict(fs.readFileSync(memoryPath, 'utf8'))
      expect(confirmedMemory.habits[0]).to.include({ status: 'confirmed', samples: 2 })
      expect(JSON.parse(fs.readFileSync(checkpointPath, 'utf8')).habits).to.deep.equal([])

      const memoryWithoutRoutine = JSON.parse(confirmedSnapshot.jsonContent)
      memoryWithoutRoutine.habits = []
      await restartedNode.updateCerebrumMemoryFile({
        jsonContent: JSON.stringify(memoryWithoutRoutine),
        revision: confirmedSnapshot.revision
      })
      await closeNode(restartedNode)
      restartedNode = new Constructor(config)
      const afterDeletion = JSON.parse((await restartedNode.getCerebrumMemoryFile()).jsonContent)
      expect(afterDeletion.habits).to.deep.equal([])
    } finally {
      await closeNode(firstNode)
      await closeNode(restartedNode)
      unregisterProvider()
      unregisterAdapter()
      fs.rmSync(userDir, { recursive: true, force: true })
    }
  })

  it('falls back safely when no KNX runtime package can be resolved', () => {
    const optionalKnxPath = require.resolve('../nodes/utils/optionalKnx')
    const originalLoad = Module._load
    delete require.cache[optionalKnxPath]
    Module._load = function (request, parent, isMain) {
      if (request === 'knxultimate' || request === 'node-red-contrib-knx-ultimate/package.json') {
        const error = new Error(`Cannot find module '${request}'`)
        error.code = 'MODULE_NOT_FOUND'
        throw error
      }
      return originalLoad.call(this, request, parent, isMain)
    }
    let optionalKnx
    try {
      optionalKnx = require(optionalKnxPath)
    } finally {
      Module._load = originalLoad
      delete require.cache[optionalKnxPath]
    }
    expect(optionalKnx.knxDptAvailable).to.equal(false)
    expect(optionalKnx.dptlib.resolve('1.001')).to.equal(null)
  })
})
