<script setup>
import { computed, ref, watch } from 'vue'
import { parseChatLearningNativeFile } from '../chatLearningView.mjs'
import { parseCerebrumMemoryJson } from '../cerebrumMemoryView.mjs'

const props = defineProps({
  mode: { type: String, default: 'learning' },
  instructionsOnly: { type: Boolean, default: false },
  content: { type: String, default: '' },
  language: { type: String, default: 'en' },
  loading: { type: Boolean, default: false },
  error: { type: String, default: '' }
})

const COPY = {
  en: {
    learningTitle: 'What Cerebrum remembers from conversations', memoryTitle: 'What Cerebrum has learned about the home',
    learningIntro: 'Browse the instructions, facts and recent exchanges currently retained from conversations.',
    memoryIntro: 'Explore observed habits, occupant decisions and the evidence retained about the home.',
    shared: 'Shared memory: nodes using the same storage can read these records.',
    authority: 'AI Education remains the reference for your instructions and permissions. Learned memories are observations and context, not new permissions.',
    retention: 'This view shows the records currently retained. Recent exchanges are not the complete conversation history.',
    loading: 'Loading saved memories…', unloaded: 'Saved memories have not been loaded yet.',
    parseError: 'These memories could not be displayed. The saved content is unavailable or has an invalid format.',
    operationError: 'The last operation could not be completed. The last successfully loaded memory is still shown below.',
    updated: 'Last update', created: 'Created', sessions: 'Conversations', instructions: 'Memories from chats', turns: 'Recent exchanges', watches: 'Camera watches',
    habits: 'Habits', decisions: 'Occupant decisions', objects: 'Known objects', observations: 'Observations', notifications: 'Messages sent', all: 'All records',
    search: 'Search retained memories', searchHint: 'Search text, devices, sources or evidence', clear: 'Clear filters', allSessions: 'All conversations', allStatuses: 'All habit statuses',
    session: 'Conversation', status: 'Status', empty: 'No records retained in this category yet.', noMatches: 'No retained records match these filters.',
    showing: 'Showing', of: 'of', previous: 'Previous', next: 'Next', page: 'Page',
    fullText: 'Read the full text', details: 'All saved details', recorded: 'Recorded', unknown: 'Not recorded',
    occupant: 'Occupant', cerebrum: 'Cerebrum', instruction: 'Memory from a conversation', exchange: 'Conversation exchange',
    camera: 'Camera', event: 'Event', scope: 'Area or scope', objectTypes: 'Detected objects', cooldown: 'Minimum interval between alerts', snapshot: 'Send snapshot', language: 'Language',
    yes: 'Yes', no: 'No', seconds: 'seconds', minutes: 'minutes',
    pattern: 'Observed pattern', value: 'Value', time: 'Time of day', days: 'Days', samples: 'Observations', distinctDays: 'Distinct days', span: 'Days between first and last observation', confidence: 'Confidence',
    evidence: 'What this is based on', override: 'Occupant correction', note: 'Occupant note', proposal: 'Question sent to the occupant',
    firstSeen: 'First observed', lastSeen: 'Last observed', observedDates: 'Observation dates', averageOpen: 'Average open duration',
    source: 'Source', objectId: 'Object identifier', area: 'Room or area', kind: 'Object type', operation: 'Decision', habit: 'Related habit',
    message: 'Message', reason: 'Reason', refresh: 'Collection details', lastTick: 'Last update cycle', haRefreshes: 'Home Assistant refreshes', haErrors: 'Home Assistant errors', knxReads: 'KNX state reads', lastError: 'Last collection error',
    learning: 'Learning', pending_confirmation: 'Awaiting confirmation', confirmed: 'Confirmed', rejected: 'Ignored', paused: 'Paused', confirm: 'Confirmed', modify: 'Corrected', reject: 'Ignored', pause: 'Paused',
    weekday: 'Weekdays', weekdays: 'Weekdays', weekend: 'Weekends', weekends: 'Weekends', everyday: 'Every day'
  },
  it: {
    learningTitle: 'Cosa ricorda Cerebrum dalle conversazioni', memoryTitle: 'Cosa ha imparato Cerebrum sulla casa',
    learningIntro: 'Consulta istruzioni, fatti e scambi recenti attualmente conservati dalle conversazioni.',
    memoryIntro: 'Esplora le abitudini osservate, le decisioni degli occupanti e le prove conservate sulla casa.',
    shared: 'Memoria condivisa: i nodi che usano lo stesso archivio possono leggere questi ricordi.',
    authority: 'Educazione AI resta il riferimento per le tue istruzioni e i permessi. I ricordi appresi sono osservazioni e contesto, non nuovi permessi.',
    retention: 'Qui trovi i dati attualmente conservati. Gli scambi recenti non rappresentano la cronologia completa delle conversazioni.',
    loading: 'Caricamento dei ricordi salvati…', unloaded: 'I ricordi salvati non sono ancora stati caricati.',
    parseError: 'Impossibile mostrare questi ricordi. Il contenuto salvato non è disponibile o ha un formato non valido.',
    operationError: 'L’ultima operazione non è stata completata. Qui sotto resta visibile l’ultima memoria caricata correttamente.',
    updated: 'Ultimo aggiornamento', created: 'Creato', sessions: 'Conversazioni', instructions: 'Ricordi dalle chat', turns: 'Scambi recenti', watches: 'Sorveglianze telecamera',
    habits: 'Abitudini', decisions: 'Decisioni degli occupanti', objects: 'Oggetti conosciuti', observations: 'Osservazioni', notifications: 'Messaggi inviati', all: 'Tutti i ricordi',
    search: 'Cerca nei ricordi conservati', searchHint: 'Cerca testo, dispositivi, fonti o prove', clear: 'Rimuovi filtri', allSessions: 'Tutte le conversazioni', allStatuses: 'Tutti gli stati delle abitudini',
    session: 'Conversazione', status: 'Stato', empty: 'Nessun ricordo ancora conservato in questa categoria.', noMatches: 'Nessun ricordo conservato corrisponde a questi filtri.',
    showing: 'Visualizzati', of: 'di', previous: 'Precedenti', next: 'Successivi', page: 'Pagina',
    fullText: 'Leggi il testo completo', details: 'Tutti i dettagli salvati', recorded: 'Registrato', unknown: 'Non registrato',
    occupant: 'Occupante', cerebrum: 'Cerebrum', instruction: 'Ricordo da una conversazione', exchange: 'Scambio in chat',
    camera: 'Telecamera', event: 'Evento', scope: 'Zona o ambito', objectTypes: 'Oggetti rilevati', cooldown: 'Intervallo minimo tra avvisi', snapshot: 'Invia istantanea', language: 'Lingua',
    yes: 'Sì', no: 'No', seconds: 'secondi', minutes: 'minuti',
    pattern: 'Schema osservato', value: 'Valore', time: 'Orario', days: 'Giorni', samples: 'Osservazioni', distinctDays: 'Giorni distinti', span: 'Giorni tra la prima e l’ultima osservazione', confidence: 'Confidenza',
    evidence: 'Su cosa si basa', override: 'Correzione dell’occupante', note: 'Nota dell’occupante', proposal: 'Domanda inviata all’occupante',
    firstSeen: 'Prima osservazione', lastSeen: 'Ultima osservazione', observedDates: 'Date osservate', averageOpen: 'Durata media di apertura',
    source: 'Fonte', objectId: 'Identificativo oggetto', area: 'Stanza o zona', kind: 'Tipo di oggetto', operation: 'Decisione', habit: 'Abitudine collegata',
    message: 'Messaggio', reason: 'Motivo', refresh: 'Dettagli della raccolta', lastTick: 'Ultimo ciclo di aggiornamento', haRefreshes: 'Aggiornamenti Home Assistant', haErrors: 'Errori Home Assistant', knxReads: 'Letture di stato KNX', lastError: 'Ultimo errore di raccolta',
    learning: 'In apprendimento', pending_confirmation: 'In attesa di conferma', confirmed: 'Confermata', rejected: 'Ignorata', paused: 'In pausa', confirm: 'Confermata', modify: 'Corretta', reject: 'Ignorata', pause: 'In pausa',
    weekday: 'Giorni feriali', weekdays: 'Giorni feriali', weekend: 'Fine settimana', weekends: 'Fine settimana', everyday: 'Ogni giorno'
  }
}

const locale = computed(() => String(props.language).toLowerCase().startsWith('it') ? 'it' : 'en')
const t = computed(() => COPY[locale.value])
const isLearning = computed(() => props.mode === 'learning')
const search = ref('')
const category = ref('all')
const sessionFilter = ref('')
const statusFilter = ref('')
const page = ref(1)
const pageSize = 12
const present = value => value !== undefined && value !== null && value !== ''
const object = value => value && typeof value === 'object' && !Array.isArray(value)
const array = value => Array.isArray(value) ? value : []
const text = value => !present(value) ? '' : typeof value === 'string' ? value : JSON.stringify(value)
const translated = value => t.value[value] || text(value) || t.value.unknown
const field = (label, value) => ({ label, value: present(value) ? text(value) : t.value.unknown })
const fieldsPresent = entries => entries.filter(([, value]) => present(value)).map(([label, value]) => field(label, value))
const date = value => {
  if (!present(value)) return t.value.unknown
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? text(value) : new Intl.DateTimeFormat(locale.value, { dateStyle: 'medium', timeStyle: 'short' }).format(parsed)
}
const minute = value => {
  if (!present(value) || !Number.isFinite(Number(value))) return t.value.unknown
  const rounded = Math.round(Number(value))
  if (rounded < 0 || rounded > 1439) return text(value)
  return `${String(Math.floor(rounded / 60)).padStart(2, '0')}:${String(rounded % 60).padStart(2, '0')}`
}
const percent = value => present(value) && Number.isFinite(Number(value)) ? `${Math.round(Number(value) * 100)}%` : t.value.unknown
const parseResult = computed(() => {
  if (!props.content.trim()) return { data: null, error: '' }
  try {
    const data = isLearning.value ? parseChatLearningNativeFile(props.content) : parseCerebrumMemoryJson(props.content)
    if (!isLearning.value) {
      const keys = ['habits', 'habitDecisions', 'observations', 'notifications', 'semanticObjects', 'states']
      if (!keys.some(key => Array.isArray(data[key]))) throw new Error('Expected home-memory collections')
      keys.forEach(key => {
        if (data[key] !== undefined && (!Array.isArray(data[key]) || data[key].some(item => !object(item)))) throw new Error(`Invalid home-memory collection: ${key}`)
      })
    }
    return { data, error: '' }
  } catch (error) {
    return { data: null, error: String(error.message || error) }
  }
})
const data = computed(() => parseResult.value.data)
const sessions = computed(() => {
  const channels = new Map(array(data.value?.sessions).map(session => [session.id, session]))
  array(data.value?.turns).forEach(turn => {
    if (turn.channel && !channels.has(turn.channel)) channels.set(turn.channel, { id: turn.channel })
  })
  return Array.from(channels.values())
})
const recordDate = row => row.at || row.updatedAt || row.createdAt || row.decidedAt || row.firstSeenAt || ''
const rows = computed(() => {
  if (!data.value) return []
  const result = []
  const add = (type, item, index, session = '') => result.push({ type, item, session, at: recordDate(item), key: `${type}:${session}:${index}`, searchText: `${session}\n${JSON.stringify(item)}`.toLocaleLowerCase() })
  if (isLearning.value) {
    array(data.value.instructions).forEach((item, index) => add('instructions', item, index))
    array(data.value.turns).forEach((item, index) => add('turns', item, index, item.channel || ''))
    sessions.value.forEach(session => {
      array(session.instructions).forEach((item, index) => add('instructions', item, index, session.id))
      array(session.turns).forEach((item, index) => add('turns', item, index, session.id))
      array(session.cameraWatches).forEach((item, index) => add('watches', item, index, session.id))
    })
  } else {
    [['habits', 'habits'], ['decisions', 'habitDecisions'], ['objects', 'semanticObjects'], ['observations', 'observations'], ['notifications', 'notifications']].forEach(([type, key]) => {
      array(data.value[key]).forEach((item, index) => add(type, item, index))
    })
  }
  return result.sort((a, b) => (Date.parse(b.at) || 0) - (Date.parse(a.at) || 0))
})
const categories = computed(() => {
  const types = isLearning.value ? ['instructions', 'turns', 'watches'] : ['habits', 'decisions', 'objects', 'observations', 'notifications']
  return [{ key: 'all', count: rows.value.length }, ...types.map(key => ({ key, count: rows.value.filter(row => row.type === key).length }))]
})
const statuses = computed(() => Array.from(new Set(rows.value.filter(row => row.type === 'habits').map(row => row.item.status).filter(Boolean))))
const filteredRows = computed(() => {
  const query = search.value.trim().toLocaleLowerCase()
  return rows.value.filter(row => (props.instructionsOnly ? row.type === 'instructions' : category.value === 'all' || row.type === category.value) && (!query || row.searchText.includes(query)) && (!sessionFilter.value || row.session === sessionFilter.value) && (!statusFilter.value || (row.type === 'habits' && row.item.status === statusFilter.value)))
})
const pages = computed(() => Math.max(1, Math.ceil(filteredRows.value.length / pageSize)))
const pageRows = computed(() => filteredRows.value.slice((page.value - 1) * pageSize, page.value * pageSize).map(row => ({ ...row, card: buildCard(row) })))
const hasFilters = computed(() => search.value || sessionFilter.value || statusFilter.value || category.value !== 'all')
const resetFilters = () => { search.value = ''; sessionFilter.value = ''; statusFilter.value = ''; category.value = 'all'; page.value = 1 }
watch([search, category, sessionFilter, statusFilter, () => props.mode], () => { page.value = 1 })
watch(() => props.mode, resetFilters)
watch(pages, value => { page.value = Math.min(page.value, value) })

const habitLabels = computed(() => new Map(array(data.value?.habits).map(habit => [habit.id, habit.label || habit.objectId || habit.ga || habit.id])))
const buildCard = row => {
  const item = row.item
  const card = { title: item.label || item.objectId || item.ga || item.id || t.value[row.type], fields: [], sections: [], status: '', body: '' }
  const section = (label, content) => { if (present(content)) card.sections.push({ label, text: text(content) }) }
  const addFields = entries => card.fields.push(...fieldsPresent(entries))
  if (row.type === 'instructions') {
    card.title = t.value.instruction
    card.body = item.text
  } else if (row.type === 'turns') {
    card.title = t.value.exchange
    section(t.value.occupant, item.question)
    section(t.value.cerebrum, item.reply)
  } else if (row.type === 'watches') {
    card.title = item.cameraName || item.cameraId || t.value.camera
    addFields([[t.value.event, item.eventType], [t.value.scope, item.scopeName || item.scopeId], [t.value.objectTypes, array(item.objectTypes).join(', ')], [t.value.cooldown, present(item.cooldownSeconds) ? `${item.cooldownSeconds} ${t.value.seconds}` : ''], [t.value.snapshot, typeof item.sendSnapshot === 'boolean' ? (item.sendSnapshot ? t.value.yes : t.value.no) : ''], [t.value.language, item.language]])
  } else if (row.type === 'habits') {
    card.status = translated(item.status)
    addFields([[t.value.source, item.source], [t.value.objectId, item.objectId || item.ga], [t.value.area, item.area]])
    if (item.type === 'temporal_state_pattern') {
      section(t.value.pattern, `${t.value.value}: ${present(item.value) ? text(item.value) : t.value.unknown}\n${t.value.time}: ${minute(item.averageMinuteOfDay)} · ${t.value.days}: ${translated(item.dayType)}`)
    } else if (present(item.averageMinutes)) {
      addFields([[t.value.averageOpen, `${item.averageMinutes} ${t.value.minutes}`]])
    }
    const evidence = fieldsPresent([[t.value.samples, item.samples], [t.value.distinctDays, item.observationDays], [t.value.span, item.observationSpanDays], [t.value.confidence, present(item.confidence) ? percent(item.confidence) : '']])
    if (evidence.length) section(t.value.evidence, evidence.map(entry => `${entry.label}: ${entry.value}`).join(' · '))
    if (object(item.userOverride)) {
      const override = item.userOverride
      const correction = fieldsPresent([[t.value.value, override.value], [t.value.time, present(override.timeMinute) ? minute(override.timeMinute) : ''], [t.value.days, present(override.dayType) ? translated(override.dayType) : ''], [t.value.note, override.note]])
      if (correction.length) section(t.value.override, correction.map(entry => `${entry.label}: ${entry.value}`).join('\n'))
    }
    section(t.value.note, item.userMessage)
    section(t.value.proposal, item.proposalMessage)
    addFields([[t.value.firstSeen, item.firstSeenAt ? date(item.firstSeenAt) : ''], [t.value.lastSeen, item.updatedAt ? date(item.updatedAt) : '']])
    section(t.value.observedDates, array(item.observedDates).join(', '))
  } else if (row.type === 'decisions') {
    card.title = habitLabels.value.get(item.habitId) || item.habitId || t.value.decisions
    card.status = translated(item.operation)
    section(t.value.note, item.userMessage)
    if (object(item.userOverride)) {
      const override = item.userOverride
      const correction = fieldsPresent([[t.value.value, override.value], [t.value.time, present(override.timeMinute) ? minute(override.timeMinute) : ''], [t.value.days, present(override.dayType) ? translated(override.dayType) : ''], [t.value.note, override.note]])
      if (correction.length) section(t.value.override, correction.map(entry => `${entry.label}: ${entry.value}`).join('\n'))
    }
    addFields([[t.value.session, item.sessionId], [t.value.habit, item.habitId]])
  } else if (row.type === 'objects') {
    addFields([[t.value.objectId, item.objectId || item.ga], [t.value.source, item.source], [t.value.area, item.area], [t.value.kind, item.kind], [t.value.confidence, present(item.confidence) ? percent(item.confidence) : ''], ['DPT', item.dpt]])
  } else if (row.type === 'observations') {
    addFields([[t.value.event, item.event || item.type], [t.value.value, item.value], [t.value.source, item.source], [t.value.objectId, item.objectId || item.ga], [t.value.area, item.area]])
    section(t.value.message, item.message || item.summary)
    section(t.value.reason, item.reason)
  } else if (row.type === 'notifications') {
    card.body = item.message || item.summary || ''
    section(t.value.reason, item.reason)
    addFields([[t.value.event, item.type], [t.value.objectId, item.objectId || item.ga], [t.value.session, item.sessionId]])
  }
  return card
}

const collectionFields = computed(() => {
  if (isLearning.value || !data.value) return []
  const reconciler = object(data.value.reconciler) ? data.value.reconciler : {}
  return fieldsPresent([[t.value.created, data.value.createdAt ? date(data.value.createdAt) : ''], [t.value.lastTick, reconciler.lastTickAt ? date(reconciler.lastTickAt) : ''], [t.value.haRefreshes, reconciler.homeAssistantRefreshCount], [t.value.haErrors, reconciler.homeAssistantErrorCount], [t.value.knxReads, reconciler.autonomousReadCount], [t.value.lastError, reconciler.lastError]])
})
</script>

<template>
  <section class="shared-insights" data-cerebrum-localized :aria-label="isLearning ? t.learningTitle : t.memoryTitle" :aria-busy="loading">
    <header v-if="!instructionsOnly" class="insights-intro">
      <h3>{{ isLearning ? t.learningTitle : t.memoryTitle }}</h3>
      <p>{{ isLearning ? t.learningIntro : t.memoryIntro }}</p>
      <p class="insights-note">{{ t.shared }} {{ t.authority }}</p>
      <div v-if="data" class="insights-meta">
        <span>{{ t.updated }}: {{ date(data.updatedAt) }}</span>
        <span v-if="isLearning">{{ sessions.length }} {{ t.sessions.toLocaleLowerCase() }}</span>
      </div>
    </header>

    <div v-if="error && data" class="insights-error" role="alert">
      <p>{{ t.operationError }}</p>
      <p>{{ error }}</p>
      <p>{{ t.updated }}: {{ date(data.updatedAt) }}</p>
    </div>
    <p v-if="loading" class="insights-state" role="status">{{ t.loading }}</p>
    <div v-else-if="parseResult.error || (error && !data)" class="insights-error" role="alert">
      <p>{{ t.parseError }}</p>
      <p>{{ error || parseResult.error }}</p>
    </div>
    <p v-else-if="!data" class="insights-state" role="status">{{ t.unloaded }}</p>
    <template v-else>
      <div v-if="!instructionsOnly" class="insights-categories" :aria-label="t.all">
        <button v-for="entry in categories" :key="entry.key" type="button" :class="{ selected: category === entry.key }" :aria-pressed="category === entry.key" @click="category = entry.key; statusFilter = ''">
          <strong>{{ entry.count }}</strong><span>{{ t[entry.key] }}</span>
        </button>
      </div>

      <div v-if="!instructionsOnly" class="insights-filters">
        <label class="insights-search"><span>{{ t.search }}</span><input v-model="search" type="search" :placeholder="t.searchHint" /></label>
        <label v-if="isLearning && sessions.length"><span>{{ t.session }}</span><select v-model="sessionFilter"><option value="">{{ t.allSessions }}</option><option v-for="(session, index) in sessions" :key="`${session.id}:${index}`" :value="session.id">{{ session.id }}</option></select></label>
        <label v-if="!isLearning && statuses.length && (category === 'habits' || category === 'all')"><span>{{ t.status }}</span><select v-model="statusFilter"><option value="">{{ t.allStatuses }}</option><option v-for="status in statuses" :key="status" :value="status">{{ translated(status) }}</option></select></label>
        <button v-if="hasFilters" type="button" class="insights-clear" @click="resetFilters">{{ t.clear }}</button>
      </div>

      <p v-if="!instructionsOnly || pages > 1" class="insights-results" role="status">{{ t.showing }} {{ filteredRows.length ? (page - 1) * pageSize + 1 : 0 }}–{{ Math.min(page * pageSize, filteredRows.length) }} {{ t.of }} {{ filteredRows.length }}</p>
      <p v-if="!pageRows.length" class="insights-state">{{ search || sessionFilter || statusFilter ? t.noMatches : t.empty }}</p>
      <div v-else class="insights-cards" :class="{ 'insights-instructions': instructionsOnly }">
        <article v-for="row in pageRows" :key="row.key" class="insights-card">
          <div v-if="!instructionsOnly" class="insights-card-heading"><span class="insights-kind">{{ t[row.type] }}</span><span v-if="row.card.status" class="insights-status">{{ row.card.status }}</span></div>
          <h4 v-if="!instructionsOnly">{{ row.card.title }}</h4>
          <div v-if="!instructionsOnly" class="insights-meta"><span>{{ t.recorded }}: {{ date(row.at) }}</span><span v-if="row.session">{{ t.session }}: {{ row.session }}</span></div>
          <template v-if="row.card.body">
            <p class="insights-text" :class="{ 'insights-preview': !instructionsOnly && row.card.body.length > 400 }">{{ row.card.body }}</p>
            <details v-if="!instructionsOnly && row.card.body.length > 400" class="insights-text-details"><summary>{{ t.fullText }}</summary><p class="insights-text">{{ row.card.body }}</p></details>
          </template>
          <dl v-if="row.card.fields.length" class="insights-fields"><div v-for="(entry, index) in row.card.fields" :key="index"><dt>{{ entry.label }}</dt><dd>{{ entry.value }}</dd></div></dl>
          <div v-for="(entry, index) in row.card.sections" :key="index" class="insights-section">
            <h5>{{ entry.label }}</h5>
            <p class="insights-text" :class="{ 'insights-preview': entry.text.length > 400 }">{{ entry.text }}</p>
            <details v-if="entry.text.length > 400" class="insights-text-details"><summary>{{ t.fullText }}</summary><p class="insights-text">{{ entry.text }}</p></details>
          </div>
          <details class="insights-details"><summary>{{ t.details }}</summary><pre>{{ JSON.stringify(row.item, null, 2) }}</pre></details>
        </article>
      </div>
      <nav v-if="pages > 1" class="insights-pagination" :aria-label="t.page">
        <button type="button" :disabled="page <= 1" @click="page -= 1">{{ t.previous }}</button><span>{{ t.page }} {{ page }} {{ t.of }} {{ pages }}</span><button type="button" :disabled="page >= pages" @click="page += 1">{{ t.next }}</button>
      </nav>
      <p v-if="!instructionsOnly" class="insights-note insights-retention">{{ t.retention }}</p>
      <details v-if="collectionFields.length" class="insights-details insights-collection"><summary>{{ t.refresh }}</summary><dl class="insights-fields"><div v-for="(entry, index) in collectionFields" :key="index"><dt>{{ entry.label }}</dt><dd>{{ entry.value }}</dd></div></dl></details>
    </template>
  </section>
</template>

<style scoped>
.shared-insights { color: var(--text, #333); min-width: 0; }
.insights-intro { margin-bottom: 20px; }
.insights-intro h3 { margin: 0 0 8px; font-size: 1.2rem; line-height: 1.4; }
.insights-intro p { margin: 6px 0; line-height: 1.6; }
.insights-note, .insights-meta, .insights-results { color: var(--muted, #666); font-size: .85rem; line-height: 1.55; }
.insights-meta { display: flex; flex-wrap: wrap; gap: 6px 20px; margin: 9px 0; overflow-wrap: anywhere; }
.insights-categories { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 8px; margin-bottom: 18px; }
.insights-categories button { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; padding: 12px; border: 1px solid var(--line, #ddd); border-radius: 6px; background: var(--panel, white); color: inherit; text-align: left; cursor: pointer; }
.insights-categories button strong { font-size: 1.3rem; }
.insights-categories button span { font-size: .82rem; }
.insights-categories button.selected { border-color: var(--accent, #ff9800); box-shadow: inset 0 3px 0 var(--accent, #ff9800); }
.insights-filters { display: flex; flex-wrap: wrap; align-items: end; gap: 12px; }
.insights-filters label { display: flex; flex-direction: column; gap: 6px; min-width: 0; flex: 1 1 180px; }
.insights-filters label > span { font-size: .82rem; font-weight: 600; }
.insights-filters .insights-search { flex: 2 1 280px; }
.insights-filters input, .insights-filters select { min-height: 42px; padding: 8px 10px; width: 100%; border: 1px solid var(--line, #ddd); border-radius: 6px; background: var(--panel, white); color: inherit; }
.insights-filters input::placeholder { color: var(--muted, #666); }
.insights-clear, .insights-pagination button { min-height: 40px; padding: 8px 12px; border: 1px solid var(--line, #ddd); border-radius: 6px; background: var(--panel, white); color: inherit; cursor: pointer; }
button:focus-visible, input:focus-visible, select:focus-visible, summary:focus-visible { outline: 2px solid var(--accent, #ff9800); outline-offset: 3px; }
.insights-state { padding: 24px 18px; background: var(--panel-soft, #efefef); border-radius: 6px; line-height: 1.6; }
.insights-error { padding: 12px 18px; border: 1px solid var(--err-border, #d95b63); border-radius: 6px; line-height: 1.6; overflow-wrap: anywhere; }
.insights-results { margin: 16px 0 10px; }
.insights-cards { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); align-items: start; gap: 12px; }
.insights-instructions { grid-template-columns: minmax(0, 1fr); }
.insights-instructions .insights-text { margin-top: 0; }
.insights-card { min-width: 0; padding: 18px; border: 1px solid var(--line, #ddd); border-radius: 8px; background: var(--panel, white); overflow-wrap: anywhere; }
.insights-card-heading { display: flex; justify-content: space-between; flex-wrap: wrap; align-items: center; gap: 8px; }
.insights-kind { color: var(--muted, #666); font-size: .76rem; font-weight: 600; }
.insights-status { padding: 3px 8px; font-size: .76rem; border: 1px solid var(--accent, #ff9800); border-radius: 20px; }
.insights-card h4 { margin: 12px 0 6px; font-size: 1rem; line-height: 1.4; }
.insights-card .insights-meta { font-size: .76rem; }
.insights-text { white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.6; margin: 10px 0; font-size: .9rem; }
.insights-preview { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 4; line-clamp: 4; overflow: hidden; }
.insights-fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px 16px; margin: 16px 0; }
.insights-fields div { min-width: 0; }
.insights-fields dt { font-size: .75rem; color: var(--muted, #666); margin-bottom: 4px; }
.insights-fields dd { font-size: .85rem; line-height: 1.5; margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
.insights-section { padding-top: 12px; border-top: 1px solid var(--line, #ddd); margin-top: 12px; }
.insights-section h5 { font-size: .8rem; margin: 0; }
.insights-section .insights-text { font-size: .85rem; }
.insights-details, .insights-text-details { margin-top: 12px; font-size: .8rem; }
.insights-details { border-top: 1px solid var(--line, #ddd); padding-top: 12px; }
.insights-details summary, .insights-text-details summary { cursor: pointer; color: var(--muted, #666); line-height: 1.5; }
.insights-details pre { margin: 12px 0 0; padding: 12px; background: var(--panel-soft, #efefef); border-radius: 4px; white-space: pre-wrap; overflow-wrap: anywhere; max-height: 500px; overflow: auto; font-size: .75rem; line-height: 1.6; }
.insights-pagination { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; margin-top: 20px; font-size: .85rem; }
.insights-pagination button:disabled { opacity: .45; cursor: default; }
.insights-retention { margin-top: 20px; }
.insights-collection { margin-top: 16px; }
@media (max-width: 850px) { .insights-cards { grid-template-columns: minmax(0, 1fr); } }
@media (max-width: 480px) { .insights-card { padding: 14px; } .insights-categories { grid-template-columns: repeat(2, minmax(0, 1fr)); } .insights-fields { grid-template-columns: minmax(0, 1fr); } .insights-pagination { justify-content: center; } }
</style>
