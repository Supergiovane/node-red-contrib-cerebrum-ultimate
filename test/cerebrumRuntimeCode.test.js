/* global describe, it */
const { expect } = require('chai')
const {
  CEREBRUM_CODE_MAX_SOURCE_CHARS,
  executeCerebrumRuntimeCode,
  normalizeCerebrumCodeActions,
  normalizeRuntimeCodeResult
} = require('../nodes/utils/cerebrumRuntimeCode')
const { parseCerebrumConversationResponse } = require('../nodes/cerebrumUltimate').__test

describe('Cerebrum privileged runtime JavaScript tool', function () {
  it('normalizes one bounded run action', function () {
    const normalized = normalizeCerebrumCodeActions([
      { operation: 'run', code: 'return node.id', reason: 'inspect the current node' },
      { operation: 'run', code: 'return 2', reason: 'ignored by the one-action limit' }
    ])
    expect(normalized.rejected).to.deep.equal([])
    expect(normalized.accepted).to.deep.equal([
      { operation: 'run', code: 'return node.id', reason: 'inspect the current node' }
    ])
  })

  it('parses JavaScript actions from the structured LLM response', function () {
    const envelope = parseCerebrumConversationResponse(JSON.stringify({
      reply: '',
      code_actions: [{ operation: 'run', code: 'return node.id', reason: 'inspect runtime' }]
    }))
    expect(envelope.codeActions).to.deep.equal([
      { operation: 'run', code: 'return node.id', reason: 'inspect runtime' }
    ])
  })

  it('rejects empty and oversized source', function () {
    expect(normalizeCerebrumCodeActions([{ operation: 'run', code: '' }]).rejected[0].reason).to.equal('JavaScript source is empty')
    expect(normalizeCerebrumCodeActions([{ operation: 'run', code: 'x'.repeat(CEREBRUM_CODE_MAX_SOURCE_CHARS + 1) }]).rejected[0].reason).to.include('exceeds')
  })

  it('runs synchronously with direct access to node and RED', function () {
    const flowNodes = [
      { id: 'a', type: 'inject', name: 'Trigger' },
      { id: 'b', type: 'function', name: 'Logic' }
    ]
    const node = {
      id: 'cerebrum-1',
      context: () => ({ get: key => key === 'mode' ? 'home' : undefined })
    }
    const RED = {
      nodes: {
        eachNode: callback => flowNodes.forEach(callback),
        getNode: id => flowNodes.find(item => item.id === id)
      }
    }
    const execution = executeCerebrumRuntimeCode({
      action: {
        operation: 'run',
        code: [
          'const nodes = []',
          'RED.nodes.eachNode(item => nodes.push({ id: item.id, type: item.type }))',
          'return { currentNode: node.id, mode: node.context().get("mode"), nodes, selected: RED.nodes.getNode("b").name, question, sessionId }'
        ].join('\n'),
        reason: 'inspect the deployed runtime'
      },
      node,
      RED,
      question: 'What is deployed?',
      sessionId: 'chat-1'
    })
    expect(execution.ok).to.equal(true)
    expect(execution.result).to.deep.equal({
      currentNode: 'cerebrum-1',
      mode: 'home',
      nodes: [
        { id: 'a', type: 'inject' },
        { id: 'b', type: 'function' }
      ],
      selected: 'Logic',
      question: 'What is deployed?',
      sessionId: 'chat-1'
    })
  })

  it('stops synchronous infinite loops', function () {
    const execution = executeCerebrumRuntimeCode({
      action: { operation: 'run', code: 'while (true) {}', reason: 'timeout test' },
      node: {},
      RED: {},
      timeoutMs: 25
    })
    expect(execution.ok).to.equal(false)
    expect(execution.error).to.match(/timed out/i)
  })

  it('rejects asynchronous results and dynamic code generation', function () {
    const asyncExecution = executeCerebrumRuntimeCode({
      action: { operation: 'run', code: 'return Promise.resolve(1)', reason: 'async test' },
      node: {},
      RED: {}
    })
    expect(asyncExecution.ok).to.equal(false)
    expect(asyncExecution.error).to.include('Asynchronous JavaScript is not supported')

    const dynamicExecution = executeCerebrumRuntimeCode({
      action: { operation: 'run', code: 'return Function("return 1")()', reason: 'dynamic test' },
      node: {},
      RED: {}
    })
    expect(dynamicExecution.ok).to.equal(false)
    expect(dynamicExecution.error).to.match(/code generation|strings disallowed/i)
  })

  it('bounds returned data and omits obvious credential fields', function () {
    const normalized = normalizeRuntimeCodeResult({
      name: 'safe',
      apiKey: 'hidden',
      nested: { password: 'hidden', value: 42 },
      binary: Buffer.alloc(12)
    })
    expect(normalized).to.deep.equal({
      name: 'safe',
      nested: { value: 42 },
      binary: '[Buffer 12 bytes omitted]'
    })

    const execution = executeCerebrumRuntimeCode({
      action: {
        operation: 'run',
        code: 'return Array.from({ length: 200 }, (_, index) => ({ index, text: "x".repeat(8000) }))',
        reason: 'oversized result test'
      },
      node: {},
      RED: {},
      maxOutputBytes: 1024
    })
    expect(execution.ok).to.equal(false)
    expect(execution.error).to.include('result exceeds')
  })
})
