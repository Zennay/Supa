import { statPillAccessibleLabel } from './statPillPresentation'

type Props = {
  label: string
  value: string
}

export function StatPill({ label, value }: Props) {
  return (
    <div
      className="stat-pill"
      role="group"
      aria-label={statPillAccessibleLabel(label, value)}
      data-stat-label={label}
    >
      <span aria-hidden="true">{label}</span>
      <strong aria-hidden="true">{value}</strong>
    </div>
  )
}
