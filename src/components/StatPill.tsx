import { statPillPresentation } from './statPillPresentation'

type Props = {
  label: string
  value: string
}

export function StatPill({ label, value }: Props) {
  const presentation = statPillPresentation(label, value)

  return (
    <div
      className="stat-pill"
      role="group"
      aria-label={presentation.accessibleLabel}
      data-stat-label={presentation.label}
    >
      <span aria-hidden="true">{presentation.label}</span>
      <strong aria-hidden="true">{presentation.value}</strong>
    </div>
  )
}
