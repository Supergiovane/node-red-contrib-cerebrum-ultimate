'use strict'

const { createRequire } = require('module')

const loadDptlib = () => {
  try {
    const candidate = require('knxultimate')
    if (candidate && candidate.dptlib) return candidate.dptlib
  } catch (error) { /* KNX Ultimate is optional */ }

  try {
    const packagePath = require.resolve('node-red-contrib-knx-ultimate/package.json')
    const candidate = createRequire(packagePath)('knxultimate')
    if (candidate && candidate.dptlib) return candidate.dptlib
  } catch (error) { /* KNX Ultimate is not installed */ }

  return Object.freeze({
    resolve () { return null }
  })
}

const dptlib = loadDptlib()

const detectKnxDptAvailability = () => {
  try {
    return typeof dptlib.resolve === 'function' && dptlib.resolve('1.001') !== null
  } catch (error) {
    return false
  }
}

module.exports = {
  dptlib,
  knxDptAvailable: detectKnxDptAvailability()
}
