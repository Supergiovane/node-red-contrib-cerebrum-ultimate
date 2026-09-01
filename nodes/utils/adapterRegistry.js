'use strict'

const REGISTRY_VERSION = 1
const REGISTRY_KEY = Symbol.for('node-red.cerebrum-ultimate.adapters.v1')
const MAX_CAPABILITIES = 48

const stripControlCharacters = value => Array.from(String(value)).map(character => {
  const code = character.charCodeAt(0)
  return code <= 31 || code === 127 ? ' ' : character
}).join('')

const text = (value, max = 240) => stripControlCharacters(value === undefined || value === null ? '' : value)
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, max)

const uniqueText = (values, max = MAX_CAPABILITIES) => Array.from(new Set((Array.isArray(values) ? values : [])
  .map(value => text(value, 120))
  .filter(Boolean)))
  .slice(0, max)

const normalizeAdapter = adapter => {
  if (!adapter || typeof adapter !== 'object') throw new Error('Cerebrum adapter must be an object')
  const id = text(adapter.id, 120)
  if (!id) throw new Error('Cerebrum adapter id is required')
  return Object.freeze({
    id,
    title: text(adapter.title || id, 240),
    packageName: text(adapter.packageName, 240),
    capabilities: uniqueText(adapter.capabilities),
    access: text(adapter.access || 'observe', 80)
  })
}

const normalizeProvider = provider => {
  if (!provider || typeof provider !== 'object') throw new Error('Cerebrum provider must be an object')
  const id = text(provider.id, 200)
  const adapterId = text(provider.adapterId, 120)
  if (!id || !adapterId) throw new Error('Cerebrum provider id and adapterId are required')
  return provider
}

const notifySafely = (listeners, event) => {
  listeners.forEach(listener => {
    try { listener(event) } catch (error) { /* a consumer cannot break the registry */ }
  })
}

const createRegistry = () => {
  const registry = {
    version: REGISTRY_VERSION,
    adapters: new Map(),
    providers: new Map(),
    listeners: new Set(),
    registerAdapter (adapter) {
      const normalized = normalizeAdapter(adapter)
      this.adapters.set(normalized.id, normalized)
      notifySafely(this.listeners, { type: 'adapter_registered', adapter: normalized })
      return () => {
        if (this.adapters.get(normalized.id) !== normalized) return false
        this.adapters.delete(normalized.id)
        notifySafely(this.listeners, { type: 'adapter_unregistered', adapter: normalized })
        return true
      }
    },
    registerProvider (provider) {
      const normalized = normalizeProvider(provider)
      this.providers.set(normalized.id, normalized)
      notifySafely(this.listeners, { type: 'provider_registered', provider: normalized })
      return () => this.unregisterProvider(normalized.id, normalized)
    },
    unregisterProvider (providerId, expectedProvider) {
      const id = text(providerId, 200)
      const provider = this.providers.get(id)
      if (!provider || (expectedProvider && provider !== expectedProvider)) return false
      this.providers.delete(id)
      notifySafely(this.listeners, { type: 'provider_unregistered', provider })
      return true
    },
    subscribe (listener) {
      if (typeof listener !== 'function') return () => {}
      this.listeners.add(listener)
      return () => this.listeners.delete(listener)
    },
    snapshot () {
      return {
        version: this.version,
        adapters: Array.from(this.adapters.values()),
        providers: Array.from(this.providers.values()).map(provider => ({
          id: text(provider.id, 200),
          adapterId: text(provider.adapterId, 120),
          title: text(provider.title || provider.id, 240),
          capabilities: uniqueText(provider.capabilities),
          connected: provider.connected !== false
        }))
      }
    }
  }
  return registry
}

const isRegistry = value => value &&
  value.version === REGISTRY_VERSION &&
  value.adapters instanceof Map &&
  value.providers instanceof Map &&
  value.listeners instanceof Set &&
  typeof value.registerAdapter === 'function' &&
  typeof value.registerProvider === 'function'

const getCerebrumAdapterRegistry = () => {
  const current = globalThis[REGISTRY_KEY]
  if (isRegistry(current)) return current
  const registry = createRegistry()
  globalThis[REGISTRY_KEY] = registry
  return registry
}

const normalizeCerebrumEvent = (value, defaults = {}) => {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  const resourceId = text(source.resourceId || source.entityId || source.objectId, 240)
  const eventType = text(source.eventType || source.event || 'state_changed', 120)
  if (!resourceId && !eventType) return null
  let state = source.state !== undefined ? source.state : source.value
  if (state && typeof state === 'object') {
    try { state = JSON.stringify(state) } catch (error) { state = '[unavailable]' }
  }
  return {
    source: text(source.source || defaults.adapterId || 'adapter', 120),
    adapterId: text(source.adapterId || defaults.adapterId, 120),
    providerId: text(source.providerId || defaults.providerId, 200),
    eventType,
    entityId: resourceId,
    resourceId,
    resourceType: text(source.resourceType || source.domain || 'entity', 80),
    resourceName: text(source.resourceName || source.name || resourceId, 240),
    area: text(source.area, 160),
    deviceName: text(source.deviceName, 240),
    state: text(state, 500),
    previousState: text(source.previousState, 500),
    at: text(source.at || new Date().toISOString(), 64),
    readOnly: source.readOnly === true,
    details: source.details && typeof source.details === 'object' && !Array.isArray(source.details)
      ? source.details
      : {}
  }
}

module.exports = {
  REGISTRY_KEY,
  REGISTRY_VERSION,
  getCerebrumAdapterRegistry,
  normalizeAdapter,
  normalizeCerebrumEvent,
  normalizeProvider
}
