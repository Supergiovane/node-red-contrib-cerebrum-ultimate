'use strict'
/* eslint-env mocha */

const fs = require('fs')
const path = require('path')
const { expect } = require('chai')

const examplesDirectory = path.join(__dirname, '..', 'examples')
const packageJson = require('../package.json')

function loadExamples () {
  return fs.readdirSync(examplesDirectory)
    .filter(file => file.endsWith('.json'))
    .sort()
    .map(file => ({
      file,
      nodes: JSON.parse(fs.readFileSync(path.join(examplesDirectory, file), 'utf8'))
    }))
}

describe('example flows', function () {
  it('ships a broad collection of valid, self-contained flows', function () {
    const examples = loadExamples()
    const allIds = new Set()

    expect(examples.length).to.be.at.least(15)

    examples.forEach(({ file, nodes }) => {
      expect(nodes, file).to.be.an('array').and.have.length.greaterThan(0)

      const tabs = nodes.filter(node => node.type === 'tab')
      const ids = new Set(nodes.map(node => node.id))
      expect(tabs, `${file}: exactly one flow tab`).to.have.lengthOf(1)

      nodes.forEach(node => {
        expect(node, `${file}: every node has an id`).to.have.property('id').that.is.a('string')
        expect(node.id, `${file}: every node id is non-empty`).to.not.equal('')
        expect(allIds.has(node.id), `${file}: duplicate id ${node.id}`).to.equal(false)
        allIds.add(node.id)

        if (node.z) {
          expect(node.z, `${file}: ${node.id} belongs to its flow tab`).to.equal(tabs[0].id)
        }

        if (node.type === 'cerebrumUltimate') {
          expect(node.wires, `${file}: Cerebrum exposes five outputs`).to.be.an('array').with.lengthOf(5)
          expect(node.llmRequireCommandConfirmation, `${file}: confirmation remains enabled`).to.equal(true)
        }

        if (!Array.isArray(node.wires)) return
        node.wires.flat().forEach(targetId => {
          expect(ids.has(targetId), `${file}: wire ${node.id} → ${targetId} stays inside the example`).to.equal(true)
        })
      })
    })
  })

  it('does not embed credentials, gateways or automatic actuator tests', function () {
    const examples = loadExamples()
    const forbiddenAutomaticTopics = new Set(['reset', 'run_actuator_test', 'run_test_plan'])
    const optionalPackages = [
      'node-red-contrib-home-assistant-websocket',
      'node-red-contrib-telegrambot',
      'node-red-contrib-tts-ultimate',
      'node-red-contrib-knx-ultimate'
    ]

    examples.forEach(({ file, nodes }) => {
      expect(nodes.some(node => node.type === 'knxUltimate-config'), `${file}: no KNX gateway is embedded`).to.equal(false)

      nodes.forEach(node => {
        expect(node, `${file}: credentials are never exported`).to.not.have.property('credentials')

        Object.entries(node).forEach(([key, value]) => {
          if (!/(?:token|password|api.?key)$/i.test(key)) return
          expect(value, `${file}: ${key} is empty`).to.satisfy(candidate => candidate === '' || candidate === null || candidate === undefined)
        })

        if (node.type === 'inject') {
          const configuredTopic = String(node.topic || '')
          const propTopic = Array.isArray(node.props)
            ? node.props.find(prop => prop.p === 'topic' && prop.v !== undefined)
            : null
          const topic = propTopic ? String(propTopic.v || '') : configuredTopic
          expect(forbiddenAutomaticTopics.has(topic), `${file}: no destructive or active test Inject node`).to.equal(false)
        }

        if (node.type === 'ha-api' || node.type === 'knxUltimate') {
          expect(node.server, `${file}: external server selection is left to the user`).to.equal('')
        }

        if (node.type === 'ttsultimate') {
          expect(node.playertype, `${file}: TTS starts without a physical player`).to.equal('noplayer')
        }
      })
    })

    optionalPackages.forEach(packageName => {
      expect(packageJson.dependencies, `${packageName} remains optional`).to.not.have.property(packageName)
    })
  })
})
