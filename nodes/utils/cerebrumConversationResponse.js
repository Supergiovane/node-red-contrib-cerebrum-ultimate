'use strict'

// Extract only the complete outer object. Searching again inside a broken JSON
// document can turn a routine descriptor or a command into the entire response.
function parseCerebrumConversationJson (value) {
  const text = String(value || '').replace(/^\uFEFF/, '').trim()
  if (!text) throw new Error('Empty AI response')
  const start = text.search(/[[{]/)
  if (start < 0 || text[start] !== '{') throw new Error('Expected a complete conversation JSON object')
  const stack = ['}']
  let quoted = false
  let escaped = false
  for (let index = start + 1; index < text.length; index++) {
    const character = text[index]
    if (quoted) {
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === '"') quoted = false
      continue
    }
    if (character === '"') quoted = true
    else if (character === '{') stack.push('}')
    else if (character === '[') stack.push(']')
    else if (character === '}' || character === ']') {
      if (character !== stack.pop()) throw new Error('Malformed conversation JSON')
      if (!stack.length) {
        if (/[[{]/.test(text.slice(index + 1))) throw new Error('Multiple conversation JSON values')
        try { return JSON.parse(text.slice(start, index + 1)) } catch (error) { throw new Error('Malformed conversation JSON') }
      }
    }
  }
  throw new Error('Incomplete conversation JSON')
}

function classifyCerebrumResponseIssue (response) {
  const reason = String(response.finishReason || '').toLowerCase()
  if (response.responseRefused === true) return 'blocked'
  if (['length', 'max_tokens', 'max_output_tokens'].includes(reason)) return 'token_limit'
  if (['content_filter', 'refusal'].includes(reason)) return 'blocked'
  if (['incomplete', 'failed', 'cancelled'].includes(reason)) return 'incomplete'
  if (response.responseEmpty === true || !String(response.content || '').trim()) return 'empty'
  return ''
}

function buildCerebrumResponseRecoveryPrompt ({ issue, replyOnly = false }) {
  return `\nRESPONSE RECOVERY: The previous response was unusable (${issue}); none of its instructions were executed. Return a complete, compact conversation JSON object, never a fragment or a continuation of JSON. Include a non-empty reply for a final answer or clarification; an empty reply is valid only with an available, necessary intermediate tool. Use only tools enabled in THIS pass. Preserve all current user requirements and execution permissions. Tool results already supplied remain authoritative evidence of completed operations: do not repeat those operations. If a routine was already saved, explain its recorded result. ${replyOnly ? 'This is a clarification: ask the missing question in reply and leave EVERY action array empty.' : 'If more evidence is needed, request an available tool. If the task cannot be completed, explain the specific limitation in reply.'}`
}

const copies = {
  en: {
    token_limit: 'The model reached its generation limit before completing the response.',
    incomplete: 'The provider interrupted the response before it was complete.',
    invalid_json: 'The model returned an incomplete or invalid response format.',
    empty: 'The model did not provide a final reply or a tool to continue the request.',
    unusable_tools: 'The model requested tools that are invalid or unavailable in this step, without providing a final reply.',
    blocked: 'The provider blocked the response.',
    recovery: 'Automatic recovery did not produce a usable response.',
    memory: 'Memory updated.',
    create: 'Routine saved',
    update: 'Routine updated',
    pause: 'Routine paused',
    resume: 'Routine resumed',
    delete: 'Routine deleted'
  },
  it: {
    token_limit: 'Il modello ha raggiunto il limite di generazione prima di completare la risposta.',
    incomplete: 'Il provider ha interrotto la risposta prima che fosse completa.',
    invalid_json: 'Il modello ha restituito una risposta in un formato incompleto o non valido.',
    empty: 'Il modello non ha fornito una risposta finale né uno strumento per proseguire la richiesta.',
    unusable_tools: 'Il modello ha richiesto strumenti non validi o non disponibili in questo passaggio, senza fornire una risposta finale.',
    blocked: 'Il provider ha bloccato la risposta.',
    recovery: 'Il recupero automatico non ha prodotto una risposta utilizzabile.',
    memory: 'Memoria aggiornata.',
    create: 'Routine salvata',
    update: 'Routine aggiornata',
    pause: 'Routine messa in pausa',
    resume: 'Routine riattivata',
    delete: 'Routine eliminata'
  },
  de: {
    token_limit: 'Das Modell hat sein Ausgabelimit erreicht, bevor die Antwort vollständig war.',
    incomplete: 'Der Anbieter hat die Antwort vorzeitig abgebrochen.',
    invalid_json: 'Das Modell hat eine unvollständige oder ungültig formatierte Antwort geliefert.',
    empty: 'Das Modell hat weder eine abschließende Antwort noch ein Werkzeug zum Fortsetzen geliefert.',
    unusable_tools: 'Das Modell hat ungültige oder in diesem Schritt nicht verfügbare Werkzeuge angefordert, ohne abschließende Antwort.',
    blocked: 'Der Anbieter hat die Antwort blockiert.',
    recovery: 'Der automatische Wiederherstellungsversuch hat keine nutzbare Antwort geliefert.',
    memory: 'Speicher aktualisiert.',
    create: 'Routine gespeichert',
    update: 'Routine aktualisiert',
    pause: 'Routine pausiert',
    resume: 'Routine fortgesetzt',
    delete: 'Routine gelöscht'
  },
  fr: {
    token_limit: 'Le modèle a atteint sa limite de génération avant de terminer la réponse.',
    incomplete: 'Le fournisseur a interrompu la réponse avant sa fin.',
    invalid_json: 'Le modèle a renvoyé une réponse au format incomplet ou invalide.',
    empty: 'Le modèle n’a fourni ni réponse finale ni outil pour poursuivre la demande.',
    unusable_tools: 'Le modèle a demandé des outils invalides ou indisponibles à cette étape, sans réponse finale.',
    blocked: 'Le fournisseur a bloqué la réponse.',
    recovery: 'La tentative de récupération automatique n’a pas produit de réponse exploitable.',
    memory: 'Mémoire mise à jour.',
    create: 'Routine enregistrée',
    update: 'Routine mise à jour',
    pause: 'Routine suspendue',
    resume: 'Routine reprise',
    delete: 'Routine supprimée'
  },
  es: {
    token_limit: 'El modelo alcanzó su límite de generación antes de completar la respuesta.',
    incomplete: 'El proveedor interrumpió la respuesta antes de completarla.',
    invalid_json: 'El modelo devolvió una respuesta con un formato incompleto o no válido.',
    empty: 'El modelo no proporcionó una respuesta final ni una herramienta para continuar la solicitud.',
    unusable_tools: 'El modelo solicitó herramientas no válidas o no disponibles en este paso, sin respuesta final.',
    blocked: 'El proveedor bloqueó la respuesta.',
    recovery: 'La recuperación automática no produjo una respuesta utilizable.',
    memory: 'Memoria actualizada.',
    create: 'Rutina guardada',
    update: 'Rutina actualizada',
    pause: 'Rutina pausada',
    resume: 'Rutina reanudada',
    delete: 'Rutina eliminada'
  },
  zh: {
    token_limit: '模型在完成回复前达到了生成上限。',
    incomplete: '提供方在回复完成前中断了生成。',
    invalid_json: '模型返回的回复格式不完整或无效。',
    empty: '模型未提供最终回复，也未提供可继续处理请求的工具。',
    unusable_tools: '模型请求了无效或在此步骤中不可用的工具，且未提供最终回复。',
    blocked: '提供方阻止了回复。',
    recovery: '自动恢复未能生成可用的回复。',
    memory: '记忆已更新。',
    create: '例程已保存',
    update: '例程已更新',
    pause: '例程已暂停',
    resume: '例程已恢复',
    delete: '例程已删除'
  }
}

function buildCerebrumResponseFailureText ({ issue, language, recovered = false, effects = [] }) {
  const copy = copies[String(language).split('-')[0]] || copies.en
  return [copy[issue] || copy.invalid_json, recovered ? copy.recovery : '',
    ...effects.filter(effect => copy[effect.operation]).map(effect => `${copy[effect.operation]}: ${effect.name}.`)
  ].filter(Boolean).join('\n\n')
}

const buildCerebrumMemoryUpdatedText = language => (copies[String(language).split('-')[0]] || copies.en).memory

module.exports = { parseCerebrumConversationJson, classifyCerebrumResponseIssue, buildCerebrumResponseRecoveryPrompt, buildCerebrumResponseFailureText, buildCerebrumMemoryUpdatedText }
