<script setup>
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  reactive,
  ref,
  watch,
} from "vue";
import CerebrumWorldInsights from "./components/CerebrumWorldInsights.vue";
import CerebrumSharedInsights from "./components/CerebrumSharedInsights.vue";
import CerebrumBrain from "./components/CerebrumBrain.vue";
import CerebrumNavigation from "./components/CerebrumNavigation.vue";
import CerebrumIcon from "./components/CerebrumIcon.vue";
import CerebrumAutomationEditor from "./components/CerebrumAutomationEditor.vue";
import { CEREBRUM_WEB_I18N } from "./cerebrumWebI18n";
import {
  formatChatLearningSimpleText,
  parseChatLearningNativeFile,
} from "./chatLearningView.mjs";
import {
  formatCerebrumMemoryJson,
  formatCerebrumMemorySimpleText,
  replaceCerebrumMemoryJsonBlock,
} from "./cerebrumMemoryView.mjs";

const tabKey = "cerebrumUltimate:activeTab";
const automationEditorDrafts = reactive(Object.create(null));
function warnUnsavedAutomationFiles(event) {
  if (Object.values(automationEditorDrafts).some(draft => draft.content !== draft.baseline || draft.selected?.origin === 'new')) {
    event.preventDefault();
    event.returnValue = '';
  }
}
onMounted(() => window.addEventListener('beforeunload', warnUnsavedAutomationFiles));
onBeforeUnmount(() => window.removeEventListener('beforeunload', warnUnsavedAutomationFiles));
const chatLearningViewKey = "cerebrumUltimate:chatLearningView";
const cerebrumMemoryViewKey = "cerebrumUltimate:cerebrumMemoryView";
const flowPrefsKey = "cerebrumUltimate:flowPreview";
const voiceKey = "cerebrumUltimate:voiceEnabled";
const sidebarKey = "cerebrumUltimate:sidebarExpanded";
const areaSelectionKeyPrefix = "cerebrumUltimate:selectedAreaId:";
const testAreaSelectionKeyPrefix = "cerebrumUltimate:selectedTestAreaId:";
const PRESET_QUESTIONS = [
  "Summarize the current KNX traffic and highlight the busiest group addresses.",
  "Explain any anomalies you see and suggest what to check first.",
  "Generate an SVG bar chart of Top Group Addresses with counts and title.",
];
const TEST_PROMPT_PRESETS = [
  {
    id: "lights_on_off",
    title: "Lights on, then off",
    prompt:
      "Turn the lights on, then turn them off, and verify that the related status values are coherent.",
    description:
      "Applies to all matching lighting command GA in the selected area.",
  },
  {
    id: "area_activate",
    title: "Activate main actuators",
    prompt:
      "Activate the main actuators in the area and verify the status feedback to confirm that it follows the commands.",
    description:
      "Builds a deterministic active test using the supported command GA in the selected area.",
  },
  {
    id: "shading_open_close",
    title: "Open and close shading",
    prompt:
      "Open and close the shading actuators in the area, then verify that the status matches the commands sent.",
    description: "Targets supported shading command GA in the selected area.",
  },
  {
    id: "hvac_check",
    title: "HVAC active check",
    prompt:
      "Run a full test of the HVAC commands in the area and verify that setpoints and statuses are coherent.",
    description: "Targets supported HVAC command GA in the selected area.",
  },
];
const FLOW_EVENT_COLORS = {
  write: "#ff9800",
  response: "#46b86d",
  read: "#d99a34",
  repeat: "#c34747",
  other: "#8d8578",
};
const CEREBRUM_VUE_DOCS_URL =
  "https://github.com/Supergiovane/node-red-contrib-cerebrum-ultimate";
const CEREBRUM_PAYPAL_URL =
  "https://www.paypal.com/donate/?hosted_button_id=S8SKPUBSPK758";
const CEREBRUM_YOUTUBE_URL = "https://www.youtube.com/@maxsupervibe";
const CEREBRUM_SECTIONS = [
  { id: "conversation", label: "Conversation", description: "Talk to your home and give shape to your ideas.", color: "#8fdcff" },
  { id: "learning", label: "Cerebrum Learning", description: "Discover the patterns emerging from everyday life.", color: "#bdadff" },
  { id: "memory", label: "Cerebrum Memory", description: "Explore what Cerebrum remembers about your home.", color: "#77e3cb" },
  { id: "goals", label: "Goals", description: "Follow the improvements Cerebrum is working towards.", color: "#ffc782" },
  { id: "research", label: "Web Research", description: "Explore discoveries and ideas from the Web.", color: "#edabdc" },
  { id: "operations", label: "Cerebrum Operations", description: "See the actions taken and their outcomes.", color: "#a8cbff" },
  { id: "automations", label: "JavaScript automations", description: "Functions created by Cerebrum. Inspect their code and manage when they run.", color: "#e7d686" },
];
const CEREBRUM_TAB_IDS = new Set(["brain", ...CEREBRUM_SECTIONS.map(section => section.id)]);

const queryNodeId = (() => {
  try {
    return new URLSearchParams(window.location.search).get("nodeId") || "";
  } catch (error) {
    return "";
  }
})();

const queryActiveTab = (() => {
  try {
    const requested = String(
      new URLSearchParams(window.location.search).get("tab") || "",
    );
    return [
      "overview",
      "etsAccess",
      "areas",
      "tests",
      "results",
      "cerebrum",
      "flowBuilder",
      "settings",
    ].includes(requested)
      ? requested
      : "cerebrum";
  } catch (error) {
    return "cerebrum";
  }
})();

const queryPrompt = (() => {
  try {
    return String(
      new URLSearchParams(window.location.search).get("prompt") || "",
    )
      .trim()
      .slice(0, 1200);
  } catch (error) {
    return "";
  }
})();

const queryCerebrumTab = (() => {
  try {
    const requested = String(
      new URLSearchParams(window.location.search).get("cerebrumTab") || "",
    );
    return CEREBRUM_TAB_IDS.has(
      requested,
    )
      ? requested
      : "";
  } catch (error) {
    return "";
  }
})();

const queryAccessToken = (() => {
  try {
    return (
      new URLSearchParams(window.location.search).get("access_token") || ""
    );
  } catch (error) {
    return "";
  }
})();

function readAuthTokenFromLocalStorage() {
  try {
    if (!window.localStorage) return "";
    const candidates = [];
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = String(window.localStorage.key(i) || "");
      if (!key.startsWith("auth-tokens")) continue;
      const raw = window.localStorage.getItem(key);
      if (!raw) continue;
      let parsed = null;
      try {
        parsed = JSON.parse(raw);
      } catch (error) {
        parsed = null;
      }
      const token =
        parsed && typeof parsed.access_token === "string"
          ? parsed.access_token.trim()
          : "";
      if (!token) continue;
      const expiresAt = Number(
        parsed && (parsed.expires_at || parsed.expiry || parsed.expires)
          ? parsed.expires_at || parsed.expiry || parsed.expires
          : 0,
      );
      candidates.push({
        token,
        expiresAt: Number.isFinite(expiresAt) ? expiresAt : 0,
      });
    }
    if (!candidates.length) return "";
    candidates.sort((a, b) => b.expiresAt - a.expiresAt);
    return candidates[0].token || "";
  } catch (error) {
    return "";
  }
}

const bearerAccessToken = (() => {
  const urlToken = String(queryAccessToken || "").trim();
  if (urlToken) return urlToken;
  return readAuthTokenFromLocalStorage();
})();

function withAuthHeaders(headersInput) {
  const headers = Object.assign({}, headersInput || {});
  if (bearerAccessToken && !headers.Authorization && !headers.authorization) {
    headers.Authorization = `Bearer ${bearerAccessToken}`;
  }
  return headers;
}

const uiLanguage = ref("en");
let uiTranslateObserver = null;
let uiTranslateRaf = 0;
let uiTranslateApplying = false;

const DYNAMIC_UI_PATTERNS = {
  it: {
    countAreas: "{{count}} aree",
    countNodes: "{{count}} nodi",
    countSavedPlans: "{{count}} piani salvati",
    countAvailable: "{{count}} disponibili",
    countVisible: "{{count}} visibili",
    countSelected: "{{selected}} / {{total}} selezionati",
    countReadOnly: "{{count}} in sola lettura",
    countMatching: "{{count}} corrispondenti",
    showingFirst:
      "Sono mostrati i primi {{count}}. Affina la ricerca per visualizzarne altri.",
    countEventTypes: "{{count}} tipi di eventi",
    countRecent: "{{count}} recenti",
    nodesLinks: "Nodi {{nodes}} | Link {{links}}",
    connected: "Connesso {{value}}",
    disconnected: "Disconnesso {{value}}",
    coverage: "Copertura {{value}}%",
    windowSec: "Finestra {{value}}s.",
    anomalyCount: "anomalia x{{value}}",
    areaLabel: "Area {{value}}",
    providerModel: "Provider: {{provider}} | Modello: {{model}}",
  },
  de: {
    countAreas: "{{count}} Bereiche",
    countNodes: "{{count}} Knoten",
    countSavedPlans: "{{count}} gespeicherte Pläne",
    countAvailable: "{{count}} verfügbar",
    countVisible: "{{count}} sichtbar",
    countSelected: "{{selected}} / {{total}} ausgewählt",
    countReadOnly: "{{count}} schreibgeschützt",
    countMatching: "{{count}} Treffer",
    showingFirst:
      "Die ersten {{count}} werden angezeigt. Verfeinern Sie die Suche, um weitere zu sehen.",
    countEventTypes: "{{count}} Ereignistypen",
    countRecent: "{{count}} aktuell",
    nodesLinks: "Knoten {{nodes}} | Verbindungen {{links}}",
    connected: "Verbunden {{value}}",
    disconnected: "Getrennt {{value}}",
    coverage: "Abdeckung {{value}}%",
    windowSec: "Fenster {{value}}s.",
    anomalyCount: "Anomalie x{{value}}",
    areaLabel: "Bereich {{value}}",
    providerModel: "Anbieter: {{provider}} | Modell: {{model}}",
  },
  fr: {
    countAreas: "{{count}} zones",
    countNodes: "{{count}} nœuds",
    countSavedPlans: "{{count}} plans enregistrés",
    countAvailable: "{{count}} disponibles",
    countVisible: "{{count}} visibles",
    countSelected: "{{selected}} / {{total}} sélectionnées",
    countReadOnly: "{{count}} en lecture seule",
    countMatching: "{{count}} correspondances",
    showingFirst:
      "Affichage des {{count}} premiers résultats. Affinez la recherche pour en voir davantage.",
    countEventTypes: "{{count}} types d'événements",
    countRecent: "{{count}} récents",
    nodesLinks: "Nœuds {{nodes}} | Liens {{links}}",
    connected: "Connecté {{value}}",
    disconnected: "Déconnecté {{value}}",
    coverage: "Couverture {{value}}%",
    windowSec: "Fenêtre {{value}}s.",
    anomalyCount: "anomalie x{{value}}",
    areaLabel: "Zone {{value}}",
    providerModel: "Fournisseur : {{provider}} | Modèle : {{model}}",
  },
  es: {
    countAreas: "{{count}} áreas",
    countNodes: "{{count}} nodos",
    countSavedPlans: "{{count}} planes guardados",
    countAvailable: "{{count}} disponibles",
    countVisible: "{{count}} visibles",
    countSelected: "{{selected}} / {{total}} seleccionadas",
    countReadOnly: "{{count}} de solo lectura",
    countMatching: "{{count}} coincidencias",
    showingFirst:
      "Se muestran los primeros {{count}}. Refina la búsqueda para ver más.",
    countEventTypes: "{{count}} tipos de eventos",
    countRecent: "{{count}} recientes",
    nodesLinks: "Nodos {{nodes}} | Enlaces {{links}}",
    connected: "Conectado {{value}}",
    disconnected: "Desconectado {{value}}",
    coverage: "Cobertura {{value}}%",
    windowSec: "Ventana {{value}}s.",
    anomalyCount: "anomalía x{{value}}",
    areaLabel: "Área {{value}}",
    providerModel: "Proveedor: {{provider}} | Modelo: {{model}}",
  },
  "zh-CN": {
    countAreas: "{{count}} 个区域",
    countNodes: "{{count}} 个节点",
    countSavedPlans: "{{count}} 个已保存计划",
    countAvailable: "{{count}} 可用",
    countVisible: "{{count}} 可见",
    countSelected: "已选择 {{selected}} / {{total}}",
    countReadOnly: "{{count}} 个只读",
    countMatching: "{{count}} 个匹配项",
    showingFirst: "显示前 {{count}} 项。请缩小搜索范围以查看更多。",
    countEventTypes: "{{count}} 种事件类型",
    countRecent: "{{count}} 条最近记录",
    nodesLinks: "节点 {{nodes}} | 连线 {{links}}",
    connected: "已连接 {{value}}",
    disconnected: "已断开 {{value}}",
    coverage: "覆盖率 {{value}}%",
    windowSec: "窗口 {{value}} 秒。",
    anomalyCount: "异常 x{{value}}",
    areaLabel: "区域 {{value}}",
    providerModel: "提供方: {{provider}} | 模型: {{model}}",
  },
};

const UI_LANGUAGE_ALIASES = {
  en: "en",
  "en-us": "en",
  "en-gb": "en",
  it: "it",
  "it-it": "it",
  de: "de",
  "de-de": "de",
  fr: "fr",
  "fr-fr": "fr",
  es: "es",
  "es-es": "es",
  zh: "zh-CN",
  "zh-cn": "zh-CN",
  "zh-hans": "zh-CN",
  "zh-hans-cn": "zh-CN",
};

const NON_TRANSLATABLE_LITERALS = new Set([
  "Cerebrum",
  "KNX Ultimate",
  "GroupValue_Write",
  "GroupValue_Response",
  "GA",
  "DPT",
  "ETS",
  "SVG",
]);

const REVIEWED_TRANSLATION_OVERRIDES = {
  it: {
    "Open Source Test": "Apri Test Sorgente",
    "Asking...": "Sto chiedendo...",
    "Loading...": "Caricamento...",
    "Running...": "In esecuzione...",
    Running: "In esecuzione",
    "Flow Map": "Mappa Flussi",
    Anomalies: "Anomalie",
    Rate: "Frequenza",
    Pass: "OK",
    Fail: "Errore",
    Warn: "Attenzione",
    Wait: "Attesa",
    "Wait ms": "Attesa (ms)",
    "Response timeout": "Timeout risposta",
    "Read response timeout ms": "Timeout risposta lettura (ms)",
    "Status write timeout ms": "Timeout scrittura stato (ms)",
    "Regenerating...": "Rigenerazione...",
    "Regenerate AI Areas": "Rigenera Aree AI",
    "Deleting...": "Eliminazione...",
    "Delete AI Areas": "Elimina Aree AI",
    "Test Results": "Risultati Test",
    "Select Test Result": "Seleziona risultato test",
    "No test result selected.": "Nessun risultato test selezionato.",
    "Open and close shading": "Apri e chiudi schermature",
  },
  de: {
    "Open Source Test": "Quelltest öffnen",
    "Asking...": "Anfrage läuft...",
    "Loading...": "Wird geladen...",
    "Running...": "Läuft...",
    Running: "Läuft",
    "Flow Map": "Flusskarte",
    Anomalies: "Anomalien",
    Rate: "Rate",
    Pass: "OK",
    Fail: "Fehler",
    Warn: "Warnung",
    Wait: "Warten",
    "Wait ms": "Warten (ms)",
    "Regenerating...": "Wird neu erstellt...",
    "Regenerate AI Areas": "KI-Bereiche neu erstellen",
    "Deleting...": "Wird gelöscht...",
    "Delete AI Areas": "KI-Bereiche löschen",
  },
  fr: {
    "Open Source Test": "Ouvrir le test source",
    "Asking...": "Interrogation en cours...",
    "Loading...": "Chargement...",
    "Running...": "En cours...",
    Running: "En cours",
    "Flow Map": "Carte des flux",
    Anomalies: "Anomalies",
    Rate: "Débit",
    Pass: "OK",
    Fail: "Échec",
    Warn: "Alerte",
    Wait: "Attente",
    "Wait ms": "Attente (ms)",
    "Regenerating...": "Régénération...",
    "Regenerate AI Areas": "Régénérer les zones IA",
    "Deleting...": "Suppression...",
    "Delete AI Areas": "Supprimer les zones IA",
  },
  es: {
    "Open Source Test": "Abrir prueba de origen",
    "Asking...": "Consultando...",
    "Loading...": "Cargando...",
    "Running...": "En ejecución...",
    Running: "En ejecución",
    "Flow Map": "Mapa de flujo",
    Anomalies: "Anomalías",
    Rate: "Tasa",
    Pass: "OK",
    Fail: "Fallo",
    Warn: "Aviso",
    Wait: "Espera",
    "Wait ms": "Espera (ms)",
    "Regenerating...": "Regenerando...",
    "Regenerate AI Areas": "Regenerar áreas de IA",
    "Deleting...": "Eliminando...",
    "Delete AI Areas": "Eliminar áreas de IA",
  },
  "zh-CN": {
    "Open Source Test": "打开源测试",
    "Asking...": "正在提问...",
    "Loading...": "加载中...",
    "Running...": "运行中...",
    Running: "运行中",
    "Flow Map": "流量拓扑图",
    Anomalies: "异常",
    Rate: "速率",
    Pass: "通过",
    Fail: "失败",
    Warn: "警告",
    Wait: "等待",
    "Wait ms": "等待（毫秒）",
    "Regenerating...": "正在重新生成...",
    "Regenerate AI Areas": "重新生成 AI 区域",
    "Deleting...": "正在删除...",
    "Delete AI Areas": "删除 AI 区域",
  },
};

function normalizeUiLanguageCode(value, fallback = "en") {
  const raw = String(value || "")
    .trim()
    .toLowerCase();
  if (!raw) return fallback;
  if (UI_LANGUAGE_ALIASES[raw]) return UI_LANGUAGE_ALIASES[raw];
  if (raw.includes("-")) {
    const base = raw.split("-")[0];
    if (UI_LANGUAGE_ALIASES[base]) return UI_LANGUAGE_ALIASES[base];
  }
  return fallback;
}

function resolveUiLanguage() {
  try {
    const queryLanguage = new URLSearchParams(window.location.search).get(
      "lang",
    );
    if (queryLanguage) return normalizeUiLanguageCode(queryLanguage, "en");
  } catch (error) {}
  const browserLanguage = normalizeUiLanguageCode(
    String(navigator.language || ""),
    "",
  );
  if (browserLanguage) return browserLanguage;
  const htmlLang = String(
    document && document.documentElement && document.documentElement.lang
      ? document.documentElement.lang
      : "",
  ).trim();
  if (htmlLang) return normalizeUiLanguageCode(htmlLang, "en");
  return "en";
}

function translateTemplate(template, values = {}) {
  return String(template || "").replace(
    /\{\{\s*([^}\s]+)\s*\}\}/g,
    (all, key) => {
      return Object.prototype.hasOwnProperty.call(values, key)
        ? String(values[key])
        : all;
    },
  );
}

function translateDynamicUiText(text) {
  const langPatterns = DYNAMIC_UI_PATTERNS[uiLanguage.value];
  if (!langPatterns) return "";
  let match = text.match(/^(\d+)\sareas$/i);
  if (match)
    return translateTemplate(langPatterns.countAreas, { count: match[1] });
  match = text.match(/^(\d+)\snodes$/i);
  if (match)
    return translateTemplate(langPatterns.countNodes, { count: match[1] });
  match = text.match(/^(\d+)\ssaved plans$/i);
  if (match)
    return translateTemplate(langPatterns.countSavedPlans, { count: match[1] });
  match = text.match(/^(\d+)\savailable$/i);
  if (match)
    return translateTemplate(langPatterns.countAvailable, { count: match[1] });
  match = text.match(/^(\d+)\svisible$/i);
  if (match)
    return translateTemplate(langPatterns.countVisible, { count: match[1] });
  match = text.match(/^(\d+)\s*\/\s*(\d+)\sselected$/i);
  if (match)
    return translateTemplate(langPatterns.countSelected, {
      selected: match[1],
      total: match[2],
    });
  match = text.match(/^(\d+)\sread only$/i);
  if (match)
    return translateTemplate(langPatterns.countReadOnly, { count: match[1] });
  match = text.match(/^(\d+)\smatching$/i);
  if (match)
    return translateTemplate(langPatterns.countMatching, { count: match[1] });
  match = text.match(
    /^Showing first\s+(\d+)\. Refine the search to see more\.$/i,
  );
  if (match)
    return translateTemplate(langPatterns.showingFirst, { count: match[1] });
  match = text.match(/^(\d+)\sevent types$/i);
  if (match)
    return translateTemplate(langPatterns.countEventTypes, { count: match[1] });
  match = text.match(/^(\d+)\srecent$/i);
  if (match)
    return translateTemplate(langPatterns.countRecent, { count: match[1] });
  match = text.match(/^Nodes\s+(.+?)\s+\|\s+Links\s+(.+)$/);
  if (match)
    return translateTemplate(langPatterns.nodesLinks, {
      nodes: match[1],
      links: match[2],
    });
  match = text.match(/^Connected\s+(.+)$/);
  if (match)
    return translateTemplate(langPatterns.connected, { value: match[1] });
  match = text.match(/^Disconnected\s+(.+)$/);
  if (match)
    return translateTemplate(langPatterns.disconnected, { value: match[1] });
  match = text.match(/^Coverage\s+(.+?)%$/);
  if (match)
    return translateTemplate(langPatterns.coverage, { value: match[1] });
  match = text.match(/^Window\s+(.+?)s\.$/);
  if (match)
    return translateTemplate(langPatterns.windowSec, { value: match[1] });
  match = text.match(/^anomaly x(.+)$/i);
  if (match)
    return translateTemplate(langPatterns.anomalyCount, { value: match[1] });
  match = text.match(/^Area\s+(.+)$/);
  if (match)
    return translateTemplate(langPatterns.areaLabel, { value: match[1] });
  match = text.match(/^Provider:\s+(.+?)\s+\|\s+Model:\s+(.+)$/);
  if (match)
    return translateTemplate(langPatterns.providerModel, {
      provider: match[1],
      model: match[2],
    });
  return "";
}

function localizeUiText(value) {
  const raw = String(value || "");
  const trimmed = raw.trim();
  if (!trimmed || uiLanguage.value === "en") return raw;
  if (NON_TRANSLATABLE_LITERALS.has(trimmed)) return raw;
  const reviewed = REVIEWED_TRANSLATION_OVERRIDES[uiLanguage.value] || {};
  const dictionary = CEREBRUM_WEB_I18N[uiLanguage.value] || {};
  const translated =
    reviewed[trimmed] || dictionary[trimmed] || translateDynamicUiText(trimmed);
  if (!translated || translated === trimmed) return raw;
  return raw.replace(trimmed, translated);
}

function shouldSkipUiTranslationNode(node) {
  const parent = node && node.parentElement;
  if (!parent) return true;
  const tagName = String(parent.tagName || "").toUpperCase();
  if (
    tagName === "SCRIPT" ||
    tagName === "STYLE" ||
    tagName === "CODE" ||
    tagName === "PRE"
  )
    return true;
  if (parent.closest(".chat-log, [data-cerebrum-localized]")) return true;
  return false;
}

function applyUiTranslationsToDom(rootElement) {
  const root = rootElement || document.body;
  if (!root || uiLanguage.value === "en") return;
  if (uiTranslateApplying) return;
  uiTranslateApplying = true;
  try {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let current = walker.nextNode();
    while (current) {
      if (!shouldSkipUiTranslationNode(current)) {
        const localized = localizeUiText(current.nodeValue);
        if (localized !== current.nodeValue) current.nodeValue = localized;
      }
      current = walker.nextNode();
    }
    const attrNodes = root.querySelectorAll(
      "[placeholder], [title], [aria-label]",
    );
    for (const element of attrNodes) {
      if (element.closest("[data-cerebrum-localized]")) continue;
      const placeholder = element.getAttribute("placeholder");
      if (placeholder) {
        const localized = localizeUiText(placeholder);
        if (localized !== placeholder)
          element.setAttribute("placeholder", localized);
      }
      const title = element.getAttribute("title");
      if (title) {
        const localized = localizeUiText(title);
        if (localized !== title) element.setAttribute("title", localized);
      }
      const ariaLabel = element.getAttribute("aria-label");
      if (ariaLabel) {
        const localized = localizeUiText(ariaLabel);
        if (localized !== ariaLabel)
          element.setAttribute("aria-label", localized);
      }
    }
  } finally {
    uiTranslateApplying = false;
  }
}

function scheduleUiTranslation() {
  if (uiLanguage.value === "en") return;
  if (uiTranslateRaf) return;
  uiTranslateRaf = window.requestAnimationFrame(() => {
    uiTranslateRaf = 0;
    applyUiTranslationsToDom(document.body);
  });
}

function stopUiTranslationObserver() {
  if (uiTranslateObserver) {
    uiTranslateObserver.disconnect();
    uiTranslateObserver = null;
  }
  if (uiTranslateRaf) {
    window.cancelAnimationFrame(uiTranslateRaf);
    uiTranslateRaf = 0;
  }
}

function startUiTranslationObserver() {
  if (uiLanguage.value === "en") return;
  stopUiTranslationObserver();
  uiTranslateObserver = new MutationObserver(() => {
    if (uiTranslateApplying) return;
    scheduleUiTranslation();
  });
  uiTranslateObserver.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
  });
  scheduleUiTranslation();
}

const state = reactive({
  nodes: [],
  selectedNodeId: "",
  activeTab: queryActiveTab,
  cerebrumTab: queryCerebrumTab || (queryPrompt ? "conversation" : "brain"),
  voiceEnabled: loadBoolean(voiceKey, true),
  flowMaxNodes: loadFlowPrefs().maxNodes,
  flowSelectedGa: loadFlowPrefs().selectedGa,
  flowShowUniversalNodes: loadFlowPrefs().showUniversalNodes,
  flowSearch: "",
  areaSearch: "",
  areaSearchOpen: false,
  areaSelectedId: "",
  testAreaSelectedId: "",
  areaDraftName: "",
  areaDraftDescription: "",
  areaDraftTags: "",
  areaDraftGaList: [],
  areaDraftId: "",
  areaDraftIsNew: false,
  areaLlmPrompt: "",
  areaLlmBusy: false,
  areaLlmError: "",
  areaLlmRegenerating: false,
  areaLlmBulkDeleting: false,
  gaCatalog: [],
  gaCatalogSearch: "",
  gaCatalogLoading: false,
  areaSaving: false,
  profileSelectedId: "",
  profileDraftMode: false,
  profileDraftId: "",
  profileDraftName: "",
  profileDraftDescription: "",
  profileDraftTargetTags: "",
  profileDraftMinActivityPct: 20,
  profileDraftMaxSilentPct: 60,
  profileDraftMaxAnomalies: 2,
  profileSaving: false,
  profileRunning: false,
  actuatorPresetSelectedId: "",
  actuatorDraftMode: false,
  actuatorDraftId: "",
  actuatorDraftName: "",
  actuatorDraftDescription: "",
  actuatorDraftCommandGA: "",
  actuatorDraftCommandDPT: "",
  actuatorDraftCommandPayload: "",
  actuatorDraftStatusGA: "",
  actuatorDraftStatusDPT: "",
  actuatorDraftStatusWriteTimeoutMs: 5000,
  actuatorDraftStatusResponseTimeoutMs: 5000,
  actuatorSaving: false,
  actuatorRunning: false,
  testPlanSelectedId: "",
  testPlanSearch: "",
  testPlanSearchOpen: false,
  selectedTestResultId: "",
  liveTestResultId: "",
  knxMenuOpen: true,
  etsAccessFilter: "",
  etsAccessSelected: [],
  etsAccessReadOnly: [],
  etsAccessBaseline: "",
  etsAccessLoadedNodeId: "",
  etsAccessData: null,
  etsAccessLoading: false,
  etsAccessSaving: false,
  etsAccessError: "",
  testResultsMenuOpen: true,
  testResultFocusMode: false,
  deletingTestResultId: "",
  testPlanPrompt: "",
  testPlanDraft: null,
  testPlanCatalog: null,
  testPlanCatalogLoading: false,
  testPlanCatalogError: "",
  testPlanGenerating: false,
  testPlanSaving: false,
  testPlanDeleting: false,
  testPlanRunning: false,
  testPlanGeneration: null,
  testPlanGenerationError: "",
  testPlanRunConfirmOpen: false,
  testPlanRunMode: "single",
  testPlanRunningStepId: "",
  testPlanRepeatForever: false,
  testPlanRepeatStopRequested: false,
  testPlanDraftBaseline: "",
  testPlanUnsavedConfirmOpen: false,
  areaUnsavedConfirmOpen: false,
  testPlanPendingActionLabel: "",
  draggedTestPlanStepId: "",
  dragOverTestPlanStepId: "",
  showAiPlanner: true,
  testTemplateBuilderFocus: false,
  showAiAreaBuilder: false,
  areaBuilderFocus: false,
  status: "Ready",
  loadingNodes: false,
  loadingState: false,
  asking: false,
  stateData: null,
  lastError: "",
  chatMessages: [],
  chatDraft: queryPrompt,
  flowBuilderPrompt: "",
  flowBuilderGenerating: false,
  flowBuilderResult: null,
  flowBuilderError: "",
  flowBuilderCopied: false,
  chatLearningContent: "",
  chatLearningBaseline: "",
  chatLearningViewMode: ["native", "simple"].includes(
    loadString(chatLearningViewKey, "simple"),
  )
    ? loadString(chatLearningViewKey, "simple")
    : "simple",
  chatLearningRevision: "",
  chatLearningName: "",
  chatLearningPath: "",
  chatLearningArchivePath: "",
  chatLearningBytes: 0,
  chatLearningMaxBytes: 512 * 1024,
  chatLearningModifiedAt: "",
  chatLearningSessionCount: 0,
  chatLearningLoadedNodeId: "",
  chatLearningLoading: false,
  chatLearningSaving: false,
  chatLearningResetting: false,
  chatLearningCopied: false,
  chatLearningError: "",
  cerebrumMemoryContent: "",
  cerebrumMemoryBaseline: "",
  cerebrumMemoryFileContent: "",
  cerebrumMemoryViewMode: ["json", "simple"].includes(
    loadString(cerebrumMemoryViewKey, "simple"),
  )
    ? loadString(cerebrumMemoryViewKey, "simple")
    : "simple",
  cerebrumMemoryRevision: "",
  cerebrumMemoryName: "",
  cerebrumMemoryPath: "",
  cerebrumMemoryBytes: 0,
  cerebrumMemoryMaxBytes: 5 * 1024 * 1024,
  cerebrumMemoryModifiedAt: "",
  cerebrumMemoryHabitCount: 0,
  cerebrumMemoryConfirmedHabitCount: 0,
  cerebrumMemoryPendingHabitCount: 0,
  cerebrumMemoryStateCount: 0,
  cerebrumMemoryLoadedNodeId: "",
  cerebrumMemoryLoading: false,
  cerebrumMemorySaving: false,
  cerebrumMemoryResetting: false,
  cerebrumMemoryCopied: false,
  cerebrumMemoryError: "",
  cerebrumOperationsItems: [],
  cerebrumOperationsCounts: {
    total: 0,
    knx: 0,
    llm: 0,
    tool: 0,
    autonomous: 0,
    system: 0,
  },
  cerebrumOperationsFrom: "",
  cerebrumOperationsTo: "",
  cerebrumOperationsArchivePath: "",
  cerebrumOperationsKnxArchivePath: "",
  cerebrumOperationsLoadedNodeId: "",
  cerebrumOperationsLoadedAt: 0,
  cerebrumOperationsLoading: false,
  cerebrumOperationsError: "",
  cerebrumOperationsTruncated: false,
  cerebrumOperationsFilter: "all",
  cerebrumOperationsStatusFilter: "all",
  cerebrumOperationsSearch: "",
  pollStateHandle: null,
  pollNodesHandle: null,
});
const seenScheduledChatEntries = new Set();
const cerebrumSections = computed(() => CEREBRUM_SECTIONS.map(section => ({
  ...section,
  label: localizeUiText(section.label),
  description: localizeUiText(section.description),
})));
const uiBusy = computed(() => state.loadingNodes || state.loadingState ||
  state.areaLlmRegenerating || state.areaLlmBulkDeleting || state.areaLlmBusy ||
  state.testPlanGenerating || state.asking);
const workspacePage = computed(() => {
  const pages = {
    overview: { title: "Overview", group: "Your home", description: "Your home at a glance. Activity, connections and the health of your system." },
    etsAccess: { title: "ETS Access", group: "KNX", description: "Choose which KNX group addresses Cerebrum may read or write." },
    areas: { title: "Areas", group: "KNX", description: "Organize your home into areas and connect the devices that belong together." },
    tests: { title: "Tests", group: "KNX", description: "Build test plans and check how your devices respond." },
    results: { title: "Test Results", group: "KNX", description: "Review completed tests, feedback and the details of each step." },
    flowBuilder: { title: "Node-RED Flow Builder", group: "Tools", description: "Turn your ideas into Node-RED flows." },
    settings: { title: "Settings", group: "Tools", description: "Manage backups and move Cerebrum to a new installation." },
    cerebrum: { title: "Neural map", group: "Explore", description: "Explore what Cerebrum knows, what it is trying to improve and what it has done." },
  };
  const section = state.activeTab === "cerebrum" && CEREBRUM_SECTIONS.find(item => item.id === state.cerebrumTab);
  const page = section ? { title: section.label, description: section.description, group: "Cerebrum", color: section.color } : pages[state.activeTab] || pages.overview;
  return { ...page, title: localizeUiText(page.title), description: localizeUiText(page.description), group: localizeUiText(page.group), color: page.color || "#8fdcff" };
});
const flowCardRef = ref(null);
const isFlowFullscreen = ref(false);
const configImportRef = ref(null);
const backupBusy = ref(false);
const chatLearningImportRef = ref(null);
const cerebrumMemoryImportRef = ref(null);
const testPlanReportRef = ref(null);
const desktopSidebarExpanded = ref(loadBoolean(sidebarKey, true));
const mobileSidebarOpen = ref(false);
const isCompactViewport = ref(false);
const isSidebarExpanded = computed(() =>
  isCompactViewport.value
    ? mobileSidebarOpen.value
    : desktopSidebarExpanded.value,
);
let activeStepAudio = null;
let testPlanBaselineData = null;
let pendingTestPlanAction = null;
let chatLearningOperationGeneration = 0;
let cerebrumMemoryOperationGeneration = 0;
let cerebrumOperationsGeneration = 0;

function stopActiveStepAudio() {
  if (!activeStepAudio) return;
  try {
    activeStepAudio.pause();
    activeStepAudio.src = "";
  } catch (error) {}
  activeStepAudio = null;
}

function loadString(key, fallback = "") {
  try {
    return window.localStorage
      ? window.localStorage.getItem(key) || fallback
      : fallback;
  } catch (error) {
    return fallback;
  }
}

function loadBoolean(key, fallback) {
  try {
    if (!window.localStorage) return fallback;
    const raw = window.localStorage.getItem(key);
    if (raw === null || raw === undefined || raw === "") return fallback;
    return raw === "true";
  } catch (error) {
    return fallback;
  }
}

function loadFlowPrefs() {
  try {
    if (!window.localStorage)
      return { maxNodes: 14, selectedGa: [], showUniversalNodes: false };
    const raw = window.localStorage.getItem(flowPrefsKey);
    if (!raw)
      return { maxNodes: 14, selectedGa: [], showUniversalNodes: false };
    const parsed = JSON.parse(raw);
    const maxNodes = Math.max(
      4,
      Math.min(32, Number(parsed && parsed.maxNodes) || 14),
    );
    const selectedGa = Array.isArray(parsed && parsed.selectedGa)
      ? Array.from(
          new Set(
            parsed.selectedGa
              .map((item) => String(item || "").trim())
              .filter(Boolean),
          ),
        ).slice(0, 80)
      : [];
    const showUniversalNodes = parsed && parsed.showUniversalNodes === true;
    return { maxNodes, selectedGa, showUniversalNodes };
  } catch (error) {
    return { maxNodes: 14, selectedGa: [], showUniversalNodes: false };
  }
}

function saveString(key, value) {
  try {
    if (window.localStorage)
      window.localStorage.setItem(key, String(value ?? ""));
  } catch (error) {}
}

function saveBoolean(key, value) {
  try {
    if (window.localStorage)
      window.localStorage.setItem(key, value ? "true" : "false");
  } catch (error) {}
}

function syncViewportMode() {
  try {
    isCompactViewport.value = window.matchMedia("(max-width: 1100px)").matches;
  } catch (error) {
    isCompactViewport.value = window.innerWidth <= 1100;
  }
  if (!isCompactViewport.value) mobileSidebarOpen.value = false;
}

function toggleSidebar() {
  if (isCompactViewport.value) {
    mobileSidebarOpen.value = mobileSidebarOpen.value !== true;
    return;
  }
  desktopSidebarExpanded.value = desktopSidebarExpanded.value !== true;
}

function toggleKnxMenu() {
  state.knxMenuOpen = state.knxMenuOpen !== true;
}

function closeSidebarOnMobile() {
  if (isCompactViewport.value) mobileSidebarOpen.value = false;
}

function onGlobalKeydown(event) {
  if (!event || event.key !== "Escape") return;
  closeSidebarOnMobile();
}

function areaSelectionKey(nodeId) {
  const id = String(nodeId || "").trim();
  return id ? `${areaSelectionKeyPrefix}${id}` : "";
}

function testAreaSelectionKey(nodeId) {
  const id = String(nodeId || "").trim();
  return id ? `${testAreaSelectionKeyPrefix}${id}` : "";
}

function loadSelectedAreaIdForNode(nodeId) {
  const key = areaSelectionKey(nodeId);
  return key ? loadString(key, "") : "";
}

function saveSelectedAreaIdForNode(nodeId, areaId) {
  const key = areaSelectionKey(nodeId);
  if (!key) return;
  const value = String(areaId || "").trim();
  if (!value) return;
  saveString(key, value);
}

function loadSelectedTestAreaIdForNode(nodeId) {
  const key = testAreaSelectionKey(nodeId);
  return key ? loadString(key, "") : "";
}

function saveSelectedTestAreaIdForNode(nodeId, areaId) {
  const key = testAreaSelectionKey(nodeId);
  if (!key) return;
  const value = String(areaId || "").trim();
  if (!value) return;
  saveString(key, value);
}

function restoreSelectedAreaForCurrentNode() {
  const storedAreaId = loadSelectedAreaIdForNode(state.selectedNodeId);
  if (!storedAreaId) return false;
  if (!suggestedAreas.value.find((area) => area.id === storedAreaId))
    return false;
  if (state.areaSelectedId === storedAreaId) return true;
  state.areaSelectedId = storedAreaId;
  return true;
}

function restoreSelectedTestAreaForCurrentNode() {
  const storedAreaId = loadSelectedTestAreaIdForNode(state.selectedNodeId);
  if (!storedAreaId) return false;
  if (!suggestedAreas.value.find((area) => area.id === storedAreaId))
    return false;
  if (state.testAreaSelectedId === storedAreaId) return true;
  state.testAreaSelectedId = storedAreaId;
  return true;
}

function saveFlowPrefs() {
  try {
    if (!window.localStorage) return;
    window.localStorage.setItem(
      flowPrefsKey,
      JSON.stringify({
        maxNodes: Math.max(4, Math.min(32, Number(state.flowMaxNodes) || 14)),
        selectedGa: Array.from(
          new Set(
            (state.flowSelectedGa || [])
              .map((item) => String(item || "").trim())
              .filter(Boolean),
          ),
        ).slice(0, 80),
        showUniversalNodes: state.flowShowUniversalNodes === true,
      }),
    );
  } catch (error) {}
}

async function toggleFlowFullscreen() {
  const target = flowCardRef.value;
  if (!target || typeof target.requestFullscreen !== "function") return;
  try {
    if (document.fullscreenElement === target) {
      await document.exitFullscreen();
    } else if (!document.fullscreenElement) {
      await target.requestFullscreen();
    }
  } catch (error) {}
}

function syncFullscreenState() {
  isFlowFullscreen.value = document.fullscreenElement === flowCardRef.value;
}

function apiUrl(tail) {
  // Fetch requests authenticate through withAuthHeaders. Sending the same token
  // in both the URL and the header makes Node-RED's bearer strategy reject them.
  return new URL(tail, window.location.href).toString();
}

// The Web page lives under /sidebar; inspection shares the Node-RED admin
// root and authentication, including installations behind an ingress proxy.
function requestWorldInsight(tail) {
  return requestJson(apiUrl(`../${tail}`), { cache: "no-store" });
}

function requestAutomationFiles(tail, options) {
  return requestJson(apiUrl(tail), { cache: "no-store", ...options });
}

function setStatus(text) {
  state.status = localizeUiText(String(text || ""));
}

async function requestJson(url, options) {
  const requestOptions = Object.assign(
    { credentials: "same-origin" },
    options || {},
  );
  requestOptions.headers = withAuthHeaders(requestOptions.headers);
  const response = await fetch(url, requestOptions);
  const contentType = String(
    response.headers.get("content-type") || "",
  ).toLowerCase();
  const text = await response.text();
  if (response.ok && contentType.includes("text/html")) {
    throw new Error(
      "Authentication required or insufficient permissions (session token missing or expired).",
    );
  }
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch (error) {
    json = { error: text || `HTTP ${response.status}` };
  }
  if (!response.ok) {
    const baseMessage =
      json && json.error ? json.error : `HTTP ${response.status}`;
    if (response.status === 401 || response.status === 403) {
      throw new Error(
        `Authentication required or insufficient permissions (${response.status}).`,
      );
    }
    throw Object.assign(new Error(baseMessage), { status: response.status });
  }
  return json;
}

async function requestAudioBlob(url, options) {
  const requestOptions = Object.assign(
    { credentials: "same-origin", cache: "no-store" },
    options || {},
  );
  requestOptions.headers = withAuthHeaders(requestOptions.headers);
  const response = await fetch(url, requestOptions);
  if (!response.ok) {
    const text = await response.text();
    let errorMessage = text || `HTTP ${response.status}`;
    try {
      const parsed = text ? JSON.parse(text) : {};
      errorMessage = parsed && parsed.error ? parsed.error : errorMessage;
    } catch (error) {}
    if (response.status === 401 || response.status === 403) {
      throw new Error(
        `Authentication required or insufficient permissions (${response.status}).`,
      );
    }
    throw new Error(errorMessage);
  }
  const contentType = String(
    response.headers.get("content-type") || "",
  ).toLowerCase();
  if (!contentType.includes("audio/")) {
    const text = await response.text();
    if (contentType.includes("text/html")) {
      throw new Error(
        "Authentication required or insufficient permissions (invalid audio response).",
      );
    }
    let errorMessage =
      text || `Unexpected audio response (${contentType || "unknown"}).`;
    try {
      const parsed = text ? JSON.parse(text) : {};
      errorMessage = parsed && parsed.error ? parsed.error : errorMessage;
    } catch (error) {}
    throw new Error(errorMessage);
  }
  return await response.blob();
}

function normalizeChatText(value) {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch (error) {
    return String(value);
  }
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function isTableSeparatorLine(line) {
  const s = String(line || "").trim();
  return (
    s.includes("-") && /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(s)
  );
}

function parsePipeRow(line) {
  let s = String(line || "").trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  return s.split("|").map((c) => String(c || "").trim());
}

function parseAlignments(sepLine) {
  return parsePipeRow(sepLine).map((cell) => {
    const value = String(cell || "").trim();
    const left = value.startsWith(":");
    const right = value.endsWith(":");
    if (left && right) return "center";
    if (right) return "right";
    return "left";
  });
}

function basicMarkdownToHtml(markdown) {
  const lines = String(markdown || "").split(/\r?\n/);
  let html = "";
  let inCode = false;

  const renderInline = (text) => {
    let out = String(text || "");
    out = out.replace(/`([^`]+)`/g, "<code>$1</code>");
    out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    out = out.replace(/\*([^*]+)\*/g, "<em>$1</em>");
    out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, label, href) => {
      const safeHref = /^javascript:/i.test(String(href || "").trim())
        ? "#"
        : href;
      return `<a href="${safeHref}" target="_blank" rel="noopener noreferrer">${label}</a>`;
    });
    return out;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^```/.test(line.trim())) {
      inCode = !inCode;
      html += inCode ? "<pre><code>" : "</code></pre>";
      continue;
    }
    if (inCode) {
      html += `${line}\n`;
      continue;
    }

    if (/^###\s+/.test(line)) {
      html += `<h3>${line.replace(/^###\s+/, "")}</h3>`;
      continue;
    }
    if (/^##\s+/.test(line)) {
      html += `<h2>${line.replace(/^##\s+/, "")}</h2>`;
      continue;
    }
    if (/^#\s+/.test(line)) {
      html += `<h1>${line.replace(/^#\s+/, "")}</h1>`;
      continue;
    }

    if (
      line.includes("|") &&
      i + 1 < lines.length &&
      isTableSeparatorLine(lines[i + 1])
    ) {
      const headers = parsePipeRow(line);
      const aligns = parseAlignments(lines[i + 1]);
      const rows = [];
      i += 2;
      while (
        i < lines.length &&
        lines[i] &&
        lines[i].includes("|") &&
        !/^```/.test(lines[i].trim())
      ) {
        rows.push(parsePipeRow(lines[i]));
        i++;
      }
      i -= 1;
      const colCount = Math.max(
        headers.length,
        aligns.length,
        ...rows.map((row) => row.length),
        0,
      );
      html += '<div class="chat-table-wrap"><table><thead><tr>';
      for (let index = 0; index < colCount; index++) {
        html += `<th style="text-align:${aligns[index] || "left"};">${renderInline(headers[index] || "")}</th>`;
      }
      html += "</tr></thead><tbody>";
      rows.forEach((row) => {
        html += "<tr>";
        for (let index = 0; index < colCount; index++) {
          html += `<td style="text-align:${aligns[index] || "left"};">${renderInline(row[index] || "")}</td>`;
        }
        html += "</tr>";
      });
      html += "</tbody></table></div>";
      continue;
    }

    const isUnordered = /^\s*[-*]\s+/.test(line);
    const isOrdered = /^\s*\d+\.\s+/.test(line);
    if (isUnordered || isOrdered) {
      const listTag = isOrdered ? "ol" : "ul";
      const itemRe = isOrdered ? /^\s*\d+\.\s+/ : /^\s*[-*]\s+/;
      html += `<${listTag}>`;
      while (i < lines.length && itemRe.test(lines[i])) {
        html += `<li>${renderInline(lines[i].replace(itemRe, ""))}</li>`;
        i++;
      }
      i -= 1;
      html += `</${listTag}>`;
      continue;
    }

    if (line.trim() === "") {
      html += "<br>";
      continue;
    }
    html += `<p>${renderInline(line)}</p>`;
  }

  if (inCode) html += "</code></pre>";
  return html;
}

function decodeBasicHtmlEntities(value) {
  return String(value || "")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&amp;/gi, "&");
}

function extractInlineSvgCandidates(value) {
  const out = [];
  const re = /<svg[\s\S]*?<\/svg>/gi;
  let match;
  while ((match = re.exec(String(value || ""))) !== null) {
    if (match && match[0]) out.push(String(match[0]));
  }
  return out;
}

const SVG_ALLOWED_TAGS = new Set([
  "svg",
  "g",
  "path",
  "line",
  "polyline",
  "polygon",
  "circle",
  "ellipse",
  "rect",
  "text",
  "tspan",
  "title",
  "desc",
  "defs",
  "marker",
  "lineargradient",
  "radialgradient",
  "stop",
  "clippath",
]);

const SVG_ALLOWED_ATTRS = new Set([
  "xmlns",
  "xmlns:xlink",
  "viewbox",
  "preserveaspectratio",
  "width",
  "height",
  "role",
  "aria-label",
  "id",
  "class",
  "x",
  "y",
  "x1",
  "y1",
  "x2",
  "y2",
  "cx",
  "cy",
  "r",
  "rx",
  "ry",
  "d",
  "points",
  "transform",
  "fill",
  "fill-opacity",
  "stroke",
  "stroke-width",
  "stroke-opacity",
  "stroke-dasharray",
  "stroke-linecap",
  "stroke-linejoin",
  "opacity",
  "font-size",
  "font-family",
  "font-weight",
  "text-anchor",
  "dominant-baseline",
  "offset",
  "stop-color",
  "stop-opacity",
  "gradientunits",
  "gradienttransform",
  "fx",
  "fy",
  "marker-start",
  "marker-mid",
  "marker-end",
  "markerwidth",
  "markerheight",
  "refx",
  "refy",
  "orient",
  "markerunits",
  "href",
  "xlink:href",
  "clip-path",
  "clippathunits",
]);

function sanitizeSvgMarkup(svgMarkup) {
  try {
    const parser = new window.DOMParser();
    const doc = parser.parseFromString(
      String(svgMarkup || ""),
      "image/svg+xml",
    );
    if (
      !doc ||
      !doc.documentElement ||
      doc.getElementsByTagName("parsererror").length
    )
      return "";
    const root = doc.documentElement;
    if (String(root.tagName || "").toLowerCase() !== "svg") return "";

    const sanitizeNode = (node) => {
      const tag = String(node.tagName || "").toLowerCase();
      if (!SVG_ALLOWED_TAGS.has(tag)) {
        node.remove();
        return;
      }
      Array.from(node.attributes || []).forEach((attr) => {
        const name = String(attr.name || "").toLowerCase();
        const value = String(attr.value || "");
        if (name.startsWith("on") || !SVG_ALLOWED_ATTRS.has(name)) {
          node.removeAttribute(attr.name);
          return;
        }
        if (
          (name === "href" || name === "xlink:href") &&
          value &&
          !String(value).trim().startsWith("#")
        ) {
          node.removeAttribute(attr.name);
        }
      });
      Array.from(node.childNodes || []).forEach((child) => {
        if (child.nodeType === 1) sanitizeNode(child);
        else if (child.nodeType !== 3) child.remove();
      });
    };

    sanitizeNode(root);
    if (!root.getAttribute("viewBox") && !root.getAttribute("viewbox")) {
      root.setAttribute("viewBox", "0 0 920 360");
    }
    root.setAttribute("role", root.getAttribute("role") || "img");
    const out = new window.XMLSerializer().serializeToString(root);
    return out.length > 120000 ? "" : out;
  } catch (error) {
    return "";
  }
}

function renderMarkdownToHtml(markdown) {
  return basicMarkdownToHtml(escapeHtml(markdown || ""));
}

function renderAssistantHtml(value) {
  const raw = normalizeChatText(value);
  const trimmed = raw.trim();
  if (!trimmed) return renderMarkdownToHtml("(empty answer)");

  const fenceRe = /```(?:svg|xml|html)?\s*([\s\S]*?)```/gi;
  let html = "";
  let cursor = 0;
  let hasSvg = false;
  let match;

  while ((match = fenceRe.exec(raw)) !== null) {
    const before = raw.slice(cursor, match.index);
    if (before.trim()) html += renderMarkdownToHtml(before);
    const blockRaw = String(match[1] || "");
    const decoded = decodeBasicHtmlEntities(blockRaw);
    const svgCandidates = extractInlineSvgCandidates(decoded);
    if (svgCandidates.length) {
      let rendered = 0;
      svgCandidates.forEach((candidate) => {
        const safeSvg = sanitizeSvgMarkup(candidate);
        if (safeSvg) {
          rendered++;
          hasSvg = true;
          html += `<div class="chat-svg-wrap">${safeSvg}</div>`;
        }
      });
      if (!rendered) html += `<pre><code>${escapeHtml(blockRaw)}</code></pre>`;
    } else {
      const safeSvg = sanitizeSvgMarkup(decoded);
      if (safeSvg) {
        hasSvg = true;
        html += `<div class="chat-svg-wrap">${safeSvg}</div>`;
      } else {
        html += `<pre><code>${escapeHtml(blockRaw)}</code></pre>`;
      }
    }
    cursor = match.index + match[0].length;
  }

  const tail = raw.slice(cursor);
  if (tail.trim()) html += renderMarkdownToHtml(tail);

  if (!hasSvg) {
    const decodedRaw = decodeBasicHtmlEntities(raw);
    const safeSvgs = Array.from(
      new Set([
        ...extractInlineSvgCandidates(raw),
        ...extractInlineSvgCandidates(decodedRaw),
      ]),
    )
      .map((candidate) => sanitizeSvgMarkup(candidate))
      .filter(Boolean);
    if (safeSvgs.length) {
      const withoutInline = raw
        .replace(/<svg[\s\S]*?<\/svg>/gi, "")
        .replace(/&lt;svg[\s\S]*?&lt;\/svg&gt;/gi, "")
        .trim();
      html = withoutInline ? renderMarkdownToHtml(withoutInline) : "";
      safeSvgs.forEach((safeSvg) => {
        html += `<div class="chat-svg-wrap">${safeSvg}</div>`;
      });
    }
  }

  return html || renderMarkdownToHtml(trimmed);
}

function formatDurationCompact(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours) return `${hours}h ${minutes}m`;
  if (minutes) return `${minutes}m ${secs}s`;
  return `${secs}s`;
}

function formatClockLabel(value) {
  if (!value) return "n/a";
  try {
    return new Date(value).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch (error) {
    return "n/a";
  }
}

function formatDateTime(value) {
  if (!value) return "";
  try {
    return new Date(value).toLocaleString();
  } catch (error) {
    return String(value);
  }
}

function formatOperationDuration(value) {
  const milliseconds = Math.max(0, Number(value) || 0);
  if (!milliseconds) return "";
  if (milliseconds < 1000) return `${Math.round(milliseconds)} ms`;
  return `${(milliseconds / 1000).toFixed(milliseconds < 10000 ? 1 : 0)} s`;
}

function operationCategoryLabel(category) {
  const labels = {
    knx: "KNX",
    llm: "LLM",
    tool: "Tool",
    autonomous: "Autonomous",
    system: "System",
  };
  return labels[String(category || "")] || String(category || "Activity");
}

function operationStatusLabel(status) {
  const labels = {
    observed: "Observed",
    sent: "Sent",
    succeeded: "Succeeded",
    failed: "Failed",
    submitted: "Submitted",
    started: "Started",
    awaiting_confirmation: "Awaiting confirmation",
    timed_out: "Timed out",
    rejected: "Rejected",
    cancelled: "Cancelled",
    expired: "Expired",
    confirmed: "Confirmed",
  };
  const key = String(status || "");
  return labels[key] || key.replace(/_/g, " ") || "Unknown";
}

function operationFlowLabel(item) {
  const direction = String(item && item.direction ? item.direction : "internal");
  const action = String(item && item.action ? item.action : "activity");
  const category = String(item && item.category ? item.category : "");
  const source = String(item && item.source ? item.source : "").toLowerCase();
  const status = String(item && item.status ? item.status : "");
  if (direction === "outbound") {
    if (action === "knx_write")
      return category === "knx"
        ? "Local interface → KNX bus · write transmitted"
        : "LLM/tool → KNX · command sent";
    if (action === "knx_read") {
      if (category === "knx")
        return "Local interface → KNX bus · read transmitted";
      return source === "state-reconciler"
        ? "Reconciler → KNX · read sent"
        : "LLM/tool → KNX · read sent";
    }
    if (action === "knx_response")
      return "Local interface → KNX bus · response transmitted";
    if (action === "notification")
      return "Cerebrum → user · notification sent";
    if (action === "tool_request")
      return "LLM → external tool · request sent";
  }
  if (direction === "inbound")
    return "KNX bus → Node · telegram received";
  if (action === "knx_write") {
    if (status === "awaiting_confirmation")
      return "KNX command awaiting confirmation · not sent";
    if (["cancelled", "expired", "rejected"].includes(status))
      return "KNX command not sent";
  }
  return "";
}

function operationFlowClasses(item) {
  return [
    `operation-direction-${String(item && item.direction ? item.direction : "internal")}`,
    `operation-action-${String(item && item.action ? item.action : "activity")}`,
  ];
}

function formatOperationDetails(details) {
  if (!details || typeof details !== "object" || !Object.keys(details).length)
    return "";
  try {
    return JSON.stringify(details, null, 2);
  } catch (error) {
    return String(details);
  }
}

function formatOperationsRangeSummary() {
  if (!state.cerebrumOperationsFrom) return "";
  const from = formatDateTime(state.cerebrumOperationsFrom);
  const to = formatDateTime(state.cerebrumOperationsTo);
  const count = filteredCerebrumOperations.value.length;
  const truncated = state.cerebrumOperationsTruncated;
  const copies = {
    it: `Da ${from} a ${to} · ${count} elementi mostrati${truncated ? " · l’elenco è limitato a 2.000 elementi, preservando le operazioni del nodo e i telegrammi KNX più recenti" : ""}`,
    de: `Von ${from} bis ${to} · ${count} Einträge angezeigt${truncated ? " · die Liste ist auf 2.000 Einträge begrenzt und bewahrt Knotenoperationen sowie die neuesten KNX-Telegramme" : ""}`,
    fr: `Du ${from} au ${to} · ${count} entrées affichées${truncated ? " · la liste est limitée à 2 000 entrées en conservant les opérations du nœud et les télégrammes KNX les plus récents" : ""}`,
    es: `De ${from} a ${to} · ${count} entradas mostradas${truncated ? " · la lista está limitada a 2.000 entradas, conservando las operaciones del nodo y los telegramas KNX más recientes" : ""}`,
    "zh-CN": `${from} 至 ${to} · 显示 ${count} 条记录${truncated ? " · 列表限制为 2,000 条，同时保留节点操作和最新的 KNX 报文" : ""}`,
    en: `From ${from} to ${to} · showing ${count} entries${truncated ? " · the list is limited to 2,000 entries while preserving node operations and the newest KNX telegrams" : ""}`,
  };
  return copies[uiLanguage.value] || copies.en;
}

function formatByteSize(value) {
  const bytes = Math.max(0, Number(value) || 0);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024)
    return `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function normalizeAnomalyPayload(entry) {
  return entry && entry.payload && typeof entry.payload === "object"
    ? entry.payload
    : {};
}

function toTrimmedText(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function cloneJson(value, fallback = null) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (error) {
    return fallback;
  }
}

function normalizeStringListForSnapshot(list = []) {
  return Array.from(
    new Set(
      (Array.isArray(list) ? list : [])
        .map((item) => String(item || "").trim())
        .filter(Boolean),
    ),
  ).sort();
}

function parseAreaTagsInput(value = "") {
  return normalizeStringListForSnapshot(String(value || "").split(","));
}

function buildAreaDraftSnapshot(data = {}) {
  return JSON.stringify({
    isNew: data.isNew === true,
    areaId: String(data.areaId || "").trim(),
    name: String(data.name || "").trim(),
    description: String(data.description || "").trim(),
    tags: normalizeStringListForSnapshot(data.tags || []),
    gaList: normalizeStringListForSnapshot(data.gaList || []),
    llmPrompt: String(data.llmPrompt || "").trim(),
  });
}

function buildTestPlanBaselineSnapshot(data = {}) {
  return JSON.stringify({
    prompt: String(data.prompt || ""),
    draft: cloneJson(data.draft, null),
  });
}

function captureCurrentTestPlanBaselineData() {
  return {
    selectedId: String(state.testPlanSelectedId || ""),
    prompt: String(state.testPlanPrompt || ""),
    draft: cloneJson(state.testPlanDraft, null),
    generation: cloneJson(state.testPlanGeneration, null),
    showAiPlanner: state.showAiPlanner === true,
  };
}

function setCurrentTestPlanBaseline() {
  testPlanBaselineData = captureCurrentTestPlanBaselineData();
  state.testPlanDraftBaseline =
    buildTestPlanBaselineSnapshot(testPlanBaselineData);
}

function restoreCurrentTestPlanBaseline() {
  const source = cloneJson(testPlanBaselineData, null);
  if (!source) {
    state.testPlanSelectedId = "";
    state.testPlanPrompt = "";
    state.testPlanDraft = null;
    state.testPlanGeneration = null;
    state.testPlanRunConfirmOpen = false;
    state.showAiPlanner = true;
    return;
  }
  state.testPlanSelectedId = String(source.selectedId || "");
  state.testPlanPrompt = String(source.prompt || "");
  state.testPlanDraft = cloneJson(source.draft, null);
  state.testPlanGeneration = cloneJson(source.generation, null);
  state.testPlanRunConfirmOpen = false;
  state.showAiPlanner = source.showAiPlanner !== false;
  if (
    source.draft &&
    source.draft.areaId &&
    suggestedAreas.value.find((area) => area.id === source.draft.areaId)
  ) {
    state.areaSelectedId = source.draft.areaId;
  }
}

function shortNodeLabel(value) {
  const s = String(value || "").trim();
  return s.length > 14 ? `${s.slice(0, 12)}..` : s;
}

function shortNodeSubtitle(value) {
  const s = String(value || "").trim();
  if (!s) return "";
  return s.length > 28 ? `${s.slice(0, 26)}..` : s;
}

function shortNodePayload(value) {
  const s = toTrimmedText(value).replace(/\s+/g, " ");
  if (!s) return "";
  return s.length > 30 ? `${s.slice(0, 28)}..` : s;
}

function normalizeEvent(eventName) {
  const e = String(eventName || "").toLowerCase();
  if (e.includes("repeat")) return "repeat";
  if (e.includes("write")) return "write";
  if (e.includes("response")) return "response";
  if (e.includes("read")) return "read";
  return "other";
}

function dominantEventType(edgeByEvent) {
  const buckets = { write: 0, response: 0, read: 0, repeat: 0, other: 0 };
  Object.keys(edgeByEvent || {}).forEach((name) => {
    const value = Number(edgeByEvent[name] || 0);
    if (value <= 0) return;
    buckets[normalizeEvent(name)] += value;
  });
  return (
    Object.keys(buckets).sort((a, b) => buckets[b] - buckets[a])[0] || "other"
  );
}

function isUniversalFlowNode(node) {
  return !!(node && node.kind === "node" && node.listenAllGA);
}

function buildFlowSource(data) {
  const summary = data && data.summary ? data.summary : {};
  const anomaliesRaw = Array.isArray(data && data.anomalies)
    ? data.anomalies
    : [];
  const patternTransitions = Array.isArray(summary.patternTransitions)
    ? summary.patternTransitions
    : [];
  const patterns = Array.isArray(summary.patterns) ? summary.patterns : [];
  const gaLabels =
    summary && typeof summary.gaLabels === "object" ? summary.gaLabels : {};
  const gaLastPayload =
    summary && typeof summary.gaLastPayload === "object"
      ? summary.gaLastPayload
      : {};
  const gaLastSeenAt =
    summary && typeof summary.gaLastSeenAt === "object"
      ? summary.gaLastSeenAt
      : {};
  const flowKnownGASet = new Set(
    (Array.isArray(summary.flowKnownGAs) ? summary.flowKnownGAs : [])
      .map((item) => String(item || "").trim())
      .filter(Boolean),
  );
  const anomalyByGA = {};

  anomaliesRaw.forEach((entry) => {
    const ga =
      String(
        entry && entry.payload && entry.payload.ga ? entry.payload.ga : "BUS",
      ).trim() || "BUS";
    anomalyByGA[ga] = (anomalyByGA[ga] || 0) + 1;
  });

  const topology =
    summary &&
    summary.flowMapTopology &&
    typeof summary.flowMapTopology === "object"
      ? summary.flowMapTopology
      : null;
  const topologyNodes = Array.isArray(topology && topology.nodes)
    ? topology.nodes
    : [];
  const topologyEdges = Array.isArray(topology && topology.edges)
    ? topology.edges
    : [];
  const edgeMap = new Map();

  const appendEdge = (raw) => {
    const from = String(raw && raw.from ? raw.from : "").trim();
    const to = String(raw && raw.to ? raw.to : "").trim();
    if (!from || !to || from === to) return;
    const key = `${from}->${to}`;
    const next = {
      key,
      from,
      to,
      weight: Math.max(
        1,
        Number(
          (raw &&
            (raw.weight ??
              raw.currentWindowCount ??
              raw.totalCount ??
              raw.count)) ||
            1,
        ),
      ),
      delta: Number(raw && raw.delta ? raw.delta : 0),
      edgeByEvent:
        raw && typeof raw.edgeByEvent === "object" ? raw.edgeByEvent : {},
      lastAtMs: (() => {
        const direct = Number(raw && raw.lastAtMs ? raw.lastAtMs : 0);
        if (Number.isFinite(direct) && direct > 0) return direct;
        const ts = new Date(
          String(raw && raw.lastAt ? raw.lastAt : ""),
        ).getTime();
        return Number.isFinite(ts) ? ts : 0;
      })(),
      linkType: String(raw && raw.linkType ? raw.linkType : "").trim(),
    };
    if (!edgeMap.has(key)) {
      edgeMap.set(key, next);
      return;
    }
    const current = edgeMap.get(key);
    current.weight += next.weight;
    current.delta += next.delta;
    current.lastAtMs = Math.max(
      Number(current.lastAtMs || 0),
      Number(next.lastAtMs || 0),
    );
    Object.keys(next.edgeByEvent || {}).forEach((eventName) => {
      current.edgeByEvent[eventName] =
        Number(current.edgeByEvent[eventName] || 0) +
        Number(next.edgeByEvent[eventName] || 0);
    });
  };

  if (topologyEdges.length) {
    topologyEdges.forEach(appendEdge);
  } else if (patternTransitions.length) {
    patternTransitions.forEach(appendEdge);
  } else {
    patterns.forEach((pattern) =>
      appendEdge({
        from: pattern && pattern.from,
        to: pattern && pattern.to,
        count: pattern && pattern.count,
        edgeByEvent: {},
      }),
    );
  }

  const nodesById = new Map();
  const ensureNode = (id, seed = {}) => {
    const key = String(id || "").trim();
    if (!key) return null;
    if (!nodesById.has(key)) {
      nodesById.set(key, {
        id: key,
        displayId: String(seed.displayId || key).trim() || key,
        kind:
          String(seed.kind || (key.startsWith("N:") ? "node" : "ga")).trim() ||
          "ga",
        subtitle: String(seed.subtitle || "").trim(),
        payload: toTrimmedText(seed.payload),
        anomalyCount: Number(seed.anomalyCount || anomalyByGA[key] || 0),
        inFlow:
          seed.inFlow !== undefined
            ? !!seed.inFlow
            : flowKnownGASet.size
              ? flowKnownGASet.has(key) || key === "BUS" || key.startsWith("N:")
              : true,
        lastSeenAtMs: Number(seed.lastSeenAtMs || 0),
        score: Number(seed.score || 0),
        listenAllGA: seed.listenAllGA === true,
      });
    }
    return nodesById.get(key);
  };

  topologyNodes.forEach((node) => {
    const id = String(node && node.id ? node.id : "").trim();
    if (!id) return;
    ensureNode(id, {
      displayId: node && node.displayId,
      kind: node && node.kind,
      subtitle: node && node.subtitle ? node.subtitle : gaLabels[id],
      payload:
        node && node.payload !== undefined ? node.payload : gaLastPayload[id],
      anomalyCount: Number(
        node && node.anomalyCount ? node.anomalyCount : anomalyByGA[id] || 0,
      ),
      inFlow: node && node.inFlow !== undefined ? !!node.inFlow : undefined,
      lastSeenAtMs: Number(
        node && node.lastSeenAtMs
          ? node.lastSeenAtMs
          : new Date(
              String(
                node && node.lastAt ? node.lastAt : gaLastSeenAt[id] || "",
              ),
            ).getTime() || 0,
      ),
      score: Number(node && node.score ? node.score : 0),
      listenAllGA: node && node.listenAllGA === true,
    });
  });

  Array.from(edgeMap.values()).forEach((edge) => {
    ensureNode(edge.from, {
      subtitle: gaLabels[edge.from],
      payload: gaLastPayload[edge.from],
      lastSeenAtMs:
        new Date(String(gaLastSeenAt[edge.from] || "")).getTime() ||
        edge.lastAtMs ||
        0,
    });
    ensureNode(edge.to, {
      subtitle: gaLabels[edge.to],
      payload: gaLastPayload[edge.to],
      lastSeenAtMs:
        new Date(String(gaLastSeenAt[edge.to] || "")).getTime() ||
        edge.lastAtMs ||
        0,
    });
    const fromNode = nodesById.get(edge.from);
    const toNode = nodesById.get(edge.to);
    if (fromNode) fromNode.score += Number(edge.weight || 0);
    if (toNode) toNode.score += Number(edge.weight || 0);
  });
  (Array.isArray(summary.topGAs) ? summary.topGAs : [])
    .slice(0, 12)
    .forEach((entry) => {
      const id = String(entry && entry.ga ? entry.ga : "").trim();
      if (!id) return;
      const node = ensureNode(id, {
        subtitle: entry && entry.label ? entry.label : gaLabels[id],
        payload: gaLastPayload[id],
        lastSeenAtMs: new Date(String(gaLastSeenAt[id] || "")).getTime() || 0,
      });
      if (node) node.score += Number(entry && entry.count ? entry.count : 0);
    });

  return {
    nodes: Array.from(nodesById.values()),
    edges: Array.from(edgeMap.values())
      .sort((a, b) => Number(b.weight || 0) - Number(a.weight || 0))
      .slice(0, 48),
    telemetryWindowSec: Number(
      summary && summary.graph && summary.graph.windowSec
        ? summary.graph.windowSec
        : summary?.meta?.analysisWindowSec || 0,
    ),
  };
}

function buildVisibleFlowGraph(source) {
  let allNodes = Array.isArray(source && source.nodes)
    ? source.nodes.slice()
    : [];
  const allEdges = Array.isArray(source && source.edges)
    ? source.edges.slice()
    : [];
  if (state.flowShowUniversalNodes !== true) {
    allNodes = allNodes.filter((node) => !isUniversalFlowNode(node));
  }
  const allowedIds = new Set(allNodes.map((node) => node.id));
  const selectedSet = new Set(
    (state.flowSelectedGa || [])
      .map((item) => String(item || "").trim())
      .filter((item) => item && allowedIds.has(item)),
  );
  const maxNodes = Math.max(4, Math.min(32, Number(state.flowMaxNodes) || 14));
  let visibleNodes = allNodes.slice().sort((a, b) => {
    const scoreA = Number(a.anomalyCount || 0) * 10 + Number(a.score || 0);
    const scoreB = Number(b.anomalyCount || 0) * 10 + Number(b.score || 0);
    if (scoreB !== scoreA) return scoreB - scoreA;
    return String(a.id || "").localeCompare(String(b.id || ""));
  });

  if (selectedSet.size) {
    const neighborIds = new Set(selectedSet);
    allEdges.forEach((edge) => {
      if (selectedSet.has(edge.from)) neighborIds.add(edge.to);
      if (selectedSet.has(edge.to)) neighborIds.add(edge.from);
    });
    visibleNodes = visibleNodes.filter((node) => neighborIds.has(node.id));
  } else {
    visibleNodes = visibleNodes.slice(0, maxNodes);
  }

  const visibleIds = new Set(visibleNodes.map((node) => node.id));
  const visibleEdges = allEdges.filter(
    (edge) => visibleIds.has(edge.from) && visibleIds.has(edge.to),
  );
  const visibleWeightMax = Math.max(
    ...visibleEdges.map((edge) => Number(edge.weight || 0)),
    1,
  );
  const cols = Math.max(
    2,
    Math.min(6, Math.ceil(Math.sqrt(Math.max(visibleNodes.length, 4) * 1.5))),
  );
  const rows = Math.max(1, Math.ceil(visibleNodes.length / cols));
  const width = 1080;
  const height = Math.max(420, 140 + (rows - 1) * 150);
  const positions = new Map();
  visibleNodes.forEach((node, index) => {
    const row = Math.floor(index / cols);
    const col = index % cols;
    const x =
      cols === 1
        ? width / 2
        : 90 + col * ((width - 180) / Math.max(cols - 1, 1));
    const y = 92 + row * 148;
    positions.set(node.id, { x, y, row, col });
  });

  const now = Date.now();
  const edges = visibleEdges
    .map((edge, index) => {
      const fromPos = positions.get(edge.from);
      const toPos = positions.get(edge.to);
      if (!fromPos || !toPos) return null;
      const dx = toPos.x - fromPos.x;
      const dy = toPos.y - fromPos.y;
      const distance = Math.max(Math.hypot(dx, dy), 1);
      const ux = dx / distance;
      const uy = dy / distance;
      const nodeRadius = 24;
      const startX = fromPos.x + ux * (nodeRadius + 2);
      const startY = fromPos.y + uy * (nodeRadius + 2);
      const endX = toPos.x - ux * (nodeRadius + 8);
      const endY = toPos.y - uy * (nodeRadius + 8);
      const perpX = -uy;
      const perpY = ux;
      const bend = 28 + (index % 3) * 14;
      const sign = index % 2 === 0 ? 1 : -1;
      const controlX = (startX + endX) / 2 + perpX * bend * sign;
      const controlY = (startY + endY) / 2 + perpY * bend * sign;
      const eventType = dominantEventType(edge.edgeByEvent);
      const active =
        Number(edge.lastAtMs || 0) > 0 &&
        now - Number(edge.lastAtMs || 0) <= 5000;
      return {
        key: edge.key,
        from: edge.from,
        to: edge.to,
        d: `M ${startX} ${startY} Q ${controlX} ${controlY} ${endX} ${endY}`,
        width: (
          0.9 +
          (Number(edge.weight || 0) / visibleWeightMax) * 1.7
        ).toFixed(2),
        color: FLOW_EVENT_COLORS[eventType] || FLOW_EVENT_COLORS.other,
        opacity: active ? 0.82 : 0.24,
        markerId: `flow-arrow-${eventType}`,
        tooltip: `${edge.from} -> ${edge.to} | traffic: ${Number(edge.weight || 0)}${edge.delta ? ` | delta: ${edge.delta > 0 ? "+" : ""}${edge.delta}` : ""}`,
        active,
      };
    })
    .filter(Boolean);

  return {
    width,
    height,
    telemetryWindowSec: Number(
      source && source.telemetryWindowSec ? source.telemetryWindowSec : 0,
    ),
    nodes: visibleNodes.map((node) => {
      const pos = positions.get(node.id);
      const lastSeenAtMs = Number(node.lastSeenAtMs || 0);
      return Object.assign({}, node, pos, {
        shortLabel: shortNodeLabel(node.displayId || node.id),
        shortSubtitle: shortNodeSubtitle(node.subtitle),
        shortPayload: shortNodePayload(node.payload),
        isIdle: lastSeenAtMs > 0 && now - lastSeenAtMs > 45000,
      });
    }),
    edges,
    maxNodes,
    selectedCount: selectedSet.size,
  };
}

const selectedNode = computed(
  () => state.nodes.find((node) => node.id === state.selectedNodeId) || null,
);
const chatLearningDirty = computed(
  () => state.chatLearningContent !== state.chatLearningBaseline,
);
const chatLearningEditorBytes = computed(
  () => new Blob([String(state.chatLearningContent || "")]).size,
);
const chatLearningTooLarge = computed(
  () => chatLearningEditorBytes.value > state.chatLearningMaxBytes,
);
const chatLearningSimpleView = computed(() => {
  try {
    return formatChatLearningSimpleText(state.chatLearningContent, {
      language: uiLanguage.value,
    });
  } catch (error) {
    return "";
  }
});
const chatLearningViewError = computed(() => {
  if (!state.chatLearningContent) return "";
  try {
    parseChatLearningNativeFile(state.chatLearningContent);
    return "";
  } catch (error) {
    return error.message || "Invalid Cerebrum Learning file";
  }
});
const cerebrumMemoryDirty = computed(
  () => state.cerebrumMemoryContent !== state.cerebrumMemoryBaseline,
);
const cerebrumMemoryEditorBytes = computed(
  () => new Blob([String(state.cerebrumMemoryContent || "")]).size,
);
const cerebrumMemoryTooLarge = computed(
  () => cerebrumMemoryEditorBytes.value > state.cerebrumMemoryMaxBytes,
);
const cerebrumMemorySimpleView = computed(() => {
  try {
    return formatCerebrumMemorySimpleText(state.cerebrumMemoryContent, {
      language: uiLanguage.value,
    });
  } catch (error) {
    return "";
  }
});
const cerebrumMemoryViewError = computed(() => {
  if (!state.cerebrumMemoryContent) return "";
  try {
    formatCerebrumMemoryJson(state.cerebrumMemoryContent);
    return "";
  } catch (error) {
    return (
      error.message ||
      "The Cerebrum JSON is not valid. Switch to JSON to correct it."
    );
  }
});
const cerebrumOperationStatusOptions = computed(() => {
  const preferredOrder = [
    "observed",
    "sent",
    "succeeded",
    "confirmed",
    "submitted",
    "started",
    "awaiting_confirmation",
    "timed_out",
    "failed",
    "rejected",
    "cancelled",
    "expired",
  ];
  const statuses = new Set(
    (Array.isArray(state.cerebrumOperationsItems)
      ? state.cerebrumOperationsItems
      : []
    )
      .map((item) => String(item && item.status ? item.status : ""))
      .filter(Boolean),
  );
  return preferredOrder
    .filter((status) => statuses.delete(status))
    .concat(Array.from(statuses).sort());
});
const filteredCerebrumOperations = computed(() => {
  const category = String(state.cerebrumOperationsFilter || "all");
  const status = String(state.cerebrumOperationsStatusFilter || "all");
  const search = normalizeComparableText(state.cerebrumOperationsSearch);
  return (Array.isArray(state.cerebrumOperationsItems)
    ? state.cerebrumOperationsItems
    : []
  ).filter((item) => {
    if (category !== "all" && String(item && item.category) !== category)
      return false;
    if (status !== "all" && String(item && item.status) !== status) return false;
    if (!search) return true;
    const details = item && item.details ? JSON.stringify(item.details) : "";
    return normalizeComparableText(
      [
        item && item.title,
        item && item.summary,
        item && item.source,
        item && item.operation,
        item && item.status,
        item && item.direction,
        item && item.action,
        details,
      ].join(" "),
    ).includes(search);
  });
});
const summary = computed(() =>
  state.stateData && state.stateData.summary ? state.stateData.summary : {},
);
const nodeInfo = computed(() =>
  state.stateData && state.stateData.node ? state.stateData.node : {},
);
const etsAccessState = computed(() => {
  const snapshot =
    state.etsAccessData || (state.stateData && state.stateData.etsAccess);
  return (
    snapshot || {
      configured: false,
      totalCount: 0,
      selectedCount: 0,
      readOnlyCount: 0,
      gateway: { configured: false, id: "", name: "" },
      items: [],
    }
  );
});
const normalizeEtsAccessDraftList = (values) =>
  Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => String(value || "").trim())
        .filter(Boolean),
    ),
  ).sort();
const buildEtsAccessDraftFingerprint = (selected, readOnly) =>
  JSON.stringify({
    selected: normalizeEtsAccessDraftList(selected),
    readOnly: normalizeEtsAccessDraftList(readOnly),
  });
const etsAccessDirty = computed(
  () =>
    buildEtsAccessDraftFingerprint(
      state.etsAccessSelected,
      state.etsAccessReadOnly,
    ) !== state.etsAccessBaseline,
);
const etsAccessSelectedSet = computed(
  () => new Set(normalizeEtsAccessDraftList(state.etsAccessSelected)),
);
const etsAccessReadOnlySet = computed(
  () => new Set(normalizeEtsAccessDraftList(state.etsAccessReadOnly)),
);
const etsAccessMatchingItems = computed(() => {
  const search = String(state.etsAccessFilter || "")
    .trim()
    .toLowerCase();
  return (
    Array.isArray(etsAccessState.value.items) ? etsAccessState.value.items : []
  ).filter((item) => {
    if (!search) return true;
    const haystack = [
      item.ga,
      item.label,
      item.etsName,
      item.hierarchyPath,
      item.dpt,
    ]
      .concat(Array.isArray(item.tags) ? item.tags : [])
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return haystack.includes(search);
  });
});
const visibleEtsAccessItems = computed(() =>
  etsAccessMatchingItems.value.slice(0, 250),
);
const areasState = computed(() =>
  state.stateData && state.stateData.areas
    ? state.stateData.areas
    : { suggested: [], totals: {} },
);
const suggestedAreas = computed(() =>
  Array.isArray(areasState.value && areasState.value.suggested)
    ? areasState.value.suggested
    : [],
);
const aiGeneratedAreas = computed(() =>
  suggestedAreas.value.filter((area) =>
    String(area && area.id ? area.id : "").startsWith("llm:"),
  ),
);
const aiGeneratedAreaCount = computed(() =>
  Number(aiGeneratedAreas.value.length || 0),
);
const areaTotals = computed(() =>
  areasState.value && areasState.value.totals ? areasState.value.totals : {},
);
const profiles = computed(() =>
  Array.isArray(state.stateData && state.stateData.profiles)
    ? state.stateData.profiles
    : [],
);
const profileReport = computed(() =>
  state.stateData && state.stateData.profileReport
    ? state.stateData.profileReport
    : null,
);
const actuatorTests = computed(() =>
  Array.isArray(state.stateData && state.stateData.actuatorTests)
    ? state.stateData.actuatorTests
    : [],
);
const actuatorTestReport = computed(() =>
  state.stateData && state.stateData.actuatorTestReport
    ? state.stateData.actuatorTestReport
    : null,
);
const testPlans = computed(() =>
  Array.isArray(state.stateData && state.stateData.testPlans)
    ? state.stateData.testPlans
    : [],
);
const filteredTestPlans = computed(() => {
  const search = String(state.testPlanSearch || "")
    .trim()
    .toLowerCase();
  return testPlans.value.filter((plan) => {
    if (!search) return true;
    const haystack = [plan.name, plan.description, plan.areaName, plan.areaId]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return haystack.includes(search);
  });
});
const testPlanReport = computed(() =>
  state.stateData && state.stateData.testPlanReport
    ? state.stateData.testPlanReport
    : null,
);
const persistedTestResults = computed(() =>
  Array.isArray(state.stateData && state.stateData.testResults)
    ? state.stateData.testResults
    : [],
);
const liveTestResult = computed(() => {
  if (
    !state.liveTestResultId ||
    !testPlanReport.value ||
    testPlanReport.value.id !== state.liveTestResultId
  )
    return null;
  return Object.assign({}, testPlanReport.value, {
    live: state.testPlanRunning === true,
  });
});
const sidebarTestResults = computed(() => {
  const out = [];
  const seen = new Set();
  const pushResult = (report, live = false) => {
    if (!report || typeof report !== "object" || !report.id) return;
    const id = String(report.id);
    if (seen.has(id)) return;
    seen.add(id);
    out.push(Object.assign({}, report, { live }));
  };
  pushResult(liveTestResult.value, true);
  persistedTestResults.value.forEach((report) => pushResult(report, false));
  return out;
});
const selectedTestResult = computed(() => {
  if (state.selectedTestResultId) {
    const found = sidebarTestResults.value.find(
      (report) => report && report.id === state.selectedTestResultId,
    );
    if (found) return found;
  }
  return liveTestResult.value || persistedTestResults.value[0] || null;
});
const isViewingTestResultOnly = computed(() => {
  return (
    state.activeTab === "tests" &&
    state.testResultFocusMode === true &&
    !!selectedTestResult.value
  );
});
const localizedPresetQuestions = computed(() => {
  const source = PRESET_QUESTIONS.map((question) => ({
    key: String(question || ""),
    text: String(question || ""),
  }));
  return source
    .map((question) => {
      const raw = String(question.text || "").trim();
      const localized = String(localizeUiText(raw) || "").trim();
      return {
        key: String(question.key || raw),
        text: localized || raw,
      };
    })
    .filter((item) => item.text);
});
const filteredAreas = computed(() => {
  const search = String(state.areaSearch || "")
    .trim()
    .toLowerCase();
  return suggestedAreas.value.filter((area) => {
    if (!search) return true;
    const haystack = [
      area.path,
      area.name,
      area.parentName,
      ...(Array.isArray(area.tags) ? area.tags : []),
      ...(Array.isArray(area.sampleLabels) ? area.sampleLabels : []),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return haystack.includes(search);
  });
});
const selectedArea = computed(() => {
  if (
    state.areaDraftIsNew === true &&
    !String(state.areaSelectedId || "").trim()
  )
    return null;
  if (state.areaSelectedId) {
    const found = suggestedAreas.value.find(
      (area) => area.id === state.areaSelectedId,
    );
    if (found) return found;
  }
  return null;
});
const selectedTestArea = computed(() => {
  if (state.testAreaSelectedId) {
    const found = suggestedAreas.value.find(
      (area) => area.id === state.testAreaSelectedId,
    );
    if (found) return found;
  }
  return suggestedAreas.value[0] || null;
});
const plannerCatalogArea = computed(() => {
  const draftAreaId = String(
    state.testPlanDraft && state.testPlanDraft.areaId
      ? state.testPlanDraft.areaId
      : "",
  ).trim();
  if (draftAreaId) {
    const found = suggestedAreas.value.find((area) => area.id === draftAreaId);
    if (found) return found;
  }
  return selectedTestArea.value;
});
const filteredGaCatalog = computed(() => {
  const search = String(state.gaCatalogSearch || "")
    .trim()
    .toLowerCase();
  const selectedSet = new Set(
    (state.areaDraftGaList || [])
      .map((item) => String(item || "").trim())
      .filter(Boolean),
  );
  return (Array.isArray(state.gaCatalog) ? state.gaCatalog : [])
    .filter((item) => {
      if (!item || !item.ga || selectedSet.has(item.ga)) return false;
      if (!search) return true;
      const haystack = [
        item.ga,
        item.label,
        item.hierarchyPath,
        ...(Array.isArray(item.tags) ? item.tags : []),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(search);
    })
    .slice(0, 80);
});
const areaDraftGaDetails = computed(() => {
  const byGa = new Map(
    (Array.isArray(state.gaCatalog) ? state.gaCatalog : []).map((item) => [
      String(item && item.ga ? item.ga : "").trim(),
      item,
    ]),
  );
  return (state.areaDraftGaList || []).map((ga) => {
    const item = byGa.get(String(ga || "").trim());
    return (
      item || {
        ga: String(ga || "").trim(),
        label: "",
        dpt: "",
        hierarchyPath: "",
        tags: [],
      }
    );
  });
});
const plannerCommandOptions = computed(() =>
  Array.isArray(state.testPlanCatalog && state.testPlanCatalog.commandSignals)
    ? state.testPlanCatalog.commandSignals
    : [],
);
const plannerStatusOptions = computed(() =>
  Array.isArray(state.testPlanCatalog && state.testPlanCatalog.statusSignals)
    ? state.testPlanCatalog.statusSignals
    : [],
);
const selectedProfile = computed(() => {
  if (state.profileDraftMode === true) return null;
  if (state.profileSelectedId) {
    const found = profiles.value.find(
      (profile) => profile.id === state.profileSelectedId,
    );
    if (found) return found;
  }
  return profiles.value[0] || null;
});
const selectedActuatorPreset = computed(() => {
  if (state.actuatorDraftMode === true) return null;
  if (state.actuatorPresetSelectedId) {
    const found = actuatorTests.value.find(
      (preset) => preset.id === state.actuatorPresetSelectedId,
    );
    if (found) return found;
  }
  return actuatorTests.value[0] || null;
});
const selectedTestPlan = computed(() => {
  if (!state.testPlanSelectedId) return null;
  return (
    testPlans.value.find((plan) => plan.id === state.testPlanSelectedId) || null
  );
});
const currentRunningStep = computed(() => {
  if (
    !state.testPlanRunningStepId ||
    !state.testPlanDraft ||
    !Array.isArray(state.testPlanDraft.steps)
  )
    return null;
  return (
    state.testPlanDraft.steps.find(
      (step) =>
        String(step && step.id ? step.id : "") === state.testPlanRunningStepId,
    ) || null
  );
});
const hasDraftSteps = computed(() => {
  return !!(
    state.testPlanDraft &&
    Array.isArray(state.testPlanDraft.steps) &&
    state.testPlanDraft.steps.length > 0
  );
});
const showAiPlannerSection = computed(() => state.showAiPlanner === true);
const showAiAreaBuilderSection = computed(
  () => state.showAiAreaBuilder === true,
);
const hasUnsavedTestPlanChanges = computed(() => {
  if (!state.testPlanDraft) return false;
  return (
    buildTestPlanBaselineSnapshot({
      prompt: state.testPlanPrompt,
      draft: state.testPlanDraft,
    }) !== state.testPlanDraftBaseline
  );
});
const hasUnsavedAreaChanges = computed(() => {
  const hasEditor = state.areaDraftIsNew === true || !!selectedArea.value;
  if (!hasEditor) return false;
  const currentSnapshot = buildAreaDraftSnapshot({
    isNew: state.areaDraftIsNew === true,
    areaId: String(state.areaDraftId || state.areaSelectedId || "").trim(),
    name: state.areaDraftName,
    description: state.areaDraftDescription,
    tags: parseAreaTagsInput(state.areaDraftTags),
    gaList: state.areaDraftGaList || [],
    llmPrompt: state.areaLlmPrompt,
  });
  if (state.areaDraftIsNew === true) {
    const baselineNewSnapshot = buildAreaDraftSnapshot({
      isNew: true,
      areaId: "",
      name: "",
      description: "",
      tags: [],
      gaList: [],
      llmPrompt: "",
    });
    return currentSnapshot !== baselineNewSnapshot;
  }
  const area = selectedArea.value;
  if (!area) return false;
  const baselineExistingSnapshot = buildAreaDraftSnapshot({
    isNew: false,
    areaId: String(area.id || "").trim(),
    name: String(area.name || ""),
    description: String(area.customDescription || ""),
    tags: Array.isArray(area.tags) ? area.tags : [],
    gaList: Array.isArray(area.gaList) ? area.gaList : [],
    llmPrompt: "",
  });
  return currentSnapshot !== baselineExistingSnapshot;
});
const anomalies = computed(() =>
  Array.isArray(state.stateData && state.stateData.anomalies)
    ? state.stateData.anomalies.slice().reverse()
    : [],
);
const topGroups = computed(() => {
  const rows = Array.isArray(summary.value.topGAs) ? summary.value.topGAs : [];
  const gaLabels =
    summary.value && typeof summary.value.gaLabels === "object"
      ? summary.value.gaLabels
      : {};
  return rows.slice(0, 10).map((entry) => {
    const item = entry && typeof entry === "object" ? entry : {};
    const ga = String(item.ga || "").trim();
    const labelFromEntry = String(item.label || "").trim();
    const labelFromSummary = ga ? String(gaLabels[ga] || "").trim() : "";
    return Object.assign({}, item, {
      ga,
      label: labelFromEntry || labelFromSummary,
    });
  });
});
const eventEntries = computed(() => {
  const byEvent =
    summary.value &&
    summary.value.byEvent &&
    typeof summary.value.byEvent === "object"
      ? summary.value.byEvent
      : {};
  return Object.keys(byEvent)
    .map((name) => ({ name, count: Number(byEvent[name] || 0) }))
    .filter((item) => item.count > 0)
    .sort((a, b) => b.count - a.count);
});
const maxEventCount = computed(() =>
  Math.max(...eventEntries.value.map((item) => item.count), 1),
);
const flowSource = computed(() => buildFlowSource(state.stateData));
const flowGraph = computed(() => buildVisibleFlowGraph(flowSource.value));
const flowSelectableNodes = computed(() => {
  const search = String(state.flowSearch || "")
    .trim()
    .toLowerCase();
  return flowSource.value.nodes
    .slice()
    .filter(
      (node) =>
        state.flowShowUniversalNodes === true || !isUniversalFlowNode(node),
    )
    .sort((a, b) => String(a.id || "").localeCompare(String(b.id || "")))
    .filter((node) => {
      if (!search) return true;
      const haystack = `${node.id} ${node.subtitle || ""}`.toLowerCase();
      return haystack.includes(search);
    })
    .slice(0, 120);
});
const busConnection = computed(() => {
  const bus =
    summary.value &&
    summary.value.busConnection &&
    typeof summary.value.busConnection === "object"
      ? summary.value.busConnection
      : null;
  return bus;
});
const summaryText = computed(() => {
  const s = summary.value || {};
  if (!Object.keys(s).length) return "No data available.";
  const counters = s.counters || {};
  const lines = [];
  lines.push(nodeInfo.value.name || selectedNode.value?.name || "Cerebrum");
  lines.push(`Analysis window: ${Number(s.meta?.analysisWindowSec || 0)}s`);
  lines.push(
    `Telegrams: ${Number(counters.telegrams || 0)} | Rate: ${Number(counters.overallRatePerSec || 0)}/s`,
  );
  lines.push(
    `Echoed: ${Number(counters.echoed || 0)} | Repeat: ${Number(counters.repeated || 0)} | Unknown DPT: ${Number(counters.unknownDpt || 0)}`,
  );
  if (busConnection.value) {
    lines.push(
      `Bus: ${String(busConnection.value.currentState || "unknown")} | Connected: ${Number(busConnection.value.connectedPct || 0)}% | Disconnected: ${Number(busConnection.value.disconnectedPct || 0)}%`,
    );
  }
  return lines.join("\n");
});
const busSegments = computed(() => {
  const bus = busConnection.value;
  if (!bus || !Array.isArray(bus.segments)) return [];
  return bus.segments
    .map((segment, index) => {
      const ratioStart = Math.max(
        0,
        Math.min(1, Number(segment && segment.ratioStart) || 0),
      );
      const ratioWidth = Math.max(
        0,
        Math.min(1, Number(segment && segment.ratioWidth) || 0),
      );
      return {
        key: `${index}-${segment?.startedAt || ""}`,
        left: `${(ratioStart * 100).toFixed(3)}%`,
        width: `${Math.max(ratioWidth * 100, 0.4).toFixed(3)}%`,
        title: `${segment?.state === "connected" ? "Connected" : "Disconnected"} | ${formatClockLabel(segment?.startedAt)} -> ${formatClockLabel(segment?.endedAt)} | ${formatDurationCompact(segment?.durationSec || 0)}`,
        className:
          segment?.state === "connected"
            ? "segment-connected"
            : "segment-disconnected",
      };
    })
    .filter((segment) => Number.parseFloat(segment.width) > 0);
});
const chatMessages = computed(() =>
  state.chatMessages.map((item, index) => ({
    key: `${index}-${item.kind}`,
    kind: item.kind,
    rawText: normalizeChatText(item.text),
    html: item.kind === "assistant" ? renderAssistantHtml(item.text) : "",
  })),
);

watch(
  () => state.selectedNodeId,
  (value) => {
    seenScheduledChatEntries.clear();
    state.areaSelectedId = "";
    state.testAreaSelectedId = loadSelectedTestAreaIdForNode(value || "");
    resetChatLearningEditor();
    resetCerebrumMemoryEditor();
    resetCerebrumOperations();
    state.etsAccessFilter = "";
    state.etsAccessSelected = [];
    state.etsAccessReadOnly = [];
    state.etsAccessBaseline = "";
    state.etsAccessLoadedNodeId = "";
    state.etsAccessData = null;
    state.etsAccessError = "";
    if (value && state.activeTab === "cerebrum") {
      if (state.cerebrumTab === "learning") loadChatLearningFile();
      if (state.cerebrumTab === "memory") loadCerebrumMemoryFile();
      if (state.cerebrumTab === "operations") loadCerebrumOperations();
    }
  },
);

watch(
  () => state.voiceEnabled,
  (value) => {
    saveBoolean(voiceKey, value);
    if (value !== true) stopActiveStepAudio();
  },
);

watch(desktopSidebarExpanded, (value) => {
  saveBoolean(sidebarKey, value);
});

watch(
  () => state.activeTab,
  (value) => {
    saveString(tabKey, value || "cerebrum");
    if (value) nextTick(() => window.scrollTo(0, 0));
    if (["etsAccess", "areas", "tests", "results"].includes(value))
      state.knxMenuOpen = true;
  },
);

watch(
  () => state.chatLearningViewMode,
  (value) => {
    saveString(chatLearningViewKey, value === "native" ? "native" : "simple");
  },
);

watch(
  () => state.cerebrumMemoryViewMode,
  (value) => {
    saveString(cerebrumMemoryViewKey, value === "json" ? "json" : "simple");
  },
);

watch(
  () => state.flowMaxNodes,
  (value) => {
    state.flowMaxNodes = Math.max(4, Math.min(32, Number(value) || 14));
    saveFlowPrefs();
  },
);
watch(
  () => (state.flowSelectedGa || []).join("|"),
  () => {
    saveFlowPrefs();
  },
);
watch(
  () => state.flowShowUniversalNodes,
  (value) => {
    if (value !== true) {
      state.flowSelectedGa = (state.flowSelectedGa || []).filter((id) => {
        const node = flowSource.value.nodes.find((item) => item.id === id);
        return !isUniversalFlowNode(node);
      });
    }
    saveFlowPrefs();
  },
);

watch(
  () => suggestedAreas.value.map((area) => area.id).join("|"),
  () => {
    if (!suggestedAreas.value.length) {
      state.areaSelectedId = "";
      state.testAreaSelectedId = "";
      if (state.activeTab === "tests") state.activeTab = "areas";
      return;
    }
    if (
      state.areaDraftIsNew === true &&
      !String(state.areaSelectedId || "").trim()
    ) {
      const currentTestAreaId = String(state.testAreaSelectedId || "").trim();
      if (restoreSelectedTestAreaForCurrentNode()) return;
      if (
        !currentTestAreaId ||
        !suggestedAreas.value.find((area) => area.id === currentTestAreaId)
      ) {
        state.testAreaSelectedId = suggestedAreas.value[0].id;
      }
      return;
    }
    const currentAreaId = String(state.areaSelectedId || "").trim();
    if (
      currentAreaId &&
      !suggestedAreas.value.find((area) => area.id === currentAreaId)
    ) {
      state.areaSelectedId = "";
    }
    const currentTestAreaId = String(state.testAreaSelectedId || "").trim();
    if (restoreSelectedTestAreaForCurrentNode()) {
      return;
    }
    if (
      !currentTestAreaId ||
      !suggestedAreas.value.find((area) => area.id === currentTestAreaId)
    ) {
      state.testAreaSelectedId = suggestedAreas.value[0].id;
    }
  },
);

watch(
  () => state.testAreaSelectedId,
  (value) => {
    if (!state.selectedNodeId) return;
    saveSelectedTestAreaIdForNode(state.selectedNodeId, value || "");
  },
);

watch(
  () =>
    selectedArea.value
      ? JSON.stringify({
          id: selectedArea.value.id,
          name: selectedArea.value.name,
          customDescription: selectedArea.value.customDescription || "",
          tags: selectedArea.value.tags || [],
        })
      : "",
  () => {
    if (
      state.areaDraftIsNew === true &&
      !String(state.areaSelectedId || "").trim()
    )
      return;
    const area = selectedArea.value;
    if (!area) {
      state.areaDraftId = "";
      state.areaDraftName = "";
      state.areaDraftDescription = "";
      state.areaDraftTags = "";
      state.areaDraftGaList = [];
      state.areaLlmPrompt = "";
      state.areaLlmError = "";
      state.areaDraftIsNew = false;
      return;
    }
    state.areaDraftId = String(area.id || "");
    state.areaDraftName = String(area.name || "");
    state.areaDraftDescription = String(area.customDescription || "");
    state.areaDraftTags = Array.isArray(area.tags) ? area.tags.join(", ") : "";
    state.areaDraftGaList = Array.isArray(area.gaList)
      ? area.gaList.slice()
      : [];
    state.areaLlmPrompt = "";
    state.areaLlmError = "";
    state.areaDraftIsNew = false;
  },
);

watch(
  () => (plannerCatalogArea.value ? plannerCatalogArea.value.id : ""),
  async (areaId, previousAreaId) => {
    if (!areaId || !state.selectedNodeId) {
      state.testPlanCatalog = null;
      state.testPlanCatalogError = "";
      return;
    }
    if (previousAreaId && areaId !== previousAreaId) {
      state.testPlanRunConfirmOpen = false;
      if (state.testPlanDraft && !state.testPlanSelectedId) {
        state.testPlanDraft.areaId = String(areaId || "");
        state.testPlanDraft.areaName = plannerCatalogArea.value
          ? String(
              plannerCatalogArea.value.path ||
                plannerCatalogArea.value.name ||
                "",
            )
          : "";
      }
    }
    await fetchAreaSignalCatalog();
  },
);

watch(
  () => profiles.value.map((profile) => profile.id).join("|"),
  () => {
    if (!profiles.value.length) {
      state.profileSelectedId = "";
      return;
    }
    if (state.profileDraftMode === true) return;
    if (
      !state.profileSelectedId ||
      !profiles.value.find((profile) => profile.id === state.profileSelectedId)
    ) {
      state.profileSelectedId = profiles.value[0].id;
    }
  },
);

watch(
  () =>
    selectedProfile.value
      ? JSON.stringify({
          id: selectedProfile.value.id,
          name: selectedProfile.value.name,
          description: selectedProfile.value.description,
          targetTags: selectedProfile.value.targetTags || [],
          minActivityPct: selectedProfile.value.minActivityPct,
          maxSilentPct: selectedProfile.value.maxSilentPct,
          maxAnomalies: selectedProfile.value.maxAnomalies,
          builtIn: selectedProfile.value.builtIn === true,
        })
      : "",
  () => {
    const profile = selectedProfile.value;
    if (!profile) {
      state.profileDraftId = "";
      state.profileDraftName = "";
      state.profileDraftDescription = "";
      state.profileDraftTargetTags = "";
      state.profileDraftMinActivityPct = 20;
      state.profileDraftMaxSilentPct = 60;
      state.profileDraftMaxAnomalies = 2;
      return;
    }
    state.profileDraftId = String(profile.id || "");
    state.profileDraftName = String(profile.name || "");
    state.profileDraftDescription = String(profile.description || "");
    state.profileDraftTargetTags = Array.isArray(profile.targetTags)
      ? profile.targetTags.join(", ")
      : "";
    state.profileDraftMinActivityPct = Number(profile.minActivityPct || 20);
    state.profileDraftMaxSilentPct = Number(profile.maxSilentPct || 60);
    state.profileDraftMaxAnomalies = Number(profile.maxAnomalies || 2);
  },
);

watch(
  () => actuatorTests.value.map((preset) => preset.id).join("|"),
  () => {
    if (!actuatorTests.value.length) {
      state.actuatorPresetSelectedId = "";
      return;
    }
    if (state.actuatorDraftMode === true) return;
    if (
      !state.actuatorPresetSelectedId ||
      !actuatorTests.value.find(
        (preset) => preset.id === state.actuatorPresetSelectedId,
      )
    ) {
      state.actuatorPresetSelectedId = actuatorTests.value[0].id;
    }
  },
);

watch(
  () =>
    selectedActuatorPreset.value
      ? JSON.stringify({
          id: selectedActuatorPreset.value.id,
          name: selectedActuatorPreset.value.name,
          description: selectedActuatorPreset.value.description,
          commandGA: selectedActuatorPreset.value.commandGA,
          commandDPT: selectedActuatorPreset.value.commandDPT,
          commandPayload: selectedActuatorPreset.value.commandPayload,
          statusGA: selectedActuatorPreset.value.statusGA,
          statusDPT: selectedActuatorPreset.value.statusDPT,
          statusWriteTimeoutMs:
            selectedActuatorPreset.value.statusWriteTimeoutMs,
          statusResponseTimeoutMs:
            selectedActuatorPreset.value.statusResponseTimeoutMs,
        })
      : "",
  () => {
    const preset = selectedActuatorPreset.value;
    if (!preset) {
      state.actuatorDraftId = "";
      state.actuatorDraftName = "";
      state.actuatorDraftDescription = "";
      state.actuatorDraftCommandGA = "";
      state.actuatorDraftCommandDPT = "";
      state.actuatorDraftCommandPayload = "";
      state.actuatorDraftStatusGA = "";
      state.actuatorDraftStatusDPT = "";
      state.actuatorDraftStatusWriteTimeoutMs = 5000;
      state.actuatorDraftStatusResponseTimeoutMs = 5000;
      return;
    }
    state.actuatorDraftId = String(preset.id || "");
    state.actuatorDraftName = String(preset.name || "");
    state.actuatorDraftDescription = String(preset.description || "");
    state.actuatorDraftCommandGA = String(preset.commandGA || "");
    state.actuatorDraftCommandDPT = String(preset.commandDPT || "");
    state.actuatorDraftCommandPayload = String(preset.commandPayload || "");
    state.actuatorDraftStatusGA = String(preset.statusGA || "");
    state.actuatorDraftStatusDPT = String(preset.statusDPT || "");
    state.actuatorDraftStatusWriteTimeoutMs = Number(
      preset.statusWriteTimeoutMs || 5000,
    );
    state.actuatorDraftStatusResponseTimeoutMs = Number(
      preset.statusResponseTimeoutMs || 5000,
    );
  },
);

watch(
  () => testPlans.value.map((plan) => plan.id).join("|"),
  () => {
    if (!testPlans.value.length) {
      state.testPlanSelectedId = "";
      return;
    }
    if (
      state.testPlanSelectedId &&
      !testPlans.value.find((plan) => plan.id === state.testPlanSelectedId)
    ) {
      state.testPlanSelectedId = "";
    }
  },
);

watch(
  () => sidebarTestResults.value.map((report) => report.id).join("|"),
  () => {
    if (!sidebarTestResults.value.length) {
      state.selectedTestResultId = "";
      return;
    }
    if (
      !state.selectedTestResultId ||
      !sidebarTestResults.value.find(
        (report) => report.id === state.selectedTestResultId,
      )
    ) {
      state.selectedTestResultId = String(sidebarTestResults.value[0].id || "");
    }
    if (
      state.liveTestResultId &&
      persistedTestResults.value.some(
        (report) =>
          String(report && report.id ? report.id : "") ===
          state.liveTestResultId,
      ) &&
      state.testPlanRunning !== true
    ) {
      state.liveTestResultId = "";
    }
  },
);

watch(
  () => `${state.selectedTestResultId}|${state.activeTab}`,
  () => {
    if (state.activeTab !== "results" || !state.selectedTestResultId) return;
    requestAnimationFrame(() => {
      const activeButton = document.querySelector(
        ".results-page-list .area-list-item.active",
      );
      if (activeButton && typeof activeButton.scrollIntoView === "function") {
        activeButton.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
    });
  },
);

function appendChat(kind, text) {
  state.chatMessages.push({ kind, text });
}

function clearChat() {
  state.chatMessages = [];
}

function buildTestPlanMetrics(stepResults, totalStepsOverride = null) {
  const results = Array.isArray(stepResults) ? stepResults : [];
  const totalSteps = Math.max(results.length, Number(totalStepsOverride || 0));
  return {
    totalSteps,
    pass: results.filter((item) => item && item.status === "pass").length,
    warn: results.filter((item) => item && item.status === "warn").length,
    fail: results.filter((item) => item && item.status === "fail").length,
  };
}

function buildTestPlanSuggestions(metrics) {
  const suggestions = [];
  if (Number(metrics && metrics.fail) > 0)
    suggestions.push(
      "At least one feedback object returned an incoherent value. Check the actuator/status pairing in ETS first.",
    );
  if (Number(metrics && metrics.warn) > 0)
    suggestions.push(
      "Some steps did not receive feedback in time. Verify the status group address and the actuator programming.",
    );
  if (!suggestions.length)
    suggestions.push(
      "The selected active test completed with coherent feedback on all verified steps.",
    );
  return suggestions;
}

function buildClientTestPlanReport({ plan, area, stepResults, reportId = "" }) {
  const metrics = buildTestPlanMetrics(
    stepResults,
    Array.isArray(plan && plan.steps) ? plan.steps.length : 0,
  );
  const overallStatus =
    metrics.fail > 0 ? "fail" : metrics.warn > 0 ? "warn" : "pass";
  return {
    id: String(reportId || `${plan.id || "plan"}:${Date.now()}`),
    generatedAt: new Date().toISOString(),
    mode: "ai_test_plan",
    overallStatus,
    name: plan.name,
    description: plan.description,
    prompt: plan.prompt,
    area,
    metrics,
    steps: stepResults,
    suggestions: buildTestPlanSuggestions(metrics),
  };
}

function testResultDisplayName(report) {
  if (!report || typeof report !== "object") return "Test result";
  return String(report.name || report.profile?.name || "Test result");
}

function testResultAreaText(report) {
  if (!report || typeof report !== "object") return "";
  return String(
    report.area?.path || report.area?.name || report.area?.id || "",
  );
}

function testResultModeLabel(report) {
  const mode = String(report && report.mode ? report.mode : "")
    .trim()
    .toLowerCase();
  if (mode === "ai_test_plan") return "Test Plan";
  if (mode === "active_test") return "Actuator";
  if (mode === "read_only") return "Read-only";
  return mode || "Test";
}

function testResultMetricCards(report) {
  const metrics =
    report && report.metrics && typeof report.metrics === "object"
      ? report.metrics
      : {};
  if (String(report && report.mode ? report.mode : "") === "read_only") {
    return [
      { label: "Total GA", value: Number(metrics.totalGAs || 0) },
      { label: "Active GA", value: Number(metrics.activeGaCount || 0) },
      { label: "Silent GA", value: Number(metrics.silentGaCount || 0) },
      { label: "Anomalies", value: Number(metrics.anomalyCount || 0) },
    ];
  }
  if (String(report && report.mode ? report.mode : "") === "active_test") {
    return [
      {
        label: "Command GA",
        value:
          report && report.command && report.command.ga
            ? report.command.ga
            : "n/a",
      },
      {
        label: "Status GA",
        value:
          report &&
          (report.statusResponse?.ga ||
            report.statusWrite?.ga ||
            report.statusRead?.ga)
            ? report.statusResponse?.ga ||
              report.statusWrite?.ga ||
              report.statusRead?.ga
            : "n/a",
      },
      {
        label: "Status",
        value: report && report.overallStatus ? report.overallStatus : "n/a",
      },
      {
        label: "Generated",
        value:
          formatDateTime(
            report && report.generatedAt ? report.generatedAt : "",
          ) || "n/a",
      },
    ];
  }
  return [
    { label: "Total Steps", value: Number(metrics.totalSteps || 0) },
    { label: "Pass", value: Number(metrics.pass || 0) },
    { label: "Warn", value: Number(metrics.warn || 0) },
    { label: "Fail", value: Number(metrics.fail || 0) },
  ];
}

function stringifyResultDetailValue(value) {
  if (value === undefined || value === null || value === "") return "n/a";
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  )
    return String(value);
  try {
    return JSON.stringify(value);
  } catch (error) {
    return String(value);
  }
}

function displayPayloadLabelForDpt(value, dpt, fallback = "n/a") {
  const key = String(dpt || "").trim();
  const raw = value === undefined || value === null ? "" : String(value);
  if (!key) return raw || fallback;
  const normalized = normalizePayloadForDptInput(raw, key);
  const option = dptValueOptions(key).find(
    (item) => String(item.value) === String(normalized),
  );
  if (option && option.label) return option.label;
  return raw || fallback;
}

function formatFeedbackCheckResult(check) {
  if (!check || typeof check !== "object") return "n/a";
  const ga = check.ga || "n/a";
  if (check.ok === true) {
    const payload =
      check.payloadLabel || stringifyResultDetailValue(check.payload);
    const status = check.coherent === false ? "mismatch" : "ok";
    return `${ga} / ${payload} / ${status}`;
  }
  return `${ga} / ${check.error || "timeout"}`;
}

function formatResultMoment(value) {
  return formatDateTime(value || "") || "n/a";
}

function sanitizeFileName(value, fallback = "report") {
  const normalized = String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return normalized || fallback;
}

function buildFeedbackResultGroups({
  command,
  statusWrite,
  statusResponse,
  statusRead,
  expectedPayloadLabel,
  expectedPayload,
}) {
  const resolvedResponse = statusResponse || statusRead;
  return [
    {
      title: "Command",
      items: [
        {
          label: "Command",
          value: `${command?.ga || "n/a"} / ${command?.payloadLabel || stringifyResultDetailValue(command?.payload)}`,
        },
        { label: "Command Sent", value: formatResultMoment(command?.sentAt) },
      ],
    },
    {
      title: "Spontaneous Write From Status GA",
      items: [
        { label: "Result", value: formatFeedbackCheckResult(statusWrite) },
        {
          label: "Expected",
          value:
            statusWrite?.expectedPayloadLabel ||
            expectedPayloadLabel ||
            stringifyResultDetailValue(expectedPayload),
        },
        { label: "Received At", value: formatResultMoment(statusWrite?.at) },
        { label: "Event", value: statusWrite?.event || "n/a" },
      ],
    },
    {
      title: "Active Read Request To Status GA",
      items: [
        { label: "Result", value: formatFeedbackCheckResult(resolvedResponse) },
        {
          label: "Expected",
          value:
            resolvedResponse?.expectedPayloadLabel ||
            expectedPayloadLabel ||
            stringifyResultDetailValue(expectedPayload),
        },
        {
          label: "Received At",
          value: formatResultMoment(resolvedResponse?.at),
        },
        { label: "Event", value: resolvedResponse?.event || "n/a" },
      ],
    },
  ];
}

function testResultEntries(report) {
  if (!report || typeof report !== "object") return [];
  if (Array.isArray(report.steps) && report.steps.length) {
    return report.steps.map((step) => {
      const details =
        step.kind === "wait"
          ? [
              { label: "Wait", value: `${Number(step.delayMs || 0)} ms` },
              {
                label: "Reason",
                value: step.reason || "Pause before next action",
              },
            ]
          : [];
      return {
        id: String(step.id || `${report.id}-step`),
        title: step.title || step.id || "Step",
        status: step.status || "pass",
        message: step.message || step.description || "",
        details,
        detailGroups:
          step.kind === "wait"
            ? []
            : buildFeedbackResultGroups({
                command: step.command,
                statusWrite: step.statusWrite,
                statusResponse: step.statusResponse,
                statusRead: step.statusRead,
                expectedPayloadLabel: step.expectedPayloadLabel,
                expectedPayload: step.expectedPayload,
              }),
      };
    });
  }
  if (Array.isArray(report.checks) && report.checks.length) {
    return report.checks.map((check) => ({
      id: String(check.id || `${report.id}-check`),
      title: check.title || check.id || "Check",
      status: check.status || "pass",
      message: check.message || "",
      details: [
        {
          label: "Metrics",
          value: stringifyResultDetailValue(check.metrics || {}),
        },
        {
          label: "Sample",
          value: stringifyResultDetailValue(check.sample || []),
        },
      ],
    }));
  }
  if (String(report.mode || "") === "active_test") {
    return [
      {
        id: String(report.id || "active-test"),
        title: report.name || "Actuator Test",
        status: report.overallStatus || "pass",
        message:
          report.overallStatus === "pass"
            ? "Both feedback checks passed."
            : report.overallStatus === "warn"
              ? "One feedback check passed and one failed."
              : "Both feedback checks failed.",
        details: [],
        detailGroups: buildFeedbackResultGroups({
          command: report.command,
          statusWrite: report.statusWrite,
          statusResponse: report.statusResponse,
          statusRead: report.statusRead,
          expectedPayloadLabel:
            report.statusResponse?.expectedPayloadLabel ||
            report.statusWrite?.expectedPayloadLabel ||
            report.statusRead?.expectedPayloadLabel,
          expectedPayload: report.statusRead?.expectedPayload,
        }),
      },
    ];
  }
  return [];
}

function testResultSuggestions(report) {
  return Array.isArray(report && report.suggestions) ? report.suggestions : [];
}

function testResultSourceRef(report) {
  const source =
    report && report.source && typeof report.source === "object"
      ? report.source
      : {};
  const mode = String(report && report.mode ? report.mode : "")
    .trim()
    .toLowerCase();
  const areaId = String(source.areaId || report?.area?.id || "").trim();
  if (mode === "ai_test_plan") {
    return {
      type: "ai_test_plan",
      planId: String(
        source.planId || String(report.id || "").split(":")[0] || "",
      ).trim(),
      areaId,
    };
  }
  if (mode === "read_only") {
    return {
      type: "profile",
      profileId: String(source.profileId || report?.profile?.id || "").trim(),
      areaId,
    };
  }
  if (mode === "active_test") {
    return {
      type: "actuator_test",
      presetId: String(
        source.presetId || String(report.id || "").split(":")[0] || "",
      ).trim(),
      areaId,
    };
  }
  return {
    type: "",
    areaId,
  };
}

function canOpenSourceTest(report) {
  const source = testResultSourceRef(report);
  if (
    source.areaId &&
    suggestedAreas.value.find((area) => area.id === source.areaId)
  )
    return true;
  if (
    source.type === "ai_test_plan" &&
    source.planId &&
    testPlans.value.find((plan) => plan.id === source.planId)
  )
    return true;
  return source.type === "profile" || source.type === "actuator_test";
}

async function exportSelectedTestResultPdf() {
  const report = selectedTestResult.value;
  if (!report || typeof report !== "object") {
    setStatus("No test result selected to export");
    return;
  }
  try {
    const { jsPDF } = await import("jspdf");
    const doc = new jsPDF({
      orientation: "portrait",
      unit: "pt",
      format: "a4",
    });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const marginLeft = 42;
    const marginRight = 42;
    const marginTop = 44;
    const marginBottom = 42;
    const contentWidth = pageWidth - marginLeft - marginRight;
    let y = marginTop;

    const ensureSpace = (needed = 14) => {
      if (y + needed <= pageHeight - marginBottom) return;
      doc.addPage();
      y = marginTop;
    };

    const writeWrapped = (
      text,
      {
        size = 11,
        bold = false,
        indent = 0,
        color = [35, 41, 52],
        lineHeight = 14,
        gapAfter = 0,
      } = {},
    ) => {
      const value = String(text || "").trim();
      if (!value) return;
      doc.setFont("helvetica", bold ? "bold" : "normal");
      doc.setFontSize(size);
      doc.setTextColor(color[0], color[1], color[2]);
      const lines = doc.splitTextToSize(
        value,
        Math.max(80, contentWidth - indent),
      );
      for (const line of lines) {
        ensureSpace(lineHeight);
        doc.text(String(line), marginLeft + indent, y);
        y += lineHeight;
      }
      if (gapAfter > 0) y += gapAfter;
    };

    const writeSeparator = () => {
      ensureSpace(12);
      doc.setDrawColor(210, 214, 222);
      doc.line(marginLeft, y, pageWidth - marginRight, y);
      y += 12;
    };

    const reportName = testResultDisplayName(report);
    const exportedAt =
      formatDateTime(new Date().toISOString()) || new Date().toISOString();
    const generatedAt =
      formatDateTime(report.generatedAt || "") ||
      String(report.generatedAt || "n/a");
    const areaText = testResultAreaText(report) || "n/a";
    const modeLabel = testResultModeLabel(report);
    const overallStatus = String(report.overallStatus || "n/a");
    const metricCards = testResultMetricCards(report);
    const entries = testResultEntries(report);
    const suggestions = testResultSuggestions(report);

    writeWrapped("Cerebrum Test Result", {
      size: 17,
      bold: true,
      color: [20, 28, 39],
      lineHeight: 20,
    });
    writeWrapped(reportName, {
      size: 14,
      bold: true,
      color: [20, 28, 39],
      lineHeight: 17,
      gapAfter: 4,
    });
    writeWrapped(`Exported: ${exportedAt}`, { size: 10, color: [88, 96, 113] });
    writeWrapped(`Generated: ${generatedAt}`, {
      size: 10,
      color: [88, 96, 113],
    });
    writeWrapped(`Mode: ${modeLabel}`, { size: 10, color: [88, 96, 113] });
    writeWrapped(`Status: ${overallStatus}`, {
      size: 10,
      color: [88, 96, 113],
    });
    writeWrapped(`Area: ${areaText}`, { size: 10, color: [88, 96, 113] });
    writeWrapped(`Report ID: ${String(report.id || "n/a")}`, {
      size: 10,
      color: [88, 96, 113],
      gapAfter: 2,
    });
    writeSeparator();

    if (metricCards.length) {
      writeWrapped("Metrics", {
        size: 12,
        bold: true,
        color: [20, 28, 39],
        gapAfter: 2,
      });
      metricCards.forEach((metric) => {
        writeWrapped(
          `${metric.label}: ${stringifyResultDetailValue(metric.value)}`,
          { size: 10, color: [35, 41, 52] },
        );
      });
      y += 4;
      writeSeparator();
    }

    writeWrapped(`Checks (${entries.length})`, {
      size: 12,
      bold: true,
      color: [20, 28, 39],
      gapAfter: 2,
    });
    if (!entries.length) {
      writeWrapped("No detailed entries stored for this report yet.", {
        size: 10,
        color: [88, 96, 113],
      });
    } else {
      entries.forEach((entry, index) => {
        writeWrapped(
          `${index + 1}. ${entry.title || "Check"} [${String(entry.status || "n/a").toUpperCase()}]`,
          { size: 11, bold: true, color: [31, 41, 55] },
        );
        writeWrapped(entry.message || "No additional details available.", {
          size: 10,
          color: [70, 78, 94],
        });
        if (Array.isArray(entry.detailGroups) && entry.detailGroups.length) {
          entry.detailGroups.forEach((group) => {
            writeWrapped(group.title || "Details", {
              size: 10,
              bold: true,
              indent: 12,
              color: [35, 41, 52],
            });
            const items = Array.isArray(group.items) ? group.items : [];
            items.forEach((detail) => {
              writeWrapped(
                `${detail.label}: ${stringifyResultDetailValue(detail.value)}`,
                { size: 10, indent: 24, color: [70, 78, 94] },
              );
            });
          });
        } else {
          const details = Array.isArray(entry.details) ? entry.details : [];
          details.forEach((detail) => {
            writeWrapped(
              `${detail.label}: ${stringifyResultDetailValue(detail.value)}`,
              { size: 10, indent: 12, color: [70, 78, 94] },
            );
          });
        }
        y += 2;
      });
    }

    if (suggestions.length) {
      y += 4;
      writeSeparator();
      writeWrapped("Suggestions", {
        size: 12,
        bold: true,
        color: [20, 28, 39],
        gapAfter: 2,
      });
      suggestions.forEach((suggestion, index) => {
        writeWrapped(`${index + 1}. ${String(suggestion || "")}`, {
          size: 10,
          color: [35, 41, 52],
        });
      });
    }

    const reportDate = new Date(report.generatedAt || Date.now());
    const timestamp = Number.isFinite(reportDate.getTime())
      ? reportDate.toISOString().replace(/[:.]/g, "-")
      : String(Date.now());
    const fileName = `cerebrum-test-result-${sanitizeFileName(reportName, "report")}-${timestamp}.pdf`;
    doc.save(fileName);
    setStatus(`PDF exported (${fileName})`);
  } catch (error) {
    state.lastError =
      error && error.message ? error.message : "Failed to export PDF";
    setStatus(state.lastError);
  }
}

function buildClientStepFailureResult(
  step,
  error,
  at = new Date().toISOString(),
) {
  const isWait = step && step.kind === "wait";
  return {
    id: step && step.id ? step.id : `step-${Date.now()}`,
    title: step && step.title ? step.title : "Test Step",
    description: step && step.description ? step.description : "",
    reason: step && step.reason ? step.reason : "",
    kind: step && step.kind ? step.kind : "write_and_verify",
    status: "warn",
    command: isWait
      ? null
      : {
          ga: step && step.commandGA ? step.commandGA : "",
          dpt: step && step.commandDPT ? step.commandDPT : "",
          payload: step ? step.commandPayload : undefined,
          sentAt: at,
        },
    statusWrite: null,
    statusResponse: null,
    statusRead: null,
    expectedPayload: isWait
      ? undefined
      : step
        ? step.expectedPayload
        : undefined,
    delayMs: Number(step && step.delayMs ? step.delayMs : 0),
    statusWriteTimeoutMs: isWait
      ? 0
      : Number(
          step && step.statusWriteTimeoutMs ? step.statusWriteTimeoutMs : 0,
        ),
    statusResponseTimeoutMs: isWait
      ? 0
      : Number(
          step && step.statusResponseTimeoutMs
            ? step.statusResponseTimeoutMs
            : 0,
        ),
    message: error && error.message ? error.message : "Failed to run step",
  };
}

async function playStepAudioFromBlob(blob) {
  stopActiveStepAudio();
  return await new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(blob);
    const audio = new Audio(objectUrl);
    activeStepAudio = audio;
    const cleanup = () => {
      if (activeStepAudio === audio) activeStepAudio = null;
      audio.onended = null;
      audio.onerror = null;
      URL.revokeObjectURL(objectUrl);
    };
    audio.onended = () => {
      cleanup();
      resolve();
    };
    audio.onerror = () => {
      cleanup();
      reject(new Error("Audio playback failed"));
    };
    const playPromise = audio.play();
    if (playPromise && typeof playPromise.then === "function") {
      playPromise.catch((error) => {
        cleanup();
        reject(error instanceof Error ? error : new Error(String(error)));
      });
    }
  });
}

function currentDraftStepById(stepId, fallbackStep = null) {
  const targetId = String(stepId || "").trim();
  if (
    !targetId ||
    !state.testPlanDraft ||
    !Array.isArray(state.testPlanDraft.steps)
  )
    return fallbackStep;
  return (
    state.testPlanDraft.steps.find(
      (step) => String(step && step.id ? step.id : "") === targetId,
    ) || fallbackStep
  );
}

function detectSpeechLanguage(title, description = "") {
  const text = `${String(title || "")} ${String(description || "")}`
    .trim()
    .toLowerCase();
  const paddedText = ` ${text} `;
  if (!text) {
    const browserLanguage = String(
      (navigator.language || "it").split("-")[0] || "it",
    )
      .trim()
      .toLowerCase();
    return browserLanguage || "it";
  }

  const hasAny = (tokens) => tokens.some((token) => paddedText.includes(token));
  const weightedMatches = [
    {
      voice: "it",
      score: [
        hasAny([
          " accendi ",
          " spegni ",
          " stato ",
          " verifica ",
          " coerente ",
          " leggi ",
          " apri ",
          " chiudi ",
          " attiva ",
          " controlla ",
          " area ",
          " luce ",
          " luci ",
          " tapparella ",
          " tapparelle ",
          " clima ",
        ])
          ? 3
          : 0,
        /[àèéìíîòóù]/.test(text) ? 2 : 0,
      ].reduce((sum, value) => sum + value, 0),
    },
    {
      voice: "en",
      score: [
        hasAny([
          " turn on ",
          " turn off ",
          " verify ",
          " feedback ",
          " status ",
          " check ",
          " read ",
          " open ",
          " close ",
          " command ",
          " area ",
          " light ",
          " lights ",
        ])
          ? 3
          : 0,
      ].reduce((sum, value) => sum + value, 0),
    },
    {
      voice: "fr",
      score: [
        hasAny([
          " allume ",
          " éteins ",
          " etat ",
          " état ",
          " vérifier ",
          " ouvre ",
          " ferme ",
          " lumière ",
          " lumières ",
          " zone ",
        ])
          ? 3
          : 0,
        /[àâçéèêëîïôûùüÿœ]/.test(text) ? 2 : 0,
      ].reduce((sum, value) => sum + value, 0),
    },
    {
      voice: "de",
      score: [
        hasAny([
          " einschalten ",
          " ausschalten ",
          " status ",
          " prüfen ",
          " öffne ",
          " schließe ",
          " licht ",
          " bereich ",
        ])
          ? 3
          : 0,
        /[äöüß]/.test(text) ? 2 : 0,
      ].reduce((sum, value) => sum + value, 0),
    },
    {
      voice: "es",
      score: [
        hasAny([
          " enciende ",
          " apaga ",
          " estado ",
          " verifica ",
          " abre ",
          " cierra ",
          " luz ",
          " luces ",
          " zona ",
        ])
          ? 3
          : 0,
        /[áéíóúñü]/.test(text) ? 2 : 0,
      ].reduce((sum, value) => sum + value, 0),
    },
    {
      voice: "pt",
      score: [
        hasAny([
          " liga ",
          " desliga ",
          " estado ",
          " verificar ",
          " abre ",
          " fecha ",
          " luz ",
          " luzes ",
          " área ",
        ])
          ? 3
          : 0,
        /[ãõâêôçáéíóú]/.test(text) ? 2 : 0,
      ].reduce((sum, value) => sum + value, 0),
    },
  ];

  weightedMatches.sort((a, b) => b.score - a.score);
  if (weightedMatches[0] && weightedMatches[0].score > 0)
    return weightedMatches[0].voice;
  const browserLanguage = String(
    (navigator.language || "it").split("-")[0] || "it",
  )
    .trim()
    .toLowerCase();
  return browserLanguage || "it";
}

function speechSpecFromStep(stepInput = {}, stepNumber = null) {
  const liveStep = currentDraftStepById(
    stepInput && stepInput.id ? stepInput.id : "",
    stepInput,
  );
  const title = String(liveStep && liveStep.title ? liveStep.title : "").trim();
  const description = String(
    liveStep && liveStep.description ? liveStep.description : "",
  ).trim();
  const numericPrefix =
    Number.isInteger(stepNumber) && stepNumber > 0 ? `${stepNumber}. ` : "";
  return {
    text: `${numericPrefix}${title}`.trim(),
    voice: detectSpeechLanguage(title, description),
  };
}

async function speakTestStepTitle(stepInput = {}, stepNumber = null) {
  if (state.voiceEnabled !== true) return;
  const speech = speechSpecFromStep(stepInput, stepNumber);
  const text = String(speech.text || "").trim();
  if (!text || !state.selectedNodeId) return;
  const blob = await requestAudioBlob(
    `${apiUrl("tts/googletranslate")}?ts=${Date.now()}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        nodeId: state.selectedNodeId,
        text,
        voice: speech.voice,
        slow: false,
      }),
    },
  );
  await playStepAudioFromBlob(blob);
}

async function speakText(text, description = "") {
  if (state.voiceEnabled !== true || !state.selectedNodeId) return;
  const spokenText = String(text || "").trim();
  if (!spokenText) return;
  const voice = detectSpeechLanguage(spokenText, description);
  const blob = await requestAudioBlob(
    `${apiUrl("tts/googletranslate")}?ts=${Date.now()}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        nodeId: state.selectedNodeId,
        text: spokenText,
        voice,
        slow: false,
      }),
    },
  );
  await playStepAudioFromBlob(blob);
}

async function fetchNodes() {
  state.loadingNodes = true;
  setStatus("Loading nodes...");
  try {
    const data = await requestJson(apiUrl("nodes"));
    const nodes = Array.isArray(data && data.nodes) ? data.nodes : [];
    state.nodes = nodes;
    if (!nodes.length) {
      state.selectedNodeId = "";
      state.stateData = null;
      state.lastError = "No Cerebrum nodes found.";
      setStatus(state.lastError);
      return;
    }
    if (!queryNodeId) {
      state.selectedNodeId = "";
      state.stateData = null;
      state.lastError = "Open Cerebrum from a deployed Cerebrum node.";
      setStatus(state.lastError);
      return;
    }
    if (!nodes.find((node) => node.id === queryNodeId)) {
      state.selectedNodeId = "";
      state.stateData = null;
      state.lastError =
        "The Cerebrum node that opened this page is not deployed.";
      setStatus(state.lastError);
      return;
    }
    state.selectedNodeId = queryNodeId;
    state.lastError = "";
    setStatus("Ready");
    if (
      state.activeTab === "cerebrum" &&
      state.cerebrumTab === "operations" &&
      Date.now() - Number(state.cerebrumOperationsLoadedAt || 0) >= 10000
    )
      loadCerebrumOperations();
  } catch (error) {
    state.lastError = error.message || "Failed to load nodes";
    setStatus(state.lastError);
  } finally {
    state.loadingNodes = false;
  }
}

let etsAccessLoadGeneration = 0;

async function loadEtsAccessConfiguration({ force = false } = {}) {
  if (!state.selectedNodeId || state.etsAccessLoading) return;
  if (
    !force &&
    state.etsAccessLoadedNodeId === state.selectedNodeId &&
    state.etsAccessData &&
    state.etsAccessData.catalogIncluded === true
  )
    return;
  state.etsAccessLoading = true;
  state.etsAccessError = "";
  const nodeId = state.selectedNodeId;
  const generation = ++etsAccessLoadGeneration;
  try {
    const data = await requestJson(
      apiUrl(`ets-access?nodeId=${encodeURIComponent(nodeId)}`),
    );
    if (generation !== etsAccessLoadGeneration || state.selectedNodeId !== nodeId) return;
    state.etsAccessData = data && data.etsAccess ? data.etsAccess : null;
    hydrateEtsAccessDraft(state.etsAccessData, { force: true });
  } catch (error) {
    if (generation !== etsAccessLoadGeneration || state.selectedNodeId !== nodeId) return;
    state.etsAccessError = error.message || "Failed to load ETS access";
    setStatus(state.etsAccessError);
  } finally {
    if (generation === etsAccessLoadGeneration) state.etsAccessLoading = false;
  }
}

function hydrateEtsAccessDraft(snapshot, { force = false } = {}) {
  const source =
    snapshot && typeof snapshot === "object" ? snapshot : { items: [] };
  if (source.catalogIncluded !== true) return;
  const selected = Array.isArray(source.exposedGAs) ? source.exposedGAs : (Array.isArray(source.items) ? source.items : [])
    .filter((item) => item && item.selected === true)
    .map((item) => item.ga);
  const readOnly = Array.isArray(source.readOnlyGAs) ? source.readOnlyGAs : (Array.isArray(source.items) ? source.items : [])
    .filter((item) => item && item.selected === true && item.readOnly === true)
    .map((item) => item.ga);
  const sameNode = state.etsAccessLoadedNodeId === state.selectedNodeId;
  if (!force && sameNode && etsAccessDirty.value) return;
  state.etsAccessSelected = normalizeEtsAccessDraftList(selected);
  state.etsAccessReadOnly = normalizeEtsAccessDraftList(readOnly);
  state.etsAccessBaseline = buildEtsAccessDraftFingerprint(selected, readOnly);
  state.etsAccessLoadedNodeId = state.selectedNodeId;
  state.etsAccessError = "";
}

function toggleEtsAccessSelection(ga, selected) {
  const target = String(ga || "").trim();
  if (!target) return;
  const selectedSet = new Set(state.etsAccessSelected);
  const readOnlySet = new Set(state.etsAccessReadOnly);
  if (selected === true) selectedSet.add(target);
  else {
    selectedSet.delete(target);
    readOnlySet.delete(target);
  }
  state.etsAccessSelected = normalizeEtsAccessDraftList(
    Array.from(selectedSet),
  );
  state.etsAccessReadOnly = normalizeEtsAccessDraftList(
    Array.from(readOnlySet),
  );
}

function toggleEtsAccessReadOnly(ga, readOnly) {
  const target = String(ga || "").trim();
  if (!target || !etsAccessSelectedSet.value.has(target)) return;
  const readOnlySet = new Set(state.etsAccessReadOnly);
  if (readOnly === true) readOnlySet.add(target);
  else readOnlySet.delete(target);
  state.etsAccessReadOnly = normalizeEtsAccessDraftList(
    Array.from(readOnlySet),
  );
}

function setMatchingEtsAccessSelection(selected) {
  const selectedSet = new Set(state.etsAccessSelected);
  const readOnlySet = new Set(state.etsAccessReadOnly);
  etsAccessMatchingItems.value.forEach((item) => {
    if (!item || !item.ga) return;
    if (selected === true) selectedSet.add(item.ga);
    else {
      selectedSet.delete(item.ga);
      readOnlySet.delete(item.ga);
    }
  });
  state.etsAccessSelected = normalizeEtsAccessDraftList(
    Array.from(selectedSet),
  );
  state.etsAccessReadOnly = normalizeEtsAccessDraftList(
    Array.from(readOnlySet),
  );
}

function setMatchingEtsAccessReadOnly(readOnly) {
  const readOnlySet = new Set(state.etsAccessReadOnly);
  etsAccessMatchingItems.value.forEach((item) => {
    if (!item || !item.ga || !etsAccessSelectedSet.value.has(item.ga)) return;
    if (readOnly === true) readOnlySet.add(item.ga);
    else readOnlySet.delete(item.ga);
  });
  state.etsAccessReadOnly = normalizeEtsAccessDraftList(
    Array.from(readOnlySet),
  );
}

function discardEtsAccessChanges() {
  hydrateEtsAccessDraft(etsAccessState.value, { force: true });
}

async function saveEtsAccessConfiguration() {
  if (!state.selectedNodeId || state.etsAccessSaving || backupBusy.value) return;
  state.etsAccessSaving = true;
  state.etsAccessError = "";
  setStatus("Saving ETS access...");
  try {
    const data = await requestJson(apiUrl("ets-access/save"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        nodeId: state.selectedNodeId,
        configured: true,
        exposedGAs: normalizeEtsAccessDraftList(state.etsAccessSelected),
        readOnlyGAs: normalizeEtsAccessDraftList(state.etsAccessReadOnly),
      }),
    });
    if (data && data.etsAccess) {
      state.etsAccessData = data.etsAccess;
      state.stateData = Object.assign({}, state.stateData || {}, {
        etsAccess: data.etsAccess,
      });
      hydrateEtsAccessDraft(data.etsAccess, { force: true });
    }
    await fetchGaCatalog();
    setStatus("ETS access saved");
  } catch (error) {
    state.etsAccessError = error.message || "Failed to save ETS access";
    setStatus(state.etsAccessError);
  } finally {
    state.etsAccessSaving = false;
  }
}

async function fetchState({ fresh = false } = {}) {
  if (!state.selectedNodeId || state.loadingState) return;
  state.loadingState = true;
  if (fresh) setStatus("Loading...");
  try {
    const localLiveReport =
      state.testPlanRunning === true && state.liveTestResultId
        ? cloneJson(
            state.stateData && state.stateData.testPlanReport
              ? state.stateData.testPlanReport
              : null,
            null,
          )
        : null;
    const data = await requestJson(
      apiUrl(
        `state?nodeId=${encodeURIComponent(state.selectedNodeId)}&fresh=${fresh ? 1 : 0}&language=${encodeURIComponent(uiLanguage.value)}`,
      ),
    );
    if (localLiveReport && localLiveReport.id === state.liveTestResultId) {
      data.testPlanReport = localLiveReport;
    }
    (Array.isArray(data && data.assistant) ? data.assistant : [])
      .filter(
        (entry) =>
          entry &&
          entry.scheduledTaskRun === true &&
          String(entry.sessionId || "") === "sidebar" &&
          String(entry.content || "").trim(),
      )
      .forEach((entry) => {
        const key = `${state.selectedNodeId}|${String(entry.at || "")}|${String(entry.scheduledTaskId || "")}|${String(entry.content || "")}`;
        if (seenScheduledChatEntries.has(key)) return;
        seenScheduledChatEntries.add(key);
        while (seenScheduledChatEntries.size > 200) {
          seenScheduledChatEntries.delete(
            seenScheduledChatEntries.values().next().value,
          );
        }
        appendChat("assistant", entry.content);
      });
    state.stateData = data;
    hydrateEtsAccessDraft(data && data.etsAccess);
    nextTick(() => {
      if (
        state.areaDraftIsNew !== true &&
        state.areaSelectedId &&
        !suggestedAreas.value.find((area) => area.id === state.areaSelectedId)
      ) {
        state.areaSelectedId = "";
      }
      if (
        !restoreSelectedTestAreaForCurrentNode() &&
        !state.testAreaSelectedId &&
        suggestedAreas.value[0]
      ) {
        state.testAreaSelectedId = suggestedAreas.value[0].id;
      }
    });
    state.lastError = "";
    setStatus("Ready");
  } catch (error) {
    state.lastError = error.message || "Failed to load state";
    setStatus(state.lastError);
  } finally {
    state.loadingState = false;
  }
}

async function onRefresh() {
  await fetchNodes();
  await fetchState({ fresh: true });
  if (state.activeTab === "etsAccess") await loadEtsAccessConfiguration();
  if (state.activeTab === "cerebrum" && state.cerebrumTab === "operations")
    await loadCerebrumOperations({ force: true });
  await fetchGaCatalog();
}

function resetTestsWorkspaceView() {
  state.selectedTestResultId = "";
  state.testResultFocusMode = false;
  state.testPlanSelectedId = "";
  state.testPlanDraft = null;
  state.testPlanPrompt = "";
  state.testPlanGeneration = null;
  state.testPlanRunConfirmOpen = false;
  state.testPlanUnsavedConfirmOpen = false;
  state.showAiPlanner = true;
  state.testTemplateBuilderFocus = false;
  if (
    !restoreSelectedTestAreaForCurrentNode() &&
    !state.testAreaSelectedId &&
    suggestedAreas.value[0]
  ) {
    state.testAreaSelectedId = suggestedAreas.value[0].id;
  }
  resetPendingTestPlanAction();
  clearDraggedPlanStepState();
}

function openTemplateBuilderFocus() {
  state.showAiPlanner = true;
  state.testTemplateBuilderFocus = true;
}

function closeTemplateBuilderFocus() {
  state.testTemplateBuilderFocus = false;
  state.showAiPlanner = false;
}

function openAiAreaBuilderFocus() {
  state.showAiAreaBuilder = true;
  state.areaBuilderFocus = true;
}

function closeAiAreaBuilderFocus() {
  state.areaBuilderFocus = false;
  state.showAiAreaBuilder = false;
}

function resetAreasWorkspaceView() {
  state.areaSelectedId = "";
  state.areaDraftIsNew = false;
  state.areaDraftId = "";
  state.areaDraftName = "";
  state.areaDraftDescription = "";
  state.areaDraftTags = "";
  state.areaDraftGaList = [];
  state.areaLlmPrompt = "";
  state.areaLlmError = "";
  state.areaSearch = "";
  state.areaSearchOpen = false;
  state.showAiAreaBuilder = false;
  state.areaBuilderFocus = false;
  state.areaUnsavedConfirmOpen = false;
}

function closeAreaEditor() {
  if (hasUnsavedAreaChanges.value) {
    state.areaUnsavedConfirmOpen = true;
    return;
  }
  resetAreasWorkspaceView();
  setStatus("Area editor closed");
}

function closeAreaUnsavedConfirm() {
  state.areaUnsavedConfirmOpen = false;
}

function discardAreaChangesAndCloseEditor() {
  state.areaUnsavedConfirmOpen = false;
  resetAreasWorkspaceView();
  setStatus("Area editor closed");
}

function closeTestPlanEditor() {
  if (state.testPlanRunning) return;
  requestTestPlanChange(() => {
    resetTestsWorkspaceView();
    state.testPlanSearchOpen = false;
    setStatus("Test editor closed");
  }, "close the current test editor");
}

function navigateToCerebrum(tabId) {
  if (!CEREBRUM_TAB_IDS.has(tabId)) return;
  state.activeTab = "cerebrum";
  activateCerebrumTab(tabId);
  closeSidebarOnMobile();
}

function activateCerebrumTab(tabId) {
  const target = String(tabId || "").trim();
  if (!CEREBRUM_TAB_IDS.has(target)) return;
  state.cerebrumTab = target;
  if (target === "learning") loadChatLearningFile();
  if (target === "memory") loadCerebrumMemoryFile();
  if (target === "operations") loadCerebrumOperations();
  nextTick(() => {
    if (state.activeTab === "cerebrum" && state.cerebrumTab === target)
      window.scrollTo(0, 0);
  });
}

function activateSidebarTab(tabId) {
  const target = String(tabId || "").trim();
  if (!target) return;
  if (target === "areas") {
    const hasSelectedArea = !!String(state.areaSelectedId || "").trim();
    const hasAreaDraft = state.areaDraftIsNew === true;
    if (!hasSelectedArea && !hasAreaDraft) resetAreasWorkspaceView();
  }
  if (target === "tests") {
    const hasSelectedPlan = !!String(state.testPlanSelectedId || "").trim();
    const hasSelectedResult = !!String(state.selectedTestResultId || "").trim();
    const hasDraft = !!state.testPlanDraft;
    if (!hasSelectedPlan && !hasSelectedResult && !hasDraft)
      resetTestsWorkspaceView();
  }
  if (target === "etsAccess") loadEtsAccessConfiguration();
  if (target === "cerebrum") {
    state.activeTab = target;
    activateCerebrumTab("brain");
    closeSidebarOnMobile();
    return;
  }
  if (state.activeTab !== target) {
    state.activeTab = target;
  } else {
    state.activeTab = "";
    nextTick(() => {
      state.activeTab = target;
    });
  }
  closeSidebarOnMobile();
}

async function deleteTestResult(reportId) {
  const targetId = String(reportId || "").trim();
  if (!targetId || !state.selectedNodeId || state.deletingTestResultId) return;
  state.deletingTestResultId = targetId;
  try {
    const data = await requestJson(apiUrl("test-results/delete"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        nodeId: state.selectedNodeId,
        reportId: targetId,
      }),
    });
    const nextResults = Array.isArray(data && data.testResults)
      ? data.testResults
      : [];
    state.stateData = Object.assign({}, state.stateData || {}, {
      testResults: nextResults,
    });
    if (state.selectedTestResultId === targetId) {
      state.selectedTestResultId =
        nextResults[0] && nextResults[0].id ? String(nextResults[0].id) : "";
      if (!nextResults.length) state.testResultFocusMode = false;
    }
    if (state.liveTestResultId === targetId) state.liveTestResultId = "";
    setStatus("Test result deleted");
  } catch (error) {
    state.lastError = error.message || "Failed to delete test result";
    setStatus(state.lastError);
  } finally {
    state.deletingTestResultId = "";
  }
}

function focusTestResult(
  reportId,
  {
    openMenu = true,
    activateTestsTab = false,
    activateResultsTab = false,
    resultOnly = true,
  } = {},
) {
  const id = String(reportId || "").trim();
  if (!id) return;
  if (openMenu) state.testResultsMenuOpen = true;
  const targetTab = activateResultsTab
    ? "results"
    : activateTestsTab
      ? "tests"
      : "";
  const applyFocus = () => {
    if (targetTab) state.activeTab = targetTab;
    state.selectedTestResultId = id;
    state.testResultFocusMode = resultOnly === true;
    nextTick(() => {
      const activeButton = document.querySelector(
        ".results-page-list .area-list-item.active",
      );
      if (activeButton && typeof activeButton.scrollIntoView === "function") {
        activeButton.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
    });
  };
  if (
    state.selectedTestResultId === id &&
    (!targetTab || state.activeTab === targetTab)
  ) {
    return;
  }
  applyFocus();
}

function leaveTestResultFocusMode() {
  state.testResultFocusMode = false;
}

function openSourceTestFromSelectedResult() {
  const report = selectedTestResult.value;
  if (!report) return;
  if (!suggestedAreas.value.length) {
    setStatus("Define at least one area before using Tests");
    return;
  }
  const source = testResultSourceRef(report);
  state.activeTab = "tests";
  state.testResultFocusMode = false;
  if (source.type === "ai_test_plan" && source.planId) {
    const plan = testPlans.value.find(
      (item) => item && item.id === source.planId,
    );
    if (plan) {
      loadSelectedTestPlanDraft(plan);
      setStatus(`Opened source plan "${plan.name || plan.id}"`);
      return;
    }
  }
  if (source.type === "profile") {
    setStatus("Returned to the Tests page for the source read-only profile.");
    return;
  }
  if (source.type === "actuator_test") {
    setStatus("Returned to the Tests page for the source actuator test.");
    return;
  }
  setStatus("Returned to the Tests page.");
}

async function persistTestResult(report) {
  if (!state.selectedNodeId || !report || typeof report !== "object")
    return null;
  const data = await requestJson(apiUrl("test-results/save"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      nodeId: state.selectedNodeId,
      report,
    }),
  });
  state.stateData = Object.assign({}, state.stateData || {}, {
    testResults: data.testResults || persistedTestResults.value,
    testPlanReport:
      data.report && data.report.mode === "ai_test_plan"
        ? data.report
        : testPlanReport.value,
    actuatorTestReport:
      data.report && data.report.mode === "active_test"
        ? data.report
        : actuatorTestReport.value,
    profileReport:
      data.report && data.report.mode === "read_only"
        ? data.report
        : profileReport.value,
  });
  if (data && data.report && data.report.id) {
    state.liveTestResultId = "";
    focusTestResult(data.report.id, {
      openMenu: true,
      activateResultsTab: true,
      resultOnly: true,
    });
  }
  return data;
}

async function sendAsk(questionOverride = "") {
  const useOverride = String(questionOverride || "").trim();
  const typedQuestion = String(state.chatDraft || "").trim();
  const question = useOverride || typedQuestion;
  if (!question || !state.selectedNodeId) return;
  appendChat("user", question);
  if (!useOverride) state.chatDraft = "";
  state.asking = true;
  setStatus("Asking...");
  try {
    const data = await requestJson(apiUrl("ask"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ nodeId: state.selectedNodeId, question }),
    });
    appendChat(
      "assistant",
      data && data.answer !== undefined ? data.answer : "",
    );
    setStatus("Ready");
  } catch (error) {
    appendChat("error", error.message || "Ask failed");
    setStatus(error.message || "Ask failed");
  } finally {
    state.asking = false;
  }
}

async function generateFlow() {
  const prompt = String(state.flowBuilderPrompt || "").trim();
  if (!prompt || !state.selectedNodeId || state.flowBuilderGenerating) return;
  state.flowBuilderGenerating = true;
  state.flowBuilderError = "";
  state.flowBuilderCopied = false;
  setStatus("Generating flow...");
  try {
    const data = await requestJson(apiUrl("flow/generate"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        nodeId: state.selectedNodeId,
        prompt,
        language: uiLanguage.value,
      }),
    });
    state.flowBuilderResult = data || null;
    setStatus("Ready");
  } catch (error) {
    state.flowBuilderResult = null;
    state.flowBuilderError = error.message || "Flow generation failed";
    setStatus(state.flowBuilderError);
  } finally {
    state.flowBuilderGenerating = false;
  }
}

async function copyTextToClipboard(text) {
  const value = String(text || "");
  if (navigator.clipboard && navigator.clipboard.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const area = document.createElement("textarea");
  area.value = value;
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  document.execCommand("copy");
  document.body.removeChild(area);
}

async function copyFlowJson() {
  const json =
    state.flowBuilderResult && state.flowBuilderResult.flowJson
      ? state.flowBuilderResult.flowJson
      : "";
  if (!json) return;
  try {
    await copyTextToClipboard(json);
    state.flowBuilderCopied = true;
    setStatus("Flow JSON copied to clipboard");
    setTimeout(() => {
      state.flowBuilderCopied = false;
    }, 2500);
  } catch (error) {
    state.flowBuilderError = error.message || "Could not copy to clipboard";
  }
}

async function saveAreaDefinition() {
  const area = selectedArea.value;
  if (!state.selectedNodeId || state.areaSaving) return;
  if (!state.areaDraftIsNew && !area) return;
  const creating = state.areaDraftIsNew === true;
  state.areaSaving = true;
  setStatus(creating ? "Creating area..." : "Saving area...");
  try {
    const endpoint = creating ? "areas/create" : "areas/save";
    const data = await requestJson(apiUrl(endpoint), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        nodeId: state.selectedNodeId,
        areaId: state.areaDraftIsNew ? undefined : area.id,
        name: state.areaDraftName,
        description: state.areaDraftDescription,
        tags: String(state.areaDraftTags || "")
          .split(",")
          .map((item) => String(item || "").trim())
          .filter(Boolean),
        gaList: state.areaDraftGaList || [],
      }),
    });
    if (data && data.areas) {
      state.stateData = Object.assign({}, state.stateData || {}, {
        areas: data.areas,
      });
      if (data.areaId) state.areaSelectedId = data.areaId;
      state.areaLlmPrompt = "";
      state.areaLlmError = "";
      state.areaDraftIsNew = false;
    } else {
      await fetchState({ fresh: true });
    }
    setStatus(creating ? "Area created" : "Area saved");
  } catch (error) {
    state.lastError = error.message || "Failed to save area";
    setStatus(state.lastError);
  } finally {
    state.areaSaving = false;
  }
}

async function resetAreaDefinition() {
  const area = selectedArea.value;
  if (!area || !state.selectedNodeId || state.areaSaving) return;
  state.areaSaving = true;
  setStatus("Resetting area...");
  try {
    const data = await requestJson(apiUrl("areas/reset"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        nodeId: state.selectedNodeId,
        areaId: area.id,
      }),
    });
    if (data && data.areas) {
      state.stateData = Object.assign({}, state.stateData || {}, {
        areas: data.areas,
      });
    } else {
      await fetchState({ fresh: true });
    }
    setStatus("Area reset");
  } catch (error) {
    state.lastError = error.message || "Failed to reset area";
    setStatus(state.lastError);
  } finally {
    state.areaSaving = false;
  }
}

async function deleteAreaDefinition() {
  const area = selectedArea.value;
  if (!area || !state.selectedNodeId || state.areaSaving) return;
  state.areaSaving = true;
  setStatus("Deleting area...");
  try {
    const data = await requestJson(apiUrl("areas/delete"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        nodeId: state.selectedNodeId,
        areaId: area.id,
      }),
    });
    if (data && data.areas) {
      state.stateData = Object.assign({}, state.stateData || {}, {
        areas: data.areas,
      });
      const nextAreas = Array.isArray(data.areas && data.areas.suggested)
        ? data.areas.suggested
        : [];
      state.areaDraftIsNew = false;
      state.areaSelectedId =
        nextAreas[0] && nextAreas[0].id ? nextAreas[0].id : "";
    } else {
      await fetchState({ fresh: true });
    }
    setStatus("Area deleted");
  } catch (error) {
    state.lastError = error.message || "Failed to delete area";
    setStatus(state.lastError);
  } finally {
    state.areaSaving = false;
  }
}

async function fetchAreaSignalCatalog() {
  const area = plannerCatalogArea.value;
  if (!area || !state.selectedNodeId) {
    state.testPlanCatalog = null;
    state.testPlanCatalogError = "";
    return;
  }
  state.testPlanCatalogLoading = true;
  state.testPlanCatalogError = "";
  try {
    const data = await requestJson(apiUrl("test-plans/catalog"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        nodeId: state.selectedNodeId,
        areaId: area.id,
      }),
    });
    state.testPlanCatalog = data && data.catalog ? data.catalog : null;
    if (data && data.testPlans) {
      state.stateData = Object.assign({}, state.stateData || {}, {
        testPlans: data.testPlans,
      });
    }
  } catch (error) {
    state.testPlanCatalog = null;
    state.testPlanCatalogError =
      error.message || "Failed to load area command/status catalog";
  } finally {
    state.testPlanCatalogLoading = false;
  }
}

async function fetchGaCatalog() {
  if (!state.selectedNodeId || state.gaCatalogLoading) return;
  state.gaCatalogLoading = true;
  try {
    const data = await requestJson(apiUrl("areas/catalog"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ nodeId: state.selectedNodeId }),
    });
    state.gaCatalog = Array.isArray(data && data.gaCatalog)
      ? data.gaCatalog
      : [];
  } catch (error) {
    state.lastError = error.message || "Failed to load GA catalog";
    setStatus(state.lastError);
  } finally {
    state.gaCatalogLoading = false;
  }
}

function addGaToAreaDraft(ga) {
  const value = String(ga || "").trim();
  if (!value) return;
  if ((state.areaDraftGaList || []).includes(value)) return;
  state.areaDraftGaList = [...(state.areaDraftGaList || []), value];
}

function formatAreaListOptionLabel(area) {
  const item = area && typeof area === "object" ? area : {};
  const name = String(item.path || item.name || "Area").trim();
  const kind = String(item.kind || "").trim();
  const gaCount = Number(item.gaCount || 0);
  const active = Number(item.activeGaCount || 0);
  const suffix = [kind, `${gaCount} GA`, `active ${active}`]
    .filter(Boolean)
    .join(" | ");
  return suffix ? `${name}   ${suffix}` : name;
}

function selectAreaFromSearch(area) {
  const item = area && typeof area === "object" ? area : null;
  if (!item || !item.id) return;
  state.areaDraftIsNew = false;
  state.showAiAreaBuilder = false;
  state.areaBuilderFocus = false;
  state.areaSelectedId = item.id;
  state.areaSearch = "";
  state.areaSearchOpen = false;
}

function closeAreaSearchSoon() {
  setTimeout(() => {
    state.areaSearchOpen = false;
  }, 150);
}

function formatTestPlanListOptionLabel(plan) {
  const item = plan && typeof plan === "object" ? plan : {};
  const name = String(item.name || "Plan").trim();
  const area = String(item.areaName || item.areaId || "").trim();
  const steps = Number(item.steps && item.steps.length ? item.steps.length : 0);
  const suffix = [area, `${steps} steps`].filter(Boolean).join(" | ");
  return suffix ? `${name}   ${suffix}` : name;
}

function selectSavedPlanFromSearch(plan) {
  const item = plan && typeof plan === "object" ? plan : null;
  if (!item || !item.id) return;
  selectSavedPlan(item);
  state.testPlanSearch = "";
  state.testPlanSearchOpen = false;
}

function closeTestPlanSearchSoon() {
  setTimeout(() => {
    state.testPlanSearchOpen = false;
  }, 150);
}

function getPreferredUiLanguage() {
  return normalizeUiLanguageCode(uiLanguage.value, "en");
}

function removeGaFromAreaDraft(ga) {
  const value = String(ga || "").trim();
  if (!value) return;
  state.areaDraftGaList = (state.areaDraftGaList || []).filter(
    (item) => item !== value,
  );
}

function startNewAreaDraft() {
  state.activeTab = "areas";
  state.areaDraftIsNew = true;
  state.areaSelectedId = "";
  state.areaDraftId = "";
  state.areaDraftName = "";
  state.areaDraftDescription = "";
  state.areaDraftTags = "";
  state.areaDraftGaList = [];
  state.areaLlmPrompt = "";
  state.areaLlmError = "";
  state.showAiAreaBuilder = false;
  state.areaBuilderFocus = false;
}

async function regenerateLlmAreas() {
  const nodeId = String(state.selectedNodeId || "").trim();
  if (state.areaLlmRegenerating || state.areaLlmBulkDeleting) return;
  if (!nodeId) {
    state.areaLlmError = "Select a Cerebrum node first";
    setStatus(state.areaLlmError);
    return;
  }
  state.areaLlmRegenerating = true;
  state.areaLlmError = "";
  setStatus("Regenerating AI areas...");
  try {
    const data = await requestJson(apiUrl("areas/regenerate-llm"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ nodeId }),
    });
    const hasGaCatalog = Array.isArray(data && data.gaCatalog);
    if (hasGaCatalog) state.gaCatalog = data.gaCatalog;

    if (
      data &&
      (data.areas || data.profiles || data.actuatorTests || data.testPlans)
    ) {
      const nextStateData = Object.assign({}, state.stateData || {});
      if (data.areas) nextStateData.areas = data.areas;
      if (data.profiles) nextStateData.profiles = data.profiles;
      if (data.actuatorTests) nextStateData.actuatorTests = data.actuatorTests;
      if (data.testPlans) nextStateData.testPlans = data.testPlans;
      state.stateData = nextStateData;
    } else {
      await fetchState({ fresh: true });
    }

    if (!hasGaCatalog) await fetchGaCatalog();
    setStatus(
      `AI areas regenerated (${Number(data && data.generatedCount ? data.generatedCount : 0)})`,
    );
  } catch (error) {
    state.areaLlmError = error.message || "Failed to regenerate AI areas";
    setStatus(state.areaLlmError);
  } finally {
    state.areaLlmRegenerating = false;
  }
}

async function deleteAllLlmAreas() {
  const nodeId = String(state.selectedNodeId || "").trim();
  if (state.areaLlmRegenerating || state.areaLlmBulkDeleting) return;
  if (!nodeId) {
    state.areaLlmError = "Select a Cerebrum node first";
    setStatus(state.areaLlmError);
    return;
  }
  const totalAiAreas = Number(aiGeneratedAreaCount.value || 0);
  if (totalAiAreas <= 0) {
    setStatus("No AI areas to delete");
    return;
  }
  const confirmed = window.confirm(
    `Delete all AI-generated areas (${totalAiAreas})?`,
  );
  if (!confirmed) return;

  state.areaLlmBulkDeleting = true;
  state.areaLlmError = "";
  setStatus("Deleting AI areas...");
  try {
    const data = await requestJson(apiUrl("areas/delete-llm"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ nodeId }),
    });
    if (Array.isArray(data && data.gaCatalog)) state.gaCatalog = data.gaCatalog;
    if (
      data &&
      (data.areas || data.profiles || data.actuatorTests || data.testPlans)
    ) {
      const nextStateData = Object.assign({}, state.stateData || {});
      if (data.areas) nextStateData.areas = data.areas;
      if (data.profiles) nextStateData.profiles = data.profiles;
      if (data.actuatorTests) nextStateData.actuatorTests = data.actuatorTests;
      if (data.testPlans) nextStateData.testPlans = data.testPlans;
      state.stateData = nextStateData;
    } else {
      await fetchState({ fresh: true });
    }
    if (!Array.isArray(data && data.gaCatalog)) await fetchGaCatalog();
    setStatus(
      `AI areas deleted (${Number(data && data.deletedCount ? data.deletedCount : totalAiAreas)})`,
    );
  } catch (error) {
    state.areaLlmError = error.message || "Failed to delete AI areas";
    setStatus(state.areaLlmError);
  } finally {
    state.areaLlmBulkDeleting = false;
  }
}

async function suggestAreaDraftWithLlm() {
  if (!state.selectedNodeId || state.areaLlmBusy) return;
  const prompt = String(state.areaLlmPrompt || "").trim();
  if (!prompt) return;
  state.areaLlmBusy = true;
  state.areaLlmError = "";
  setStatus("AI is selecting area GA...");
  try {
    const data = await requestJson(apiUrl("areas/suggest-llm"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        nodeId: state.selectedNodeId,
        prompt,
        name: state.areaDraftName,
        description: state.areaDraftDescription,
        gaList: state.areaDraftGaList || [],
      }),
    });
    const suggestion = data && data.suggestion ? data.suggestion : null;
    if (Array.isArray(data && data.gaCatalog)) state.gaCatalog = data.gaCatalog;
    if (
      !suggestion ||
      !Array.isArray(suggestion.gaList) ||
      !suggestion.gaList.length
    ) {
      throw new Error("The AI did not return any group addresses");
    }
    if (!String(state.areaDraftName || "").trim() && suggestion.name)
      state.areaDraftName = String(suggestion.name);
    if (
      !String(state.areaDraftDescription || "").trim() &&
      suggestion.description
    )
      state.areaDraftDescription = String(suggestion.description);
    if (
      (!state.areaDraftTags || !String(state.areaDraftTags).trim()) &&
      Array.isArray(suggestion.tags) &&
      suggestion.tags.length
    ) {
      state.areaDraftTags = suggestion.tags.join(", ");
    }
    state.areaDraftGaList = Array.from(
      new Set([
        ...(state.areaDraftGaList || []),
        ...suggestion.gaList
          .map((item) => String(item || "").trim())
          .filter(Boolean),
      ]),
    );
    state.showAiAreaBuilder = false;
    state.areaBuilderFocus = false;
    setStatus(
      `AI added ${Number(suggestion.gaList.length || 0)} GA to the draft`,
    );
  } catch (error) {
    state.areaLlmError = error.message || "Failed to suggest area GA";
    setStatus(state.areaLlmError);
  } finally {
    state.areaLlmBusy = false;
  }
}

function applyTestPromptPreset(preset) {
  if (preset && typeof preset === "object") {
    state.testPlanPrompt = String(preset.prompt || "").trim();
    return;
  }
  state.testPlanPrompt = String(preset || "").trim();
}

function pairForCommandGA(ga) {
  const target = String(ga || "").trim();
  if (!target) return null;
  const pairs = Array.isArray(
    state.testPlanCatalog && state.testPlanCatalog.pairs,
  )
    ? state.testPlanCatalog.pairs
    : [];
  return (
    pairs.find((pair) => pair && pair.command && pair.command.ga === target) ||
    null
  );
}

function commandSignalByGA(ga) {
  const target = String(ga || "").trim();
  return (
    plannerCommandOptions.value.find((item) => item && item.ga === target) ||
    null
  );
}

function statusSignalByGA(ga) {
  const target = String(ga || "").trim();
  return (
    plannerStatusOptions.value.find((item) => item && item.ga === target) ||
    null
  );
}

function dptValueOptions(dpt) {
  const key = String(dpt || "").trim();
  if (!key) return [];
  const byId =
    state.testPlanCatalog &&
    state.testPlanCatalog.dptOptionsById &&
    typeof state.testPlanCatalog.dptOptionsById === "object"
      ? state.testPlanCatalog.dptOptionsById
      : {};
  return Array.isArray(byId[key]) ? byId[key] : [];
}

function normalizeComparableText(value) {
  return String(value || "")
    .trim()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

const ACTION_PATTERN_GROUPS = [
  {
    type: "on",
    patterns: [
      /\bturn on\b/g,
      /\bturn(?:\s+\w+){1,4}\s+on\b/g,
      /\bswitch on\b/g,
      /\bswitch(?:\s+\w+){1,4}\s+on\b/g,
      /\bpower on\b/g,
      /\bpower(?:\s+\w+){1,4}\s+on\b/g,
      /\bstart\b/g,
      /\benable\b/g,
      /\bactivate\b/g,
      /\baccendi\b/g,
      /\battiva\b/g,
      /\ballume\b/g,
      /\bactive\b/g,
      /\beinschalten\b/g,
      /\baktivieren\b/g,
      /\benciende\b/g,
      /\bactivar\b/g,
      /\bliga\b/g,
      /\bativa\b/g,
      /\baan\b/g,
      /\binschakelen\b/g,
    ],
  },
  {
    type: "off",
    patterns: [
      /\bturn off\b/g,
      /\bturn(?:\s+\w+){1,4}\s+off\b/g,
      /\bswitch off\b/g,
      /\bswitch(?:\s+\w+){1,4}\s+off\b/g,
      /\bpower off\b/g,
      /\bpower(?:\s+\w+){1,4}\s+off\b/g,
      /\bdisable\b/g,
      /\bdeactivate\b/g,
      /\bshutdown\b/g,
      /\bspegni\b/g,
      /\bdisattiva\b/g,
      /\beteins\b/g,
      /\bdesactive\b/g,
      /\bausschalten\b/g,
      /\bdeaktivieren\b/g,
      /\bapaga\b/g,
      /\bdesactiva\b/g,
      /\bdesliga\b/g,
      /\bdesativa\b/g,
      /\buit\b/g,
      /\buitschakelen\b/g,
    ],
  },
  {
    type: "open",
    patterns: [
      /\bopen\b/g,
      /\braise\b/g,
      /\blift\b/g,
      /\bmove up\b/g,
      /\bapri\b/g,
      /\balza\b/g,
      /\bsolleva\b/g,
      /\bouvre\b/g,
      /\bmonte\b/g,
      /\boffnen\b/g,
      /\bhoch\b/g,
      /\bauf\b/g,
      /\babre\b/g,
      /\bsube\b/g,
      /\babrir\b/g,
      /\bsobe\b/g,
      /\bopenen\b/g,
      /\bomhoog\b/g,
    ],
  },
  {
    type: "close",
    patterns: [
      /\bclose\b/g,
      /\blower\b/g,
      /\bmove down\b/g,
      /\bchiudi\b/g,
      /\babbassa\b/g,
      /\bferme\b/g,
      /\bdescends?\b/g,
      /\bschliessen\b/g,
      /\brunter\b/g,
      /\bzu\b/g,
      /\bcierra\b/g,
      /\bbaja\b/g,
      /\bfechar\b/g,
      /\bdesce\b/g,
      /\bsluiten\b/g,
      /\bomlaag\b/g,
    ],
  },
  {
    type: "stop",
    patterns: [
      /\bstop\b/g,
      /\bhalt\b/g,
      /\bpause\b/g,
      /\bferma\b/g,
      /\barresta\b/g,
      /\barrete\b/g,
      /\bstoppe\b/g,
      /\banhalten\b/g,
      /\bstopp\b/g,
      /\bdeten\b/g,
      /\bparar\b/g,
      /\bpare\b/g,
      /\bstoppen\b/g,
    ],
  },
];

function detectPrimaryActionFromText(value) {
  const text = normalizeComparableText(value);
  if (!text) return "";
  const hits = [];
  ACTION_PATTERN_GROUPS.forEach((group) => {
    group.patterns.forEach((regex) => {
      regex.lastIndex = 0;
      let match;
      while ((match = regex.exec(text)) !== null) {
        hits.push({ type: group.type, index: match.index });
      }
    });
  });
  hits.sort((a, b) => a.index - b.index);
  return hits[0] ? hits[0].type : "";
}

function actionImpliesTruthy(action) {
  return ["on", "open"].includes(
    String(action || "")
      .trim()
      .toLowerCase(),
  );
}

function actionImpliesFalsy(action) {
  return ["off", "close", "stop"].includes(
    String(action || "")
      .trim()
      .toLowerCase(),
  );
}

function normalizePayloadForDptInput(value, dpt, contextText = "") {
  const options = dptValueOptions(dpt);
  if (!options.length) return String(value ?? "");
  const raw = String(value ?? "").trim();

  const normalizedRaw = normalizeComparableText(raw);
  const normalizedContext = normalizeComparableText(contextText);
  const combinedText = `${normalizedRaw} ${normalizedContext}`.trim();
  const action = detectPrimaryActionFromText(contextText || combinedText);

  if (action) {
    if (actionImpliesTruthy(action)) {
      const explicit = options.find((option) =>
        ["true", "1", "100"].includes(String(option.value)),
      );
      if (explicit) return String(explicit.value);
      const labelMatch = options.find((option) =>
        /\b(on|open|up|start|enable|enabled|active|acceso|accesa|aperto|aperta|su|einschalten|allume|enciende|liga|aan)\b/.test(
          normalizeComparableText(option.label),
        ),
      );
      if (labelMatch) return String(labelMatch.value);
    }
    if (actionImpliesFalsy(action)) {
      const explicit = options.find((option) =>
        ["false", "0"].includes(String(option.value)),
      );
      if (explicit) return String(explicit.value);
      const labelMatch = options.find((option) =>
        /\b(off|close|down|stop|disable|disabled|inactive|chiuso|spento|giu|ausschalten|eteins|apaga|desliga|uit)\b/.test(
          normalizeComparableText(option.label),
        ),
      );
      if (labelMatch) return String(labelMatch.value);
    }
  }

  if (options.some((option) => String(option.value) === raw)) return raw;

  const exactLabelMatch = options.find(
    (option) => normalizeComparableText(option.label) === normalizedRaw,
  );
  if (exactLabelMatch) return String(exactLabelMatch.value);

  const containsLabelMatch = options.find((option) => {
    const label = normalizeComparableText(option.label);
    return (
      normalizedRaw &&
      (label.includes(normalizedRaw) || normalizedRaw.includes(label))
    );
  });
  if (containsLabelMatch) return String(containsLabelMatch.value);

  const trueLike =
    /\b(on|open|up|true|1|accendi|attiva|apri|su|acceso|accesa|accesi|accese|aperto|aperta|enabled|enable|start|allume|einschalten|enciende|liga|aan)\b/;
  const falseLike =
    /\b(off|close|down|false|0|spegni|disattiva|chiudi|giu|spento|spenta|spenti|spente|chiuso|chiusa|disabled|disable|stop|ferma|eteins|ausschalten|apaga|desliga|uit)\b/;

  if (trueLike.test(combinedText)) {
    const explicit = options.find((option) =>
      ["true", "1", "100"].includes(String(option.value)),
    );
    if (explicit) return String(explicit.value);
    const labelMatch = options.find((option) =>
      /\b(on|open|up|start|enable|enabled|active|acceso|accesa|aperto|aperta|su)\b/.test(
        normalizeComparableText(option.label),
      ),
    );
    if (labelMatch) return String(labelMatch.value);
  }
  if (falseLike.test(combinedText)) {
    const explicit = options.find((option) =>
      ["false", "0"].includes(String(option.value)),
    );
    if (explicit) return String(explicit.value);
    const labelMatch = options.find((option) =>
      /\b(off|close|down|stop|disable|disabled|inactive|spento|spenta|chiuso|chiusa|giu)\b/.test(
        normalizeComparableText(option.label),
      ),
    );
    if (labelMatch) return String(labelMatch.value);
  }

  return String(options[0].value);
}

function ensureStepPayloadFitsDpt(step) {
  if (!step) return;
  const commandOptions = dptValueOptions(step.commandDPT);
  const expectedOptions = dptValueOptions(step.statusDPT || step.commandDPT);
  const action = String(step.action || "")
    .trim()
    .toLowerCase();
  if (commandOptions.length) {
    step.commandPayload = normalizePayloadForDptInput(
      step.commandPayload,
      step.commandDPT,
      action ||
        `${step.title || ""} ${step.description || ""} ${step.reason || ""}`,
    );
  }
  if (expectedOptions.length) {
    step.expectedPayload = normalizePayloadForDptInput(
      step.expectedPayload,
      step.statusDPT || step.commandDPT,
      action ||
        `${step.title || ""} ${step.description || ""} ${step.reason || ""}`,
    );
  }
}

function buildEditablePlanStep(seed = {}) {
  const isWait =
    String(seed.kind || "")
      .trim()
      .toLowerCase() === "wait";
  if (isWait) {
    return {
      id: String(
        seed.id || `step-${Date.now()}-${Math.round(Math.random() * 1000)}`,
      ),
      kind: "wait",
      action: "",
      collapsed: seed.collapsed !== false,
      title: String(seed.title || "Wait"),
      description: String(seed.description || ""),
      reason: String(seed.reason || ""),
      delayMs: Number(seed.delayMs || seed.readDelayMs || 1200),
      commandGA: "",
      commandDPT: "",
      commandPayload: "",
      statusGA: "",
      statusDPT: "",
      expectedPayload: "",
      statusWriteTimeoutMs: 0,
      statusResponseTimeoutMs: 0,
    };
  }
  const commandGA =
    String(seed.commandGA || "").trim() ||
    String(plannerCommandOptions.value[0]?.ga || "");
  const pair = pairForCommandGA(commandGA);
  const command = commandSignalByGA(commandGA);
  const status = pair && pair.status ? pair.status : null;
  const next = {
    id: String(
      seed.id || `step-${Date.now()}-${Math.round(Math.random() * 1000)}`,
    ),
    kind: String(seed.kind || (status ? "write_and_verify" : "write_only")),
    action: String(seed.action || "")
      .trim()
      .toLowerCase(),
    collapsed: seed.collapsed !== false,
    title: String(
      seed.title || (command ? `Step ${command.label}` : "Manual Step"),
    ),
    description: String(seed.description || ""),
    reason: String(seed.reason || ""),
    commandGA,
    commandDPT: String(seed.commandDPT || command?.dpt || ""),
    commandPayload: String(seed.commandPayload ?? ""),
    statusGA: String(seed.statusGA || status?.ga || ""),
    statusDPT: String(seed.statusDPT || status?.dpt || ""),
    expectedPayload: String(seed.expectedPayload ?? seed.commandPayload ?? ""),
    statusWriteTimeoutMs: Number(
      seed.statusWriteTimeoutMs || seed.timeoutMs || 5000,
    ),
    statusResponseTimeoutMs: Number(
      seed.statusResponseTimeoutMs || seed.timeoutMs || 5000,
    ),
  };
  ensureStepPayloadFitsDpt(next);
  return next;
}

function normalizeDraftPlanForEditing(plan) {
  const source = cloneJson(plan, null);
  if (!source) return null;
  source.steps = (Array.isArray(source.steps) ? source.steps : []).map((step) =>
    buildEditablePlanStep(step),
  );
  return source;
}

function createEmptyAiTestPlanDraft() {
  return normalizeDraftPlanForEditing({
    id: "",
    name: "",
    description: "",
    areaId: selectedTestArea.value
      ? String(selectedTestArea.value.id || "")
      : "",
    areaName: selectedTestArea.value
      ? String(selectedTestArea.value.path || selectedTestArea.value.name || "")
      : "",
    prompt: "",
    source: "manual",
    generatedAt: new Date().toISOString(),
    steps: [],
  });
}

function refreshDraftStepFromCatalog(step) {
  if (!step) return;
  if (step.kind === "wait") return;
  const command = commandSignalByGA(step.commandGA);
  const selectedStatus = statusSignalByGA(step.statusGA);
  const pair = pairForCommandGA(step.commandGA);
  if (command) step.commandDPT = String(command.dpt || "");
  if (selectedStatus) step.statusDPT = String(selectedStatus.dpt || "");
  if (pair && pair.status && (!step.statusGA || step.statusGA === "")) {
    step.statusGA = String(pair.status.ga || "");
    step.statusDPT = String(pair.status.dpt || "");
    step.kind = "write_and_verify";
  }
  if (step.statusGA) {
    step.kind = "write_and_verify";
  }
  if (!step.expectedPayload)
    step.expectedPayload = String(step.commandPayload ?? "");
  if (!step.statusGA) {
    step.statusDPT = "";
    step.kind = "write_only";
  }
  ensureStepPayloadFitsDpt(step);
}

function addManualStepToPlan() {
  if (!state.testPlanDraft) return;
  const next = {
    id: `step-${Date.now()}-${Math.round(Math.random() * 1000)}`,
    kind: "write_only",
    action: "",
    collapsed: true,
    title: "Manual Step",
    description: "",
    reason: "",
    commandGA: "",
    commandDPT: "",
    commandPayload: "",
    statusGA: "",
    statusDPT: "",
    expectedPayload: "",
    statusWriteTimeoutMs: 5000,
    statusResponseTimeoutMs: 5000,
  };
  state.testPlanDraft.steps = [...(state.testPlanDraft.steps || []), next];
}

function addWaitStepToPlan() {
  if (!state.testPlanDraft) return;
  const next = buildEditablePlanStep({
    id: `wait-${(state.testPlanDraft.steps?.length || 0) + 1}`,
    kind: "wait",
    title: "Wait",
    description: "Pause the test before the next action.",
    delayMs: 1200,
  });
  state.testPlanDraft.steps = [...(state.testPlanDraft.steps || []), next];
}

function duplicatePlanStep(index) {
  if (!state.testPlanDraft || !Array.isArray(state.testPlanDraft.steps)) return;
  const source = state.testPlanDraft.steps[index];
  if (!source) return;
  const duplicate = buildEditablePlanStep(
    Object.assign({}, source, {
      id: `${source.id || "step"}-copy`,
    }),
  );
  state.testPlanDraft.steps.splice(index + 1, 0, duplicate);
}

function removePlanStep(index) {
  if (!state.testPlanDraft || !Array.isArray(state.testPlanDraft.steps)) return;
  state.testPlanDraft.steps.splice(index, 1);
}

function togglePlanStepCollapsed(step) {
  if (!step) return;
  step.collapsed = step.collapsed !== true;
}

function clearDraggedPlanStepState() {
  state.draggedTestPlanStepId = "";
  state.dragOverTestPlanStepId = "";
}

function onPlanStepDragStart(stepId, event) {
  const targetId = String(stepId || "").trim();
  if (!targetId) return;
  state.draggedTestPlanStepId = targetId;
  state.dragOverTestPlanStepId = "";
  if (event && event.dataTransfer) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", targetId);
  }
}

function onPlanStepDragEnter(stepId) {
  const targetId = String(stepId || "").trim();
  if (
    !targetId ||
    !state.draggedTestPlanStepId ||
    targetId === state.draggedTestPlanStepId
  )
    return;
  state.dragOverTestPlanStepId = targetId;
}

function movePlanStep(sourceId, targetId) {
  if (!state.testPlanDraft || !Array.isArray(state.testPlanDraft.steps)) return;
  const fromId = String(sourceId || "").trim();
  const toId = String(targetId || "").trim();
  if (!fromId || !toId || fromId === toId) return;
  const steps = state.testPlanDraft.steps.slice();
  const fromIndex = steps.findIndex(
    (step) => String(step && step.id ? step.id : "") === fromId,
  );
  const toIndex = steps.findIndex(
    (step) => String(step && step.id ? step.id : "") === toId,
  );
  if (fromIndex === -1 || toIndex === -1) return;
  const [moved] = steps.splice(fromIndex, 1);
  steps.splice(toIndex, 0, moved);
  state.testPlanDraft.steps = steps;
}

function onPlanStepDrop(targetStepId, event) {
  if (event) event.preventDefault();
  const sourceId = String(state.draggedTestPlanStepId || "").trim();
  const targetId = String(targetStepId || "").trim();
  if (sourceId && targetId && sourceId !== targetId)
    movePlanStep(sourceId, targetId);
  clearDraggedPlanStepState();
}

function openRunTestPlanConfirm() {
  if (!state.testPlanDraft || state.testPlanRunning) return;
  state.testPlanRunMode = "single";
  state.testPlanRepeatStopRequested = false;
  state.testPlanRunConfirmOpen = true;
}

function openRepeatTestPlanConfirm() {
  if (!state.testPlanDraft || state.testPlanRunning) return;
  state.testPlanRunMode = "repeat";
  state.testPlanRepeatStopRequested = false;
  state.testPlanRunConfirmOpen = true;
}

function closeRunTestPlanConfirm() {
  state.testPlanRunConfirmOpen = false;
  state.testPlanRunMode = "single";
}

function stopRepeatingTestPlan() {
  if (state.testPlanRepeatForever !== true) return;
  state.testPlanRepeatStopRequested = true;
  setStatus("Stopping repeat mode after the current cycle...");
}

function loadSelectedTestPlanDraft(plan = null) {
  const source = plan || selectedTestPlan.value;
  if (!source) return;
  state.testResultFocusMode = false;
  state.testPlanSelectedId = String(source.id || "");
  state.testPlanDraft = normalizeDraftPlanForEditing(source);
  state.testPlanPrompt = String(source.prompt || "");
  state.testPlanGeneration = {
    provider: String(source.source || "saved"),
    model: "",
    fallback: false,
    error: "",
  };
  state.testPlanRunConfirmOpen = false;
  state.showAiPlanner = false;
  state.testTemplateBuilderFocus = false;
  setCurrentTestPlanBaseline();
}

function resetPendingTestPlanAction() {
  pendingTestPlanAction = null;
  state.testPlanPendingActionLabel = "";
}

function closeUnsavedTestPlanConfirm() {
  state.testPlanUnsavedConfirmOpen = false;
  resetPendingTestPlanAction();
}

function runPendingTestPlanAction() {
  const action = pendingTestPlanAction;
  state.testPlanUnsavedConfirmOpen = false;
  resetPendingTestPlanAction();
  if (typeof action === "function") action();
}

function requestTestPlanChange(action, label = "another plan") {
  if (!hasUnsavedTestPlanChanges.value) {
    action();
    return;
  }
  pendingTestPlanAction = action;
  state.testPlanPendingActionLabel = String(label || "another plan");
  state.testPlanUnsavedConfirmOpen = true;
}

function selectSavedPlan(plan) {
  if (!plan || !plan.id) return;
  const targetId = String(plan.id);
  if (state.testPlanSelectedId === targetId) return;
  requestTestPlanChange(
    () => loadSelectedTestPlanDraft(plan),
    `plan "${plan.name || targetId}"`,
  );
}

function cancelTestPlanChanges() {
  restoreCurrentTestPlanBaseline();
  setStatus("Plan changes discarded");
}

async function saveCurrentTestPlanAndContinue() {
  const ok = await saveAiTestPlanDefinition();
  if (ok) runPendingTestPlanAction();
}

function startNewAiTestPlan() {
  if (!suggestedAreas.value.length) {
    setStatus("Define at least one area before creating a test plan");
    return;
  }
  requestTestPlanChange(() => {
    state.activeTab = "tests";
    state.testResultFocusMode = false;
    state.testPlanSelectedId = "";
    state.testPlanDraft = createEmptyAiTestPlanDraft();
    state.testPlanGeneration = null;
    state.testPlanRunConfirmOpen = false;
    state.testPlanPrompt = "";
    state.showAiPlanner = true;
    state.testTemplateBuilderFocus = false;
    setCurrentTestPlanBaseline();
  }, "a new plan");
}

function updateDraftTestArea(areaId) {
  const targetId = String(areaId || "").trim();
  if (!targetId) return;
  const area = suggestedAreas.value.find(
    (item) => item && item.id === targetId,
  );
  if (!area) return;
  state.testAreaSelectedId = targetId;
  if (state.testPlanDraft) {
    state.testPlanDraft.areaId = targetId;
    state.testPlanDraft.areaName = String(area.path || area.name || "");
  }
}

function duplicateCurrentAiTestPlan() {
  const source = cloneJson(state.testPlanDraft || selectedTestPlan.value, null);
  if (!source) return;
  state.activeTab = "tests";
  state.testResultFocusMode = false;
  state.testPlanSelectedId = "";
  state.testPlanRunConfirmOpen = false;
  state.testPlanGeneration = {
    provider: "duplicated",
    model: "",
    fallback: false,
    error: "",
  };
  source.id = "";
  source.name = String(source.name || "Plan Draft").trim()
    ? `${String(source.name || "Plan Draft").trim()} Copy`
    : "Plan Copy";
  state.testPlanPrompt = String(source.prompt || state.testPlanPrompt || "");
  state.testPlanDraft = normalizeDraftPlanForEditing(source);
  state.showAiPlanner = true;
  state.testTemplateBuilderFocus = false;
  setCurrentTestPlanBaseline();
  setStatus("Plan duplicated");
}

async function generateAiTestPlan() {
  const area = selectedTestArea.value;
  const prompt = String(state.testPlanPrompt || "").trim();
  const browserLanguage = getPreferredUiLanguage();
  if (!state.selectedNodeId || !area || !prompt || state.testPlanGenerating)
    return;
  state.testPlanGenerating = true;
  state.testTemplateBuilderFocus = false;
  state.showAiPlanner = false;
  state.testResultFocusMode = false;
  state.testPlanGenerationError = "";
  setStatus("Building test plan...");
  try {
    const data = await requestJson(apiUrl("test-plans/generate"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        nodeId: state.selectedNodeId,
        areaId: area.id,
        prompt,
        language: browserLanguage,
      }),
    });
    state.testPlanDraft =
      data && data.plan ? normalizeDraftPlanForEditing(data.plan) : null;
    state.testPlanCatalog =
      data && data.catalog ? data.catalog : state.testPlanCatalog;
    state.testPlanGeneration = data && data.generation ? data.generation : null;
    state.testPlanGenerationError = "";
    state.testPlanSelectedId = "";
    state.testPlanRunConfirmOpen = false;
    state.showAiPlanner = false;
    if (data && data.testPlans) {
      state.stateData = Object.assign({}, state.stateData || {}, {
        testPlans: data.testPlans,
      });
    }
    setCurrentTestPlanBaseline();
    setStatus("Test plan ready");
  } catch (error) {
    const message = error.message || "Failed to build the test plan";
    state.lastError = message;
    state.testPlanGenerationError = message;
    state.testPlanGeneration = {
      provider: "",
      model: "",
      fallback: false,
      error: message,
    };
    setStatus(message);
  } finally {
    state.testPlanGenerating = false;
  }
}

async function saveAiTestPlanDefinition() {
  if (!state.selectedNodeId || !state.testPlanDraft || state.testPlanSaving)
    return false;
  state.testPlanSaving = true;
  setStatus("Saving test plan...");
  try {
    const data = await requestJson(apiUrl("test-plans/save"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        nodeId: state.selectedNodeId,
        plan: Object.assign({}, state.testPlanDraft, {
          prompt: state.testPlanPrompt,
        }),
      }),
    });
    if (data && data.testPlans) {
      state.stateData = Object.assign({}, state.stateData || {}, {
        testPlans: data.testPlans,
      });
    }
    if (data && data.planId) state.testPlanSelectedId = data.planId;
    if (data && data.planId && state.testPlanDraft)
      state.testPlanDraft.id = data.planId;
    state.testPlanRunConfirmOpen = false;
    setCurrentTestPlanBaseline();
    setStatus("Test plan saved");
    return true;
  } catch (error) {
    state.lastError = error.message || "Failed to save test plan";
    setStatus(state.lastError);
    return false;
  } finally {
    state.testPlanSaving = false;
  }
}

async function deleteAiTestPlanDefinition() {
  const plan = selectedTestPlan.value;
  if (!plan || !state.selectedNodeId || state.testPlanDeleting) return;
  state.testPlanDeleting = true;
  setStatus("Deleting test plan...");
  try {
    const data = await requestJson(apiUrl("test-plans/delete"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        nodeId: state.selectedNodeId,
        planId: plan.id,
      }),
    });
    if (data && data.testPlans) {
      state.stateData = Object.assign({}, state.stateData || {}, {
        testPlans: data.testPlans,
      });
    }
    state.testPlanDraft = null;
    state.testPlanGeneration = null;
    state.testPlanRunConfirmOpen = false;
    state.showAiPlanner = true;
    state.testTemplateBuilderFocus = false;
    setCurrentTestPlanBaseline();
    setStatus("Test plan deleted");
  } catch (error) {
    state.lastError = error.message || "Failed to delete test plan";
    setStatus(state.lastError);
  } finally {
    state.testPlanDeleting = false;
  }
}

async function runAiTestPlanDefinition(modeInput = "single") {
  if (!state.selectedNodeId || !state.testPlanDraft || state.testPlanRunning)
    return;
  const runMode = String(modeInput || state.testPlanRunMode || "single")
    .trim()
    .toLowerCase();
  const repeatForever = runMode === "repeat";
  state.testPlanRunning = true;
  state.showAiPlanner = false;
  state.testTemplateBuilderFocus = false;
  state.testPlanRepeatForever = repeatForever;
  state.testPlanRepeatStopRequested = false;
  state.testPlanRunningStepId = "";
  state.testPlanRunConfirmOpen = false;
  state.lastError = "";
  setStatus(
    repeatForever
      ? "Running test plan in repeat mode..."
      : "Running test plan...",
  );
  try {
    const plan = JSON.parse(
      JSON.stringify(
        Object.assign({}, state.testPlanDraft, {
          prompt: state.testPlanPrompt,
        }),
      ),
    );
    const steps = Array.isArray(plan.steps) ? plan.steps : [];
    if (!plan.areaId) throw new Error("Missing areaId in test plan");
    if (!steps.length) throw new Error("The test plan has no executable steps");
    let area = selectedTestArea.value;
    let cycleNumber = 0;
    do {
      cycleNumber += 1;
      const liveReportId = `${plan.id || "plan"}:${Date.now()}`;
      const stepResults = [];
      state.liveTestResultId = liveReportId;
      state.testResultsMenuOpen = true;
      focusTestResult(liveReportId, {
        openMenu: true,
        activateResultsTab: true,
        resultOnly: true,
      });
      state.stateData = Object.assign({}, state.stateData || {}, {
        testPlanReport: buildClientTestPlanReport({
          plan,
          area,
          stepResults: [],
          reportId: liveReportId,
        }),
      });

      try {
        // Announce the plan name before the first executable step.
        // This makes the test session clearer for the installer on site.
        // eslint-disable-next-line no-await-in-loop
        await speakText(plan.name || "Test plan", plan.description || "");
      } catch (error) {}

      for (let index = 0; index < steps.length; index += 1) {
        const step = steps[index];
        state.testPlanRunningStepId = step && step.id ? step.id : "";
        const cyclePrefix = repeatForever ? `Cycle ${cycleNumber} · ` : "";
        setStatus(
          `${cyclePrefix}Step ${index + 1}/${steps.length}: ${step && step.title ? step.title : "Running..."}`,
        );

        try {
          // Voice feedback is best-effort. A playback error must not stop the KNX test.
          // eslint-disable-next-line no-await-in-loop
          await speakTestStepTitle(
            step || { title: `Step ${index + 1}` },
            index + 1,
          );
        } catch (error) {
          setStatus(
            `Voice unavailable for step ${index + 1}. Continuing test...`,
          );
        }

        try {
          // eslint-disable-next-line no-await-in-loop
          const data = await requestJson(apiUrl("test-plans/run-step"), {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              nodeId: state.selectedNodeId,
              areaId: plan.areaId,
              step,
            }),
          });
          if (data && data.area) area = data.area;
          stepResults.push(
            data && data.stepResult
              ? data.stepResult
              : buildClientStepFailureResult(
                  step,
                  new Error("Step returned no result"),
                ),
          );
        } catch (error) {
          stepResults.push(buildClientStepFailureResult(step, error));
        }

        state.stateData = Object.assign({}, state.stateData || {}, {
          testPlanReport: buildClientTestPlanReport({
            plan,
            area,
            stepResults: stepResults.slice(),
            reportId: liveReportId,
          }),
        });
      }

      const finalReport = buildClientTestPlanReport({
        plan,
        area,
        stepResults,
        reportId: liveReportId,
      });
      state.stateData = Object.assign({}, state.stateData || {}, {
        testPlans: testPlans.value,
        testPlanReport: finalReport,
      });
      focusTestResult(liveReportId, {
        openMenu: true,
        activateResultsTab: true,
        resultOnly: true,
      });
      try {
        // eslint-disable-next-line no-await-in-loop
        await persistTestResult(finalReport);
      } catch (error) {
        state.lastError = error.message || "Failed to save test result";
        setStatus(
          `Test completed, but the result was not saved: ${state.lastError}`,
        );
      }
      if (repeatForever && state.testPlanRepeatStopRequested !== true) {
        state.testResultFocusMode = false;
        setStatus(`Cycle ${cycleNumber} completed. Starting the next cycle...`);
      }
    } while (repeatForever && state.testPlanRepeatStopRequested !== true);
    const finalStatusMessage = repeatForever
      ? "Repeat mode stopped"
      : "Test completed";
    state.testPlanRunConfirmOpen = false;
    if (!state.lastError) setStatus(finalStatusMessage);
    try {
      // Announce completion once at the end of the test execution.
      // This is useful for installers running long test plans hands-free.
      // eslint-disable-next-line no-await-in-loop
      await speakText(localizeUiText(finalStatusMessage));
    } catch (error) {}
    requestAnimationFrame(() => {
      try {
        if (
          testPlanReportRef.value &&
          typeof testPlanReportRef.value.scrollIntoView === "function"
        ) {
          testPlanReportRef.value.scrollIntoView({
            behavior: "smooth",
            block: "start",
          });
        }
      } catch (error) {}
    });
  } catch (error) {
    state.lastError = error.message || "Failed to run test plan";
    setStatus(state.lastError);
  } finally {
    state.testPlanRunningStepId = "";
    stopActiveStepAudio();
    state.testPlanRunning = false;
    state.testPlanRepeatForever = false;
    state.testPlanRepeatStopRequested = false;
    state.testPlanRunMode = "single";
  }
}

function startNewProfileDraft() {
  state.activeTab = "tests";
  state.profileDraftMode = true;
  state.profileSelectedId = "";
  state.profileDraftId = "";
  state.profileDraftName = selectedArea.value
    ? `Control ${selectedArea.value.name || "Area"}`
    : "Custom Area Profile";
  state.profileDraftDescription =
    "Read-only profile customized by the installer.";
  state.profileDraftTargetTags = Array.isArray(
    selectedArea.value && selectedArea.value.tags,
  )
    ? selectedArea.value.tags.join(", ")
    : "";
  state.profileDraftMinActivityPct = 20;
  state.profileDraftMaxSilentPct = 60;
  state.profileDraftMaxAnomalies = 2;
}

function startNewActuatorDraft() {
  state.activeTab = "tests";
  state.actuatorDraftMode = true;
  state.actuatorPresetSelectedId = "";
  state.actuatorDraftId = "";
  state.actuatorDraftName = selectedArea.value
    ? `Actuator ${selectedArea.value.name || "Test"}`
    : "Actuator Test";
  state.actuatorDraftDescription =
    "Manual active test with command write, spontaneous status write check and explicit read-response check.";
  state.actuatorDraftCommandGA =
    selectedArea.value &&
    Array.isArray(selectedArea.value.sampleGAs) &&
    selectedArea.value.sampleGAs[0]
      ? selectedArea.value.sampleGAs[0]
      : "";
  state.actuatorDraftCommandDPT = "";
  state.actuatorDraftCommandPayload = "true";
  state.actuatorDraftStatusGA = "";
  state.actuatorDraftStatusDPT = "";
  state.actuatorDraftStatusWriteTimeoutMs = 5000;
  state.actuatorDraftStatusResponseTimeoutMs = 5000;
}

async function saveProfileDefinition() {
  if (!state.selectedNodeId || state.profileSaving) return;
  state.profileSaving = true;
  setStatus("Saving profile...");
  try {
    const data = await requestJson(apiUrl("profiles/save"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        nodeId: state.selectedNodeId,
        id: state.profileDraftId,
        name: state.profileDraftName,
        description: state.profileDraftDescription,
        targetTags: String(state.profileDraftTargetTags || "")
          .split(",")
          .map((item) => String(item || "").trim())
          .filter(Boolean),
        minActivityPct: Number(state.profileDraftMinActivityPct),
        maxSilentPct: Number(state.profileDraftMaxSilentPct),
        maxAnomalies: Number(state.profileDraftMaxAnomalies),
      }),
    });
    if (data && data.profiles) {
      state.stateData = Object.assign({}, state.stateData || {}, {
        profiles: data.profiles,
      });
      state.profileDraftMode = false;
      if (data.profileId) state.profileSelectedId = data.profileId;
    } else {
      state.profileDraftMode = false;
      await fetchState({ fresh: true });
    }
    setStatus("Profile saved");
  } catch (error) {
    state.lastError = error.message || "Failed to save profile";
    setStatus(state.lastError);
  } finally {
    state.profileSaving = false;
  }
}

async function deleteProfileDefinition() {
  const profile = selectedProfile.value;
  if (
    !profile ||
    profile.builtIn === true ||
    !state.selectedNodeId ||
    state.profileSaving
  )
    return;
  state.profileSaving = true;
  setStatus("Deleting profile...");
  try {
    const data = await requestJson(apiUrl("profiles/delete"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        nodeId: state.selectedNodeId,
        profileId: profile.id,
      }),
    });
    if (data && data.profiles) {
      state.stateData = Object.assign({}, state.stateData || {}, {
        profiles: data.profiles,
      });
      state.profileDraftMode = false;
    } else {
      state.profileDraftMode = false;
      await fetchState({ fresh: true });
    }
    setStatus("Profile deleted");
  } catch (error) {
    state.lastError = error.message || "Failed to delete profile";
    setStatus(state.lastError);
  } finally {
    state.profileSaving = false;
  }
}

async function runSelectedProfile() {
  if (
    !state.selectedNodeId ||
    !selectedArea.value ||
    !selectedProfile.value ||
    state.profileRunning
  )
    return;
  state.profileRunning = true;
  setStatus("Running profile...");
  try {
    const data = await requestJson(apiUrl("profiles/run"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        nodeId: state.selectedNodeId,
        areaId: selectedArea.value.id,
        profileId: selectedProfile.value.id,
      }),
    });
    state.stateData = Object.assign({}, state.stateData || {}, {
      areas: data.areas || areasState.value,
      profiles: data.profiles || profiles.value,
      profileReport: data.report || null,
      actuatorTests: data.actuatorTests || actuatorTests.value,
      testResults: data.testResults || persistedTestResults.value,
    });
    focusTestResult(
      data && data.report && data.report.id ? data.report.id : "",
      { openMenu: true, activateResultsTab: true, resultOnly: true },
    );
    setStatus("Profile report ready");
  } catch (error) {
    state.lastError = error.message || "Failed to run profile";
    setStatus(state.lastError);
  } finally {
    state.profileRunning = false;
  }
}

async function saveActuatorPreset() {
  if (!state.selectedNodeId || state.actuatorSaving) return;
  state.actuatorSaving = true;
  setStatus("Saving actuator preset...");
  try {
    const data = await requestJson(apiUrl("actuator-tests/save"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        nodeId: state.selectedNodeId,
        id: state.actuatorDraftId,
        name: state.actuatorDraftName,
        description: state.actuatorDraftDescription,
        commandGA: state.actuatorDraftCommandGA,
        commandDPT: state.actuatorDraftCommandDPT,
        commandPayload: state.actuatorDraftCommandPayload,
        statusGA: state.actuatorDraftStatusGA,
        statusDPT: state.actuatorDraftStatusDPT,
        statusWriteTimeoutMs: Number(state.actuatorDraftStatusWriteTimeoutMs),
        statusResponseTimeoutMs: Number(
          state.actuatorDraftStatusResponseTimeoutMs,
        ),
      }),
    });
    if (data && data.actuatorTests) {
      state.stateData = Object.assign({}, state.stateData || {}, {
        actuatorTests: data.actuatorTests,
      });
      state.actuatorDraftMode = false;
      if (data.presetId) state.actuatorPresetSelectedId = data.presetId;
    } else {
      state.actuatorDraftMode = false;
      await fetchState({ fresh: true });
    }
    setStatus("Actuator preset saved");
  } catch (error) {
    state.lastError = error.message || "Failed to save actuator preset";
    setStatus(state.lastError);
  } finally {
    state.actuatorSaving = false;
  }
}

async function deleteActuatorPreset() {
  const preset = selectedActuatorPreset.value;
  if (!preset || !state.selectedNodeId || state.actuatorSaving) return;
  state.actuatorSaving = true;
  setStatus("Deleting actuator preset...");
  try {
    const data = await requestJson(apiUrl("actuator-tests/delete"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        nodeId: state.selectedNodeId,
        presetId: preset.id,
      }),
    });
    if (data && data.actuatorTests) {
      state.stateData = Object.assign({}, state.stateData || {}, {
        actuatorTests: data.actuatorTests,
      });
      state.actuatorDraftMode = false;
    } else {
      state.actuatorDraftMode = false;
      await fetchState({ fresh: true });
    }
    setStatus("Actuator preset deleted");
  } catch (error) {
    state.lastError = error.message || "Failed to delete actuator preset";
    setStatus(state.lastError);
  } finally {
    state.actuatorSaving = false;
  }
}

async function runActuatorTest() {
  if (!state.selectedNodeId || state.actuatorRunning) return;
  state.actuatorRunning = true;
  setStatus("Running actuator test...");
  try {
    const data = await requestJson(apiUrl("actuator-tests/run"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        nodeId: state.selectedNodeId,
        id: state.actuatorDraftId,
        name: state.actuatorDraftName,
        description: state.actuatorDraftDescription,
        commandGA: state.actuatorDraftCommandGA,
        commandDPT: state.actuatorDraftCommandDPT,
        commandPayload: state.actuatorDraftCommandPayload,
        statusGA: state.actuatorDraftStatusGA,
        statusDPT: state.actuatorDraftStatusDPT,
        statusWriteTimeoutMs: Number(state.actuatorDraftStatusWriteTimeoutMs),
        statusResponseTimeoutMs: Number(
          state.actuatorDraftStatusResponseTimeoutMs,
        ),
      }),
    });
    state.stateData = Object.assign({}, state.stateData || {}, {
      actuatorTests: data.actuatorTests || actuatorTests.value,
      actuatorTestReport: data.report || null,
      testResults: data.testResults || persistedTestResults.value,
    });
    focusTestResult(
      data && data.report && data.report.id ? data.report.id : "",
      { openMenu: true, activateResultsTab: true, resultOnly: true },
    );
    setStatus("Actuator test complete");
  } catch (error) {
    state.lastError = error.message || "Failed to run actuator test";
    setStatus(state.lastError);
  } finally {
    state.actuatorRunning = false;
  }
}

async function exportFullConfig() {
  if (!state.selectedNodeId || backupBusy.value) return;
  const nodeId = state.selectedNodeId;
  backupBusy.value = true;
  state.lastError = "";
  setStatus("Exporting Cerebrum backup...");
  try {
    const response = await fetch(apiUrl("config/export"), {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: withAuthHeaders({ "content-type": "application/json" }),
      body: JSON.stringify({ nodeId, format: "zip", download: true }),
    });
    const contentType = String(response.headers.get("content-type") || "").toLowerCase();
    if (!response.ok || !contentType.includes("application/json")) {
      if ([401, 403].includes(response.status) || contentType.includes("text/html")) {
        throw new Error("Authentication required or insufficient permissions (session token missing or expired).");
      }
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || "Failed to export Cerebrum backup");
    }
    const download = await response.json();
    if (!download.downloadId || !download.filename) throw new Error("Failed to export Cerebrum backup");
    const url = new URL(apiUrl("config/download"), window.location.href);
    url.searchParams.set("nodeId", nodeId);
    url.searchParams.set("downloadId", download.downloadId);
    const link = document.createElement("a");
    link.href = url.href;
    link.download = download.filename;
    link.referrerPolicy = "no-referrer";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setStatus("Cerebrum backup exported");
  } catch (error) {
    state.lastError =
      error.message || "Failed to export Cerebrum backup";
    setStatus(state.lastError);
  } finally {
    backupBusy.value = false;
  }
}

function triggerConfigImport() {
  if (configImportRef.value) configImportRef.value.click();
}

async function importFullConfig(event) {
  const file =
    event && event.target && event.target.files && event.target.files[0]
      ? event.target.files[0]
      : null;
  if (!file || !state.selectedNodeId || backupBusy.value || state.etsAccessSaving) return;
  const nodeId = state.selectedNodeId;
  backupBusy.value = true;
  try {
    state.lastError = "";
    const signature = new Uint8Array(await file.slice(0, 4).arrayBuffer());
    const isZip = signature[0] === 0x50 && signature[1] === 0x4b;
    if (!isZip) {
      if (file.size > 256 * 1024 * 1024) throw new Error("Backup JSON metadata exceeds 256 MiB");
      const parsed = JSON.parse((await file.text()).replace(/^\uFEFF/, ""));
      if (parsed?.format !== "cerebrum-ultimate-backup" || ![1, 2].includes(parsed.version)) throw new Error("Unsupported Cerebrum backup");
    }
    const confirmed = window.confirm(
      localizeUiText(
        "Restore this backup? It replaces this node's Cerebrum data and archives, plus the shared learning and home memory. For migration, import and deploy the included Node-RED flows first. AI provider API keys are not changed.",
      ),
    );
    if (!confirmed) return;
    setStatus("Importing Cerebrum backup...");
    const chunkBytes = 48 * 1024;
    const total = Math.ceil(file.size / chunkBytes);
    let uploadId;
    for (let index = 0; index < total; index++) {
      const bytes = new Uint8Array(await file.slice(index * chunkBytes, (index + 1) * chunkBytes).arrayBuffer());
      const chunk = btoa(String.fromCharCode(...bytes));
      const response = await requestJson(apiUrl("config/import-chunk"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ nodeId, uploadId, index, total, chunk }),
      });
      uploadId = response.uploadId;
    }
    const data = await requestJson(apiUrl("config/import"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ nodeId, uploadId }),
    });
    if (state.selectedNodeId !== nodeId) return;
    state.stateData = Object.assign({}, state.stateData || {}, {
      areas: data.areas || areasState.value,
      profiles: data.profiles || profiles.value,
      actuatorTests: data.actuatorTests || actuatorTests.value,
      testPlans: data.testPlans || testPlans.value,
      testResults: data.testResults || persistedTestResults.value,
      etsAccess: data.etsAccess || null,
    });
    // Restore replaces the saved selection and the visible draft together.
    // Ignore any ETS request started before the import completed.
    etsAccessLoadGeneration++;
    state.etsAccessLoading = false;
    state.etsAccessData = data.etsAccess || null;
    state.etsAccessLoadedNodeId = "";
    if (data.etsAccess) hydrateEtsAccessDraft(data.etsAccess, { force: true });
    else await loadEtsAccessConfiguration({ force: true });
    await fetchGaCatalog();
    resetChatLearningEditor();
    resetCerebrumMemoryEditor();
    resetCerebrumOperations();
    if (state.activeTab === "cerebrum" && state.cerebrumTab === "learning")
      await loadChatLearningFile();
    if (state.activeTab === "cerebrum" && state.cerebrumTab === "memory")
      await loadCerebrumMemoryFile();
    if (state.activeTab === "cerebrum" && state.cerebrumTab === "operations")
      await loadCerebrumOperations({ force: true });
    setStatus(data.etsAccessRestored === false
      ? "Cerebrum backup imported; no ETS selection was included, so the existing selection was preserved."
      : "Cerebrum backup imported");
  } catch (error) {
    state.lastError =
      error.message || "Failed to import Cerebrum backup";
    setStatus(state.lastError);
  } finally {
    backupBusy.value = false;
    if (event && event.target) event.target.value = "";
  }
}

function resetChatLearningEditor() {
  chatLearningOperationGeneration += 1;
  state.chatLearningContent = "";
  state.chatLearningBaseline = "";
  state.chatLearningRevision = "";
  state.chatLearningName = "";
  state.chatLearningPath = "";
  state.chatLearningArchivePath = "";
  state.chatLearningBytes = 0;
  state.chatLearningModifiedAt = "";
  state.chatLearningSessionCount = 0;
  state.chatLearningLoadedNodeId = "";
  state.chatLearningLoading = false;
  state.chatLearningSaving = false;
  state.chatLearningResetting = false;
  state.chatLearningCopied = false;
  state.chatLearningError = "";
}

function applyChatLearningSnapshot(data = {}, nodeId = state.selectedNodeId) {
  const content = String(data.content || "");
  state.chatLearningContent = content;
  state.chatLearningBaseline = content;
  state.chatLearningRevision = String(data.revision || "");
  state.chatLearningName = String(data.name || "cerebrum-chat-context.knxctx");
  state.chatLearningPath = String(data.path || "");
  state.chatLearningArchivePath = String(data.archivePath || "");
  state.chatLearningBytes = Math.max(
    0,
    Number(data.bytes) || new Blob([content]).size,
  );
  state.chatLearningMaxBytes = Math.max(1, Number(data.maxBytes) || 512 * 1024);
  state.chatLearningModifiedAt = String(
    data.modifiedAt || data.updatedAt || "",
  );
  state.chatLearningSessionCount = Math.max(0, Number(data.sessionCount) || 0);
  state.chatLearningLoadedNodeId = nodeId;
  state.chatLearningError = "";
}

async function loadChatLearningFile({ force = false } = {}) {
  if (
    !state.selectedNodeId ||
    state.chatLearningLoading ||
    state.chatLearningSaving ||
    state.chatLearningResetting
  )
    return;
  if (chatLearningDirty.value && !force) return;
  if (
    chatLearningDirty.value &&
    force &&
    !window.confirm(
      localizeUiText("Discard unsaved Cerebrum Learning changes and reload?"),
    )
  )
    return;
  const nodeId = state.selectedNodeId;
  const operationGeneration = ++chatLearningOperationGeneration;
  state.chatLearningLoading = true;
  state.chatLearningError = "";
  setStatus("Loading Cerebrum Learning...");
  try {
    const data = await requestJson(
      apiUrl(`chat-learning?nodeId=${encodeURIComponent(nodeId)}`),
    );
    if (
      operationGeneration !== chatLearningOperationGeneration ||
      state.selectedNodeId !== nodeId
    )
      return;
    applyChatLearningSnapshot(data, nodeId);
    setStatus("Cerebrum Learning loaded");
  } catch (error) {
    if (
      operationGeneration !== chatLearningOperationGeneration ||
      state.selectedNodeId !== nodeId
    )
      return;
    state.chatLearningError =
      error.message || "Failed to load Cerebrum Learning";
    setStatus(state.chatLearningError);
  } finally {
    if (operationGeneration === chatLearningOperationGeneration)
      state.chatLearningLoading = false;
  }
}

async function saveChatLearningFile() {
  if (
    !state.selectedNodeId ||
    state.chatLearningLoading ||
    state.chatLearningSaving ||
    state.chatLearningResetting ||
    !chatLearningDirty.value ||
    chatLearningTooLarge.value
  )
    return;
  const nodeId = state.selectedNodeId;
  const operationGeneration = ++chatLearningOperationGeneration;
  state.chatLearningSaving = true;
  state.chatLearningError = "";
  setStatus("Saving Cerebrum Learning...");
  try {
    const data = await requestJson(apiUrl("chat-learning/save"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        nodeId,
        content: state.chatLearningContent,
        revision: state.chatLearningRevision,
      }),
    });
    if (
      operationGeneration !== chatLearningOperationGeneration ||
      state.selectedNodeId !== nodeId
    )
      return;
    applyChatLearningSnapshot(data, nodeId);
    setStatus("Cerebrum Learning saved");
  } catch (error) {
    if (
      operationGeneration !== chatLearningOperationGeneration ||
      state.selectedNodeId !== nodeId
    )
      return;
    state.chatLearningError =
      error.message || "Failed to save Cerebrum Learning";
    setStatus(state.chatLearningError);
  } finally {
    if (operationGeneration === chatLearningOperationGeneration)
      state.chatLearningSaving = false;
  }
}

async function reinitializeChatLearningMemory() {
  if (
    !state.selectedNodeId ||
    state.chatLearningLoading ||
    state.chatLearningSaving ||
    state.chatLearningResetting
  )
    return;
  const confirmed = window.confirm(
    localizeUiText(
      "This permanently deletes all saved Cerebrum Learning sessions, instructions and camera watches, and discards unsaved editor changes. Reinitialize memory from zero?",
    ),
  );
  if (!confirmed) return;
  const nodeId = state.selectedNodeId;
  const operationGeneration = ++chatLearningOperationGeneration;
  state.chatLearningResetting = true;
  state.chatLearningError = "";
  setStatus("Reinitializing Cerebrum Learning...");
  try {
    const data = await requestJson(apiUrl("chat-learning/reset"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        nodeId,
        revision: state.chatLearningRevision,
      }),
    });
    if (
      operationGeneration !== chatLearningOperationGeneration ||
      state.selectedNodeId !== nodeId
    )
      return;
    applyChatLearningSnapshot(data, nodeId);
    setStatus("Cerebrum Learning reinitialized");
  } catch (error) {
    if (
      operationGeneration !== chatLearningOperationGeneration ||
      state.selectedNodeId !== nodeId
    )
      return;
    state.chatLearningError =
      error.message || "Failed to reinitialize Cerebrum Learning";
    setStatus(state.chatLearningError);
  } finally {
    if (operationGeneration === chatLearningOperationGeneration)
      state.chatLearningResetting = false;
  }
}

async function copyChatLearningFile() {
  if (!state.chatLearningContent) return;
  try {
    const copiedText =
      state.chatLearningViewMode === "simple"
        ? chatLearningSimpleView.value
        : state.chatLearningContent;
    if (!copiedText)
      throw new Error("Could not prepare the Cerebrum Learning view");
    await copyTextToClipboard(copiedText);
    state.chatLearningCopied = true;
    state.chatLearningError = "";
    setStatus(
      state.chatLearningViewMode === "simple"
        ? "Simplified Cerebrum Learning view copied to clipboard"
        : "Cerebrum Learning native file copied to clipboard",
    );
    setTimeout(() => {
      state.chatLearningCopied = false;
    }, 2500);
  } catch (error) {
    state.chatLearningError = error.message || "Could not copy to clipboard";
    setStatus(state.chatLearningError);
  }
}

function downloadChatLearningBackup() {
  if (!state.chatLearningContent) return;
  const blob = new Blob([state.chatLearningContent], {
    type: "text/plain;charset=utf-8",
  });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = state.chatLearningName || "cerebrum-chat-context.knxctx";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(url);
  setStatus("Cerebrum Learning backup downloaded");
}

function triggerChatLearningImport() {
  if (chatLearningImportRef.value) chatLearningImportRef.value.click();
}

async function importChatLearningBackup(event) {
  const file =
    event && event.target && event.target.files && event.target.files[0]
      ? event.target.files[0]
      : null;
  if (!file) return;
  try {
    const content = await file.text();
    if (new Blob([content]).size > state.chatLearningMaxBytes)
      throw new Error("Cerebrum Learning backup exceeds the file-size limit");
    state.chatLearningContent = content;
    state.chatLearningError = "";
    setStatus(
      "Cerebrum Learning backup loaded; review it and save to apply it.",
    );
  } catch (error) {
    state.chatLearningError =
      error.message || "Failed to load Cerebrum Learning backup";
    setStatus(state.chatLearningError);
  } finally {
    if (event && event.target) event.target.value = "";
  }
}

function resetCerebrumMemoryEditor() {
  cerebrumMemoryOperationGeneration += 1;
  state.cerebrumMemoryContent = "";
  state.cerebrumMemoryBaseline = "";
  state.cerebrumMemoryFileContent = "";
  state.cerebrumMemoryRevision = "";
  state.cerebrumMemoryName = "";
  state.cerebrumMemoryPath = "";
  state.cerebrumMemoryBytes = 0;
  state.cerebrumMemoryModifiedAt = "";
  state.cerebrumMemoryHabitCount = 0;
  state.cerebrumMemoryConfirmedHabitCount = 0;
  state.cerebrumMemoryPendingHabitCount = 0;
  state.cerebrumMemoryStateCount = 0;
  state.cerebrumMemoryLoadedNodeId = "";
  state.cerebrumMemoryLoading = false;
  state.cerebrumMemorySaving = false;
  state.cerebrumMemoryResetting = false;
  state.cerebrumMemoryCopied = false;
  state.cerebrumMemoryError = "";
}

function applyCerebrumMemorySnapshot(data = {}, nodeId = state.selectedNodeId) {
  const fileContent = String(data.content || "");
  let jsonContent = String(data.jsonContent || "");
  if (!jsonContent) {
    try {
      jsonContent = formatCerebrumMemoryJson(fileContent);
    } catch (error) {
      jsonContent = fileContent;
    }
  }
  state.cerebrumMemoryContent = jsonContent;
  state.cerebrumMemoryBaseline = jsonContent;
  state.cerebrumMemoryFileContent = fileContent;
  state.cerebrumMemoryRevision = String(data.revision || "");
  state.cerebrumMemoryName = String(data.name || "cerebrum-home-memory.md");
  state.cerebrumMemoryPath = String(data.path || "");
  state.cerebrumMemoryBytes = Math.max(
    0,
    Number(data.bytes) || new Blob([fileContent]).size,
  );
  state.cerebrumMemoryMaxBytes = Math.max(
    1,
    Number(data.maxBytes) || 5 * 1024 * 1024,
  );
  state.cerebrumMemoryModifiedAt = String(
    data.modifiedAt || data.updatedAt || "",
  );
  state.cerebrumMemoryHabitCount = Math.max(0, Number(data.habitCount) || 0);
  state.cerebrumMemoryConfirmedHabitCount = Math.max(
    0,
    Number(data.confirmedHabitCount) || 0,
  );
  state.cerebrumMemoryPendingHabitCount = Math.max(
    0,
    Number(data.pendingHabitCount) || 0,
  );
  state.cerebrumMemoryStateCount = Math.max(0, Number(data.stateCount) || 0);
  state.cerebrumMemoryLoadedNodeId = nodeId;
  state.cerebrumMemoryError = "";
}

async function loadCerebrumMemoryFile({ force = false } = {}) {
  if (
    !state.selectedNodeId ||
    state.cerebrumMemoryLoading ||
    state.cerebrumMemorySaving ||
    state.cerebrumMemoryResetting
  )
    return;
  if (cerebrumMemoryDirty.value && !force) return;
  if (
    cerebrumMemoryDirty.value &&
    force &&
    !window.confirm(
      localizeUiText("Discard unsaved Cerebrum memory changes and reload?"),
    )
  )
    return;
  const nodeId = state.selectedNodeId;
  const operationGeneration = ++cerebrumMemoryOperationGeneration;
  state.cerebrumMemoryLoading = true;
  state.cerebrumMemoryError = "";
  setStatus("Loading Cerebrum memory...");
  try {
    const data = await requestJson(
      apiUrl(`home-memory?nodeId=${encodeURIComponent(nodeId)}`),
    );
    if (
      operationGeneration !== cerebrumMemoryOperationGeneration ||
      state.selectedNodeId !== nodeId
    )
      return;
    applyCerebrumMemorySnapshot(data, nodeId);
    setStatus("Cerebrum memory loaded");
  } catch (error) {
    if (
      operationGeneration !== cerebrumMemoryOperationGeneration ||
      state.selectedNodeId !== nodeId
    )
      return;
    state.cerebrumMemoryError =
      error.message || "Failed to load Cerebrum memory";
    setStatus(state.cerebrumMemoryError);
  } finally {
    if (operationGeneration === cerebrumMemoryOperationGeneration)
      state.cerebrumMemoryLoading = false;
  }
}

async function saveCerebrumMemoryFile() {
  if (
    !state.selectedNodeId ||
    state.cerebrumMemoryLoading ||
    state.cerebrumMemorySaving ||
    state.cerebrumMemoryResetting ||
    !cerebrumMemoryDirty.value ||
    cerebrumMemoryTooLarge.value
  )
    return;
  const nodeId = state.selectedNodeId;
  const operationGeneration = ++cerebrumMemoryOperationGeneration;
  state.cerebrumMemorySaving = true;
  state.cerebrumMemoryError = "";
  setStatus("Saving Cerebrum memory...");
  try {
    const data = await requestJson(apiUrl("home-memory/save"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        nodeId,
        jsonContent: state.cerebrumMemoryContent,
        revision: state.cerebrumMemoryRevision,
      }),
    });
    if (
      operationGeneration !== cerebrumMemoryOperationGeneration ||
      state.selectedNodeId !== nodeId
    )
      return;
    applyCerebrumMemorySnapshot(data, nodeId);
    setStatus("Cerebrum memory saved");
  } catch (error) {
    if (
      operationGeneration !== cerebrumMemoryOperationGeneration ||
      state.selectedNodeId !== nodeId
    )
      return;
    state.cerebrumMemoryError =
      error.message || "Failed to save Cerebrum memory";
    setStatus(state.cerebrumMemoryError);
  } finally {
    if (operationGeneration === cerebrumMemoryOperationGeneration)
      state.cerebrumMemorySaving = false;
  }
}

async function reinitializeCerebrumMemory() {
  if (
    !state.selectedNodeId ||
    state.cerebrumMemoryLoading ||
    state.cerebrumMemorySaving ||
    state.cerebrumMemoryResetting
  )
    return;
  const confirmed = window.confirm(
    localizeUiText(
      "This permanently deletes learned habits, occupant decisions and cached home states, and discards unsaved editor changes. Reinitialize Cerebrum memory from zero?",
    ),
  );
  if (!confirmed) return;
  const nodeId = state.selectedNodeId;
  const operationGeneration = ++cerebrumMemoryOperationGeneration;
  state.cerebrumMemoryResetting = true;
  state.cerebrumMemoryError = "";
  setStatus("Reinitializing Cerebrum memory...");
  try {
    const data = await requestJson(apiUrl("home-memory/reset"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ nodeId, revision: state.cerebrumMemoryRevision }),
    });
    if (
      operationGeneration !== cerebrumMemoryOperationGeneration ||
      state.selectedNodeId !== nodeId
    )
      return;
    applyCerebrumMemorySnapshot(data, nodeId);
    setStatus("Cerebrum memory reinitialized");
  } catch (error) {
    if (
      operationGeneration !== cerebrumMemoryOperationGeneration ||
      state.selectedNodeId !== nodeId
    )
      return;
    state.cerebrumMemoryError =
      error.message || "Failed to reinitialize Cerebrum memory";
    setStatus(state.cerebrumMemoryError);
  } finally {
    if (operationGeneration === cerebrumMemoryOperationGeneration)
      state.cerebrumMemoryResetting = false;
  }
}

async function copyCerebrumMemoryFile() {
  if (!state.cerebrumMemoryContent) return;
  try {
    const copyContent =
      state.cerebrumMemoryViewMode === "simple"
        ? cerebrumMemorySimpleView.value
        : state.cerebrumMemoryContent;
    await copyTextToClipboard(copyContent);
    state.cerebrumMemoryCopied = true;
    state.cerebrumMemoryError = "";
    setStatus(
      state.cerebrumMemoryViewMode === "simple"
        ? "Simplified Cerebrum view copied to clipboard"
        : "Cerebrum JSON copied to clipboard",
    );
    setTimeout(() => {
      state.cerebrumMemoryCopied = false;
    }, 2500);
  } catch (error) {
    state.cerebrumMemoryError = error.message || "Could not copy to clipboard";
    setStatus(state.cerebrumMemoryError);
  }
}

function downloadCerebrumMemoryBackup() {
  if (!state.cerebrumMemoryContent) return;
  try {
    const content = replaceCerebrumMemoryJsonBlock(
      state.cerebrumMemoryFileContent,
      state.cerebrumMemoryContent,
    );
    const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = state.cerebrumMemoryName || "cerebrum-home-memory.md";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
    setStatus("Cerebrum memory backup downloaded");
  } catch (error) {
    state.cerebrumMemoryError =
      error.message || "Could not prepare the Cerebrum memory backup";
    setStatus(state.cerebrumMemoryError);
  }
}

function triggerCerebrumMemoryImport() {
  if (cerebrumMemoryImportRef.value) cerebrumMemoryImportRef.value.click();
}

async function importCerebrumMemoryBackup(event) {
  const file =
    event && event.target && event.target.files && event.target.files[0]
      ? event.target.files[0]
      : null;
  if (!file) return;
  try {
    const content = await file.text();
    if (new Blob([content]).size > state.cerebrumMemoryMaxBytes)
      throw new Error("Cerebrum memory backup exceeds the file-size limit");
    state.cerebrumMemoryContent = formatCerebrumMemoryJson(content);
    state.cerebrumMemoryFileContent = content;
    state.cerebrumMemoryViewMode = "json";
    state.cerebrumMemoryError = "";
    setStatus("Cerebrum memory backup loaded; review it and save to apply it.");
  } catch (error) {
    state.cerebrumMemoryError =
      error.message || "Failed to load Cerebrum memory backup";
    setStatus(state.cerebrumMemoryError);
  } finally {
    if (event && event.target) event.target.value = "";
  }
}

function resetCerebrumOperations() {
  cerebrumOperationsGeneration += 1;
  state.cerebrumOperationsItems = [];
  state.cerebrumOperationsCounts = {
    total: 0,
    knx: 0,
    llm: 0,
    tool: 0,
    autonomous: 0,
    system: 0,
  };
  state.cerebrumOperationsFrom = "";
  state.cerebrumOperationsTo = "";
  state.cerebrumOperationsArchivePath = "";
  state.cerebrumOperationsKnxArchivePath = "";
  state.cerebrumOperationsLoadedNodeId = "";
  state.cerebrumOperationsLoadedAt = 0;
  state.cerebrumOperationsLoading = false;
  state.cerebrumOperationsError = "";
  state.cerebrumOperationsTruncated = false;
  state.cerebrumOperationsStatusFilter = "all";
}

async function loadCerebrumOperations({ force = false } = {}) {
  if (!state.selectedNodeId || state.cerebrumOperationsLoading) return;
  if (
    !force &&
    state.cerebrumOperationsLoadedNodeId === state.selectedNodeId &&
    Date.now() - Number(state.cerebrumOperationsLoadedAt || 0) < 10000
  )
    return;
  const nodeId = state.selectedNodeId;
  const generation = ++cerebrumOperationsGeneration;
  state.cerebrumOperationsLoading = true;
  state.cerebrumOperationsError = "";
  try {
    const data = await requestJson(
      apiUrl(
        `operations?nodeId=${encodeURIComponent(nodeId)}&limit=2000&ts=${Date.now()}`,
      ),
    );
    if (
      generation !== cerebrumOperationsGeneration ||
      state.selectedNodeId !== nodeId
    )
      return;
    state.cerebrumOperationsItems = Array.isArray(data && data.items)
      ? data.items
      : [];
    state.cerebrumOperationsCounts = Object.assign(
      {
        total: 0,
        knx: 0,
        llm: 0,
        tool: 0,
        autonomous: 0,
        system: 0,
      },
      data && data.counts ? data.counts : {},
    );
    state.cerebrumOperationsFrom = String(data && data.from ? data.from : "");
    state.cerebrumOperationsTo = String(data && data.to ? data.to : "");
    state.cerebrumOperationsArchivePath = String(
      data && data.archivePath ? data.archivePath : "",
    );
    state.cerebrumOperationsKnxArchivePath = String(
      data && data.knxArchivePath ? data.knxArchivePath : "",
    );
    state.cerebrumOperationsTruncated = data && data.truncated === true;
    state.cerebrumOperationsLoadedNodeId = nodeId;
    state.cerebrumOperationsLoadedAt = Date.now();
  } catch (error) {
    if (
      generation !== cerebrumOperationsGeneration ||
      state.selectedNodeId !== nodeId
    )
      return;
    state.cerebrumOperationsError =
      error.message || "Failed to load Cerebrum operations";
    setStatus(state.cerebrumOperationsError);
  } finally {
    if (generation === cerebrumOperationsGeneration)
      state.cerebrumOperationsLoading = false;
  }
}

function startTimers() {
  if (!state.pollStateHandle) {
    state.pollStateHandle = window.setInterval(() => {
      fetchState({ fresh: false });
    }, 1500);
  }
  if (!state.pollNodesHandle) {
    state.pollNodesHandle = window.setInterval(() => {
      fetchNodes();
    }, 15000);
  }
}

function stopTimers() {
  if (state.pollStateHandle) {
    window.clearInterval(state.pollStateHandle);
    state.pollStateHandle = null;
  }
  if (state.pollNodesHandle) {
    window.clearInterval(state.pollNodesHandle);
    state.pollNodesHandle = null;
  }
}

onMounted(async () => {
  uiLanguage.value = resolveUiLanguage();
  syncViewportMode();
  window.addEventListener("resize", syncViewportMode);
  document.addEventListener("keydown", onGlobalKeydown);
  document.addEventListener("fullscreenchange", syncFullscreenState);
  await fetchNodes();
  await fetchState({ fresh: true });
  if (state.activeTab === "etsAccess") await loadEtsAccessConfiguration();
  await fetchGaCatalog();
  if (state.activeTab === "cerebrum" && state.cerebrumTab === "learning")
    await loadChatLearningFile();
  if (state.activeTab === "cerebrum" && state.cerebrumTab === "memory")
    await loadCerebrumMemoryFile();
  if (state.activeTab === "cerebrum" && state.cerebrumTab === "operations")
    await loadCerebrumOperations({ force: true });
  startTimers();
  startUiTranslationObserver();
});

onBeforeUnmount(() => {
  window.removeEventListener("resize", syncViewportMode);
  document.removeEventListener("keydown", onGlobalKeydown);
  document.removeEventListener("fullscreenchange", syncFullscreenState);
  stopUiTranslationObserver();
  stopTimers();
  stopActiveStepAudio();
});
</script>

<template>
  <a class="skip-link" href="#workspace-content">Skip to content</a>
  <header class="m-header">
    <div class="m-header-brand">
      <span class="m-logo-mark"><CerebrumIcon name="brain" /></span>
      <span class="hb-logo-text-mobile">Cerebrum</span>
    </div>
    <button
      class="hamburger-icon"
      :class="{ 'hamburger-icon-cross': isSidebarExpanded }"
      type="button"
      :aria-expanded="isSidebarExpanded ? 'true' : 'false'"
      aria-controls="cerebrum-sidebar"
      aria-label="Toggle menu"
      @click="toggleSidebar"
    >
      <span />
      <span />
      <span />
      <span />
    </button>
  </header>

  <button
    v-if="isCompactViewport && isSidebarExpanded"
    class="sidebar-overlay"
    type="button"
    aria-label="Close menu"
    @click="closeSidebarOnMobile"
  />

  <div
    class="page-shell"
    :class="{
      'sidebar-collapsed': !isSidebarExpanded,
      'sidebar-mobile-open': isCompactViewport && isSidebarExpanded,
    }"
  >
    <aside id="cerebrum-sidebar" class="app-sidebar" :inert="isCompactViewport && !isSidebarExpanded">
      <div class="sidebar-brand-wrap">
        <div class="sidebar-brand-mark" aria-hidden="true"><CerebrumIcon name="brain" /></div>
        <div class="sidebar-brand">
          <p class="sidebar-brand-name">Cerebrum<span>ULTIMATE</span></p>
        </div>
        <button
          class="sidebar-collapse-toggle"
          type="button"
          :aria-expanded="isSidebarExpanded ? 'true' : 'false'"
          aria-controls="cerebrum-sidebar"
          aria-label="Toggle sidebar"
          @click="toggleSidebar"
        >
          <span class="sidebar-collapse-icon">{{
            isSidebarExpanded ? (isCompactViewport ? "×" : "‹") : "›"
          }}</span>
        </button>
      </div>

      <CerebrumNavigation
        :active-tab="state.activeTab"
        :cerebrum-tab="state.cerebrumTab"
        :sections="cerebrumSections"
        :expanded="isSidebarExpanded"
        :knx-open="state.knxMenuOpen"
        :translate="localizeUiText"
        @navigate="activateSidebarTab"
        @cerebrum="navigateToCerebrum"
        @toggle-knx="toggleKnxMenu"
      />

      <div v-if="isSidebarExpanded" class="sidebar-panel sidebar-actions">
        <div class="support-link-row">
          <a
            class="secondary-button support-link-button"
            :href="CEREBRUM_PAYPAL_URL"
            target="_blank"
            rel="noopener noreferrer"
          >
            Donate via PayPal
          </a>
          <a
            class="secondary-button support-link-button support-link-button-youtube"
            :href="CEREBRUM_YOUTUBE_URL"
            target="_blank"
            rel="noopener noreferrer"
          >
            Subscribe
          </a>
        </div>
      </div>

      <div v-if="isSidebarExpanded" class="sidebar-footer">
        <a
          class="sidebar-doc-link"
          :href="CEREBRUM_VUE_DOCS_URL"
          target="_blank"
          rel="noopener noreferrer"
        >
          Documentation
        </a>
      </div>
    </aside>

    <section class="workspace-shell" :inert="isCompactViewport && isSidebarExpanded" :style="{ '--page-accent': workspacePage.color }">
      <header class="neural-workspace-header" data-cerebrum-localized>
        <div class="workspace-heading">
          <p class="workspace-breadcrumb"><span>CEREBRUM</span><span aria-hidden="true">/</span>{{ workspacePage.group }}</p>
          <h1>{{ workspacePage.title }}</h1>
          <p class="workspace-description">{{ workspacePage.description }}</p>
        </div>
        <div class="workspace-runtime">
          <div class="runtime-node" v-if="selectedNode">
            <span class="runtime-node-name">{{ selectedNode.name || selectedNode.id }}</span>
            <span class="runtime-model">{{ selectedNode.llmModel || selectedNode.llmProvider || 'Cerebrum' }}</span>
          </div>
          <div class="runtime-actions">
            <span class="runtime-status" :class="{ error: !!state.lastError, busy: uiBusy }" role="status" :title="state.status">
              <span class="runtime-dot" :class="{ 'running-spinner': uiBusy }" aria-hidden="true" />{{ state.status }}
            </span>
            <button class="secondary-button workspace-refresh" type="button" :disabled="state.loadingNodes || state.loadingState" :title="localizeUiText('Refresh')" :aria-label="localizeUiText('Refresh')" @click="onRefresh"><CerebrumIcon name="refresh" /></button>
          </div>
        </div>
      </header>
      <nav v-if="state.activeTab === 'overview'" class="workspace-shortcuts" :aria-label="localizeUiText('Quick access')" data-cerebrum-localized>
        <button type="button" @click="navigateToCerebrum('brain')"><CerebrumIcon name="brain" /><span><strong>{{ localizeUiText('Neural map') }}</strong><small>{{ localizeUiText('Explore Cerebrum') }}</small></span><span aria-hidden="true">↗</span></button>
        <button type="button" @click="navigateToCerebrum('conversation')"><span class="shortcut-number" aria-hidden="true">01</span><span><strong>{{ localizeUiText('Conversation') }}</strong><small>{{ localizeUiText('Talk to your home') }}</small></span><span aria-hidden="true">↗</span></button>
        <button type="button" @click="activateSidebarTab('areas')"><CerebrumIcon name="areas" /><span><strong>{{ localizeUiText('Areas') }}</strong><small>{{ localizeUiText('Organize your KNX home') }}</small></span><span aria-hidden="true">↗</span></button>
      </nav>
      <main id="workspace-content" class="content-grid workspace-main" tabindex="-1">
        <section
          v-if="state.activeTab === 'overview'"
          class="card card-summary"
        >
          <div class="card-head">
            <h2>Summary</h2>
            <span v-if="summary.meta?.generatedAt" class="meta-chip">{{
              formatDateTime(summary.meta.generatedAt)
            }}</span>
          </div>
          <div class="metric-grid">
            <article class="metric">
              <span>Telegrams</span>
              <strong>{{ Number(summary.counters?.telegrams || 0) }}</strong>
            </article>
            <article class="metric">
              <span>Rate</span>
              <strong
                >{{
                  Number(summary.counters?.overallRatePerSec || 0)
                }}/s</strong
              >
            </article>
            <article class="metric">
              <span>Repeat</span>
              <strong>{{ Number(summary.counters?.repeated || 0) }}</strong>
            </article>
            <article class="metric">
              <span>Unknown DPT</span>
              <strong>{{ Number(summary.counters?.unknownDpt || 0) }}</strong>
            </article>
          </div>
          <pre class="summary-pre">{{ summaryText }}</pre>
        </section>

        <section
          v-if="state.activeTab === 'etsAccess'"
          class="card card-ets-access"
        >
          <div class="card-head workspace-page-head">
            <div class="ets-access-head-actions">
              <span class="meta-chip"
                >{{ state.etsAccessSelected.length }} /
                {{ Number(etsAccessState.totalCount || 0) }} selected</span
              >
              <span class="meta-chip"
                >{{ state.etsAccessReadOnly.length }} read only</span
              >
              <span v-if="etsAccessDirty" class="meta-chip chat-learning-dirty"
                >Unsaved changes</span
              >
              <button
                class="secondary-button"
                type="button"
                :disabled="
                  !etsAccessDirty ||
                  state.etsAccessSaving ||
                  state.etsAccessLoading
                "
                @click="discardEtsAccessChanges"
              >
                Discard
              </button>
              <button
                class="primary-button"
                type="button"
                :disabled="
                  !etsAccessDirty ||
                  state.etsAccessSaving ||
                  state.etsAccessLoading ||
                  backupBusy ||
                  !etsAccessState.gateway?.configured
                "
                @click="saveEtsAccessConfiguration"
              >
                {{ state.etsAccessSaving ? "Saving..." : "Save ETS Access" }}
              </button>
            </div>
          </div>

          <div
            v-if="!etsAccessState.gateway?.configured"
            class="error-banner ets-access-banner"
            role="status"
          >
            Select and deploy a KNX Ultimate gateway in the Cerebrum node before
            configuring ETS access.
          </div>
          <div v-else>
            <div class="ets-access-gateway-row">
              <div>
                <strong>{{
                  etsAccessState.gateway.name || "KNX Ultimate gateway"
                }}</strong>
                <p class="area-detail-subhead">
                  The saved selection is the operational authority for KNX reads
                  and writes.
                </p>
              </div>
              <span
                class="pill"
                :class="etsAccessState.configured ? 'success' : 'danger'"
              >
                {{
                  etsAccessState.configured
                    ? "Access configured"
                    : "Access not configured"
                }}
              </span>
            </div>

            <div
              v-if="!etsAccessState.configured"
              class="ets-access-onboarding"
            >
              <strong>Configure ETS access before using KNX</strong>
              <p class="area-detail-subhead">
                Nothing is exposed until you explicitly select group addresses
                and save.
              </p>
            </div>

            <div class="ets-access-toolbar">
              <label class="flow-field ets-access-search">
                <span>Search group addresses</span>
                <input
                  v-model="state.etsAccessFilter"
                  type="text"
                  placeholder="Search GA, label, DPT or ETS path"
                />
              </label>
              <div class="ets-access-bulk-actions">
                <button
                  class="secondary-button"
                  type="button"
                  @click="setMatchingEtsAccessSelection(true)"
                >
                  Select all matching
                </button>
                <button
                  class="secondary-button"
                  type="button"
                  @click="setMatchingEtsAccessSelection(false)"
                >
                  Deselect all matching
                </button>
                <button
                  class="secondary-button"
                  type="button"
                  @click="setMatchingEtsAccessReadOnly(true)"
                >
                  Read only matching
                </button>
                <button
                  class="secondary-button"
                  type="button"
                  @click="setMatchingEtsAccessReadOnly(false)"
                >
                  Read/write matching
                </button>
              </div>
            </div>

            <div class="ets-access-list-head">
              <span>{{ etsAccessMatchingItems.length }} matching</span>
              <span
                v-if="
                  etsAccessMatchingItems.length > visibleEtsAccessItems.length
                "
                >Showing first {{ visibleEtsAccessItems.length }}. Refine the
                search to see more.</span
              >
            </div>
            <p v-if="state.etsAccessLoading" class="empty-state">
              Loading ETS access...
            </p>
            <div
              v-else-if="visibleEtsAccessItems.length"
              class="ets-access-list"
            >
              <article
                v-for="item in visibleEtsAccessItems"
                :key="item.ga"
                class="ets-access-row"
                :class="{ selected: etsAccessSelectedSet.has(item.ga) }"
              >
                <label class="ets-access-select-control">
                  <input
                    type="checkbox"
                    :checked="etsAccessSelectedSet.has(item.ga)"
                    :aria-label="`Expose ${item.ga}`"
                    @change="
                      toggleEtsAccessSelection(item.ga, $event.target.checked)
                    "
                  />
                  <span class="ets-access-ga">{{ item.ga }}</span>
                </label>
                <div class="ets-access-copy">
                  <strong>{{ item.label || "Unlabeled GA" }}</strong>
                  <span>{{
                    item.hierarchyPath || item.etsName || "No ETS path"
                  }}</span>
                </div>
                <span class="ets-access-dpt">{{
                  item.dpt ? `DPT ${item.dpt}` : "No DPT"
                }}</span>
                <label
                  class="ets-access-readonly-control"
                  :class="{ disabled: !etsAccessSelectedSet.has(item.ga) }"
                >
                  <input
                    type="checkbox"
                    :disabled="!etsAccessSelectedSet.has(item.ga)"
                    :checked="etsAccessReadOnlySet.has(item.ga)"
                    :aria-label="`Read only ${item.ga}`"
                    @change="
                      toggleEtsAccessReadOnly(item.ga, $event.target.checked)
                    "
                  />
                  <span>Read only</span>
                </label>
              </article>
            </div>
            <p v-else class="empty-state">
              No group addresses match the current search, or the selected
              gateway has no ETS catalog.
            </p>
            <p
              v-if="state.etsAccessError"
              class="error-banner ets-access-banner"
              role="alert"
            >
              {{ state.etsAccessError }}
            </p>
          </div>
        </section>

        <section v-if="state.activeTab === 'areas'" class="card card-areas">
          <div class="card-head workspace-page-head">
            <div>
              <h2>KNX Areas</h2>
              <p class="area-detail-subhead">
                Configure the areas used to organize KNX group addresses and
                build tests.
              </p>
            </div>
            <div class="workflow-primary-actions">
              <button
                class="secondary-button new-button"
                type="button"
                @click="startNewAreaDraft"
              >
                New Area
              </button>
            </div>
          </div>
          <div class="workspace-summary-row">
            <div class="pill-row">
              <span class="pill muted"
                >{{ Number(areaTotals.suggestedAreaCount || 0) }} areas</span
              >
              <span class="pill muted"
                >GA {{ Number(areaTotals.gaCount || 0) }}</span
              >
              <span class="pill muted"
                ><span>Hierarchical</span>&nbsp;{{
                  Number(areaTotals.hierarchicalGaCount || 0)
                }}</span
              >
              <span class="pill muted"
                ><span>Secondary</span>&nbsp;{{
                  Number(areaTotals.secondaryGroupCount || 0)
                }}</span
              >
              <span class="pill muted"
                ><span>Active</span>&nbsp;{{
                  Number(areaTotals.activeAreaCount || 0)
                }}</span
              >
            </div>
            <details class="more-actions workspace-maintenance">
              <summary>Area management</summary>
              <div class="more-actions-menu">
                <p class="more-actions-copy">
                  Rebuild the suggested areas or remove only those generated by
                  AI.
                </p>
                <button
                  class="secondary-button"
                  type="button"
                  :disabled="
                    state.areaLlmRegenerating ||
                    state.areaLlmBulkDeleting ||
                    !nodeInfo.llmEnabled
                  "
                  @click="regenerateLlmAreas"
                >
                  <span
                    v-if="state.areaLlmRegenerating"
                    class="running-spinner run-button-spinner"
                    aria-hidden="true"
                  />
                  <span>{{
                    state.areaLlmRegenerating
                      ? "Regenerating..."
                      : "Regenerate AI Areas"
                  }}</span>
                </button>
                <button
                  class="danger-button"
                  type="button"
                  :disabled="
                    state.areaLlmRegenerating ||
                    state.areaLlmBulkDeleting ||
                    aiGeneratedAreaCount <= 0
                  "
                  @click="deleteAllLlmAreas"
                >
                  <span
                    v-if="state.areaLlmBulkDeleting"
                    class="running-spinner run-button-spinner"
                    aria-hidden="true"
                  />
                  <span>{{
                    state.areaLlmBulkDeleting
                      ? "Deleting..."
                      : "Delete AI Areas"
                  }}</span>
                </button>
              </div>
            </details>
          </div>
          <p
            v-if="state.areaLlmError"
            class="planner-error-banner area-regenerate-error"
          >
            {{ state.areaLlmError }}
          </p>
          <div
            v-if="filteredAreas.length || state.areaDraftIsNew"
            class="areas-layout"
          >
            <section
              v-if="!selectedArea && !state.areaDraftIsNew"
              class="workflow-section workflow-selection-section"
            >
              <div class="workflow-section-head">
                <span class="workflow-step-index">1</span>
                <div>
                  <h3>Select an Area</h3>
                  <p class="area-detail-subhead">
                    Search an existing area to review its group addresses, or
                    create a new one.
                  </p>
                </div>
              </div>
              <div class="area-listbox-shell">
                <label class="flow-field">
                  <span>Find an existing area</span>
                  <div class="area-search-select">
                    <input
                      v-model="state.areaSearch"
                      class="area-search-select-input"
                      type="text"
                      :placeholder="
                        selectedArea
                          ? formatAreaListOptionLabel(selectedArea)
                          : 'Search area...'
                      "
                      @focus="state.areaSearchOpen = true"
                      @input="state.areaSearchOpen = true"
                      @blur="closeAreaSearchSoon"
                    />
                    <div
                      v-if="state.areaSearchOpen && filteredAreas.length"
                      class="area-search-select-menu"
                    >
                      <button
                        v-for="area in filteredAreas.slice(0, 80)"
                        :key="area.id"
                        type="button"
                        class="area-search-select-option"
                        :class="{
                          active: selectedArea && selectedArea.id === area.id,
                        }"
                        @mousedown.prevent="selectAreaFromSearch(area)"
                      >
                        {{ formatAreaListOptionLabel(area) }}
                      </button>
                    </div>
                  </div>
                </label>
              </div>
            </section>
            <article
              v-if="selectedArea || state.areaDraftIsNew"
              class="area-detail"
              :class="{ 'area-detail-wide': state.areaDraftIsNew }"
            >
              <div class="area-editor">
                <div
                  v-if="state.areaBuilderFocus !== true"
                  class="card-head workflow-editor-head"
                >
                  <div class="workflow-section-title">
                    <span class="workflow-step-index">2</span>
                    <div>
                      <h3>Edit Area</h3>
                      <p class="area-detail-subhead">
                        Name the area and choose which group addresses belong to
                        it.
                      </p>
                    </div>
                  </div>
                  <div class="workflow-primary-actions">
                    <button
                      class="secondary-button"
                      type="button"
                      :disabled="state.areaSaving"
                      @click="closeAreaEditor"
                    >
                      Close
                    </button>
                    <button
                      class="primary-button"
                      type="button"
                      :disabled="
                        state.areaSaving ||
                        !String(state.areaDraftName || '').trim()
                      "
                      @click="saveAreaDefinition"
                    >
                      {{ state.areaSaving ? "Saving..." : "Save Area" }}
                    </button>
                    <details v-if="!state.areaDraftIsNew" class="more-actions">
                      <summary>More actions</summary>
                      <div class="more-actions-menu">
                        <button
                          class="secondary-button"
                          type="button"
                          :disabled="state.areaSaving"
                          @click="resetAreaDefinition"
                        >
                          Reset
                        </button>
                        <button
                          class="danger-button"
                          type="button"
                          :disabled="state.areaSaving"
                          @click="deleteAreaDefinition"
                        >
                          Delete Area
                        </button>
                      </div>
                    </details>
                  </div>
                </div>
                <div
                  v-if="state.areaBuilderFocus !== true"
                  class="area-editor-grid"
                >
                  <label class="flow-field">
                    <span>Area name</span>
                    <input
                      v-model="state.areaDraftName"
                      type="text"
                      placeholder="Installer alias"
                      required
                    />
                  </label>
                  <label class="flow-field area-editor-span">
                    <span>Description</span>
                    <textarea
                      v-model="state.areaDraftDescription"
                      rows="3"
                      placeholder="Optional note for diagnostics and reports"
                    />
                  </label>
                </div>
                <div
                  v-if="
                    state.areaDraftIsNew &&
                    !showAiAreaBuilderSection &&
                    state.areaBuilderFocus !== true
                  "
                  class="workflow-assistant-callout"
                >
                  <div>
                    <strong>Need help choosing group addresses?</strong>
                    <p class="area-detail-subhead">
                      Describe the area and let Cerebrum suggest the most
                      relevant KNX group addresses.
                    </p>
                    <span
                      v-if="!nodeInfo.llmEnabled"
                      class="meta-chip workflow-inline-status"
                      >AI disabled</span
                    >
                  </div>
                  <button
                    class="secondary-button"
                    type="button"
                    :disabled="!nodeInfo.llmEnabled"
                    @click="openAiAreaBuilderFocus"
                  >
                    Build with AI
                  </button>
                </div>
                <div
                  v-if="state.areaDraftIsNew && showAiAreaBuilderSection"
                  class="ai-planner-shell area-llm-shell"
                >
                  <div
                    class="ai-planner-shell-head"
                    :class="{
                      'template-builder-focus-head':
                        state.areaBuilderFocus === true,
                    }"
                  >
                    <div>
                      <h4>AI Area Builder</h4>
                      <p class="area-detail-subhead">
                        Describe the room, zone or function you want. The AI
                        will suggest the most relevant group addresses for this
                        draft.
                      </p>
                    </div>
                    <div
                      v-if="state.areaBuilderFocus === true"
                      class="card-head-actions action-cluster"
                    >
                      <button
                        class="secondary-button"
                        type="button"
                        @click="closeAiAreaBuilderFocus"
                      >
                        Close
                      </button>
                    </div>
                  </div>
                  <div class="area-editor-grid">
                    <label class="flow-field area-editor-span">
                      <span>Assistant prompt</span>
                      <textarea
                        v-model="state.areaLlmPrompt"
                        rows="3"
                        placeholder="Example: Add all technical room lighting command and status GA."
                      />
                    </label>
                  </div>
                  <div class="profile-runbar">
                    <button
                      class="primary-button"
                      type="button"
                      :disabled="
                        state.areaLlmBusy ||
                        !state.areaLlmPrompt.trim() ||
                        !nodeInfo.llmEnabled
                      "
                      @click="suggestAreaDraftWithLlm"
                    >
                      <span
                        v-if="state.areaLlmBusy"
                        class="running-spinner run-button-spinner"
                        aria-hidden="true"
                      />
                      {{
                        state.areaLlmBusy
                          ? "Suggesting..."
                          : "Suggest GA with AI"
                      }}
                    </button>
                  </div>
                  <p v-if="state.areaLlmError" class="planner-error-banner">
                    {{ state.areaLlmError }}
                  </p>
                  <p v-if="!nodeInfo.llmEnabled" class="area-detail-subhead">
                    Enable the AI in the Cerebrum node to regenerate areas or
                    suggest GA for a new draft.
                  </p>
                </div>
                <div
                  v-if="state.areaBuilderFocus !== true"
                  class="area-ga-editor"
                >
                  <div>
                    <h4>Selected group addresses</h4>
                    <ul
                      v-if="areaDraftGaDetails.length"
                      class="simple-list simple-list-mono area-ga-list"
                    >
                      <li
                        v-for="item in areaDraftGaDetails"
                        :key="item.ga"
                        class="area-ga-item"
                      >
                        <div class="area-ga-main">
                          <strong>{{ item.ga }}</strong>
                          <span
                            >{{ item.label || "Unlabeled GA"
                            }}<span v-if="item.dpt">
                              | DPT {{ item.dpt }}</span
                            ></span
                          >
                          <span
                            >Access:
                            {{
                              item.readOnly === true
                                ? "Read only"
                                : "Read/write"
                            }}</span
                          >
                        </div>
                        <div class="area-ga-actions">
                          <button
                            class="secondary-button"
                            type="button"
                            @click="removeGaFromAreaDraft(item.ga)"
                          >
                            Remove
                          </button>
                        </div>
                      </li>
                    </ul>
                    <p v-else class="empty-state">
                      No GA selected for this area yet.
                    </p>
                  </div>
                  <div>
                    <div class="card-head">
                      <div>
                        <h4>Available group addresses</h4>
                        <p class="area-detail-subhead">
                          Pick from the ETS catalog. Already selected GA are
                          hidden from this list.
                        </p>
                      </div>
                      <span class="meta-chip">{{
                        state.gaCatalogLoading
                          ? "Loading..."
                          : `${filteredGaCatalog.length} visible`
                      }}</span>
                    </div>
                    <label class="flow-field area-ga-search">
                      <span>Search group addresses</span>
                      <input
                        v-model="state.gaCatalogSearch"
                        type="text"
                        placeholder="Search GA, label or ETS path"
                      />
                    </label>
                    <div class="area-ga-catalog">
                      <button
                        v-for="item in filteredGaCatalog"
                        :key="item.ga"
                        type="button"
                        class="area-list-item"
                        @click="addGaToAreaDraft(item.ga)"
                      >
                        <span class="area-list-title">{{ item.ga }}</span>
                        <span class="area-list-meta">{{
                          item.label || "Unlabeled GA"
                        }}</span>
                        <span class="area-list-tags"
                          >{{ item.hierarchyPath || item.dpt || "" }} | Access:
                          {{
                            item.readOnly === true ? "Read only" : "Read/write"
                          }}</span
                        >
                      </button>
                    </div>
                  </div>
                </div>
                <p
                  v-if="state.areaBuilderFocus !== true"
                  class="area-editor-note"
                >
                  Original ETS path:
                  <strong>{{
                    state.areaDraftIsNew
                      ? "Manual area"
                      : selectedArea.basePath ||
                        selectedArea.path ||
                        selectedArea.name
                  }}</strong>
                </p>
              </div>
            </article>
          </div>
          <p v-else class="empty-state">
            No areas matched the current search or the ETS file does not expose
            a usable hierarchy yet.
          </p>
        </section>

        <section
          v-if="state.activeTab === 'tests'"
          class="card card-profiles"
          :class="{ 'card-results-focus': isViewingTestResultOnly }"
        >
          <div class="card-head workspace-page-head">
            <div>
              <h2>
                {{ isViewingTestResultOnly ? "KNX Test Result" : "KNX Tests" }}
              </h2>
              <p class="area-detail-subhead">
                {{
                  isViewingTestResultOnly
                    ? "Showing only the selected test report."
                    : "Select an area, choose a standard test template, review the generated plan, then save or run it."
                }}
              </p>
            </div>
            <div
              class="workflow-primary-actions"
              v-if="!isViewingTestResultOnly"
            >
              <button
                class="secondary-button new-button"
                type="button"
                :disabled="!suggestedAreas.length"
                @click="startNewAiTestPlan"
              >
                New Plan
              </button>
            </div>
            <div class="workflow-primary-actions" v-else>
              <span class="meta-chip">{{
                testResultModeLabel(selectedTestResult)
              }}</span>
              <button
                class="secondary-button"
                type="button"
                @click="openSourceTestFromSelectedResult"
              >
                Open Source Test
              </button>
              <details class="more-actions">
                <summary>More actions</summary>
                <div class="more-actions-menu">
                  <button
                    class="danger-button"
                    type="button"
                    :disabled="
                      !selectedTestResult ||
                      state.deletingTestResultId === selectedTestResult.id
                    "
                    @click="deleteTestResult(selectedTestResult?.id)"
                  >
                    {{
                      state.deletingTestResultId === selectedTestResult?.id
                        ? "Deleting..."
                        : "Delete"
                    }}
                  </button>
                </div>
              </details>
            </div>
          </div>
          <div v-if="!isViewingTestResultOnly" class="workspace-summary-row">
            <div class="pill-row">
              <span class="pill muted"
                >Area
                {{
                  selectedTestArea
                    ? selectedTestArea.path || selectedTestArea.name
                    : "n/a"
                }}</span
              >
              <span class="pill muted">{{ testPlans.length }} saved plans</span>
            </div>
          </div>
          <section
            v-if="!suggestedAreas.length && !isViewingTestResultOnly"
            class="workflow-section workflow-prerequisite"
          >
            <span class="workflow-step-index">1</span>
            <div>
              <h3>Create a KNX area first</h3>
              <p class="area-detail-subhead">
                Test plans need at least one area with KNX group addresses.
              </p>
            </div>
            <button
              class="secondary-button new-button"
              type="button"
              @click="startNewAreaDraft"
            >
              Create Area
            </button>
          </section>
          <div
            v-else
            class="profiles-layout test-planner-layout"
            :class="{ 'result-only-layout': isViewingTestResultOnly }"
          >
            <div class="profile-editor-stack">
              <article
                v-if="
                  !isViewingTestResultOnly &&
                  !state.testPlanDraft &&
                  !state.testPlanRunning
                "
                class="area-detail planner-sidecard workflow-section"
              >
                <div class="workflow-section-head">
                  <span class="workflow-step-index">1</span>
                  <div>
                    <h3>Select test plan</h3>
                    <p class="area-detail-subhead">
                      Open a saved test plan, or create a new one to start from
                      a standard template.
                    </p>
                  </div>
                </div>
                <div class="area-listbox-shell">
                  <label class="flow-field">
                    <span>Find a saved plan</span>
                    <div class="area-search-select">
                      <input
                        v-model="state.testPlanSearch"
                        class="area-search-select-input"
                        type="text"
                        :placeholder="
                          selectedTestPlan
                            ? formatTestPlanListOptionLabel(selectedTestPlan)
                            : 'Search saved plan...'
                        "
                        @focus="state.testPlanSearchOpen = true"
                        @input="state.testPlanSearchOpen = true"
                        @blur="closeTestPlanSearchSoon"
                      />
                      <div
                        v-if="
                          state.testPlanSearchOpen && filteredTestPlans.length
                        "
                        class="area-search-select-menu"
                      >
                        <button
                          v-for="plan in filteredTestPlans.slice(0, 80)"
                          :key="plan.id"
                          type="button"
                          class="area-search-select-option"
                          :class="{
                            active:
                              selectedTestPlan &&
                              selectedTestPlan.id === plan.id,
                          }"
                          @mousedown.prevent="selectSavedPlanFromSearch(plan)"
                        >
                          {{ formatTestPlanListOptionLabel(plan) }}
                        </button>
                      </div>
                    </div>
                  </label>
                </div>
                <p v-if="!testPlans.length" class="empty-state">
                  No saved plans yet.
                </p>
              </article>

              <article
                v-if="!isViewingTestResultOnly && state.testPlanDraft"
                class="area-detail"
              >
                <div
                  v-if="state.testTemplateBuilderFocus !== true"
                  class="card-head workflow-editor-head"
                >
                  <div>
                    <h3>{{ state.testPlanDraft?.name || "Plan Draft" }}</h3>
                    <p class="area-detail-subhead">
                      Review the plan, then save it or run it on the KNX bus.
                    </p>
                  </div>
                  <div class="workflow-primary-actions">
                    <span v-if="hasUnsavedTestPlanChanges" class="meta-chip"
                      >Unsaved changes</span
                    >
                    <button
                      v-if="!showAiPlannerSection"
                      class="secondary-button"
                      type="button"
                      @click="openTemplateBuilderFocus"
                    >
                      Choose Template
                    </button>
                    <button
                      class="secondary-button"
                      type="button"
                      :disabled="state.testPlanSaving || state.testPlanRunning"
                      @click="closeTestPlanEditor"
                    >
                      Close
                    </button>
                    <details class="more-actions">
                      <summary>More actions</summary>
                      <div class="more-actions-menu">
                        <button
                          class="secondary-button new-button"
                          type="button"
                          @click="startNewAiTestPlan"
                        >
                          New Plan
                        </button>
                        <button
                          class="secondary-button"
                          type="button"
                          :disabled="!state.testPlanDraft"
                          @click="duplicateCurrentAiTestPlan"
                        >
                          Duplicate Plan
                        </button>
                        <button
                          class="danger-button"
                          type="button"
                          :disabled="
                            state.testPlanDeleting || !selectedTestPlan
                          "
                          @click="deleteAiTestPlanDefinition"
                        >
                          {{
                            state.testPlanDeleting ? "Deleting..." : "Delete"
                          }}
                        </button>
                      </div>
                    </details>
                  </div>
                </div>

                <div v-if="showAiPlannerSection" class="ai-planner-shell">
                  <div
                    class="ai-planner-shell-head"
                    :class="{
                      'template-builder-focus-head':
                        state.testTemplateBuilderFocus === true,
                    }"
                  >
                    <div class="workflow-section-title">
                      <span class="workflow-step-index">1</span>
                      <div>
                        <h4>Choose area and template</h4>
                        <p class="area-detail-subhead">
                          Select one of the standard templates. The plan is
                          built only from the command GA available in the
                          selected area.
                        </p>
                      </div>
                    </div>
                    <div
                      v-if="state.testTemplateBuilderFocus === true"
                      class="card-head-actions action-cluster"
                    >
                      <button
                        class="secondary-button"
                        type="button"
                        @click="closeTemplateBuilderFocus"
                      >
                        Close
                      </button>
                    </div>
                  </div>
                  <div class="area-editor-grid">
                    <label class="flow-field">
                      <span>Area to test</span>
                      <select v-model="state.testAreaSelectedId">
                        <option
                          v-for="area in suggestedAreas"
                          :key="area.id"
                          :value="area.id"
                        >
                          {{ area.path || area.name }}
                        </option>
                      </select>
                    </label>
                    <label class="flow-field area-editor-span">
                      <span>Selected template</span>
                      <textarea
                        :value="
                          state.testPlanPrompt ||
                          'Select one of the templates below.'
                        "
                        rows="4"
                        readonly
                      />
                    </label>
                  </div>

                  <div class="preset-row compact-preset-row">
                    <button
                      v-for="preset in TEST_PROMPT_PRESETS"
                      :key="preset.id"
                      class="preset-button"
                      type="button"
                      :class="{
                        active: state.testPlanPrompt === preset.prompt,
                      }"
                      @click="applyTestPromptPreset(preset)"
                    >
                      {{ preset.title }}
                    </button>
                  </div>
                  <p class="area-detail-subhead">
                    {{
                      (
                        TEST_PROMPT_PRESETS.find(
                          (item) => item.prompt === state.testPlanPrompt,
                        ) || {}
                      ).description ||
                      "Choose a template to see what the deterministic builder will do in the selected area."
                    }}
                  </p>

                  <div class="profile-runbar">
                    <button
                      class="primary-button"
                      type="button"
                      :disabled="
                        state.testPlanGenerating ||
                        !selectedTestArea ||
                        !state.testPlanPrompt.trim()
                      "
                      @click="generateAiTestPlan"
                    >
                      <span
                        v-if="state.testPlanGenerating"
                        class="running-spinner run-button-spinner"
                        aria-hidden="true"
                      />
                      {{
                        state.testPlanGenerating
                          ? "Building..."
                          : "Build Test Plan"
                      }}
                    </button>
                  </div>

                  <p
                    v-if="state.testPlanGenerationError"
                    class="planner-error-banner"
                  >
                    {{ state.testPlanGenerationError }}
                  </p>

                  <div
                    v-if="state.testPlanGeneration"
                    class="planner-generation"
                  >
                    <p
                      v-if="!state.testPlanGeneration.error"
                      class="area-detail-subhead"
                    >
                      Built with
                      {{
                        state.testPlanGeneration.provider ||
                        "deterministic builder"
                      }}.
                    </p>
                    <p
                      v-if="state.testPlanGeneration.error"
                      class="area-detail-subhead"
                    >
                      {{ state.testPlanGeneration.error }}
                    </p>
                  </div>
                </div>
              </article>

              <article
                v-if="state.testPlanRunning && !isViewingTestResultOnly"
                class="area-detail planner-run-focus"
              >
                <div class="card-head">
                  <div>
                    <h3 class="running-headline">
                      <span class="running-spinner" aria-hidden="true" />
                      <span>Test Running</span>
                    </h3>
                    <p class="area-detail-subhead">
                      {{
                        currentRunningStep?.title || "Executing current step..."
                      }}
                    </p>
                  </div>
                  <span class="meta-chip">{{
                    testPlanReport?.metrics?.totalSteps
                      ? `${Number(testPlanReport.steps?.length || 0)}/${Number(testPlanReport.metrics.totalSteps || 0)}`
                      : "in progress"
                  }}</span>
                </div>
                <div class="metric-grid area-metrics">
                  <article class="metric">
                    <span>Completed</span>
                    <strong>{{
                      Number(testPlanReport?.steps?.length || 0)
                    }}</strong>
                  </article>
                  <article class="metric">
                    <span>Pass</span>
                    <strong>{{
                      Number(testPlanReport?.metrics?.pass || 0)
                    }}</strong>
                  </article>
                  <article class="metric">
                    <span>Warn</span>
                    <strong>{{
                      Number(testPlanReport?.metrics?.warn || 0)
                    }}</strong>
                  </article>
                  <article class="metric">
                    <span>Fail</span>
                    <strong>{{
                      Number(testPlanReport?.metrics?.fail || 0)
                    }}</strong>
                  </article>
                </div>
                <div
                  v-if="currentRunningStep"
                  class="report-check report-pass planner-step-card planner-step-running"
                >
                  <div class="anomaly-head">
                    <strong>{{
                      currentRunningStep.title || currentRunningStep.id
                    }}</strong>
                    <span>{{ currentRunningStep.kind }}</span>
                  </div>
                  <p class="area-detail-subhead">
                    {{
                      currentRunningStep.description ||
                      "Current step in execution."
                    }}
                  </p>
                  <div
                    v-if="currentRunningStep.kind === 'wait'"
                    class="planner-step-grid"
                  >
                    <span
                      ><strong>Wait</strong>
                      {{ Number(currentRunningStep.delayMs || 0) }} ms</span
                    >
                    <span
                      ><strong>Reason</strong>
                      {{
                        currentRunningStep.reason || "Pause before next action"
                      }}</span
                    >
                  </div>
                  <div v-else class="planner-step-grid">
                    <span
                      ><strong>Command</strong>
                      {{ currentRunningStep.commandGA || "n/a" }}</span
                    >
                    <span
                      ><strong>Status GA</strong>
                      {{ currentRunningStep.statusGA || "n/a" }}</span
                    >
                    <span
                      ><strong>Payload</strong>
                      {{
                        displayPayloadLabelForDpt(
                          currentRunningStep.commandPayload,
                          currentRunningStep.commandDPT,
                        )
                      }}</span
                    >
                    <span
                      ><strong>Expected</strong>
                      {{
                        displayPayloadLabelForDpt(
                          currentRunningStep.expectedPayload,
                          currentRunningStep.statusDPT ||
                            currentRunningStep.commandDPT,
                        )
                      }}</span
                    >
                  </div>
                  <div
                    v-if="
                      currentRunningStep.kind !== 'wait' &&
                      currentRunningStep.statusGA
                    "
                    class="planner-check-sections"
                  >
                    <section class="planner-check-section">
                      <h4>Spontaneous Write From Status GA</h4>
                      <div class="planner-step-grid compact-grid">
                        <span
                          ><strong>Status GA</strong>
                          {{ currentRunningStep.statusGA || "n/a" }}</span
                        >
                        <span
                          ><strong>Timeout</strong>
                          {{
                            Number(currentRunningStep.statusWriteTimeoutMs || 0)
                          }}
                          ms</span
                        >
                      </div>
                    </section>
                    <section class="planner-check-section">
                      <h4>Active Read Request To Status GA</h4>
                      <div class="planner-step-grid compact-grid">
                        <span
                          ><strong>Status GA</strong>
                          {{ currentRunningStep.statusGA || "n/a" }}</span
                        >
                        <span
                          ><strong>Timeout</strong>
                          {{
                            Number(
                              currentRunningStep.statusResponseTimeoutMs || 0,
                            )
                          }}
                          ms</span
                        >
                      </div>
                    </section>
                  </div>
                </div>
              </article>

              <article
                ref="testPlanReportRef"
                class="area-detail"
                v-if="selectedTestResult && isViewingTestResultOnly"
              >
                <div class="card-head">
                  <div>
                    <h3>{{ testResultDisplayName(selectedTestResult) }}</h3>
                    <p class="area-detail-subhead">
                      {{
                        testResultAreaText(selectedTestResult) ||
                        formatDateTime(selectedTestResult.generatedAt)
                      }}
                    </p>
                  </div>
                  <div class="card-head-actions action-cluster">
                    <span class="meta-chip">{{
                      testResultModeLabel(selectedTestResult)
                    }}</span>
                    <span
                      v-if="selectedTestResult.live === true"
                      class="meta-chip"
                    >
                      <span
                        class="running-spinner run-chip-spinner"
                        aria-hidden="true"
                      />
                      <span>Running</span>
                    </span>
                    <span class="meta-chip">{{
                      selectedTestResult.overallStatus
                    }}</span>
                    <button
                      class="secondary-button"
                      type="button"
                      @click="exportSelectedTestResultPdf"
                    >
                      Export PDF
                    </button>
                  </div>
                </div>
                <div class="metric-grid area-metrics">
                  <article
                    v-for="metric in testResultMetricCards(selectedTestResult)"
                    :key="metric.label"
                    class="metric"
                  >
                    <span>{{ metric.label }}</span>
                    <strong>{{ metric.value }}</strong>
                  </article>
                </div>
                <div class="report-checks">
                  <article
                    v-for="entry in testResultEntries(selectedTestResult)"
                    :key="entry.id"
                    class="report-check"
                    :class="`report-${entry.status}`"
                  >
                    <div class="anomaly-head">
                      <strong>{{ entry.title }}</strong>
                      <span>{{ entry.status }}</span>
                    </div>
                    <p class="area-detail-subhead">
                      {{ entry.message || "No additional details available." }}
                    </p>
                    <div
                      v-if="entry.detailGroups?.length"
                      class="planner-check-sections result-check-sections"
                    >
                      <section
                        v-for="group in entry.detailGroups"
                        :key="`${entry.id}-${group.title}`"
                        class="planner-check-section"
                      >
                        <h4>{{ group.title }}</h4>
                        <div class="planner-step-grid compact-grid">
                          <span
                            v-for="detail in group.items"
                            :key="`${entry.id}-${group.title}-${detail.label}`"
                            ><strong>{{ detail.label }}</strong>
                            {{ detail.value }}</span
                          >
                        </div>
                      </section>
                    </div>
                    <div v-else class="planner-step-grid">
                      <span
                        v-for="detail in entry.details"
                        :key="`${entry.id}-${detail.label}`"
                        ><strong>{{ detail.label }}</strong>
                        {{ detail.value }}</span
                      >
                    </div>
                  </article>
                </div>
                <p
                  v-if="!testResultEntries(selectedTestResult).length"
                  class="empty-state"
                >
                  No detailed entries stored for this report yet.
                </p>
                <div v-if="testResultSuggestions(selectedTestResult).length">
                  <h4>Suggestions</h4>
                  <ul class="simple-list">
                    <li
                      v-for="suggestion in testResultSuggestions(
                        selectedTestResult,
                      )"
                      :key="suggestion"
                    >
                      {{ suggestion }}
                    </li>
                  </ul>
                </div>
              </article>

              <article
                class="area-detail plan-draft-shell"
                v-if="
                  state.testPlanDraft &&
                  !state.testPlanRunning &&
                  !isViewingTestResultOnly &&
                  state.testTemplateBuilderFocus !== true
                "
              >
                <div class="card-head">
                  <div class="workflow-section-title">
                    <span class="workflow-step-index">2</span>
                    <div>
                      <h3 class="running-headline">
                        <span>Review the plan</span>
                        <span
                          v-if="state.testPlanGenerating"
                          class="running-spinner"
                          aria-hidden="true"
                        />
                      </h3>
                      <p class="area-detail-subhead">
                        Edit the details and review each KNX action before
                        execution.
                      </p>
                    </div>
                  </div>
                  <div class="card-head-actions action-cluster">
                    <span class="meta-chip"
                      >{{
                        Number(state.testPlanDraft.steps?.length || 0)
                      }}
                      steps</span
                    >
                    <button
                      class="secondary-button"
                      type="button"
                      @click="addManualStepToPlan"
                    >
                      Add Step
                    </button>
                    <button
                      class="secondary-button"
                      type="button"
                      @click="addWaitStepToPlan"
                    >
                      Add Wait
                    </button>
                  </div>
                </div>
                <div class="area-editor-grid">
                  <label class="flow-field">
                    <span>Area</span>
                    <select
                      :value="
                        state.testPlanDraft.areaId ||
                        state.testAreaSelectedId ||
                        ''
                      "
                      :disabled="!suggestedAreas.length"
                      @change="updateDraftTestArea($event.target.value)"
                    >
                      <option value="" disabled>Select area</option>
                      <option
                        v-for="area in suggestedAreas"
                        :key="area.id"
                        :value="area.id"
                      >
                        {{ area.path || area.name }}
                      </option>
                    </select>
                  </label>
                  <label class="flow-field">
                    <span>Plan name</span>
                    <input
                      v-model="state.testPlanDraft.name"
                      type="text"
                      placeholder="KNX active test name"
                    />
                  </label>
                  <label class="flow-field area-editor-span">
                    <span>Description</span>
                    <textarea
                      v-model="state.testPlanDraft.description"
                      rows="2"
                      placeholder="Short operator-facing description"
                    />
                  </label>
                </div>
                <div class="workflow-action-panel">
                  <div class="workflow-section-title">
                    <span class="workflow-step-index">3</span>
                    <div>
                      <h4>Save or run</h4>
                      <p class="area-detail-subhead">
                        Save the plan for reuse, or run it now on the KNX bus.
                      </p>
                    </div>
                  </div>
                  <div class="workflow-primary-actions">
                    <label class="checkbox flow-toggle compact-toggle">
                      <input v-model="state.voiceEnabled" type="checkbox" />
                      <span>Voice</span>
                    </label>
                    <button
                      class="secondary-button"
                      type="button"
                      :disabled="state.testPlanSaving || !state.testPlanDraft"
                      @click="saveAiTestPlanDefinition"
                    >
                      {{ state.testPlanSaving ? "Saving..." : "Save Plan" }}
                    </button>
                    <button
                      v-if="hasDraftSteps"
                      class="secondary-button"
                      type="button"
                      :disabled="
                        (!state.testPlanDraft &&
                          state.testPlanRepeatForever !== true) ||
                        (state.testPlanRunning &&
                          state.testPlanRepeatForever !== true) ||
                        state.testPlanRepeatStopRequested === true
                      "
                      @click="
                        state.testPlanRepeatForever === true
                          ? stopRepeatingTestPlan()
                          : openRepeatTestPlanConfirm()
                      "
                    >
                      {{
                        state.testPlanRepeatForever === true
                          ? state.testPlanRepeatStopRequested === true
                            ? "Stopping..."
                            : "Stop Repeat"
                          : "Repeat Forever"
                      }}
                    </button>
                    <button
                      v-if="hasDraftSteps"
                      class="primary-button"
                      type="button"
                      :disabled="state.testPlanRunning || !state.testPlanDraft"
                      @click="openRunTestPlanConfirm"
                    >
                      <span
                        v-if="state.testPlanRunning"
                        class="running-spinner run-button-spinner"
                        aria-hidden="true"
                      />
                      <span>{{
                        state.testPlanRunning ? "Running..." : "Run Plan"
                      }}</span>
                    </button>
                  </div>
                </div>
                <div class="report-checks plan-steps-stack">
                  <article
                    v-for="(step, index) in state.testPlanDraft.steps || []"
                    :key="step.id"
                    class="report-check report-pass planner-step-card"
                    :class="{
                      'planner-step-running':
                        state.testPlanRunning &&
                        state.testPlanRunningStepId === step.id,
                      'planner-step-dragging':
                        state.draggedTestPlanStepId === step.id,
                      'planner-step-drop-target':
                        state.dragOverTestPlanStepId === step.id,
                    }"
                    @dragenter.prevent="onPlanStepDragEnter(step.id)"
                    @dragover.prevent
                    @drop="onPlanStepDrop(step.id, $event)"
                  >
                    <div class="anomaly-head">
                      <div class="planner-step-title">
                        <button
                          class="drag-handle"
                          type="button"
                          draggable="true"
                          tabindex="-1"
                          aria-label="Drag step"
                          title="Drag step"
                          @dragstart="onPlanStepDragStart(step.id, $event)"
                          @dragend="clearDraggedPlanStepState"
                        >
                          ⋮⋮
                        </button>
                        <button
                          class="collapse-toggle"
                          type="button"
                          :aria-expanded="step.collapsed !== true"
                          :title="
                            step.collapsed === true
                              ? 'Expand step'
                              : 'Collapse step'
                          "
                          @click="togglePlanStepCollapsed(step)"
                        >
                          <span
                            class="collapse-icon"
                            :class="{ collapsed: step.collapsed === true }"
                            >▾</span
                          >
                        </button>
                        <strong>{{ step.title || step.id }}</strong>
                      </div>
                      <div
                        class="card-head-actions action-cluster compact-actions"
                      >
                        <span>{{ step.kind }}</span>
                        <button
                          class="secondary-button"
                          type="button"
                          @click="duplicatePlanStep(index)"
                        >
                          Duplicate
                        </button>
                        <button
                          class="secondary-button"
                          type="button"
                          @click="removePlanStep(index)"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                    <div
                      v-if="step.collapsed === true"
                      class="planner-step-summary"
                    >
                      <span v-if="step.kind === 'wait'"
                        ><strong>Wait</strong>
                        {{ Number(step.delayMs || 0) }} ms</span
                      >
                      <span v-else
                        ><strong>Command</strong>
                        {{ step.commandGA || "n/a" }}</span
                      >
                      <span v-if="step.kind !== 'wait'"
                        ><strong>Status GA</strong>
                        {{ step.statusGA || "n/a" }}</span
                      >
                      <span v-if="step.kind !== 'wait'"
                        ><strong>Payload</strong>
                        {{
                          displayPayloadLabelForDpt(
                            step.commandPayload,
                            step.commandDPT,
                          )
                        }}</span
                      >
                      <span v-if="step.kind !== 'wait' && step.statusGA"
                        ><strong>Write timeout</strong>
                        {{ Number(step.statusWriteTimeoutMs || 0) }} ms</span
                      >
                      <span v-if="step.kind !== 'wait' && step.statusGA"
                        ><strong>Response timeout</strong>
                        {{ Number(step.statusResponseTimeoutMs || 0) }} ms</span
                      >
                    </div>
                    <div v-else class="planner-step-editor">
                      <label class="flow-field">
                        <span>Title</span>
                        <input
                          v-model="step.title"
                          type="text"
                          placeholder="Step title"
                        />
                      </label>
                      <label class="flow-field area-editor-span">
                        <span>Description</span>
                        <textarea
                          v-model="step.description"
                          rows="2"
                          placeholder="What this step checks"
                        />
                      </label>
                      <label v-if="step.kind === 'wait'" class="flow-field">
                        <span>Wait ms</span>
                        <input
                          v-model.number="step.delayMs"
                          type="number"
                          min="0"
                          max="30000"
                          step="100"
                        />
                      </label>
                      <section
                        v-if="step.kind !== 'wait'"
                        class="planner-field-group area-editor-span"
                      >
                        <h4>Command</h4>
                        <div class="planner-field-group-grid">
                          <label class="flow-field">
                            <span>Command GA</span>
                            <select
                              v-model="step.commandGA"
                              @change="refreshDraftStepFromCatalog(step)"
                            >
                              <option value="">Select command GA</option>
                              <option
                                v-for="item in plannerCommandOptions"
                                :key="item.ga"
                                :value="item.ga"
                              >
                                {{ `${item.ga} | ${item.label}` }}
                              </option>
                            </select>
                          </label>
                          <label class="flow-field">
                            <span>Command DPT</span>
                            <input
                              v-model="step.commandDPT"
                              type="text"
                              placeholder="1.001"
                              @change="ensureStepPayloadFitsDpt(step)"
                            />
                          </label>
                          <label class="flow-field group-span">
                            <span>Command payload</span>
                            <select
                              v-if="dptValueOptions(step.commandDPT).length"
                              v-model="step.commandPayload"
                            >
                              <option
                                v-for="option in dptValueOptions(
                                  step.commandDPT,
                                )"
                                :key="`${step.id}-command-${option.value}`"
                                :value="String(option.value)"
                              >
                                {{ option.label }}
                              </option>
                            </select>
                            <input
                              v-else
                              v-model="step.commandPayload"
                              type="text"
                              placeholder="true, false, 50"
                            />
                          </label>
                        </div>
                      </section>
                      <section
                        v-if="step.kind !== 'wait'"
                        class="planner-field-group area-editor-span"
                      >
                        <h4>Status</h4>
                        <div class="planner-field-group-grid">
                          <label class="flow-field group-span">
                            <span>Status GA</span>
                            <select
                              v-model="step.statusGA"
                              @change="refreshDraftStepFromCatalog(step)"
                            >
                              <option value="">No feedback</option>
                              <option
                                v-for="item in plannerStatusOptions"
                                :key="item.ga"
                                :value="item.ga"
                              >
                                {{ `${item.ga} | ${item.label}` }}
                              </option>
                            </select>
                          </label>
                          <label class="flow-field">
                            <span>Status DPT</span>
                            <input
                              v-model="step.statusDPT"
                              type="text"
                              placeholder="1.001"
                              @change="ensureStepPayloadFitsDpt(step)"
                            />
                          </label>
                          <label class="flow-field">
                            <span>Expected payload</span>
                            <select
                              v-if="
                                dptValueOptions(
                                  step.statusDPT || step.commandDPT,
                                ).length
                              "
                              v-model="step.expectedPayload"
                            >
                              <option
                                v-for="option in dptValueOptions(
                                  step.statusDPT || step.commandDPT,
                                )"
                                :key="`${step.id}-expected-${option.value}`"
                                :value="String(option.value)"
                              >
                                {{ option.label }}
                              </option>
                            </select>
                            <input
                              v-else
                              v-model="step.expectedPayload"
                              type="text"
                              placeholder="Expected feedback value"
                            />
                          </label>
                        </div>
                      </section>
                      <div
                        v-if="step.kind !== 'wait' && step.statusGA"
                        class="planner-check-sections editor-check-sections area-editor-span"
                      >
                        <section class="planner-check-section">
                          <h4>Spontaneous Write From Status GA</h4>
                          <p class="area-detail-subhead">
                            Wait for a spontaneous
                            <code>GroupValue_Write</code> telegram from the
                            status GA.
                          </p>
                          <label class="flow-field">
                            <span>Status write timeout ms</span>
                            <input
                              v-model.number="step.statusWriteTimeoutMs"
                              type="number"
                              min="500"
                              max="60000"
                              step="100"
                            />
                          </label>
                        </section>
                        <section class="planner-check-section">
                          <h4>Active Read Request To Status GA</h4>
                          <p class="area-detail-subhead">
                            Send a <code>read</code> telegram to the status GA
                            and wait for a <code>GroupValue_Response</code>.
                          </p>
                          <label class="flow-field">
                            <span>Read response timeout ms</span>
                            <input
                              v-model.number="step.statusResponseTimeoutMs"
                              type="number"
                              min="500"
                              max="60000"
                              step="100"
                            />
                          </label>
                        </section>
                      </div>
                      <label class="flow-field area-editor-span">
                        <span>Reason</span>
                        <input
                          v-model="step.reason"
                          type="text"
                          placeholder="Why this step exists"
                        />
                      </label>
                    </div>
                  </article>
                </div>
              </article>
            </div>
          </div>
        </section>

        <section
          v-if="state.activeTab === 'results'"
          class="card card-profiles"
        >
          <div class="card-head">
            <div>
              <h2>KNX Test Results</h2>
              <p class="area-detail-subhead">
                Live and saved reports generated by KNX active and read-only
                tests.
              </p>
            </div>
            <div class="card-head-actions">
              <span class="meta-chip"
                >{{ sidebarTestResults.length }} available</span
              >
            </div>
          </div>
          <div class="profiles-layout results-page-layout">
            <article class="area-detail planner-sidecard">
              <div class="card-head">
                <div>
                  <h3>Select Test Result</h3>
                  <p class="area-detail-subhead">
                    Choose a report to inspect metrics, detailed checks, and
                    suggestions.
                  </p>
                </div>
              </div>
              <div class="sidebar-results-list results-page-list">
                <div
                  v-for="report in sidebarTestResults"
                  :key="report.id"
                  class="sidebar-result-row"
                >
                  <button
                    type="button"
                    class="area-list-item sidebar-result-item"
                    :class="{
                      active:
                        selectedTestResult &&
                        selectedTestResult.id === report.id,
                      running: report.live === true,
                    }"
                    @click="
                      focusTestResult(report.id, {
                        openMenu: false,
                        activateResultsTab: true,
                        resultOnly: true,
                      })
                    "
                  >
                    <span class="sidebar-result-head">
                      <strong class="sidebar-result-title">
                        <span
                          v-if="report.live === true"
                          class="running-spinner"
                          aria-hidden="true"
                        />
                        <span>{{ testResultDisplayName(report) }}</span>
                      </strong>
                      <span
                        class="sidebar-result-status"
                        :class="`status-${report.overallStatus || 'pass'}`"
                        >{{ report.overallStatus || "n/a" }}</span
                      >
                    </span>
                    <span class="area-list-meta"
                      >{{ testResultModeLabel(report)
                      }}<span v-if="report.live === true">
                        | running</span
                      ></span
                    >
                    <span class="area-list-tags">{{
                      testResultAreaText(report) ||
                      formatDateTime(report.generatedAt)
                    }}</span>
                    <span class="area-list-tags">{{
                      formatDateTime(report.generatedAt)
                    }}</span>
                  </button>
                  <button
                    class="sidebar-result-delete-button"
                    type="button"
                    :disabled="state.deletingTestResultId === report.id"
                    @click.stop="deleteTestResult(report.id)"
                  >
                    {{
                      state.deletingTestResultId === report.id
                        ? "Deleting..."
                        : "Delete"
                    }}
                  </button>
                </div>
                <p
                  v-if="!sidebarTestResults.length"
                  class="empty-state sidebar-empty-state"
                >
                  No saved test results yet.
                </p>
              </div>
            </article>

            <article
              ref="testPlanReportRef"
              class="area-detail"
              v-if="selectedTestResult"
            >
              <div class="card-head">
                <div>
                  <h3>{{ testResultDisplayName(selectedTestResult) }}</h3>
                  <p class="area-detail-subhead">
                    {{
                      testResultAreaText(selectedTestResult) ||
                      formatDateTime(selectedTestResult.generatedAt)
                    }}
                  </p>
                </div>
                <div class="card-head-actions action-cluster">
                  <span class="meta-chip">{{
                    testResultModeLabel(selectedTestResult)
                  }}</span>
                  <span
                    v-if="selectedTestResult.live === true"
                    class="meta-chip"
                  >
                    <span
                      class="running-spinner run-chip-spinner"
                      aria-hidden="true"
                    />
                    <span>Running</span>
                  </span>
                  <span class="meta-chip">{{
                    selectedTestResult.overallStatus
                  }}</span>
                  <button
                    class="secondary-button"
                    type="button"
                    @click="exportSelectedTestResultPdf"
                  >
                    Export PDF
                  </button>
                  <button
                    class="danger-button"
                    type="button"
                    :disabled="
                      !selectedTestResult ||
                      state.deletingTestResultId === selectedTestResult.id
                    "
                    @click="deleteTestResult(selectedTestResult?.id)"
                  >
                    {{
                      state.deletingTestResultId === selectedTestResult?.id
                        ? "Deleting..."
                        : "Delete"
                    }}
                  </button>
                  <button
                    class="secondary-button"
                    type="button"
                    @click="openSourceTestFromSelectedResult"
                  >
                    Open Source Test
                  </button>
                </div>
              </div>
              <div class="metric-grid area-metrics">
                <article
                  v-for="metric in testResultMetricCards(selectedTestResult)"
                  :key="metric.label"
                  class="metric"
                >
                  <span>{{ metric.label }}</span>
                  <strong>{{ metric.value }}</strong>
                </article>
              </div>
              <div class="report-checks">
                <article
                  v-for="entry in testResultEntries(selectedTestResult)"
                  :key="entry.id"
                  class="report-check"
                  :class="`report-${entry.status}`"
                >
                  <div class="anomaly-head">
                    <strong>{{ entry.title }}</strong>
                    <span>{{ entry.status }}</span>
                  </div>
                  <p class="area-detail-subhead">
                    {{ entry.message || "No additional details available." }}
                  </p>
                  <div
                    v-if="entry.detailGroups?.length"
                    class="planner-check-sections result-check-sections"
                  >
                    <section
                      v-for="group in entry.detailGroups"
                      :key="`${entry.id}-${group.title}`"
                      class="planner-check-section"
                    >
                      <h4>{{ group.title }}</h4>
                      <div class="planner-step-grid compact-grid">
                        <span
                          v-for="detail in group.items"
                          :key="`${entry.id}-${group.title}-${detail.label}`"
                          ><strong>{{ detail.label }}</strong>
                          {{ detail.value }}</span
                        >
                      </div>
                    </section>
                  </div>
                  <div v-else class="planner-step-grid">
                    <span
                      v-for="detail in entry.details"
                      :key="`${entry.id}-${detail.label}`"
                      ><strong>{{ detail.label }}</strong>
                      {{ detail.value }}</span
                    >
                  </div>
                </article>
              </div>
              <p
                v-if="!testResultEntries(selectedTestResult).length"
                class="empty-state"
              >
                No detailed entries stored for this report yet.
              </p>
              <div v-if="testResultSuggestions(selectedTestResult).length">
                <h4>Suggestions</h4>
                <ul class="simple-list">
                  <li
                    v-for="suggestion in testResultSuggestions(
                      selectedTestResult,
                    )"
                    :key="suggestion"
                  >
                    {{ suggestion }}
                  </li>
                </ul>
              </div>
            </article>

            <article v-else class="area-detail">
              <p class="empty-state">No test result selected.</p>
            </article>
          </div>
        </section>

        <section v-if="state.activeTab === 'overview'" class="card">
          <div class="card-head">
            <h2>Top Group Addresses</h2>
            <span class="meta-chip">{{ topGroups.length }} visible</span>
          </div>
          <ul v-if="topGroups.length" class="rank-list">
            <li v-for="entry in topGroups" :key="entry.ga" class="rank-row">
              <span class="rank-title">{{ entry.ga }}</span>
              <span class="rank-label">{{ entry.label || "Unlabeled" }}</span>
              <strong>{{ Number(entry.count || 0) }}</strong>
            </li>
          </ul>
          <p v-else class="empty-state">
            No top group address data available yet.
          </p>
        </section>

        <section v-if="state.activeTab === 'overview'" class="card">
          <div class="card-head">
            <h2>Event Mix</h2>
            <span class="meta-chip">{{ eventEntries.length }} event types</span>
          </div>
          <ul v-if="eventEntries.length" class="event-list">
            <li
              v-for="eventEntry in eventEntries"
              :key="eventEntry.name"
              class="event-row"
            >
              <span class="event-name">{{ eventEntry.name }}</span>
              <div class="event-bar">
                <span
                  class="event-bar-fill"
                  :style="{
                    width: `${Math.max((eventEntry.count / maxEventCount) * 100, 6)}%`,
                  }"
                />
              </div>
              <strong>{{ eventEntry.count }}</strong>
            </li>
          </ul>
          <p v-else class="empty-state">
            Event distribution will appear after the first samples.
          </p>
        </section>

        <section v-if="state.activeTab === 'overview'" class="card card-bus">
          <div class="card-head">
            <h2>Bus Connection Persistence</h2>
            <span v-if="busConnection" class="meta-chip">{{
              String(busConnection.currentState || "unknown")
            }}</span>
          </div>
          <template v-if="busConnection">
            <div class="pill-row">
              <span class="pill success"
                >Connected
                {{
                  formatDurationCompact(busConnection.connectedSec || 0)
                }}</span
              >
              <span class="pill danger"
                >Disconnected
                {{
                  formatDurationCompact(busConnection.disconnectedSec || 0)
                }}</span
              >
              <span class="pill muted"
                >Coverage
                {{ Number(busConnection.knownCoveragePct || 0) }}%</span
              >
            </div>
            <div class="bus-track">
              <span
                v-for="segment in busSegments"
                :key="segment.key"
                class="bus-segment"
                :class="segment.className"
                :style="{ left: segment.left, width: segment.width }"
                :title="segment.title"
              />
            </div>
            <div class="bus-scale">
              <span>{{ formatClockLabel(busConnection.windowStartAt) }}</span>
              <span>{{ formatClockLabel(busConnection.windowEndAt) }}</span>
              <span>Now</span>
            </div>
            <p class="bus-note">
              Green shows time connected to the KNX bus. Red shows downtime
              inside the selected history window.
            </p>
          </template>
          <p v-else class="empty-state">
            Waiting for connection persistence data...
          </p>
        </section>

        <section
          v-if="state.activeTab === 'overview'"
          ref="flowCardRef"
          class="card card-flow"
          :class="{ 'is-fullscreen': isFlowFullscreen }"
        >
          <div class="card-head">
            <h2>Flow Map</h2>
            <div class="card-head-actions">
              <span class="meta-chip">
                Nodes {{ flowGraph.nodes.length }} | Links
                {{ flowGraph.edges.length }}
              </span>
              <button
                class="secondary-button"
                type="button"
                @click="toggleFlowFullscreen"
              >
                {{ isFlowFullscreen ? "Exit Fullscreen" : "Fullscreen" }}
              </button>
            </div>
          </div>
          <div class="flow-toolbar">
            <label class="flow-field">
              <span>Max nodes</span>
              <input
                v-model.number="state.flowMaxNodes"
                type="number"
                min="4"
                max="32"
                step="1"
              />
            </label>
            <label class="flow-field flow-field-search">
              <span>Find GA</span>
              <input
                v-model="state.flowSearch"
                type="text"
                placeholder="Search GA or label"
              />
            </label>
            <div class="flow-field flow-field-select">
              <span>Select Nodes to Filter by</span>
              <select v-model="state.flowSelectedGa" multiple size="5">
                <option
                  v-for="node in flowSelectableNodes"
                  :key="node.id"
                  :value="node.id"
                >
                  {{
                    `${node.id}${node.subtitle ? ` | ${node.subtitle}` : ""}`
                  }}
                </option>
              </select>
              <label class="checkbox flow-toggle flow-toggle-inline">
                <input v-model="state.flowShowUniversalNodes" type="checkbox" />
                <span>Show Universal Mode nodes</span>
              </label>
            </div>
            <div class="flow-legend">
              <span><i class="legend-line legend-write" />Write</span>
              <span><i class="legend-line legend-response" />Response</span>
              <span><i class="legend-line legend-read" />Read</span>
              <span><i class="legend-line legend-repeat" />Repeat</span>
              <span><i class="legend-dot legend-anomaly" />Anomaly</span>
              <span><i class="legend-dot legend-external" />External</span>
            </div>
          </div>
          <div class="flow-frame">
            <svg
              v-if="flowGraph.nodes.length"
              class="flow-svg"
              :viewBox="`0 0 ${flowGraph.width} ${flowGraph.height}`"
              preserveAspectRatio="xMidYMid meet"
            >
              <defs>
                <marker
                  v-for="(color, type) in FLOW_EVENT_COLORS"
                  :id="`flow-arrow-${type}`"
                  :key="type"
                  viewBox="0 0 10 8"
                  markerWidth="10"
                  markerHeight="8"
                  refX="8.8"
                  refY="4"
                  orient="auto"
                  markerUnits="userSpaceOnUse"
                >
                  <path d="M0,0 L10,4 L0,8 z" :fill="color" />
                </marker>
              </defs>
              <path
                v-for="edge in flowGraph.edges"
                :key="edge.key"
                class="flow-edge"
                :d="edge.d"
                :stroke="edge.color"
                :stroke-width="edge.width"
                :opacity="edge.opacity"
                :marker-end="`url(#${edge.markerId})`"
                :class="{
                  'flow-edge-active': edge.active,
                  'flow-edge-idle': !edge.active,
                }"
              >
                <title>{{ edge.tooltip }}</title>
              </path>
              <g
                v-for="node in flowGraph.nodes"
                :key="node.id"
                class="flow-node"
                :class="{
                  'is-anomaly': node.anomalyCount > 0,
                  'is-external': !node.inFlow,
                  'is-idle': node.isIdle,
                }"
              >
                <circle :cx="node.x" :cy="node.y" r="24" />
                <text class="node-label" :x="node.x" :y="node.y + 1">
                  {{ node.shortLabel }}
                </text>
                <text
                  v-if="node.shortSubtitle"
                  class="node-subtitle"
                  :x="node.x"
                  :y="node.y + 38"
                >
                  {{ node.shortSubtitle }}
                </text>
                <text
                  v-if="node.shortPayload"
                  class="node-payload"
                  :x="node.x"
                  :y="node.y + 52"
                >
                  {{ node.shortPayload }}
                </text>
                <text
                  v-if="node.anomalyCount > 0"
                  class="node-badge"
                  :x="node.x"
                  :y="node.y - 30"
                >
                  anomaly x{{ node.anomalyCount }}
                </text>
                <title>
                  {{
                    `${node.id}${node.subtitle ? ` | ${node.subtitle}` : ""}${node.payload ? ` | payload: ${node.payload}` : ""}`
                  }}
                </title>
              </g>
            </svg>
            <p v-else class="empty-state flow-empty">
              No topology data available yet.
            </p>
          </div>
          <p class="flow-note">
            Window {{ flowGraph.telemetryWindowSec || 0 }}s.
          </p>
        </section>

        <section
          v-if="state.activeTab === 'overview'"
          class="card card-anomalies"
        >
          <div class="card-head">
            <h2>Anomalies</h2>
            <span class="meta-chip">{{ anomalies.length }} recent</span>
          </div>
          <div v-if="anomalies.length" class="anomaly-list">
            <article
              v-for="entry in anomalies.slice(0, 20)"
              :key="`${entry.at}-${normalizeAnomalyPayload(entry).ga || ''}`"
              class="anomaly-card"
            >
              <div class="anomaly-head">
                <strong>{{
                  normalizeAnomalyPayload(entry).type || "anomaly"
                }}</strong>
                <span>{{ normalizeAnomalyPayload(entry).ga || "no GA" }}</span>
              </div>
              <p class="anomaly-time">{{ entry.at || "" }}</p>
              <pre>{{
                JSON.stringify(normalizeAnomalyPayload(entry), null, 2)
              }}</pre>
            </article>
          </div>
          <p v-else class="empty-state">No anomalies detected right now.</p>
        </section>

        <CerebrumBrain
          v-if="state.activeTab === 'cerebrum' && state.cerebrumTab === 'brain'"
          class="cerebrum-brain-home"
          :sections="cerebrumSections"
          :language="uiLanguage"
          @navigate="activateCerebrumTab"
        />

        <section
          v-if="
            state.activeTab === 'cerebrum' &&
            state.cerebrumTab === 'conversation'
          "
          class="card card-chat"
        >
          <div class="card-head">
            <h2>Conversation</h2>
            <span class="meta-chip">{{ localizeUiText(nodeInfo.llmEnabled ? 'AI enabled' : 'AI disabled') }}</span>
          </div>
          <div class="chat-log">
            <div v-if="!chatMessages.length && !state.asking" class="chat-welcome" data-cerebrum-localized>
              <span class="chat-welcome-icon"><CerebrumIcon name="brain" /></span>
              <h3>{{ localizeUiText('What would you like to know about your home?') }}</h3>
              <p>{{ localizeUiText('Start a conversation or choose a suggestion below.') }}</p>
            </div>
            <article
              v-for="message in chatMessages"
              :key="message.key"
              class="chat-message"
              :class="`chat-${message.kind}`"
            >
              <div v-if="message.kind === 'assistant'" v-html="message.html" />
              <pre v-else>{{ message.rawText }}</pre>
            </article>
            <article v-if="state.asking" class="chat-message chat-pending">
              <span class="chat-pending-spinner" aria-hidden="true"></span>
              <span>Thinking...</span>
            </article>
          </div>
          <div class="preset-row">
            <button
              v-for="preset in localizedPresetQuestions"
              :key="preset.key"
              class="preset-button"
              type="button"
              :disabled="state.asking || !nodeInfo.llmEnabled"
              @click="sendAsk(preset.text)"
            >
              {{ preset.text }}
            </button>
          </div>
          <div class="ask-row">
            <input
              v-model="state.chatDraft"
              class="ask-input"
              type="text"
              :disabled="state.asking || !nodeInfo.llmEnabled"
              :placeholder="localizeUiText('Ask Cerebrum about your home...')"
              :aria-label="localizeUiText('Message to Cerebrum')"
              @keydown.enter.prevent="sendAsk()"
            />
            <button
              class="primary-button"
              type="button"
              :disabled="state.asking || !nodeInfo.llmEnabled"
              @click="sendAsk()"
            >
              {{ localizeUiText('Send') }}
            </button>
          </div>
        </section>

        <section
          v-if="state.activeTab === 'flowBuilder'"
          class="card card-flow-builder"
        >
          <div class="card-head">
            <h2>Node-RED Flow Builder <span class="beta-badge">BETA</span></h2>
            <span class="meta-chip">{{
              nodeInfo.llmEnabled ? "AI enabled" : "AI disabled"
            }}</span>
          </div>
          <div class="flow-builder-split">
            <div class="flow-builder-pane flow-builder-input">
              <p class="flow-builder-hint">
                Describe the automation in plain language. The AI generates a
                Node-RED flow using KNX Ultimate nodes, the Hue nodes and native
                Function/logic nodes, wired to your imported group addresses.
                Copy the JSON, then in Node-RED use Menu &gt; Import and paste
                it.
              </p>
              <div class="flow-builder-compose">
                <textarea
                  v-model="state.flowBuilderPrompt"
                  class="flow-builder-textarea"
                  rows="6"
                  :disabled="
                    state.flowBuilderGenerating || !nodeInfo.llmEnabled
                  "
                  placeholder="e.g. When the Hue motion sensor in the living room detects movement, switch on the living room light."
                ></textarea>
                <div class="flow-builder-actions">
                  <button
                    class="primary-button"
                    type="button"
                    :disabled="
                      state.flowBuilderGenerating ||
                      !nodeInfo.llmEnabled ||
                      !String(state.flowBuilderPrompt || '').trim()
                    "
                    @click="generateFlow()"
                  >
                    {{
                      state.flowBuilderGenerating
                        ? "Generating..."
                        : "Generate flow"
                    }}
                  </button>
                </div>
              </div>
            </div>

            <div class="flow-builder-pane flow-builder-output">
              <article
                v-if="state.flowBuilderGenerating"
                class="flow-builder-pending"
              >
                <span class="chat-pending-spinner" aria-hidden="true"></span>
                <span>Generating flow...</span>
              </article>

              <article
                v-else-if="state.flowBuilderError"
                class="flow-builder-error"
              >
                <pre>{{ state.flowBuilderError }}</pre>
              </article>

              <div
                v-else-if="state.flowBuilderResult"
                class="flow-builder-result"
              >
                <p
                  v-if="state.flowBuilderResult.notes"
                  class="flow-builder-notes"
                >
                  {{ state.flowBuilderResult.notes }}
                </p>
                <ul
                  v-if="
                    state.flowBuilderResult.warnings &&
                    state.flowBuilderResult.warnings.length
                  "
                  class="flow-builder-warnings"
                >
                  <li
                    v-for="(warn, idx) in state.flowBuilderResult.warnings"
                    :key="idx"
                  >
                    {{ warn }}
                  </li>
                </ul>
                <div class="flow-builder-result-head">
                  <span class="meta-chip"
                    >{{
                      (state.flowBuilderResult.generation &&
                        state.flowBuilderResult.generation.nodeCount) ||
                      0
                    }}
                    nodes</span
                  >
                  <span
                    v-if="
                      state.flowBuilderResult.generation &&
                      state.flowBuilderResult.generation.model
                    "
                    class="meta-chip"
                    >{{ state.flowBuilderResult.generation.model }}</span
                  >
                  <button
                    class="secondary-button"
                    type="button"
                    @click="copyFlowJson()"
                  >
                    {{ state.flowBuilderCopied ? "Copied!" : "Copy JSON" }}
                  </button>
                </div>
                <pre class="flow-builder-json">{{
                  state.flowBuilderResult.flowJson
                }}</pre>
              </div>

              <p v-else class="flow-builder-placeholder">
                The generated flow JSON will appear here.
              </p>
            </div>
          </div>
        </section>

        <section
          v-if="
            state.activeTab === 'settings' ||
            (state.activeTab === 'cerebrum' &&
              !['brain', 'conversation'].includes(state.cerebrumTab))
          "
          class="card card-settings"
        >
          <article
            v-if="state.activeTab === 'settings'"
            class="area-detail settings-panel"
          >
            <div class="card-head settings-panel-head">
              <h2>Import / Export</h2>
              <span class="meta-chip">Complete backup</span>
            </div>
            <p class="area-detail-subhead">
              The backup includes Cerebrum memory, learning, schedules, all event archives and Node-RED migration flows. AI provider API keys are excluded. Other integration credentials are included: keep the backup private.
            </p>
            <div
              class="card-head-actions action-cluster settings-config-actions"
            >
              <button
                class="secondary-button"
                type="button"
                :disabled="!state.selectedNodeId || backupBusy || state.etsAccessSaving"
                @click="exportFullConfig"
              >
                Download ZIP
              </button>
              <button
                class="secondary-button"
                type="button"
                :disabled="!state.selectedNodeId || backupBusy || state.etsAccessSaving"
                @click="triggerConfigImport"
              >
                Restore ZIP
              </button>
            </div>
            <p class="area-detail-subhead">
              Select the ZIP directly to restore Cerebrum. Existing JSON backups are also supported.
            </p>
            <details class="settings-migration-help">
              <summary>Moving to another installation</summary>
              <p class="area-detail-subhead">
                Unzip the archive, install the packages in required-packages.json and import cerebrum-flows.json in the Node-RED editor. Review connections and deploy, then open the imported Cerebrum node and restore the original ZIP. Re-enter your AI provider API key.
              </p>
            </details>
          </article>
          <article v-else-if="state.cerebrumTab === 'automations'" class="area-detail settings-panel">
            <CerebrumAutomationEditor
              :key="state.selectedNodeId"
              :node-id="state.selectedNodeId"
              :request="requestAutomationFiles"
              :translate="localizeUiText"
              :drafts="automationEditorDrafts"
            />
          </article>
          <article
            v-else-if="state.cerebrumTab === 'learning'"
            class="area-detail settings-panel chat-learning-panel"
          >
            <div class="memory-section-toolbar memory-primary-heading">
              <h3>Learned instructions</h3>
              <button class="secondary-button" type="button"
                :disabled="!state.selectedNodeId || chatLearningDirty || state.chatLearningLoading || state.chatLearningSaving || state.chatLearningResetting"
                :title="chatLearningDirty ? localizeUiText('Unsaved changes') : ''"
                @click="loadChatLearningFile()">
                {{ state.chatLearningLoading ? 'Loading...' : 'Refresh' }}
              </button>
            </div>
            <CerebrumSharedInsights
              :key="`${state.selectedNodeId}:instructions`"
              mode="learning"
              instructions-only
              :content="state.chatLearningBaseline"
              :language="uiLanguage"
              :loading="state.chatLearningLoading"
              :error="state.chatLearningError"
            />
            <details class="memory-file-tools">
              <summary>Conversations, observed behaviour and details</summary>
            <CerebrumWorldInsights
              :key="`${state.selectedNodeId}:learning`"
              :node-id="state.selectedNodeId"
              :language="uiLanguage"
              mode="learning"
              :request="requestWorldInsight"
            />
            <div class="memory-section-toolbar">
              <div class="memory-section-heading"><h4>From your conversations</h4>
<div class="chat-learning-meta">
                <span class="meta-chip"
                  >{{ state.chatLearningSessionCount }}
                  <span>channels</span></span
                >
                <span
                  v-if="chatLearningDirty"
                  class="meta-chip chat-learning-dirty"
                  >Unsaved changes</span
                >
              </div>
              </div>
              <button class="secondary-button" type="button"
                :disabled="!state.selectedNodeId || chatLearningDirty || state.chatLearningLoading || state.chatLearningSaving || state.chatLearningResetting"
                :title="chatLearningDirty ? localizeUiText('Unsaved changes') : ''"
                @click="loadChatLearningFile()">
                {{ state.chatLearningLoading ? 'Loading...' : 'Refresh' }}
              </button>
            </div>
            <CerebrumSharedInsights
              :key="`${state.selectedNodeId}:shared-learning`"
              mode="learning"
              :content="state.chatLearningBaseline"
              :language="uiLanguage"
              :loading="state.chatLearningLoading"
              :error="state.chatLearningError"
            />
            </details>
            <details class="memory-file-tools" :open="chatLearningDirty">
              <summary>Advanced files and backups</summary>
              <p class="area-detail-subhead">Full conversations, observations and operations from every channel are retained in the shared archive and included in the full Cerebrum backup. The editor below shows the shared working memory.</p>
              <code v-if="state.chatLearningArchivePath">{{ state.chatLearningArchivePath }}</code>
              <p class="area-detail-subhead" :class="{ 'chat-learning-size-over': chatLearningTooLarge }">
                {{ formatByteSize(chatLearningEditorBytes) }} / {{ formatByteSize(state.chatLearningMaxBytes) }}
              </p>
              <p class="area-detail-subhead">Inspect or edit the saved conversation data. Changes take effect only when saved.</p>
            <div
              class="cerebrum-memory-view-switch"
              role="tablist"
              aria-label="Cerebrum Learning view"
            >
              <button
                class="settings-tab-button"
                :class="{ active: state.chatLearningViewMode === 'native' }"
                type="button"
                role="tab"
                :aria-selected="state.chatLearningViewMode === 'native'"
                @click="state.chatLearningViewMode = 'native'"
              >
                Native file
              </button>
              <button
                class="settings-tab-button"
                :class="{ active: state.chatLearningViewMode === 'simple' }"
                type="button"
                role="tab"
                :aria-selected="state.chatLearningViewMode === 'simple'"
                @click="state.chatLearningViewMode = 'simple'"
              >
                Simplified text
              </button>
              <span class="cerebrum-memory-view-hint">
                {{
                  state.chatLearningViewMode === "simple"
                    ? "Readable overview · read-only"
                    : "Editable native file"
                }}
              </span>
            </div>
            <label class="flow-field chat-learning-path-field">
              <span>File path</span>
              <code>{{
                state.chatLearningPath || "Loading Cerebrum Learning..."
              }}</code>
            </label>
            <textarea
              v-if="state.chatLearningViewMode === 'native'"
              v-model="state.chatLearningContent"
              class="chat-learning-editor"
              :disabled="
                state.chatLearningLoading ||
                state.chatLearningSaving ||
                state.chatLearningResetting ||
                !state.selectedNodeId
              "
              spellcheck="false"
              aria-label="Cerebrum Learning native file"
            />
            <pre
              v-else
              class="cerebrum-memory-simple-view chat-learning-simple-view"
              tabindex="0"
              role="document"
              aria-label="Simplified Cerebrum Learning, read-only"
              >{{ chatLearningSimpleView }}</pre
            >
            <p
              v-if="
                state.chatLearningViewMode === 'simple' && chatLearningViewError
              "
              class="error-banner chat-learning-error"
              role="alert"
            >
              {{ chatLearningViewError }} Switch to Native file to correct it.
            </p>
            <p
              v-if="state.chatLearningError"
              class="error-banner chat-learning-error"
              role="alert"
            >
              {{ state.chatLearningError }}
            </p>
            <div class="card-head-actions action-cluster chat-learning-actions">
              <button
                class="secondary-button"
                type="button"
                :disabled="
                  !state.selectedNodeId ||
                  state.chatLearningLoading ||
                  state.chatLearningSaving ||
                  state.chatLearningResetting
                "
                @click="loadChatLearningFile({ force: true })"
              >
                {{
                  state.chatLearningLoading ? "Loading..." : "Reload from disk"
                }}
              </button>
              <button
                class="secondary-button"
                type="button"
                :disabled="
                  !state.chatLearningContent ||
                  state.chatLearningResetting ||
                  (state.chatLearningViewMode === 'simple' &&
                    !!chatLearningViewError)
                "
                @click="copyChatLearningFile"
              >
                {{ state.chatLearningCopied ? "Copied!" : "Copy" }}
              </button>
              <button
                class="secondary-button"
                type="button"
                :disabled="
                  !state.chatLearningContent || state.chatLearningResetting
                "
                @click="downloadChatLearningBackup"
              >
                Download Backup
              </button>
              <button
                class="secondary-button"
                type="button"
                :disabled="
                  !state.selectedNodeId ||
                  state.chatLearningLoading ||
                  state.chatLearningSaving ||
                  state.chatLearningResetting
                "
                @click="triggerChatLearningImport"
              >
                Restore Backup
              </button>
              <button
                class="primary-button"
                type="button"
                :disabled="
                  state.chatLearningViewMode !== 'native' ||
                  !state.selectedNodeId ||
                  !chatLearningDirty ||
                  chatLearningTooLarge ||
                  state.chatLearningLoading ||
                  state.chatLearningSaving ||
                  state.chatLearningResetting
                "
                @click="saveChatLearningFile"
              >
                {{ state.chatLearningSaving ? "Saving..." : "Save Changes" }}
              </button>
              <button
                class="danger-button"
                type="button"
                :disabled="
                  !state.selectedNodeId ||
                  state.chatLearningLoading ||
                  state.chatLearningSaving ||
                  state.chatLearningResetting
                "
                @click="reinitializeChatLearningMemory"
              >
                {{
                  state.chatLearningResetting
                    ? "Reinitializing..."
                    : "Reinitialize Memory"
                }}
              </button>
            </div>
            <p
              v-if="state.chatLearningModifiedAt"
              class="area-detail-subhead chat-learning-modified"
            >
              Last saved: {{ formatDateTime(state.chatLearningModifiedAt) }}
            </p>
            </details>
          </article>
          <article
            v-else-if="state.cerebrumTab === 'memory'"
            class="area-detail settings-panel chat-learning-panel"
          >
            <CerebrumWorldInsights
              :key="`${state.selectedNodeId}:memory`"
              :node-id="state.selectedNodeId"
              :language="uiLanguage"
              mode="memory"
              :request="requestWorldInsight"
            />
            <details class="memory-file-tools">
              <summary>Habits, decisions and shared memory</summary>
            <div class="memory-section-toolbar">
              <div class="memory-section-heading"><h4>Shared household learning</h4>
<div class="chat-learning-meta">
                <span class="meta-chip"
                  >{{ state.cerebrumMemoryHabitCount }} habits</span
                >
                <span class="meta-chip"
                  >{{ state.cerebrumMemoryConfirmedHabitCount }} confirmed</span
                >
                <span
                  v-if="state.cerebrumMemoryPendingHabitCount"
                  class="meta-chip chat-learning-dirty"
                  >{{ state.cerebrumMemoryPendingHabitCount }} awaiting
                  reply</span
                >
                <span class="meta-chip"
                  >{{ state.cerebrumMemoryStateCount }} states</span
                >
                <span
                  v-if="cerebrumMemoryDirty"
                  class="meta-chip chat-learning-dirty"
                  >Unsaved changes</span
                >
              </div>
              </div>
              <button class="secondary-button" type="button"
                :disabled="!state.selectedNodeId || cerebrumMemoryDirty || state.cerebrumMemoryLoading || state.cerebrumMemorySaving || state.cerebrumMemoryResetting"
                :title="cerebrumMemoryDirty ? localizeUiText('Unsaved changes') : ''"
                @click="loadCerebrumMemoryFile()">
                {{ state.cerebrumMemoryLoading ? 'Loading...' : 'Refresh' }}
              </button>
            </div>
            <CerebrumSharedInsights
              :key="`${state.selectedNodeId}:shared-memory`"
              mode="memory"
              :content="state.cerebrumMemoryBaseline"
              :language="uiLanguage"
              :loading="state.cerebrumMemoryLoading"
              :error="state.cerebrumMemoryError"
            />
            </details>
            <details class="memory-file-tools" :open="cerebrumMemoryDirty">
              <summary>Advanced files and backups</summary>
              <p class="area-detail-subhead" :class="{ 'chat-learning-size-over': cerebrumMemoryTooLarge }">
                {{ formatByteSize(cerebrumMemoryEditorBytes) }} / {{ formatByteSize(state.cerebrumMemoryMaxBytes) }}
              </p>
              <p class="area-detail-subhead">Inspect or edit the saved home memory data. Changes take effect only when saved.</p>
            <div
              class="cerebrum-memory-view-switch"
              role="tablist"
              aria-label="Cerebrum memory view"
            >
              <button
                class="settings-tab-button"
                :class="{ active: state.cerebrumMemoryViewMode === 'json' }"
                type="button"
                role="tab"
                :aria-selected="state.cerebrumMemoryViewMode === 'json'"
                @click="state.cerebrumMemoryViewMode = 'json'"
              >
                JSON
              </button>
              <button
                class="settings-tab-button"
                :class="{ active: state.cerebrumMemoryViewMode === 'simple' }"
                type="button"
                role="tab"
                :aria-selected="state.cerebrumMemoryViewMode === 'simple'"
                @click="state.cerebrumMemoryViewMode = 'simple'"
              >
                Simplified text
              </button>
              <span class="cerebrum-memory-view-hint">
                {{
                  state.cerebrumMemoryViewMode === "simple"
                    ? "Readable overview · read-only"
                    : "Editable structured data"
                }}
              </span>
            </div>
            <label class="flow-field chat-learning-path-field">
              <span>File path</span>
              <code>{{
                state.cerebrumMemoryPath || "Loading Cerebrum memory..."
              }}</code>
            </label>
            <textarea
              v-if="state.cerebrumMemoryViewMode === 'json'"
              v-model="state.cerebrumMemoryContent"
              class="chat-learning-editor"
              :disabled="
                state.cerebrumMemoryLoading ||
                state.cerebrumMemorySaving ||
                state.cerebrumMemoryResetting ||
                !state.selectedNodeId
              "
              spellcheck="false"
              aria-label="Cerebrum memory JSON"
            />
            <pre
              v-else
              class="cerebrum-memory-simple-view"
              tabindex="0"
              role="document"
              aria-label="Simplified Cerebrum memory, read-only"
              >{{ cerebrumMemorySimpleView }}</pre
            >
            <p
              v-if="
                state.cerebrumMemoryViewMode === 'simple' &&
                cerebrumMemoryViewError
              "
              class="error-banner chat-learning-error"
              role="alert"
            >
              {{ cerebrumMemoryViewError }} Switch to JSON to correct it.
            </p>
            <p
              v-if="state.cerebrumMemoryError"
              class="error-banner chat-learning-error"
              role="alert"
            >
              {{ state.cerebrumMemoryError }}
            </p>
            <div class="card-head-actions action-cluster chat-learning-actions">
              <button
                class="secondary-button"
                type="button"
                :disabled="
                  !state.selectedNodeId ||
                  state.cerebrumMemoryLoading ||
                  state.cerebrumMemorySaving ||
                  state.cerebrumMemoryResetting
                "
                @click="loadCerebrumMemoryFile({ force: true })"
              >
                {{
                  state.cerebrumMemoryLoading
                    ? "Loading..."
                    : "Reload from disk"
                }}
              </button>
              <button
                class="secondary-button"
                type="button"
                :disabled="
                  !state.cerebrumMemoryContent ||
                  state.cerebrumMemoryResetting ||
                  (state.cerebrumMemoryViewMode === 'simple' &&
                    !!cerebrumMemoryViewError)
                "
                @click="copyCerebrumMemoryFile"
              >
                {{ state.cerebrumMemoryCopied ? "Copied!" : "Copy" }}
              </button>
              <button
                class="secondary-button"
                type="button"
                :disabled="
                  !state.cerebrumMemoryContent || state.cerebrumMemoryResetting
                "
                @click="downloadCerebrumMemoryBackup"
              >
                Download Backup
              </button>
              <button
                class="secondary-button"
                type="button"
                :disabled="
                  !state.selectedNodeId ||
                  state.cerebrumMemoryLoading ||
                  state.cerebrumMemorySaving ||
                  state.cerebrumMemoryResetting
                "
                @click="triggerCerebrumMemoryImport"
              >
                Restore Backup
              </button>
              <button
                class="primary-button"
                type="button"
                :disabled="
                  state.cerebrumMemoryViewMode !== 'json' ||
                  !state.selectedNodeId ||
                  !cerebrumMemoryDirty ||
                  cerebrumMemoryTooLarge ||
                  state.cerebrumMemoryLoading ||
                  state.cerebrumMemorySaving ||
                  state.cerebrumMemoryResetting
                "
                @click="saveCerebrumMemoryFile"
              >
                {{ state.cerebrumMemorySaving ? "Saving..." : "Save Changes" }}
              </button>
              <button
                class="danger-button"
                type="button"
                :disabled="
                  !state.selectedNodeId ||
                  state.cerebrumMemoryLoading ||
                  state.cerebrumMemorySaving ||
                  state.cerebrumMemoryResetting
                "
                @click="reinitializeCerebrumMemory"
              >
                {{
                  state.cerebrumMemoryResetting
                    ? "Reinitializing..."
                    : "Reinitialize Memory"
                }}
              </button>
            </div>
            <p
              v-if="state.cerebrumMemoryModifiedAt"
              class="area-detail-subhead chat-learning-modified"
            >
              Last saved: {{ formatDateTime(state.cerebrumMemoryModifiedAt) }}
            </p>
            </details>
          </article>
          <article v-else-if="['goals', 'research'].includes(state.cerebrumTab)" class="area-detail settings-panel">
            <CerebrumWorldInsights
              :key="`${state.selectedNodeId}:${state.cerebrumTab}`"
              :node-id="state.selectedNodeId"
              :language="uiLanguage"
              :mode="state.cerebrumTab"
              :request="requestWorldInsight"
            />
          </article>
          <article
            v-else-if="state.cerebrumTab === 'operations'"
            class="area-detail settings-panel cerebrum-operations-panel"
          >
            <CerebrumWorldInsights
              :key="`${state.selectedNodeId}:operations`"
              :node-id="state.selectedNodeId"
              :language="uiLanguage"
              mode="operations"
              :request="requestWorldInsight"
            />
            <details class="memory-file-tools">
              <summary>Technical activity log · last three days</summary>
            <div class="card-head settings-panel-head operations-panel-head">
              <div>
                <h3>
                  Cerebrum Operations <span class="beta-badge">LAST 3 DAYS</span>
                </h3>
                <p class="area-detail-subhead">
                  Audit of KNX telegrams, LLM requests, node tools and autonomous
                  Cerebrum activities such as habit learning and state refreshes.
                </p>
              </div>
              <button
                class="secondary-button"
                type="button"
                :disabled="
                  !state.selectedNodeId || state.cerebrumOperationsLoading
                "
                @click="loadCerebrumOperations({ force: true })"
              >
                {{ state.cerebrumOperationsLoading ? "Loading..." : "Refresh" }}
              </button>
            </div>

            <div class="operations-counts" aria-label="Operation totals">
              <span class="meta-chip"
                >{{ state.cerebrumOperationsCounts.total }} total</span
              >
              <span class="meta-chip operation-count-knx"
                >{{ state.cerebrumOperationsCounts.knx }} KNX</span
              >
              <span class="meta-chip operation-count-llm"
                >{{ state.cerebrumOperationsCounts.llm }} LLM</span
              >
              <span class="meta-chip operation-count-tool"
                >{{ state.cerebrumOperationsCounts.tool }} tools</span
              >
              <span class="meta-chip operation-count-autonomous"
                >{{ state.cerebrumOperationsCounts.autonomous }} autonomous</span
              >
            </div>

            <div class="operations-toolbar">
              <label class="flow-field operations-filter-field">
                <span>Category</span>
                <select v-model="state.cerebrumOperationsFilter">
                  <option value="all">All operations</option>
                  <option value="knx">KNX telegrams</option>
                  <option value="llm">LLM requests</option>
                  <option value="tool">Node tools</option>
                  <option value="autonomous">Autonomous activities</option>
                  <option value="system">System</option>
                </select>
              </label>
              <label class="flow-field operations-filter-field">
                <span>Status</span>
                <select v-model="state.cerebrumOperationsStatusFilter">
                  <option value="all">All statuses</option>
                  <option
                    v-for="status in cerebrumOperationStatusOptions"
                    :key="status"
                    :value="status"
                  >
                    {{ operationStatusLabel(status) }}
                  </option>
                </select>
              </label>
              <label class="flow-field operations-search-field">
                <span>Search operations</span>
                <input
                  v-model="state.cerebrumOperationsSearch"
                  type="search"
                  placeholder="Address, tool, device, operation..."
                />
              </label>
            </div>

            <p
              v-if="state.cerebrumOperationsFrom"
              class="area-detail-subhead operations-range"
            >
              {{ formatOperationsRangeSummary() }}
            </p>
            <p
              v-if="state.cerebrumOperationsError"
              class="error-banner chat-learning-error"
              role="alert"
            >
              {{ state.cerebrumOperationsError }}
            </p>
            <div
              v-if="state.cerebrumOperationsLoading && !state.cerebrumOperationsItems.length"
              class="operations-loading"
              role="status"
            >
              <span class="chat-pending-spinner" aria-hidden="true"></span>
              <span>Loading the last three days...</span>
            </div>
            <div v-else-if="filteredCerebrumOperations.length" class="operations-list">
              <article
                v-for="item in filteredCerebrumOperations"
                :key="item.id"
                class="operation-entry"
                :class="`operation-entry-${item.category}`"
              >
                <div class="operation-entry-marker" aria-hidden="true"></div>
                <div class="operation-entry-body">
                  <div class="operation-entry-meta">
                    <span
                      class="operation-category"
                      :class="`operation-category-${item.category}`"
                      >{{ operationCategoryLabel(item.category) }}</span
                    >
                    <strong>{{ item.source }}</strong>
                    <span>{{ item.operation }}</span>
                    <span
                      v-if="operationFlowLabel(item)"
                      class="operation-flow"
                      :class="operationFlowClasses(item)"
                      >{{ operationFlowLabel(item) }}</span
                    >
                    <span
                      class="operation-status"
                      :class="`operation-status-${item.status}`"
                      ><span class="operation-status-prefix">Outcome:</span>
                      {{ operationStatusLabel(item.status) }}</span
                    >
                    <time :datetime="item.at">{{ formatDateTime(item.at) }}</time>
                    <span v-if="item.durationMs">{{ formatOperationDuration(item.durationMs) }}</span>
                  </div>
                  <h4>{{ item.title }}</h4>
                  <p v-if="item.summary">{{ item.summary }}</p>
                  <details v-if="formatOperationDetails(item.details)" class="operation-details">
                    <summary>Technical details</summary>
                    <pre>{{ formatOperationDetails(item.details) }}</pre>
                  </details>
                </div>
              </article>
            </div>
            <p v-else-if="!state.cerebrumOperationsLoading" class="empty-state">
              No matching operations in the last three days.
            </p>
            <div class="operations-paths">
              <span v-if="state.cerebrumOperationsArchivePath">
                Node operations: <code>{{ state.cerebrumOperationsArchivePath }}</code>
              </span>
              <span v-if="state.cerebrumOperationsKnxArchivePath">
                KNX traffic: <code>{{ state.cerebrumOperationsKnxArchivePath }}</code>
              </span>
            </div>
            </details>
          </article>
          <input
            ref="configImportRef"
            type="file"
            accept=".zip,application/zip,application/x-zip-compressed,.json,application/json"
            class="hidden-file-input"
            @change="importFullConfig"
          />
          <input
            ref="chatLearningImportRef"
            type="file"
            accept="text/plain,.knxctx"
            class="hidden-file-input"
            @change="importChatLearningBackup"
          />
          <input
            ref="cerebrumMemoryImportRef"
            type="file"
            accept="application/json,text/markdown,text/plain,.json,.md"
            class="hidden-file-input"
            @change="importCerebrumMemoryBackup"
          />
        </section>
      </main>
    </section>

    <div
      v-if="
        state.areaLlmRegenerating ||
        state.areaLlmBulkDeleting ||
        state.testPlanGenerating
      "
      class="global-wait-overlay"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div class="global-wait-card">
        <span class="running-spinner global-wait-spinner" aria-hidden="true" />
        <strong>
          {{
            state.testPlanGenerating
              ? "Building Test Plan"
              : state.areaLlmBulkDeleting
                ? "Deleting AI Areas"
                : "Regenerating AI Areas"
          }}
        </strong>
        <span>
          {{
            state.testPlanGenerating
              ? "Please wait while the template builder generates the test plan."
              : state.areaLlmBulkDeleting
                ? "Please wait while AI-generated areas are removed."
                : "Please wait, this can take a while with large ETS projects."
          }}
        </span>
      </div>
    </div>

    <div
      v-if="state.testPlanRunConfirmOpen"
      class="modal-backdrop"
      @click="closeRunTestPlanConfirm"
    >
      <div
        class="modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="run-test-title"
        @click.stop
      >
        <h3 id="run-test-title">Start test?</h3>
        <p class="area-detail-subhead">
          {{
            state.testPlanRunMode === "repeat"
              ? "This will send real telegrams on the KNX bus and repeat the selected test plan until you press Stop Repeat."
              : "This will send real telegrams on the KNX bus for the selected test plan."
          }}
        </p>
        <div class="modal-actions">
          <button
            class="secondary-button"
            type="button"
            autofocus
            @click="closeRunTestPlanConfirm"
          >
            Cancel
          </button>
          <button
            class="primary-button"
            type="button"
            :disabled="state.testPlanRunning"
            @click="runAiTestPlanDefinition(state.testPlanRunMode)"
          >
            Start Test
          </button>
        </div>
      </div>
    </div>

    <div
      v-if="state.testPlanUnsavedConfirmOpen"
      class="modal-backdrop"
      @click="closeUnsavedTestPlanConfirm"
    >
      <div
        class="modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="unsaved-plan-title"
        @click.stop
      >
        <h3 id="unsaved-plan-title">Unsaved changes</h3>
        <p class="area-detail-subhead">
          Save or discard the current plan changes before opening
          {{ state.testPlanPendingActionLabel || "another plan" }}.
        </p>
        <div class="modal-actions">
          <button
            class="secondary-button"
            type="button"
            autofocus
            @click="closeUnsavedTestPlanConfirm"
          >
            Stay Here
          </button>
          <button
            class="secondary-button"
            type="button"
            @click="
              cancelTestPlanChanges();
              runPendingTestPlanAction();
            "
          >
            Discard Changes
          </button>
          <button
            class="primary-button"
            type="button"
            :disabled="state.testPlanSaving || !state.testPlanDraft"
            @click="saveCurrentTestPlanAndContinue"
          >
            {{ state.testPlanSaving ? "Saving..." : "Save and Continue" }}
          </button>
        </div>
      </div>
    </div>

    <div
      v-if="state.areaUnsavedConfirmOpen"
      class="modal-backdrop"
      @click="closeAreaUnsavedConfirm"
    >
      <div
        class="modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="unsaved-area-title"
        @click.stop
      >
        <h3 id="unsaved-area-title">Unsaved changes</h3>
        <p class="area-detail-subhead">
          Discard the current area changes and close the editor?
        </p>
        <div class="modal-actions">
          <button
            class="secondary-button"
            type="button"
            autofocus
            @click="closeAreaUnsavedConfirm"
          >
            Stay Here
          </button>
          <button
            class="primary-button"
            type="button"
            @click="discardAreaChangesAndCloseEditor"
          >
            Discard and Close
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped src="./styles/workspace.css"></style>
