'use strict'

const CEREBRUM_HISTORY_RETENTION_DEFAULT_DAYS = 30
const CEREBRUM_HISTORY_RETENTION_MAX_DAYS = 36500
const normalizeCerebrumHistoryRetentionDays = value => {
  if (!['number', 'string'].includes(typeof value)) return CEREBRUM_HISTORY_RETENTION_DEFAULT_DAYS
  const days = Number(value)
  return Number.isInteger(days) && days >= 1 && days <= CEREBRUM_HISTORY_RETENTION_MAX_DAYS ? days : CEREBRUM_HISTORY_RETENTION_DEFAULT_DAYS
}

module.exports = { CEREBRUM_HISTORY_RETENTION_DEFAULT_DAYS, CEREBRUM_HISTORY_RETENTION_MAX_DAYS, normalizeCerebrumHistoryRetentionDays }
