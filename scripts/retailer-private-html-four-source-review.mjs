/**
 * Four-source PRIVATE HTML audit for already-reviewed archived retailer pages.
 *
 * This is NOT a six-source completeness gate, live scraper, rights grant,
 * price search/index, or publishing path. Two PLUS rendered DOM listing shapes
 * still require separately reviewed browser capture/field proof.
 */
import { types as nodeTypes } from 'node:util'
import { bindPrivateReviewedHtmlEvidence } from './retailer-offline-html-evidence-binding.mjs'
import { evaluatePrivateAdapterHealth } from './retailer-private-adapter-health.mjs'

const REQUIRED = Object.freeze([
  'plus:product', 'dekamarkt:product',
  'dekamarkt:catalog', 'dekamarkt:offers',
])
const fail = () => { throw new Error('Private HTML batch review refused') }
const own = (obj, name) => Object.getOwnPropertyDescriptor(obj, name)
function valuesOnly(value, names) {
  if (!value || typeof value !== 'object' || nodeTypes.isProxy(value) ||
      Object.getPrototypeOf(value) !== Object.prototype) fail()
  const descriptors = Object.getOwnPropertyDescriptors(value)
  if (Reflect.ownKeys(descriptors).length !== names.length ||
      !names.every(name => Object.hasOwn(descriptors, name) &&
        Object.hasOwn(descriptors[name], 'value'))) fail()
  return Object.fromEntries(names.map(name => [name, descriptors[name].value]))
}

function checkedEntries(entries) {
  if (nodeTypes.isProxy(entries) || !Array.isArray(entries) ||
      Object.getPrototypeOf(entries) !== Array.prototype ||
      entries.length < REQUIRED.length || entries.length > 32) fail()
  const descriptors = Object.getOwnPropertyDescriptors(entries)
  if (Reflect.ownKeys(descriptors).length !== entries.length + 1) fail()
  const checked = []
  for (let index = 0; index < entries.length; index++) {
    const descriptor = own(entries, index)
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) fail()
    checked.push(valuesOnly(descriptor.value, ['captured', 'reviewedEvidence']))
  }
  return checked
}

/**
 * Validate 4 supported historical source shapes with genuine HTML SHA
 * *structure* checks and return only counts plus human follow-up actions.
 * The caller must separately prove capture rights and real-world authenticity.
 */
export function reviewPrivateHtmlRetailerBatch(entries, options = {}) {
  try {
    const input = checkedEntries(entries)
    if (!options || typeof options !== 'object' || nodeTypes.isProxy(options) ||
        Object.getPrototypeOf(options) !== Object.prototype) fail()
    const opts = Object.getOwnPropertyDescriptors(options)
    if (Reflect.ownKeys(opts).some(key => !['referenceTime', 'maxAgeHours'].includes(key) ||
        !Object.hasOwn(opts[key], 'value'))) fail()
    const audit = Object.fromEntries(Object.entries(opts).map(([key, desc]) => [key, desc.value]))

    const observationsBySource = []
    const seenCaptureEvents = new Set()
    const sources = new Set()
    const retailerCounts = { plus: 0, dekamarkt: 0 }
    for (const entry of input) {
      const verified = bindPrivateReviewedHtmlEvidence(entry.captured, entry.reviewedEvidence)
      const key = verified.source.retailerId + ':' + verified.source.kind
      if (!REQUIRED.includes(key)) fail()
      const identity = JSON.stringify([key, verified.source.capturedAt, verified.source.sha256])
      if (seenCaptureEvents.has(identity)) fail()
      seenCaptureEvents.add(identity)
      sources.add(key)
      retailerCounts[verified.source.retailerId] += verified.normalizedObservationCount
      observationsBySource.push({
        key, accepted: true, reason: null,
        observations: verified.internalReviewedObservations,
      })
    }
    if (REQUIRED.some(key => !sources.has(key))) fail()
    const observations = observationsBySource.reduce((count, item) =>
      count + item.observations.length, 0)
    const batch = {
      summary: {
        mode: 'reviewed-offline-only',
        sources: observationsBySource.length,
        acceptedSources: observationsBySource.length,
        rejectedSources: 0,
        observations,
        retailerCounts,
        productionEnabled: false,
        permissionVerified: false,
        publicSavingsClaimEligible: false,
      },
      results: observationsBySource,
    }
    const health = evaluatePrivateAdapterHealth(batch, audit)
    if (health.sixShapeCoverageComplete !== false ||
        health.missingSourceKinds.length !== 2 ||
        !health.missingSourceKinds.includes('plus:catalog') ||
        !health.missingSourceKinds.includes('plus:offers') ||
        !health.operatorActions.includes('obtain-written-retailer-source-rights')) fail()
    return {
      schemaVersion: 1,
      mode: 'private-offline-four-source-html-review',
      verifiedHtmlSources: observationsBySource.length,
      supportedSourceKinds: REQUIRED.length,
      normalizedObservationCount: observations,
      retailerObservationCounts: retailerCounts,
      historicalStaleSources: health.staleSources,
      historicalConflictingProducts: health.inconsistentProducts,
      missingSourceKinds: health.missingSourceKinds,
      operatorActions: health.operatorActions,
      reviewRequired: true,
      sixSourceCoverageComplete: false,
      rightsVerifiedForReuse: false,
      livePricesAvailable: false,
      publicSavingsClaimEligible: false,
      productionEnabled: false,
      externalRequests: 0,
    }
  } catch {
    // Source HTML, personal data and numeric prices must never escape in an
    // exception message or aggregate report on malformed private inputs.
    fail()
  }
}
