import { createElement, type ComponentType } from 'react'
import { prepareUnpricedPrivateRecipe, type UnpricedPrivateRecipe } from './reviewedRecipeBasketBridge.ts'
import type { EditorRecipeDraft } from './userRecipeDraftEditor.ts'
import { PrivateRecipeWeekPlanner } from './PrivateRecipeWeekPlanner.ts'
import type { PrivateWeekSelection } from './privateWeekPlanner.ts'

/**
 * Standalone opt-in composition of existing review form + private week planner.
 * Parent owns state, persistence, ID issuance and user authorization; this
 * component cannot silently save/publish a draft or fetch any URL.
 * Intentionally NOT mounted in App.tsx while another worker owns that route.
 */
export function PrivateRecipeStudio({
  draft,
  draftLocalId,
  recipes,
  selectedDays,
  onDraftChange,
  onAddReviewedRecipe,
  onSelectedDaysChange,
  onCancelDraft,
  EditorComponent,
}: {
  draft: EditorRecipeDraft
  /** Inject existing UserRecipeDraftEditor from the authenticated host. */
  EditorComponent: ComponentType<{ draft: EditorRecipeDraft; onChange: (draft: EditorRecipeDraft) => void; onConfirm: (draft: EditorRecipeDraft) => void; onCancel: () => void }>
  draftLocalId: string
  recipes: readonly UnpricedPrivateRecipe[]
  selectedDays: PrivateWeekSelection
  onDraftChange: (draft: EditorRecipeDraft) => void
  onAddReviewedRecipe: (recipe: UnpricedPrivateRecipe) => void
  onSelectedDaysChange: (next: Record<string, string | null>) => void
  onCancelDraft: () => void
}) {
  const ids = Array.isArray(recipes) ? recipes.map((recipe: UnpricedPrivateRecipe) => recipe.id) : []
  const current = prepareUnpricedPrivateRecipe(draft, draftLocalId, ids)

  function confirm(reviewed: EditorRecipeDraft) {
    // Re-evaluate the event-time draft, not an earlier optimistic UI preview.
    // Refuse any importer/unknown amount/pending warning/ID conflict.
    const decision = prepareUnpricedPrivateRecipe(reviewed, draftLocalId, ids)
    if (decision.status === 'unpriced_ready') onAddReviewedRecipe(decision.recipe)
  }

  return createElement('section', {
    'aria-label': 'Mijn recepten maken en plannen',
  }, [
    createElement('h2', { key:'title' }, 'Mijn recepten'),
    createElement('p', { key:'privacy' },
      'Maak een eigen recept en plan je week. Dit is een lokale voorvertoning: er wordt niets online opgeslagen of gepubliceerd.'),
    createElement(EditorComponent, {
      key:'editor', draft, onChange:onDraftChange, onConfirm:confirm, onCancel:onCancelDraft,
    }),
    current.status === 'review_required'
      ? createElement('p', { key:'warning', role:'status' },
          'Dit recept is nog niet klaar voor de weekplanner. Controleer herkomst, bereidingstijd, hoeveelheden en waarschuwingen.')
      : createElement('p', { key:'ready', role:'note' },
          'Dit recept kan aan je lokale lijst worden toegevoegd; prijs en winkel blijven onbekend.'),
    createElement(PrivateRecipeWeekPlanner, {
      key:'planner',
      recipes,
      selection:selectedDays,
      onSelectionChange:onSelectedDaysChange,
    }),
  ])
}
