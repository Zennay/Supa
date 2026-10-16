/**
 * Shared strict capture-clock validator for the six private historical
 * PLUS/Deka evidence shapes. Pure; NO live fetching or rights escalation.
 *
 * Civil UTC offset bounds are asymmetric: -12:00 through +14:00.
 * Strict Gregorian dates and nanosecond cutoff avoid permissive Date.parse
 * normalization and loss of sub-millisecond chronology.
 */
const CLOCK = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|([+-])(\d{2}):(\d{2}))$/
const DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const

function leap(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
}

export function isValidCivilCaptureAt(value: unknown, referenceTime: number = Date.now()): value is string {
  if (typeof value !== 'string' || !Number.isSafeInteger(referenceTime)) return false
  const match = CLOCK.exec(value)
  if (!match) return false
  const [, yy, mo, dd, hh, mi, ss, fraction, zone, sign, oh, om] = match
  const year = Number(yy), month = Number(mo), day = Number(dd)
  const hour = Number(hh), minute = Number(mi), second = Number(ss)
  if (year < 1 || month < 1 || month > 12 ||
      day < 1 || day > DAYS[month - 1] + (month === 2 && leap(year) ? 1 : 0) ||
      hour > 23 || minute > 59 || second > 59) return false
  if (zone !== 'Z') {
    const maxHour = sign === '-' ? 12 : 14
    const offsetHour = Number(oh), offsetMinute = Number(om)
    if (offsetMinute > 59 || offsetHour > maxHour ||
        (offsetHour === maxHour && offsetMinute !== 0)) return false
  }
  const ms = Date.parse(value)
  if (!Number.isFinite(ms)) return false
  const remainingNs = BigInt((fraction ?? '').padEnd(9, '0').slice(3) || '0')
  const captureNs = BigInt(ms) * 1_000_000n + remainingNs
  const cutoffNs = (BigInt(referenceTime) + 60_000n) * 1_000_000n
  return captureNs <= cutoffNs
}

/**
 * Stable physical instant (nanosecond resolution), regardless of equivalent
 * legal UTC-offset spelling. Caller must not count two differently named
 * records of the same physical capture as independent source evidence.
 *
 * Null is intentionally fail-closed for malformed/future civil time. This is
 * not proof that a claimed source hash/URL is authentic.
 */
export function civilCaptureInstantKey(value: unknown, referenceTime: number = Date.now()): string | null {
  if (!isValidCivilCaptureAt(value, referenceTime)) return null
  const match = CLOCK.exec(value)
  if (!match) return null
  const fractionalTail = (match[7] ?? '').padEnd(9, '0').slice(3)
  return (BigInt(Date.parse(value)) * 1_000_000n +
    BigInt(fractionalTail || '0')).toString()
}
