const { expect } = require('chai')

/* global describe, it */

const {
  appendCerebrumCameraEventDateTime,
  bindCerebrumCameraEventSnapshotEvidence,
  buildCerebrumCameraHistoryResultsContext,
  executeCerebrumCameraHistoryActions,
  matchesCerebrumCameraProviderReference,
  normalizeCerebrumCameraAction,
  redactCerebrumCameraHistoryCredentialText
} = require('../nodes/utils/cerebrumCamera')

describe('Cerebrum camera history', () => {
  const cameras = [{
    id: 'protect-1:camera-1',
    name: 'Ingresso principale',
    aliases: ['Ingresso'],
    providerId: 'unifi-ultimate:protect-1',
    adapterId: 'unifi-ultimate',
    online: false
  }]

  it('adds the localized event date, time and timezone to a recorded snapshot caption', () => {
    expect(appendCerebrumCameraEventDateTime({
      content: 'Snapshot dell’evento registrato.',
      eventAt: '2026-10-09T08:15:30.000Z',
      language: 'it',
      timeZone: 'Europe/Rome'
    })).to.equal('Data/ora evento: 09/10/2026, 10:15:30 CEST\nSnapshot dell’evento registrato.')

    const longCaption = appendCerebrumCameraEventDateTime({
      content: 'x'.repeat(2000),
      eventAt: '2026-10-09T08:15:30.000Z',
      language: 'it',
      timeZone: 'Europe/Rome'
    })
    expect(longCaption.slice(0, 1024)).to.include('Data/ora evento: 09/10/2026, 10:15:30 CEST')
  })

  it('matches an adapter alias without confusing scoped provider instances', () => {
    const provider = { id: 'unifi-ultimate:protect-1', adapterId: 'unifi-ultimate' }
    expect(matchesCerebrumCameraProviderReference({
      requestedProviderId: 'unifi-protect',
      providerId: provider.id,
      provider
    })).to.equal(true)
    expect(matchesCerebrumCameraProviderReference({
      requestedProviderId: 'unifi-ultimate:protect-2',
      providerId: provider.id,
      provider
    })).to.equal(false)
  })

  it('normalizes a paginated historical motion query without requiring a camera', () => {
    const action = normalizeCerebrumCameraAction({
      type: 'search_events',
      eventType: 'movement',
      from: '2026-09-09T08:00:00+02:00',
      to: '2026-09-09T10:00:00+02:00',
      offset: 100,
      limit: 500,
      reason: 'find the latest movement'
    }, cameras)

    expect(action).to.include({
      type: 'query_events',
      eventType: 'motion',
      unresolved: false,
      invalidRange: false,
      offset: 100,
      limit: 100
    })
    expect(action.from).to.equal('2026-09-09T06:00:00.000Z')
  })

  it('queries the owning provider, sorts evidence and removes raw payloads', async () => {
    const providerId = 'unifi-ultimate:protect-1'
    const calls = []
    const providers = new Map([[providerId, {
      id: providerId,
      adapterId: 'unifi-ultimate',
      async queryEvents (request, invocation) {
        calls.push({ request, invocation })
        return {
          events: [
            {
              providerId,
              cameraId: 'protect-1:camera-1',
              cameraName: 'Ingresso principale',
              eventId: 'event-old',
              eventType: 'motion',
              at: '2026-09-09T07:00:00.000Z',
              active: false,
              thumbnailAvailable: true,
              raw: { password: 'must-not-leak' }
            },
            {
              providerId,
              cameraId: 'protect-1:camera-1',
              cameraName: 'Ingresso principale',
              eventId: 'event-new',
              eventType: 'smartDetectZone',
              objectTypes: ['person'],
              at: '2026-09-09T08:00:00.000Z',
              endAt: '2026-09-09T08:00:04.000Z',
              active: false,
              thumbnailAvailable: true,
              raw: { cookie: 'must-not-leak' }
            }
          ],
          hasMore: true,
          nextOffset: 100
        }
      }
    }], ['unifi-ultimate:protect-2', {
      id: 'unifi-ultimate:protect-2',
      adapterId: 'unifi-ultimate',
      async queryEvents () {
        throw new Error('The resolved camera must not query another controller')
      }
    }]])
    const action = normalizeCerebrumCameraAction({
      type: 'query_events',
      providerId: 'unifi-ultimate',
      camera: 'Ingresso principale',
      eventType: 'motion',
      from: '2026-09-09T06:00:00.000Z',
      to: '2026-09-09T09:00:00.000Z',
      limit: 1,
      reason: 'latest movement'
    }, cameras)
    const results = await executeCerebrumCameraHistoryActions({ actions: [action], cameras, providers })

    expect(calls).to.have.length(1)
    expect(calls[0].request).to.include({ cameraId: 'protect-1:camera-1', offset: 0, limit: 1 })
    expect(calls[0].invocation).to.deep.equal({ historyCredentials: undefined, historyQueryScope: '' })
    expect(results[0]).to.include({ ok: true, returnedEvents: 1, hasMore: true })
    expect(results[0].events[0]).to.include({ eventId: 'event-new', eventType: 'smartDetectZone' })
    expect(results[0].continuations).to.deep.equal([{ providerId, offset: 100 }])
    expect(JSON.stringify(results)).not.to.include('must-not-leak')
    const context = buildCerebrumCameraHistoryResultsContext(results)
    expect(context).to.include('eventId=event-new')
    expect(context).to.include('Continuation: providerId=unifi-ultimate:protect-1 | offset=100')
  })

  it('passes per-Cerebrum history credentials only to the selected provider request', async () => {
    const providerId = 'unifi-ultimate:protect-1'
    const calls = []
    const providers = new Map([[providerId, {
      id: providerId,
      adapterId: 'unifi-ultimate',
      async queryEvents (request, invocation) {
        calls.push({ request, invocation })
        return { events: [] }
      }
    }]])
    const action = normalizeCerebrumCameraAction({
      type: 'query_events',
      providerId,
      camera: 'Ingresso principale',
      eventType: 'motion'
    }, cameras)
    const historyCredentials = { username: 'local-history-user', password: 'private-history-password' }

    const results = await executeCerebrumCameraHistoryActions({
      actions: [action],
      cameras,
      providers,
      historyQueryScope: 'cerebrum-node-1',
      resolveHistoryCredentials: ({ providerId: resolvedProviderId }) => {
        expect(resolvedProviderId).to.equal(providerId)
        return historyCredentials
      }
    })

    expect(calls).to.have.length(1)
    expect(calls[0].request).not.to.have.property('historyCredentials')
    expect(calls[0].invocation.historyCredentials).to.equal(historyCredentials)
    expect(calls[0].invocation.historyQueryScope).to.equal('cerebrum-node-1')
    expect(JSON.stringify(results)).not.to.include(historyCredentials.username)
    expect(JSON.stringify(results)).not.to.include(historyCredentials.password)
  })

  it('redacts credentials echoed by a failing history provider', async () => {
    const providerId = 'unifi-ultimate:protect-1'
    const historyCredentials = { username: 'private-local-user', password: 'private-local-password' }
    const providers = new Map([[providerId, {
      id: providerId,
      adapterId: 'unifi-ultimate',
      async queryEvents () {
        throw new Error(`Rejected ${historyCredentials.username}:${historyCredentials.password}`)
      }
    }]])
    const action = normalizeCerebrumCameraAction({
      type: 'query_events',
      providerId,
      camera: 'Ingresso principale',
      eventType: 'motion'
    }, cameras)

    const results = await executeCerebrumCameraHistoryActions({
      actions: [action],
      cameras,
      providers,
      resolveHistoryCredentials: () => historyCredentials
    })

    expect(JSON.stringify(results)).not.to.include(historyCredentials.username)
    expect(JSON.stringify(results)).not.to.include(historyCredentials.password)
    expect(results[0].error).to.equal('Rejected [redacted]:[redacted]')

    const specialCredentials = {
      username: 'local user@example.test',
      password: `${'x'.repeat(600)}&secret`
    }
    const encodedFailure = `Rejected ${encodeURIComponent(specialCredentials.username)} ${JSON.stringify(specialCredentials.password).slice(1, -1)}`
    const redacted = redactCerebrumCameraHistoryCredentialText(encodedFailure, specialCredentials)
    expect(redacted).to.equal('Rejected [redacted] [redacted]')
    expect(redacted.length).to.be.at.most(500)
  })

  it('preserves a bounded provider failure for the next reasoning pass', async () => {
    const providerId = 'unifi-ultimate:protect-1'
    const credentialError = 'UniFi Protect historical events require a local history username and password.'
    const providers = new Map([[providerId, {
      async queryEvents () {
        const error = new Error(credentialError)
        error.code = 'UNIFI_PROTECT_HISTORY_CREDENTIALS_REQUIRED'
        throw error
      }
    }]])
    const action = normalizeCerebrumCameraAction({
      type: 'query_events',
      providerId,
      camera: 'Ingresso principale',
      eventType: 'motion',
      reason: 'latest movement'
    }, cameras)

    const results = await executeCerebrumCameraHistoryActions({ actions: [action], cameras, providers })

    expect(results[0]).to.include({
      ok: false,
      returnedEvents: 0,
      error: credentialError
    })
    expect(results[0].errors).to.deep.equal([{ providerId, error: credentialError }])
    const context = buildCerebrumCameraHistoryResultsContext(results)
    expect(context).to.include(`FAILED — ${credentialError}`)
    expect(context).not.to.include('undefined')
  })

  it('prioritizes complete rows from the newest history page within a small byte budget', () => {
    const providerId = 'unifi-ultimate:protect-1'
    const makeEvent = (eventId, at) => ({
      providerId,
      cameraId: 'protect-1:camera-1',
      cameraName: 'Ingresso principale',
      eventId,
      eventType: 'motion',
      objectTypes: [],
      at,
      thumbnailAvailable: true
    })
    const results = [{
      ok: true,
      events: Array.from({ length: 20 }, (_, index) => makeEvent(`old-${index}`, `2026-09-09T07:${String(index).padStart(2, '0')}:00.000Z`)),
      hasMore: true,
      continuations: [{ providerId, offset: 100 }]
    }, {
      ok: true,
      events: [makeEvent('newly-found', '2026-09-09T08:00:00.000Z')],
      hasMore: true,
      continuations: [{ providerId, offset: 200 }]
    }]

    const context = buildCerebrumCameraHistoryResultsContext(results, { maxChars: 420 })

    expect(Buffer.byteLength(context, 'utf8')).to.be.at.most(420)
    expect(context).to.include('Query 2: 1 event(s) returned; more pages are available.')
    expect(context).to.include(`Continuation: providerId=${providerId} | offset=200`)
    expect(context).to.include('eventId=newly-found')
    expect(context).not.to.include('eventId=old-0')
    context.split('\n').filter(line => line.startsWith('[CH')).forEach(line => {
      expect(line).to.match(/snapshot=(?:available|unavailable)$/)
    })
  })

  it('requires an exact event id for a recorded snapshot action', () => {
    const missing = normalizeCerebrumCameraAction({ type: 'event_snapshot', camera: '' }, cameras)
    const ready = normalizeCerebrumCameraAction({
      type: 'historical_snapshot',
      providerId: 'unifi-ultimate:protect-1',
      camera: 'Ingresso',
      eventId: 'event-123'
    }, cameras)

    expect(missing.eventId).to.equal('')
    expect(ready).to.include({
      type: 'event_snapshot',
      providerId: 'unifi-ultimate:protect-1',
      cameraId: 'protect-1:camera-1',
      eventId: 'event-123',
      unresolved: false
    })
  })

  it('binds a recorded snapshot only to unique evidence returned in this turn', () => {
    const action = normalizeCerebrumCameraAction({
      type: 'event_snapshot',
      eventId: 'event-42',
      providerId: 'unifi-ultimate',
      camera: 'A camera name the model got wrong'
    }, [])
    const result = bindCerebrumCameraEventSnapshotEvidence(action, [{
      ok: true,
      events: [{
        providerId: 'unifi-ultimate:protect-1',
        eventId: 'event-42',
        cameraId: 'protect-1:camera-1',
        cameraName: 'Ingresso principale',
        at: '2026-09-09T08:00:00.000Z',
        thumbnailAvailable: true
      }]
    }])

    expect(result).to.include({
      providerId: 'unifi-ultimate:protect-1',
      eventId: 'event-42',
      cameraId: 'protect-1:camera-1',
      cameraName: 'Ingresso principale',
      eventAt: '2026-09-09T08:00:00.000Z',
      historicalEvidenceVerified: true,
      historicalSnapshotUnavailable: false,
      unresolved: false
    })
    expect(bindCerebrumCameraEventSnapshotEvidence({
      type: 'event_snapshot',
      eventId: 'invented'
    }, [])).to.include({
      historicalEvidenceVerified: false,
      historicalEvidenceAmbiguous: false
    })
    expect(bindCerebrumCameraEventSnapshotEvidence(action, [{
      ok: true,
      events: [{
        providerId: 'unifi-ultimate:protect-1',
        eventId: 'event-42',
        cameraId: 'protect-1:camera-1',
        cameraName: 'Ingresso principale',
        thumbnailAvailable: true
      }]
    }])).to.include({
      historicalEvidenceVerified: false,
      historicalEvidenceMissingTimestamp: true
    })
  })
})
