export function statPillAccessibleLabel(
  label: string,
  value: string,
): string {
  const safeLabel =
    typeof label === 'string' && label.trim() ? label.trim() : 'Statistiek'
  const safeValue =
    typeof value === 'string' && value.trim() ? value.trim() : 'Niet beschikbaar'

  return `${safeLabel}: ${safeValue}`
}
