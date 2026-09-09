'use strict'

const isLive = node => !!node && typeof node === 'object' && node._closing !== true

const supportsCapability = (node, capability) => {
  if (!isLive(node)) return false
  if (capability === 'knx') return node.llmAllowKnxCommands === true && !!node.serverKNX
  if (capability === 'proposal') return node.llmEnabled === true
  if (capability === 'autonomy') return node.llmEnabled === true && node.cerebrumAutonomyEnabled === true && node.llmBackgroundMode === 'interval' && !!node._autonomyRuntime
  return true
}

const selectCerebrumCapabilityLeader = (nodes, capability = 'state') => (Array.isArray(nodes)
  ? nodes
  : nodes && typeof nodes[Symbol.iterator] === 'function' ? Array.from(nodes) : [])
  .filter(candidate => supportsCapability(candidate, capability))
  .sort((left, right) => String(left.id || '').localeCompare(String(right.id || '')))[0] || null

const isCerebrumCapabilityLeader = ({ nodes, node, capability = 'state' } = {}) => {
  const leader = selectCerebrumCapabilityLeader(nodes, capability)
  return !leader || leader === node
}

module.exports = {
  isCerebrumCapabilityLeader,
  selectCerebrumCapabilityLeader,
  supportsCerebrumCapability: supportsCapability
}
