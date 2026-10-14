export function observationPackAmount(value: unknown): number | null {
  if (typeof value !== 'string') return null

  const normalized = value.trim()
  if (!normalized) return null

  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

export function observationPackCount(value: unknown): number {
  if (typeof value !== 'string') return 1

  const normalized = value.trim()
  if (!normalized) return 1

  const parsed = Number(normalized)
  if (!Number.isFinite(parsed)) return 1

  const truncated = Math.trunc(parsed)
  if (!Number.isSafeInteger(truncated)) return 1

  return Math.max(1, truncated)
}
