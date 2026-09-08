const present = value => value !== undefined && value !== null && value !== ''
const oneLine = value => String(value ?? '').replace(/\s+/g, ' ').trim()
const readable = value => {
  if (Array.isArray(value)) return value.map(readable).filter(Boolean).join(', ')
  if (value && typeof value === 'object') return Object.entries(value).map(([key, entry]) => `${key}: ${readable(entry)}`).join(', ')
  return oneLine(value)
}
export const recordTime = item => item.at || item.updatedAt || item.decidedAt || item.retrievedAt || item.lastObserved || item.observedAt || item.changedAt || item.createdAt || item.firstSeenAt || item.firstObserved || ''
const timeText = (value, language) => {
  if (!present(value)) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return oneLine(value)
  return date.toLocaleString(language.startsWith('it') ? 'it-IT' : 'en-GB', { dateStyle: 'short', timeStyle: 'medium' })
}
export function recordText (item, language = 'it') {
  const it = language.startsWith('it')
  if (present(item.question) || present(item.reply)) {
    return [present(item.question) ? `${it ? 'Utente' : 'User'}: ${oneLine(item.question)}` : '', present(item.reply) ? `Cerebrum: ${oneLine(item.reply)}` : ''].filter(Boolean).join(' · ')
  }
  const parts = []
  const add = value => { const text = readable(value); if (text && !parts.includes(text)) parts.push(text) }
  add(item.title || item.label || item.cameraName || item.display?.entities?.[0]?.label)
  add(item.text || item.message || item.summary || item.userMessage || item.proposalMessage)
  if (!parts.length) add(item.objectId || item.ga || item.targetId || item.cameraId || item.topic || item.type || item.event)
  if (present(item.value)) add(`= ${readable(item.value)}`)
  if (present(item.requestedValue)) add(`→ ${readable(item.requestedValue)}`)
  if (present(item.expectedValue)) add(`${it ? 'Atteso' : 'Expected'}: ${readable(item.expectedValue)}`)
  add(item.plan)
  add(item.assessment)
  if (!parts.length) add(item.reason || item.operation || item.display?.title || item.id)
  if (item.eventType) add(item.eventType)
  if (item.url) add(item.url)
  if (item.status || item.outcome) {
    const status = item.status || item.outcome
    const labels = { active: 'Attivo', paused: 'In pausa', confirmed: 'Confermato', rejected: 'Rifiutato', learning: 'In apprendimento', pending_confirmation: 'In attesa di conferma', fresh: 'Recente', stale: 'Da aggiornare', open: 'Aperto', resolved: 'Concluso', failed: 'Errore', succeeded: 'Completato', verified: 'Verificato', candidate: 'Ipotesi', recurring: 'Ricorrente', retired: 'Archiviato' }
    add(it && labels[status] ? labels[status] : oneLine(status).replace(/_/g, ' '))
  }
  if (item.fresh === false) add(it ? 'Da aggiornare' : 'Stale')
  if (item.error) add(item.error)
  return parts.join(' · ') || '—'
}
export function formatRecordLog (items, language = 'it') {
  return (Array.isArray(items) ? items : []).map((item, index) => ({ item, index, time: Date.parse(recordTime(item)) || 0 }))
    .sort((left, right) => right.time - left.time || left.index - right.index)
    .map(({ item }) => `${timeText(recordTime(item), language)}  ${recordText(item, language)}`).join('\n')
}
