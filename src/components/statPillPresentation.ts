export type StatPillPresentation = {
  label: string
  value: string
  accessibleLabel: string
}

const INVISIBLE_FORMAT_CHARACTERS = /[\p{Cf}\u180E]/gu
// Marks modify a visible base character; isolated marks/variation selectors
// must never be treated as an accessible name or readable value.
const HAS_PERCEPTIBLE_BASE = /[\p{L}\p{N}\p{P}\p{S}]/u

function normalizedText(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback

  const visibleText = value.replace(INVISIBLE_FORMAT_CHARACTERS, '').trim()
  return HAS_PERCEPTIBLE_BASE.test(visibleText) ? visibleText : fallback
}

export function statPillPresentation(
  label: unknown,
  value: unknown,
): StatPillPresentation {
  const safeLabel = normalizedText(label, 'Statistiek')
  const safeValue = normalizedText(value, 'Niet beschikbaar')

  return {
    label: safeLabel,
    value: safeValue,
    accessibleLabel: `${safeLabel}: ${safeValue}`,
  }
}

export function statPillAccessibleLabel(
  label: unknown,
  value: unknown,
): string {
  return statPillPresentation(label, value).accessibleLabel
}
