export type StatPillPresentation = {
  label: string
  value: string
  accessibleLabel: string
}

function normalizedText(value: string, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

export function statPillPresentation(
  label: string,
  value: string,
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
  label: string,
  value: string,
): string {
  return statPillPresentation(label, value).accessibleLabel
}
