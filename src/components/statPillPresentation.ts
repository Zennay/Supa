export type StatPillPresentation = {
  label: string
  value: string
  accessibleLabel: string
}

const INVISIBLE_FORMAT_CHARACTERS = /[\u00AD\u061C\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFEFF]/g

function normalizedText(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback

  const visibleText = value.replace(INVISIBLE_FORMAT_CHARACTERS, '').trim()
  return visibleText || fallback
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
