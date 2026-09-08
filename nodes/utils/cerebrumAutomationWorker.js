'use strict'

// No Node objects/functions cross the WASM boundary. All effects are returned as
// data and checked by the host after the interpreter has finished successfully.
const { parentPort } = require('worker_threads')
const { getQuickJS } = require('quickjs-emscripten')

function guest (input, register) {
  const handlers = Object.create(null)
  const registrations = []
  const effects = []
  let running = false
  let description = ''
  let targets = []
  const add = (id, kind, options, fn) => {
    if (running || typeof id !== 'string' || !id || handlers[id] || typeof fn !== 'function') throw Error('Invalid or duplicate handler')
    handlers[id] = fn
    registrations.push({ id, kind, ...options })
  }
  const effect = (kind, data) => {
    if (!running) throw Error('Effects are only allowed inside handlers')
    if (effects.length >= 20) throw Error('Too many effects in one invocation')
    effects.push({ kind, ...data })
  }
  const api = Object.freeze({
    describe: text => { if (running) throw Error('Registration is closed'); description = String(text) },
    targets: ids => { if (running) throw Error('Registration is closed'); targets = ids },
    now: () => input.now,
    onState: (id, entityIds, fn) => add(id, 'state', { entityIds }, fn),
    onEvent: (id, filter, fn) => add(id, 'event', { filter }, fn),
    schedule: Object.freeze({
      daily: (id, options, fn) => add(id, 'daily', options, fn),
      every: (id, milliseconds, fn) => add(id, 'every', { milliseconds }, fn),
      at: (id, timestamp, fn) => add(id, 'at', { timestamp }, fn)
    }),
    timers: Object.freeze({
      define: (id, fn) => add(id, 'timer', {}, fn),
      ensureAt: (id, timestamp) => effect('timer', { id, timestamp }),
      cancel: id => effect('cancelTimer', { id })
    }),
    state: Object.freeze({ get: id => input.states[id] || null }),
    memory: Object.freeze({
      get: key => Object.prototype.hasOwnProperty.call(input.memory, key) ? input.memory[key] : null,
      set: (key, value) => { effect('memory', { key, value }); input.memory[key] = value }
    }),
    notify: text => effect('notify', { text }),
    speak: text => effect('speak', { text }),
    assistant: Object.freeze({ run: instruction => effect('assistant', { instruction }) }),
    actions: Object.freeze({ write: (entityId, value) => effect('write', { entityId, value }) })
  })
  const synchronous = value => { if (value && typeof value.then === 'function') throw Error('Automation handlers must be synchronous') }
  if (typeof register !== 'function') throw Error('Export a register function with module.exports')
  synchronous(register(api))
  if (input.handler) {
    if (!handlers[input.handler]) throw Error('Handler no longer exists')
    running = true
    synchronous(handlers[input.handler](input.event || {}))
  }
  return JSON.stringify({ description, targets, registrations, effects })
}

parentPort.on('message', async ({ id, source, input }) => {
  let runtime
  let context
  try {
    const engine = await getQuickJS()
    runtime = engine.newRuntime()
    runtime.setMemoryLimit(16 * 1024 * 1024)
    runtime.setMaxStackSize(512 * 1024)
    const deadline = Date.now() + 250
    runtime.setInterruptHandler(() => Date.now() > deadline)
    context = runtime.newContext()
    const value = context.newString(JSON.stringify(input))
    context.setProp(context.global, '__input', value)
    value.dispose()
    const result = context.evalCode(`(${guest.toString()})(JSON.parse(__input), (function () { const module = { exports: {} };\n${source}\n; return module.exports })())`, 'automation.js')
    try {
      if (result.error) throw Error(context.dump(result.error)?.message || 'JavaScript execution failed')
      const output = context.getString(result.value)
      if (Buffer.byteLength(output) > 64 * 1024) throw Error('Automation result exceeds 64 KiB')
      parentPort.postMessage({ id, result: JSON.parse(output) })
    } finally { (result.error || result.value).dispose() }
  } catch (error) { parentPort.postMessage({ id, error: String(error.message || error) }) } finally {
    context?.dispose()
    runtime?.dispose()
  }
})
