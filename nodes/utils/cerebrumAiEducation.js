'use strict'

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { isUtf8 } = require('buffer')
const { HOME_MEMORY_MAX_EDUCATION_CHARS } = require('./homeMemory')
const { assertRegularPath, validateFile } = require('./cerebrumBackup')

const educationError = (message, status = 400) => Object.assign(new Error(message), { status })
function getAiEducationFilePath (storageDir, nodeId) {
  // Resolve the configured root (including macOS /var -> /private/var) before
  // rejecting links within Cerebrum's own configuration directory.
  let existing = path.resolve(storageDir)
  const missing = []
  while (!fs.existsSync(existing)) {
    missing.unshift(path.basename(existing))
    existing = path.dirname(existing)
  }
  const root = path.join(fs.realpathSync(existing), ...missing)
  return path.join(root, 'cerebrum', 'config', `cerebrum-ai-education-${String(nodeId).replace(/[^a-zA-Z0-9_-]/g, '_')}.md`)
}

function validateAiEducation (content) {
  if (typeof content !== 'string') throw educationError('AI Education must be text')
  if (content.length > HOME_MEMORY_MAX_EDUCATION_CHARS) throw educationError(`AI Education exceeds ${HOME_MEMORY_MAX_EDUCATION_CHARS} characters`, 413)
  return content
}

function createAiEducationStore ({ filePath, legacyContent = '' }) {
  const read = () => {
    assertRegularPath(filePath)
    if (fs.statSync(filePath).size > HOME_MEMORY_MAX_EDUCATION_CHARS * 4) throw educationError('AI Education file exceeds the size limit', 413)
    const bytes = fs.readFileSync(filePath)
    if (!isUtf8(bytes)) throw educationError('AI Education file is not valid UTF-8')
    return validateAiEducation(bytes.toString('utf8'))
  }
  const write = content => {
    validateAiEducation(content)
    assertRegularPath(filePath)
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    const temporary = `${filePath}.tmp-${crypto.randomUUID()}`
    let fd
    try {
      fd = fs.openSync(temporary, 'wx', 0o600)
      fs.writeFileSync(fd, content, 'utf8')
      fs.fsyncSync(fd)
      fs.closeSync(fd)
      fd = undefined
      fs.renameSync(temporary, filePath)
    } finally {
      if (fd !== undefined) fs.closeSync(fd)
      fs.rmSync(temporary, { force: true })
    }
  }
  const snapshot = () => {
    const content = read()
    return { name: path.basename(filePath), path: filePath, content, bytes: Buffer.byteLength(content, 'utf8'), revision: crypto.createHash('sha256').update(content, 'utf8').digest('hex'), maxChars: HOME_MEMORY_MAX_EDUCATION_CHARS }
  }
  // Existing files, including deliberately empty ones, always win over the
  // legacy flow property. Migration never replaces a user's saved education.
  assertRegularPath(filePath)
  if (!fs.existsSync(filePath)) write(legacyContent)
  return {
    read,
    write,
    snapshot,
    save ({ content, revision } = {}) {
      validateAiEducation(content)
      if (typeof revision !== 'string' || revision !== snapshot().revision) throw educationError('AI Education has changed. Reload it before saving.', 409)
      write(content)
      return snapshot()
    }
  }
}

function readBackupAiEducation (backup) {
  if (backup.files && Object.hasOwn(backup.files, 'aiEducation')) {
    const file = backup.files.aiEducation
    if (backup.version === 2) validateFile(file, 'aiEducation')
    if (!file || file.id !== 'aiEducation' || file.encoding !== 'utf8') throw educationError('Invalid AI Education backup file')
    return validateAiEducation(file.content)
  }
  if (backup.version === 2 && backup.node?.id) {
    const flows = JSON.parse(validateFile(backup.migration?.flows, 'nodeRedFlows'))
    if (!Array.isArray(flows)) throw educationError('Invalid backup migration flows')
    const source = flows.find(item => item?.type === 'cerebrumUltimate' && item.id === backup.node.id)
    if (source && Object.hasOwn(source, 'aiEducation')) return validateAiEducation(String(source.aiEducation || ''))
  }
  // Old backups without any education must leave the destination's file alone.
  return undefined
}

module.exports = { getAiEducationFilePath, validateAiEducation, createAiEducationStore, readBackupAiEducation }
