<script setup>
import { computed } from 'vue'
import { parseChatLearningNativeFile } from '../chatLearningView.mjs'
import { parseCerebrumMemoryJson } from '../cerebrumMemoryView.mjs'
import CerebrumRecordLog from './CerebrumRecordLog.vue'

const props = defineProps({
  mode: { type: String, default: 'learning' },
  instructionsOnly: { type: Boolean, default: false },
  content: { type: String, default: '' },
  language: { type: String, default: 'en' },
  loading: { type: Boolean, default: false },
  error: { type: String, default: '' }
})
const array = value => Array.isArray(value) ? value : []
const parsed = computed(() => {
  if (!props.content.trim()) return { items: [], error: '' }
  try {
    const items = []
    if (props.mode === 'learning') {
      const data = parseChatLearningNativeFile(props.content)
      items.push(...array(data.instructions))
      if (!props.instructionsOnly) items.push(...array(data.turns))
      for (const session of array(data.sessions)) {
        items.push(...array(session.instructions))
        if (!props.instructionsOnly) items.push(...array(session.turns), ...array(session.cameraWatches))
      }
    } else {
      const data = parseCerebrumMemoryJson(props.content)
      const keys = ['habits', 'habitDecisions', 'observations', 'notifications', 'semanticObjects', 'states']
      if (!keys.some(key => Array.isArray(data[key]))) throw new Error('Invalid memory collections')
      for (const key of keys) {
        if (data[key] !== undefined && (!Array.isArray(data[key]) || data[key].some(item => !item || typeof item !== 'object' || Array.isArray(item)))) throw new Error('Invalid memory collection')
        items.push(...array(data[key]))
      }
    }
    return { items, error: '' }
  } catch (error) { return { items: [], error: String(error.message || error) } }
})
</script>

<template>
  <section :aria-busy="loading">
    <p v-if="error || parsed.error" role="alert">{{ error || parsed.error }}</p>
    <CerebrumRecordLog :items="parsed.items" :language="language" :label="language.startsWith('it') ? 'Ricordi salvati' : 'Saved memories'" />
  </section>
</template>
