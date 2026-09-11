import { parseChatLearningNativeFile } from './chatLearningView.mjs'
import { parseCerebrumMemoryJson } from './cerebrumMemoryView.mjs'

const array = value => Array.isArray(value) ? value : []

export function sharedInsightItems (content, { mode = 'learning', scope = 'all' } = {}) {
  if (!String(content || '').trim()) return []
  if (mode === 'learning') {
    const data = parseChatLearningNativeFile(content)
    return [data, ...array(data.sessions)].flatMap(session => [
      ...(scope === 'conversations' ? [] : array(session.instructions)),
      ...(scope === 'instructions' ? [] : [...array(session.turns), ...array(session.cameraWatches)])
    ])
  }
  const data = parseCerebrumMemoryJson(content)
  const collections = ['habits', 'habitDecisions', 'observations', 'notifications', 'semanticObjects', 'semanticEntities', 'states', 'episodes']
  if (!collections.some(key => Array.isArray(data[key]))) throw new Error('Invalid memory collections')
  for (const key of collections) {
    if (data[key] !== undefined && (!Array.isArray(data[key]) || data[key].some(item => !item || typeof item !== 'object' || Array.isArray(item)))) throw new Error('Invalid memory collection')
  }
  // Legacy inferred habits and episodes stay in the backup/editor only.
  // The active views contain current device state and recorded observations.
  return (scope === 'states' ? ['states'] : scope === 'observations' ? ['observations'] : ['states', 'observations'])
    .flatMap(key => array(data[key]))
}
