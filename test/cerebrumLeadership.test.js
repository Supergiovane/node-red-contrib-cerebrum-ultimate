const { expect } = require('chai')

/* global describe, it */

const {
  isCerebrumCapabilityLeader,
  selectCerebrumCapabilityLeader
} = require('../nodes/utils/cerebrumLeadership')

describe('Cerebrum shared capability leadership', () => {
  const nodes = () => [
    { id: 'b', llmEnabled: true, llmAllowKnxCommands: true, serverKNX: {}, cerebrumAutonomyEnabled: true, llmBackgroundMode: 'interval', _autonomyRuntime: {} },
    { id: 'a', llmEnabled: true, llmAllowKnxCommands: false, cerebrumAutonomyEnabled: true, llmBackgroundMode: 'chat' },
    { id: 'c', llmEnabled: true, llmAllowKnxCommands: true, serverKNX: {}, cerebrumAutonomyEnabled: true, llmBackgroundMode: 'interval', _autonomyRuntime: {}, _closing: true }
  ]

  it('elects one stable live leader per actual capability', () => {
    const candidates = nodes()
    expect(selectCerebrumCapabilityLeader(candidates, 'state').id).to.equal('a')
    expect(selectCerebrumCapabilityLeader(candidates, 'proposal').id).to.equal('a')
    expect(selectCerebrumCapabilityLeader(candidates, 'knx').id).to.equal('b')
    expect(selectCerebrumCapabilityLeader(candidates, 'autonomy').id).to.equal('b')
  })

  it('fails over when the selected node closes', () => {
    const candidates = nodes()
    expect(isCerebrumCapabilityLeader({ nodes: candidates, node: candidates[1], capability: 'state' })).to.equal(true)
    candidates[1]._closing = true
    expect(isCerebrumCapabilityLeader({ nodes: candidates, node: candidates[0], capability: 'state' })).to.equal(true)
  })
})
