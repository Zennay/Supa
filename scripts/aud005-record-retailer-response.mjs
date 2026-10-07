import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { pathToFileURL } from 'node:url'

const RETAILERS = new Set(['PLUS', 'DekaMarkt'])
const CHANNELS = new Set(['email', 'phone', 'contact-form', 'meeting', 'other'])
const OUTCOMES = new Set([
  'allowed',
  'allowed-with-conditions',
  'licensed-route-required',
  'research-only',
  'denied',
  'unclear',
  'routed',
])
const FORBIDDEN_KEYS = new Set([
  'name',
  'fullName',
  'respondentName',
  'email',
  'emailAddress',
  'phone',
  'phoneNumber',
  'contact',
  'contactDetails',
  'person',
])
const CONSEQUENCE_KEYS = ['architecture', 'product', 'operatingCost', 'sourceStrategy']
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i
const PHONE_PATTERN = /(?:\+?\d[\d\s().-]{7,}\d)/

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function requireRecord(value, path) {
  assert(isRecord(value), `${path} must be an object`)
  return value
}

function requireString(value, path, { maxLength = 1000, checkPii = true } = {}) {
  assert(typeof value === 'string' && value.trim().length > 0, `${path} must be a non-empty string`)
  assert(value.length <= maxLength, `${path} must be at most ${maxLength} characters`)
  if (checkPii) rejectLikelyPii(value, path)
  return value.trim()
}

function requireOptionalString(value, path, options) {
  if (value === null || value === undefined || value === '') return null
  return requireString(value, path, options)
}

function requireBoolean(value, path) {
  assert(typeof value === 'boolean', `${path} must be a boolean`)
  return value
}

function requireEnum(value, allowed, path) {
  assert(allowed.has(value), `${path} is not an allowed value`)
  return value
}

function isValidIsoTimestamp(value) {
  if (typeof value !== 'string') return false

  const match = value.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/,
  )
  if (!match || !Number.isFinite(Date.parse(value))) return false

  const [, year, month, day, hour, minute, second, offset] = match
  const calendarDate = `${year}-${month}-${day}`
  const parsedCalendarDate = new Date(`${calendarDate}T00:00:00.000Z`)
  if (
    Number.isNaN(parsedCalendarDate.getTime()) ||
    parsedCalendarDate.toISOString().slice(0, 10) !== calendarDate
  ) {
    return false
  }

  if (Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59) {
    return false
  }

  if (offset !== 'Z') {
    const [offsetHour, offsetMinute] = offset
      .slice(1)
      .split(':')
      .map(Number)
    if (offsetHour > 23 || offsetMinute > 59) return false
  }

  return true
}

function requireTimestamp(value, path) {
  const normalized = requireString(value, path, { maxLength: 64, checkPii: false })
  assert(isValidIsoTimestamp(normalized), `${path} must be a valid ISO timestamp`)
  return normalized
}

function rejectLikelyPii(value, path) {
  assert(!EMAIL_PATTERN.test(value), `${path} must not contain an email address`)
  assert(!PHONE_PATTERN.test(value), `${path} must not contain a phone number`)
}

function requireEvidenceRef(value, path) {
  const normalized = requireString(value, path, { maxLength: 240, checkPii: false })
  assert(!EMAIL_PATTERN.test(normalized), `${path} must not contain an email address`)

  const phoneMatch = PHONE_PATTERN.test(normalized)
  const onlyPhoneSyntax = /^[+\d\s().-]+$/.test(normalized)
  const explicitlyPhoneFormatted = /[+()\s]/.test(normalized)
  assert(
    !(phoneMatch && (onlyPhoneSyntax || explicitlyPhoneFormatted)),
    `${path} must not contain a phone number`,
  )
  return normalized
}

function rejectForbiddenKeys(value, path = 'record') {
  if (Array.isArray(value)) {
    value.forEach((item, index) => rejectForbiddenKeys(item, `${path}[${index}]`))
    return
  }
  if (!isRecord(value)) return

  for (const [key, child] of Object.entries(value)) {
    assert(!FORBIDDEN_KEYS.has(key), `${path}.${key} is not allowed in a repository-safe AUD-005 record`)
    rejectForbiddenKeys(child, `${path}.${key}`)
  }
}

function requireStringArray(value, path, { maxItems = 12, maxLength = 500 } = {}) {
  assert(Array.isArray(value), `${path} must be an array`)
  assert(value.length <= maxItems, `${path} must contain at most ${maxItems} items`)
  return value.map((item, index) => requireString(item, `${path}[${index}]`, { maxLength }))
}

function validateScope(scope) {
  requireRecord(scope, 'scope')
  const normalized = {
    productContent: requireBoolean(scope.productContent, 'scope.productContent'),
    prices: requireBoolean(scope.prices, 'scope.prices'),
    promotions: requireBoolean(scope.promotions, 'scope.promotions'),
    availability: requireBoolean(scope.availability, 'scope.availability'),
    automation: requireBoolean(scope.automation, 'scope.automation'),
    storage: requireBoolean(scope.storage, 'scope.storage'),
  }
  assert(Object.values(normalized).some(Boolean), 'scope must cover at least one permission area')
  return normalized
}

function validateConsequences(consequences) {
  requireRecord(consequences, 'consequences')
  const normalized = {}
  for (const key of CONSEQUENCE_KEYS) {
    normalized[key] = requireStringArray(consequences[key] ?? [], `consequences.${key}`)
  }
  assert(
    CONSEQUENCE_KEYS.some((key) => normalized[key].length > 0),
    'consequences must record at least one architecture/product/cost/source-strategy consequence',
  )
  return normalized
}

export function validateRetailerResponseRecord(input) {
  requireRecord(input, 'record')
  rejectForbiddenKeys(input)

  assert(input.schemaVersion === 1, 'schemaVersion must equal 1')
  assert(input.recordType === 'aud005-retailer-response', 'recordType must equal aud005-retailer-response')

  const retailer = requireEnum(input.retailer, RETAILERS, 'retailer')
  const observedAt = requireTimestamp(input.observedAt, 'observedAt')
  const channel = requireEnum(input.channel, CHANNELS, 'channel')
  const respondentTeam = requireString(input.respondentTeam, 'respondentTeam', { maxLength: 120 })
  const scope = validateScope(input.scope)
  const outcome = requireEnum(input.outcome, OUTCOMES, 'outcome')
  const responseSummary = requireString(input.responseSummary, 'responseSummary', { maxLength: 1200 })
  const constraints = requireStringArray(input.constraints ?? [], 'constraints', { maxItems: 16, maxLength: 500 })
  const nextOwnerTeam = requireOptionalString(input.nextOwnerTeam, 'nextOwnerTeam', { maxLength: 120 })
  const evidenceRef = requireEvidenceRef(input.evidenceRef, 'evidenceRef')
  const consequences = validateConsequences(input.consequences)

  return {
    schemaVersion: 1,
    recordType: 'aud005-retailer-response',
    retailer,
    observedAt,
    channel,
    respondentTeam,
    scope,
    outcome,
    responseSummary,
    constraints,
    nextOwnerTeam,
    evidenceRef,
    consequences,
  }
}

export function buildPrivacySafeRetailerResponse(input) {
  const record = validateRetailerResponseRecord(input)

  return {
    ...record,
    privacySafe: true,
    productionReuseApproved: false,
    productionReuseApprovalStatus:
      record.outcome === 'allowed' || record.outcome === 'allowed-with-conditions'
        ? 'requires-explicit-gate-review'
        : 'not-approved',
    publicClaimEligible: false,
    evidenceBoundary:
      'This record captures stakeholder permission evidence only. It does not replace M3 observed-basket evidence or itself authorize production automated reuse. Production reuse remains disabled until the exact recorded scope and constraints pass the separate explicit permission gate.',
  }
}

function parseArgs(argv) {
  const positional = []
  let output = null
  let outputSeen = false

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === '--output') {
      assert(!outputSeen, '--output may only be specified once')
      const candidate = argv[index + 1]
      assert(
        typeof candidate === 'string' &&
          candidate.trim().length > 0 &&
          !candidate.startsWith('--'),
        '--output requires a file path',
      )
      output = candidate
      outputSeen = true
      index += 1
      continue
    }
    positional.push(value)
  }

  assert(
    positional.length === 1,
    'usage: aud005-record-retailer-response <response.json> [--output privacy-safe.json]',
  )
  return { input: positional[0], output }
}

export async function main(argv = process.argv.slice(2)) {
  const { input, output } = parseArgs(argv)
  let raw

  try {
    raw = JSON.parse(await readFile(input, 'utf8'))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`response JSON could not be read/parsed: ${message}`)
  }

  const report = buildPrivacySafeRetailerResponse(raw)
  const serialized = `${JSON.stringify(report, null, 2)}\n`

  if (output) {
    await mkdir(dirname(output), { recursive: true })
    await writeFile(output, serialized, { encoding: 'utf8', flag: 'wx' })
  } else {
    process.stdout.write(serialized)
  }

  return report
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
