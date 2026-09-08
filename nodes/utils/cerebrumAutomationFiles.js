'use strict'

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const vm = require('vm')
const { isUtf8 } = require('buffer')

const MAX_SOURCE_BYTES = 128 * 1024
const fail = (message, status = 400) => Object.assign(new Error(message), { status })
const revisionOf = content => crypto.createHash('sha256').update(content, 'utf8').digest('hex')
const validName = name => typeof name === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}\.js$/.test(name)

// Resolve the configured storage root before constructing this directory. Every
// existing child component must remain an ordinary file/directory, never a link.
function checkPath (filePath, directory = false) {
  const target = path.resolve(filePath)
  let current = target
  while (true) {
    let stat
    try { stat = fs.lstatSync(current) } catch (error) { if (error.code !== 'ENOENT') throw error }
    if (stat) {
      if (stat.isSymbolicLink()) throw fail('Symbolic links are not allowed in JavaScript storage')
      if (current === target ? !(directory ? stat.isDirectory() : stat.isFile()) : !stat.isDirectory()) throw fail('Invalid JavaScript storage path')
    }
    if (current === path.dirname(current)) break
    current = path.dirname(current)
  }
}

function syntaxError (content, name) {
  // Compile only. Neither top-level code nor the exported function is executed.
  try {
    // eslint-disable-next-line no-new
    new vm.Script(content, { filename: name })
    return ''
  } catch (error) { return String(error.stack || error.message).split('\n').slice(0, 5).join('\n') }
}

function createCerebrumAutomationFiles ({ directory, archiveRevision = () => {} }) {
  const resolveFile = (name, origin) => {
    if (!validName(name)) throw fail('Use a simple .js filename containing letters, numbers, dots, hyphens or underscores')
    if (origin !== 'local') throw fail('Invalid JavaScript file origin')
    const filePath = path.join(directory, name)
    checkPath(filePath)
    return filePath
  }
  const exists = filePath => {
    try { fs.lstatSync(filePath); return true } catch (error) { if (error.code === 'ENOENT') return false; throw error }
  }
  const read = ({ name, origin = 'local' }) => {
    const filePath = resolveFile(name, origin)
    let fd
    try {
      fd = fs.openSync(filePath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW)
      const stat = fs.fstatSync(fd)
      if (!stat.isFile()) throw fail('JavaScript source must be a regular file')
      if (stat.size > MAX_SOURCE_BYTES) throw fail('JavaScript source exceeds 128 KiB', 413)
      // Bounded even if an external editor extends the file after fstat.
      const bytes = Buffer.alloc(MAX_SOURCE_BYTES + 1)
      let length = 0
      while (length < bytes.length) {
        const count = fs.readSync(fd, bytes, length, bytes.length - length, null)
        if (!count) break
        length += count
      }
      if (length > MAX_SOURCE_BYTES) throw fail('JavaScript source exceeds 128 KiB', 413)
      if (!isUtf8(bytes.subarray(0, length))) throw fail('JavaScript source must be UTF-8')
      const content = bytes.subarray(0, length).toString('utf8')
      return { name, origin, path: filePath, content, revision: revisionOf(content), bytes: length, maxBytes: MAX_SOURCE_BYTES, modifiedAt: stat.mtime.toISOString(), status: 'paused', runtimeAvailable: true, syntaxError: syntaxError(content, name) }
    } catch (error) {
      if (error.code === 'ENOENT') throw fail('JavaScript file not found. Refresh the file list.', 404)
      throw error
    } finally { if (fd !== undefined) fs.closeSync(fd) }
  }
  const list = () => {
    const byName = new Map()
    for (const [origin, root] of [['local', directory]]) {
      checkPath(root, true)
      if (!exists(root)) continue
      for (const name of fs.readdirSync(root).sort()) {
        if (!validName(name)) continue
        const filePath = path.join(root, name)
        const stat = fs.lstatSync(filePath)
        byName.set(name, { name, origin, status: 'paused', bytes: stat.size, error: stat.isFile() ? '' : 'JavaScript source must be a regular file' })
      }
    }
    return { files: [...byName.values()].sort((a, b) => a.name.localeCompare(b.name)), directory, maxBytes: MAX_SOURCE_BYTES, runtimeAvailable: true }
  }
  const save = ({ name, origin, revision, content, author = 'user' } = {}) => {
    const filePath = resolveFile(name, 'local')
    if (!['local', 'new'].includes(origin)) throw fail('Invalid JavaScript file origin')
    if (typeof content !== 'string') throw fail('JavaScript source must be text')
    if (Buffer.byteLength(content, 'utf8') > MAX_SOURCE_BYTES) throw fail('JavaScript source exceeds 128 KiB', 413)
    const invalid = syntaxError(content, name)
    if (invalid) throw fail(invalid, 422)
    const conflict = () => { throw fail('This JavaScript file has changed. Your edits have been kept in the editor; reload the file before saving.', 409) }
    let previous = null
    if (origin === 'new') {
      if (revision !== '' || exists(filePath)) conflict()
    } else {
      previous = read({ name, origin })
      if (typeof revision !== 'string' || revision !== previous.revision) conflict()
    }
    const nextRevision = revisionOf(content)
    const candidate = { name, content, revision: nextRevision }
    // Retain original external edits too, before the first in-app overwrite.
    archiveRevision({ phase: 'prepared', author, origin, previous: previous && { content: previous.content, revision: previous.revision }, candidate })
    checkPath(directory, true)
    fs.mkdirSync(directory, { recursive: true })
    const temporary = path.join(directory, `.source-${crypto.randomUUID()}.tmp`)
    let fd
    try {
      fd = fs.openSync(temporary, 'wx', 0o600)
      fs.writeFileSync(fd, content, 'utf8')
      fs.fsyncSync(fd)
      fs.closeSync(fd)
      fd = undefined
      checkPath(filePath)
      if (origin === 'local') {
        if (!exists(filePath) || read({ name }).revision !== revision) conflict()
        fs.renameSync(temporary, filePath)
      } else {
        // A no-replace publication also catches creates racing with editors.
        try { fs.linkSync(temporary, filePath) } catch (error) { if (error.code === 'EEXIST') conflict(); throw error }
      }
    } finally {
      if (fd !== undefined) fs.closeSync(fd)
      fs.rmSync(temporary, { force: true })
    }
    const saved = read({ name })
    if (saved.revision !== nextRevision) conflict()
    archiveRevision({ phase: 'saved', author, name, revision: saved.revision })
    return saved
  }
  const remove = ({ name, revision }) => {
    const file = read({ name })
    if (file.revision !== revision) throw fail('This JavaScript file has changed. Refresh before deleting.', 409)
    archiveRevision({ phase: 'deleted', name, content: file.content, revision })
    if (read({ name }).revision !== revision) throw fail('This JavaScript file has changed.', 409)
    fs.unlinkSync(resolveFile(name, 'local'))
  }
  return { list, read, save, remove }
}

function registerCerebrumAutomationRoutes (RED, findNode) {
  const target = nodeId => {
    const node = findNode(String(nodeId || ''))
    if (!node || node.type !== 'cerebrumUltimate' || typeof node.listAutomationFiles !== 'function' || node._closing) throw fail('Deploy the Cerebrum node before opening JavaScript automations.', 404)
    return node
  }
  RED.httpAdmin.get('/cerebrumUltimate/sidebar/automations', RED.auth.needsPermission('flows.read'), async (req, res) => {
    try {
      const node = target(req.query?.nodeId)
      res.set('Cache-Control', 'no-store')
      res.json(await (req.query?.name !== undefined ? node.getAutomationFile({ name: req.query.name, origin: req.query.origin || 'local' }) : node.listAutomationFiles()))
    } catch (error) { res.status(error.status || 500).json({ error: error.message || String(error) }) }
  })
  RED.httpAdmin.post('/cerebrumUltimate/sidebar/automations/save', RED.auth.needsPermission('flows.write'), async (req, res) => {
    try {
      const node = target(req.body?.nodeId)
      res.set('Cache-Control', 'no-store')
      res.json(await node.saveAutomationFile({ name: req.body?.name, origin: req.body?.origin, revision: req.body?.revision, content: req.body?.content }))
    } catch (error) { res.status(error.status || 500).json({ error: error.message || String(error) }) }
  })
  RED.httpAdmin.post('/cerebrumUltimate/sidebar/automations/compile', RED.auth.needsPermission('flows.write'), (req, res) => {
    try {
      res.set('Cache-Control', 'no-store')
      res.json(target(req.body?.nodeId).compileEducationAutomations())
    } catch (error) { res.status(error.status || 500).json({ error: error.message || String(error) }) }
  })
  RED.httpAdmin.post('/cerebrumUltimate/sidebar/automations/manage', RED.auth.needsPermission('flows.write'), async (req, res) => {
    try {
      const node = target(req.body?.nodeId)
      res.set('Cache-Control', 'no-store')
      res.json(await node.manageAutomationFile({ name: req.body?.name, revision: req.body?.revision, operation: req.body?.operation }))
    } catch (error) { res.status(error.status || 500).json({ error: error.message || String(error) }) }
  })
}

module.exports = { createCerebrumAutomationFiles, registerCerebrumAutomationRoutes, MAX_SOURCE_BYTES, validAutomationName: validName, checkAutomationPath: checkPath }
