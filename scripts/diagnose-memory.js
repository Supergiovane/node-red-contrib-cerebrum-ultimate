'use strict'

// Read-only Linux sidecar: measure Node-RED and the guest, without loading flows,
// requesting snapshots/GC, reading archive contents or changing the runtime.
const fs = require('fs')
const path = require('path')

const numericFields = text => Object.fromEntries(String(text || '').split('\n').flatMap(line => {
  const match = line.match(/^([\w()]+):\s+(\d+)(?:\s+kB)?\s*$/)
  return match ? [[match[1], Number(match[2])]] : []
}))
const mib = value => Number.isFinite(value) ? Number((value / 1024).toFixed(1)) : null

function sampleMemory (pid, { read = file => fs.readFileSync(file, 'utf8'), now = Date.now } = {}) {
  const status = numericFields(read(`/proc/${pid}/status`))
  const memory = numericFields(read('/proc/meminfo'))
  let io = {}
  try { io = numericFields(read(`/proc/${pid}/io`)) } catch (error) { /* may require the process owner */ }
  return {
    at: new Date(now()).toISOString(),
    pid,
    process: {
      rssMiB: mib(status.VmRSS),
      anonymousMiB: mib(status.RssAnon),
      fileMiB: mib(status.RssFile),
      swapMiB: mib(status.VmSwap),
      threads: status.Threads || null,
      readMiB: mib(io.rchar / 1024),
      diskReadMiB: mib(io.read_bytes / 1024),
      diskWriteMiB: mib(io.write_bytes / 1024)
    },
    guest: {
      totalMiB: mib(memory.MemTotal),
      availableMiB: mib(memory.MemAvailable),
      freeMiB: mib(memory.MemFree),
      cachedMiB: mib(memory.Cached),
      buffersMiB: mib(memory.Buffers),
      reclaimableSlabMiB: mib(memory.SReclaimable),
      anonymousMiB: mib(memory.AnonPages),
      swapUsedMiB: mib(memory.SwapTotal - memory.SwapFree)
    }
  }
}

function findNodeRedPid () {
  const candidates = fs.readdirSync('/proc').filter(name => /^\d+$/.test(name)).filter(name => {
    if (Number(name) === process.pid) return false
    try {
      const comm = fs.readFileSync(`/proc/${name}/comm`, 'utf8').trim()
      if (comm === 'node-red') return true
      if (!/^node(?:js)?$/.test(comm)) return false
      const args = fs.readFileSync(`/proc/${name}/cmdline`, 'utf8').split('\0')
      return args.some(arg => path.basename(arg) === 'node-red' || /[/]node-red[/]red\.js$/.test(arg))
    } catch (error) { return false }
  })
  if (candidates.length !== 1) throw new Error(`Expected one Node-RED process; found ${candidates.length}. Pass its PID explicitly.`)
  return Number(candidates[0])
}

async function main () {
  if (process.platform !== 'linux') throw new Error('Run this script inside the Linux VM that hosts Node-RED.')
  const pid = process.argv[2] && process.argv[2] !== 'auto' ? Number(process.argv[2]) : findNodeRedPid()
  const duration = Number(process.argv[3] || 360)
  if (!Number.isSafeInteger(pid) || pid <= 0 || !Number.isFinite(duration) || duration < 20 || duration > 3600) throw new Error('Usage: node scripts/diagnose-memory.js [PID|auto] [duration-seconds: 20..3600]')
  const until = Date.now() + duration * 1000
  do {
    process.stdout.write(JSON.stringify(sampleMemory(pid)) + '\n')
    const remaining = until - Date.now()
    if (remaining <= 0) break
    await new Promise(resolve => setTimeout(resolve, Math.min(20000, remaining)))
  } while (true)
}

if (require.main === module) main().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1 })
module.exports = { numericFields, sampleMemory }
