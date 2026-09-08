<script setup>
import { computed } from 'vue'
import { formatRecordLog } from '../cerebrumRecordLog.mjs'
const props = defineProps({
  items: { type: Array, default: () => [] },
  language: { type: String, default: 'it' },
  label: { type: String, default: '' }
})
const content = computed(() => formatRecordLog(props.items, props.language))
</script>

<template>
  <textarea class="cerebrum-record-log" :value="content" :aria-label="label" :placeholder="language.startsWith('it') ? 'Nessun elemento.' : 'No records.'" readonly spellcheck="false" wrap="off" rows="12"></textarea>
</template>

<style scoped>
.cerebrum-record-log { display: block; width: 100%; box-sizing: border-box; min-height: 180px; resize: vertical; overflow: auto; padding: 12px; border: 1px solid var(--line, #ccc); border-radius: 5px; background: var(--panel, #fff); color: var(--text, #333); font: 13px/1.65 ui-monospace, monospace; }
.cerebrum-record-log:focus-visible { outline: 2px solid var(--accent, #ff9800); outline-offset: 2px; }
</style>
