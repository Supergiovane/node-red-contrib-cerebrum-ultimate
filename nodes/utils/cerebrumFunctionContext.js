'use strict'

const copy = value => value === undefined ? null : JSON.parse(JSON.stringify(value))
const text = value => String(value || '')
const fields = (value, keys) => Object.fromEntries(keys.map(key => [key, value[key] ?? null]))
const searchText = value => text(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
const stateFields = ['key', 'source', 'objectId', 'label', 'area', 'kind', 'value', 'previousValue', 'observedAt', 'verifiedAt', 'changedAt', 'refreshIntervalSeconds']
const functionFields = ['name', 'status', 'description', 'revision', 'lastRunAt', 'error']

// This facade exposes copies of selected catalog objects and observed data, never
// the Cerebrum runtime, credentials, file paths or device-command methods.
function createCerebrumFunctionDataSource ({ info, catalog, states, functions, readFunction, now = Date.now }) {
  const selected = () => new Map(catalog().map(item => [text(item.ga), item]))
  const describeAddress = item => ({
    address: text(item.ga),
    name: text(item.label || item.etsName || item.ga),
    dpt: text(item.dpt),
    readOnly: item.readOnly === true,
    area: text(item.semantic?.area || item.area),
    kind: text(item.semantic?.kind),
    aliases: Array.isArray(item.aliases) ? item.aliases.map(text) : []
  })
  const visibleStates = () => {
    const allowed = selected()
    return states().filter(state => state.source !== 'knx' && !text(state.key).startsWith('knx:') ? true : allowed.has(text(state.objectId || text(state.key).slice(4))))
  }
  const describeState = state => {
    if (!state) return null
    const verified = Date.parse(state.verifiedAt || '')
    const changed = Date.parse(state.changedAt || state.verifiedAt || '')
    const ageMs = Number.isFinite(verified) ? Math.max(0, now() - verified) : null
    return { ...fields(state, stateFields), fresh: ageMs !== null && verified <= now() && verified >= changed && ageMs <= Math.max(60, Number(state.refreshIntervalSeconds) || 10800) * 1000, ageMs }
  }
  const findState = key => describeState(visibleStates().find(state => state.key === key))
  const getAddress = address => {
    const item = selected().get(text(address))
    return item ? { ...describeAddress(item), state: findState(`knx:${item.ga}`) } : null
  }
  const listAddresses = () => {
    const byKey = new Map(visibleStates().map(state => [state.key, state]))
    return [...selected().values()].map(item => ({ ...describeAddress(item), state: describeState(byKey.get(`knx:${item.ga}`)) }))
  }
  const listFunctions = () => functions().filter(item => item.status !== 'deleted').map(item => fields(item, functionFields))
  return {
    info: () => copy(info()),
    knx: {
      list: () => copy(listAddresses()),
      get: address => copy(getAddress(address)),
      find: query => {
        const terms = searchText(query).split(/\s+/).filter(Boolean)
        return copy(listAddresses().filter(item => terms.every(term => searchText([item.address, item.name, item.area, item.kind, ...item.aliases].join(' ')).includes(term))))
      },
      state: address => copy(getAddress(address)?.state || null)
    },
    states: {
      list: () => copy(visibleStates().map(describeState)),
      get: key => copy(findState(text(key)))
    },
    functions: {
      list: () => copy(listFunctions()),
      get: name => {
        if (!listFunctions().some(item => item.name === name)) return null
        const file = readFunction(name)
        return copy({ ...fields(file, functionFields), code: text(file.content) })
      }
    },
    editorCatalog: () => copy({
      info: info(),
      groupAddresses: [...selected().values()].map(describeAddress),
      states: visibleStates().map(state => fields(state, ['key', 'source', 'objectId', 'label', 'area', 'kind'])),
      functions: listFunctions()
    })
  }
}

function createCerebrumFunctionContext (getNode, nodeId) {
  const resolve = () => {
    const node = nodeId && getNode(nodeId)
    return node && node.type === 'cerebrumUltimate' && !node._closing && node.functionData ? node.functionData : null
  }
  const requireData = () => {
    const data = resolve()
    if (!data) throw new Error('Cerebrum data is unavailable. Select a deployed Cerebrum node in the Setup tab.')
    return data
  }
  const namespace = (name, methods) => Object.freeze(Object.fromEntries(methods.map(method => [method, (...args) => copy(requireData()[name][method](...args))])))
  return Object.freeze({
    get available () { return !!resolve() },
    info: () => copy(requireData().info()),
    knx: namespace('knx', ['list', 'get', 'find', 'state']),
    states: namespace('states', ['list', 'get']),
    functions: namespace('functions', ['list', 'get'])
  })
}

function registerCerebrumFunctionDataRoute (RED, getNode) {
  RED.httpAdmin.get('/cerebrumUltimate/function/catalog', RED.auth.needsPermission('cerebrumUltimate.read'), (req, res) => {
    try {
      const node = typeof req.query.cerebrumNode === 'string' && getNode(req.query.cerebrumNode)
      if (!node || node.type !== 'cerebrumUltimate' || node._closing || !node.functionData) return res.status(404).json({ error: 'Select a deployed Cerebrum node' })
      res.set('Cache-Control', 'no-store')
      res.json({ ok: true, ...node.functionData.editorCatalog() })
    } catch (error) { res.status(500).json({ error: error.message || String(error) }) }
  })
}

module.exports = { createCerebrumFunctionDataSource, createCerebrumFunctionContext, registerCerebrumFunctionDataRoute }
