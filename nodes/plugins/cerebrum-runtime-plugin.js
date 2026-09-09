const {
  getCerebrumHomeAutomationRegistry,
  normalizeCerebrumFlowSendEvent
} = require('../utils/cerebrumLearning')
const {
  hasCerebrumTransientMessageOrigin,
  rememberCerebrumTransientMessageOrigin
} = require('../utils/cerebrumTransientMessageOrigins')

const HOOK_ID = 'onSend.cerebrumUltimate'
const PROVIDER_ID = 'cerebrum-ultimate:runtime'
const ADAPTER_ID = 'node-red-flow'
const DUPLICATE_WINDOW_MS = 750
const MAX_EVENTS_PER_MINUTE = 240
const UNIFI_PROTECT_NODE_TYPE_RE = /^unifi-protect(?:-|$)/

module.exports = RED => {
  const listeners = new Set()
  const recentFingerprints = new Map()
  const unifiProtectMessages = new WeakSet()
  let eventWindowStartedAt = Date.now()
  let eventWindowCount = 0

  const provider = {
    id: PROVIDER_ID,
    adapterId: ADAPTER_ID,
    title: 'Node-RED flow observer',
    subscribe (listener) {
      if (typeof listener !== 'function') return () => {}
      listeners.add(listener)
      return () => listeners.delete(listener)
    }
  }

  const refreshEventWindow = now => {
    if ((now - eventWindowStartedAt) >= 60 * 1000) {
      eventWindowStartedAt = now
      eventWindowCount = 0
      recentFingerprints.clear()
    }
  }

  const rememberUnifiProtectOrigin = (message, messageId, now) => {
    if (message && typeof message === 'object') unifiProtectMessages.add(message)
    rememberCerebrumTransientMessageOrigin({ messageId, source: 'unifi-protect', at: now })
  }

  const isUnifiProtectFlowEvent = (sendEvent, now) => {
    const envelope = sendEvent && typeof sendEvent === 'object' ? sendEvent : {}
    const message = envelope.msg && typeof envelope.msg === 'object' ? envelope.msg : null
    const source = envelope.source && typeof envelope.source === 'object' ? envelope.source : {}
    const sourceNode = source.node && typeof source.node === 'object' ? source.node : source
    const nodeType = String(sourceNode.type || source.type || '').trim().toLowerCase()
    const messageId = String((message && message._msgid) || '').trim().slice(0, 200)
    const details = message && message.details && typeof message.details === 'object' && !Array.isArray(message.details)
      ? message.details
      : null
    const hasProtectMetadata = !!(details && details.unifiProtect !== undefined && details.unifiProtect !== null)
    const knownProtectOrigin = !!(message && unifiProtectMessages.has(message)) || hasCerebrumTransientMessageOrigin({
      messageId,
      source: 'unifi-protect',
      at: now
    })
    if (!UNIFI_PROTECT_NODE_TYPE_RE.test(nodeType) && !hasProtectMetadata && !knownProtectOrigin) return false
    rememberUnifiProtectOrigin(message, messageId, now)
    return true
  }

  const allowEvent = (event, now) => {
    refreshEventWindow(now)
    if (eventWindowCount >= MAX_EVENTS_PER_MINUTE) return false
    const fingerprint = `${event.resourceId}|${event.details && event.details.topic}|${event.state}`
    const previous = Number(recentFingerprints.get(fingerprint) || 0)
    if (previous > 0 && (now - previous) < DUPLICATE_WINDOW_MS) return false
    recentFingerprints.set(fingerprint, now)
    eventWindowCount += 1
    return true
  }

  const observeSendEvents = sendEvents => {
    const events = Array.isArray(sendEvents) ? sendEvents : [sendEvents]
    events.forEach(sendEvent => {
      try {
        const now = Date.now()
        refreshEventWindow(now)
        // Protect is exposed through explicit integration/query providers. Drop
        // its verbose flow copies before normalization and rate-limit accounting
        // so they never become a second, durable household event stream.
        // Track _msgid as well as the canonical metadata so ordinary Function,
        // Change or Switch nodes cannot make the same message look like a new
        // household observation merely by removing msg.details.
        if (isUnifiProtectFlowEvent(sendEvent, now)) return
        if (eventWindowCount >= MAX_EVENTS_PER_MINUTE) return
        const event = normalizeCerebrumFlowSendEvent(sendEvent, { at: new Date(now).toISOString() })
        if (!event || !allowEvent(event, now)) return
        listeners.forEach(listener => {
          try { listener(event) } catch (error) { /* observer listeners cannot interrupt the flow */ }
        })
      } catch (error) { /* observing must never alter Node-RED message delivery */ }
    })
  }

  RED.plugins.registerPlugin('cerebrumUltimateRuntime', {
    type: 'runtime',
    onadd () {
      const registry = getCerebrumHomeAutomationRegistry()
      registry.registerAdapter({
        id: ADAPTER_ID,
        title: 'Node-RED flow observer',
        kind: 'runtime',
        capabilities: ['flow-events', 'hue-events', 'matter-events', 'home-assistant-events'],
        operations: ['events'],
        access: 'observe'
      })
      registry.registerProvider(provider)
      if (RED.hooks && typeof RED.hooks.remove === 'function') RED.hooks.remove(HOOK_ID)
      if (RED.hooks && typeof RED.hooks.add === 'function') RED.hooks.add(HOOK_ID, observeSendEvents)
    }
  })
}
