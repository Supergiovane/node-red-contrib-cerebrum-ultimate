'use strict'

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const os = require('os')
const { validateCerebrumSharedArchive } = require('./cerebrumSharedArchive')

const MAX_BACKUP_BYTES = 256 * 1024 * 1024
// Only JSON metadata is held in memory. ZIPs and their daily archives use disk.
const archiveSources = new WeakMap()
const backupCleanups = new WeakMap()
const digest = content => crypto.createHash('sha256').update(content, 'utf8').digest('hex')
const backupError = message => Object.assign(new Error(message), { status: 400 })
const clone = value => JSON.parse(JSON.stringify(value))

function backupFile (id, name, content, mediaType = 'text/plain') {
  return { id, name, mediaType, encoding: 'utf8', bytes: Buffer.byteLength(content, 'utf8'), sha256: digest(content), content }
}

function validateFile (file, id) {
  if (!file || file.id !== id || file.encoding !== 'utf8' || typeof file.content !== 'string' || file.bytes !== Buffer.byteLength(file.content, 'utf8') || file.sha256 !== digest(file.content)) {
    throw backupError(`Invalid or damaged backup file: ${id}`)
  }
  return file.content
}

function createBackupDirectory () {
  const directory = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'cerebrum-backup-'))
  return { directory, cleanup: () => fs.rmSync(directory, { recursive: true, force: true }) }
}

function registerBackupCleanup (backup, cleanup) { backupCleanups.set(backup, cleanup) }
function disposeBackup (backup) {
  const cleanup = backupCleanups.get(backup)
  backupCleanups.delete(backup)
  if (cleanup) cleanup()
}

function registerBackupArchive (file, filePath, bytes, sha256) {
  if (!file || file.encoding !== 'utf8' || file.bytes !== bytes || file.sha256 !== sha256 || Object.hasOwn(file, 'content')) throw backupError('Invalid or damaged backup archive')
  archiveSources.set(file, { filePath, bytes, sha256 })
  return file
}

function backupArchiveSource (file) { return archiveSources.get(file)?.filePath }

function snapshotArchive (id, name, source, destination) {
  fs.mkdirSync(path.dirname(destination), { recursive: true })
  fs.copyFileSync(source, destination, fs.constants.COPYFILE_FICLONE)
  fs.chmodSync(destination, 0o600)
  const hash = crypto.createHash('sha256')
  const buffer = Buffer.allocUnsafe(64 * 1024)
  const fd = fs.openSync(destination, 'r')
  let bytes = 0
  try {
    let size
    while ((size = fs.readSync(fd, buffer, 0, buffer.length, null))) {
      bytes += size
      hash.update(buffer.subarray(0, size))
    }
  } finally { fs.closeSync(fd) }
  const sha256 = hash.digest('hex')
  return registerBackupArchive({ id, name, mediaType: 'text/plain', encoding: 'utf8', bytes, sha256 }, destination, bytes, sha256)
}

function validateArchiveFile (file, id) {
  const source = archiveSources.get(file)
  if (!source) return validateFile(file, id)
  if (file.id !== id || file.encoding !== 'utf8' || file.bytes !== source.bytes || file.sha256 !== source.sha256 || Object.hasOwn(file, 'content')) throw backupError(`Invalid or damaged backup file: ${id}`)
}

// These logical names are resolved locally. A backup can never choose a disk path.
const { validAutomationName } = require('./cerebrumAutomationFiles')
const { parseAutomationCheckpoint } = require('./cerebrumAutomationRuntime')
const archiveNames = ['history', 'adapterHistory', 'operations', 'sharedMemory', 'automationSources']
const optionalArchiveNames = new Set(['sharedMemory', 'automationSources'])
const singleNames = ['habitLearning', 'worldModel', 'worldObservations', 'runtimeState', 'automationRuntime', 'lastChatPrompt', 'legacyAreas']
const optionalSingleNames = new Set(['worldModel', 'worldObservations', 'runtimeState', 'automationRuntime'])
const archivePattern = /^\d{4}-\d{2}-\d{2}\.(?:knxctx|jsonl)$/
const validArchiveName = (group, name) => group === 'sharedMemory' ? name === 'cerebrum-memory.jsonl' : group === 'automationSources' ? validAutomationName(name) : archivePattern.test(name)

function mapBackupArchives (backup, visit) {
  if (!backup.supplementalFiles) return { ...backup }
  const supplementalFiles = { ...backup.supplementalFiles }
  for (const group of archiveNames) {
    if (Array.isArray(supplementalFiles[group])) supplementalFiles[group] = supplementalFiles[group].map(file => visit(file, group))
  }
  return { ...backup, supplementalFiles }
}

function assertBackupSize (backup) {
  const metadata = mapBackupArchives(backup, file => {
    if (!file || (typeof file.content !== 'string' && !backupArchiveSource(file))) throw backupError('Invalid backup archive content')
    const { content, ...info } = file
    return info
  })
  const metadataBytes = Buffer.byteLength(JSON.stringify(metadata), 'utf8')
  if (metadataBytes > MAX_BACKUP_BYTES) throw Object.assign(new Error('Backup metadata exceeds 256 MiB'), { status: 413 })
}

function assertRegularPath (filePath, directory = false) {
  // Reject symlinks in every existing path component, including the storage root.
  let current = path.resolve(filePath)
  while (current !== path.dirname(current)) {
    if (fs.existsSync(current)) {
      const stat = fs.lstatSync(current)
      if (stat.isSymbolicLink()) throw backupError(`Symbolic links are not supported in backup storage: ${current}`)
      if (current === path.resolve(filePath) && (directory ? !stat.isDirectory() : !stat.isFile())) throw backupError(`Invalid backup storage path: ${current}`)
    }
    current = path.dirname(current)
  }
}

function readSupplementalFiles (locations, { archiveDirectory } = {}) {
  const result = {}
  for (const group of archiveNames) {
    const dir = locations[group]
    if (optionalArchiveNames.has(group) && !dir) continue
    assertRegularPath(dir, true)
    result[group] = fs.existsSync(dir)
      ? fs.readdirSync(dir).sort().filter(name => validArchiveName(group, name)).map(name => {
        const filePath = path.join(dir, name)
        assertRegularPath(filePath)
        return archiveDirectory
          ? snapshotArchive(`${group}/${name}`, name, filePath, path.join(archiveDirectory, group, name))
          : backupFile(`${group}/${name}`, name, fs.readFileSync(filePath, 'utf8'))
      })
      : []
  }
  for (const id of singleNames) {
    const filePath = locations[id]
    if (optionalSingleNames.has(id) && !filePath) continue
    assertRegularPath(filePath)
    if (fs.existsSync(filePath) && fs.statSync(filePath).size > MAX_BACKUP_BYTES) throw Object.assign(new Error('Backup metadata file exceeds 256 MiB'), { status: 413 })
    result[id] = fs.existsSync(filePath) ? backupFile(id, path.basename(filePath), fs.readFileSync(filePath, 'utf8')) : null
  }
  return result
}

function validateSupplementalFiles (files) {
  if (!files || typeof files !== 'object') throw backupError('Missing supplemental backup files')
  for (const group of archiveNames) {
    if (optionalArchiveNames.has(group) && !Object.hasOwn(files, group)) continue
    if (!Array.isArray(files[group])) throw backupError(`Missing backup archive: ${group}`)
    const names = new Set()
    for (const file of files[group]) {
      if (!file || typeof file.name !== 'string' || !validArchiveName(group, file.name) || names.has(file.name)) throw backupError(`Invalid or duplicate ${group} filename`)
      names.add(file.name)
      validateArchiveFile(file, `${group}/${file.name}`)
      if (group === 'sharedMemory') validateCerebrumSharedArchive({ filePath: backupArchiveSource(file), content: file.content })
    }
  }
  for (const id of singleNames) {
    if (optionalSingleNames.has(id) && !Object.hasOwn(files, id)) continue
    if (!Object.hasOwn(files, id)) throw backupError(`Missing backup entry: ${id}`)
    if (files[id] !== null) validateFile(files[id], id)
  }
  if (files.automationRuntime) parseAutomationCheckpoint(files.automationRuntime.content)
  if (!files.habitLearning) throw backupError('Missing habit learning checkpoint')
  const checkpoint = JSON.parse(files.habitLearning.content)
  if (checkpoint.version !== 1 || !Array.isArray(checkpoint.habits)) throw backupError('Invalid habit learning checkpoint')
}

function replaceSupplementalFiles (files, locations, writeFile) {
  validateSupplementalFiles(files)
  for (const group of archiveNames) {
    const dir = locations[group]
    if (optionalArchiveNames.has(group) && (!dir || !Object.hasOwn(files, group))) continue
    assertRegularPath(dir, true)
    const names = new Set(files[group].map(file => file.name))
    for (const file of files[group]) {
      const filePath = path.join(dir, file.name)
      assertRegularPath(filePath)
      const source = backupArchiveSource(file)
      if (source) {
        fs.mkdirSync(dir, { recursive: true })
        const temporary = path.join(dir, `.restore-${crypto.randomUUID()}.tmp`)
        try {
          fs.copyFileSync(source, temporary, fs.constants.COPYFILE_FICLONE)
          fs.renameSync(temporary, filePath)
        } finally { fs.rmSync(temporary, { force: true }) }
      } else writeFile({ filePath, content: file.content })
    }
    if (fs.existsSync(dir)) {
      for (const name of fs.readdirSync(dir).filter(name => validArchiveName(group, name) && !names.has(name))) {
        const filePath = path.join(dir, name)
        assertRegularPath(filePath)
        fs.unlinkSync(filePath)
      }
    }
  }
  for (const id of singleNames) {
    const filePath = locations[id]
    if (optionalSingleNames.has(id) && (!filePath || !Object.hasOwn(files, id))) continue
    assertRegularPath(filePath)
    if (files[id]) writeFile({ filePath, content: files[id].content })
    else if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
  }
}

function readBackupEtsAccess (backup, configuration) {
  const validate = access => {
    if (!access || typeof access !== 'object' || Array.isArray(access)) throw backupError('Invalid ETS access configuration in backup')
    const configured = access.configured ?? access.exposeConfigured
    if (typeof configured !== 'boolean' || !Array.isArray(access.exposedGAs) || !Array.isArray(access.readOnlyGAs) || [...access.exposedGAs, ...access.readOnlyGAs].some(ga => typeof ga !== 'string' || !ga.trim())) throw backupError('Invalid ETS selection or read-only permissions in backup')
    const selected = new Set(access.exposedGAs.map(ga => ga.trim()))
    if (access.readOnlyGAs.some(ga => !selected.has(ga.trim()))) throw backupError('Backup read-only ETS objects must also be selected')
    return { configured, exposedGAs: access.exposedGAs.slice(), readOnlyGAs: access.readOnlyGAs.slice() }
  }
  // An explicitly empty/disabled selection is authoritative. Null/missing was
  // used by older files before file-backed access configuration was populated.
  if (configuration?.etsAccess !== undefined && configuration.etsAccess !== null) return validate(configuration.etsAccess)
  if (!backup.migration?.flows) return undefined
  const flows = JSON.parse(validateFile(backup.migration.flows, 'nodeRedFlows'))
  const sourceId = backup.node?.id || configuration?.nodeId
  const candidates = (Array.isArray(flows) ? flows : []).filter(item => item?.type === 'cerebrumUltimate' && (!sourceId || item.id === sourceId))
  if (candidates.length !== 1 || !Object.hasOwn(candidates[0], 'etsExposeConfigured')) return undefined
  const source = candidates[0]
  return validate({ configured: source.etsExposeConfigured, exposedGAs: source.etsExposedGAs === undefined ? [] : source.etsExposedGAs, readOnlyGAs: source.etsReadOnlyGAs === undefined ? [] : source.etsReadOnlyGAs })
}

function buildMigrationFlows (RED, node, config, { etsAccess } = {}) {
  const all = new Map()
  RED.nodes.eachNode(item => all.set(item.id, clone(item)))
  if (!all.has(node.id)) all.set(node.id, { ...clone(config), id: node.id, type: 'cerebrumUltimate' })
  const selected = new Set([node.id])
  for (const item of all.values()) if (item.type === 'global-config') selected.add(item.id)
  const references = value => {
    if (typeof value === 'string') return all.has(value) ? [value] : []
    if (Array.isArray(value)) return value.flatMap(references)
    if (value && typeof value === 'object') return Object.values(value).flatMap(references)
    return []
  }
  // Include complete containing tabs/subflows, linked tabs, groups and recursively
  // referenced config nodes. Shared config nodes do not pull in unrelated tabs.
  let changed = true
  while (changed) {
    const before = selected.size
    for (const id of selected) {
      const item = all.get(id)
      references(item).forEach(ref => selected.add(ref))
      if (item.type.startsWith('subflow:') && all.has(item.type.slice(8))) selected.add(item.type.slice(8))
      if (item.type === 'tab' || item.type === 'subflow') {
        for (const other of all.values()) if (other.z === id) selected.add(other.id)
      }
      for (const other of all.values()) {
        if (other.type.startsWith('link ') && references(other.links).includes(id)) selected.add(other.id)
      }
    }
    changed = selected.size !== before
  }
  const warnings = []
  const flows = [...selected].map(id => {
    const item = clone(all.get(id))
    if (item.type === 'cerebrumUltimate') delete item.aiEducation
    // Dashboard changes live in Cerebrum's file, not RED.nodes.eachNode(). The
    // portable flow must carry the same current permissions as the data backup.
    if (id === node.id && etsAccess) {
      item.etsExposeConfigured = etsAccess.configured === true
      item.etsExposedGAs = clone(etsAccess.exposedGAs)
      item.etsReadOnlyGAs = clone(etsAccess.readOnlyGAs)
    }
    const live = RED.nodes.getNode(id)
    const credentials = typeof RED.nodes.getCredentials === 'function' ? RED.nodes.getCredentials(id) : live && live.credentials
    if (credentials) item.credentials = clone(credentials)
    // Cerebrum's provider API key is intentionally never portable.
    if (item.credentials) delete item.credentials.llmApiKey
    delete item.llmApiKey
    if (item.credentials && !Object.keys(item.credentials).length) delete item.credentials
    // KNX Ultimate expects CSV/ESF text, never its parsed runtime array.
    // Inline a configured ETS file so the source-machine path is not required.
    if (item.type === 'knxUltimate-config' && typeof item.csv === 'string' && /\.(?:csv|esf)$/i.test(item.csv.trim()) && !item.csv.includes('\n')) {
      item.csv = fs.readFileSync(item.csv.trim(), 'utf8')
    }
    return item
  })
  if (typeof RED.nodes.getCredentials !== 'function') warnings.push('Credentials of inactive configuration nodes may be unavailable; verify them after importing the flows.')
  const packageFile = path.join(String(RED.settings.userDir || process.cwd()), 'package.json')
  let dependencies = {}
  if (fs.existsSync(packageFile)) dependencies = JSON.parse(fs.readFileSync(packageFile, 'utf8')).dependencies || {}
  const types = new Set(flows.map(item => item.type))
  if (typeof RED.nodes.getNodeList === 'function') {
    for (const info of RED.nodes.getNodeList()) {
      if (info.module && info.module !== 'node-red' && info.module !== '@node-red/nodes' && Array.isArray(info.types) && info.types.some(type => types.has(type))) {
        dependencies[info.module] = info.version || dependencies[info.module] || '*'
      }
    }
  }
  dependencies['node-red-contrib-cerebrum-ultimate'] = require('../../package.json').version
  return {
    flows: backupFile('nodeRedFlows', 'cerebrum-flows.json', JSON.stringify(flows, null, 2), 'application/json'),
    dependencies,
    runtime: { node: process.version, nodeRed: typeof RED.version === 'function' ? RED.version() : String(RED.version || '') },
    etsCatalogs: backupFile('etsCatalogs', 'cerebrum-ets-catalogs.json', JSON.stringify(flows.filter(item => item.type === 'knxUltimate-config').map(item => ({ id: item.id, catalog: clone(RED.nodes.getNode(item.id)?.csv || []) })), null, 2), 'application/json'),
    warnings,
    instructions: [
      'Install the listed Node-RED packages on the destination.',
      'Extract and import cerebrum-flows.json in the Node-RED editor; preserve node IDs where possible. Review connections and deploy.',
      'Open the imported Cerebrum node and import this backup to restore its data and archives.',
      'Re-enter the AI provider API key. Verify external service addresses, environment variables, certificates, custom modules and context stores on the destination: those resources are managed outside Cerebrum.'
    ]
  }
}

// Small requests bypass Node-RED's JSON body limit without changing global settings.
function createBackupUploads () {
  const uploads = new Map()
  const remove = (id, preserveFile = false) => {
    const upload = uploads.get(id)
    clearTimeout(upload?.timer)
    uploads.delete(id)
    if (!preserveFile) upload?.cleanup()
  }
  const prune = () => {
    for (const [id, upload] of uploads) if (Date.now() - upload.updatedAt > 10 * 60 * 1000) remove(id)
  }
  return {
    append ({ owner, nodeId, uploadId, index, total, chunk }) {
      prune()
      if (!Number.isSafeInteger(index) || !Number.isSafeInteger(total) || total < 1 || index < 0 || index >= total || typeof chunk !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(chunk) || chunk.length > 65536) throw backupError('Invalid backup upload chunk')
      if (!uploadId && index === 0) {
        if (uploads.size >= 4) throw Object.assign(new Error('Too many backup uploads'), { status: 429 })
        uploadId = crypto.randomUUID()
        const temporary = createBackupDirectory()
        const filePath = path.join(temporary.directory, 'upload')
        try { fs.writeFileSync(filePath, '', { flag: 'wx', mode: 0o600 }) } catch (error) { temporary.cleanup(); throw error }
        uploads.set(uploadId, { owner, nodeId, total, nextIndex: 0, filePath, cleanup: temporary.cleanup })
      }
      const upload = uploads.get(uploadId)
      if (!upload || upload.owner !== owner || upload.nodeId !== nodeId || upload.total !== total || upload.nextIndex !== index) throw backupError('Expired or out-of-order backup upload')
      const data = Buffer.from(chunk, 'base64')
      try { fs.appendFileSync(upload.filePath, data) } catch (error) { remove(uploadId); throw error }
      upload.nextIndex++
      upload.updatedAt = Date.now()
      clearTimeout(upload.timer)
      upload.timer = setTimeout(() => remove(uploadId), 10 * 60 * 1000)
      upload.timer.unref()
      return { uploadId }
    },
    takeFile ({ owner, nodeId, uploadId }) {
      prune()
      const upload = uploads.get(uploadId)
      if (!upload || upload.owner !== owner || upload.nodeId !== nodeId || upload.nextIndex !== upload.total) throw backupError('Incomplete or expired backup upload')
      remove(uploadId, true)
      return { filePath: upload.filePath, cleanup: upload.cleanup }
    },
    takeBuffer (request) {
      const upload = this.takeFile(request)
      try { return fs.readFileSync(upload.filePath) } finally { upload.cleanup() }
    },
    take (request) {
      return JSON.parse(this.takeBuffer(request).toString('utf8'))
    }
  }
}

module.exports = { MAX_BACKUP_BYTES, mapBackupArchives, assertBackupSize, assertRegularPath, createBackupDirectory, registerBackupCleanup, disposeBackup, registerBackupArchive, backupArchiveSource, backupFile, validateFile, readSupplementalFiles, validateSupplementalFiles, replaceSupplementalFiles, buildMigrationFlows, readBackupEtsAccess, createBackupUploads }
