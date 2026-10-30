import type { IngredientReuseInsight } from '../../domain/ingredientReuse.ts'
import { FigmaImage } from '../../components/FigmaImage'
import { ingredientImage } from './ingredientImages'
import { plannerWeekDate } from './HiFiPlannerWeekCard'

function joinDays(days: string[]) {
  const labels = days.map(day => `${day} ${plannerWeekDate(day).getDate()}`)
  return labels.length < 2 ? labels.join('') : `${labels.slice(0, -1).join(', ')} en ${labels[labels.length - 1]}`
}

/**
 * Overlap strip from the Planner design: pictures of the ingredients shared by
 * planned days, plus a "+N" bubble. No invented savings amount is shown.
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
        {shown.map(item => <span key={item.ingredientId}><FigmaImage asset={ingredientImage(item.label)} alt="" /></span>)}
        {more > 0 && <span className="hifi-reuse-more">+{more}</span>}
      </span>
      <span className="hifi-reuse-rings" aria-hidden="true" />
      <span className="hifi-reuse-copy">
        {reused.length === 1
          ? <>{first.label} in combinatie: </>
          : <>{reused.length} ingrediënten in combinatie: </>}
        <strong>{joinDays(first.days)}</strong>
      </span>
    </p>
  )
}
