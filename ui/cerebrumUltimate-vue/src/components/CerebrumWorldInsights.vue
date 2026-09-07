<script setup>
import { computed, defineComponent, h, onBeforeUnmount, ref, watch } from "vue";

const props = defineProps({
  nodeId: { type: String, default: "" },
  language: { type: String, default: "it" },
  mode: { type: String, default: "learning" },
  request: { type: Function, required: true },
});

const italian = computed(() => props.language.toLowerCase().startsWith("it"));
const words = (it, en) => italian.value ? it : en;
const collections = {
  learning: ["patterns"],
  goals: ["goals"],
  research: ["knowledge", "researchHistory"],
  memory: ["entities", "situations", "expectations", "evidence", "episodes"],
  operations: ["actionHistory", "episodes"],
};
const labels = {
  goals: ["Obiettivi di comfort", "Comfort goals"],
  patterns: ["Comportamenti osservati", "Observed behaviour"],
  knowledge: ["Conoscenze dal Web", "Web knowledge"],
  entities: ["Stato della casa", "House state"],
  situations: ["Situazioni da valutare", "Situations under review"],
  expectations: ["Routine attese", "Expected routines"],
  evidence: ["Osservazioni", "Observations"],
  episodes: ["Ragionamenti ed esiti", "Reasoning and outcomes"],
  actionHistory: ["Azioni autonome", "Autonomous actions"],
  researchHistory: ["Ricerche Web", "Web research"],
};
const fieldLabels = {
  id: ["Identificativo", "ID"], source: ["Integrazione", "Integration"], objectId: ["Dispositivo nell’integrazione", "Integration device ID"],
  label: ["Nome", "Name"], area: ["Ambiente", "Room"], kind: ["Tipo", "Kind"], type: ["Tipo", "Type"], value: ["Valore", "Value"],
  observedAt: ["Osservato", "Observed"], verifiedAt: ["Confermato dal dispositivo", "Device feedback received"], changedAt: ["Ultima variazione", "Last change"],
  fresh: ["Dato recente", "Fresh data"], available: ["Disponibile", "Available"], evidenceId: ["Riferimento all’osservazione", "Observation reference"],
  evidenceIds: ["Riferimenti alle osservazioni", "Observation references"], entityId: ["Riferimento al dispositivo", "Device reference"],
  entityIds: ["Dispositivi di riferimento", "Device references"], status: ["Stato", "Status"], summary: ["Sintesi", "Summary"],
  createdAt: ["Creato", "Created"], updatedAt: ["Aggiornato", "Updated"], dueAt: ["Prossima valutazione / scadenza", "Next review / deadline"],
  lastReasonAt: ["Ultima valutazione", "Last review"], expected: ["Risultato da verificare", "Result to verify"], expectedValue: ["Valore atteso", "Expected value"],
  habitId: ["Routine di riferimento", "Routine reference"], windowStartAt: ["Inizio finestra attesa", "Expected window starts"],
  origin: ["Origine", "Origin"], topic: ["Argomento", "Topic"], goalId: ["Obiettivo di riferimento", "Goal reference"],
  comfortBenefit: ["Beneficio per gli occupanti", "Benefit for occupants"], successCriterion: ["Come valutare il beneficio", "How to evaluate the benefit"],
  plan: ["Piano", "Plan"], assessment: ["Valutazione attuale", "Current assessment"], baseline: ["Situazione iniziale", "Baseline"],
  current: ["Osservazioni attuali", "Current observations"], support: ["Osservazioni alla base dell’obiettivo", "Supporting observations"],
  reviews: ["Revisioni conservate", "Retained reviews"], patternIds: ["Comportamenti di riferimento", "Behaviour references"],
  sourceIds: ["Fonti di riferimento", "Source references"], comfortConfirmed: ["Comfort confermato dagli occupanti", "Comfort confirmed by occupants"],
  signature: ["Ambito dell’obiettivo", "Goal scope"], dayType: ["Giorni", "Days"], hour: ["Fascia oraria locale", "Local hour"],
  observedDays: ["Giornate distinte", "Distinct days"], occurrences: ["Variazioni osservate", "Observed transitions"],
  firstObserved: ["Prima osservazione conservata", "First retained observation"], lastObserved: ["Ultima osservazione", "Last observation"],
  numeric: ["Misure ricevute", "Received measurements"], count: ["Campioni", "Samples"], min: ["Minimo", "Minimum"], max: ["Massimo", "Maximum"], mean: ["Media", "Mean"],
  categoricalValues: ["Valori osservati", "Observed values"], unlistedValues: ["Valori oltre il limite di dettaglio", "Values beyond the detail limit"],
  originObservations: ["Esempi delle osservazioni originali", "Original observation samples"], dataCoverage: ["Copertura e limiti dei dati", "Data coverage and limits"],
  url: ["Fonte", "Source"], title: ["Titolo", "Title"], text: ["Testo conservato", "Retained text"], authority: ["Come viene usata la fonte", "How this source is used"],
  retrievedAt: ["Consultata", "Retrieved"], expiresAt: ["Validità della copia locale fino a", "Local copy valid until"], excerptOnly: ["Solo estratto del risultato di ricerca", "Search result excerpt only"],
  previousValue: ["Valore precedente", "Previous value"], at: ["Data e ora", "Date and time"], outcome: ["Esito", "Outcome"],
  situationId: ["Situazione di riferimento", "Situation reference"], targetId: ["Destinazione", "Target"], requestedValue: ["Valore richiesto", "Requested value"],
  disposition: ["Decisione", "Decision"], verifyBy: ["Termine della verifica", "Verification deadline"], previousVerifiedAt: ["Conferma precedente del dispositivo", "Previous device feedback"],
  completedAt: ["Concluso", "Completed"], error: ["Problema riscontrato", "Reported problem"], executionResult: ["Risposta all’esecuzione", "Execution response"],
  ok: ["Esito positivo", "Successful"], detail: ["Dettaglio", "Detail"], claim: ["Registrazione prima dell’azione", "Record before dispatch"],
  key: ["Riferimento interno", "Internal reference"], researchTopic: ["Argomento della ricerca", "Research topic"],
  refreshIntervalSeconds: ["Intervallo di aggiornamento (secondi)", "Refresh interval (seconds)"], expectationId: ["Routine attesa di riferimento", "Expected routine reference"],
  claimId: ["Registrazione dell’azione", "Action record"],
};
const statusLabels = {
  observing: ["In osservazione", "Observing"], active: ["In corso", "Active"], paused: ["In pausa", "Paused"], retired: ["Archiviato", "Retired"],
  candidate: ["Ipotesi da consolidare", "Candidate pattern"], recurring: ["Ricorrente", "Recurring"], fresh: ["Dato recente", "Fresh data"], stale: ["Dato da aggiornare", "Stale data"],
  open: ["Da valutare", "Open"], claimed: ["Registrato, esito in attesa", "Recorded, outcome pending"], reserved: ["Prenotato", "Reserved"], verifying: ["Verifica in corso", "Verifying"],
  resolved: ["Concluso", "Resolved"], pending: ["In attesa", "Pending"], observed: ["Osservata", "Observed"], missed: ["Non osservata nella finestra", "Not observed in the time window"], unknown: ["Dati insufficienti", "Insufficient data"],
  succeeded: ["Completata", "Completed"], no_sources: ["Nessuna fonte utilizzabile", "No usable sources"], failed: ["Non riuscita", "Failed"],
  interrupted: ["Interrotta al riavvio", "Interrupted by restart"],
  verified: ["Riscontro del dispositivo confermato", "Device feedback confirmed"], action_mismatch: ["Riscontro diverso da quello atteso", "Unexpected device feedback"],
  action_unverified: ["Riscontro del dispositivo mancante", "Device feedback missing"], action_rejected: ["Azione non eseguita", "Action not dispatched"],
  cancelled: ["Annullato", "Cancelled"], notified: ["Notifica inviata", "Notification sent"], notification_failed: ["Notifica non inviata", "Notification not sent"],
  delivery_unknown: ["Consegna non confermata", "Delivery unconfirmed"], verification_pending: ["In attesa di riscontro", "Awaiting device feedback"],
  execution_uncertain: ["Esito da verificare", "Outcome needs verification"], goal_reviewed: ["Obiettivo riesaminato", "Goal reviewed"],
  act: ["Comando a un dispositivo", "Device command"], notify: ["Notifica", "Notification"], observe: ["Osservazione", "Observation"], resolve: ["Chiusura della situazione", "Situation closed"],
  weekday: ["Feriali", "Weekdays"], weekend: ["Fine settimana", "Weekend"], self_generated: ["Formulato da Cerebrum", "Created by Cerebrum"],
  external_data_only: ["Informazione esterna da valutare", "External information to evaluate"], web: ["Web", "Web"],
  lighting_comfort: ["Comfort luminoso", "Lighting comfort"], thermal_comfort: ["Comfort termico", "Thermal comfort"],
  indoor_air_quality: ["Qualità dell’aria", "Indoor air quality"], quiet_routines: ["Riposo e tranquillità", "Quiet routines"],
  accessible_controls: ["Comandi accessibili", "Accessible controls"], energy_without_discomfort: ["Efficienza senza rinunce al comfort", "Efficiency without discomfort"],
  smart_home_updates: ["Novità per la casa smart", "Smart home updates"],
  assistant_disabled: ["Le azioni sono in pausa perché l’assistente è disattivato.", "Actions are paused because the assistant is disabled."],
  education_missing: ["Per agire in autonomia Cerebrum attende le tue indicazioni nel campo Educazione AI.", "Cerebrum needs your instructions in AI Education before acting autonomously."],
  commands_disabled: ["I comandi ai dispositivi sono disattivati nella configurazione dell’assistente.", "Device commands are disabled in the assistant configuration."],
  confirmation_required: ["La configurazione richiede la tua conferma prima dei comandi ai dispositivi.", "The configuration requires your confirmation before device commands."],
  state_observed: ["Stato osservato", "Observed state"], state_changed: ["Variazione osservata", "Observed transition"], state_change: ["Variazione di stato", "State change"],
  source_stale: ["Fonte da aggiornare", "Stale source"], plan_contradicted: ["Piano da riesaminare", "Plan needs reassessment"],
  expectation_unknown: ["Routine non verificabile", "Routine cannot be verified"], expected_event_missing: ["Evento atteso non osservato", "Expected event not observed"],
  action_feedback: ["Riscontro del dispositivo", "Device feedback"], review_due: ["Revisione programmata", "Scheduled review"],
  daily_review: ["Revisione quotidiana", "Daily review"], goal_review: ["Revisione dell’obiettivo", "Goal review"],
  goal_action_review: ["Valutazione del prossimo passo", "Next step assessment"], goal_feedback: ["Riscontro sul piano", "Plan feedback"],
  research_review: ["Valutazione di una ricerca", "Research review"], missed_expectation: ["Routine attesa non osservata", "Expected routine not observed"],
};

const label = (key) => labels[key] ? words(...labels[key]) : fieldLabels[key] ? words(...fieldLabels[key]) : String(key).replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ");
const statusLabel = (value) => statusLabels[value] ? words(...statusLabels[value]) : String(value || words("Non disponibile", "Unavailable")).replace(/_/g, " ");
const formatDate = (value) => {
  if (!value) return words("Non disponibile", "Unavailable");
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString(italian.value ? "it-IT" : "en-GB", { dateStyle: "medium", timeStyle: "short" });
};
const formatNumber = (value) => typeof value === "number" && Number.isFinite(value) ? value.toLocaleString(italian.value ? "it-IT" : "en-GB", { maximumFractionDigits: 3 }) : String(value ?? "—");
const safeUrl = (value) => {
  try {
    const parsed = new URL(String(value));
    return parsed.protocol === "https:" && !parsed.username && !parsed.password ? parsed.href : "";
  } catch { return ""; }
};
const sourceHost = (value) => {
  const url = safeUrl(value);
  return url ? new URL(url).hostname : words("Fonte non disponibile", "Source unavailable");
};
const isDateField = (key) => /At$/.test(key) || ["at", "firstObserved", "lastObserved", "verifyBy"].includes(key);
const enumFields = new Set(["status", "outcome", "disposition", "dayType", "topic", "researchTopic", "origin", "authority", "type", "kind"]);
const renderValue = (value, key = "") => {
  if (value === null || value === undefined || value === "") return h("span", { class: "wi-muted" }, words("Non disponibile", "Unavailable"));
  if (typeof value === "boolean") return words(value ? "Sì" : "No", value ? "Yes" : "No");
  if (typeof value === "number") return String(value);
  if (typeof value === "string") {
    if (key === "url" && safeUrl(value)) return h("a", { href: safeUrl(value), target: "_blank", rel: "noopener noreferrer", class: "wi-link" }, value);
    if (isDateField(key)) return h("time", { datetime: value, title: value }, formatDate(value));
    return enumFields.has(key) ? statusLabel(value) : value;
  }
  if (Array.isArray(value)) {
    if (!value.length) return h("span", { class: "wi-muted" }, words("Nessuno", "None"));
    return h("ul", { class: "wi-value-list" }, value.map((item, index) => h("li", { key: index }, renderValue(item, key))));
  }
  return h("dl", { class: "wi-nested-fields" }, Object.entries(value).map(([field, item]) => h("div", { key: field }, [h("dt", label(field)), h("dd", [renderValue(item, field)])])));
};
const ValueTree = defineComponent({
  props: { value: { default: null }, field: { type: String, default: "" } },
  setup: (valueProps) => () => h("div", { class: "wi-value" }, [renderValue(valueProps.value, valueProps.field)]),
});

const activeCollections = computed(() => collections[props.mode] || collections.learning);
const collection = ref(activeCollections.value[0]);
const overview = ref(null);
const overviewError = ref("");
const page = ref(null);
const loading = ref(false);
const error = ref("");
const search = ref("");
const status = ref("");
const offset = ref(0);
const previousOffsets = ref([]);
let epoch = 0;
let searchTimer;
let disposed = false;
const items = computed(() => Array.isArray(page.value?.items) ? page.value.items : []);
const blockedCount = computed(() => Array.isArray(page.value?.blockedItems) ? page.value.blockedItems.length : Number(page.value?.blockedItems) || 0);
const availableStatuses = computed(() => {
  const values = page.value?.statuses || overview.value?.statuses?.[collection.value] || [];
  const list = Array.isArray(values) ? values.map(item => typeof item === "string" ? item : item?.value || item?.status).filter(Boolean) : Object.keys(values);
  return [...new Set([...list, ...(status.value ? [status.value] : [])])];
});
const heading = computed(() => words(...({
  learning: ["Quello che Cerebrum sta imparando", "What Cerebrum is learning"],
  goals: ["Gli obiettivi che Cerebrum si pone", "The goals Cerebrum creates"],
  research: ["Quello che Cerebrum scopre sul Web", "What Cerebrum discovers on the Web"],
  memory: ["La casa nella memoria di Cerebrum", "The house in Cerebrum’s memory"],
  operations: ["Come Cerebrum sta agendo", "How Cerebrum is acting"],
}[props.mode] || ["Conoscenze di Cerebrum", "Cerebrum’s knowledge"])));
const introduction = computed(() => words(...({
  learning: ["Le ricorrenze che emergono dal comportamento reale della casa, con le osservazioni su cui si basano.", "Recurring patterns emerging from the house’s actual behaviour, with their supporting observations."],
  goals: ["I miglioramenti che l’AI propone per gli occupanti, perché li ritiene utili e come intende valutarli nel tempo.", "The improvements the AI proposes for occupants, why it considers them useful and how it plans to evaluate them over time."],
  research: ["Le ricerche su comfort e casa smart, le fonti trovate e il testo conservato per valutarne l’applicabilità alla tua casa.", "Research on comfort and smart homes, the sources found and retained text used to assess their relevance to your house."],
  memory: ["I dati che Cerebrum conosce, le situazioni che segue e le osservazioni su cui basa le sue valutazioni.", "The data Cerebrum knows, the situations it follows and the observations behind its assessments."],
  operations: ["Le iniziative autonome e i loro esiti. Un comando confermato dal dispositivo non dimostra, da solo, un miglioramento del comfort.", "Autonomous initiatives and their outcomes. Device feedback alone does not establish an improvement in comfort."],
}[props.mode] || ["Esplora le informazioni conservate per questa casa.", "Explore the information retained for this house."])));
const collectionNote = computed(() => words(...({
  goals: ["Sono ipotesi di miglioramento formulate dall’AI: puoi leggere motivazioni, piano, criterio di valutazione e revisioni. Le preferenze restano quelle di Educazione AI.", "These are improvement hypotheses created by the AI. Explore the reasoning, plan, evaluation criterion and reviews. Preferences still come from AI Education."],
  patterns: ["Le ricorrenze descrivono variazioni ricevute in giornate diverse. Non dimostrano una preferenza degli occupanti né quanto tempo un dispositivo sia rimasto in uno stato.", "Recurring patterns describe transitions received across different days. They do not establish occupant preferences or how long a device stayed in a state."],
  knowledge: ["Le fonti Web sono informazioni esterne da valutare rispetto alla casa. La data di consultazione e la validità della copia locale non sono la data di pubblicazione della fonte.", "Web sources are external information to assess against the house. Retrieval and local expiry dates are not the source’s publication date."],
  entities: ["L’ultimo stato conosciuto di ogni dispositivo. “Dato da aggiornare” significa che Cerebrum non dispone di un’osservazione abbastanza recente.", "The last known state of each device. “Stale data” means Cerebrum does not have a sufficiently recent observation."],
  situations: ["Le questioni che Cerebrum valuta, segue o ha concluso, con prossima valutazione, osservazioni collegate ed eventuale risultato atteso.", "Questions Cerebrum is assessing, following or has closed, with the next review, linked observations and any expected result."],
  expectations: ["Le finestre attese delle routine confermate. Un evento non osservato o un dato mancante non è un ordine a eseguire la routine.", "Expected windows for confirmed routines. An unobserved event or missing data is not an instruction to perform the routine."],
  evidence: ["Le osservazioni e gli eventi conservati a supporto delle decisioni. Nei dettagli trovi provenienza, data e valori disponibili.", "Retained observations and events supporting decisions. Details include provenance, time and available values."],
  episodes: ["Le sintesi delle valutazioni e degli esiti conservati. Mostrano anche osservazioni in corso e verifiche non concluse.", "Retained summaries of assessments and outcomes, including ongoing observations and incomplete verification."],
  actionHistory: ["Le azioni vengono registrate prima dell’invio. Controlla l’esito: avviato, confermato dal dispositivo, non eseguito o ancora da verificare.", "Actions are recorded before dispatch. Check the outcome: started, confirmed by the device, not dispatched or still awaiting verification."],
  researchHistory: ["Le ricerche autonome, il loro argomento e le fonti trovate. Apri Conoscenze dal Web per consultare le fonti ancora conservate.", "Autonomous searches, their topics and the sources found. Open Web knowledge to inspect the sources still retained."],
}[collection.value] || ["", ""])));
const retentionNote = computed(() => {
  const retention = overview.value?.retention || {};
  if (props.mode === "learning") return words(`Ricorrenze: ultimi ${retention.patternsDays || 28} giorni, entro ${overview.value?.limits?.patterns || 240} schemi osservati. Giorni e fasce orarie seguono l’orologio del server Node-RED.`, `Patterns: last ${retention.patternsDays || 28} days, up to ${overview.value?.limits?.patterns || 240} observed patterns. Days and hourly buckets follow the Node-RED server’s clock.`);
  if (props.mode === "goals") return words(`Fino a ${overview.value?.limits?.goals || 40} obiettivi conservati, con le ultime 8 revisioni di ciascuno.`, `Up to ${overview.value?.limits?.goals || 40} retained goals, with the latest 8 reviews of each.`);
  if (props.mode === "research") return words(`Fonti Web: copie locali valide per ${retention.knowledgeDays || 14} giorni, fino a ${overview.value?.limits?.knowledge || 48} fonti. Registro delle ricerche: fino a ${overview.value?.limits?.researchHistory || 60} sessioni negli ultimi ${retention.researchHistoryDays || 30} giorni.`, `Web sources: local copies valid for ${retention.knowledgeDays || 14} days, up to ${overview.value?.limits?.knowledge || 48} sources. Research log: up to ${overview.value?.limits?.researchHistory || 60} sessions in the last ${retention.researchHistoryDays || 30} days.`);
  if (props.mode === "operations") return words(`Il registro generale delle operazioni conserva gli ultimi ${retention.operationsDays || 3} giorni. Le raccolte qui sotto hanno limiti propri.`, `The general operation log retains the last ${retention.operationsDays || 3} days. The collections below have separate limits.`);
  return "";
});
const badgeFor = (item) => {
  if (collection.value === "entities") return item.fresh === true ? "fresh" : "stale";
  if (collection.value === "knowledge") return item.expiresAt && Date.parse(item.expiresAt) <= Date.now() ? "stale" : "external_data_only";
  if (collection.value === "evidence") return item.type || "";
  return item.status || item.outcome || "";
};
const badgeTone = (value) => ["failed", "action_mismatch", "action_rejected", "notification_failed"].includes(value) ? "error" : ["unknown", "stale", "source_stale", "plan_contradicted", "expectation_unknown", "expected_event_missing", "candidate", "action_unverified", "delivery_unknown", "execution_uncertain", "missed"].includes(value) ? "warning" : ["verified", "succeeded", "observed", "notified", "fresh"].includes(value) ? "positive" : "neutral";
const titleFor = (item) => {
  const entityLabel = item.display?.entities?.[0]?.label || "";
  if (collection.value === "researchHistory") return statusLabel(item.topic);
  if (collection.value === "actionHistory") return `${statusLabel(item.disposition)}${entityLabel ? ` · ${entityLabel}` : ""}`;
  if (["entities", "patterns"].includes(collection.value)) return item.label || item.area || label(collection.value);
  if (collection.value === "knowledge") return item.title || sourceHost(item.url);
  return item.summary || item.label || entityLabel || label(collection.value);
};
const timeFor = (item) => item.at || item.updatedAt || item.retrievedAt || item.lastObserved || item.observedAt || item.createdAt;
const detailFields = (item) => Object.entries(item).filter(([key]) => key !== "display");
const load = async () => {
  clearTimeout(searchTimer);
  const currentEpoch = ++epoch;
  if (!props.nodeId || disposed) {
    overview.value = null;
    page.value = null;
    loading.value = false;
    return;
  }
  loading.value = true;
  error.value = "";
  overviewError.value = "";
  const nodePath = `world-model/${encodeURIComponent(props.nodeId)}`;
  const params = new URLSearchParams({ operation: "inspect", collection: collection.value, q: search.value.trim(), status: status.value, limit: "12", offset: String(offset.value) });
  const results = await Promise.allSettled([
    Promise.resolve().then(() => props.request(`${nodePath}?operation=overview`)),
    Promise.resolve().then(() => props.request(`${nodePath}?${params}`)),
  ]);
  if (disposed || currentEpoch !== epoch) return;
  const [summary, records] = results;
  if (summary.status === "fulfilled" && summary.value?.ok !== false) overview.value = summary.value;
  else overviewError.value = summary.status === "rejected" ? String(summary.reason?.message || summary.reason) : String(summary.value?.error || words("Riepilogo non disponibile.", "Overview unavailable."));
  if (records.status === "fulfilled" && records.value?.ok !== false) page.value = records.value;
  else {
    page.value = null;
    error.value = records.status === "rejected" ? String(records.reason?.message || records.reason) : String(records.value?.error || words("Informazioni non disponibili.", "Information unavailable."));
  }
  loading.value = false;
};
const resetPage = () => { offset.value = 0; previousOffsets.value = []; };
const chooseCollection = (value) => {
  collection.value = value;
  search.value = "";
  status.value = "";
  page.value = null;
  resetPage();
  load();
};
const applySearch = () => { resetPage(); load(); };
const scheduleSearch = () => { ++epoch; clearTimeout(searchTimer); searchTimer = setTimeout(applySearch, 350); };
const clearSearch = () => { search.value = ""; status.value = ""; applySearch(); };
const nextPage = () => {
  if (loading.value || page.value?.nextOffset == null) return;
  previousOffsets.value = [...previousOffsets.value, offset.value];
  offset.value = page.value.nextOffset;
  load();
};
const previousPage = () => {
  if (loading.value || !previousOffsets.value.length) return;
  const previous = [...previousOffsets.value];
  offset.value = previous.pop();
  previousOffsets.value = previous;
  load();
};
watch(() => [props.nodeId, props.mode], () => {
  ++epoch;
  clearTimeout(searchTimer);
  overview.value = null;
  page.value = null;
  error.value = "";
  overviewError.value = "";
  chooseCollection(activeCollections.value[0]);
}, { immediate: true });
onBeforeUnmount(() => { disposed = true; ++epoch; clearTimeout(searchTimer); });
</script>

<template>
  <section class="world-insights" data-cerebrum-localized :aria-label="heading">
    <header class="wi-header">
      <div>
        <h3>{{ heading }}</h3>
      </div>
      <button type="button" class="wi-button" :disabled="loading || !nodeId" @click="load">{{ loading ? words("Aggiornamento…", "Refreshing…") : words("Aggiorna", "Refresh") }}</button>
    </header>

    <p v-if="!nodeId" class="wi-empty">{{ words("Seleziona un nodo Cerebrum per esplorare ciò che ha appreso.", "Select a Cerebrum node to explore what it has learned.") }}</p>
    <template v-else>
      <details class="memory-file-tools wi-tools">
        <summary>{{ words("Filtri, raccolte e stato di Cerebrum", "Filters, collections and Cerebrum status") }}</summary>
        <p class="wi-intro">{{ introduction }}</p>
      <div v-if="overview" class="wi-activity">
        <span class="wi-badge" :class="overview.activity?.enabled ? 'positive' : 'neutral'">{{ overview.activity?.enabled ? words("Cerebrum attivo", "Cerebrum active") : words("Ragionamento in pausa", "Reasoning paused") }}</span>
        <span>{{ overview.activity?.actionsEnabled ? words("Azioni autonome abilitate", "Autonomous actions enabled") : words("Azioni autonome non abilitate", "Autonomous actions disabled") }}</span>
        <span>{{ overview.activity?.webEnabled ? words("Intelligenza Web attiva", "Web intelligence active") : words("Intelligenza Web disattivata", "Web intelligence disabled") }}</span>
        <span v-if="overview.activity?.lastReasonAt">{{ words("Ultima valutazione: ", "Last assessment: ") }}{{ formatDate(overview.activity.lastReasonAt) }}</span>
      </div>
      <p v-if="overview?.activity?.actionsReason && !overview.activity.actionsEnabled" class="wi-note">{{ statusLabel(overview.activity.actionsReason) }}</p>
      <p v-if="overview?.activity?.lastError" class="wi-feedback warning" role="status">{{ words("Ultimo problema registrato: ", "Last recorded problem: ") }}{{ overview.activity.lastError }}</p>
      <p v-if="overviewError" class="wi-feedback warning" role="status">{{ words("Riepilogo non disponibile: ", "Overview unavailable: ") }}{{ overviewError }}</p>

      <div class="wi-collections" :aria-label="words('Raccolte di informazioni', 'Information collections')">
        <button v-for="name in activeCollections" :key="name" type="button" class="wi-collection" :class="{ selected: collection === name }" :aria-pressed="collection === name" @click="chooseCollection(name)">
          <span>{{ label(name) }}</span>
          <strong>{{ overview?.counts?.[name] ?? "—" }}</strong>
          <small>{{ words("elementi conservati", "retained records") }}</small>
        </button>
      </div>

      <p class="wi-note">{{ collectionNote }}</p>
      <form class="wi-filters" @submit.prevent="applySearch">
        <label class="wi-search">
          <span>{{ words("Cerca in questa raccolta", "Search this collection") }}</span>
          <input v-model="search" type="search" :placeholder="words('Nome, ambiente, argomento o riferimento…', 'Name, room, topic or reference…')" maxlength="500" @input="scheduleSearch" />
        </label>
        <label class="wi-status-filter">
          <span>{{ words("Stato", "Status") }}</span>
          <select v-model="status" @change="applySearch">
            <option value="">{{ words("Tutti gli stati", "All statuses") }}</option>
            <option v-for="value in availableStatuses" :key="value" :value="value">{{ statusLabel(value) }}</option>
          </select>
        </label>
        <button type="submit" class="wi-button" :disabled="loading">{{ words("Cerca", "Search") }}</button>
        <button v-if="search || status" type="button" class="wi-button wi-quiet" @click="clearSearch">{{ words("Azzera filtri", "Clear filters") }}</button>
      </form>

      </details>
      <div class="wi-collection-heading">
        <h4>{{ label(collection) }}</h4>
      </div>
      <div class="wi-results" :aria-busy="loading">
        <p v-if="loading" class="wi-empty" role="status">{{ words("Caricamento delle informazioni…", "Loading information…") }}</p>
        <div v-else-if="error" class="wi-feedback error" role="alert">
          <p>{{ words("Impossibile caricare questa raccolta. ", "Unable to load this collection. ") }}{{ error }}</p>
          <button type="button" class="wi-button" @click="load">{{ words("Riprova", "Try again") }}</button>
        </div>
        <template v-else-if="page">
          <p class="wi-result-count" aria-live="polite">{{ words("Elementi in questa pagina: ", "Records on this page: ") }}{{ items.length }} · {{ words("Totale con questi filtri: ", "Total matching filters: ") }}{{ page.totalMatches ?? 0 }}</p>
          <p v-if="!items.length && !blockedCount" class="wi-empty">{{ search || status ? words("Nessun elemento corrisponde ai filtri. Prova a modificarli.", "No records match these filters. Try changing them.") : words("Questa raccolta è ancora vuota. Qui compariranno le informazioni quando Cerebrum le avrà osservate o elaborate.", "This collection is still empty. Information will appear here as Cerebrum observes or develops it.") }}</p>
          <article v-for="(item, index) in items" :key="`${collection}:${item.id || index}`" class="wi-card">
            <header class="wi-card-header">
              <div>
                <span v-if="item.area" class="wi-area">{{ item.area }}</span>
                <h5>{{ titleFor(item) }}</h5>
              </div>
              <span v-if="badgeFor(item)" class="wi-badge" :class="badgeTone(badgeFor(item))">{{ statusLabel(badgeFor(item)) }}</span>
            </header>
            <p v-if="item.summary && item.summary !== titleFor(item)" class="wi-summary">{{ item.summary }}</p>
            <p v-if="collection === 'goals' && item.comfortBenefit" class="wi-benefit">{{ item.comfortBenefit }}</p>
            <div v-if="collection === 'entities'" class="wi-state-value"><ValueTree :value="item.value" field="value" /></div>
            <a v-if="collection === 'knowledge' && safeUrl(item.url)" class="wi-link" :href="safeUrl(item.url)" target="_blank" rel="noopener noreferrer">{{ words("Apri la fonte: ", "Open source: ") }}{{ sourceHost(item.url) }} ↗</a>
            <details class="memory-file-tools wi-card-details">
              <summary>{{ words("Dettagli e fonti", "Details and references") }}</summary>
            <div class="wi-card-meta">
              <span v-if="item.source">{{ item.source }}</span>
              <span v-if="timeFor(item)">{{ formatDate(timeFor(item)) }}</span>
              <span v-if="item.topic && collection !== 'researchHistory'">{{ statusLabel(item.topic) }}</span>
            </div>
            <div v-if="item.display?.entities?.length" class="wi-related-entities" :aria-label="words('Dispositivi collegati', 'Related devices')">
              <span v-for="entity in item.display.entities" :key="entity.id">{{ entity.label }}<small v-if="entity.area"> · {{ entity.area }}</small></span>
            </div>

            <template v-if="collection === 'goals'">
              <dl class="wi-key-points">
                <div v-if="item.plan"><dt>{{ label("plan") }}</dt><dd>{{ item.plan }}</dd></div>
                <div v-if="item.assessment"><dt>{{ label("assessment") }}</dt><dd>{{ item.assessment }}</dd></div>
                <div v-if="item.successCriterion"><dt>{{ label("successCriterion") }}</dt><dd>{{ item.successCriterion }}</dd></div>
              </dl>
              <p class="wi-note">{{ item.comfortConfirmed === true ? words("Comfort confermato dagli occupanti.", "Comfort confirmed by occupants.") : words("Beneficio per il comfort da verificare con gli occupanti.", "Comfort benefit still needs confirmation from occupants.") }}</p>
              <p v-if="item.dueAt" class="wi-note">{{ words("Prossima revisione: ", "Next review: ") }}{{ formatDate(item.dueAt) }}</p>
            </template>
            <template v-else-if="collection === 'patterns'">
              <div class="wi-metrics">
                <span><strong>{{ formatNumber(item.observedDays) }}</strong>{{ words("giornate distinte", "distinct days") }}</span>
                <span><strong>{{ formatNumber(item.occurrences) }}</strong>{{ words("variazioni osservate", "observed transitions") }}</span>
                <span v-if="Number.isInteger(item.hour)"><strong>{{ String(item.hour).padStart(2, "0") }}:00–{{ String((item.hour + 1) % 24).padStart(2, "0") }}:00</strong>{{ statusLabel(item.dayType) }}</span>
              </div>
              <p v-if="item.numeric" class="wi-note">{{ words("Misure ricevute — media: ", "Received measurements — mean: ") }}{{ formatNumber(item.numeric.mean) }} · {{ words("minimo: ", "minimum: ") }}{{ formatNumber(item.numeric.min) }} · {{ words("massimo: ", "maximum: ") }}{{ formatNumber(item.numeric.max) }}</p>
              <p class="wi-note">{{ words("Campioni di variazioni ricevute; i periodi senza dati non provano inattività.", "Samples of received transitions; periods without data do not establish inactivity.") }}</p>
            </template>
            <template v-else-if="collection === 'knowledge'">
              <p class="wi-note">{{ item.excerptOnly ? words("Conservato un estratto del risultato di ricerca.", "A search result excerpt is retained.") : words("Conservato il testo estratto dalla pagina, entro i limiti della memoria.", "Text extracted from the page is retained within memory limits.") }}</p>
              <p v-if="item.expiresAt" class="wi-note">{{ words("Copia locale valida fino a: ", "Local copy valid until: ") }}{{ formatDate(item.expiresAt) }}</p>
            </template>
            <template v-else-if="collection === 'entities'">
              <p v-if="item.verifiedAt" class="wi-note">{{ words("Ultimo riscontro dal dispositivo: ", "Last device feedback: ") }}{{ formatDate(item.verifiedAt) }}</p>
            </template>
            <template v-else-if="collection === 'expectations'">
              <dl class="wi-key-points">
                <div><dt>{{ label("expectedValue") }}</dt><dd><ValueTree :value="item.expectedValue" field="expectedValue" /></dd></div>
                <div v-if="item.windowStartAt"><dt>{{ label("windowStartAt") }}</dt><dd>{{ formatDate(item.windowStartAt) }}</dd></div>
                <div v-if="item.dueAt"><dt>{{ words("Fine finestra attesa", "Expected window ends") }}</dt><dd>{{ formatDate(item.dueAt) }}</dd></div>
              </dl>
            </template>
            <template v-else-if="collection === 'actionHistory'">
              <dl class="wi-key-points">
                <div v-if="item.requestedValue !== '' && item.requestedValue != null"><dt>{{ label("requestedValue") }}</dt><dd><ValueTree :value="item.requestedValue" field="requestedValue" /></dd></div>
                <div v-if="item.verifyBy"><dt>{{ label("verifyBy") }}</dt><dd>{{ formatDate(item.verifyBy) }}</dd></div>
              </dl>
            </template>
            <template v-else-if="collection === 'researchHistory'">
              <p class="wi-note">{{ words("Fonti trovate: ", "Sources found: ") }}{{ item.sourceIds?.length || 0 }}</p>
              <p v-if="item.error" class="wi-feedback warning">{{ item.error }}</p>
            </template>
            <p v-else-if="collection === 'situations' && item.dueAt" class="wi-note">{{ words("Prossima valutazione: ", "Next assessment: ") }}{{ formatDate(item.dueAt) }}</p>

            <div class="wi-details">
              <dl class="wi-all-fields">
                <div v-for="[field, value] in detailFields(item)" :key="field" :class="{ 'wi-wide-field': value && typeof value === 'object' || typeof value === 'string' && value.length > 220 }"><dt>{{ label(field) }}</dt><dd><ValueTree :value="value" :field="field" /></dd></div>
              </dl>
            </div>
            </details>
          </article>
          <p v-if="page.limited" class="wi-note">{{ words("Questa pagina è stata ridotta per la dimensione dei dati. Prosegui per vedere gli altri elementi.", "This page was shortened because of data size. Continue to see the remaining records.") }}</p>
          <p v-if="blockedCount" class="wi-feedback warning">{{ words("Alcuni elementi superano il limite di consultazione: ", "Some records exceed the inspection limit: ") }}{{ blockedCount }}. {{ words("Non sono inclusi nelle schede mostrate.", "They are not included in the cards shown.") }}</p>
          <nav v-if="previousOffsets.length || page.nextOffset != null" class="wi-pagination" :aria-label="words('Pagine della raccolta', 'Collection pages')">
            <button type="button" class="wi-button" :disabled="!previousOffsets.length || loading" @click="previousPage">{{ words("Precedenti", "Previous") }}</button>
            <span>{{ words("Pagina ", "Page ") }}{{ previousOffsets.length + 1 }}</span>
            <button type="button" class="wi-button" :disabled="page.nextOffset == null || loading" @click="nextPage">{{ words("Successivi", "Next") }}</button>
          </nav>
        </template>
      </div>
      <details class="memory-file-tools">
        <summary>{{ words("Informazioni sulla memoria e aggiornamenti", "Memory information and updates") }}</summary>
      <footer class="wi-footer">
        <p>{{ words("Questa vista mostra dati e sintesi della memoria di lavoro del nodo selezionato. Conversazioni e osservazioni complete restano nell’archivio comune su file.", "This view shows data and summaries from the selected node’s working memory. Complete conversations and observations remain in the shared file archive.") }}</p>
        <p v-if="retentionNote">{{ retentionNote }}</p>
        <p v-if="overview?.updatedAt">{{ words("Memoria aggiornata: ", "Memory updated: ") }}{{ formatDate(overview.updatedAt) }}</p>
      </footer>
      </details>
    </template>
  </section>
</template>

<style scoped>
.world-insights { --wi-line: var(--line, rgba(0, 0, 0, .125)); color: var(--text, #333); min-width: 0; }
.wi-tools { margin: 0 0 20px; }
.wi-card-details { margin-top: 14px; padding: 12px; }
.wi-card-details > summary { font-size: .8rem; }
.wi-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; margin-bottom: 16px; }
.wi-header h3 { font-size: 1.25rem; line-height: 1.35; margin: 0 0 8px; }
.wi-eyebrow { color: var(--muted, #666); font-size: .76rem; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; margin: 0 0 6px; }
.wi-intro, .wi-collection-heading p { color: var(--muted, #666); line-height: 1.55; margin: 0; max-width: 82ch; }
.wi-button { background: var(--panel, #fff); border: 1px solid var(--wi-line); color: inherit; border-radius: 5px; padding: 9px 13px; cursor: pointer; line-height: 1.3; white-space: nowrap; }
.wi-button:hover:not(:disabled) { border-color: var(--accent, #ff9800); background: var(--accent-soft, #fff3e0); }
.wi-button:disabled { opacity: .55; cursor: default; }
.wi-button:focus-visible, .wi-collection:focus-visible, .wi-filters input:focus-visible, .wi-filters select:focus-visible, .wi-link:focus-visible { outline: 2px solid var(--accent, #ff9800); outline-offset: 3px; }
.wi-activity { display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: center; font-size: .82rem; color: var(--muted, #666); margin-bottom: 16px; }
.wi-collections { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; margin: 18px 0 24px; }
.wi-collection { text-align: left; display: flex; flex-direction: column; gap: 5px; color: inherit; background: var(--panel, #fff); border: 1px solid var(--wi-line); border-radius: 7px; padding: 15px; cursor: pointer; min-width: 0; }
.wi-collection.selected { border-color: var(--accent, #ff9800); box-shadow: inset 0 3px 0 var(--accent, #ff9800); background: var(--accent-soft, #fff3e0); }
.wi-collection > span { font-size: .88rem; font-weight: 650; }
.wi-collection strong { font-size: 1.7rem; line-height: 1.2; font-variant-numeric: tabular-nums; }
.wi-collection small { color: var(--muted, #666); font-size: .74rem; }
.wi-collection-heading h4 { font-size: 1.06rem; margin: 0 0 7px; }
.wi-collection-heading p { font-size: .86rem; }
.wi-filters { display: flex; align-items: flex-end; flex-wrap: wrap; gap: 10px; margin: 18px 0; }
.wi-filters label { display: flex; flex-direction: column; gap: 6px; font-size: .8rem; font-weight: 600; }
.wi-search { flex: 1 1 250px; }
.wi-status-filter { flex: 0 1 230px; }
.wi-filters input, .wi-filters select { width: 100%; min-width: 0; padding: 9px 11px; border: 1px solid var(--wi-line); border-radius: 5px; background: var(--panel, #fff); color: inherit; font-size: .86rem; min-height: 38px; }
.wi-quiet { font-size: .82rem; }
.wi-results { min-height: 110px; }
.wi-result-count { color: var(--muted, #666); font-size: .78rem; margin: 0 0 12px; }
.wi-card { background: var(--panel, #fff); border: 1px solid var(--wi-line); border-radius: 7px; padding: 18px; margin-bottom: 12px; overflow-wrap: anywhere; }
.wi-card-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
.wi-card-header > div { min-width: 0; }
.wi-card h5 { font-size: .99rem; font-weight: 650; margin: 0; line-height: 1.5; }
.wi-area { font-size: .72rem; font-weight: 700; color: var(--muted, #666); display: block; margin-bottom: 3px; }
.wi-badge { display: inline-flex; align-items: center; border: 1px solid var(--wi-line); border-radius: 12px; padding: 4px 9px; font-size: .71rem; font-weight: 650; line-height: 1.35; background: var(--panel-soft, #efefef); color: var(--text, #333); flex-shrink: 0; max-width: 100%; }
.wi-badge.positive { background: var(--ok-bg, #edf9ef); border-color: var(--ok-border, #5bbf73); }
.wi-badge.warning, .wi-feedback.warning { background: var(--warn-bg, #fff5e3); border-color: var(--warn-border, #d99a34); }
.wi-badge.error, .wi-feedback.error { background: var(--err-bg, #ffe9ea); border-color: var(--err-border, #d95b63); }
.wi-card-meta { display: flex; flex-wrap: wrap; gap: 6px 14px; color: var(--muted, #666); font-size: .76rem; margin-top: 7px; }
.wi-related-entities { display: flex; flex-wrap: wrap; gap: 6px; margin: 10px 0; }
.wi-related-entities > span { padding: 4px 8px; border-radius: 4px; background: var(--panel-soft, #efefef); font-size: .76rem; }
.wi-related-entities small { font-size: inherit; color: var(--muted, #666); }
.wi-summary, .wi-benefit { font-size: .89rem; line-height: 1.6; margin: 12px 0; white-space: pre-wrap; }
.wi-benefit { border-left: 3px solid var(--accent, #ff9800); padding-left: 12px; }
.wi-key-points { margin: 12px 0; display: grid; gap: 12px; }
.wi-key-points > div { min-width: 0; }
.wi-key-points dt, .wi-all-fields dt { font-weight: 650; font-size: .77rem; margin-bottom: 4px; color: var(--muted, #666); }
.wi-key-points dd, .wi-all-fields dd { margin: 0; font-size: .86rem; line-height: 1.6; white-space: pre-wrap; }
.wi-note { color: var(--muted, #666); font-size: .8rem; line-height: 1.5; margin: 9px 0 0; }
.wi-metrics { display: flex; flex-wrap: wrap; gap: 14px 30px; padding: 14px 0 4px; }
.wi-metrics > span { display: flex; flex-direction: column; color: var(--muted, #666); gap: 3px; font-size: .76rem; }
.wi-metrics strong { color: var(--text, #333); font-size: 1.12rem; font-variant-numeric: tabular-nums; }
.wi-link { display: inline-block; color: inherit; text-decoration: underline; text-decoration-color: var(--accent, #ff9800); text-underline-offset: 3px; font-size: .84rem; overflow-wrap: anywhere; margin-top: 10px; }
.wi-state-value { font-size: 1.3rem; font-weight: 650; margin: 14px 0; }
.wi-details { border-top: 1px solid var(--wi-line); margin-top: 14px; padding-top: 14px; }
.wi-all-fields { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 15px 24px; margin: 0; }
.wi-all-fields > div { min-width: 0; }
.wi-all-fields > .wi-wide-field { grid-column: 1 / -1; }
.wi-all-fields > div:has(.wi-nested-fields), .wi-all-fields > div:has(.wi-value-list) { grid-column: 1 / -1; }
:deep(.wi-value) { overflow-wrap: anywhere; white-space: pre-wrap; }
:deep(.wi-muted) { color: var(--muted, #666); }
:deep(.wi-value-list) { margin: 0; padding-left: 20px; display: grid; gap: 9px; }
:deep(.wi-nested-fields) { display: grid; grid-template-columns: repeat(auto-fit, minmax(155px, 1fr)); gap: 9px 15px; padding: 10px 12px; background: var(--panel-soft, #efefef); border-radius: 4px; margin: 0; }
:deep(.wi-nested-fields > div) { min-width: 0; }
:deep(.wi-nested-fields dt) { color: var(--muted, #666); font-size: .72rem; font-weight: 650; margin: 0 0 3px; }
:deep(.wi-nested-fields dd) { margin: 0; font-size: .8rem; line-height: 1.5; }
.wi-empty { border: 1px dashed var(--wi-line); border-radius: 6px; color: var(--muted, #666); font-size: .87rem; line-height: 1.6; padding: 26px 20px; margin: 14px 0; }
.wi-feedback { padding: 12px 14px; border: 1px solid var(--wi-line); border-radius: 5px; font-size: .82rem; line-height: 1.6; overflow-wrap: anywhere; }
.wi-feedback p { margin: 0 0 10px; }
.wi-pagination { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin: 18px 0; }
.wi-pagination > span { font-size: .8rem; color: var(--muted, #666); }
.wi-footer { color: var(--muted, #666); font-size: .76rem; line-height: 1.6; }
.wi-footer p { margin: 4px 0; }
@media (max-width: 640px) {
  .wi-header { flex-wrap: wrap; }
  .wi-collections { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .wi-collection { padding: 12px; }
  .wi-card { padding: 14px; }
  .wi-card-header { flex-direction: column; gap: 8px; }
  .wi-status-filter { flex: 1 1 170px; }
  .wi-all-fields { grid-template-columns: minmax(0, 1fr); }
  .wi-filters .wi-button { flex: 1 1 auto; }
}
</style>
