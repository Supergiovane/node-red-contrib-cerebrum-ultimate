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

const portableNodeOmittedKeys = new Set([
  'z',
  'x',
  'y',
  'wires',
  'g',
  'l',
  'd',
  'credentials',
  'llmApiKey',
  'unifiHistoryUsername',
  'unifiHistoryPassword',
  'aiEducation'
])
const portableNodeSecretKeys = new Set([
  'authorization',
  'cookie',
  'credential',
  'credentials',
  'apikey',
  'llmapikey',
  'password',
  'passwd',
  'secret',
  'token',
  'accesstoken',
  'refreshtoken'
])

function sanitizePortableNodeValue (value, seen = new WeakSet()) {
  if (value === null || typeof value !== 'object') return value
  if (seen.has(value)) return undefined
  seen.add(value)
  let sanitized
  if (Array.isArray(value)) {
    sanitized = value.map(item => sanitizePortableNodeValue(item, seen)).filter(item => item !== undefined)
  } else {
    sanitized = {}
    for (const [key, item] of Object.entries(value)) {
      const normalizedKey = key.replace(/[^a-z0-9]/gi, '').toLowerCase()
      if (portableNodeSecretKeys.has(normalizedKey)) continue
      const next = sanitizePortableNodeValue(item, seen)
      if (next !== undefined) sanitized[key] = next
    }
  }
  seen.delete(value)
  return sanitized
}

function buildPortableCerebrumNode (node, config, etsAccess) {
  const source = config && typeof config === 'object' && !Array.isArray(config) ? config : {}
  const portable = {}
  for (const [key, value] of Object.entries(source)) {
    if (portableNodeOmittedKeys.has(key)) continue
    const sanitized = sanitizePortableNodeValue(value)
    if (sanitized !== undefined) portable[key] = sanitized
  }
  portable.id = String(node && node.id ? node.id : source.id || '')
  portable.type = 'cerebrumUltimate'
  if (etsAccess) {
    portable.etsExposeConfigured = etsAccess.configured === true
    portable.etsExposedGAs = clone(etsAccess.exposedGAs)
    portable.etsReadOnlyGAs = clone(etsAccess.readOnlyGAs)
  }
  return portable
}

function readInstalledUltimatePackages (RED) {
  const dependencies = {}
  try {
    const getNodeList = RED && RED.nodes && RED.nodes.getNodeList
    const nodeSets = typeof getNodeList === 'function' ? getNodeList.call(RED.nodes) : []
    for (const info of Array.isArray(nodeSets) ? nodeSets.slice(0, 5000) : []) {
      const moduleName = String(info && info.module ? info.module : '').trim().slice(0, 240)
      if (!moduleName.toLowerCase().includes('-ultimate')) continue
      const version = String(info && info.version ? info.version : '').trim().slice(0, 80)
      dependencies[moduleName] = version || '*'
    }
  } catch (error) { /* Installed-package inventory is optional. */ }
  dependencies['node-red-contrib-cerebrum-ultimate'] = require('../../package.json').version
  return Object.fromEntries(Object.entries(dependencies).sort(([left], [right]) => left.localeCompare(right)))
}

function buildMigrationFlows (RED, node, config, { etsAccess } = {}) {
  // Do not enumerate the deployed runtime. The constructor already supplied the
  // selected Cerebrum node's saved configuration; keep only that data and strip
  // flow placement/wiring and secrets. RED is consulted once, solely for the
  // installed compatible `-ultimate` package inventory.
  const flows = [buildPortableCerebrumNode(node, config, etsAccess)]
  const dependencies = readInstalledUltimatePackages(RED)
  return {
    flows: backupFile('nodeRedFlows', 'cerebrum-flows.json', JSON.stringify(flows, null, 2), 'application/json'),
    dependencies,
    runtime: { node: process.version, nodeRed: '' },
    etsCatalogs: backupFile('etsCatalogs', 'cerebrum-ets-catalogs.json', '[]', 'application/json'),
    warnings: [
      'This backup does not inspect or include deployed Node-RED flows, tabs, wiring, configuration nodes, credentials or runtime ETS catalogs.'
    ],
    instructions: [
      'Install the listed Node-RED packages on the destination.',
      'cerebrum-flows.json contains only the sanitized settings of the selected Cerebrum node; it contains no tab, wiring or referenced configuration nodes.',
      'Create or import the Cerebrum node on the destination, reconnect its integrations manually, deploy it, then import this backup to restore Cerebrum data and archives.',
      'Re-enter credentials and verify external service addresses, environment variables, certificates, custom modules and context stores on the destination: those resources are managed outside Cerebrum.'
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
