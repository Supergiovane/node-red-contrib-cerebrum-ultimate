'use strict'

const {
  REGISTRY_KEY,
  REGISTRY_VERSION,
  getCerebrumAdapterRegistry,
  normalizeCerebrumEvent
} = require('./nodes/utils/adapterRegistry')
const {
  CEREBRUM_INTEGRATION_CONTRACT_VERSION,
  normalizeCerebrumIntegrationManifest,
  validateCerebrumIntegrationAction
} = require('./nodes/utils/cerebrumIntegrationContract')

module.exports = {
  REGISTRY_KEY,
  REGISTRY_VERSION,
  INTEGRATION_CONTRACT_VERSION: CEREBRUM_INTEGRATION_CONTRACT_VERSION,
  getAdapterRegistry: getCerebrumAdapterRegistry,
  normalizeAdapterManifest: normalizeCerebrumIntegrationManifest,
  normalizeEvent: normalizeCerebrumEvent,
  validateAdapterAction: validateCerebrumIntegrationAction
}
