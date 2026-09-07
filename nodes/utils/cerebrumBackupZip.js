'use strict'

const yauzl = require('yauzl')
const yazl = require('yazl')
const crc32 = require('buffer-crc32')
const { MAX_BACKUP_BYTES, validateFile } = require('./cerebrumBackup')

const BACKUP_ENTRY = 'cerebrum-backup.json'
const allowedEntries = new Set([BACKUP_ENTRY, 'cerebrum-flows.json', 'required-packages.json', 'README.txt'])
// The migration sidecars duplicate information already included in the backup.
const MAX_EXPANDED_BYTES = 2 * MAX_BACKUP_BYTES + 1024 * 1024
const invalidBackup = message => Object.assign(new Error(message), { status: 400 })
const tooLarge = () => Object.assign(new Error('Backup exceeds 256 MiB'), { status: 413 })

function parseBackup (bytes) {
  let backup
  try { backup = JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, '')) } catch (error) {
    throw invalidBackup('Invalid Cerebrum backup JSON')
  }
  if (!backup || backup.format !== 'cerebrum-ultimate-backup' || ![1, 2].includes(backup.version)) throw invalidBackup('Unsupported Cerebrum backup')
  return backup
}

async function createBackupZip (backup) {
  if (!backup || backup.format !== 'cerebrum-ultimate-backup' || ![1, 2].includes(backup.version)) throw invalidBackup('Unsupported Cerebrum backup')
  const content = Buffer.from(JSON.stringify(backup, null, 2), 'utf8')
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
    'Cerebrum restore does not deploy Node-RED flows. The JSON backup remains usable with older compatible versions.',
    'Il ripristino Cerebrum non esegue il deploy dei flow Node-RED. Il backup JSON resta utilizzabile con le versioni precedenti compatibili.',
    'AI provider API keys are excluded. Other integration credentials are included: keep this unencrypted backup private.',
    'Le chiavi API dei provider AI sono escluse. Le credenziali delle altre integrazioni sono incluse: conserva questo backup non cifrato in modo riservato.',
    '',
    ...(backup.migration?.warnings || []),
    ...(backup.migration?.instructions || [])
  ].join('\n'), 'utf8'))

  const zip = new yazl.ZipFile()
  zip.on('error', error => zip.outputStream.destroy(error))
  for (const [name, bytes] of entries) zip.addBuffer(bytes, name, { compressionLevel: 6 })
  zip.end()
  const chunks = []
  let size = 0
  for await (const chunk of zip.outputStream) {
    size += chunk.length
    if (size > MAX_BACKUP_BYTES) throw tooLarge()
    chunks.push(chunk)
  }
  return Buffer.concat(chunks, size)
}

async function decodeBackupUpload (bytes) {
  if (!Buffer.isBuffer(bytes) || !bytes.length) throw invalidBackup('Empty Cerebrum backup')
  if (bytes.length > MAX_BACKUP_BYTES) throw tooLarge()
  // Keep existing version 1 and 2 JSON backups importable.
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) return parseBackup(bytes)
  let zip
  try {
    zip = await yauzl.fromBufferPromise(bytes, { lazyEntries: true, validateEntrySizes: true, strictFileNames: true })
    if (zip.entryCount < 1 || zip.entryCount > allowedEntries.size) throw invalidBackup('Invalid Cerebrum backup ZIP contents')
    const seen = new Set()
    let expandedSize = 0
    let backupBytes
    for await (const entry of zip.eachEntry()) {
      if (!allowedEntries.has(entry.fileName) || seen.has(entry.fileName)) throw invalidBackup('Unexpected or duplicate file in backup ZIP')
      seen.add(entry.fileName)
      const fileType = (entry.externalFileAttributes >>> 16) & 0o170000
      if (entry.isEncrypted() || !entry.canDecodeFileData() || (fileType && fileType !== 0o100000)) throw invalidBackup('Unsupported file in backup ZIP')
      expandedSize += entry.uncompressedSize
      if (entry.uncompressedSize > MAX_BACKUP_BYTES || expandedSize > MAX_EXPANDED_BYTES) throw tooLarge()
      const stream = await zip.openReadStreamPromise(entry)
      const chunks = []
      let size = 0
      let checksum = 0
      for await (const chunk of stream) {
        size += chunk.length
        if (size > MAX_BACKUP_BYTES || size > entry.uncompressedSize) throw tooLarge()
        checksum = crc32.unsigned(chunk, checksum)
        // Sidecars are checked but never extracted or used as restore paths.
        if (entry.fileName === BACKUP_ENTRY) chunks.push(chunk)
      }
      if (size !== entry.uncompressedSize || checksum !== entry.crc32) throw invalidBackup('Damaged Cerebrum backup ZIP')
      if (entry.fileName === BACKUP_ENTRY) backupBytes = Buffer.concat(chunks, size)
    }
    if (!backupBytes) throw invalidBackup('Missing cerebrum-backup.json in ZIP')
    return parseBackup(backupBytes)
  } catch (error) {
    if (error.status) throw error
    throw invalidBackup(`Invalid Cerebrum backup ZIP: ${error.message}`)
  } finally {
    if (zip) zip.close()
  }
}

module.exports = { createBackupZip, decodeBackupUpload }
