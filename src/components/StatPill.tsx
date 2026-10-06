type Props = {
  label: string
  value: string
}

export function StatPill({ label, value }: Props) {
  const accessibleLabel = `${label}: ${value}`

  return (
    <div
      className="stat-pill"
      role="group"
      aria-label={accessibleLabel}
      data-stat-label={label}
    >
      <span aria-hidden="true">{label}</span>
      <strong aria-hidden="true">{value}</strong>
    </div>
  )
}
