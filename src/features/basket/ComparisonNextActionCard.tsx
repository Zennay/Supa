import type { ComparisonNextStep } from './comparisonNextStep'
import './ComparisonNextActionCard.css'

/**
 * Read-only explanation. No pretend button: callers own the actual planner or
 * retailer navigation and must not convert this advice into an automatic edit.
 */
export function ComparisonNextActionCard({
  guidance,
}: {
  guidance: ComparisonNextStep
}) {
  return (
    <section
      className="comparison-next-action"
      data-comparison-next-step={guidance.code}
      data-can-show-difference={guidance.canShowDifference ? 'true' : 'false'}
      role="status"
      aria-live="polite"
    >
      <strong className="comparison-next-action__title">{guidance.title}</strong>
      <p className="comparison-next-action__explanation">
        {guidance.explanation}
      </p>
      <p className="comparison-next-action__instruction">
        <span className="comparison-next-action__label">Volgende stap: </span>
        {guidance.action}
      </p>
    </section>
  )
}
