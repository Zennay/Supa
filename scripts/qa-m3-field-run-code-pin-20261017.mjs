// Independent, offline QA gate for release issue #205. This is an OPTIONAL
// proof admission function, not a replacement for the product converter.
// It cannot manufacture a commit pin for a legacy field sheet. Only an
// explicitly independently supplied checked-out current-main SHA is accepted.
const REFUSE = 'M3 private field-run code pin refused'
const SHA40 = /^[0-9a-f]{40}$/
const refuse = () => { throw new Error(REFUSE) }

function ownData(record, key) {
  if (record === null || typeof record !== 'object' || Array.isArray(record)) refuse()
  // Never invoke a getter to obtain allegedly trusted revision provenance.
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

    // A matching commit alone never authenticates an unrelated study.
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

    // Return no commit, prices, participant key, raw source or filename.
    // A passing pin is NOT evidence of retailer source rights or real field visits.
    return Object.freeze({
      codePinMatched: true,
      sourceSheetStudyAssessmentBound: true,
      privateOnly: true,
      verifiedRetailerObservations: false,
      publicSavingsClaimEligible: false,
      m3ExitProven: false,
    })
  } catch {
    refuse() // Exact generic message; never expose private attacker input.
  }
}
