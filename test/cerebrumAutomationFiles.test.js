'use strict'
/* eslint-env mocha */

const assert = require('assert').strict
const fs = require('fs')
const os = require('os')
const path = require('path')
const { createCerebrumAutomationFiles, registerCerebrumAutomationRoutes, MAX_SOURCE_BYTES } = require('../nodes/utils/cerebrumAutomationFiles')

describe('Editable JavaScript automation files', () => {
  let root, directory, store, archived
  beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cerebrum-sources-')))
    directory = path.join(root, 'automations', 'node-a')
    archived = []
    store = createCerebrumAutomationFiles({ directory, archiveRevision: entry => archived.push(entry) })
  })
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }))
  const saveSource = () => store.save({ name: 'window.js', origin: 'new', revision: '', content: 'module.exports = function register () {}\n' })

  it('starts with no examples and does not install or execute files', () => {
    assert.deepEqual(store.list().files, [])
    assert.equal(fs.existsSync(directory), false)
    assert.equal(archived.length, 0)
    assert.throws(() => store.read({ name: 'window.js', origin: 'example' }), /origin/)
  })

  it('saves real .js source and reads it after restart', () => {
    const saved = saveSource()
    assert.equal(saved.origin, 'local')
    assert.equal(saved.status, 'paused')
    assert.equal(saved.runtimeAvailable, true)
    assert.equal(fs.readFileSync(saved.path, 'utf8'), saved.content)
    const restarted = createCerebrumAutomationFiles({ directory })
    assert.equal(restarted.read({ name: 'window.js' }).revision, saved.revision)
    assert.deepEqual(restarted.list().files.map(file => [file.name, file.origin]), [['window.js', 'local']])
    assert.equal(archived[0].phase, 'prepared')
    assert.equal(archived[0].previous, null)
    assert.equal(archived[1].phase, 'saved')
  })

  it('preserves external modifications when a stale editor attempts to save', () => {
    const saved = saveSource()
    fs.writeFileSync(saved.path, '// manual edit\n')
    assert.throws(() => store.save({ ...saved, content: '// stale edit\n' }), error => error.status === 409)
    assert.equal(fs.readFileSync(saved.path, 'utf8'), '// manual edit\n')
    const latest = store.read({ name: saved.name })
    store.save({ ...latest, content: '// intentional update\n' })
    assert.equal(archived.at(-2).previous.content, '// manual edit\n')
  })

  it('rejects new source that would replace an existing local file', () => {
    saveSource()
    assert.throws(() => store.save({ name: 'window.js', origin: 'new', revision: '', content: '' }), error => error.status === 409)
  })

  it('validates source syntax without executing it and keeps the last saved source on failure', () => {
    const saved = saveSource()
    assert.throws(() => store.save({ ...saved, content: 'function {' }), error => error.status === 422)
    assert.equal(store.read({ name: saved.name }).content, saved.content)
    const next = store.save({ ...saved, content: 'while (true) {}\n' })
    assert.equal(next.content, 'while (true) {}\n')
    fs.writeFileSync(saved.path, 'function {')
    assert.match(store.read({ name: saved.name }).syntaxError, /SyntaxError/)
  })

  it('enforces source size and UTF-8 without changing the file', () => {
    const saved = saveSource()
    assert.throws(() => store.save({ ...saved, content: ' '.repeat(MAX_SOURCE_BYTES + 1) }), error => error.status === 413)
    assert.equal(store.read({ name: saved.name }).revision, saved.revision)
    fs.writeFileSync(saved.path, Buffer.from([0xff, 0xfe]))
    assert.throws(() => store.read({ name: saved.name }), /UTF-8/)
  })

  it('rejects traversal, absolute paths and symbolic links including broken links', () => {
    for (const name of ['../outside.js', '/outside.js', '.hidden.js', 'file.json', 'a/b.js', 'a\\b.js']) {
      assert.throws(() => store.save({ name, origin: 'new', revision: '', content: '' }), /filename/)
    }
    fs.mkdirSync(directory, { recursive: true })
    const outside = path.join(root, 'outside.js')
    fs.writeFileSync(outside, '// outside\n')
    fs.symlinkSync(outside, path.join(directory, 'linked.js'))
    fs.symlinkSync(path.join(root, 'missing.js'), path.join(directory, 'broken.js'))
    for (const name of ['linked.js', 'broken.js']) {
      assert.throws(() => store.read({ name }), /Symbolic links/)
      assert.throws(() => store.save({ name, origin: 'new', revision: '', content: '' }), /Symbolic links/)
    }
    assert.equal(fs.readFileSync(outside, 'utf8'), '// outside\n')
  })

  it('does not write if archiving the previous and candidate source fails', () => {
    const saved = saveSource()
    const broken = createCerebrumAutomationFiles({ directory, archiveRevision: () => { throw new Error('archive unavailable') } })
    assert.throws(() => broken.save({ ...saved, content: '// new\n' }), /archive unavailable/)
    assert.equal(store.read({ name: saved.name }).revision, saved.revision)
  })

  it('rechecks a revision immediately before publication', () => {
    const saved = saveSource()
    const racing = createCerebrumAutomationFiles({ directory, archiveRevision: () => fs.writeFileSync(saved.path, '// concurrent editor\n') })
    assert.throws(() => racing.save({ ...saved, content: '// stale replacement\n' }), error => error.status === 409)
    assert.equal(store.read({ name: saved.name }).content, '// concurrent editor\n')
    assert.deepEqual(fs.readdirSync(directory), ['window.js'])
  })

  it('exposes authenticated list, read and save routes for the selected deployed node', async () => {
    saveSource()
    const routes = new Map()
    const RED = {
      auth: { needsPermission: permission => permission },
      httpAdmin: {
        get: (url, permission, handler) => routes.set(`GET ${url}`, { permission, handler }),
        post: (url, permission, handler) => routes.set(`POST ${url}`, { permission, handler })
      }
    }
    const node = { type: 'cerebrumUltimate', listAutomationFiles: store.list, getAutomationFile: store.read, saveAutomationFile: store.save }
    registerCerebrumAutomationRoutes(RED, id => id === 'node-a' ? node : null)
    const get = routes.get('GET /cerebrumUltimate/sidebar/automations')
    const post = routes.get('POST /cerebrumUltimate/sidebar/automations/save')
    assert.equal(get.permission, 'flows.read')
    assert.equal(post.permission, 'flows.write')
    async function request (route, req) {
      const res = { code: 200, headers: {}, set (key, value) { this.headers[key] = value; return this }, status (code) { this.code = code; return this }, json (data) { this.data = data; return this } }
      await route.handler(req, res)
      return res
    }
    assert.equal((await request(get, { query: { nodeId: 'missing' } })).code, 404)
    const listed = await request(get, { query: { nodeId: 'node-a' } })
    assert.equal(listed.headers['Cache-Control'], 'no-store')
    assert.equal(listed.data.files[0].name, 'window.js')
    const read = await request(get, { query: { nodeId: 'node-a', name: 'window.js', origin: 'local' } })
    const written = await request(post, { body: { nodeId: 'node-a', ...read.data, content: '// updated' } })
    assert.equal(written.code, 200)
    assert.equal(written.data.origin, 'local')
    assert.equal((await request(post, { body: { nodeId: 'node-a', ...read.data } })).code, 409)
  })
})
