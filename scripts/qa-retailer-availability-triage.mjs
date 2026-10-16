/**
 * SUPA independent QA 2/2 — offline-only stock/availability coverage.
 * Uses exactly the six reviewed historical PLUS/Deka adapter results. It is
 * not an in-stock, current-price, purchase, release or source-rights claim.
 * No network or source file write; stdout contains only aggregate counters.
 */
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { types as nodeTypes } from 'node:util'
import { evaluatePrivateAdapterHealth } from './retailer-private-adapter-health.mjs'
import { loadReviewedRepositoryFixtures } from './retailer-reviewed-ingest-engine.mjs'

const SHAPES = ['plus:product', 'plus:catalog', 'plus:offers',
  'dekamarkt:product', 'dekamarkt:catalog', 'dekamarkt:offers']
const STATES = ['available', 'unavailable', 'unknown']
const refuse = () => { throw new Error('Private retailer availability QA refused') }
const record = value => value !== null && typeof value === 'object' &&
  !Array.isArray(value) && !nodeTypes.isProxy(value)
const count = value => Number.isSafeInteger(value) && value >= 0

function checkedClock(value) {
  if (typeof value !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) refuse()
  const moment = Date.parse(value)
  if (!Number.isFinite(moment) || moment > Date.now() ||
      new Date(moment).toISOString() !== value) refuse()
  return value
}

/**
 * Result of canonical ingestReviewedBatch(), not arbitrary raw HTML.
 * All six source kinds must pass existing provenance/observation validation
 * before availability is aggregated; no missing/rejected source is zero-fill.
 */
export function reviewPrivateRetailerAvailability(batch, options = {}) {
  if (!record(options) || ![Object.prototype, null].includes(
      Object.getPrototypeOf(options))) refuse()
  const descriptors = Object.getOwnPropertyDescriptors(options)
  if (Reflect.ownKeys(descriptors).some(key => key !== 'referenceTime' ||
      !Object.hasOwn(descriptors[key], 'value'))) refuse()
  const referenceTime = checkedClock(Object.hasOwn(descriptors, 'referenceTime')
    ? descriptors.referenceTime.value : new Date().toISOString())
  let health
  try {
    health = evaluatePrivateAdapterHealth(batch, {
      referenceTime, maxAgeHours: 24,
    })
  } catch { refuse() }
  if (health.sixShapeCoverageComplete !== true ||
      health.acceptedSources !== 6 || health.rejectedSources !== 0 ||
      health.sources !== 6 || !record(health.byShape) ||
      health.permissionVerified !== false ||
      health.productionEnabled !== false ||
      health.publicSavingsClaimEligible !== false ||
      health.externalRequests !== 0) refuse()

  const perShape = []
  const totals = { available: 0, unavailable: 0, unknown: 0 }
  const seen = new Set()
  for (const source of batch.results) {
    if (!record(source) || !SHAPES.includes(source.key) ||
        seen.has(source.key) || !Array.isArray(source.observations) ||
        source.accepted !== true || source.reason !== null) refuse()
    seen.add(source.key)
    const states = { available: 0, unavailable: 0, unknown: 0 }
    for (const observation of source.observations) {
      if (!record(observation) || !STATES.includes(observation.availability)) refuse()
      states[observation.availability]++
      totals[observation.availability]++
    }
    const shape = health.byShape[source.key]
    if (!record(shape) || shape.accepted !== 1 || shape.rejected !== 0 ||
        shape.sources !== 1 || !count(shape.observations) ||
        shape.observations !== Object.values(states).reduce((a, b) => a + b, 0) ||
        shape.unknownAvailability !== states.unknown) refuse()
    const [retailer, kind] = source.key.split(':')
    perShape.push({ retailer, kind, historicalObservations: shape.observations,
      available: states.available, unavailable: states.unavailable,
      unknown: states.unknown, currentStockVerified: false })
  }
  if (seen.size !== 6 || !count(health.observations) ||
      health.observations !== Object.values(totals).reduce((a, b) => a + b, 0) ||
      perShape.length !== 6) refuse()
  perShape.sort((a, b) => SHAPES.indexOf(a.retailer + ':' + a.kind) -
    SHAPES.indexOf(b.retailer + ':' + b.kind))

  return {
    schemaVersion: 1,
    mode: 'private-reviewed-retailer-availability-qa',
    dataScope: 'six-historical-m1-capture-shapes',
    referenceTime,
    acceptedHistoricalSourceShapes: 6,
    historicalObservations: health.observations,
    availability: totals,
    perShape,
    needsHumanAvailabilityReview: totals.unknown + totals.unavailable > 0,
    unavailableProductsNotPurchasable: true,
    currentStockVerified: false,
    historicalOnly: true,
    permissionVerified: false,
    liveRequests: 0,
    productionEnabled: false,
    publicSavingsClaimEligible: false,
    releaseDecision: 'hold',
  }
}

export async function main(argv = process.argv.slice(2),
  write = text => process.stdout.write(text)) {
  if (!Array.isArray(argv) || nodeTypes.isProxy(argv) ||
      Object.getPrototypeOf(argv) !== Array.prototype ||
      !((argv.length === 0 && Reflect.ownKeys(argv).length === 1) ||
        (argv.length === 2 && Reflect.ownKeys(argv).length === 3 &&
          Object.hasOwn(argv, 0) && Object.hasOwn(argv, 1) &&
          Object.getOwnPropertyDescriptor(argv, '0')?.value === '--at' &&
          typeof Object.getOwnPropertyDescriptor(argv, '1')?.value === 'string'))) {
    refuse()
  }
  const referenceTime = argv.length === 0 ? new Date().toISOString() :
    Object.getOwnPropertyDescriptor(argv, '1').value
  const batch = await loadReviewedRepositoryFixtures()
  const report = reviewPrivateRetailerAvailability(batch, { referenceTime })
  write(JSON.stringify(report) + '\n')
  return report
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => {
    console.error('Private retailer availability QA refused')
    process.exitCode = 2
  })
}
