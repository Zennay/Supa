import type { StoreProduct } from '../domain/basket.ts'
import type { RawProductObservation } from './ingestion.ts'
import {
  projectTrustedObservationCatalogForBasket,
  type ControlledSourceStore,
} from './trustedMultipackStoreProduct.ts'

/**
 * Optional M3 preparation gate for TWO explicitly selected source-bound catalogs.
 * A valid projection is not a complete ingredient basket, permission to reuse
 * retailer data, or genuine human-observed field evidence.
 *
 * A caller MUST supply its own reference clock; this function never guesses
 * when a product was observed or silently uses Date.now().
 */
export type ControlledComparisonCatalogs = {
  baseline: StoreProduct[]
  candidate: StoreProduct[]
  captureWindowHours: number
}

/** Require a real, timezone-explicit ISO timestamp, not local-time Date.parse. */
function timestampMillis(value: unknown): number | null {
  if (typeof value !== 'string') return null
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|([+-])(\d{2}):(\d{2}))$/.exec(value)
  if (!match) return null

  const [, yearText, monthText, dayText, hourText, minuteText, secondText, , , offsetHourText, offsetMinuteText] = match
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  const hour = Number(hourText)
  const minute = Number(minuteText)
  const second = Number(secondText)
  const offsetHour = offsetHourText === undefined ? 0 : Number(offsetHourText)
  const offsetMinute = offsetMinuteText === undefined ? 0 : Number(offsetMinuteText)
  if (
    year < 1 || month < 1 || month > 12 ||
    day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate() ||
    hour > 23 || minute > 59 || second > 59 ||
    offsetHour > 14 || offsetMinute > 59 ||
    (offsetHour === 14 && offsetMinute !== 0)
  ) return null

  const millis = Date.parse(value)
  return Number.isFinite(millis) ? millis : null
}

/**
 * All-or-nothing, 24-hour-fresh two-store catalog projection.
 *
 * Every product must already pass the independently strict source/provenance,
 * pack-count, identity, availability, non-promotion and cent-price validators.
 * A full catalog is rejected if ANY row is future-dated, stale, date-ambiguous,
 * out of the 24-hour cross-store window, or belongs to a wrong retailer.
 */
export function projectFreshControlledComparisonCatalogs({
  baselineObservations,
  candidateObservations,
  baselineStore,
  candidateStore,
  referenceTime,
}: {
  baselineObservations: unknown
  candidateObservations: unknown
  baselineStore: ControlledSourceStore
  candidateStore: ControlledSourceStore
  referenceTime: string
}): ControlledComparisonCatalogs | null {
  try {
    const referenceMillis = timestampMillis(referenceTime)
    if (referenceMillis === null) return null
    if (
      !baselineStore || !candidateStore ||
      baselineStore.id === candidateStore.id ||
      baselineStore.supermarket === candidateStore.supermarket
    ) return null

    const baseline = projectTrustedObservationCatalogForBasket(
      baselineObservations,
      baselineStore,
    )
    const candidate = projectTrustedObservationCatalogForBasket(
      candidateObservations,
      candidateStore,
    )
    if (baseline === null || candidate === null) return null

    let earliest = referenceMillis
    let latest = Number.NEGATIVE_INFINITY
    const ONE_DAY_MS = 24 * 60 * 60 * 1000
    for (const observations of [baselineObservations, candidateObservations]) {
      for (const row of observations as RawProductObservation[]) {
        const capturedMillis = timestampMillis(row.provenance.capturedAt)
        if (
          capturedMillis === null ||
          capturedMillis > referenceMillis ||
          referenceMillis - capturedMillis > ONE_DAY_MS
        ) return null
        earliest = Math.min(earliest, capturedMillis)
        latest = Math.max(latest, capturedMillis)
      }
    }
    if (latest - earliest > ONE_DAY_MS) return null

    return { baseline, candidate, captureWindowHours: (latest - earliest) / 3600000 }
  } catch {
    // Treat unexpected runtime/hostile JSON-like shapes as untrusted data.
    return null
  }
}
