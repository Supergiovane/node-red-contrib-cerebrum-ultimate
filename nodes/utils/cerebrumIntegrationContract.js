'use strict'

const CEREBRUM_INTEGRATION_CONTRACT_VERSION = 1
const CEREBRUM_INTEGRATION_MAX_OPERATIONS = 32
const CEREBRUM_INTEGRATION_SCHEMA_MAX_BYTES = 12000

const text = (value, max = 240) => Array.from(String(value === undefined || value === null ? '' : value))
  .map(character => {
    const code = character.charCodeAt(0)
    return code <= 31 || code === 127 ? ' ' : character
  })
  .join('')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, max)

const uniqueText = (value, max = 48) => Array.from(new Set((Array.isArray(value) ? value : [value])
  .map(item => text(item, 160))
  .filter(Boolean)))
  .slice(0, max)

const objectIdSchema = Object.freeze({ type: 'string', minLength: 1, maxLength: 240 })

const STANDARD_OPERATIONS = Object.freeze({
  events: Object.freeze({
    id: 'events',
    method: 'subscribe',
    effect: 'observe',
    requiresAuthorization: false,
    requiresConfirmation: false,
    schema: Object.freeze({ type: 'object', additionalProperties: false, properties: {} })
  }),
  'list-entities': Object.freeze({
    id: 'list-entities',
    method: 'listEntities',
    effect: 'read',
    requiresAuthorization: false,
    requiresConfirmation: false,
    schema: Object.freeze({ type: 'object', additionalProperties: false, properties: { force: { type: 'boolean' } } })
  }),
  'read-entity': Object.freeze({
    id: 'read-entity',
    method: 'getEntity',
    effect: 'read',
    requiresAuthorization: false,
    requiresConfirmation: false,
    schema: Object.freeze({ type: 'object', additionalProperties: false, properties: { objectId: objectIdSchema }, required: ['objectId'] })
  }),
  'list-services': Object.freeze({
    id: 'list-services',
    method: 'listServices',
    effect: 'read',
    requiresAuthorization: false,
    requiresConfirmation: false,
    schema: Object.freeze({ type: 'object', additionalProperties: false, properties: {} })
  }),
  'write-entity': Object.freeze({
    id: 'write-entity',
    method: 'callService',
    effect: 'write',
    requiresAuthorization: true,
    requiresConfirmation: true,
    schema: Object.freeze({
      type: 'object',
      additionalProperties: false,
      properties: {
        objectId: objectIdSchema,
        operation: { type: 'string', minLength: 1, maxLength: 120 },
        value: { type: ['string', 'number', 'boolean', 'null'] }
      },
      required: ['objectId', 'operation']
    })
  }),
  'list-cameras': Object.freeze({
    id: 'list-cameras',
    method: 'listCameras',
    effect: 'read',
    requiresAuthorization: false,
    requiresConfirmation: false,
    schema: Object.freeze({ type: 'object', additionalProperties: false, properties: { force: { type: 'boolean' } } })
  }),
  'camera-snapshot': Object.freeze({
    id: 'camera-snapshot',
    method: 'takeSnapshot',
    effect: 'read',
    requiresAuthorization: false,
    requiresConfirmation: false,
    schema: Object.freeze({
      type: 'object',
      additionalProperties: false,
      properties: { cameraId: objectIdSchema, highQuality: { type: 'boolean' } },
      required: ['cameraId']
    })
  }),
  'query-camera-events': Object.freeze({
    id: 'query-camera-events',
    method: 'queryEvents',
    effect: 'read',
    requiresAuthorization: false,
    requiresConfirmation: false,
    schema: Object.freeze({
      type: 'object',
      additionalProperties: false,
      properties: {
        cameraId: objectIdSchema,
        eventTypes: { type: 'array', maxItems: 12 },
        objectTypes: { type: 'array', maxItems: 12 },
        from: { type: 'string', maxLength: 80 },
        to: { type: 'string', maxLength: 80 },
        offset: { type: 'integer', minimum: 0 },
        limit: { type: 'integer', minimum: 1, maximum: 100 }
      }
    })
  }),
  'camera-event-snapshot': Object.freeze({
    id: 'camera-event-snapshot',
    method: 'takeEventSnapshot',
    effect: 'read',
    requiresAuthorization: false,
    requiresConfirmation: false,
    schema: Object.freeze({
      type: 'object',
      additionalProperties: false,
      properties: {
        eventId: objectIdSchema,
        cameraId: objectIdSchema
      },
      required: ['eventId']
    })
  })
})

const cloneSchema = value => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  try {
    const serialized = JSON.stringify(value)
    if (Buffer.byteLength(serialized, 'utf8') > CEREBRUM_INTEGRATION_SCHEMA_MAX_BYTES) return null
    return JSON.parse(serialized)
  } catch (error) {
    return null
  }
}

const normalizeCerebrumIntegrationOperation = value => {
  const source = typeof value === 'string' ? { id: value } : value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  const id = text(source.id || source.operation, 120)
  const standard = STANDARD_OPERATIONS[id]
  const method = text(source.method || (standard && standard.method), 120)
  if (!id || !method) return null
  const effect = ['observe', 'read', 'write'].includes(source.effect)
    ? source.effect
    : (standard && standard.effect) || 'read'
  const schema = cloneSchema(source.schema) || cloneSchema(standard && standard.schema) || { type: 'object', additionalProperties: false, properties: {} }
  return {
    id,
    method,
    effect,
    requiresAuthorization: effect === 'write' || source.requiresAuthorization === true || !!(standard && standard.requiresAuthorization),
    requiresConfirmation: effect === 'write' || source.requiresConfirmation === true || !!(standard && standard.requiresConfirmation),
    schema
  }
}

const normalizeCerebrumIntegrationManifest = (value, { kind = 'home-automation' } = {}) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Cerebrum adapter must be an object')
  const id = text(value.id, 120)
  if (!id) throw new Error('Cerebrum adapter id is required')
  const operations = []
  const seen = new Set()
  ;(Array.isArray(value.operations) ? value.operations : []).forEach(candidate => {
    const operation = normalizeCerebrumIntegrationOperation(candidate)
    if (!operation || seen.has(operation.id) || operations.length >= CEREBRUM_INTEGRATION_MAX_OPERATIONS) return
    operations.push(operation)
    seen.add(operation.id)
  })
  return {
    contractVersion: CEREBRUM_INTEGRATION_CONTRACT_VERSION,
    id,
    title: text(value.title || id, 240),
    packageName: text(value.packageName, 240),
    kind: text(value.kind || kind, 120),
    capabilities: uniqueText(value.capabilities),
    access: text(value.access || 'observe', 80),
    operations
  }
}

const readProviderValue = (provider, key) => {
  try { return provider[key] } catch (error) { return undefined }
}

const inferCerebrumProviderOperations = (provider, manifest) => {
  const candidates = [
    ...Object.values(STANDARD_OPERATIONS).filter(operation => typeof readProviderValue(provider, operation.method) === 'function'),
    ...((manifest && manifest.operations) || []).filter(operation => typeof readProviderValue(provider, operation.method) === 'function')
  ]
  const seen = new Set()
  return candidates.map(normalizeCerebrumIntegrationOperation).filter(operation => {
    if (!operation || seen.has(operation.id)) return false
    seen.add(operation.id)
    return true
  }).slice(0, CEREBRUM_INTEGRATION_MAX_OPERATIONS)
}

const normalizeHealthStatus = value => {
  const status = text(value, 40).toLowerCase()
  if (['healthy', 'ready', 'ok', 'online', 'connected'].includes(status)) return 'healthy'
  if (['degraded', 'warning', 'stale'].includes(status)) return 'degraded'
  if (['unavailable', 'error', 'offline', 'disconnected', 'failed'].includes(status)) return 'unavailable'
  return ''
}

const inspectCerebrumIntegrationProvider = ({ provider, manifest, kind = 'home-automation' } = {}) => {
  if (!provider || typeof provider !== 'object' || Array.isArray(provider)) return null
  const id = text(readProviderValue(provider, 'id'), 200)
  const adapterId = text(readProviderValue(provider, 'adapterId') || (manifest && manifest.id), 120)
  if (!id || !adapterId) return null
  const operations = inferCerebrumProviderOperations(provider, manifest)
  const connected = readProviderValue(provider, 'connected') !== false
  const declaredReady = readProviderValue(provider, 'ready')
  const readinessCheck = readProviderValue(provider, 'isReady')
  let ready = connected
  if (typeof declaredReady === 'boolean') ready = connected && declaredReady
  if (typeof readinessCheck === 'function') {
    try { ready = connected && readinessCheck.call(provider) === true } catch (error) { ready = false }
  }
  const providerHealth = readProviderValue(provider, 'health')
  const declaredHealth = providerHealth && typeof providerHealth === 'object' && !Array.isArray(providerHealth)
    ? normalizeHealthStatus(readProviderValue(providerHealth, 'status'))
    : normalizeHealthStatus(readProviderValue(provider, 'healthStatus'))
  const reportedError = !!(readProviderValue(provider, 'lastError') || readProviderValue(provider, 'error'))
  const reasons = []
  if (!connected) reasons.push('provider_disconnected')
  if (!ready) reasons.push('provider_not_ready')
  if (!operations.length) reasons.push('no_supported_operations')
  if (reportedError || declaredHealth === 'unavailable') reasons.push('provider_reported_error')
  const health = !connected || !ready || !operations.length || declaredHealth === 'unavailable'
    ? 'unavailable'
    : declaredHealth === 'degraded' || reportedError ? 'degraded' : 'healthy'
  const lastSeen = new Date(readProviderValue(provider, 'lastSeenAt') || (providerHealth && readProviderValue(providerHealth, 'checkedAt')) || '')
  return {
    contractVersion: CEREBRUM_INTEGRATION_CONTRACT_VERSION,
    id,
    adapterId,
    title: text(readProviderValue(provider, 'title') || readProviderValue(provider, 'name') || id, 240),
    kind: text((manifest && manifest.kind) || kind, 120),
    connected,
    ready,
    usable: connected && ready && operations.length > 0,
    health,
    healthReasons: uniqueText(reasons, 12),
    lastSeenAt: Number.isNaN(lastSeen.getTime()) ? '' : lastSeen.toISOString(),
    capabilities: uniqueText([...(manifest && manifest.capabilities ? manifest.capabilities : []), ...uniqueText(readProviderValue(provider, 'capabilities')), ...operations.map(operation => operation.id)]),
    operations
  }
}

const inspectCerebrumIntegrationRegistry = (registry, { kind = 'home-automation' } = {}) => {
  const source = registry && typeof registry === 'object' ? registry : {}
  const manifests = new Map()
  Array.from(source.adapters instanceof Map ? source.adapters.values() : []).forEach(adapter => {
    try {
      const manifest = normalizeCerebrumIntegrationManifest(adapter, { kind })
      manifests.set(manifest.id, manifest)
    } catch (error) { /* malformed third-party manifests stay isolated */ }
  })
  const providers = Array.from(source.providers instanceof Map ? source.providers.values() : [])
    .map(provider => {
      try {
        return inspectCerebrumIntegrationProvider({ provider, manifest: manifests.get(text(readProviderValue(provider, 'adapterId'), 120)), kind })
      } catch (error) { return null }
    })
    .filter(Boolean)
  return {
    contractVersion: CEREBRUM_INTEGRATION_CONTRACT_VERSION,
    adapters: Array.from(manifests.values()),
    providers
  }
}

const valueMatchesType = (value, type) => {
  if (type === 'null') return value === null
  if (type === 'array') return Array.isArray(value)
  if (type === 'object') return !!value && typeof value === 'object' && !Array.isArray(value)
  if (type === 'integer') return Number.isInteger(value)
  if (type === 'undefined') return typeof value === 'undefined'
  if (type === 'boolean') return typeof value === 'boolean'
  if (type === 'number') return typeof value === 'number'
  if (type === 'string') return typeof value === 'string'
  if (type === 'bigint') return typeof value === 'bigint'
  if (type === 'symbol') return typeof value === 'symbol'
  if (type === 'function') return typeof value === 'function'
  return false
}

const validateCerebrumIntegrationAction = ({ operation, payload } = {}) => {
  const normalized = normalizeCerebrumIntegrationOperation(operation)
  if (!normalized) return { ok: false, errors: ['invalid_operation'] }
  const schema = normalized.schema || {}
  const value = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {}
  const errors = []
  ;(Array.isArray(schema.required) ? schema.required : []).forEach(key => {
    if (!Object.prototype.hasOwnProperty.call(value, key)) errors.push(`missing:${text(key, 120)}`)
  })
  if (schema.additionalProperties === false) {
    Object.keys(value).forEach(key => {
      if (!schema.properties || !Object.prototype.hasOwnProperty.call(schema.properties, key)) errors.push(`unknown:${text(key, 120)}`)
    })
  }
  Object.entries(schema.properties || {}).forEach(([key, definition]) => {
    if (!Object.prototype.hasOwnProperty.call(value, key) || !definition || typeof definition !== 'object') return
    const expectedTypes = Array.isArray(definition.type) ? definition.type : [definition.type]
    if (expectedTypes[0] && !expectedTypes.some(type => valueMatchesType(value[key], type))) {
      errors.push(`type:${text(key, 120)}`)
      return
    }
    if (typeof value[key] === 'string' && Number.isFinite(Number(definition.minLength)) && value[key].length < Number(definition.minLength)) errors.push(`minLength:${text(key, 120)}`)
    if (typeof value[key] === 'string' && Number.isFinite(Number(definition.maxLength)) && value[key].length > Number(definition.maxLength)) errors.push(`maxLength:${text(key, 120)}`)
    if (Array.isArray(definition.enum) && !definition.enum.includes(value[key])) errors.push(`enum:${text(key, 120)}`)
  })
  return { ok: errors.length === 0, operation: normalized, payload: value, errors }
}

module.exports = {
  CEREBRUM_INTEGRATION_CONTRACT_VERSION,
  CEREBRUM_INTEGRATION_MAX_OPERATIONS,
  STANDARD_OPERATIONS,
  inferCerebrumProviderOperations,
  inspectCerebrumIntegrationProvider,
  inspectCerebrumIntegrationRegistry,
  normalizeCerebrumIntegrationManifest,
  normalizeCerebrumIntegrationOperation,
  validateCerebrumIntegrationAction
}
