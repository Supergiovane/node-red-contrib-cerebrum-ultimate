'use strict'

const crypto = require('crypto')

const fingerprint = value => crypto.createHash('sha256').update(JSON.stringify(value, (key, item) => {
  if (key === 'reason') return undefined
  return item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([left], [right]) => left.localeCompare(right)))
    : item
})).digest('hex')
const withoutReason = actions => actions.map(({ reason, ...action }) => action)

// Detect repeated transitions, not a fixed number of model/tool calls. Revisiting
// an earlier page after acquiring other evidence is useful; cycling through the
// same pages with unchanged evidence is not. Actual changed results remain usable.
function createCerebrumReasoningProgress () {
  const transitions = new Set()
  let previous = ''
  return (tool, actions, evidence) => {
    const current = fingerprint({ tool, actions: withoutReason(actions), evidence })
    const transition = `${previous}:${current}`
    const progressed = current !== previous && !transitions.has(transition)
    transitions.add(transition)
    previous = current
    return progressed
  }
}

// Complete records only, newest first in the prompt. The archive and the caller's
// evidence store retain everything; this is just a replaceable working view.
function selectCerebrumReasoningResults (results, byteBudget) {
  const selected = []
  let bytes = 2
  for (const result of (results || []).slice().reverse()) {
    const size = Buffer.byteLength(JSON.stringify(result)) + 1
    if (bytes + size > byteBudget) continue
    selected.push(result)
    bytes += size
  }
  return { results: selected, omitted: (results || []).length - selected.length }
}

module.exports = { createCerebrumReasoningProgress, selectCerebrumReasoningResults }
