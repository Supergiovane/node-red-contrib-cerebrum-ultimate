'use strict'
/* eslint-env mocha */

const assert = require('assert').strict
const fs = require('fs')
const vm = require('vm')
const { EventEmitter } = require('events')
const { createCerebrumFunctionDataSource, createCerebrumFunctionContext, registerCerebrumFunctionDataRoute } = require('../nodes/utils/cerebrumFunctionContext')
const api = require('../resources/CerebrumFunctionApi')

function fixture () {
  const now = Date.parse('2026-09-09T10:00:00Z')
  const catalog = [{ ga: '1/2/3', label: 'Temperatura cucina', dpt: '9.001', readOnly: true, semantic: { area: 'Cucina', kind: 'temperature' }, aliases: ['Termometro'] }]
  const states = [
    { key: 'knx:1/2/3', source: 'knx', objectId: '1/2/3', value: 0, verifiedAt: '2026-09-09T09:59:30Z', changedAt: '2026-09-09T09:58:00Z', refreshIntervalSeconds: 60, privateField: 'hidden' },
    { key: 'knx:7/7/7', source: 'knx', objectId: '7/7/7', value: 'unauthorized' },
    { key: 'ha:light.kitchen', source: 'homeassistant', objectId: 'light.kitchen', value: false }
  ]
  const functions = [{ name: 'comfort.js', status: 'paused', description: 'Comfort cucina', revision: 'revision', path: '/private/file', authority: { secret: 'hidden' } }]
  let reads = 0
  const data = createCerebrumFunctionDataSource({
    info: () => ({ id: 'brain', name: 'Casa', llmEnabled: false }),
    catalog: () => catalog,
    states: () => states,
    functions: () => functions,
    readFunction: name => { reads++; return { ...functions.find(item => item.name === name), content: 'return 42;' } },
    now: () => now
  })
  const node = { id: 'brain', type: 'cerebrumUltimate', functionData: data, credentials: { secret: 'hidden' } }
  return { now, node, data, catalog, states, functions, reads: () => reads }
}

describe('Cerebrum Function read-only data', () => {
  it('reads selected catalog metadata and observed values without exposing internals', () => {
    const f = fixture()
    const context = createCerebrumFunctionContext(() => f.node, 'brain')
    assert.equal(context.available, true)
    assert.equal(context.info().llmEnabled, false)
    const address = context.knx.get('1/2/3')
    assert.equal(address.name, 'Temperatura cucina')
    assert.equal(address.dpt, '9.001')
    assert.equal(address.readOnly, true)
    assert.equal(address.state.value, 0)
    assert.equal(address.state.fresh, true)
    assert.equal(address.state.ageMs, 30000)
    assert.equal(context.states.get('ha:light.kitchen').value, false)
    assert.equal(context.states.get('ha:light.kitchen').fresh, false)
    assert.equal(context.knx.get('9/9/9'), null)
    assert.equal(context.knx.state('9/9/9'), null)
    assert.equal(context.states.get('missing'), null)
    assert.equal(context.knx.find('CUCÍNA termometro').length, 1)
    assert.equal(context.knx.find('bedroom').length, 0)
    assert(!JSON.stringify(context.states.list()).includes('hidden'))
    assert.equal(context.credentials, undefined)
    for (const namespace of [context, context.knx, context.states, context.functions]) assert(Object.isFrozen(namespace))
    assert.equal(context.knx.write, undefined)
    assert.equal(context.functions.run, undefined)
  })

  it('returns isolated copies and immediately applies access revocation to all data views', () => {
    const f = fixture()
    const context = createCerebrumFunctionContext(() => f.node, 'brain')
    context.knx.list()[0].aliases.push('mutation')
    context.knx.get('1/2/3').state.value = 999
    context.functions.list()[0].name = 'mutated'
    assert.equal(f.catalog[0].aliases.length, 1)
    assert.equal(context.knx.state('1/2/3').value, 0)
    f.states[0].value = 21
    assert.equal(context.knx.state('1/2/3').value, 21)
    assert.equal(context.states.get('knx:7/7/7'), null)
    f.catalog.length = 0
    assert.deepEqual(context.knx.list(), [])
    assert.equal(context.knx.get('1/2/3'), null)
    assert.equal(context.knx.state('1/2/3'), null)
    assert.equal(context.states.get('knx:1/2/3'), null)
    assert.equal(context.states.list().length, 1)
    assert.equal(f.data.editorCatalog().states.length, 1)
  })

  it('distinguishes old, changed-after-verification, future and missing evidence', () => {
    const f = fixture()
    f.states[0].verifiedAt = '2026-09-09T09:00:00Z'
    assert.equal(f.data.knx.state('1/2/3').fresh, false)
    f.states[0].verifiedAt = '2026-09-09T09:59:30Z'
    f.states[0].changedAt = '2026-09-09T09:59:50Z'
    assert.equal(f.data.knx.state('1/2/3').fresh, false)
    f.states[0].verifiedAt = '2026-09-09T10:01:00Z'
    assert.equal(f.data.knx.state('1/2/3').fresh, false)
    delete f.states[0].verifiedAt
    assert.equal(f.data.knx.state('1/2/3').ageMs, null)
    assert.equal(f.data.knx.state('1/2/3').fresh, false)
  })

  it('resolves the selected runtime after redeploy and reports an unavailable node clearly', () => {
    let brain = fixture().node
    const context = createCerebrumFunctionContext(id => id === 'brain' && brain, 'brain')
    brain._closing = true
    assert.equal(context.available, false)
    assert.throws(() => context.info(), /Select a deployed Cerebrum/)
    brain = null
    assert.equal(context.available, false)
    brain = fixture().node
    assert.equal(context.info().id, 'brain')
    assert.equal(createCerebrumFunctionContext(() => brain, '').available, false)
    brain.type = 'function'
    assert.equal(context.available, false)
  })

  it('lists automation metadata and only reads source for an explicitly requested existing name', () => {
    const f = fixture()
    const editor = f.data.editorCatalog()
    assert.equal(editor.functions[0].name, 'comfort.js')
    assert.equal(f.reads(), 0)
    assert(!JSON.stringify(editor).includes('private'))
    assert(!Object.hasOwn(editor.states[0], 'value'))
    assert(!Object.hasOwn(editor.groupAddresses[0], 'state'))
    assert.equal(f.data.functions.get('../private.js'), null)
    assert.equal(f.reads(), 0)
    const result = f.data.functions.get('comfort.js')
    assert.equal(result.code, 'return 42;')
    assert.equal(result.path, undefined)
    assert.equal(result.authority, undefined)
    f.functions[0].status = 'deleted'
    assert.equal(f.data.functions.get('comfort.js'), null)
    assert.equal(f.data.functions.list().length, 0)
  })

  it('serves the selected catalog with read permission, no cache and no LLM requirement', () => {
    const f = fixture()
    let handler
    const RED = {
      auth: { needsPermission: permission => { assert.equal(permission, 'cerebrumUltimate.read'); return 'permission middleware' } },
      httpAdmin: { get: (path, permission, fn) => { assert.equal(path, '/cerebrumUltimate/function/catalog'); assert.equal(permission, 'permission middleware'); handler = fn } }
    }
    registerCerebrumFunctionDataRoute(RED, id => id === 'brain' && f.node)
    let code = 200
    let result
    const headers = {}
    const res = { status: value => { code = value; return res }, set: (key, value) => { headers[key] = value }, json: value => { result = value } }
    handler({ query: { cerebrumNode: 'brain' } }, res)
    assert.equal(code, 200)
    assert.equal(result.ok, true)
    assert.equal(result.groupAddresses.length, 1)
    assert.equal(headers['Cache-Control'], 'no-store')
    handler({ query: { cerebrumNode: ['brain'] } }, res)
    assert.equal(code, 404)
    f.node._closing = true
    handler({ query: { cerebrumNode: 'brain' } }, res)
    assert.equal(code, 404)
  })
})

describe('Cerebrum Function code completion', () => {
  it('suggests methods and the selected real addresses, state keys and saved functions', () => {
    const catalog = fixture().data.editorCatalog()
    assert.deepEqual(api.completions('msg.payload = cerebrum.', catalog).items.map(x => x.label), ['available', 'info', 'knx', 'states', 'functions'])
    assert.equal(api.completions('cerebrum.knx.st', catalog).prefix, 'st')
    const address = api.completions('cerebrum.knx.get(\n "cuc', catalog)
    assert.equal(address.prefix, 'cuc')
    assert.match(address.items[0].label, /1\/2\/3.*Temperatura cucina/)
    assert.match(address.items[0].detail, /9\.001.*read-only/)
    assert.equal(address.items[0].insertText, '1/2/3')
    assert.equal(api.completions("cerebrum.states.get('", catalog).items.length, 2)
    assert.equal(api.completions('cerebrum.functions.get("', catalog).items[0].insertText, 'comfort.js')
    assert.equal(api.completions('msg.', catalog), null)
    assert.equal(api.completions('cerebrum.knx.write("', catalog), null)
    assert.equal(api.completions('cerebrum.functions.state("', catalog), null)
  })

  it('escapes catalog strings in declarations and completions, and accepts dynamic runtime IDs', () => {
    const name = 'odd\'"\\\n*/file.js'
    const catalog = { functions: [{ name, description: '*/ malicious declaration' }] }
    const declarations = api.declarations(catalog)
    assert(declarations.includes(JSON.stringify(name)))
    assert(!declarations.includes('malicious declaration'))
    assert(declarations.includes('string & {}'))
    const item = api.completions("cerebrum.functions.get('", catalog).items[0]
    assert.equal(new vm.Script("'" + item.insertText + "'").runInNewContext(), name)
    assert(!api.declarations(fixture().data.editorCatalog()).includes('unauthorized'))
  })

  it('clears previous catalog suggestions on selection changes and disposes libraries and requests on close', () => {
    const requests = []
    const libraries = []
    let provider
    let providerDisposed = false
    const ui = { attr: () => ui, on: () => ui, off: () => ui }
    const jQuery = () => ui
    jQuery.getJSON = (url, query) => {
      const request = { query, abort: () => { request.aborted = true }, done: fn => { request.success = fn; return request }, fail: fn => { request.failure = fn; return request } }
      requests.push(request)
      return request
    }
    const model = { getValueInRange: () => 'cerebrum.knx.get("' }
    const window = {
      monaco: {
        typescript: { javascriptDefaults: { addExtraLib: content => { const lib = { content, dispose: () => { lib.disposed = true } }; libraries.push(lib); return lib } } },
        languages: { CompletionItemKind: {}, registerCompletionItemProvider: (_, value) => { provider = value; return { dispose: () => { providerDisposed = true } } } }
      }
    }
    vm.runInNewContext(fs.readFileSync(require.resolve('../resources/CerebrumFunctionIntellisense'), 'utf8'), { window, jQuery, CerebrumFunctionApi: api })
    const editor = { type: 'monaco', getModel: () => model }
    const service = window.CerebrumFunctionIntellisense.create({ node: { id: 'fn', _: key => key }, editors: [editor] })
    const suggestions = () => provider.provideCompletionItems(model, { lineNumber: 1, column: 18 }).suggestions
    service.setNode('first')
    requests[0].success(fixture().data.editorCatalog())
    assert.equal(suggestions().length, 1)
    service.setNode('second')
    assert.equal(requests[0].aborted, true)
    assert.equal(suggestions().length, 0)
    requests[0].success(fixture().data.editorCatalog())
    assert.equal(suggestions().length, 0)
    assert.equal(provider.provideCompletionItems({}, { lineNumber: 1, column: 1 }).suggestions.length, 0)
    service.dispose()
    assert.equal(requests[1].aborted, true)
    assert.equal(providerDisposed, true)
    assert(libraries.every(lib => lib.disposed))
    requests[1].success(fixture().data.editorCatalog())
    assert.equal(suggestions().length, 0)
  })

  it('opens Ace completion after a dot or quote and restores the native editor on close', () => {
    const ui = { attr: () => ui, on: () => ui, off: () => ui }
    const window = {}
    vm.runInNewContext(fs.readFileSync(require.resolve('../resources/CerebrumFunctionIntellisense'), 'utf8'), { window, jQuery: () => ui, CerebrumFunctionApi: api })
    const native = [{ native: true }]
    const commands = new EventEmitter()
    let line = 'cerebrum.'
    let live = false
    let triggered = 0
    const editor = {
      type: 'ace',
      completers: native,
      commands,
      getOption: () => live,
      setOption: (_, value) => { live = value },
      getCursorPosition: () => ({ row: 0, column: line.length }),
      getSession: () => ({ getLines: () => [line] }),
      execCommand: name => { assert.equal(name, 'startAutocomplete'); triggered++ }
    }
    const service = window.CerebrumFunctionIntellisense.create({ node: { id: 'fn', _: key => key }, editors: [editor] })
    assert.equal(live, true)
    assert.equal(editor.completers.length, 2)
    const insert = args => commands.emit('afterExec', { command: { name: 'insertstring' }, args })
    insert('.')
    line = 'cerebrum.knx.get("'
    insert('"')
    line = 'msg.'
    insert('.')
    assert.equal(triggered, 2)
    service.dispose()
    assert.equal(live, false)
    assert.equal(editor.completers, native)
    assert.equal(commands.listenerCount('afterExec'), 0)
  })
})
