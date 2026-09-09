'use strict'
/* eslint-env mocha */

const assert = require('assert').strict
const { once } = require('events')
const { createRequire } = require('module')
const helper = require('node-red-node-test-helper')
const functionNode = require('../nodes/cerebrumFunction')
const { createCerebrumFunctionDataSource } = require('../nodes/utils/cerebrumFunctionContext')
const runtimePath = process.env.CEREBRUM_TEST_NODE_RED || require.resolve('node-red')
const requireRuntime = createRequire(runtimePath)
const nativeFunctionNode = requireRuntime('@node-red/nodes/core/function/10-function')
const linkNode = requireRuntime('@node-red/nodes/core/common/60-link')
const supportsLinkcall = parseInt(requireRuntime('node-red/package.json').version) >= 5

helper.init(runtimePath)

describe('Cerebrum Function in the Node-RED runtime', function () {
  this.timeout(6000)
  before(async () => { await helper.startServer() })
  after(async () => { await helper.stopServer() })
  afterEach(async () => { await helper.unload(); helper.settings({ functionExternalModules: true }) })

  const load = async (config = {}, additional = []) => {
    const brainNode = RED => RED.nodes.registerType('cerebrumUltimate', function (config) {
      RED.nodes.createNode(this, config)
      this.functionData = createCerebrumFunctionDataSource({ info: () => ({ id: this.id, name: 'Casa', llmEnabled: false }), catalog: () => [{ ga: '1/2/3', label: 'Cucina', dpt: '9.001' }], states: () => [{ key: 'knx:1/2/3', source: 'knx', value: 21 }], functions: () => [], readFunction: () => assert.fail('Unexpected file read') })
    })
    await helper.load([functionNode, nativeFunctionNode, linkNode, brainNode], [
      { id: 'tab', type: 'tab', label: 'Function test', env: [{ name: 'FUNCTION_TEST', value: 'room', type: 'str' }] },
      { id: 'fn', z: 'tab', type: 'cerebrum-function', name: 'Function test', func: 'return msg;', outputs: 1, timeout: 0, wires: [['out']], ...config },
      { id: 'out', z: 'tab', type: 'helper' },
      ...additional
    ].map(node => node.type === 'tab' ? node : { x: 100, y: 100, ...node }))
    return helper.getNode('fn')
  }
  const receive = async (node, msg) => {
    const received = once(helper.getNode('out'), 'input')
    node.receive(msg)
    return (await received)[0]
  }

  it('runs saved JavaScript without Cerebrum or an LLM and preserves message IDs and buffers', async () => {
    const node = await load({ cerebrumNode: 'offline', aiPrompt: 'This prompt must not run', func: 'msg.payload = Buffer.from(msg.payload).toString().toUpperCase(); return msg;' })
    const result = await receive(node, { _msgid: 'original-id', payload: Buffer.from('hello'), topic: 'sensor' })
    assert.equal(result._msgid, 'original-id')
    assert.equal(result.payload, 'HELLO')
    assert.equal(result.topic, 'sensor')
  })

  it('supports multiple messages on multiple outputs with native null routing', async () => {
    const node = await load({ outputs: 3, wires: [['out'], [], ['third']], func: 'return [[{payload:1},{payload:2}], null, {payload:3}];' }, [{ id: 'third', type: 'helper', z: 'tab' }])
    const first = []
    const allFirst = new Promise(resolve => helper.getNode('out').on('input', msg => { first.push(msg.payload); if (first.length === 2) resolve() }))
    const third = once(helper.getNode('third'), 'input')
    node.receive({ _msgid: 'routing' })
    await allFirst
    assert.deepEqual(first, [1, 2])
    const [last] = await third
    assert.equal(last.payload, 3)
    assert.equal(last._msgid, 'routing')
  })

  it('exposes Cerebrum data in native lifecycle code and message execution without an LLM', async () => {
    const node = await load({
      cerebrumNode: 'brain',
      initialize: 'context.set("apiInstalled", typeof cerebrum.knx.get === "function");',
      func: 'const ga = cerebrum.knx.get("1/2/3"); ga.state.value = 999; msg.payload = {ready: context.get("apiInstalled"), available:cerebrum.available, name:ga.name, value:cerebrum.knx.state(ga.address).value, functions:cerebrum.functions.list()}; return msg;',
      finalize: 'node.warn("Cerebrum API on stop: " + typeof cerebrum.knx.get);'
    }, [{ id: 'brain', z: 'tab', type: 'cerebrumUltimate' }])
    assert.deepEqual(JSON.parse(JSON.stringify((await receive(node, {})).payload)), { ready: true, available: true, name: 'Cucina', value: 21, functions: [] })
    await helper.clearFlows()
    assert(node.warn.calledWith('Cerebrum API on stop: function'))
  })

  it('lets functions handle an unavailable Cerebrum and prevents external modules from shadowing the API', async () => {
    let node = await load({ cerebrumNode: 'offline', func: 'msg.payload = cerebrum.available; return msg;' })
    assert.equal((await receive(node, {})).payload, false)
    await helper.unload()
    node = await load({ libs: [{ var: 'cerebrum', module: 'path' }] })
    assert(helper.log().args.some(([entry]) => String(entry.msg).includes('function.error.moduleNameError')))
  })

  it('supports context, flow/global context, environment and native node metadata', async () => {
    const node = await load({ func: 'context.set("count", (context.get("count") || 0) + 1); flow.set("room", env.get("FUNCTION_TEST")); global.set("source", node.name); msg.payload = {count:context.get("count"), room:flow.get("room"), source:global.get("source"), outputs:node.outputCount}; return msg;' })
    await receive(node, {})
    const result = await receive(node, {})
    assert.deepEqual(JSON.parse(JSON.stringify(result.payload)), { count: 2, room: 'room', source: 'Function test', outputs: 1 })
  })

  it('queues messages until async On Start completes and runs On Stop with timer cleanup', async () => {
    const node = await load({
      initialize: 'await new Promise(resolve => setTimeout(resolve, 30)); context.set("ready", true);',
      func: 'setInterval(() => {}, 1000); msg.payload = context.get("ready"); return msg;',
      finalize: 'node.warn("Function stopped");'
    })
    assert.equal((await receive(node, {})).payload, true)
    assert.equal(node.outstandingIntervals.length, 1)
    await helper.clearFlows()
    assert.equal(node.outstandingIntervals.length, 0)
    assert.equal(node.outstandingTimers.length, 0)
    assert(node.warn.calledWith('Function stopped'))
  })

  it('supports asynchronous send/done and clones the first message before later mutations', async () => {
    const node = await load({ func: 'setTimeout(() => { node.send(msg); msg.payload = "changed"; node.done(); }, 5);' })
    const result = await receive(node, { payload: 'original' })
    assert.equal(result.payload, 'original')
  })

  it('routes errors to Catch and honors the native execution timeout', async () => {
    const node = await load({ timeout: 0.02, func: 'while (true) {}' }, [{ id: 'catch', z: 'tab', type: 'catch', scope: ['fn'], wires: [['out']] }])
    const result = await receive(node, { payload: 'input' })
    assert.match(result.error.message, /timed out/)
    assert.equal(result.payload, 'input')
  })

  it('loads explicitly configured external modules using the native loader', async () => {
    const node = await load({ libs: [{ var: 'pathModule', module: 'path' }], func: 'msg.payload = pathModule.basename("/house/room"); return msg;' })
    assert.equal((await receive(node, {})).payload, 'room')
  })

  it('honors the native setting that disables external modules', async () => {
    helper.settings({ functionExternalModules: false })
    await load({ libs: [{ var: 'pathModule', module: 'path' }] })
    assert(helper.log().args.some(([entry]) => String(entry.msg).includes('function.error.externalModuleNotAllowed')))
  })

  it('coexists with the native Function without replacing its registration', async () => {
    const node = await load({ wires: [['native']], func: 'msg.payload += 1; return msg;' }, [{ id: 'native', z: 'tab', type: 'function', outputs: 1, func: 'msg.payload *= 2; return msg;', wires: [['out']] }])
    const result = await receive(node, { payload: 20 })
    assert.equal(result.payload, 42)
    assert.equal(helper.getNode('native').type, 'function')
    assert.equal(node.type, 'cerebrum-function')
  })

  it('supports linkcall/return where available and explains the requirement on older runtimes', async () => {
    if (!supportsLinkcall) {
      const node = await load({ func: 'try { await node.linkcall("missing", msg); } catch (error) { msg.payload = error.message; } return msg;' })
      assert.match((await receive(node, {})).payload, /requires Node-RED 5/)
      return
    }
    const node = await load({ func: 'return await node.linkcall("subroutine", msg);' }, [
      { id: 'subroutine', z: 'tab', type: 'link in', wires: [['worker']] },
      { id: 'worker', z: 'tab', type: 'function', outputs: 1, func: 'msg.payload *= 3; return msg;', wires: [['return']] },
      { id: 'return', z: 'tab', type: 'link out', mode: 'return', wires: [] }
    ])
    assert.equal((await receive(node, { payload: 7 })).payload, 21)
  })
})
