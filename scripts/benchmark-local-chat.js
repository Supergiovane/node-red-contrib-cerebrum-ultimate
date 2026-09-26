'use strict'

// Opt-in, isolated chat benchmark. No production flows, files or device outputs.
// Usage: node scripts/benchmark-local-chat.js URL MODEL [CONTEXT_TOKENS]
const { EventEmitter } = require('events')
const fs = require('fs')
const os = require('os')
const path = require('path')
const simpleGet = require('simple-get')

async function main () {
  const [, , endpoint, model, context = '8192'] = process.argv
  if (!endpoint || !model) throw new Error('Supply the chat/completions URL and an already loaded model')
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cerebrum-local-benchmark-'))
  const noop = () => {}
  let Constructor, node
  const originalConcat = simpleGet.concat
  const measurements = []
  // Forward ONLY inference. Never load/unload a model on the shared LAN server.
  simpleGet.concat = (options, callback) => {
    if (String(options.url) !== endpoint) return callback(new Error('Benchmark forbids non-chat HTTP requests'))
    const body = JSON.parse(options.body)
    const started = performance.now()
    fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(120000) })
      .then(async response => {
        const text = await response.text()
        let result
        try { result = JSON.parse(text) } catch (_) { result = {} }
        measurements.push({ milliseconds: Math.round(performance.now() - started), requestBytes: Buffer.byteLength(JSON.stringify(body)), systemBytes: Buffer.byteLength(body.messages[0].content), usage: result.usage, finishReason: result.choices?.[0]?.finish_reason, toolCalls: (result.choices?.[0]?.message?.tool_calls || []).map(call => call.function?.name) })
        if (process.env.CEREBRUM_BENCH_CAPTURE) fs.writeFileSync(process.env.CEREBRUM_BENCH_CAPTURE, JSON.stringify(body, null, 2))
        callback(null, { statusCode: response.status, headers: {} }, Buffer.from(text))
      }).catch(callback)
  }
  try {
    require('../nodes/cerebrumUltimate')({
      auth: { needsPermission: () => noop },
      httpAdmin: { get: noop, post: noop, use: noop },
      settings: { userDir: directory },
      nodes: {
        getNode: noop,
        registerType: (type, value) => { if (type === 'cerebrumUltimate') Constructor = value },
        createNode: target => {
          const emitter = new EventEmitter()
          Object.assign(target, {
            id: 'local-benchmark',
            type: 'cerebrumUltimate',
            credentials: {},
            on: emitter.on.bind(emitter),
            emit: emitter.emit.bind(emitter),
            status: noop,
            warn: noop,
            error: noop,
            log: noop,
            send: outputs => {
              const request = outputs[5]
              if (request?.cerebrum?.direction === 'request') queueMicrotask(() => target.emit('input', { ...request, payload: [] }))
            }
          })
        }
      },
      util: { cloneMessage: value => structuredClone(value) }
    })
    node = new Constructor({ llmEnabled: true, llmProvider: 'lmstudio', llmBaseUrl: endpoint, llmModel: model, llmLocalContextTokens: Number(context), llmContextLength: Number(context), llmMaxTokens: 1200, llmAllowKnxCommands: false, webAccessEnabled: false })
    node._lmStudioContextReadyKey = `${node.llmBaseUrl}\u0000${node.llmModel}\u0000${node.llmLocalContextTokens}`
    node._lmStudioContextReadyAt = Date.now()
    // No effectful automation operations in this harness, including model mistakes.
    node._automationRuntime.save = async () => { throw new Error('Benchmark forbids routine writes') }
    const manage = node._automationRuntime.manage.bind(node._automationRuntime)
    node._automationRuntime.manage = async action => {
      if (!['list', 'get'].includes(action.operation)) throw new Error('Benchmark forbids routine changes')
      return manage(action)
    }
    const questions = process.env.CEREBRUM_BENCH_QUESTION ? [process.env.CEREBRUM_BENCH_QUESTION] : ['Ciao, rispondi brevemente in italiano.', 'Quali routine JavaScript sono salvate? Non crearne e non modificarne nessuna.', 'Vorrei una routine per accendere una luce ogni sera. Quali dettagli ti mancano?']
    for (const question of questions) {
      measurements.length = 0
      const started = performance.now()
      try {
        const result = await node.sidebarAsk(question)
        const valid = !!result.answer && result.metadata?.responseIssue === '' &&
          (!question.startsWith('Quali routine JavaScript') || measurements.some(call => call.toolCalls.includes('automationActions')))
        console.log(JSON.stringify({ question, milliseconds: Math.round(performance.now() - started), valid, answer: result.answer, issue: result.metadata?.responseIssue, calls: measurements }))
        if (!valid) process.exitCode = 1
      } catch (error) { console.log(JSON.stringify({ question, error: error.message, calls: measurements })) }
    }
  } finally {
    if (node) await new Promise(resolve => node.emit('close', resolve))
    simpleGet.concat = originalConcat
    fs.rmSync(directory, { recursive: true, force: true })
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1 })
