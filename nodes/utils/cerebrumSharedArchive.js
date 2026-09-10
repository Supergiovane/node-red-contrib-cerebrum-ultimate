'use strict'

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const readline = require('readline')
const { StringDecoder } = require('string_decoder')

const pendingPrunes = new Map()
const recordIdPattern = /^m(?:\d+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/
const sameFile = (left, right) => left.dev === right.dev && left.ino === right.ino
const PRUNE_YIELD_BYTES = 65536
const PRUNE_BACKOFF_MS = 10
const yieldDuringPrune = () => new Promise(resolve => setTimeout(resolve, PRUNE_BACKOFF_MS))
const cancelledPruneResult = () => ({ removed: 0, reclaimedBytes: 0, cancelled: true })
const isPruneCancelled = callback => typeof callback === 'function' && callback() === true
const retentionView = stat => ({ dev: stat.dev, ino: stat.ino, size: stat.size, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs })
const matchesRetentionView = (view, stat) => view && Object.keys(retentionView(stat)).every(key => view[key] === stat[key])
const recordTime = record => {
  const at = typeof record.at === 'string' ? Date.parse(record.at) : NaN
  return Number.isFinite(at) ? at : null
}
const earlierTime = (left, right) => left === null ? right : right === null ? left : Math.min(left, right)

function validateRecord (record, position) {
  const validIdentity = record?.version === 1
    ? record.id === `m${position}`
    : record?.version === 2 && recordIdPattern.test(record.id) && record.offset === position
  if (!validIdentity || typeof record.kind !== 'string' || !Object.hasOwn(record, 'data')) throw new Error('Invalid shared memory archive record')
}

// Stream one chunk at a time; callers may yield between records without loading
// the entire archive. Offsets are UTF-8 byte offsets, including the newline.
function * readArchiveLines (fd, from, to) {
  const buffer = Buffer.alloc(65536)
  const decoder = new StringDecoder('utf8')
  let remainder = ''
  let position = from
  let cursor = from
  while (cursor < to) {
    const length = fs.readSync(fd, buffer, 0, Math.min(buffer.length, to - cursor), cursor)
    if (!length) throw new Error('Shared memory archive changed while reading')
    cursor += length
    remainder += decoder.write(buffer.subarray(0, length))
    let end
    while ((end = remainder.indexOf('\n')) >= 0) {
      const line = remainder.slice(0, end)
      remainder = remainder.slice(end + 1)
      yield { line, position }
      position += Buffer.byteLength(line + '\n')
    }
  }
  remainder += decoder.end()
  if (remainder) throw new Error('Incomplete shared memory archive record')
}

const normalizeSearch = value => String(value || '').normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase()
const words = value => [...new Set(normalizeSearch(value).match(/[\p{L}\p{N}/._-]{2,}/gu) || [])]
const stringify = value => JSON.stringify(value, (key, item) => typeof item === 'bigint' ? String(item) : item)

function validateCerebrumSharedArchive ({ filePath, content } = {}) {
  let remainder = ''
  let position = 0
  const consume = chunk => {
    remainder += chunk
    let end
    while ((end = remainder.indexOf('\n')) >= 0) {
      const line = remainder.slice(0, end)
      remainder = remainder.slice(end + 1)
      let record
      try { record = JSON.parse(line) } catch (error) { throw new Error('Invalid shared memory archive JSON') }
      validateRecord(record, position)
      position += Buffer.byteLength(line + '\n')
    }
  }
  if (filePath) {
    const fd = fs.openSync(filePath, 'r')
    const decoder = new StringDecoder('utf8')
    const buffer = Buffer.alloc(65536)
    try {
      let length
      while ((length = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) consume(decoder.write(buffer.subarray(0, length)))
      consume(decoder.end())
    } finally { fs.closeSync(fd) }
  } else consume(String(content || ''))
  if (remainder) throw new Error('Incomplete shared memory archive record')
}

// One fsynced household archive. Channel IDs are provenance and reply routing,
// never read partitions. Retention compacts atomically and preserves record IDs.
function createCerebrumSharedArchive (filePath) {
  filePath = path.resolve(filePath)
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  let recoveredBytes = 0
  if (fs.existsSync(filePath) && fs.statSync(filePath).size) {
    const fd = fs.openSync(filePath, 'r+')
    try {
      const size = fs.fstatSync(fd).size
      const last = Buffer.alloc(1)
      fs.readSync(fd, last, 0, 1, size - 1)
      if (last[0] !== 10) {
        let cursor = size
        let boundary = 0
        const buffer = Buffer.alloc(65536)
        while (cursor > 0) {
          const length = Math.min(buffer.length, cursor)
          cursor -= length
          fs.readSync(fd, buffer, 0, length, cursor)
          const newline = buffer.subarray(0, length).lastIndexOf(10)
          if (newline >= 0) { boundary = cursor + newline + 1; break }
        }
        // Preserve the complete original file before removing an incomplete tail.
        fs.copyFileSync(filePath, `${filePath}.incomplete-${crypto.randomUUID()}`)
        recoveredBytes = size - boundary
        fs.ftruncateSync(fd, boundary)
        fs.fsyncSync(fd)
      }
    } finally { fs.closeSync(fd) }
  }

  // This disposable checkpoint only avoids a scan when the exact file version
  // is known to contain no expired timestamps. Appends update the bound in RAM;
  // clean shutdown saves it. A crash, external edit or restore invalidates it.
  const retentionFile = `${filePath}.retention-state.json`
  let retentionState
  const loadRetentionState = stat => {
    if (retentionState && matchesRetentionView(retentionState.view, stat)) return retentionState
    retentionState = undefined
    try {
      if (fs.statSync(retentionFile).size > 4096) return
      const saved = JSON.parse(fs.readFileSync(retentionFile, 'utf8'))
      if (saved.version === 1 && (saved.oldestAt === null || Number.isFinite(saved.oldestAt)) && matchesRetentionView(saved.view, stat)) retentionState = saved
    } catch (error) { /* A missing/stale cache requires a normal archive scan. */ }
    return retentionState
  }
  if (fs.existsSync(filePath)) loadRetentionState(fs.statSync(filePath))

  function checkpointRetention () {
    const temporary = `${retentionFile}.${crypto.randomUUID()}.tmp`
    try {
      if (!retentionState || !matchesRetentionView(retentionState.view, fs.statSync(filePath))) return false
      const fd = fs.openSync(temporary, 'wx', 0o600)
      try {
        fs.writeFileSync(fd, JSON.stringify(retentionState))
        fs.fsyncSync(fd)
      } finally { fs.closeSync(fd) }
      fs.renameSync(temporary, retentionFile)
      return true
    } catch (error) {
      // This is an optimization, never the authoritative archive or a reason
      // to reject a successfully persisted event or prevent clean shutdown.
      return false
    } finally {
      try { if (fs.existsSync(temporary)) fs.unlinkSync(temporary) } catch (error) { /* optional cache */ }
    }
  }

  function appendMany (entries) {
    if (!Array.isArray(entries)) throw new TypeError('Shared memory archive batch must be an array')
    if (!entries.length) return []
    // Prepare caller data before touching the archive. A malformed value (for
    // example circular JSON) must not leave a prefix of the batch on disk.
    const prepared = entries.map(({ kind, nodeId = '', channel = '', at = new Date().toISOString(), data }) => ({
      version: 2,
      id: `m${crypto.randomUUID()}`,
      at,
      kind,
      nodeId,
      channel,
      data
    }))
    const fd = fs.openSync(filePath, 'a', 0o600)
    try {
      const initial = fs.fstatSync(fd)
      const position = initial.size
      let known = position === 0 || (retentionState && matchesRetentionView(retentionState.view, initial))
      let oldestAt = position === 0 ? null : retentionState?.oldestAt
      let nextPosition = position
      const records = []
      const chunks = prepared.map(entry => {
        // IDs no longer depend on the current physical offset: compaction must
        // not redirect saved evidence references or reuse IDs of deleted records.
        const record = { version: 2, id: entry.id, offset: nextPosition, at: entry.at, kind: entry.kind, nodeId: entry.nodeId, channel: entry.channel, data: entry.data }
        const serialized = stringify(record)
        // Nonstandard caller metadata (for example Date.toJSON) and omitted
        // data must go through the normal validating scan before being cached.
        if (![record.at, record.kind, record.nodeId, record.channel].every(value => typeof value === 'string') || !serialized.includes(',"data":')) known = false
        const bytes = Buffer.from(`${serialized}\n`)
        records.push(record)
        nextPosition += bytes.length
        return bytes
      })
      const bytes = Buffer.concat(chunks, nextPosition - position)
      let written = 0
      try {
        while (written < bytes.length) {
          const length = fs.writeSync(fd, bytes, written, bytes.length - written)
          if (!Number.isInteger(length) || length <= 0) throw new Error('Unable to append shared memory archive batch')
          written += length
        }
        fs.fsyncSync(fd)
      } catch (error) {
        try {
          fs.ftruncateSync(fd, position)
          fs.fsyncSync(fd)
        } catch (rollbackError) {
          throw new AggregateError([error, rollbackError], 'Unable to append or roll back shared memory archive batch')
        }
        throw error
      }
      if (known) {
        for (const record of records) oldestAt = earlierTime(oldestAt, recordTime(record))
        retentionState = { version: 1, view: retentionView(fs.fstatSync(fd)), oldestAt }
      } else retentionState = undefined
      return records
    } finally { fs.closeSync(fd) }
  }

  // Keep the original single-record contract while sharing the durable batch
  // path, so every successful call still returns exactly one archive record.
  function append (entry) {
    return appendMany([entry])[0]
  }

  const snapshotBytes = () => fs.existsSync(filePath) ? fs.statSync(filePath).size : 0
  const snapshot = () => {
    if (!fs.existsSync(filePath)) return { bytes: 0, dev: null, ino: null }
    const stat = fs.statSync(filePath)
    return { bytes: stat.size, dev: stat.dev, ino: stat.ino }
  }
  // Search results normally precede get calls. Keep only a small, replaceable
  // location cache so retrieving a complete record does not rescan the archive.
  const locations = new Map()
  let locationSnapshot
  const rememberLocation = (id, position, view) => {
    if (!sameFile(locationSnapshot, view)) return
    locations.delete(id)
    locations.set(id, position)
    if (locations.size > 128) locations.delete(locations.keys().next().value)
  }

  function prune ({ retentionDays, now = Date.now(), isCancelled } = {}) {
    if (!Number.isInteger(retentionDays) || retentionDays < 1 || !Number.isFinite(now)) return Promise.reject(new Error('Invalid shared memory retention'))
    if (isPruneCancelled(isCancelled)) return Promise.resolve(cancelledPruneResult())
    const running = pendingPrunes.get(filePath)
    if (running) return running.retentionDays <= retentionDays ? running.promise : running.promise.then(() => prune({ retentionDays, now, isCancelled }))
    const pending = compact(retentionDays, now, isCancelled).finally(() => pendingPrunes.delete(filePath))
    pendingPrunes.set(filePath, { retentionDays, promise: pending })
    return pending
  }

  async function compact (retentionDays, now, isCancelled) {
    if (isPruneCancelled(isCancelled)) return cancelledPruneResult()
    if (!fs.existsSync(filePath)) return { removed: 0, reclaimedBytes: 0 }
    const cutoff = now - retentionDays * 86400000
    const temporary = `${filePath}.retention-${crypto.randomUUID()}.tmp`
    const source = fs.openSync(filePath, 'r')
    let target
    let removed = 0
    let outputBytes = 0
    try {
      const initial = fs.fstatSync(source)
      const known = loadRetentionState(initial)
      if (known && (known.oldestAt === null || known.oldestAt >= cutoff)) {
        checkpointRetention()
        return { removed: 0, reclaimedBytes: 0 }
      }
      const expired = record => {
        const at = recordTime(record)
        // Unknown timestamps are not evidence of expiry.
        return at !== null && at < cutoff
      }
      let needsCompaction = false
      let oldestAt = null
      let lastYield = 0
      for (const { line, position } of readArchiveLines(source, 0, initial.size)) {
        const record = JSON.parse(line)
        validateRecord(record, position)
        if (expired(record)) { needsCompaction = true; break }
        oldestAt = earlierTime(oldestAt, recordTime(record))
        if (position - lastYield >= PRUNE_YIELD_BYTES) {
          lastYield = position
          await yieldDuringPrune()
          if (isPruneCancelled(isCancelled)) return cancelledPruneResult()
        }
      }
      if (!needsCompaction) {
        // Include appends made while the scan yielded, even backdated ones from
        // another instance. Finish this tail and save its bound in one turn.
        const current = fs.statSync(filePath)
        if (!sameFile(initial, current) || current.size < initial.size) throw new Error('Shared memory archive replaced during retention; cleanup deferred')
        for (const { line, position } of readArchiveLines(source, initial.size, current.size)) {
          const record = JSON.parse(line)
          validateRecord(record, position)
          if (expired(record)) { needsCompaction = true; break }
          oldestAt = earlierTime(oldestAt, recordTime(record))
        }
        if (!needsCompaction) {
          retentionState = { version: 1, view: retentionView(current), oldestAt }
          checkpointRetention()
          return { removed: 0, reclaimedBytes: 0 }
        }
      }
      if (isPruneCancelled(isCancelled)) return cancelledPruneResult()
      target = fs.openSync(temporary, 'wx', 0o600)
      oldestAt = null
      const copy = ({ line, position }) => {
        const record = JSON.parse(line)
        validateRecord(record, position)
        if (expired(record)) { removed++; return }
        oldestAt = earlierTime(oldestAt, recordTime(record))
        const bytes = Buffer.from(`${stringify({ ...record, version: 2, offset: outputBytes })}\n`)
        let written = 0
        while (written < bytes.length) written += fs.writeSync(target, bytes, written, bytes.length - written)
        outputBytes += bytes.length
      }
      lastYield = 0
      for (const entry of readArchiveLines(source, 0, initial.size)) {
        copy(entry)
        if (entry.position - lastYield >= PRUNE_YIELD_BYTES) {
          lastYield = entry.position
          await yieldDuringPrune()
          if (isPruneCancelled(isCancelled)) return cancelledPruneResult()
        }
      }
      // Appends are synchronous. Copy the newly appended tail and rename in one
      // event-loop turn so other nodes sharing this file cannot lose a write.
      const current = fs.statSync(filePath)
      if (!sameFile(initial, current) || current.size < initial.size) throw new Error('Shared memory archive replaced during retention; cleanup deferred')
      for (const entry of readArchiveLines(source, initial.size, current.size)) copy(entry)
      if (isPruneCancelled(isCancelled)) return cancelledPruneResult()
      if (!removed) return { removed: 0, reclaimedBytes: 0 }
      fs.fsyncSync(target)
      fs.closeSync(target)
      target = undefined
      fs.renameSync(temporary, filePath)
      retentionState = { version: 1, view: retentionView(fs.statSync(filePath)), oldestAt }
      checkpointRetention()
      return { removed, reclaimedBytes: current.size - outputBytes }
    } finally {
      fs.closeSync(source)
      if (target !== undefined) fs.closeSync(target)
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary)
    }
  }

  async function query ({ operation = 'search', text = '', kind = 'any', offset = 0, limit = 6, maxChars = 6000, snapshot: requestedView, snapshotBytes: requestedSnapshot } = {}) {
    if (!['search', 'get'].includes(operation)) return { ok: false, error: 'Use search or get.' }
    if (operation === 'get' && !recordIdPattern.test(text)) return { ok: false, error: 'get requires an exact archive record id returned by search.' }
    const start = Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Math.floor(Number(offset) || 0)))
    const count = Math.max(1, Math.min(12, Math.floor(Number(limit) || 6)))
    const chunkChars = Math.max(256, Math.min(6000, Math.floor(Number(maxChars) || 6000)))
    const excerptChars = Math.min(1200, chunkChars)
    const queryWords = words(text)
    const candidates = []
    let matches = 0
    if (!fs.existsSync(filePath)) return { ok: true, items: [], totalMatches: 0, nextOffset: null }
    // Pin a reasoning request's archive view so its own tool logs/new traffic do
    // not reorder search pages or make identical queries appear to gain evidence.
    const current = snapshot()
    if (requestedView && !sameFile(current, requestedView)) return { ok: false, error: 'Archive retention or restore changed this search snapshot. Start a new search.', snapshotExpired: true }
    if (!locationSnapshot || !sameFile(current, locationSnapshot) || current.bytes < locationSnapshot.bytes) locations.clear()
    locationSnapshot = current
    const requestedBytes = requestedView ? requestedView.bytes : requestedSnapshot
    const size = Math.min(current.bytes, Number.isSafeInteger(requestedBytes) && requestedBytes >= 0 ? requestedBytes : Infinity)
    if (!size) return operation === 'get' ? { ok: false, error: 'Archive record not found.' } : { ok: true, items: [], totalMatches: 0, nextOffset: null }
    // Open synchronously to pin this inode before a concurrent compaction rename.
    const fd = fs.openSync(filePath, 'r')
    let position = operation === 'get' ? (locations.get(text) || 0) : 0
    if (position >= size) { fs.closeSync(fd); return { ok: false, error: 'Archive record not found.' } }
    const input = fs.createReadStream(filePath, { fd, start: position, end: size - 1 })
    const lines = readline.createInterface({ input, crlfDelay: Infinity })
    try {
      for await (const line of lines) {
        if (!line) continue
        const record = JSON.parse(line)
        validateRecord(record, position)
        const recordPosition = position
        position += Buffer.byteLength(line + '\n')
        if (operation === 'get') {
          if (record.id !== text) continue
          rememberLocation(record.id, recordPosition, current)
          const content = stringify(record.data)
          const end = Math.min(content.length, start + chunkChars)
          return { ok: true, id: record.id, at: record.at, kind: record.kind, channel: record.channel, content: content.slice(start, end), format: 'json', offset: start, nextOffset: end < content.length ? end : null, complete: start === 0 && end === content.length }
        }
        if (kind !== 'any' && record.kind !== kind) continue
        const content = stringify(record.data)
        const document = normalizeSearch(content)
        const score = queryWords.reduce((sum, word) => sum + (document.includes(word) ? word.length : 0), 0)
        if (queryWords.length && !score) continue
        matches++
        candidates.push({ record, content, score, position: recordPosition })
        candidates.sort((left, right) => right.score - left.score || right.position - left.position)
        if (candidates.length > start + count) candidates.pop()
      }
    } catch (error) {
      return { ok: false, error: `Unable to read shared memory: ${error.message}` }
    } finally { lines.close(); input.destroy() }
    if (operation === 'get') return { ok: false, error: 'Archive record not found.' }
    const items = candidates.slice(start, start + count).map(({ record, content, position }) => {
      rememberLocation(record.id, position, current)
      const document = normalizeSearch(content)
      const match = queryWords.slice().sort((left, right) => right.length - left.length).find(word => document.includes(word))
      const excerptOffset = match ? Math.max(0, document.indexOf(match) - 200) : 0
      return {
        id: record.id,
        at: record.at,
        kind: record.kind,
        channel: record.channel,
        ...(content.length <= excerptChars ? { data: record.data, complete: true } : { excerpt: content.slice(excerptOffset, excerptOffset + excerptChars), excerptOffset, complete: false })
      }
    })
    return { ok: true, items, totalMatches: matches, offset: start, nextOffset: start + items.length < matches ? start + items.length : null }
  }

  return { filePath, recoveredBytes, append, appendMany, query, snapshotBytes, snapshot, prune, checkpointRetention }
}

module.exports = { createCerebrumSharedArchive, validateCerebrumSharedArchive }
