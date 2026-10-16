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
  // Read library identities as *own data only*. A host can temporarily
  // supply a stale/malformed collection; never allow that state to bypass
  // duplicate checks or trigger a recipe ID getter during render.
  const libraryIds: string[] = []
  let validLibrary = Array.isArray(recipes) && recipes.length <= 100
  if (validLibrary) {
    try {
      const known = new Set<string>()
      for (const recipe of recipes) {
        if (!recipe || typeof recipe !== 'object') { validLibrary = false; break }
        const descriptor = Object.getOwnPropertyDescriptor(recipe, 'id')
        const id = descriptor?.value
        if (!Object.prototype.hasOwnProperty.call(descriptor ?? {}, 'value') ||
            typeof id !== 'string' ||
            !/^private-recipe:[A-Za-z0-9_-]{1,64}$/.test(id) ||
            known.has(id)) { validLibrary = false; break }
        known.add(id)
        libraryIds.push(id)
      }
    } catch {
      validLibrary = false
    }
  }
  const ids = validLibrary ? libraryIds : []
  const current = validLibrary
    ? prepareUnpricedPrivateRecipe(draft, draftLocalId, ids)
    : { status: 'review_required' as const, reasons: ['invalid_private_recipe_library'] }
  // Parent updates are asynchronous: reserve this rendered ID synchronously,
  // before invoking the parent's callback, so double-clicks cannot enqueue
  // two creates from the same stale recipe-ID snapshot.
  let submitted = false

  function confirm(reviewed: EditorRecipeDraft) {
    // Re-evaluate the event-time draft, not an earlier optimistic UI preview.
    // Refuse any importer/unknown amount/pending warning/ID conflict.
    if (submitted || !validLibrary) return
    const decision = prepareUnpricedPrivateRecipe(reviewed, draftLocalId, ids)
    if (decision.status === 'unpriced_ready') {
      submitted = true
      onAddReviewedRecipe(decision.recipe)
    }
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
      recipes: validLibrary ? recipes : [],
      selection:selectedDays,
      onSelectionChange:onSelectedDaysChange,
    }),
  ])
}
