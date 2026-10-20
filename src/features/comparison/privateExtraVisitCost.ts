/**
 * Exact user-entered second-stop cost in eurocents (not observed retailer
 * pricing). Shared by Planner preview and the final mixed shopping route.
 * Blank/invalid input is UNKNOWN; it is never assumed to be zero.
 */
export function parsePrivateExtraVisitCostCents(raw: string): number | null {
  if (typeof raw !== 'string') return null
  const match = /^(\d{1,4})(?:[,.](\d{1,2}))?$/.exec(raw.trim())
  if (!match) return null
  const cents = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0') || '0')
  return Number.isSafeInteger(cents) && cents >= 0 && cents <= 100_000 ? cents : null
}

/** A navigation hint only; never a price observation or source approval. */
export type PrivateExtraVisitCostIntent = Readonly<{
  serial: number
  planKey: string
  observedAt: { PLUS: string; DekaMarkt: string }
  raw: string
}>
