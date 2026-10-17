// Independent, offline QA gate for release issue #205. This is an OPTIONAL
// admission check, not a product schema migration or legal retailer proof.
// An independent checked-out current-main Git SHA must already be supplied.
import { isDeepStrictEqual, types as nodeTypes } from 'node:util'
import { buildWeeklyBasketStudyFromObservationSheet } from './m3-build-observed-study.mjs'
import { buildObservedWeekReport } from './m3-assess-observed-week.mjs'

const REFUSE = 'M3 private field-run code pin refused'
const SHA40 = /^[0-9a-f]{40}$/
const refuse = () => { throw new Error(REFUSE) }

function ownData(record, key) {
  if (record === null || typeof record !== 'object' ||
      nodeTypes.isProxy(record) || Array.isArray(record)) refuse()
  // Refuse inherited facts and own getters before reading a revision value.
  const proto = Object.getPrototypeOf(record)
  if (proto !== Object.prototype && proto !== null) refuse()
  const descriptor = Object.getOwnPropertyDescriptor(record, key)
  if (!descriptor || !Object.hasOwn(descriptor, 'value')) refuse()
  return descriptor.value
}

function canonicalSha(value) {
  if (typeof value !== 'string' || !SHA40.test(value)) refuse()
  return value
}

function sameData(left, right, key) {
  const a = ownData(left, key)
  const b = ownData(right, key)
  if (typeof a !== 'string' || a !== b) refuse()
}

// Deep, bounded own-data-only copies. Never JSON.stringify untrusted nested
// objects or run accessor-backed financial getters as a side effect of
// checking a supposed financial/identity witness. No getter, symbol, function,
// exotic prototype, cycle, or unbounded graph may enter the canonical builders.
function safeSnapshot(value, state, depth = 0) {
  if (++state.count > 20000 || depth > 40) refuse()
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value
  }
  if (typeof value === 'number' && Number.isFinite(value)) return value
  // Proxy meta-traps (getPrototypeOf/ownKeys/getOwnPropertyDescriptor) are
  // executable code too: detect the Proxy before any such operation.
  if (typeof value !== 'object' || nodeTypes.isProxy(value) ||
      state.seen.has(value)) refuse()

  const isArray = Array.isArray(value)
  const proto = Object.getPrototypeOf(value)
  if (proto !== (isArray ? Array.prototype : Object.prototype) &&
      !(proto === null && !isArray)) refuse()
  state.seen.add(value)
  try {
    const output = isArray ? [] : {}
    const keys = Reflect.ownKeys(value)
    if (keys.some(key => typeof key !== 'string')) refuse()
    if (isArray) {
      const size = ownArrayLength(value)
      if (keys.length !== size + 1 || size > 20000) refuse()
      for (let i = 0; i < size; i++) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(i))
        if (!descriptor || !Object.hasOwn(descriptor, 'value') ||
            descriptor.enumerable !== true) refuse()
        output.push(safeSnapshot(descriptor.value, state, depth + 1))
      }
    } else {
      for (const key of keys) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key)
        if (!descriptor || !Object.hasOwn(descriptor, 'value') ||
            descriptor.enumerable !== true) refuse()
        Object.defineProperty(output, key, {
          value: safeSnapshot(descriptor.value, state, depth + 1),
          enumerable: true, configurable: true, writable: true,
        })
      }
    }
    return output
  } finally {
    state.seen.delete(value)
  }
}

function ownArrayLength(value) {
  const descriptor = Object.getOwnPropertyDescriptor(value, 'length')
  if (!descriptor || !Object.hasOwn(descriptor, 'value') ||
      !Number.isSafeInteger(descriptor.value) || descriptor.value < 0) refuse()
  return descriptor.value
}

function exactProjection(left, right) {
  // The owner may add the opt-in SHA to the product's canonical output.
  // Compare the entire original physical projection rather than asserting
  // a particular migration order of the source pin field.
  delete left.fieldRunCommitSha
  delete right.fieldRunCommitSha
  if (!isDeepStrictEqual(left, right)) refuse()
}

export function auditPrivateM3FieldRunCodePin(
  sheet, study, assessment, expectedMainSha,
) {
  try {
    const main = canonicalSha(expectedMainSha)
    if (ownData(sheet, 'schemaVersion') !== 1 ||
        ownData(sheet, 'sheetType') !== 'm3-manual-cart-observation-sheet' ||
        ownData(study, 'schemaVersion') !== 1 ||
        ownData(assessment, 'schemaVersion') !== 1 ||
        ownData(assessment, 'reportType') !== 'm3-observed-week-assessment') refuse()

    const sourceMeta = ownData(sheet, 'study')
    const fromSheet = canonicalSha(ownData(sourceMeta, 'fieldRunCommitSha'))
    const fromStudy = canonicalSha(ownData(study, 'fieldRunCommitSha'))
    const fromAssessment = canonicalSha(ownData(assessment, 'fieldRunCommitSha'))
    if (fromSheet !== main || fromStudy !== main || fromAssessment !== main) refuse()

    sameData(sourceMeta, study, 'studyId')
    sameData(study, assessment, 'studyId')
    sameData(sourceMeta, study, 'weekStart')
    sameData(study, assessment, 'weekStart')
    sameData(sourceMeta, study, 'priceContext')
    sameData(study, assessment, 'priceContext')
    if (ownData(sheet, 'plannerFixture') !== 'm2-default-week' ||
        ownData(sourceMeta, 'maxObservationWindowHours') !== 24 ||
        !['in-store', 'online-order'].includes(ownData(study, 'priceContext')) ||
        ownData(assessment, 'publicSavingsClaimEligible') !== false) refuse()

    // Verify real unmodified canonical sheet -> basket math, then canonical
    // study -> assessment. Cents and source identities cannot be swapped
    // under an otherwise matching repeated SHA/studyId.
    const physicalSheet = safeSnapshot(sheet, { count: 0, seen: new WeakSet() })
    const physicalStudy = safeSnapshot(study, { count: 0, seen: new WeakSet() })
    const physicalReport = safeSnapshot(assessment, { count: 0, seen: new WeakSet() })
    const rebuiltStudy = buildWeeklyBasketStudyFromObservationSheet(physicalSheet)
    exactProjection(physicalStudy, rebuiltStudy)
    const rebuiltReport = buildObservedWeekReport(physicalStudy)
    exactProjection(physicalReport, rebuiltReport)

    // Never return commit, price, participant, field URL, store or customer text.
    // This is NOT retailer verification, source authorization or M3 exit.
    return Object.freeze({
      codePinMatched: true,
      canonicalPhysicalProjectionBound: true,
      privateOnly: true,
      verifiedRetailerObservations: false,
      publicSavingsClaimEligible: false,
      m3ExitProven: false,
    })
  } catch {
    refuse() // Same generic no-leak reason on all malformed private inputs.
  }
}
