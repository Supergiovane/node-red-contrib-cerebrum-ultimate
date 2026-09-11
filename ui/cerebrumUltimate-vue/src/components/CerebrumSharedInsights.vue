<script setup>
import { computed } from 'vue'
import { sharedInsightItems } from '../cerebrumInsights.mjs'
import CerebrumRecordLog from './CerebrumRecordLog.vue'

const props = defineProps({
  mode: { type: String, default: 'learning' },
  scope: { type: String, default: 'all' },
  content: { type: String, default: '' },
  language: { type: String, default: 'en' },
  loading: { type: Boolean, default: false },
  error: { type: String, default: '' }
})
const parsed = computed(() => {
  try {
    return { items: sharedInsightItems(props.content, { mode: props.mode, scope: props.scope }), error: '' }
  } catch (error) { return { items: [], error: String(error.message || error) } }
})
const label = computed(() => props.mode === 'memory'
  ? (props.language.startsWith('it') ? 'Stati dei dispositivi' : 'Device states')
  : props.scope === 'instructions'
    ? (props.language.startsWith('it') ? 'Istruzioni salvate' : 'Saved instructions')
    : (props.language.startsWith('it') ? 'Conversazioni salvate' : 'Saved conversations'))
</script>

<template>
  <section :aria-busy="loading">
    <p v-if="error || parsed.error" role="alert">{{ error || parsed.error }}</p>
    <CerebrumRecordLog :items="parsed.items" :language="language" :label="label" />
  </section>
</template>
