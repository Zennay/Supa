/**
 * Pure, offline chronology primitive for reviewed retailer-capture provenance.
 * This does NOT establish source rights, authenticity, recency, or publishability.
 * It deliberately accepts only primitive ISO civil timestamps; callers must
 * perform their own inert envelope and retailer-origin admission first.
 *
 * The permitted civil UTC offset range is asymmetric: UTC-12:00…UTC+14:00.
 * Unlike Date.parse, this parser keeps all nine fractional-second digits.
 */
const CAPTURE_ISO = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|([+-])(\d{2}):(\d{2}))$/
const NANOS_PER_MILLISECOND = 1_000_000n

/** Return the exact UTC instant in nanoseconds, or null for invalid civil input. */
export function physicalCaptureNanoseconds(timestamp) {
  if (typeof timestamp !== 'string') return null
  const match = CAPTURE_ISO.exec(timestamp)
  if (!match) return null

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const hour = Number(match[4])
  const minute = Number(match[5])
  const second = Number(match[6])
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31 ||
      hour > 23 || minute > 59 || second > 59) return null

  let offsetMinutes = 0
  if (match[8] !== 'Z') {
    const offsetHours = Number(match[10])
    const offsetRemainder = Number(match[11])
    const negative = match[9] === '-'
    const limit = negative ? 12 : 14
    if (offsetHours > limit || offsetRemainder > 59 ||
        (offsetHours === limit && offsetRemainder !== 0)) return null
    offsetMinutes = (negative ? -1 : 1) * (offsetHours * 60 + offsetRemainder)
  }

  // Date.UTC normalizes invalid dates and treats years 0–99 as 1900–1999.
  // setUTCFullYear handles the complete four-digit calendar, then the round-trip
  // guarantees that e.g. 2026-02-30 never becomes trusted March provenance.
  const date = new Date(0)
  date.setUTCFullYear(year, month - 1, day)
  date.setUTCHours(hour, minute, second, 0)
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 ||
      date.getUTCDate() !== day || date.getUTCHours() !== hour ||
      date.getUTCMinutes() !== minute || date.getUTCSeconds() !== second) return null

  const fraction = (match[7] ?? '').padEnd(9, '0')
  const fractionNs = fraction ? BigInt(fraction) : 0n
  return (BigInt(date.getTime()) - BigInt(offsetMinutes) * 60_000n) * NANOS_PER_MILLISECOND + fractionNs
}

/** Physical identity is independent of legal ISO offset spelling. */
export function samePhysicalCaptureInstant(left, right) {
  const a = physicalCaptureNanoseconds(left)
  const b = physicalCaptureNanoseconds(right)
  return a !== null && b !== null && a === b
}
