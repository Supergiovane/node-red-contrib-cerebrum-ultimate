'use strict'

const DAY = 86400000
const HOUR = 3600000
const CEREBRUM_RESEARCH_TOPICS = Object.freeze({
  lighting_comfort: 'smart home lighting visual comfort glare adaptive lighting official guidance',
  thermal_comfort: 'smart home thermal comfort thermostat occupant preferences official guidance',
  indoor_air_quality: 'home indoor air quality ventilation humidity sensors official guidance',
  quiet_routines: 'smart home quiet hours sleep lighting notifications official guidance',
  accessible_controls: 'smart home accessible controls occupant manual override official documentation',
  energy_without_discomfort: 'home energy efficiency maintaining occupant comfort official guidance',
  smart_home_updates: 'smart home new features release notes occupant comfort official documentation'
})
const PRIMARY_DOMAINS = ['home-assistant.io', 'knx.org', 'csa-iot.org', 'philips-hue.com', 'developers.meethue.com', 'energy.gov', 'energystar.gov', 'epa.gov', 'ashrae.org']
const clip = (value, size = 600) => String(value || '').slice(0, size)
const iso = at => new Date(at).toISOString()
const stamp = value => Date.parse(value || '') || 0
const copy = value => JSON.parse(JSON.stringify(value))
const unique = (value, size) => [...new Set(Array.isArray(value) ? value : [])].filter(item => typeof item === 'string').slice(0, size)
const primaryUrl = value => {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password && PRIMARY_DOMAINS.some(domain => url.hostname === domain || url.hostname.endsWith(`.${domain}`)) ? url.href : ''
  } catch (_) { return '' }
}
const boundedText = (value, bytes) => {
  let text = String(value || '')
  while (Buffer.byteLength(text, 'utf8') > bytes) text = text.slice(0, Math.floor(text.length * 0.8))
  return text
}

// Goals are Cerebrum's revisable hypotheses about useful improvements. They
// carry no authority: only AI Education and existing command controls do that.
const createCerebrumComfortGoals = ({ store, id, persist, openSituation, research, researchEnabled, now = Date.now }) => {
  for (const key of ['goals', 'knowledge', 'researchHistory']) if (!Array.isArray(store[key])) store[key] = []
  let recovered = false
  for (const job of store.researchHistory) {
    if (job.status !== 'claimed') continue
    job.status = 'interrupted'
    job.completedAt = iso(now())
    job.error = 'Node-RED restarted before research completion. Received sources already saved remain available; the reserved research budget is preserved.'
    recovered = true
  }
  if (recovered) persist()
  const baseline = entityIds => entityIds.map(entityId => store.entities.find(entity => entity.id === entityId)).filter(Boolean)
    .map(entity => ({ entityId: entity.id, value: entity.value, observedAt: entity.observedAt, fresh: entity.fresh, evidenceId: entity.evidenceId }))
  const applyUpdate = (update, at) => {
    if (!update) return null
    if (typeof update !== 'object' || !['observing', 'active', 'paused', 'retired'].includes(update.status) || !Object.hasOwn(CEREBRUM_RESEARCH_TOPICS, update.topic)) throw new Error('Invalid comfort goal update')
    let goal = update.goalId ? store.goals.find(item => item.id === update.goalId) : null
    if (update.goalId && !goal) throw new Error('Unknown comfort goal')
    const entityIds = unique(update.entityIds, 6)
    const evidenceIds = unique(update.evidenceIds, 8)
    const patternIds = unique(update.patternIds, 4)
    const sourceIds = unique(update.sourceIds, 4)
    if (!entityIds.length || entityIds.some(key => !store.entities.some(entity => entity.id === key))) throw new Error('Comfort goals require known house entities')
    const evidence = evidenceIds.map(key => store.evidence.find(item => item.id === key))
    const patterns = patternIds.map(key => store.patterns.find(item => item.id === key))
    if (evidence.some(item => !item || !entityIds.includes(item.entityId)) || patterns.some(item => !item || !entityIds.includes(item.entityId) || at - stamp(item.lastObserved) > 28 * DAY)) throw new Error('Comfort goal evidence does not match its entities or observation window')
    if (!evidence.length && !patterns.length) throw new Error('A comfort goal must originate in actual house observations')
    if (sourceIds.some(key => !store.knowledge.some(item => item.id === key && stamp(item.expiresAt) > at))) throw new Error('Comfort goal cites unknown or expired web knowledge')
    for (const field of ['summary', 'comfortBenefit', 'successCriterion', 'plan', 'assessment']) {
      if (typeof update[field] !== 'string' || !update[field].trim() || update[field].length > 800) throw new Error(`Comfort goal requires a bounded ${field}`)
    }
    const signature = `${update.topic}:${[...entityIds].sort().join('|')}`
    if (goal && goal.signature !== signature) throw new Error('A goal update must keep its topic and entities; create a new goal for a different scope')
    if (!goal) goal = store.goals.find(item => item.signature === signature && item.status !== 'retired')
    if (!goal) {
      if (store.goals.filter(item => !['retired', 'paused'].includes(item.status)).length >= 12) throw new Error('Active comfort goal limit reached; review existing goals first')
      goal = { id: id('goal'), origin: 'self_generated', signature, createdAt: iso(at), baseline: baseline(entityIds), reviews: [] }
      store.goals.push(goal)
    }
    if (['retired', 'paused'].includes(goal.status) && !['retired', 'paused'].includes(update.status) && store.goals.filter(item => !['retired', 'paused'].includes(item.status)).length >= 12) throw new Error('Active comfort goal limit reached')
    const changedPlan = goal.plan !== update.plan || goal.status !== update.status
    goal.topic = update.topic
    goal.status = update.status
    goal.entityIds = entityIds
    goal.evidenceIds = evidenceIds
    goal.patternIds = patternIds
    goal.sourceIds = sourceIds
    for (const field of ['summary', 'comfortBenefit', 'successCriterion', 'plan', 'assessment']) goal[field] = clip(update[field], 800)
    // Preserve the supporting observations even after the short evidence ring
    // advances. A command's readback alone never establishes occupant comfort.
    goal.support = evidence.map(item => ({ id: item.id, entityId: item.entityId, type: item.type, at: item.at, summary: clip(item.summary, 300), value: clip(item.value, 120) }))
    goal.current = baseline(entityIds)
    goal.comfortConfirmed = false
    goal.updatedAt = iso(at)
    goal.dueAt = iso(at + Math.max(1, Math.min(168, Number(update.reviewHours) || 24)) * HOUR)
    goal.reviews.push({ at: iso(at), status: goal.status, assessment: goal.assessment, evidenceIds, patternIds, sourceIds })
    goal.reviews = goal.reviews.slice(-8)
    if (goal.status === 'active' && changedPlan) {
      const situation = openSituation({ key: `goal_action:${goal.id}`, kind: 'goal_action_review', summary: `Evaluate the next practical step of comfort goal ${goal.id}: ${goal.plan}. Use fresh evidence and AI Education; an active goal is not action permission.`, entityIds, evidenceIds: goal.current.map(item => item.evidenceId).filter(Boolean), at })
      if (situation) situation.goalId = goal.id
    }
    const inactive = store.goals.filter(item => ['retired', 'paused'].includes(item.status))
    const active = store.goals.filter(item => !['retired', 'paused'].includes(item.status))
    store.goals = [...inactive.slice(-Math.max(0, 40 - active.length)), ...active]
    return goal.id
  }
  const schedule = at => {
    store.knowledge = store.knowledge.filter(item => stamp(item.expiresAt) > at).slice(-48)
    store.researchHistory = store.researchHistory.filter(item => at - stamp(item.at) < 30 * DAY).slice(-60)
    for (const goal of store.goals) {
      goal.current = baseline(goal.entityIds)
      if (!['observing', 'active'].includes(goal.status) || stamp(goal.dueAt) > at) continue
      if (store.situations.some(item => item.key === `goal:${goal.id}` && item.status !== 'resolved')) continue
      const current = store.entities.filter(entity => goal.entityIds.includes(entity.id))
      const situation = openSituation({ key: `goal:${goal.id}`, kind: 'goal_review', summary: `Review self-generated comfort goal ${goal.id}: ${goal.summary}. Compare baseline, current observations and criterion; revise or retire hypotheses that do not help occupants.`, entityIds: goal.entityIds, evidenceIds: current.map(entity => entity.evidenceId).filter(Boolean), at })
      if (situation) {
        situation.goalId = goal.id
        goal.dueAt = iso(at + DAY)
      }
    }
    // Weekly discovery has its own clock; it needs neither a chat message nor
    // an already authored goal. Search stays optional when Web access is off.
    const latest = store.researchHistory.filter(item => item.topic === 'smart_home_updates').at(-1)
    const nextDiscovery = latest ? stamp(latest.at) + (latest.status === 'succeeded' ? 7 * DAY : 6 * HOUR) : 0
    if (researchEnabled() && at >= nextDiscovery && at - stamp(store.lastDiscoveryOpenedAt) >= 6 * HOUR) {
      const entities = store.entities.filter(entity => entity.fresh).slice(0, 24)
      const situation = openSituation({ key: 'comfort:research', kind: 'research_review', summary: 'Review current SMART-home best practices and new capabilities for occupant comfort. Research only public generic topics, then assess compatibility locally and propose useful goals grounded in this house.', entityIds: entities.map(entity => entity.id), evidenceIds: entities.map(entity => entity.evidenceId).filter(Boolean), at })
      if (situation) {
        situation.researchTopic = 'smart_home_updates'
        store.lastDiscoveryOpenedAt = iso(at)
      }
    }
  }
  const requestResearch = async request => {
    const at = now()
    if (!request || !Object.hasOwn(CEREBRUM_RESEARCH_TOPICS, request.topic)) return { ok: false, error: 'Select a supported comfort research topic.' }
    if (!researchEnabled() || typeof research !== 'function') return { ok: false, error: 'Web access is disabled.' }
    const goal = request.goalId ? store.goals.find(item => item.id === request.goalId && !['retired', 'paused'].includes(item.status)) : null
    if (request.goalId && !goal) return { ok: false, error: 'Unknown or inactive comfort goal.' }
    const cached = store.knowledge.filter(item => item.topic === request.topic && stamp(item.expiresAt) > at)
    const recent = store.researchHistory.filter(item => item.topic === request.topic).at(-1)
    if (recent && at - stamp(recent.at) < (recent.status === 'succeeded' ? 7 * DAY : 6 * HOUR)) return { ok: !!cached.length, cached: true, sources: copy(cached.slice(-3)), error: cached.length ? '' : 'Research retry is cooling down.' }
    if (store.researchHistory.filter(item => at - stamp(item.at) < DAY).length >= 2) return { ok: false, error: 'Autonomous research budget exhausted: two sessions per rolling day.' }
    const job = { id: id('research'), topic: request.topic, goalId: goal ? goal.id : '', at: iso(at), status: 'claimed', sourceIds: [] }
    store.researchHistory.push(job)
    persist() // The reservation survives restarts and failed network calls.
    const savedSources = () => copy(store.knowledge.filter(item => job.sourceIds.includes(item.id)))
    const saveSources = sources => {
      for (const result of sources.slice(0, 3)) {
        const url = primaryUrl(result.url)
        if (!url) continue
        const text = boundedText(result.text, result.excerptOnly ? 900 : 4200)
        if (!text) continue
        const replaced = store.knowledge.filter(item => item.url === url && item.topic === request.topic)
        const entry = { id: id('knowledge'), topic: request.topic, goalId: job.goalId, origin: 'web', authority: 'external_data_only', url, title: clip(result.title, 240), text, excerptOnly: result.excerptOnly, retrievedAt: iso(now()), expiresAt: iso(at + 14 * DAY) }
        store.knowledge = store.knowledge.filter(item => !replaced.includes(item))
        store.knowledge.push(entry)
        job.sourceIds = job.sourceIds.filter(sourceId => !replaced.some(item => item.id === sourceId))
        job.sourceIds.push(entry.id)
      }
      // Each completed network stage is durable before another request starts.
      // A slow page fetch or shutdown cannot discard search excerpts received.
      store.updatedAt = iso(now())
      persist()
    }
    try {
      // No model-authored query, labels, occupants, IDs, room names, routines,
      // addresses or AI Education are ever sent to a search engine.
      const sourceNames = new Set(store.entities.filter(entity => !goal || goal.entityIds.includes(entity.id)).map(entity => entity.source))
      const families = [
        ['home-assistant', 'Home Assistant', 'home-assistant.io'],
        ['knx', 'KNX', 'knx.org'],
        ['hue', 'Philips Hue', 'philips-hue.com'],
        ['matter', 'Matter', 'csa-iot.org']
      ].filter(([source]) => sourceNames.has(source))
      // Weekly discovery rotates known integration families. Only these fixed
      // public names leave the local store, including for mixed installations.
      const family = families.length ? families[Math.floor(at / (7 * DAY)) % families.length] : ['', 'smart home', 'home-assistant.io']
      const domain = request.topic === 'indoor_air_quality' ? 'epa.gov' : ['thermal_comfort', 'energy_without_discomfort'].includes(request.topic) ? 'energy.gov' : family[2]
      const query = `${CEREBRUM_RESEARCH_TOPICS[request.topic]} ${family[1]} ${new Date(at).getFullYear()} site:${domain}`
      const search = await research([{ operation: 'search', query, maxResults: 5 }], { maxActions: 1 })
      const found = (search.results || []).filter(result => result.ok && result.operation === 'search').flatMap(result => result.results || [])
        .filter(result => primaryUrl(result.url)).slice(0, 3)
      saveSources(found.map(result => ({ ...result, excerptOnly: true })))
      if (found.length && researchEnabled()) {
        const opened = await research([{ operation: 'open', url: primaryUrl(found[0].url) }], { maxActions: 1 })
        const page = (opened.results || []).find(result => result.ok && result.operation === 'open' && primaryUrl(result.url))
        if (page) saveSources([{ ...page, excerptOnly: false }])
      }
      job.status = job.sourceIds.length ? 'succeeded' : 'no_sources'
      job.completedAt = iso(now())
      persist()
      return { ok: !!job.sourceIds.length, researchId: job.id, sources: savedSources(), error: job.sourceIds.length ? '' : 'No usable primary sources returned; do not invent guidance.' }
    } catch (error) {
      job.status = 'failed'
      job.error = clip(error.message, 300)
      job.completedAt = iso(now())
      persist()
      return { ok: false, researchId: job.id, sources: savedSources(), error: job.error }
    }
  }
  return { applyUpdate, schedule, requestResearch }
}

module.exports = { createCerebrumComfortGoals, CEREBRUM_RESEARCH_TOPICS }
