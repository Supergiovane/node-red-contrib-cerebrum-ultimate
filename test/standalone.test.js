'use strict'
/* eslint-env mocha */

const { expect } = require('chai')
const { EventEmitter } = require('events')
const fs = require('fs')
const Module = require('module')
const os = require('os')
const path = require('path')

const packageRoot = path.resolve(__dirname, '..')
const manifest = require('../package.json')
const publicApi = require('../index')
const {
  buildCerebrumCompatibleNodeSummary,
  buildCerebrumPackageNodeCatalog,
  buildCerebrumSetupDoctorSnapshot,
  isCerebrumCameraProviderSelected
} = require('../nodes/cerebrumUltimate').__test

describe('Cerebrum Ultimate standalone package', () => {
  it('publishes only the new standalone node types', () => {
    expect(manifest.name).to.equal('node-red-contrib-cerebrum-ultimate')
    expect(manifest['node-red'].nodes).to.deep.equal({
      cerebrumUltimate: '/nodes/cerebrumUltimate.js',
      cerebrumHomeAssistant: '/nodes/cerebrumHomeAssistant.js'
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

  it('exposes one stable global adapter registry', () => {
    const first = publicApi.getAdapterRegistry()
    const second = publicApi.getAdapterRegistry()
    expect(first).to.equal(second)
    expect(publicApi.REGISTRY_VERSION).to.equal(1)
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
    expect(editor).to.include('RED.nodes.registerType(\'cerebrumUltimate\'')
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
        homeAssistant: { packageDetected: true, ready: false, recommendationCode: 'add_cerebrum_bridge', apiNodes: [{}], bridgeNodes: [] }
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
    expect(types).to.include.members(['cerebrumUltimate', 'cerebrumHomeAssistant'])
    expect(types).not.to.include.members(['knxUltimateAI', 'knxUltimateAIHomeAssistant'])
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
    expect(node.cerebrumStorageDir).to.equal(path.join(userDir, 'cerebrumultimatestorage'))
    await new Promise(resolve => node.emit('close', resolve))
    fs.rmSync(userDir, { recursive: true, force: true })
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
