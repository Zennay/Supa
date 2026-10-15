/**
 * Private-only M3 study gate. Stacked on the original code-pin PR (#2837).
 * This is NOT a replacement for the canonical observed-week report or a
 * retailer authorization / public saving publication step.
 */
import { open, constants } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { parseStrictPrivateM3Manifest, verifyPrivateM3StudyCodePin } from './m3-field-code-pin.mjs'
import { validateObservedWeekInput, buildObservedWeekReport } from './m3-assess-observed-week.mjs'
import { buildObservationSheet } from '../src/domain/m3ObservationSheet.ts'

const STUDY_MAX_BYTES = 4 * 1024 * 1024
const MANIFEST_MAX_BYTES = 4096
const REASONS = Object.freeze({
  invalid: 'M3 private study provenance preflight refused',
})

function deny() {
  throw new Error(REASONS.invalid)
}

async function boundedRegularFile(path, maxBytes) {
  if (typeof path !== 'string' || !path || path.startsWith('-')) deny()
  let handle
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    const stat = await handle.stat()
    if (!stat.isFile() || stat.nlink !== 1 ||
        stat.size <= 0 || stat.size > maxBytes) deny()
    const buffer = Buffer.alloc(maxBytes + 1)
    let offset = 0
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, null)
      if (bytesRead === 0) break
      offset += bytesRead
    }
    if (offset < 1 || offset > maxBytes) deny()
    return buffer.subarray(0, offset)
  } catch {
    deny()
  } finally {
    await handle?.close().catch(() => {})
  }
}

// A digest binds the original bytes, not the meaning of contradictory JSON.
// Reject repeated *decoded* keys at every nesting depth before JSON.parse can
// discard an earlier price, demand, retailer identity or participant field.
export function assertUnambiguousM3StudyJson(raw) {
  if (typeof raw !== 'string' || raw.length === 0 ||
      Buffer.byteLength(raw, 'utf8') > STUDY_MAX_BYTES) deny()
  let index = 0
  let examinedKeys = 0
  const maxNesting = 80
  const maxKeys = 50000
  const whitespace = () => {
    while (index < raw.length &&
      [9, 10, 13, 32].includes(raw.charCodeAt(index))) index += 1
  }
  const expect = (ch) => {
    whitespace()
    if (raw[index] !== ch) deny()
    index += 1
  }
  const quoted = () => {
    whitespace()
    const start = index
    if (raw[index++] !== '"') deny()
    let ended = false
    while (index < raw.length) {
      const c = raw[index++]
      if (c === '\\') {
        if (index >= raw.length) deny()
        index += 1
      } else if (c === '"') {
        ended = true
        break
      } else if (c.charCodeAt(0) < 0x20) deny()
    }
    if (!ended) deny()
    try {
      return JSON.parse(raw.slice(start, index))
    } catch {
      deny()
    }
  }
  const value = (depth) => {
    if (depth > maxNesting) deny()
    whitespace()
    const ch = raw[index]
    if (ch === '"') {
      quoted()
      return
    }
    if (ch === '{') {
      index += 1
      whitespace()
      if (raw[index] === '}') {
        index += 1
        return
      }
      const keys = new Set()
      while (true) {
        const key = quoted()
        if (keys.has(key) || ++examinedKeys > maxKeys) deny()
        keys.add(key)
        expect(':')
        value(depth + 1)
        whitespace()
        if (raw[index] === '}') {
          index += 1
          return
        }
        expect(',')
      }
    }
    if (ch === '[') {
      index += 1
      whitespace()
      if (raw[index] === ']') {
        index += 1
        return
      }
      while (true) {
        value(depth + 1)
        whitespace()
        if (raw[index] === ']') {
          index += 1
          return
        }
        expect(',')
      }
    }
    const rest = raw.slice(index)
    const match = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(rest)
    if (!match) deny()
    index += match[0].length
  }
  value(0)
  whitespace()
  if (index !== raw.length) deny()
}

function parseUtf8Json(bytes) {
  try {
    const raw = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    assertUnambiguousM3StudyJson(raw)
    return JSON.parse(raw)
  } catch {
    deny()
  }
}

function requireCanonicalWeek(study) {
  const fixture = buildObservationSheet()
  const expected = fixture.requirements
  if (!Array.isArray(expected) || expected.length !== 11 ||
      study.baseline.basket.selectedMealCount !== fixture.selectedMealCount ||
      study.candidate.basket.selectedMealCount !== fixture.selectedMealCount) deny()
  for (const side of ['baseline', 'candidate']) {
    const lines = study[side].basket.lines
    if (!Array.isArray(lines) || lines.length !== expected.length) deny()
    for (let i = 0; i < expected.length; i += 1) {
      const row = lines[i]
      const canonical = expected[i]
      if (row.id !== canonical.id || row.ingredientLabel !== canonical.label ||
          row.requirement.amount !== canonical.amount ||
          row.requirement.unit !== canonical.unit) deny()
    }
  }
  return expected.length
}

function canonicalCalendarDay(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) deny()
  const instant = Date.parse(value + 'T00:00:00Z')
  if (!Number.isFinite(instant) ||
      new Date(instant).toISOString().slice(0, 10) !== value) deny()
  return Math.floor(instant / 86400000)
}

function assertCanonicalCaptureWindow(study, report) {
  const windowHours = report.observationWindowHours
  if (typeof windowHours !== 'number' || !Number.isFinite(windowHours) ||
      windowHours > 24 || windowHours < 0) deny()
  const weekStart = canonicalCalendarDay(study.weekStart)
  const referenceNow = Date.now()
  for (const side of ['baseline', 'candidate']) {
    const observedAt = study[side].observedAt
    if (typeof observedAt !== 'string') deny()
    const instant = Date.parse(observedAt)
    if (!Number.isFinite(instant) || instant > referenceNow) deny()
    // The calendar day as observed locally, not a rolling UTC window;
    // canonical M3 allows shopping on the 2 days before or 7 week days.
    const localDay = canonicalCalendarDay(observedAt.slice(0, 10))
    if (localDay < weekStart - 2 || localDay >= weekStart + 7) deny()
  }
}

export function preflightPrivateM3Week(studyBytes, manifestBytes, expectedMainSha = null) {
  if (!Buffer.isBuffer(studyBytes) || !Buffer.isBuffer(manifestBytes) ||
      studyBytes.length === 0 || studyBytes.length > STUDY_MAX_BYTES ||
      manifestBytes.length === 0 || manifestBytes.length > MANIFEST_MAX_BYTES) deny()
  let manifest
  try {
    manifest = parseStrictPrivateM3Manifest(
      new TextDecoder('utf-8', { fatal: true }).decode(manifestBytes),
    )
  } catch {
    deny()
  }
  // An operator may supply an independently checked current-main revision.
  // This detects a mistaken/stale sidecar SHA; it is NOT GitHub authentication
  // and cannot turn the private or public permission flags into true.
  if (expectedMainSha !== null &&
      (typeof expectedMainSha !== 'string' ||
       !/^[0-9a-f]{40}$/.test(expectedMainSha) ||
       /^0{40}$/.test(expectedMainSha) ||
       manifest.sourceCommitSha !== expectedMainSha)) deny()
  if (!verifyPrivateM3StudyCodePin(studyBytes, manifest)) deny()
  const study = parseUtf8Json(studyBytes)
  let requiredLineCount
  let report
  try {
    validateObservedWeekInput(study)
    requiredLineCount = requireCanonicalWeek(study)
    report = buildObservedWeekReport(study)
    assertCanonicalCaptureWindow(study, report)
  } catch {
    deny()
  }
  // Report contains private participants, prices and detailed observations.
  // Never return, log or serialize that report or the source study. Expose
  // only the non-identifying acceptance shape. Do not infer actual permission
  // or GitHub authenticity from the operator-supplied 40-hex source SHA.
  return Object.freeze({
    status: 'private-review-only',
    privateStudyBytesMatch: true,
    canonicalDemandLineCount: requiredLineCount,
    sameDemandLineCount: requiredLineCount,
    observationWindowWithin24Hours: true,
    sourceCommitSha: manifest.sourceCommitSha,
    sourceCommitShaAuthenticated: false,
    codeRevisionVerified: false,
    retailerPermissionVerified: false,
    publicSavingsClaimEligible: false,
  })
}

export async function main(argv = process.argv.slice(2)) {
  const expectRevision = argv.length === 4 && argv[2] === '--expect-main-sha'
  if (argv.length !== 2 && !expectRevision) deny()
  const study = await boundedRegularFile(argv[0], STUDY_MAX_BYTES)
  const manifest = await boundedRegularFile(argv[1], MANIFEST_MAX_BYTES)
  const result = preflightPrivateM3Week(study, manifest, expectRevision ? argv[3] : null)
  process.stdout.write(JSON.stringify(result, null, 2) + '\n')
  return result
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    console.error(REASONS.invalid)
    process.exitCode = 1
  })
}
