'use strict'

const yauzl = require('yauzl')
const yazl = require('yazl')
const crc32 = require('buffer-crc32')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { Readable, Transform, Writable } = require('stream')
const { pipeline } = require('stream/promises')
const { StringDecoder } = require('string_decoder')
const { MAX_BACKUP_BYTES, mapBackupArchives, assertBackupSize, createBackupDirectory, registerBackupCleanup, disposeBackup, registerBackupArchive, backupArchiveSource, validateFile } = require('./cerebrumBackup')

const BACKUP_ENTRY = 'cerebrum-backup.json'
const allowedEntries = new Set([BACKUP_ENTRY, 'cerebrum-flows.json', 'required-packages.json', 'README.txt'])
const archiveEntryPattern = /^archives\/(history|adapterHistory|operations)\/\d{4}-\d{2}-\d{2}\.(?:knxctx|jsonl)$/
const MAX_ENTRIES = 1024
const invalidBackup = message => Object.assign(new Error(message), { status: 400 })
const tooLarge = () => Object.assign(new Error('Backup JSON metadata exceeds 256 MiB'), { status: 413 })

function parseBackup (content, fromZip = false) {
  let backup
  try { backup = JSON.parse(content.toString('utf8').replace(/^\uFEFF/, '')) } catch (error) {
    throw invalidBackup('Invalid Cerebrum backup JSON')
  }
  if (!backup || backup.format !== 'cerebrum-ultimate-backup' || !(fromZip ? [1, 2, 3] : [1, 2]).includes(backup.version)) throw invalidBackup('Unsupported Cerebrum backup')
  return backup
}

function * utf8Chunks (content) {
  for (let start = 0; start < content.length;) {
    let end = Math.min(start + 65536, content.length)
    // Keep surrogate pairs together at chunk boundaries.
    const last = content.charCodeAt(end - 1)
    if (end < content.length && last >= 0xd800 && last <= 0xdbff) end--
    yield Buffer.from(content.slice(start, end), 'utf8')
    start = end
  }
}

function createBackupZipStream (backup) {
  if (!backup || backup.format !== 'cerebrum-ultimate-backup' || ![1, 2].includes(backup.version)) throw invalidBackup('Unsupported Cerebrum backup')
  assertBackupSize(backup)
  const archives = new Map()
  // Version 3 keeps daily archives as independent ZIP entries. The manifest
  // stays small and no full-size escaped JSON copy of the histories is needed.
  const manifest = backup.version === 2
    ? mapBackupArchives(backup, (file, group) => {
      const zipEntry = `archives/${group}/${file.name}`
      if (!archiveEntryPattern.test(zipEntry) || archives.has(zipEntry)) throw invalidBackup('Invalid or duplicate backup archive')
      archives.set(zipEntry, file)
      const { content, ...info } = file
      return { ...info, zipEntry }
    })
    : { ...backup }
  if (manifest.version === 2) manifest.version = 3
  const content = Buffer.from(JSON.stringify(manifest, null, 2), 'utf8')
  if (content.length > MAX_BACKUP_BYTES) throw tooLarge()
  const entries = new Map([[BACKUP_ENTRY, content]])
  if (backup.version === 2) {
    const flows = validateFile(backup.migration?.flows, 'nodeRedFlows')
    if (!Array.isArray(JSON.parse(flows))) throw invalidBackup('Invalid Node-RED migration flows')
    entries.set('cerebrum-flows.json', Buffer.from(flows, 'utf8'))
    entries.set('required-packages.json', Buffer.from(JSON.stringify(backup.migration.dependencies || {}, null, 2), 'utf8'))
  }
  entries.set('README.txt', Buffer.from([
    'Cerebrum Ultimate backup',
    '',
    'RESTORE / RIPRISTINO',
    'In the selected Cerebrum node: Web UI > Settings > Restore ZIP. Select this ZIP without extracting it.',
    'Nel nodo Cerebrum selezionato: Web UI > Impostazioni > Ripristina ZIP. Seleziona questo ZIP senza estrarlo.',
    'The restore replaces Cerebrum data and archives, including shared learning and home memory.',
    'Il ripristino sostituisce dati e archivi Cerebrum, inclusi apprendimento e memoria condivisi.',
    '',
    'MOVE TO ANOTHER INSTALLATION / TRASFERIMENTO',
    'Install the packages in required-packages.json. Import cerebrum-flows.json in the Node-RED editor, review connections and deploy. Then restore this ZIP from the imported Cerebrum node.',
    'Installa i pacchetti in required-packages.json. Importa cerebrum-flows.json nell’editor Node-RED, controlla i collegamenti ed esegui il deploy. Poi ripristina questo ZIP dal nodo Cerebrum importato.',
    'Preserve source node IDs where possible. Re-enter the AI provider API key and verify external service settings.',
    'Mantieni gli ID dei nodi originali quando possibile. Reinserisci la chiave API del provider AI e verifica le impostazioni dei servizi esterni.',
    '',
    'Cerebrum restore does not deploy Node-RED flows. Version 3 requires restoring the complete ZIP in a compatible Cerebrum version; its JSON manifest alone is not a complete backup.',
    'Il ripristino Cerebrum non esegue il deploy dei flow Node-RED. La versione 3 richiede il ripristino dello ZIP completo in una versione compatibile di Cerebrum; il solo manifest JSON non è un backup completo.',
    'AI provider API keys are excluded. Other integration credentials are included: keep this unencrypted backup private.',
    'Le chiavi API dei provider AI sono escluse. Le credenziali delle altre integrazioni sono incluse: conserva questo backup non cifrato in modo riservato.',
    '',
    ...(backup.migration?.warnings || []),
    ...(backup.migration?.instructions || [])
  ].join('\n'), 'utf8'))

  const zip = new yazl.ZipFile()
  if (entries.size + archives.size > MAX_ENTRIES) throw invalidBackup('Too many files in backup ZIP')
  zip.on('error', error => zip.outputStream.destroy(error))
  for (const [name, bytes] of entries) zip.addBuffer(bytes, name, { compressionLevel: 6 })
  const streams = new Set()
  zip.outputStream.on('close', () => { for (const stream of streams) stream.destroy() })
  for (const [name, file] of archives) {
    zip.addReadStreamLazy(name, { size: file.bytes, compressionLevel: 6 }, callback => {
      const source = backupArchiveSource(file)
      const stream = source ? fs.createReadStream(source) : Readable.from(utf8Chunks(file.content))
      streams.add(stream)
      stream.on('close', () => streams.delete(stream))
      callback(null, stream)
    })
  }
  zip.end()
  return zip.outputStream
}

async function createBackupZipFile (backup) {
  const temporary = createBackupDirectory()
  const filePath = path.join(temporary.directory, 'backup.zip')
  try {
    await pipeline(createBackupZipStream(backup), fs.createWriteStream(filePath, { flags: 'wx', mode: 0o600 }))
    return { filePath, bytes: fs.statSync(filePath).size, cleanup: temporary.cleanup }
  } catch (error) { temporary.cleanup(); throw error }
}

// Convenience helpers for callers already holding small backups in memory.
// HTTP export/import use the file-based functions below.
async function createBackupZip (backup) {
  const chunks = []
  let size = 0
  for await (const chunk of createBackupZipStream(backup)) {
    size += chunk.length
    chunks.push(chunk)
  }
  return Buffer.concat(chunks, size)
}

async function decodeZip (zip) {
  let temporary
  try {
    temporary = createBackupDirectory()
    if (zip.entryCount < 1 || zip.entryCount > MAX_ENTRIES) throw invalidBackup('Invalid Cerebrum backup ZIP contents')
    const seen = new Set()
    const archives = new Map()
    let backupContent
    for await (const entry of zip.eachEntry()) {
      const isArchive = archiveEntryPattern.test(entry.fileName)
      if ((!allowedEntries.has(entry.fileName) && !isArchive) || seen.has(entry.fileName)) throw invalidBackup('Unexpected or duplicate file in backup ZIP')
      seen.add(entry.fileName)
      const fileType = (entry.externalFileAttributes >>> 16) & 0o170000
      if (entry.isEncrypted() || !entry.canDecodeFileData() || (fileType && fileType !== 0o100000)) throw invalidBackup('Unsupported file in backup ZIP')
      if (!isArchive && entry.uncompressedSize > MAX_BACKUP_BYTES) throw tooLarge()
      const stream = await zip.openReadStreamPromise(entry)
      const decoder = new StringDecoder('utf8')
      const chunks = []
      const hash = crypto.createHash('sha256')
      // Archive-supplied paths never become filesystem destinations.
      const filePath = isArchive ? path.join(temporary.directory, crypto.randomUUID()) : null
      let size = 0
      let checksum = 0
      const check = new Transform({
        transform (chunk, encoding, callback) {
          size += chunk.length
          if (size > entry.uncompressedSize) return callback(invalidBackup('Damaged Cerebrum backup ZIP size'))
          checksum = crc32.unsigned(chunk, checksum)
          if (isArchive) hash.update(chunk)
          if (entry.fileName === BACKUP_ENTRY) chunks.push(decoder.write(chunk))
          callback(null, chunk)
        }
      })
      const destination = isArchive
        ? fs.createWriteStream(filePath, { flags: 'wx', mode: 0o600 })
        : new Writable({ write: (chunk, encoding, callback) => callback() })
      await pipeline(stream, check, destination)
      if (size !== entry.uncompressedSize || checksum !== entry.crc32) throw invalidBackup('Damaged Cerebrum backup ZIP')
      if (isArchive) archives.set(entry.fileName, { filePath, bytes: size, sha256: hash.digest('hex') })
      if (entry.fileName === BACKUP_ENTRY) {
        chunks.push(decoder.end())
        backupContent = chunks.join('')
      }
    }
    if (!backupContent) throw invalidBackup('Missing cerebrum-backup.json in ZIP')
    let backup = parseBackup(backupContent, true)
    if (backup.version === 3) {
      backup = mapBackupArchives(backup, (file, group) => {
        const name = `archives/${group}/${file?.name}`
        if (!file || file.zipEntry !== name || Object.hasOwn(file, 'content') || !archives.has(name)) throw invalidBackup('Missing or invalid ZIP archive reference')
        const { zipEntry, ...info } = file
        if (file.id !== `${group}/${file.name}`) throw invalidBackup('Invalid ZIP archive identity')
        const source = archives.get(name)
        const restored = registerBackupArchive(info, source.filePath, source.bytes, source.sha256)
        archives.delete(name)
        return restored
      })
      // Reuse the existing checked, transactional version 2 restore.
      backup.version = 2
    }
    if (archives.size) throw invalidBackup('Unreferenced archive file in backup ZIP')
    assertBackupSize(backup)
    registerBackupCleanup(backup, temporary.cleanup)
    return backup
  } catch (error) {
    temporary?.cleanup()
    if (error.status) throw error
    throw invalidBackup(`Invalid Cerebrum backup ZIP: ${error.message}`)
  } finally {
    zip.close()
  }
}

async function decodeBackupFile (filePath) {
  const fd = fs.openSync(filePath, 'r')
  const magic = Buffer.alloc(2)
  try { fs.readSync(fd, magic, 0, magic.length, 0) } finally { fs.closeSync(fd) }
  if (magic[0] !== 0x50 || magic[1] !== 0x4b) {
    if (fs.statSync(filePath).size > MAX_BACKUP_BYTES) throw tooLarge()
    return parseBackup(fs.readFileSync(filePath))
  }
  let zip
  try { zip = await yauzl.openPromise(filePath, { lazyEntries: true, validateEntrySizes: true, strictFileNames: true }) } catch (error) {
    throw invalidBackup(`Invalid Cerebrum backup ZIP: ${error.message}`)
  }
  return decodeZip(zip)
}

async function decodeBackupUpload (bytes) {
  if (!Buffer.isBuffer(bytes) || !bytes.length) throw invalidBackup('Empty Cerebrum backup')
  const temporary = createBackupDirectory()
  let backup
  try {
    const filePath = path.join(temporary.directory, 'upload')
    fs.writeFileSync(filePath, bytes, { mode: 0o600 })
    backup = await decodeBackupFile(filePath)
    return mapBackupArchives(backup, file => {
      const source = backupArchiveSource(file)
      return source ? { ...file, content: fs.readFileSync(source, 'utf8') } : file
    })
  } finally { if (backup) disposeBackup(backup); temporary.cleanup() }
}

function createBackupDownloads () {
  const downloads = new Map()
  const remove = (id, preserveFile = false) => {
    const download = downloads.get(id)
    clearTimeout(download?.timer)
    downloads.delete(id)
    if (!preserveFile) download?.cleanup()
  }
  return {
    add ({ nodeId, filename, ...archive }) {
      if (downloads.size >= 4) throw Object.assign(new Error('Too many pending backup downloads'), { status: 429 })
      const downloadId = crypto.randomBytes(32).toString('hex')
      const timer = setTimeout(() => remove(downloadId), 10 * 60 * 1000)
      timer.unref()
      downloads.set(downloadId, { nodeId, filename, ...archive, timer })
      return { downloadId, filename }
    },
    take ({ nodeId, downloadId }) {
      const download = downloads.get(downloadId)
      if (!download || download.nodeId !== nodeId) throw Object.assign(new Error('Expired or invalid backup download'), { status: 404 })
      remove(downloadId, true)
      return download
    }
  }
}

module.exports = { createBackupZip, createBackupZipFile, decodeBackupUpload, decodeBackupFile, createBackupDownloads }
