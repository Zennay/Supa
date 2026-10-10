import { pathToFileURL } from 'node:url'

/**
 * Read-only M3 field-session clock. A timing check is not retailer evidence,
 * proof of price-context equality, or permission for a savings claim.
 * Only explicit timezone-bearing ISO timestamps are accepted.
 */
export const MAX_FIELD_WINDOW_MS = 24 * 60 * 60 * 1000

const ISO_INSTANT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|([+-])(\d{2}):(\d{2}))$/

export function parseFieldInstant(value) {
  if (typeof value !== 'string') return null
  const parts = ISO_INSTANT.exec(value)
  if (!parts) return null

  const [, yearRaw, monthRaw, dayRaw, hourRaw, minuteRaw, secondRaw,
    millisRaw = '', zone, sign, zoneHourRaw, zoneMinuteRaw] = parts
  const [year, month, day, hour, minute, second] =
    [yearRaw, monthRaw, dayRaw, hourRaw, minuteRaw, secondRaw].map(Number)
  const millisecond = Number(millisRaw.padEnd(3, '0'))
  const zoneHour = zone === 'Z' ? 0 : Number(zoneHourRaw)
  const zoneMinute = zone === 'Z' ? 0 : Number(zoneMinuteRaw)
  if (month < 1 || month > 12 || day < 1 || day > 31 ||
      hour > 23 || minute > 59 || second > 59 ||
      zoneHour > 14 || zoneMinute > 59 ||
      (zoneHour === 14 && zoneMinute !== 0)) {
    return null
  }

  // setUTCFullYear handles 0000..0099 without Date.UTC's 1900-year coercion.
  const local = new Date(0)
  local.setUTCFullYear(year, month - 1, day)
  local.setUTCHours(hour, minute, second, millisecond)
  if (local.getUTCFullYear() !== year ||
      local.getUTCMonth() !== month - 1 ||
      local.getUTCDate() !== day ||
      local.getUTCHours() !== hour ||
      local.getUTCMinutes() !== minute ||
      local.getUTCSeconds() !== second) {
    return null
  }

  const direction = sign === '-' ? -1 : 1
  const zoneOffsetMs = direction * (zoneHour * 60 + zoneMinute) * 60_000
  const instant = local.getTime() - zoneOffsetMs
  return Number.isFinite(instant) ? instant : null
}

// Direct callers can supply malformed records even though CLI arguments are strict.
// Read only own data descriptors: do not evaluate getters on untrusted input.
function fieldWindowInput(value) {
  if (value === null || typeof value !== 'object') return null
  try {
    // Array.isArray itself throws for revoked proxies: keep it inside the guard.
    if (Array.isArray(value)) return null
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) return null
    const own = Object.getOwnPropertyDescriptors(value)
    for (const key of ['baselineAt', 'candidateAt', 'nowMs']) {
      if (Object.hasOwn(own, key) && !Object.hasOwn(own[key], 'value')) return null
    }
    return {
      baselineAt: Object.hasOwn(own, 'baselineAt') ? own.baselineAt.value : undefined,
      candidateAt: Object.hasOwn(own, 'candidateAt') ? own.candidateAt.value : null,
      nowMs: Object.hasOwn(own, 'nowMs') && own.nowMs.value !== undefined
        ? own.nowMs.value : Date.now(),
    }
  } catch {
    // Revoked proxies or hostile reflection traps cannot become valid evidence.
    return null
  }
}

export function assessFieldWindow(input) {
  const fields = fieldWindowInput(input)
  if (fields === null) {
    return { status: 'invalid', reason: 'field-window inputs missing or malformed' }
  }
  const { baselineAt, candidateAt, nowMs } = fields
  const baseline = parseFieldInstant(baselineAt)
  if (baseline === null || !Number.isFinite(nowMs) || baseline > nowMs) {
    return { status: 'invalid', reason: 'baseline timestamp missing, malformed or future-dated' }
  }

  if (candidateAt === null || candidateAt === undefined) {
    const remainingMs = baseline + MAX_FIELD_WINDOW_MS - nowMs
    return remainingMs < 0
      ? { status: 'expired', reason: '24-hour window has elapsed; recollect both stores' }
      : { status: 'pending', remainingMinutes: Math.ceil(remainingMs / 60_000) }
  }

  const candidate = parseFieldInstant(candidateAt)
  if (candidate === null || candidate > nowMs) {
    return { status: 'invalid', reason: 'candidate timestamp malformed or future-dated' }
  }

  const elapsedMs = Math.abs(candidate - baseline)
  if (elapsedMs > MAX_FIELD_WINDOW_MS) {
    return { status: 'expired', reason: 'observations are more than 24 hours apart' }
  }

  return {
    status: 'within-window',
    elapsedMinutes: Math.ceil(elapsedMs / 60_000),
  }
}

function parseArgs(args) {
  if (args.length !== 2 && args.length !== 4) {
    throw new Error('usage: node scripts/m3-field-window-preflight.mjs --baseline ISO [--candidate ISO]')
  }
  if (args[0] !== '--baseline' || typeof args[1] !== 'string' ||
      (args.length === 4 && (args[2] !== '--candidate' || typeof args[3] !== 'string' || args[3].trim() === ''))) {
    throw new Error('usage: node scripts/m3-field-window-preflight.mjs --baseline ISO [--candidate ISO]')
  }
  return { baselineAt: args[1], candidateAt: args.length === 4 ? args[3] : null }
}

export function main(args = process.argv.slice(2), write = console.log, nowMs = Date.now()) {
  const result = assessFieldWindow({ ...parseArgs(args), nowMs })
  // Do not echo input timestamps, pseudonyms, locations or potential prices.
  if (result.status === 'within-window') {
    write('WINDOW ONLY: observations are at most 24 hours apart. This does not validate prices, permission, basket equality or any savings claim.')
    return 0
  }
  if (result.status === 'pending') {
    const hours = Math.floor(result.remainingMinutes / 60)
    const minutes = result.remainingMinutes % 60
    write(`PENDING: DekaMarkt nog niet gemeten; maximaal ${hours} uur en ${minutes} ${minutes === 1 ? 'minuut' : 'minuten'} over voor dezelfde prijscontext. Nog geen besparingsbewijs.`)
    return 2
  }
  write('NOT READY: invalid or expired observation window. Verify/recollect genuine observations; no savings claim.')
  return 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = main()
  } catch {
    console.error('usage: node scripts/m3-field-window-preflight.mjs --baseline ISO [--candidate ISO]')
    process.exitCode = 1
  }
}
