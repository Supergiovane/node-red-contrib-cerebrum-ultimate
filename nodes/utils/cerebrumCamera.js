// Keep the established KNX AI symbol as the canonical vendor-neutral camera
// contract. UniFi Ultimate and existing third-party camera suites publish here.
// The Cerebrum-specific alias is retained so adapters built during the
// standalone extraction continue to resolve the very same registry object.
const CEREBRUM_CAMERA_REGISTRY_KEY = Symbol.for('node-red.knx-ai.camera-adapters.v1')
const CEREBRUM_CAMERA_REGISTRY_ALIAS_KEY = Symbol.for('node-red.cerebrum.camera-adapters.v1')
const CEREBRUM_CAMERA_IMAGE_MAX_BYTES = 6 * 1024 * 1024
const CEREBRUM_CAMERA_MAX_ACTIONS = 8
const CEREBRUM_CAMERA_HISTORY_MAX_RESULTS = 100

const clampText = (value, maxChars = 240) => String(value === undefined || value === null ? '' : value)
  .trim()
  .slice(0, Math.max(0, Number(maxChars) || 0))

const normalizeSearchText = value => clampText(value, 300)
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLocaleLowerCase()
  .replace(/[^a-z0-9]+/g, ' ')
  .trim()

const uniqueTexts = values => Array.from(new Set((Array.isArray(values) ? values : [])
  .map(value => clampText(value, 240))
  .filter(Boolean)))

const normalizeCerebrumCameraEventAt = value => {
  const text = clampText(value, 80)
  if (!text) return ''
  const numeric = /^\d{10,13}$/.test(text) ? Number(text) : NaN
  const parsed = new Date(Number.isFinite(numeric) ? (text.length <= 10 ? numeric * 1000 : numeric) : text)
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString()
}

const formatCerebrumCameraEventDateTime = ({ eventAt, language = 'en', timeZone } = {}) => {
  const normalizedAt = normalizeCerebrumCameraEventAt(eventAt)
  if (!normalizedAt) return ''
  const rawLanguage = clampText(language, 16).toLocaleLowerCase()
  const locale = rawLanguage.startsWith('it')
    ? 'it-IT'
    : rawLanguage.startsWith('de')
      ? 'de-DE'
      : rawLanguage.startsWith('fr')
        ? 'fr-FR'
        : rawLanguage.startsWith('es')
          ? 'es-ES'
          : rawLanguage.startsWith('zh') ? 'zh-CN' : 'en-US'
  const options = {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short'
  }
  const requestedTimeZone = clampText(timeZone, 80)
  if (requestedTimeZone) options.timeZone = requestedTimeZone
  try {
    return new Intl.DateTimeFormat(locale, options).format(new Date(normalizedAt))
  } catch (error) {
    return normalizedAt.replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC')
  }
}

const appendCerebrumCameraEventDateTime = ({ content, eventAt, language, timeZone } = {}) => {
  const formatted = formatCerebrumCameraEventDateTime({ eventAt, language, timeZone })
  if (!formatted) return clampText(content, 4000)
  const rawLanguage = clampText(language || 'en', 16).toLocaleLowerCase()
  const label = rawLanguage.startsWith('it')
    ? 'Data/ora evento'
    : rawLanguage.startsWith('de')
      ? 'Datum/Uhrzeit des Ereignisses'
      : rawLanguage.startsWith('fr')
        ? 'Date/heure de l’événement'
        : rawLanguage.startsWith('es')
          ? 'Fecha/hora del evento'
          : rawLanguage.startsWith('zh') ? '事件日期/时间' : 'Event date/time'
  // Keep the authoritative event time first: Telegram photo captions are
  // truncated to 1024 characters by the supported adapter presets.
  return [`${label}: ${formatted}`, clampText(content, 4000)].filter(Boolean).join('\n')
}

const redactCerebrumCameraHistoryCredentialText = (value, historyCredentials) => {
  let text = String(value && value.message ? value.message : value || '')
  const source = historyCredentials && typeof historyCredentials === 'object' && !Array.isArray(historyCredentials)
    ? historyCredentials
    : {}
  const variants = [source.username, source.password]
    .flatMap(secret => {
      const raw = String(secret || '')
      if (!raw) return []
      const encoded = (() => { try { return encodeURIComponent(raw) } catch (error) { return '' } })()
      const jsonEscaped = (() => { try { return JSON.stringify(raw).slice(1, -1) } catch (error) { return '' } })()
      return [raw, encoded, jsonEscaped]
    })
    .filter(Boolean)
    .sort((left, right) => right.length - left.length)
  ;Array.from(new Set(variants)).forEach(secret => { text = text.split(secret).join('[redacted]') })
  return clampText(text, 500)
}

const CEREBRUM_CAMERA_PROVIDER_ALIAS_GROUPS = Object.freeze([
  Object.freeze(['unifi-ultimate', 'unifi-protect', 'node-red-contrib-unifi-ultimate'])
])

const parseCerebrumCameraProviderReference = value => {
  const reference = clampText(value, 240).toLocaleLowerCase()
  if (!reference) return { reference: '', family: '', scoped: false }
  const separator = reference.indexOf(':')
  const rawFamily = separator >= 0 ? reference.slice(0, separator) : reference
  const suffix = separator >= 0 ? reference.slice(separator + 1) : ''
  const aliases = CEREBRUM_CAMERA_PROVIDER_ALIAS_GROUPS.find(group => group.includes(rawFamily))
  const family = aliases ? aliases[0] : rawFamily
  return {
    reference: suffix ? `${family}:${suffix}` : family,
    family,
    scoped: Boolean(suffix)
  }
}

// Models sometimes copy the adapter id shown in AVAILABLE CAMERA ADAPTERS
// instead of the provider instance id returned by a history query. Accept that
// family reference (and known package aliases), while a scoped provider id must
// still match exactly so one controller cannot be mistaken for another.
const matchesCerebrumCameraProviderReference = ({ requestedProviderId, providerId, provider } = {}) => {
  const requested = parseCerebrumCameraProviderReference(requestedProviderId)
  if (!requested.reference) return true
  const source = provider && typeof provider === 'object' && !Array.isArray(provider) ? provider : {}
  const references = uniqueTexts([
    providerId,
    source.id,
    source.providerId,
    source.adapterId,
    source.source,
    source.packageName,
    source.module,
    source.moduleName,
    ...(Array.isArray(source.aliases) ? source.aliases : []),
    ...(Array.isArray(source.providerAliases) ? source.providerAliases : [])
  ])
  return references.some(value => {
    const candidate = parseCerebrumCameraProviderReference(value)
    if (!candidate.reference) return false
    return requested.scoped
      ? candidate.reference === requested.reference
      : candidate.reference === requested.reference || candidate.family === requested.family
  })
}

// Runtime contract for optional camera suites. A package registers one adapter
// manifest and one provider per configured controller. Providers expose:
//   listCameras({ force }) -> camera[]
//   takeSnapshot({ cameraId, cameraName, highQuality }) -> { data, mediaType, camera }
//   queryEvents({ cameraId, cameraName, eventTypes, objectTypes, from, to,
//                 offset, limit }, { historyCredentials, historyQueryScope })
//     -> { events, nextOffset, hasMore }
//   takeEventSnapshot({ eventId, cameraId, cameraName }, { historyCredentials })
//     -> { data, mediaType }
//   subscribe(listener) -> unsubscribe(), with normalized camera event objects.
// Providers whose live feed must never enter Cerebrum's durable memory declare
// `eventRetention: 'none'`. Queries remain available on demand and the provider
// remains the source of truth for recordings; watches may still consume the
// transient subscription stream.
// The global Symbol lets separately installed Node-RED packages share the same
// in-process registry without either package importing the other one.
const getCerebrumCameraAdapterRegistry = () => {
  const isCompatibleRegistry = value => value && value.version === 1 && value.adapters instanceof Map && value.providers instanceof Map
  const canonical = globalThis[CEREBRUM_CAMERA_REGISTRY_KEY]
  const alias = globalThis[CEREBRUM_CAMERA_REGISTRY_ALIAS_KEY]
  const existing = isCompatibleRegistry(canonical) ? canonical : (isCompatibleRegistry(alias) ? alias : null)
  if (existing) {
    globalThis[CEREBRUM_CAMERA_REGISTRY_KEY] = existing
    globalThis[CEREBRUM_CAMERA_REGISTRY_ALIAS_KEY] = existing
    return existing
  }
  const registry = {
    version: 1,
    adapters: new Map(),
    providers: new Map(),
    listeners: new Set(),
    registerAdapter (adapter) {
      if (!adapter || !adapter.id) return
      this.adapters.set(String(adapter.id), Object.freeze(Object.assign({}, adapter)))
      this.listeners.forEach(listener => {
        try { listener({ type: 'adapter_registered', adapter: this.adapters.get(String(adapter.id)) }) } catch (error) { /* ignore */ }
      })
    },
    registerProvider (provider) {
      if (!provider || !provider.id) return
      this.providers.set(String(provider.id), provider)
      this.listeners.forEach(listener => {
        try { listener({ type: 'provider_registered', provider }) } catch (error) { /* ignore */ }
      })
    },
    unregisterProvider (providerId) {
      const id = String(providerId || '')
      const provider = this.providers.get(id)
      if (!provider) return
      this.providers.delete(id)
      this.listeners.forEach(listener => {
        try { listener({ type: 'provider_unregistered', provider }) } catch (error) { /* ignore */ }
      })
    },
    subscribe (listener) {
      if (typeof listener !== 'function') return () => {}
      this.listeners.add(listener)
      return () => this.listeners.delete(listener)
    }
  }
  globalThis[CEREBRUM_CAMERA_REGISTRY_KEY] = registry
  globalThis[CEREBRUM_CAMERA_REGISTRY_ALIAS_KEY] = registry
  return registry
}

const normalizeCerebrumCameraRegistration = (value = {}) => {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  const id = clampText(source.cameraId || source.id, 160)
  const name = clampText(source.cameraName || source.name || id, 240)
  const state = clampText(source.state, 80).toUpperCase()
  const online = typeof source.online === 'boolean'
    ? source.online
    : state
      ? ['CONNECTED', 'ONLINE'].includes(state)
      : null
  if (!id && !name) return null
  return {
    id,
    semanticId: clampText(source.semanticId, 600),
    name,
    aliases: uniqueTexts([name, id].concat(Array.isArray(source.aliases) ? source.aliases : [])),
    source: clampText(source.source || 'camera-adapter', 80),
    adapterId: clampText(source.adapterId, 120),
    adapterTitle: clampText(source.adapterTitle, 240),
    providerId: clampText(source.providerId, 200),
    controllerId: clampText(source.controllerId, 160),
    controllerName: clampText(source.controllerName, 240),
    nativeCameraId: clampText(source.nativeCameraId, 160),
    area: clampText(source.area, 160),
    capabilities: uniqueTexts(source.capabilities),
    access: clampText(source.access || 'observe', 80),
    state,
    online,
    objectTypes: uniqueTexts(source.objectTypes).map(normalizeCameraObjectType).filter(Boolean).slice(0, 24),
    lines: (Array.isArray(source.lines) ? source.lines : []).slice(0, 80),
    zones: (Array.isArray(source.zones) ? source.zones : []).slice(0, 80),
    lastSeenAt: clampText(source.lastSeenAt || new Date().toISOString(), 64)
  }
}

const resolveCerebrumCamera = ({ target, cameras } = {}) => {
  const requested = normalizeSearchText(target)
  const list = (Array.isArray(cameras) ? cameras : [])
    .map(normalizeCerebrumCameraRegistration)
    .filter(Boolean)
  if (!requested) return { camera: null, ambiguous: false }

  const exact = list.filter(camera => [camera.id, camera.name].concat(camera.aliases)
    .some(alias => normalizeSearchText(alias) === requested))
  if (exact.length === 1) return { camera: exact[0], ambiguous: false }
  if (exact.length > 1) return { camera: null, ambiguous: true }

  const partial = list.filter(camera => [camera.id, camera.name].concat(camera.aliases)
    .some(alias => {
      const normalizedAlias = normalizeSearchText(alias)
      return normalizedAlias && (normalizedAlias.includes(requested) || requested.includes(normalizedAlias))
    }))
  if (partial.length === 1) return { camera: partial[0], ambiguous: false }
  return { camera: null, ambiguous: partial.length > 1 }
}

const normalizeCameraEventType = value => {
  const raw = normalizeSearchText(value).replace(/\s+/g, '')
  if (['smartdetect', 'objectdetect', 'objectdetection', 'smartdetection'].includes(raw)) return 'smartDetect'
  if (['smartdetectline', 'line', 'linecrossing', 'crossline'].includes(raw)) return 'smartDetectLine'
  if (['smartdetectzone', 'zone', 'intrusionzone', 'intrusion'].includes(raw)) return 'smartDetectZone'
  if (['smartdetectloiterzone', 'loiter', 'loiterzone'].includes(raw)) return 'smartDetectLoiterZone'
  if (['motion', 'movement'].includes(raw)) return 'motion'
  if (['ring', 'doorbell'].includes(raw)) return 'ring'
  if (['smartaudiodetect', 'audio'].includes(raw)) return 'smartAudioDetect'
  return clampText(value, 80)
}

const normalizeCameraObjectType = value => {
  const raw = normalizeSearchText(value).replace(/\s+/g, '')
  if (['person', 'people', 'persona', 'persone', 'human', 'someone', 'qualcuno'].includes(raw)) return 'person'
  if (['animal', 'animale', 'animali', 'pet', 'pets', 'dog', 'cat', 'cane', 'gatto'].includes(raw)) return 'animal'
  if (['vehicle', 'vehicles', 'veicolo', 'veicoli', 'car', 'auto', 'automobile'].includes(raw)) return 'vehicle'
  if (['face', 'volto', 'faccia'].includes(raw)) return 'face'
  if (['licenseplate', 'numberplate', 'targa'].includes(raw)) return 'licenseplate'
  if (['package', 'parcel', 'pacco'].includes(raw)) return 'package'
  return normalizeSearchText(value).replace(/\s+/g, '')
}

const normalizeCameraActionType = value => {
  const raw = normalizeSearchText(value).replace(/\s+/g, '_')
  if (['snapshot', 'get_snapshot', 'send_snapshot', 'camera_snapshot'].includes(raw)) return 'snapshot'
  if (['query_events', 'search_events', 'history', 'historical_events', 'list_events'].includes(raw)) return 'query_events'
  if (['event_snapshot', 'historical_snapshot', 'recorded_snapshot', 'snapshot_event'].includes(raw)) return 'event_snapshot'
  if (['analyze', 'analyse', 'analyze_snapshot', 'describe_snapshot', 'vision'].includes(raw)) return 'analyze'
  if (['watch', 'subscribe', 'notify', 'create_watch'].includes(raw)) return 'watch'
  if (['unwatch', 'unsubscribe', 'stop', 'remove_watch', 'delete_watch'].includes(raw)) return 'unwatch'
  if (['list', 'list_watches', 'show_watches'].includes(raw)) return 'list_watches'
  return ''
}

const normalizeCerebrumCameraAction = (value, cameras = []) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const type = normalizeCameraActionType(value.type || value.action || value.operation)
  if (!type) return null
  const target = clampText(value.cameraId || value.cameraName || value.camera || value.target, 240)
  const resolved = resolveCerebrumCamera({ target, cameras })
  const camera = resolved.camera
  let eventType = normalizeCameraEventType(value.eventType || value.event)
  const requestedScope = clampText(value.scopeId || value.scopeName || value.zoneId || value.lineId || value.zone || value.line, 240)
  const availableScopes = camera
    ? eventType === 'smartDetectLine'
      ? camera.lines
      : ['smartDetectZone', 'smartDetectLoiterZone'].includes(eventType)
          ? camera.zones
          : []
    : []
  const normalizedScopeTarget = normalizeSearchText(requestedScope)
  const matchingScopes = normalizedScopeTarget
    ? (Array.isArray(availableScopes) ? availableScopes : []).filter(scope => [scope && scope.id, scope && scope.name]
        .some(candidate => normalizeSearchText(candidate) === normalizedScopeTarget))
    : []
  const resolvedScope = matchingScopes.length === 1 ? matchingScopes[0] : null
  const objectTypes = uniqueTexts(Array.isArray(value.objectTypes)
    ? value.objectTypes
    : [value.objectType || value.smartDetectType]).map(normalizeCameraObjectType).filter(Boolean).slice(0, 12)
  // A plain motion event has no classified object metadata. Convert requests
  // such as "motion caused by a person/animal" to the generic smart-detection
  // family so they can match Protect zone, line, or loiter detections.
  if (type === 'watch' && eventType === 'motion' && objectTypes.length > 0) eventType = 'smartDetect'
  const normalizeDate = dateValue => {
    const text = clampText(dateValue, 80)
    if (!text) return { value: '', invalid: false }
    const parsed = new Date(text)
    return Number.isNaN(parsed.getTime())
      ? { value: '', invalid: true }
      : { value: parsed.toISOString(), invalid: false }
  }
  const from = normalizeDate(value.from || value.start)
  const to = normalizeDate(value.to || value.end)
  return {
    type,
    providerId: clampText(value.providerId, 200),
    cameraId: camera ? camera.id : clampText(value.cameraId, 160),
    cameraName: camera ? camera.name : clampText(value.cameraName || value.camera || value.target, 240),
    unresolvedTarget: camera ? '' : target,
    unresolved: Boolean(target && !camera),
    ambiguous: resolved.ambiguous,
    eventType,
    scopeId: resolvedScope ? clampText(resolvedScope.id, 160) : clampText(value.scopeId || value.zoneId || value.lineId, 160),
    scopeName: resolvedScope ? clampText(resolvedScope.name || resolvedScope.id, 240) : clampText(value.scopeName || value.zone || value.line, 240),
    unresolvedScope: Boolean(requestedScope && camera && !resolvedScope),
    ambiguousScope: matchingScopes.length > 1,
    objectTypes,
    eventId: clampText(value.eventId || value.recordingId, 200),
    from: from.value,
    to: to.value,
    invalidRange: from.invalid || to.invalid || Boolean(from.value && to.value && new Date(from.value).getTime() > new Date(to.value).getTime()),
    offset: Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Math.floor(Number(value.offset) || 0))),
    limit: Math.max(1, Math.min(CEREBRUM_CAMERA_HISTORY_MAX_RESULTS, Math.floor(Number(value.limit) || 20))),
    cooldownSeconds: Math.max(10, Math.min(86400, Number(value.cooldownSeconds) || 60)),
    sendSnapshot: value.sendSnapshot !== false,
    reason: clampText(value.reason, 500)
  }
}

const normalizeCerebrumCameraActions = ({ actions, cameras } = {}) => (Array.isArray(actions) ? actions : [])
  .slice(0, CEREBRUM_CAMERA_MAX_ACTIONS)
  .map(action => normalizeCerebrumCameraAction(action, cameras))
  .filter(Boolean)

const normalizeCerebrumCameraEvent = value => {
  const meta = value && typeof value === 'object' && !Array.isArray(value) && value.eventType
    ? value
    : null
  if (!meta) return null
  return {
    cameraId: clampText(meta.cameraId, 160),
    cameraName: clampText(meta.cameraName, 240),
    semanticId: clampText(meta.semanticId, 600),
    area: clampText(meta.area, 160),
    eventType: normalizeCameraEventType(meta.eventType),
    scopeId: clampText(meta.scopeId, 160),
    scopeName: clampText(meta.scopeName, 240),
    objectTypes: uniqueTexts(Array.isArray(meta.objectTypes) ? meta.objectTypes : []).map(normalizeSearchText).filter(Boolean),
    eventId: clampText(meta.eventId, 160),
    active: meta.active !== false,
    at: clampText(meta.at || new Date().toISOString(), 64),
    raw: meta.raw
  }
}

const normalizeCerebrumHistoricalCameraEvent = (value, defaults = {}) => {
  const eventAt = normalizeCerebrumCameraEventAt(value && value.at)
  if (!eventAt) return null
  const event = normalizeCerebrumCameraEvent(value)
  if (!event || !event.eventId) return null
  const endAt = clampText(value && value.endAt, 64)
  const parsedEnd = endAt ? new Date(endAt) : null
  const scoreValue = Number(value && value.score)
  return {
    providerId: clampText((value && value.providerId) || defaults.providerId, 200),
    cameraId: event.cameraId,
    cameraName: event.cameraName,
    area: event.area,
    eventId: event.eventId,
    eventType: event.eventType,
    scopeId: event.scopeId,
    scopeName: event.scopeName,
    objectTypes: event.objectTypes.slice(0, 12),
    at: eventAt,
    endAt: parsedEnd && !Number.isNaN(parsedEnd.getTime()) ? parsedEnd.toISOString() : '',
    active: event.active,
    score: Number.isFinite(scoreValue) ? scoreValue : null,
    thumbnailAvailable: value && value.thumbnailAvailable !== false
  }
}

const cameraHistoricalQueryMatches = (action, event) => {
  if (!action || !event) return false
  if (action.cameraId && event.cameraId && action.cameraId !== event.cameraId) return false
  if (!action.cameraId && action.cameraName && normalizeSearchText(action.cameraName) !== normalizeSearchText(event.cameraName)) return false
  const wantedType = normalizeCameraEventType(action.eventType)
  const eventType = normalizeCameraEventType(event.eventType)
  if (wantedType === 'motion' || wantedType === 'smartDetect') {
    if (!['motion', 'smartDetectZone', 'smartDetectLine', 'smartDetectLoiterZone'].includes(eventType)) return false
  } else if (wantedType && wantedType !== eventType) return false
  const wantedObjects = (Array.isArray(action.objectTypes) ? action.objectTypes : []).map(normalizeCameraObjectType).filter(Boolean)
  if (wantedObjects.length) {
    const detected = (Array.isArray(event.objectTypes) ? event.objectTypes : []).map(normalizeCameraObjectType).filter(Boolean)
    if (!detected.some(type => wantedObjects.includes(type))) return false
  }
  const at = new Date(event.at).getTime()
  if (!Number.isFinite(at)) return false
  if (action.from && at < new Date(action.from).getTime()) return false
  if (action.to && at > new Date(action.to).getTime()) return false
  return true
}

const executeCerebrumCameraHistoryActions = async ({ actions, cameras, providers, resolveHistoryCredentials, historyQueryScope } = {}) => {
  const catalog = (Array.isArray(cameras) ? cameras : []).map(normalizeCerebrumCameraRegistration).filter(Boolean)
  const providerMap = providers instanceof Map ? providers : new Map(Object.entries(providers || {}))
  const results = []
  for (const action of (Array.isArray(actions) ? actions : [])) {
    const targetCamera = action && action.cameraId
      ? catalog.find(camera => camera.id === action.cameraId)
      : null
    const candidates = Array.from(providerMap.entries()).filter(([providerId, provider]) => {
      if (!provider || typeof provider.queryEvents !== 'function') return false
      if (action.providerId && !matchesCerebrumCameraProviderReference({ requestedProviderId: action.providerId, providerId, provider })) return false
      if (targetCamera && !matchesCerebrumCameraProviderReference({ requestedProviderId: targetCamera.providerId, providerId, provider })) return false
      return true
    })
    if (!candidates.length) {
      results.push({
        operation: 'query_events',
        ok: false,
        reason: (action && action.reason) || '',
        error: 'No selected camera provider exposes historical event queries.'
      })
      continue
    }
    const events = []
    const continuations = []
    const errors = []
    for (const [providerId, provider] of candidates) {
      let historyCredentials
      try {
        historyCredentials = typeof resolveHistoryCredentials === 'function'
          ? resolveHistoryCredentials({ providerId, provider })
          : undefined
        const response = await provider.queryEvents({
          cameraId: action.cameraId,
          cameraName: action.cameraName,
          eventTypes: action.eventType ? [action.eventType] : [],
          objectTypes: action.objectTypes,
          from: action.from,
          to: action.to,
          offset: action.offset,
          limit: action.limit
        }, {
          historyCredentials,
          historyQueryScope: clampText(historyQueryScope, 160)
        })
        const providerEvents = Array.isArray(response) ? response : Array.isArray(response && response.events) ? response.events : []
        providerEvents.forEach(candidate => {
          const event = normalizeCerebrumHistoricalCameraEvent(candidate, { providerId })
          if (event && cameraHistoricalQueryMatches(action, event)) events.push(event)
        })
        const nextOffset = Number(response && response.nextOffset)
        if (response && response.hasMore === true && Number.isFinite(nextOffset) && nextOffset >= 0) {
          continuations.push({ providerId, offset: Math.floor(nextOffset) })
        }
      } catch (error) {
        errors.push({
          providerId,
          error: redactCerebrumCameraHistoryCredentialText(error, historyCredentials)
        })
      }
    }
    events.sort((left, right) => new Date(right.at).getTime() - new Date(left.at).getTime())
    const selected = events.slice(0, action.limit)
    const providerFailure = errors.length === candidates.length
      ? clampText(Array.from(new Set(errors.map(item => item.error).filter(Boolean))).join('; '), 500)
      : ''
    results.push({
      operation: 'query_events',
      ok: selected.length > 0 || errors.length < candidates.length,
      error: providerFailure,
      reason: action.reason,
      filters: {
        providerId: action.providerId,
        cameraId: action.cameraId,
        cameraName: action.cameraName,
        eventType: action.eventType,
        objectTypes: action.objectTypes,
        from: action.from,
        to: action.to,
        offset: action.offset,
        limit: action.limit
      },
      events: selected,
      returnedEvents: selected.length,
      continuations,
      hasMore: continuations.length > 0,
      errors
    })
  }
  return results
}

const buildCerebrumCameraHistoryResultsContext = (results, { maxChars = 12000 } = {}) => {
  const requestedBudget = Number(maxChars)
  const byteBudget = Number.isFinite(requestedBudget) ? Math.max(0, Math.floor(requestedBudget)) : 12000
  if (byteBudget === 0) return ''
  const lines = []
  let bytes = 0
  let evidenceIndex = 0
  let omittedLines = 0
  const appendLine = line => {
    const text = String(line || '')
    if (!text) return true
    const prefix = lines.length ? '\n' : ''
    const size = Buffer.byteLength(prefix + text, 'utf8')
    if (bytes + size > byteBudget) {
      omittedLines += 1
      return false
    }
    lines.push(text)
    bytes += size
    return true
  }
  const source = Array.isArray(results) ? results : []
  // Later pages contain the evidence acquired most recently. Select them first
  // so an earlier dense page cannot permanently hide a newly found event from
  // a small model window. Every row is admitted atomically; never cut an event
  // id, timestamp, continuation token or other evidence field mid-line.
  source.slice().reverse().forEach((result, reverseIndex) => {
    const resultIndex = source.length - reverseIndex - 1
    if (!result || result.ok !== true) {
      appendLine(`Query ${resultIndex + 1}: FAILED — ${clampText(result && result.error, 500)}`)
      return
    }
    const events = Array.isArray(result.events) ? result.events : []
    appendLine(`Query ${resultIndex + 1}: ${events.length} event(s) returned${result.hasMore ? '; more pages are available' : ''}.`)
    // Pagination metadata is more important than any individual row: without
    // it the model cannot continue a source query whose newest page was partial.
    ;(Array.isArray(result.continuations) ? result.continuations : []).forEach(item => {
      appendLine(`Continuation: providerId=${item.providerId} | offset=${item.offset}`)
    })
    events.forEach(event => {
      evidenceIndex += 1
      const eventObjectTypes = Array.isArray(event && event.objectTypes) ? event.objectTypes : []
      const details = [
        `providerId=${event.providerId || '?'}`,
        `eventId=${event.eventId}`,
        `camera=${event.cameraName || event.cameraId || '?'}`,
        `cameraId=${event.cameraId || '?'}`,
        `at=${event.at}`,
        event.endAt ? `endAt=${event.endAt}` : '',
        `type=${event.eventType || '?'}`,
        event.scopeName || event.scopeId ? `scope=${event.scopeName || event.scopeId}` : '',
        eventObjectTypes.length ? `objects=${eventObjectTypes.join(',')}` : '',
        `snapshot=${event.thumbnailAvailable ? 'available' : 'unavailable'}`
      ].filter(Boolean)
      appendLine(`[CH${evidenceIndex}] ${details.join(' | ')}`)
    })
    ;(Array.isArray(result.errors) ? result.errors : []).forEach(item => {
      appendLine(`Provider error: ${item.providerId || '?'} — ${clampText(item.error, 500)}`)
    })
  })
  if (omittedLines > 0) appendLine(`Earlier or oversized camera-history rows omitted: ${omittedLines}.`)
  return lines.join('\n')
}

const bindCerebrumCameraEventSnapshotEvidence = (action, results) => {
  if (!action || action.type !== 'event_snapshot') return action
  const eventId = clampText(action.eventId, 200)
  const providerId = clampText(action.providerId, 200)
  const matchingEvents = (Array.isArray(results) ? results : []).flatMap(result => (
    Array.isArray(result && result.events) ? result.events : []
  )).filter(event => (
    event &&
    clampText(event.eventId, 200) === eventId &&
    (!providerId || matchesCerebrumCameraProviderReference({ requestedProviderId: providerId, providerId: event.providerId }))
  ))
  const matches = Array.from(new Map(matchingEvents.map(event => [
    `${clampText(event.providerId, 200)}\u0000${clampText(event.eventId, 200)}`,
    event
  ])).values())
  if (matches.length !== 1) {
    return Object.assign({}, action, {
      historicalEvidenceVerified: false,
      historicalEvidenceAmbiguous: matches.length > 1
    })
  }
  const evidence = matches[0]
  const eventAt = normalizeCerebrumCameraEventAt(evidence.at)
  if (!eventAt) {
    return Object.assign({}, action, {
      historicalEvidenceVerified: false,
      historicalEvidenceAmbiguous: false,
      historicalEvidenceMissingTimestamp: true
    })
  }
  return Object.assign({}, action, {
    providerId: clampText(evidence.providerId, 200),
    cameraId: clampText(evidence.cameraId, 160),
    cameraName: clampText(evidence.cameraName, 240),
    unresolvedTarget: '',
    unresolved: false,
    ambiguous: false,
    eventAt,
    historicalEvidenceVerified: true,
    historicalSnapshotUnavailable: evidence.thumbnailAvailable === false
  })
}

const cameraWatchMatchesEvent = (watch, event) => {
  if (!watch || !event) return false
  const watchCameraId = clampText(watch.cameraId, 160)
  const eventCameraId = clampText(event.cameraId, 160)
  if (watchCameraId && eventCameraId && watchCameraId !== eventCameraId) return false
  if ((!watchCameraId || !eventCameraId) && normalizeSearchText(watch.cameraName) !== normalizeSearchText(event.cameraName)) return false
  const wantedObjects = (Array.isArray(watch.objectTypes) ? watch.objectTypes : []).map(normalizeCameraObjectType).filter(Boolean)
  const watchEventType = normalizeCameraEventType(watch.eventType)
  const eventType = normalizeCameraEventType(event.eventType)
  const genericSmartDetection = watchEventType === 'smartDetect' ||
    (watchEventType === 'motion' && wantedObjects.length > 0)
  if (genericSmartDetection) {
    if (!['smartDetectZone', 'smartDetectLine', 'smartDetectLoiterZone'].includes(eventType)) return false
  } else if (watchEventType && watchEventType !== eventType) return false
  const watchScope = normalizeSearchText(watch.scopeId || watch.scopeName)
  const eventScopeCandidates = [event.scopeId, event.scopeName].map(normalizeSearchText).filter(Boolean)
  if (watchScope && !eventScopeCandidates.some(candidate => candidate === watchScope || candidate.includes(watchScope) || watchScope.includes(candidate))) return false
  if (wantedObjects.length) {
    const detectedObjects = (Array.isArray(event.objectTypes) ? event.objectTypes : []).map(normalizeCameraObjectType).filter(Boolean)
    if (!detectedObjects.some(type => wantedObjects.includes(type))) return false
  }
  return true
}

const normalizeCerebrumCameraImage = ({ data, mediaType } = {}) => {
  if (!Buffer.isBuffer(data)) throw new Error('The camera snapshot is not binary image data')
  if (data.length === 0) throw new Error('The camera snapshot is empty')
  if (data.length > CEREBRUM_CAMERA_IMAGE_MAX_BYTES) throw new Error(`The camera snapshot exceeds ${CEREBRUM_CAMERA_IMAGE_MAX_BYTES} bytes`)
  const type = clampText(mediaType || 'image/jpeg', 80).toLocaleLowerCase().split(';')[0]
  if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(type)) throw new Error(`Unsupported camera image type: ${type}`)
  return { data, mediaType: type, bytes: data.length }
}

const buildCerebrumCameraNotificationText = ({ language, event } = {}) => {
  const lang = clampText(language || 'en', 8).toLocaleLowerCase()
  const camera = clampText(event && event.cameraName, 240) || clampText(event && event.cameraId, 160) || 'camera'
  const eventType = normalizeCameraEventType(event && event.eventType)
  const scope = clampText(event && (event.scopeName || event.scopeId), 240)
  const objectTypes = uniqueTexts(event && event.objectTypes).join(', ')
  const details = [scope, objectTypes].filter(Boolean).join(' — ')
  const suffix = details ? ` (${details})` : ''
  const labels = {
    it: { smartDetectLine: 'un attraversamento di linea', smartDetectZone: 'un ingresso in zona', smartDetectLoiterZone: 'una permanenza in zona', motion: 'un movimento', ring: 'un suono del campanello', smartAudioDetect: 'un evento audio intelligente' },
    de: { smartDetectLine: 'eine Linienüberquerung', smartDetectZone: 'einen Zoneneintritt', smartDetectLoiterZone: 'einen längeren Zonenaufenthalt', motion: 'eine Bewegung', ring: 'ein Klingeln', smartAudioDetect: 'ein intelligentes Audioereignis' },
    fr: { smartDetectLine: 'un franchissement de ligne', smartDetectZone: 'une entrée dans une zone', smartDetectLoiterZone: 'une présence prolongée dans une zone', motion: 'un mouvement', ring: 'une sonnerie', smartAudioDetect: 'un événement audio intelligent' },
    es: { smartDetectLine: 'un cruce de línea', smartDetectZone: 'una entrada en zona', smartDetectLoiterZone: 'una permanencia en zona', motion: 'un movimiento', ring: 'una llamada al timbre', smartAudioDetect: 'un evento de audio inteligente' },
    zh: { smartDetectLine: '越线事件', smartDetectZone: '进入区域事件', smartDetectLoiterZone: '区域徘徊事件', motion: '移动事件', ring: '门铃事件', smartAudioDetect: '智能音频事件' },
    en: { smartDetectLine: 'a line crossing', smartDetectZone: 'a zone entry', smartDetectLoiterZone: 'loitering in a zone', motion: 'motion', ring: 'a doorbell ring', smartAudioDetect: 'a smart audio event' }
  }
  const label = (labels[lang] || labels.en)[eventType] || (lang === 'zh' ? '摄像机事件' : lang === 'it' ? 'un evento' : lang === 'de' ? 'ein Ereignis' : lang === 'fr' ? 'un événement' : lang === 'es' ? 'un evento' : 'an event')
  const copy = {
    it: `La telecamera ${camera} ha rilevato ${label}${suffix}.`,
    de: `Die Kamera ${camera} hat ${label} erkannt${suffix}.`,
    fr: `La caméra ${camera} a détecté ${label}${suffix}.`,
    es: `La cámara ${camera} ha detectado ${label}${suffix}.`,
    zh: `摄像机 ${camera} 检测到${label}${suffix}。`,
    en: `Camera ${camera} detected ${label}${suffix}.`
  }
  return copy[lang] || copy.en
}

module.exports = {
  CEREBRUM_CAMERA_HISTORY_MAX_RESULTS,
  CEREBRUM_CAMERA_IMAGE_MAX_BYTES,
  CEREBRUM_CAMERA_MAX_ACTIONS,
  CEREBRUM_CAMERA_REGISTRY_ALIAS_KEY,
  CEREBRUM_CAMERA_REGISTRY_KEY,
  appendCerebrumCameraEventDateTime,
  bindCerebrumCameraEventSnapshotEvidence,
  buildCerebrumCameraNotificationText,
  buildCerebrumCameraHistoryResultsContext,
  cameraWatchMatchesEvent,
  executeCerebrumCameraHistoryActions,
  formatCerebrumCameraEventDateTime,
  getCerebrumCameraAdapterRegistry,
  matchesCerebrumCameraProviderReference,
  normalizeCameraEventType,
  normalizeCameraObjectType,
  normalizeCerebrumCameraAction,
  normalizeCerebrumCameraActions,
  normalizeCerebrumCameraEvent,
  normalizeCerebrumCameraEventAt,
  normalizeCerebrumHistoricalCameraEvent,
  normalizeCerebrumCameraImage,
  normalizeCerebrumCameraRegistration,
  normalizeSearchText,
  redactCerebrumCameraHistoryCredentialText,
  resolveCerebrumCamera
}
