'use strict'

const assert = require('assert')
const fs = require('fs')
const path = require('path')
const vm = require('vm')

const registeredNodes = new Map()
const registeredPlugins = new Map()
const noopRoute = () => {}
const RED = {
  auth: { needsPermission: () => (req, res, next) => { if (next) next() } },
  hooks: { add: noopRoute, remove: noopRoute },
  httpAdmin: { get: noopRoute, post: noopRoute, use: noopRoute },
  nodes: {
    createNode: noopRoute,
    getNode: () => undefined,
    registerType: (type, constructor) => registeredNodes.set(type, constructor)
  },
  plugins: {
    registerPlugin: (id, definition) => registeredPlugins.set(id, definition)
  },
  settings: { userDir: process.cwd() }
}

const root = path.resolve(__dirname, '..')
require(path.join(root, 'nodes', 'cerebrumUltimate'))(RED)
require(path.join(root, 'nodes', 'cerebrumHomeAssistant'))(RED)
require(path.join(root, 'nodes', 'plugins', 'cerebrum-runtime-plugin'))(RED)

assert(registeredNodes.has('cerebrumUltimate'))
assert(registeredNodes.has('cerebrumHomeAssistant'))
assert(registeredPlugins.has('cerebrumUltimateRuntime'))

const editorFiles = ['nodes/cerebrumUltimate.html', 'nodes/cerebrumHomeAssistant.html']
let editorScriptCount = 0
editorFiles.forEach(relativePath => {
  const html = fs.readFileSync(path.join(root, relativePath), 'utf8')
  const scripts = html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)
  for (const match of scripts) {
    if (/\bsrc\s*=/.test(match[1])) continue
    if (!/type\s*=\s*["']text\/javascript["']/i.test(match[1])) continue
    const compiled = new vm.Script(match[2], { filename: relativePath })
    assert(compiled)
    editorScriptCount += 1
  }
})

const localeRoot = path.join(root, 'nodes', 'locales')
fs.readdirSync(localeRoot, { withFileTypes: true }).filter(entry => entry.isDirectory()).forEach(entry => {
  const localeFile = path.join(localeRoot, entry.name, 'cerebrumUltimate.json')
  JSON.parse(fs.readFileSync(localeFile, 'utf8'))
})

assert(editorScriptCount >= 2)
process.stdout.write(`Cerebrum Ultimate runtime modules, ${editorScriptCount} editor scripts and locale catalogs loaded successfully.\n`)
