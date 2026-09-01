'use strict'

const {
  REGISTRY_KEY,
  REGISTRY_VERSION,
  getCerebrumAdapterRegistry,
  normalizeCerebrumEvent
} = require('./nodes/utils/adapterRegistry')

module.exports = {
  REGISTRY_KEY,
  REGISTRY_VERSION,
  getAdapterRegistry: getCerebrumAdapterRegistry,
  normalizeEvent: normalizeCerebrumEvent
}
