'use strict'
/* eslint-env mocha */
const { expect } = require('chai')
const {
  CEREBRUM_RUNTIME_STATE_MAX_BYTES,
  createEmptyCerebrumRuntimeState,
  normalizeCerebrumRuntimeState,
  parseCerebrumRuntimeState
} = require('../nodes/utils/cerebrumRuntimeState')

const NOW = Date.parse('2026-09-06T10:00:00.000Z')
const HOUR_MS = 60 * 60 * 1000
const hash = index => index.toString(16).padStart(64, '0')
const state = (overrides = {}) => ({
  ga: '1/2/3',
  open: true,
  openedAt: NOW - 60000,
  lastSeenAt: NOW,
  lastSentAt: NOW - 30000,
  nextCheckAt: NOW + 60000,
  value: 'open',
  confidence: 0.9,
  ...overrides
})
const serialize = value => `${JSON.stringify(value, null, 2)}\n`

describe('Cerebrum runtime persistence', () => {
  it('restores Web reservations, camera cooldowns, learned limits and pending cover checks after restart', () => {
    const saved = normalizeCerebrumRuntimeState({
      updatedAt: new Date(NOW).toISOString(),
      webRequestTimestamps: [NOW - 30000, NOW],
      webAccessLastSuccessAt: NOW - 30000,
      webAccessLastError: 'Provider temporarily unavailable',
      cameraWatchLastTriggered: new Map([['front-door', NOW - 1000]]),
      learnedContextLimits: new Map([[hash(1), 32000]]),
      proactiveStates: new Map([['1/2/3', state()]])
    }, { now: NOW })

    const restored = parseCerebrumRuntimeState(serialize(saved), { now: NOW + 5000 })
    expect(restored).to.deep.equal(saved)
    expect(new Map(restored.cameraWatchLastTriggered).get('front-door')).to.equal(NOW - 1000)
    expect(new Map(restored.learnedContextLimits).get(hash(1))).to.equal(32000)
    expect(restored.proactiveStates[0]).to.include({ open: true, nextCheckAt: NOW + 60000, lastSentAt: NOW - 30000 })
  })

  it('preserves a disabled future check through JSON and resets the opening time of closed covers', () => {
    const saved = normalizeCerebrumRuntimeState({
      proactiveStates: [state({ nextCheckAt: Infinity }), state({ ga: '1/2/4', open: false, nextCheckAt: Infinity })]
    }, { now: NOW })
    const restored = parseCerebrumRuntimeState(serialize(saved), { now: NOW })
    expect(restored.proactiveStates[0].nextCheckAt).to.equal(Number.MAX_SAFE_INTEGER)
    expect(restored.proactiveStates[0].nextCheckAt).to.be.greaterThan(NOW + 365 * 24 * HOUR_MS)
    expect(restored.proactiveStates[1]).to.include({ openedAt: 0, open: false, nextCheckAt: Number.MAX_SAFE_INTEGER })
    expect(serialize(saved)).not.to.include('null')
  })

  it('saves only operational fields and hashed endpoint identities, excluding messages, catalog data and credentials', () => {
    const saved = normalizeCerebrumRuntimeState({
      credentials: { apiKey: 'TOP-SECRET' },
      raw: { payload: 'PRIVATE-MESSAGE' },
      endpoint: 'https://user:SECRET@example.invalid/v1',
      learnedContextLimits: new Map([
        ['https://user:SECRET@example.invalid/v1', 32000],
        [hash(255).toUpperCase(), 16000]
      ]),
      proactiveStates: [state({
        raw: { payload: 'PRIVATE-MESSAGE' },
        catalogItem: { credentials: 'CATALOG-SECRET' },
        credentials: { token: 'TOP-SECRET' },
        value: { raw: 'NESTED-SECRET' }
      })]
    }, { now: NOW })
    const content = serialize(saved)
    for (const secret of ['SECRET', 'PRIVATE-MESSAGE', 'credentials', 'catalogItem', 'endpoint', 'raw']) {
      expect(content).not.to.include(secret)
    }
    expect(saved.learnedContextLimits).to.deep.equal([[hash(255), 16000]])
    expect(saved.proactiveStates[0].value).to.equal(null)
    expect(() => parseCerebrumRuntimeState(content, { now: NOW })).not.to.throw()
  })

  it('expires reservations and cooldowns at their boundaries while retaining only the newest bounded entries', () => {
    const saved = normalizeCerebrumRuntimeState({
      webRequestTimestamps: [NOW - HOUR_MS, NOW + 1, -1, ...Array.from({ length: 503 }, (_, index) => NOW - index)],
      cameraWatchLastTriggered: [
        ['expired', NOW - 30 * 24 * HOUR_MS],
        ['future', NOW + 1],
        ...Array.from({ length: 1003 }, (_, index) => [`camera-${index}`, NOW - index]),
        ['camera-0', NOW - 5000]
      ],
      learnedContextLimits: Array.from({ length: 66 }, (_, index) => [hash(index), 1000 + index]),
      proactiveStates: [
        ...Array.from({ length: 603 }, (_, index) => state({ ga: `cover-${index}`, lastSeenAt: NOW - index })),
        state({ ga: 'cover-0', lastSeenAt: NOW - 5000, value: 'stale' })
      ]
    }, { now: NOW })

    expect(saved.webRequestTimestamps).to.have.length(500)
    expect(saved.webRequestTimestamps[0]).to.equal(NOW - 499)
    expect(saved.webRequestTimestamps[499]).to.equal(NOW)
    expect(saved.cameraWatchLastTriggered).to.have.length(1000)
    expect(new Map(saved.cameraWatchLastTriggered).get('camera-0')).to.equal(NOW)
    expect(new Map(saved.cameraWatchLastTriggered).has('expired')).to.equal(false)
    expect(new Map(saved.cameraWatchLastTriggered).has('future')).to.equal(false)
    expect(saved.learnedContextLimits).to.have.length(64)
    expect(saved.learnedContextLimits[0]).to.deep.equal([hash(2), 1002])
    expect(saved.proactiveStates).to.have.length(600)
    expect(saved.proactiveStates[0].ga).to.equal('cover-599')
    expect(saved.proactiveStates[599]).to.include({ ga: 'cover-0', value: 'open' })

    const restarted = parseCerebrumRuntimeState(serialize(saved), { now: NOW + HOUR_MS })
    expect(restarted.webRequestTimestamps).to.deep.equal([])
    expect(restarted.cameraWatchLastTriggered).to.have.length(1000)
  })

  it('keeps worst-case escaped JSON within the file limit and preserves the most recent activity', () => {
    const identifier = (index, length) => String(index).padEnd(length, '"')
    const saved = normalizeCerebrumRuntimeState({
      webAccessLastError: 'è'.repeat(500),
      cameraWatchLastTriggered: Array.from({ length: 1000 }, (_, index) => [identifier(index, 160), NOW - index]),
      proactiveStates: Array.from({ length: 600 }, (_, index) => state({
        ga: identifier(index, 32),
        lastSeenAt: NOW - index,
        nextCheckAt: Infinity,
        value: '"'.repeat(160)
      }))
    }, { now: NOW })

    expect(Buffer.byteLength(saved.webAccessLastError, 'utf8')).to.equal(500)
    expect(Buffer.byteLength(serialize(saved), 'utf8')).to.be.at.most(CEREBRUM_RUNTIME_STATE_MAX_BYTES)
    expect(saved.proactiveStates.length).to.be.lessThan(600)
    expect(saved.proactiveStates[saved.proactiveStates.length - 1].ga).to.equal(identifier(0, 32))
    expect(parseCerebrumRuntimeState(serialize(saved), { now: NOW })).to.deep.equal(saved)
  })

  it('rejects damaged or oversized files instead of silently replacing them with an empty state', () => {
    for (const content of [undefined, '{', 'null', '[]', '{}', ' '.repeat(CEREBRUM_RUNTIME_STATE_MAX_BYTES + 1)]) {
      expect(() => parseCerebrumRuntimeState(content, { now: NOW })).to.throw()
    }
    const invalidFields = [
      { version: 2 },
      { updatedAt: 'invalid-date' },
      { webRequestTimestamps: [NOW, -1] },
      { webAccessLastSuccessAt: null },
      { webAccessLastError: 'è'.repeat(251) },
      { cameraWatchLastTriggered: [['camera', 'yesterday']] },
      { cameraWatchLastTriggered: [['camera\nwith-control-character', NOW]] },
      { learnedContextLimits: [['plain-endpoint', 1000]] },
      { learnedContextLimits: [[hash(1), 0]] },
      { proactiveStates: [state({ open: 'yes' })] },
      { proactiveStates: [state({ lastSentAt: -1 })] },
      { proactiveStates: [state({ nextCheckAt: null })] },
      { proactiveStates: [state({ value: { raw: true } })] },
      { proactiveStates: [state({ confidence: 1.1 })] }
    ]
    for (const invalid of invalidFields) {
      const content = serialize({ ...createEmptyCerebrumRuntimeState({ now: NOW }), ...invalid })
      expect(() => parseCerebrumRuntimeState(content, { now: NOW }), JSON.stringify(invalid)).to.throw('Invalid Cerebrum runtime state')
    }
  })
})
