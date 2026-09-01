'use strict'

const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')
const checkOnly = process.argv.includes('--check')
const textExtensions = new Set(['.css', '.html', '.js', '.json', '.md', '.mjs', '.svg', '.txt', '.vue'])
const ignoredDirectories = new Set(['.cache', '.git', 'node_modules'])
const generatedAssetsDirectory = path.join(root, 'nodes', 'plugins', 'cerebrumUltimate-vue', 'assets')

const normalizeText = source => String(source)
  .replace(/^\uFEFF/, '')
  .replace(/[\u00A0\u2007\u202F]/g, ' ')
  .replace(/\u200B|\u200C|\u200D|\u2060|\uFEFF/g, '')
  .replace(/\u2028|\u2029/g, '\n')
  .replace(/\r\n?/g, '\n')
  .split('')
  .filter(character => {
    const code = character.charCodeAt(0)
    return code === 9 || code === 10 || code >= 32
  })
  .join('')

const files = []
const visit = directory => {
  fs.readdirSync(directory, { withFileTypes: true }).forEach(entry => {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) return
    const filePath = path.join(directory, entry.name)
    if (entry.isDirectory() && filePath === generatedAssetsDirectory) return
    if (entry.isDirectory()) visit(filePath)
    else if (entry.isFile() && textExtensions.has(path.extname(entry.name).toLowerCase())) files.push(filePath)
  })
}

visit(root)
const changed = []
files.forEach(filePath => {
  const source = fs.readFileSync(filePath, 'utf8')
  const normalized = normalizeText(source)
  if (normalized === source) return
  changed.push(path.relative(root, filePath))
  if (!checkOnly) fs.writeFileSync(filePath, normalized, 'utf8')
})

if (checkOnly && changed.length > 0) {
  process.stderr.write(`Gremlin characters found in:\n${changed.map(file => `- ${file}`).join('\n')}\n`)
  process.exitCode = 1
} else if (!checkOnly && changed.length > 0) {
  process.stdout.write(`Normalized ${changed.length} text file(s).\n`)
}
