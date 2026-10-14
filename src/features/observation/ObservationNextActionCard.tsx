import './ObservationNextActionCard.css'
import type { ObservationNextAction } from './observationNextStep.ts'

/**
 * Passive, accessible presentation of the next M3 collection task.
 * The canonical form owns navigation, downloads and readiness decisions.
 * This component deliberately exposes no dead buttons or inferred evidence.
 */
export function ObservationNextActionCard({
  action,
}: {
  action: ObservationNextAction
}) {
  return (
    <div
      className="observation-next-action"
      role="status"
      aria-label="Volgende stap"
      aria-live="polite"
      aria-atomic="true"
    >
      <strong>{action.title}</strong>
      <p>{action.detail}</p>
    </div>
  )
}
