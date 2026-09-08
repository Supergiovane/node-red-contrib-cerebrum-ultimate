<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import CerebrumRecordLog from './CerebrumRecordLog.vue'
const props = defineProps({
  nodeId: { type: String, default: '' },
  language: { type: String, default: 'it' },
  mode: { type: String, default: 'learning' },
  request: { type: Function, required: true }
})
const words = (it, en) => props.language.startsWith('it') ? it : en
const collections = {
  learning: ['patterns'], goals: ['goals'], research: ['knowledge', 'researchHistory'],
  memory: ['entities', 'situations', 'expectations', 'evidence', 'episodes'], operations: ['actionHistory', 'episodes']
}
const heading = computed(() => words(...({
  learning: ['Comportamenti osservati', 'Observed behaviour'], goals: ['Obiettivi', 'Goals'],
  research: ['Ricerche Web', 'Web research'], memory: ['Memoria', 'Memory'], operations: ['Attività', 'Activity']
}[props.mode] || ['Memoria', 'Memory'])))
const items = ref([])
const loading = ref(false)
const error = ref('')
let epoch = 0
let disposed = false
const load = async () => {
  const current = ++epoch
  if (!props.nodeId || disposed) { items.value = []; loading.value = false; return }
  loading.value = true
  error.value = ''
  const collected = []
  let blocked = 0
  try {
    for (const collection of collections[props.mode] || collections.learning) {
      let offset = 0
      const seen = new Set()
      while (!disposed && current === epoch) {
        const params = new URLSearchParams({ operation: 'inspect', collection, limit: '100', offset: String(offset) })
        const page = await props.request(`world-model/${encodeURIComponent(props.nodeId)}?${params}`)
        if (disposed || current !== epoch) return
        if (!page || page.ok === false || !Array.isArray(page.items)) throw new Error(page?.error || words('Dati non disponibili.', 'Data unavailable.'))
        for (const item of page.items) {
          if (item.id && seen.has(item.id)) continue
          if (item.id) seen.add(item.id)
          collected.push(item)
        }
        blocked += Array.isArray(page.blockedItems) ? page.blockedItems.length : Number(page.blockedItems) || 0
        if (page.nextOffset == null) break
        if (!Number.isInteger(page.nextOffset) || page.nextOffset <= offset) throw new Error(words('Caricamento incompleto. Riprova.', 'Incomplete load. Try again.'))
        offset = page.nextOffset
      }
      if (disposed || current !== epoch) return
    }
    if (blocked) error.value = words(`${blocked} elementi non disponibili.`, `${blocked} records unavailable.`)
  } catch (err) {
    if (disposed || current !== epoch) return
    error.value = String(err.message || err)
  } finally {
    if (!disposed && current === epoch) { items.value = collected; loading.value = false }
  }
}
watch(() => [props.nodeId, props.mode], () => { items.value = []; load() }, { immediate: true })
onBeforeUnmount(() => { disposed = true; ++epoch })
</script>

<template>
  <section class="world-insights" :aria-busy="loading">
    <header>
      <h3>{{ heading }}</h3>
      <button type="button" class="secondary-button" :disabled="loading || !nodeId" @click="load">{{ loading ? words('Caricamento…', 'Loading…') : words('Aggiorna', 'Refresh') }}</button>
    </header>
    <p v-if="error" role="alert">{{ error }}</p>
    <CerebrumRecordLog :items="items" :language="language" :label="heading" />
  </section>
</template>

<style scoped>
.world-insights { min-width: 0; }
header { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin: 0 0 12px; }
h3 { margin: 0; }
</style>
