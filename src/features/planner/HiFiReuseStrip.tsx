import type { IngredientReuseInsight } from '../../domain/ingredientReuse.ts'

/**
 * Compact overlap strip from Figma Planner 3359:4896 (between the week card
 * and the meal rows). The design's "Bespaart €…" amount is not proven, so
 * the strip only names which active days share ingredients.
 */
export function HiFiReuseStrip({ insight }: { insight: IngredientReuseInsight | null }) {
  const reused = insight?.reusedIngredients ?? []
  if (reused.length === 0) return null
  const first = reused[0]
  const shown = reused.slice(0, 2)
  const more = reused.length - shown.length
  return (
    <p className="hifi-reuse-strip" data-figma-node="3359:4896">
      <span className="hifi-reuse-marks" aria-hidden="true">
        {shown.map(item => <span key={item.ingredientId}>{item.label.slice(0, 1)}</span>)}
        {more > 0 && <span>+{more}</span>}
      </span>
      <span className="hifi-reuse-rings" aria-hidden="true" />
      <span className="hifi-reuse-copy">
        {reused.length === 1
          ? <>{first.label} in combinatie: </>
          : <>{reused.length} ingrediënten in combinatie: </>}
        <strong>{first.days.join(', ')}</strong>
      </span>
    </p>
  )
}
