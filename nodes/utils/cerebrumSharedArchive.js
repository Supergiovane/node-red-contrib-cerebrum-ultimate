'use strict'

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const readline = require('readline')
const { StringDecoder } = require('string_decoder')

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
      if (record.version !== 1 || record.id !== `m${position}` || typeof record.kind !== 'string' || !Object.hasOwn(record, 'data')) throw new Error('Invalid shared memory archive record')
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

// One append-only, fsynced household archive. Channel IDs are provenance and
// reply routing, never read partitions. Only prompt/query results are bounded.
function createCerebrumSharedArchive (filePath) {
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

  function append ({ kind, nodeId = '', channel = '', at = new Date().toISOString(), data }) {
    const fd = fs.openSync(filePath, 'a', 0o600)
    try {
      const position = fs.fstatSync(fd).size
      const record = { version: 1, id: `m${position}`, at, kind, nodeId, channel, data }
      const bytes = Buffer.from(`${stringify(record)}\n`)
      let written = 0
      try {
        while (written < bytes.length) written += fs.writeSync(fd, bytes, written, bytes.length - written)
        fs.fsyncSync(fd)
      } catch (error) {
        fs.ftruncateSync(fd, position)
        throw error
      }
      return record
    } finally { fs.closeSync(fd) }
  }

  const snapshotBytes = () => fs.existsSync(filePath) ? fs.statSync(filePath).size : 0

  async function query ({ operation = 'search', text = '', kind = 'any', offset = 0, limit = 6, maxChars = 6000, snapshotBytes: requestedSnapshot } = {}) {
    if (!['search', 'get'].includes(operation)) return { ok: false, error: 'Use search or get.' }
    if (operation === 'get' && (!/^m\d+$/.test(text) || !Number.isSafeInteger(Number(text.slice(1))))) return { ok: false, error: 'get requires an exact archive record id (m followed by digits).' }
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
    const size = Math.min(fs.statSync(filePath).size, Number.isSafeInteger(requestedSnapshot) && requestedSnapshot >= 0 ? requestedSnapshot : Infinity)
    const position = operation === 'get' ? Number(text.slice(1)) : 0
    if (!size || position >= size) return operation === 'get' ? { ok: false, error: 'Archive record not found.' } : { ok: true, items: [], totalMatches: 0, nextOffset: null }
    const input = fs.createReadStream(filePath, { start: position, end: size - 1 })
    const lines = readline.createInterface({ input, crlfDelay: Infinity })
    try {
      for await (const line of lines) {
        if (!line) continue
        const record = JSON.parse(line)
        if (record.version !== 1 || !/^m\d+$/.test(record.id)) throw new Error('Invalid shared memory archive record')
        if (operation === 'get') {
          if (record.id !== text) return { ok: false, error: 'Archive record not found.' }
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
        candidates.push({ record, content, score, position: Number(record.id.slice(1)) })
        candidates.sort((left, right) => right.score - left.score || right.position - left.position)
        if (candidates.length > start + count) candidates.pop()
      }
    } catch (error) {
      return { ok: false, error: `Unable to read shared memory: ${error.message}` }
    } finally { lines.close(); input.destroy() }
    if (operation === 'get') return { ok: false, error: 'Archive record not found.' }
    const items = candidates.slice(start, start + count).map(({ record, content }) => {
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

  return { filePath, recoveredBytes, append, query, snapshotBytes }
}

module.exports = { createCerebrumSharedArchive, validateCerebrumSharedArchive }
