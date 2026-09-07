<script setup>
import CerebrumIcon from './CerebrumIcon.vue';

defineProps({
  activeTab: { type: String, required: true },
  cerebrumTab: { type: String, required: true },
  sections: { type: Array, required: true },
  expanded: { type: Boolean, default: true },
  knxOpen: { type: Boolean, default: false },
  translate: { type: Function, required: true },
});
const emit = defineEmits(['navigate', 'cerebrum', 'toggle-knx']);
const knxItems = [
  { id: 'etsAccess', label: 'ETS Access' },
  { id: 'areas', label: 'Areas' },
  { id: 'tests', label: 'Tests' },
  { id: 'results', label: 'Test Results' },
];
const tools = [
  { id: 'flowBuilder', label: 'Node-RED Flow Builder' },
  { id: 'settings', label: 'Settings' },
];
</script>

<template>
  <nav class="neural-nav" :class="{ compact: !expanded }" :aria-label="translate('Main navigation')" data-cerebrum-localized>
    <button type="button" class="nav-item map-item" :class="{ active: activeTab === 'cerebrum' && cerebrumTab === 'brain' }" :aria-current="activeTab === 'cerebrum' && cerebrumTab === 'brain' ? 'page' : undefined" :title="translate('Neural map')" :aria-label="translate('Neural map')" @click="emit('cerebrum', 'brain')">
      <CerebrumIcon name="brain" /><span class="nav-label">{{ translate('Neural map') }}</span>
    </button>

    <p class="nav-group-label">Cerebrum</p>
    <button type="button" class="nav-item" :class="{ active: activeTab === 'overview' }" :aria-current="activeTab === 'overview' ? 'page' : undefined" :title="translate('Overview')" :aria-label="translate('Overview')" @click="emit('navigate', 'overview')">
      <CerebrumIcon name="overview" /><span class="nav-label">{{ translate('Overview') }}</span>
    </button>
    <button type="button" v-for="(section, index) in sections" :key="section.id" class="nav-item neuron-item" :class="{ active: activeTab === 'cerebrum' && cerebrumTab === section.id }" :style="{ '--section-color': section.color }" :aria-current="activeTab === 'cerebrum' && cerebrumTab === section.id ? 'page' : undefined" :title="section.label" :aria-label="section.label" @click="emit('cerebrum', section.id)">
      <span class="nav-neuron" aria-hidden="true">{{ String(index + 1).padStart(2, '0') }}</span>
      <span class="nav-label">{{ section.label }}</span>
    </button>

    <p class="nav-group-label">{{ translate('Home & tools') }}</p>
    <button type="button" class="nav-item" :class="{ active: knxItems.some(item => item.id === activeTab) }" :aria-expanded="knxOpen" aria-controls="knx-sidebar-submenu" title="KNX" aria-label="KNX" @click="emit('toggle-knx')">
      <CerebrumIcon name="knx" /><span class="nav-label">KNX</span><span class="nav-chevron" aria-hidden="true">{{ knxOpen ? '−' : '+' }}</span>
    </button>
    <div v-show="knxOpen" id="knx-sidebar-submenu" class="nav-submenu">
      <button type="button" v-for="item in knxItems" :key="item.id" class="nav-item" :class="{ active: activeTab === item.id }" :aria-current="activeTab === item.id ? 'page' : undefined" :title="translate(item.label)" :aria-label="translate(item.label)" @click="emit('navigate', item.id)">
        <CerebrumIcon :name="item.id" /><span class="nav-label">{{ translate(item.label) }}</span>
      </button>
    </div>
    <button type="button" v-for="item in tools" :key="item.id" class="nav-item" :class="{ active: activeTab === item.id }" :aria-current="activeTab === item.id ? 'page' : undefined" :title="translate(item.label)" :aria-label="translate(item.label)" @click="emit('navigate', item.id)">
      <CerebrumIcon :name="item.id" /><span class="nav-label">{{ translate(item.label) }}</span>
    </button>
  </nav>
</template>

<style scoped>
.neural-nav { display: flex; flex-direction: column; gap: 3px; min-height: 0; overflow-y: auto; padding: 0 3px 8px; scrollbar-width: thin; }
.nav-group-label { margin: 22px 12px 9px; color: var(--muted); font-size: 9px; font-weight: 650; letter-spacing: .2em; text-transform: uppercase; }
.nav-item { display: flex; align-items: center; gap: 11px; flex-shrink: 0; width: 100%; min-height: 38px; padding: 9px 11px; border: 1px solid transparent; border-radius: 9px; color: var(--muted); background: transparent; font: inherit; font-size: 12px; line-height: 1.4; text-align: left; cursor: pointer; transition: color .18s, background .18s, border-color .18s; }
.nav-item > svg { width: 18px; height: 18px; flex: 0 0 18px; }
.nav-item:hover { color: var(--text); background: var(--panel-hover); }
.nav-item.active { color: var(--section-color, var(--accent)); border-color: var(--line); background: var(--accent-soft); }
.nav-item:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
.nav-label { min-width: 0; }
.nav-neuron { display: grid; place-items: center; width: 18px; height: 18px; flex: 0 0 18px; color: var(--section-color); font-size: 9px; font-variant-numeric: tabular-nums; border: 1px solid color-mix(in srgb, var(--section-color) 35%, transparent); border-radius: 50%; }
.neuron-item.active .nav-neuron { box-shadow: 0 0 12px color-mix(in srgb, var(--section-color) 20%, transparent); }
.nav-chevron { margin-left: auto; font-size: 16px; }
.nav-submenu { margin: 3px 0 3px 19px; padding-left: 7px; border-left: 1px solid var(--line); }
.nav-submenu .nav-item { min-height: 34px; padding: 7px 9px; font-size: 11px; }
.nav-submenu svg { width: 15px; height: 15px; flex-basis: 15px; }
.compact { width: 100%; padding: 0; }
.compact .nav-label, .compact .nav-chevron { display: none; }
.compact .nav-group-label { font-size: 0; margin: 12px 6px 6px; border-top: 1px solid var(--line); }
.compact .nav-item { justify-content: center; padding: 9px 0; }
.compact .nav-submenu { margin-left: 0; padding-left: 0; border: 0; }
</style>
