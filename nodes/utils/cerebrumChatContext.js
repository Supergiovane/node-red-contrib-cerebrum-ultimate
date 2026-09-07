const CHAT_CONTEXT_VERSION = 4
const CHAT_CONTEXT_MAX_BYTES = 512 * 1024
const CHAT_CONTEXT_MAX_SESSIONS = 50
const CHAT_CONTEXT_MAX_TURNS_PER_SESSION = 8
const CHAT_CONTEXT_MAX_RECENT_TURNS = 24
const CHAT_CONTEXT_MAX_INSTRUCTIONS_PER_SESSION = 20
const CHAT_CONTEXT_MAX_SHARED_INSTRUCTIONS = 1000
const CHAT_CONTEXT_MAX_CAMERA_WATCHES_PER_SESSION = 20
const CHAT_CONTEXT_MAX_QUESTION_CHARS = 4000
const CHAT_CONTEXT_MAX_REPLY_CHARS = 8000
const CHAT_CONTEXT_MAX_INSTRUCTION_CHARS = 2000
const CHAT_CONTEXT_NATIVE_HEADER = 'CEREBRUM_CHAT_CONTEXT'

const clampText = (value, maxChars) => String(value === undefined || value === null ? '' : value)
  .trim()
  .slice(0, Math.max(0, Number(maxChars) || 0))

const normalizeSessionId = value => clampText(value || 'default', 160) || 'default'

const createEmptyCerebrumChatContext = () => ({
  version: CHAT_CONTEXT_VERSION,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  instructions: [],
  turns: [],
  sessions: []
})

const normalizeTurn = (turn) => {
  if (!turn || typeof turn !== 'object' || Array.isArray(turn)) return null
  const question = clampText(turn.question, CHAT_CONTEXT_MAX_QUESTION_CHARS)
  const reply = clampText(turn.reply, CHAT_CONTEXT_MAX_REPLY_CHARS)
  if (!question && !reply) return null
  return {
    at: clampText(turn.at || new Date().toISOString(), 64),
    channel: normalizeSessionId(turn.channel),
    question,
    reply
  }
}

const normalizeInstruction = (instruction) => {
  if (!instruction || typeof instruction !== 'object' || Array.isArray(instruction)) return null
  const text = clampText(instruction.text, CHAT_CONTEXT_MAX_INSTRUCTION_CHARS)
  if (!text) return null
  return {
    at: clampText(instruction.at || new Date().toISOString(), 64),
    text
  }
}

const normalizeCameraWatch = (watch) => {
  if (!watch || typeof watch !== 'object' || Array.isArray(watch)) return null
  const id = clampText(watch.id, 160)
  const cameraId = clampText(watch.cameraId, 160)
  const cameraName = clampText(watch.cameraName, 240)
  const eventType = clampText(watch.eventType, 80)
  if (!id || (!cameraId && !cameraName) || !eventType) return null
  return {
    id,
    createdAt: clampText(watch.createdAt || new Date().toISOString(), 64),
    cameraId,
    cameraName,
    eventType,
    scopeId: clampText(watch.scopeId, 160),
    scopeName: clampText(watch.scopeName, 240),
    objectTypes: Array.from(new Set((Array.isArray(watch.objectTypes) ? watch.objectTypes : [])
      .map(value => clampText(value, 80).toLocaleLowerCase())
      .filter(Boolean))).slice(0, 12),
    cooldownSeconds: Math.max(10, Math.min(86400, Number(watch.cooldownSeconds) || 60)),
    sendSnapshot: watch.sendSnapshot !== false,
    language: clampText(watch.language || 'en', 8).toLocaleLowerCase()
  }
}

const normalizeSession = (session) => {
  if (!session || typeof session !== 'object' || Array.isArray(session)) return null
  const id = normalizeSessionId(session.id)
  const turns = (Array.isArray(session.turns) ? session.turns : [])
    .map(normalizeTurn)
    .filter(Boolean)
    .slice(-CHAT_CONTEXT_MAX_TURNS_PER_SESSION)
  const instructions = (Array.isArray(session.instructions) ? session.instructions : [])
    .map(normalizeInstruction)
    .filter(Boolean)
    .slice(-CHAT_CONTEXT_MAX_INSTRUCTIONS_PER_SESSION)
  const cameraWatches = (Array.isArray(session.cameraWatches) ? session.cameraWatches : [])
    .map(normalizeCameraWatch)
    .filter(Boolean)
    .slice(-CHAT_CONTEXT_MAX_CAMERA_WATCHES_PER_SESSION)
  return {
    id,
    updatedAt: clampText(session.updatedAt || new Date().toISOString(), 64),
    turns,
    instructions,
    cameraWatches
  }
}

const normalizeCerebrumChatContext = (value = {}) => {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  const byId = new Map()
  // Migrate durable v3 memories before any session eviction. Conversation turns
  // and notification recipients remain local to their original session.
  const instructions = [...(Array.isArray(source.instructions) ? source.instructions : [])]
  const turns = [...(Array.isArray(source.turns) ? source.turns : [])]
  ;(Array.isArray(source.sessions) ? source.sessions : []).forEach((item) => {
    const session = normalizeSession(item)
    if (!session) return
    instructions.push(...session.instructions)
    turns.push(...session.turns.map(turn => ({ ...turn, channel: session.id })))
    session.instructions = []
    session.turns = []
    byId.delete(session.id)
    byId.set(session.id, session)
  })
  const byText = new Map()
  instructions.map(normalizeInstruction).filter(Boolean)
    .sort((left, right) => left.at.localeCompare(right.at))
    .forEach(item => {
      const key = item.text.toLocaleLowerCase()
      byText.delete(key)
      byText.set(key, item)
    })
  return {
    version: CHAT_CONTEXT_VERSION,
    createdAt: clampText(source.createdAt || new Date().toISOString(), 64),
    updatedAt: clampText(source.updatedAt || new Date().toISOString(), 64),
    instructions: Array.from(byText.values()),
    turns: turns.map(normalizeTurn).filter(Boolean).sort((left, right) => left.at.localeCompare(right.at)).slice(-CHAT_CONTEXT_MAX_RECENT_TURNS),
    sessions: Array.from(byId.values()).slice(-CHAT_CONTEXT_MAX_SESSIONS)
  }
}

const findSession = (context, sessionId) => {
  const id = normalizeSessionId(sessionId)
  return normalizeCerebrumChatContext(context).sessions.find(session => session.id === id) || null
}

const touchSession = (context, sessionId) => {
  const target = normalizeCerebrumChatContext(context)
  const id = normalizeSessionId(sessionId)
  const existing = target.sessions.find(session => session.id === id)
  const session = existing || { id, updatedAt: new Date().toISOString(), turns: [], instructions: [], cameraWatches: [] }
  target.sessions = target.sessions.filter(item => item.id !== id)
  target.sessions.push(session)
  target.sessions = target.sessions.slice(-CHAT_CONTEXT_MAX_SESSIONS)
  target.updatedAt = new Date().toISOString()
  session.updatedAt = target.updatedAt
  return { target, session }
}

const addCerebrumChatTurn = (context, { sessionId, question, reply, at } = {}) => {
  const target = normalizeCerebrumChatContext(context)
  const turn = normalizeTurn({ at, channel: sessionId, question, reply })
  if (turn) target.turns.push(turn)
  target.turns = target.turns.slice(-CHAT_CONTEXT_MAX_RECENT_TURNS)
  target.updatedAt = new Date().toISOString()
  return target
}

const addCerebrumChatInstruction = (context, { text, at } = {}) => {
  if (String(text || '').trim().length > CHAT_CONTEXT_MAX_INSTRUCTION_CHARS) throw new Error('Memory entry exceeds 2000 characters; save complete smaller entries')
  const instruction = normalizeInstruction({ text, at })
  if (!instruction) return normalizeCerebrumChatContext(context)
  const target = normalizeCerebrumChatContext(context)
  const normalizedText = instruction.text.toLocaleLowerCase()
  target.instructions = target.instructions
    .filter(item => item.text.toLocaleLowerCase() !== normalizedText)
  if (target.instructions.length >= CHAT_CONTEXT_MAX_SHARED_INSTRUCTIONS) throw new Error('Shared memory is full; forget unused entries before saving more')
  target.instructions.push(instruction)
  target.updatedAt = new Date().toISOString()
  return target
}

const removeCerebrumChatInstructions = (context, { text, all = false } = {}) => {
  const target = normalizeCerebrumChatContext(context)
  target.updatedAt = new Date().toISOString()
  if (all === true) {
    target.instructions = []
    return target
  }
  const normalizedText = clampText(text, CHAT_CONTEXT_MAX_INSTRUCTION_CHARS).toLocaleLowerCase()
  if (!normalizedText) return target
  target.instructions = target.instructions
    .filter(item => item.text.toLocaleLowerCase() !== normalizedText)
  return target
}

const clearCerebrumChatSession = (context, sessionId) => {
  const target = normalizeCerebrumChatContext(context)
  const id = normalizeSessionId(sessionId)
  target.sessions = target.sessions.filter(session => session.id !== id)
  target.updatedAt = new Date().toISOString()
  return target
}

const addCerebrumCameraWatch = (context, { sessionId, watch } = {}) => {
  const normalized = normalizeCameraWatch(watch)
  if (!normalized) return normalizeCerebrumChatContext(context)
  const { target, session } = touchSession(context, sessionId)
  session.cameraWatches = (Array.isArray(session.cameraWatches) ? session.cameraWatches : [])
    .filter(item => item.id !== normalized.id)
  session.cameraWatches.push(normalized)
  session.cameraWatches = session.cameraWatches.slice(-CHAT_CONTEXT_MAX_CAMERA_WATCHES_PER_SESSION)
  return target
}

const removeCerebrumCameraWatches = (context, { sessionId, predicate } = {}) => {
  const { target, session } = touchSession(context, sessionId)
  const before = Array.isArray(session.cameraWatches) ? session.cameraWatches.length : 0
  session.cameraWatches = (Array.isArray(session.cameraWatches) ? session.cameraWatches : [])
    .filter(watch => !(typeof predicate === 'function' && predicate(watch)))
  return { context: target, removed: Math.max(0, before - session.cameraWatches.length) }
}

const listCerebrumCameraWatches = (context, sessionId) => getCerebrumChatSession(context, sessionId).cameraWatches.slice()

const listAllCerebrumCameraWatches = (context) => normalizeCerebrumChatContext(context).sessions.flatMap(session => {
  return session.cameraWatches.map(watch => Object.assign({ sessionId: session.id }, watch))
})

const getCerebrumChatSession = (context, sessionId) => {
  const session = findSession(context, sessionId)
  return session || {
    id: normalizeSessionId(sessionId),
    updatedAt: '',
    turns: [],
    instructions: [],
    cameraWatches: []
  }
}

const buildCerebrumSharedMemoryPromptContext = ({ context, currentQuestion = '', maxChars = 4000 } = {}) => {
  const instructions = normalizeCerebrumChatContext(context).instructions
  if (!instructions.length) return ''
  const normalizeSearch = text => String(text).normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase()
  const tokens = Array.from(new Set(normalizeSearch(currentQuestion).match(/[\p{L}\p{N}/._-]{2,}/gu) || []))
  const ranked = instructions.map((item, index) => {
    const document = normalizeSearch(item.text)
    return { item, index, score: tokens.reduce((sum, token) => sum + (document.includes(token) ? token.length : 0), 0) }
  }).sort((left, right) => right.score - left.score || right.index - left.index)
  const header = 'SHARED PERSISTENT MEMORY (all chat channels; newer entries override older conflicts). Saved device values are historical data, not current state or permission to execute:'
  const omitted = 'Additional saved memories are omitted from this view; do not claim they were never saved or guess missing values.'
  const budget = Number(maxChars) > 0 ? Number(maxChars) : Infinity
  const selected = []
  let used = header.length + omitted.length + 2
  for (const entry of ranked) {
    const line = `- ${entry.item.at}: ${entry.item.text.replace(/\r?\n/g, ' ')}`
    // Never expose a partial saved scene or actuator value to the model.
    if (used + line.length + 1 > budget) continue
    selected.push({ ...entry, line })
    used += line.length + 1
  }
  return [header, ...selected.sort((left, right) => left.index - right.index).map(entry => entry.line), selected.length < instructions.length ? omitted : ''].filter(Boolean).join('\n')
}

const buildCerebrumChatPromptContext = ({ context, sessionId, maxChars = 16000, currentQuestion = '', includeSharedMemory = true } = {}) => {
  const shared = normalizeCerebrumChatContext(context)
  const session = { turns: shared.turns, cameraWatches: listAllCerebrumCameraWatches(shared) }
  const boundedChars = Number(maxChars) > 0 ? Math.max(1000, Number(maxChars)) : 0
  const memoryBudget = boundedChars ? Math.min(boundedChars, Math.max(2400, Math.floor(boundedChars * 0.5))) : 0
  const sharedMemory = includeSharedMemory ? buildCerebrumSharedMemoryPromptContext({ context, currentQuestion, maxChars: memoryBudget }) : ''
  if (!sharedMemory && !session.turns.length && !session.cameraWatches.length) return ''
  if (boundedChars > 0) {
    const fixedBlocks = []
    if (sharedMemory) fixedBlocks.push(sharedMemory)
    if (session.cameraWatches.length) {
      const watchLines = [
        'ACTIVE CAMERA WATCHES:',
        ...session.cameraWatches.map(watch => {
          const camera = watch.cameraName || watch.cameraId
          const scope = watch.scopeName || watch.scopeId
          const objects = watch.objectTypes.length ? `; objects ${watch.objectTypes.join(', ')}` : ''
          return `- ${watch.id}: ${camera}; event ${watch.eventType}${scope ? `; scope ${scope}` : ''}${objects}; cooldown ${watch.cooldownSeconds}s`
        })
      ]
      fixedBlocks.push(watchLines.join('\n').slice(0, Math.max(0, Math.min(800, Math.floor(boundedChars * 0.25), boundedChars - sharedMemory.length - 2))))
    }
    const fixedText = fixedBlocks.join('\n\n')
    const turnBudget = Math.max(0, boundedChars - fixedText.length - (fixedText ? 2 : 0))
    const selectedTurns = []
    let used = 0
    for (let index = session.turns.length - 1; index >= 0; index -= 1) {
      const turn = session.turns[index]
      const renderedTurn = `[${turn.at}; channel ${turn.channel}] User: ${clampText(turn.question, 700)}\nAssistant: ${clampText(turn.reply, 1400)}`
      const nextSize = renderedTurn.length + (selectedTurns.length ? 1 : 0)
      if (used + nextSize > turnBudget) {
        if (!selectedTurns.length && turnBudget >= 200) selectedTurns.unshift(renderedTurn.slice(0, turnBudget))
        break
      }
      selectedTurns.unshift(renderedTurn)
      used += nextSize
    }
    const conversationBlock = selectedTurns.length ? `RECENT SHARED CONVERSATION (all channels; excerpts, full text in the shared archive):\n${selectedTurns.join('\n')}` : ''
    return [fixedText, conversationBlock].filter(Boolean).join('\n\n').slice(0, boundedChars)
  }
  const lines = []
  if (sharedMemory) lines.push(sharedMemory)
  if (session.turns.length) {
    if (lines.length) lines.push('')
    lines.push('RECENT SHARED CONVERSATION (all channels):')
    session.turns.forEach((turn) => {
      lines.push(`[${turn.at}; channel ${turn.channel}] User: ${turn.question}`)
      lines.push(`Assistant: ${turn.reply}`)
    })
  }
  if (session.cameraWatches.length) {
    if (lines.length) lines.push('')
    lines.push('ACTIVE CAMERA WATCHES (shared awareness; notifications retain their original recipient):')
    session.cameraWatches.forEach((watch) => {
      const camera = watch.cameraName || watch.cameraId
      const scope = watch.scopeName || watch.scopeId
      const objects = watch.objectTypes.length ? `; objects ${watch.objectTypes.join(', ')}` : ''
      lines.push(`- ${watch.id}: ${camera}; event ${watch.eventType}${scope ? `; scope ${scope}` : ''}${objects}; cooldown ${watch.cooldownSeconds}s`)
    })
  }
  const rendered = lines.join('\n')
  return rendered
}

const escapeCerebrumChatContextField = value => String(value === undefined || value === null ? '' : value)
  .replace(/\\/g, '\\\\')
  .replace(/\t/g, '\\t')
  .replace(/\r/g, '\\r')
  .replace(/\n/g, '\\n')

const unescapeCerebrumChatContextField = (value) => {
  const source = String(value === undefined || value === null ? '' : value)
  let result = ''
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]
    if (char !== '\\' || index + 1 >= source.length) {
      result += char
      continue
    }
    const next = source[index + 1]
    if (next === '\\') result += '\\'
    else if (next === 't') result += '\t'
    else if (next === 'r') result += '\r'
    else if (next === 'n') result += '\n'
    else result += `\\${next}`
    index += 1
  }
  return result
}

const buildCerebrumChatContextRecord = (type, fields = []) => [type]
  .concat(fields.map(escapeCerebrumChatContextField))
  .join('\t')

const renderCerebrumChatContextFile = (context) => {
  const target = normalizeCerebrumChatContext(context)
  target.updatedAt = new Date().toISOString()
  const lines = [
    '# Cerebrum native chat-learning context',
    '# Tab-separated records. Escapes: \\\\ (backslash), \\t (tab), \\n (newline), \\r (carriage return).',
    '# Shared working view. Complete history is retained in shared/cerebrum-memory.jsonl.',
    '# GLOBAL_INSTRUCTION and GLOBAL_TURN are shared across channels. SESSION retains camera notification routing only.',
    buildCerebrumChatContextRecord(CHAT_CONTEXT_NATIVE_HEADER, [CHAT_CONTEXT_VERSION]),
    buildCerebrumChatContextRecord('CREATED_AT', [target.createdAt]),
    buildCerebrumChatContextRecord('UPDATED_AT', [target.updatedAt])
  ]
  target.instructions.forEach(item => lines.push(buildCerebrumChatContextRecord('GLOBAL_INSTRUCTION', [item.at, item.text])))
  target.turns.forEach(turn => lines.push(buildCerebrumChatContextRecord('GLOBAL_TURN', [turn.at, turn.channel, turn.question, turn.reply])))
  target.sessions.forEach((session) => {
    lines.push(buildCerebrumChatContextRecord('SESSION', [session.id, session.updatedAt]))
    session.turns.forEach(turn => lines.push(buildCerebrumChatContextRecord('TURN', [turn.at, turn.question, turn.reply])))
    session.cameraWatches.forEach((watch) => {
      lines.push(buildCerebrumChatContextRecord('CAMERA_WATCH', [
        watch.id,
        watch.createdAt,
        watch.cameraId,
        watch.cameraName,
        watch.eventType,
        watch.scopeId,
        watch.scopeName,
        watch.cooldownSeconds,
        watch.sendSnapshot ? 'true' : 'false',
        watch.language
      ].concat(watch.objectTypes)))
    })
    lines.push('END_SESSION')
  })
  return { content: `${lines.join('\n')}\n`, context: target }
}

const buildCerebrumChatContextFile = ({ context, maxBytes = CHAT_CONTEXT_MAX_BYTES } = {}) => {
  const targetBytes = Math.max(64 * 1024, Math.min(CHAT_CONTEXT_MAX_BYTES, Number(maxBytes) || CHAT_CONTEXT_MAX_BYTES))
  let bounded = normalizeCerebrumChatContext(context)
  let rendered = renderCerebrumChatContextFile(bounded)
  while (Buffer.byteLength(rendered.content, 'utf8') > targetBytes) {
    if (bounded.turns.length) bounded.turns.shift()
    else if (bounded.sessions.length > 0) bounded.sessions.shift()
    else {
      throw new Error('Shared memory exceeds the file limit; forget unused entries before saving more')
    }
    rendered = renderCerebrumChatContextFile(bounded)
    bounded = rendered.context
  }
  return {
    content: rendered.content,
    context: rendered.context,
    bytes: Buffer.byteLength(rendered.content, 'utf8'),
    maxBytes: targetBytes
  }
}

const parseCerebrumChatContextFileStrict = (content, { onTurn, onInstruction } = {}) => {
  const source = String(content || '')
  const context = { version: CHAT_CONTEXT_VERSION, createdAt: '', updatedAt: '', instructions: [], turns: [], sessions: [] }
  let headerSeen = false
  let currentSession = null

  source.split(/\r?\n/).forEach((line, lineIndex) => {
    if (!line.trim() || line.trimStart().startsWith('#')) return
    const fields = line.split('\t').map(unescapeCerebrumChatContextField)
    const record = fields.shift()
    const fail = message => { throw new Error(`Invalid Cerebrum native chat-learning context at line ${lineIndex + 1}: ${message}`) }

    if (!headerSeen) {
      if (record !== CHAT_CONTEXT_NATIVE_HEADER || !['3', String(CHAT_CONTEXT_VERSION)].includes(String(fields[0] || ''))) {
        fail(`expected ${CHAT_CONTEXT_NATIVE_HEADER} ${CHAT_CONTEXT_VERSION} header`)
      }
      context.version = Number(fields[0])
      headerSeen = true
      return
    }

    if (record === 'CREATED_AT') {
      if (currentSession) fail('CREATED_AT is not allowed inside a session')
      context.createdAt = fields[0] || ''
      return
    }
    if (record === 'UPDATED_AT') {
      if (currentSession) fail('UPDATED_AT is not allowed inside a session')
      context.updatedAt = fields[0] || ''
      return
    }
    if (record === 'SESSION') {
      if (currentSession) fail('nested SESSION record')
      if (!String(fields[0] || '').trim()) fail('SESSION id is required')
      currentSession = {
        id: fields[0],
        updatedAt: fields[1] || '',
        turns: [],
        instructions: [],
        cameraWatches: []
      }
      return
    }
    if (record === 'END_SESSION') {
      if (!currentSession) fail('END_SESSION without SESSION')
      context.sessions.push(currentSession)
      currentSession = null
      return
    }
    if (record === 'GLOBAL_INSTRUCTION') {
      if (context.version < 4 || currentSession) fail('GLOBAL_INSTRUCTION requires a v4 record outside a session')
      if (fields.length !== 2 || !String(fields[1] || '').trim()) fail('GLOBAL_INSTRUCTION requires timestamp and text')
      if (fields[1].trim().length > CHAT_CONTEXT_MAX_INSTRUCTION_CHARS) fail('GLOBAL_INSTRUCTION exceeds 2000 characters')
      context.instructions.push({ at: fields[0], text: fields[1] })
      if (onInstruction) onInstruction({ at: fields[0], text: fields[1] })
      return
    }
    if (record === 'GLOBAL_TURN') {
      if (context.version < 4 || currentSession) fail('GLOBAL_TURN requires a v4 record outside a session')
      if (fields.length !== 4) fail('GLOBAL_TURN requires timestamp, channel, question and reply')
      context.turns.push({ at: fields[0], channel: fields[1], question: fields[2], reply: fields[3] })
      if (onTurn) onTurn(context.turns[context.turns.length - 1])
      return
    }
    if (!currentSession) fail(`${record || 'empty record'} is not allowed outside a session`)
    if (record === 'INSTRUCTION') {
      if (fields.length < 2 || !String(fields[1] || '').trim()) fail('INSTRUCTION requires timestamp and text')
      currentSession.instructions.push({ at: fields[0], text: fields[1] })
      if (onInstruction) onInstruction({ at: fields[0], channel: currentSession.id, text: fields[1] })
      return
    }
    if (record === 'TURN') {
      if (fields.length < 3 || (!String(fields[1] || '').trim() && !String(fields[2] || '').trim())) {
        fail('TURN requires timestamp, question and reply')
      }
      currentSession.turns.push({ at: fields[0], question: fields[1], reply: fields[2] })
      if (onTurn) onTurn({ at: fields[0], channel: currentSession.id, question: fields[1], reply: fields[2] })
      return
    }
    if (record === 'CAMERA_WATCH') {
      if (fields.length < 10) fail('CAMERA_WATCH has missing fields')
      if (fields[8] !== 'true' && fields[8] !== 'false') fail('CAMERA_WATCH sendSnapshot must be true or false')
      currentSession.cameraWatches.push({
        id: fields[0],
        createdAt: fields[1],
        cameraId: fields[2],
        cameraName: fields[3],
        eventType: fields[4],
        scopeId: fields[5],
        scopeName: fields[6],
        cooldownSeconds: Number(fields[7]),
        sendSnapshot: fields[8] === 'true',
        language: fields[9],
        objectTypes: fields.slice(10)
      })
      return
    }
    fail(`unknown ${record || 'empty'} record`)
  })

  if (!headerSeen) throw new Error(`The file does not contain a ${CHAT_CONTEXT_NATIVE_HEADER} ${CHAT_CONTEXT_VERSION} header`)
  if (currentSession) throw new Error('Invalid Cerebrum native chat-learning context: SESSION without END_SESSION')
  if (!context.createdAt || !context.updatedAt) throw new Error('Invalid Cerebrum native chat-learning context: CREATED_AT and UPDATED_AT are required')
  return normalizeCerebrumChatContext(context)
}

const parseCerebrumChatContextFile = (content) => {
  try {
    return parseCerebrumChatContextFileStrict(content)
  } catch (error) {
    return createEmptyCerebrumChatContext()
  }
}

const conversationMapFromCerebrumChatContext = (context) => {
  const result = new Map()
  result.set('shared', normalizeCerebrumChatContext(context).turns.map(turn => ({ question: turn.question, reply: turn.reply })))
  return result
}

module.exports = {
  CHAT_CONTEXT_MAX_CAMERA_WATCHES_PER_SESSION,
  CHAT_CONTEXT_MAX_BYTES,
  CHAT_CONTEXT_MAX_INSTRUCTIONS_PER_SESSION,
  CHAT_CONTEXT_MAX_SESSIONS,
  CHAT_CONTEXT_MAX_SHARED_INSTRUCTIONS,
  CHAT_CONTEXT_MAX_TURNS_PER_SESSION,
  addCerebrumCameraWatch,
  addCerebrumChatInstruction,
  addCerebrumChatTurn,
  buildCerebrumChatContextFile,
  buildCerebrumChatPromptContext,
  buildCerebrumSharedMemoryPromptContext,
  clearCerebrumChatSession,
  conversationMapFromCerebrumChatContext,
  createEmptyCerebrumChatContext,
  getCerebrumChatSession,
  listAllCerebrumCameraWatches,
  listCerebrumCameraWatches,
  normalizeCerebrumChatContext,
  normalizeCameraWatch,
  parseCerebrumChatContextFile,
  parseCerebrumChatContextFileStrict,
  removeCerebrumCameraWatches,
  removeCerebrumChatInstructions
}
