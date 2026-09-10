'use strict'

// Scheduled semantic work shares existing retrieval, Web, camera and TTS
// integrations. Only reads, read-only snapshots, speech and the final reply are
// dispatched here, never model writes or changes to memories, schedules,
// functions or camera watches.
async function runCerebrumAutomationAssistant ({ instruction, isCancelled, reason, research, read, camera, speak, notify }) {
  const assertCurrent = () => { if (isCancelled()) throw new Error('Automation execution was cancelled') }
  let webResults = []
  let response = await reason({ question: instruction })
  while (true) {
    assertCurrent()
    if (response.webActions?.length) {
      const result = await research(response)
      webResults = webResults.concat(result.results || [])
      response = result.response
      continue
    }
    const commands = (response.commands || []).filter(command => command.event === 'GroupValue_Read')
    if (commands.length) {
      const result = await read(commands)
      assertCurrent()
      if (!result.sent) throw new Error('Local sensor reads could not be sent')
      if (!response.reasoningState.progress('automation-sensor-read', commands, result.metadata)) throw new Error('Sensor reads produced no new evidence')
      response = await reason({
        question: instruction,
        reasoningState: response.reasoningState,
        memoryResearchResults: response.memoryResearchResults,
        catalogResearchResults: response.catalogResearchResults,
        webResearchResults: webResults,
        routineInspection: { routine: response.routine || { active: true, name: 'Local sensor inspection', phase: 'inspect' }, readResults: result.metadata }
      })
      continue
    }
    assertCurrent()
    const cameraActions = (Array.isArray(response.cameraActions) ? response.cameraActions : [])
      .filter(action => action && ['snapshot', 'event_snapshot'].includes(action.type))
    if (cameraActions.length) {
      if (cameraActions.length !== 1 || cameraActions.length !== response.cameraActions.length) {
        throw new Error('Scheduled assistant work permits one read-only camera snapshot action')
      }
      if (typeof camera !== 'function') throw new Error('Camera snapshots are unavailable to scheduled assistant work')
      await camera({
        actions: cameraActions,
        reply: response.content || response.reply || '',
        language: response.language || '',
        isCancelled
      })
    } else if (response.cameraActions?.length) {
      throw new Error('Scheduled assistant work cannot create or change camera watches')
    } else if (response.speechActions?.length) await speak(response.speechActions)
    else if (response.content || response.reply) await notify(response.content || response.reply)
    else throw new Error('The assistant produced no announcement or explanation')
    return
  }
}

module.exports = { runCerebrumAutomationAssistant }
