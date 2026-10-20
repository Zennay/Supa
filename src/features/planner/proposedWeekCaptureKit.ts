import { makeBlankPlannerCaptureCsv, type CaptureStore } from '../comparison/plannerPriceCaptureSheet.ts'
import { makePlannerCaptureGuide } from '../comparison/plannerPriceCaptureGuide.ts'
import { nextWeekPhysicalItems } from './recipeNextWeekList.ts'
import type { RecipeShoppingChange } from './recipeShoppingChange.ts'

export type ProposedCaptureKit = Readonly<{
  stores: readonly CaptureStore[]
  csvFilename: string
  guideFilename: string
  csv: string
  guide: string
}>

/** An empty, retailer-specific, physically ordered observation pack for a
 * PROPOSED Planner week. This is not a price source until the real retailer
 * facts are independently entered and reviewed through existing import.
 */
export function proposedWeekCaptureKit(
  preview: RecipeShoppingChange,
  stores: readonly CaptureStore[],
): ProposedCaptureKit {
  if (preview.status !== 'ready') throw new Error('Kies eerst een geldig receptvoorstel.')
  // Reject unknown/partial pieces and stale/nonphysical recipe demand BEFORE
  // issuing a worksheet that someone could mistake for a priced comparison.
  const physical = nextWeekPhysicalItems(preview)
  if (!physical.length) throw new Error('Het voorgestelde weekmenu heeft geen fysieke artikelen.')
  const storePart = stores.join('-').toLowerCase()
  const basename = 'supa-voorstel-' + storePart
  return {
    stores: [...stores],
    csvFilename: basename + '-leeg-broninvulblad.csv',
    guideFilename: basename + '-fysieke-opnamegids.txt',
    csv: makeBlankPlannerCaptureCsv(preview.nextNeeds, stores, ';'),
    guide: makePlannerCaptureGuide(preview.nextNeeds, stores),
  }
}
