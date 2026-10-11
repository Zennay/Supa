/**
 * Exact precision for the M3 field-observation clock. Only caller-observed
 * timestamps are accepted; this module does not synthesize observations.
 *
 * JS Date.parse discards the 4th–9th fractional-second digits. Convert a
 * validated whole-second instant to epoch nanoseconds and add the untouched
 * fractional digits before comparing two observations.
 */
const TIMESTAMP =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|([+-])(\d{2}):(\d{2}))$/

const NANOS_PER_HOUR = 3_600_000_000_000n
const NANOS_PER_MILLISECOND = 1_000_000n

export function parseM3TimestampNanos(value: unknown): bigint | null {
  if (typeof value !== 'string') return null
  const match = TIMESTAMP.exec(value)
  if (!match) return null

  const [, yearText, monthText, dayText, hourText, minuteText, secondText, fraction = '', offset, , offsetHour = '0', offsetMinute = '0'] = match
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  const hour = Number(hourText)
  const minute = Number(minuteText)
  const second = Number(secondText ?? '0')

  // Date.UTC remaps 00–99 to 1900–1999; reject rather than invent an instant.
  if (year < 100 || month < 1 || month > 12 || day < 1 ||
      hour > 23 || minute > 59 || second > 59 ||
      Number(offsetHour) > 23 || Number(offsetMinute) > 59) {
    return null
  }

  const calendar = new Date(Date.UTC(year, month - 1, day))
  if (
    calendar.getUTCFullYear() !== year ||
    calendar.getUTCMonth() !== month - 1 ||
    calendar.getUTCDate() !== day
  ) {
    return null
  }

  // Date.parse sees whole seconds only; never let it round off nanoseconds.
  const wholeSecond = `${yearText}-${monthText}-${dayText}T${hourText}:${minuteText}:${secondText ?? '00'}${offset}`
  const epochMilliseconds = Date.parse(wholeSecond)
  if (!Number.isSafeInteger(epochMilliseconds)) return null

  return (
    BigInt(epochMilliseconds) * NANOS_PER_MILLISECOND +
    BigInt(fraction.padEnd(9, '0') || '0')
  )
}

function positiveHoursRatio(hours: unknown): { numerator: bigint; denominator: bigint } | null {
  if (typeof hours !== 'number' || !Number.isFinite(hours) || hours <= 0) {
    return null
  }

  const [coefficient, exponentText = '0'] = hours.toString().toLowerCase().split('e')
  const [integer, decimal = ''] = coefficient.split('.')
  const exponent = Number(exponentText)
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 400) return null

  let numerator = BigInt(integer + decimal)
  let denominator = 10n ** BigInt(decimal.length)

  if (exponent > 0) numerator *= 10n ** BigInt(exponent)
  if (exponent < 0) denominator *= 10n ** BigInt(-exponent)
  return { numerator, denominator }
}

export type M3ObservationInterval = {
  elapsedNanos: bigint
  hoursApprox: number
  withinWindow: boolean
}

/**
 * Interpret finite positive hour limits as their decimal JS string, then
 * compare both sides as integers. The floating hours approximation is for UI
 * and diagnostics only: it must never decide whether money is claimable.
 */
export function evaluateM3ObservationInterval(
  baselineAt: unknown,
  candidateAt: unknown,
  maxWindowHours: unknown = 24,
): M3ObservationInterval | null {
  const baseline = parseM3TimestampNanos(baselineAt)
  const candidate = parseM3TimestampNanos(candidateAt)
  const bound = positiveHoursRatio(maxWindowHours)
  if (baseline === null || candidate === null || bound === null) return null

  const delta = candidate >= baseline ? candidate - baseline : baseline - candidate
  return {
    elapsedNanos: delta,
    hoursApprox: Number(delta) / Number(NANOS_PER_HOUR),
    withinWindow:
      delta * bound.denominator <= bound.numerator * NANOS_PER_HOUR,
  }
}

/** Formats a validated timestamp's original nanoseconds without truncation. */
export function m3TimestampWithElapsedHours(
  firstObservedAt: unknown,
  hours: unknown,
): string | null {
  const start = parseM3TimestampNanos(firstObservedAt)
  const ratio = positiveHoursRatio(hours)
  if (start === null || ratio === null) return null
  const increment = ratio.numerator * NANOS_PER_HOUR
  if (increment % ratio.denominator !== 0n) return null

  const end = start + increment / ratio.denominator
  const seconds = end / 1_000_000_000n
  const subsecond = end % 1_000_000_000n
  // Date deals only with the whole-second calendar rendering; the fraction
  // is attached verbatim, and no precision information is dropped.
  const date = new Date(Number(seconds * 1000n))
  if (!Number.isFinite(date.getTime())) return null

  return (
    date.toISOString().replace(/\.000Z$/, '') +
    '.' + subsecond.toString().padStart(9, '0') + 'Z'
  )
}
