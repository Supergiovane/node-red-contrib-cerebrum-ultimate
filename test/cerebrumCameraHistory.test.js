const { expect } = require('chai')

/* global describe, it */

const {
  bindCerebrumCameraEventSnapshotEvidence,
  buildCerebrumCameraHistoryResultsContext,
  executeCerebrumCameraHistoryActions,
  normalizeCerebrumCameraAction
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
      async queryEvents (request) {
        calls.push(request)
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
    }]])
    const action = normalizeCerebrumCameraAction({
      type: 'query_events',
      providerId,
      camera: 'Ingresso principale',
      eventType: 'motion',
      from: '2026-09-09T06:00:00.000Z',
      to: '2026-09-09T09:00:00.000Z',
      limit: 1,
      reason: 'latest movement'
    }, cameras)
    const results = await executeCerebrumCameraHistoryActions({ actions: [action], cameras, providers })

    expect(calls).to.have.length(1)
    expect(calls[0]).to.include({ cameraId: 'protect-1:camera-1', offset: 0, limit: 1 })
    expect(results[0]).to.include({ ok: true, returnedEvents: 1, hasMore: true })
    expect(results[0].events[0]).to.include({ eventId: 'event-new', eventType: 'smartDetectZone' })
    expect(results[0].continuations).to.deep.equal([{ providerId, offset: 100 }])
    expect(JSON.stringify(results)).not.to.include('must-not-leak')
    const context = buildCerebrumCameraHistoryResultsContext(results)
    expect(context).to.include('eventId=event-new')
    expect(context).to.include('Continuation: providerId=unifi-ultimate:protect-1 | offset=100')
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
      providerId: 'unifi-ultimate:protect-1',
      camera: 'A camera name the model got wrong'
    }, [])
    const result = bindCerebrumCameraEventSnapshotEvidence(action, [{
      ok: true,
      events: [{
        providerId: 'unifi-ultimate:protect-1',
        eventId: 'event-42',
        cameraId: 'protect-1:camera-1',
        cameraName: 'Ingresso principale',
        thumbnailAvailable: true
      }]
    }])

    expect(result).to.include({
      providerId: 'unifi-ultimate:protect-1',
      eventId: 'event-42',
      cameraId: 'protect-1:camera-1',
      cameraName: 'Ingresso principale',
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
  })
})
