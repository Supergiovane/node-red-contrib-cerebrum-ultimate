/* global describe, it */
const { expect } = require('chai')
const {
  CEREBRUM_CODE_MAX_SOURCE_CHARS,
  buildCerebrumRuntimeInspectionSnapshot,
  executeCerebrumRuntimeCode,
  normalizeCerebrumCodeActions,
  normalizeRuntimeCodeResult
} = require('../nodes/utils/cerebrumRuntimeCode')
const { parseCerebrumConversationResponse } = require('../nodes/cerebrumUltimate').__test

describe('Cerebrum isolated runtime JavaScript tool', function () {
  it('normalizes one bounded run action', function () {
    const normalized = normalizeCerebrumCodeActions([
      { operation: 'run', code: 'return RED.nodes.listNodeSets()', reason: 'inspect compatible packages' },
      { operation: 'run', code: 'return 2', reason: 'ignored by the one-action limit' }
    ])
    expect(normalized.rejected).to.deep.equal([])
    expect(normalized.accepted).to.deep.equal([
      { operation: 'run', code: 'return RED.nodes.listNodeSets()', reason: 'inspect compatible packages' }
    ])
  })

  it('parses JavaScript actions from the structured LLM response', function () {
    const envelope = parseCerebrumConversationResponse(JSON.stringify({
      reply: '',
      code_actions: [{ operation: 'run', code: 'return RED.nodes.listTypes()', reason: 'inspect runtime inventory' }]
    }))
    expect(envelope.codeActions).to.deep.equal([
      { operation: 'run', code: 'return RED.nodes.listTypes()', reason: 'inspect runtime inventory' }
    ])
  })

  it('rejects empty and oversized source', function () {
    expect(normalizeCerebrumCodeActions([{ operation: 'run', code: '' }]).rejected[0].reason).to.equal('JavaScript source is empty')
    expect(normalizeCerebrumCodeActions([{ operation: 'run', code: 'x'.repeat(CEREBRUM_CODE_MAX_SOURCE_CHARS + 1) }]).rejected[0].reason).to.include('exceeds')
  })

  it('runs synchronously against an inventory-only Node-RED capability snapshot', function () {
    let getNodeListCalls = 0
    const RED = {
      nodes: {
        eachNode: () => { throw new Error('eachNode must not be called') },
        getNode: () => { throw new Error('getNode must not be called') },
        getType: () => { throw new Error('getType must not be called') },
        getNodeList: () => {
          getNodeListCalls += 1
          return [
            { id: 'knx/nodes', module: 'node-red-contrib-knx-ultimate', version: '4.0.0', enabled: true, loaded: true, types: ['knxUltimate', 'knxUltimate-config'] },
            { id: 'core/nodes', module: 'node-red', version: '4.1.0', enabled: true, loaded: true, types: ['inject', 'function'] }
          ]
        }
      }
    }
    const execution = executeCerebrumRuntimeCode({
      action: {
        operation: 'run',
        code: [
          'const first = RED.nodes.listNodeSets()',
          'first.push({ module: "mutated-copy" })',
          'return {',
          '  nodeType: typeof node,',
          '  eachNodeType: typeof RED.nodes.eachNode,',
          '  getNodeType: typeof RED.nodes.getNode,',
          '  getTypeType: typeof RED.nodes.getType,',
          '  modules: RED.nodes.listNodeSets().map(item => item.module),',
          '  types: RED.nodes.listTypes().map(item => item.type),',
          '  integrations: RED.integrations.map(item => item.id),',
          '  question,',
          '  sessionId',
          '}'
        ].join('\n'),
        reason: 'inspect compatible packages'
      },
      RED,
      runtimeSnapshot: {
        integrations: [{ id: 'unifi-ultimate', title: 'UniFi Protect', installed: true, deployed: true, usable: true }]
      },
      question: 'What is deployed?',
      sessionId: 'chat-1'
    })
    expect(execution.ok).to.equal(true)
    expect(execution.result).to.deep.equal({
      nodeType: 'undefined',
      eachNodeType: 'undefined',
      getNodeType: 'undefined',
      getTypeType: 'undefined',
      modules: ['node-red-contrib-knx-ultimate'],
      types: ['knxUltimate', 'knxUltimate-config'],
      integrations: ['unifi-ultimate'],
      question: 'What is deployed?',
      sessionId: 'chat-1'
    })
    expect(getNodeListCalls).to.equal(1)
  })

  it('ignores supplied flow nodes, wiring and live runtime objects', function () {
    let hostMethodCalled = false
    const node = { id: 'cerebrum-1', type: 'cerebrumUltimate', password: 'hidden', send: () => { hostMethodCalled = true } }
    const RED = {
      nodes: {
        eachNode: () => { hostMethodCalled = true },
        getNode: () => { hostMethodCalled = true },
        getType: () => { hostMethodCalled = true },
        getNodeList: () => [
          { id: 'safe/set', module: 'node-red-contrib-safe-ultimate', types: ['safeUltimateNode'], secret: 'hidden' },
          { id: 'core/set', module: 'node-red', types: ['inject'] }
        ]
      }
    }
    const runtimeSnapshot = {
      currentNode: node,
      flowNodeCount: 2,
      nodes: [{ id: 'flow-secret', type: 'function', credentials: { token: 'hidden' }, wires: [['destination-secret']] }],
      discovery: { nodes: [{ id: 'discovery-secret' }] },
      registries: { provider: { raw: 'hidden' } },
      integrations: [{ id: 'safe-adapter', title: 'Safe', usable: true, raw: { password: 'hidden' } }]
    }
    const snapshot = buildCerebrumRuntimeInspectionSnapshot({ runtimeSnapshot, node, RED })
    expect(JSON.stringify(snapshot)).not.to.include('hidden')
    expect(snapshot).not.to.have.any.keys('nodes', 'currentNode', 'flowNodeCount', 'discovery', 'registries')
    expect(snapshot.nodeSets.map(item => item.module)).to.deep.equal(['node-red-contrib-safe-ultimate'])

    const execution = executeCerebrumRuntimeCode({
      action: {
        operation: 'run',
        code: 'return { nodeType: typeof node, eachNodeType: typeof RED.nodes.eachNode, runtimeKeys: Object.keys(runtime).sort() }'
      },
      node,
      RED,
      runtimeSnapshot
    })
    expect(execution).to.deep.include({ ok: true })
    expect(execution.result).to.deep.equal({
      nodeType: 'undefined',
      eachNodeType: 'undefined',
      runtimeKeys: ['capturedAt', 'installedNodeSetCount', 'installedTypeCount', 'integrations', 'inventoryOnly', 'nodeSets', 'nodeTypes', 'version']
    })
    expect(hostMethodCalled).to.equal(false)
  })

  it('stops synchronous infinite loops', function () {
    const execution = executeCerebrumRuntimeCode({
      action: { operation: 'run', code: 'while (true) {}', reason: 'timeout test' },
      node: {},
      RED: {},
      timeoutMs: 25
    })
    expect(execution.ok).to.equal(false)
    expect(execution.error).to.match(/timed out/i)
  })

  it('rejects asynchronous results and dynamic code generation', function () {
    const asyncExecution = executeCerebrumRuntimeCode({
      action: { operation: 'run', code: 'return Promise.resolve(1)', reason: 'async test' },
      node: {},
      RED: {}
    })
    expect(asyncExecution.ok).to.equal(false)
    expect(asyncExecution.error).to.include('Asynchronous JavaScript is not supported')

    const dynamicExecution = executeCerebrumRuntimeCode({
      action: { operation: 'run', code: 'return Function("return 1")()', reason: 'dynamic test' },
      node: {},
      RED: {}
    })
    expect(dynamicExecution.ok).to.equal(false)
    expect(dynamicExecution.error).to.match(/code generation|strings disallowed/i)
  })

  it('bounds returned data and omits obvious credential fields', function () {
    const normalized = normalizeRuntimeCodeResult({
      name: 'safe',
      apiKey: 'hidden',
      nested: { password: 'hidden', value: 42 },
      binary: Buffer.alloc(12)
    })
    expect(normalized).to.deep.equal({
      name: 'safe',
      nested: { value: 42 },
      binary: '[Buffer 12 bytes omitted]'
    })

    const execution = executeCerebrumRuntimeCode({
      action: {
        operation: 'run',
        code: 'return Array.from({ length: 200 }, (_, index) => ({ index, text: "x".repeat(8000) }))',
        reason: 'oversized result test'
      },
      node: {},
      RED: {},
      maxOutputBytes: 1024
    })
    expect(execution.ok).to.equal(false)
    expect(execution.error).to.include('result exceeds')
  })
})
