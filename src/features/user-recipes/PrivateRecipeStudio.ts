import { createElement, type ComponentType } from 'react'
import { prepareUnpricedPrivateRecipe, type UnpricedPrivateRecipe } from './reviewedRecipeBasketBridge.ts'
import type { EditorRecipeDraft } from './userRecipeDraftEditor.ts'
import { PrivateRecipeWeekPlanner } from './PrivateRecipeWeekPlanner.ts'
import type { PrivateWeekSelection } from './privateWeekPlanner.ts'


/**
 * Detach the complete user-owned library entry before both the planner and
 * studio callback consult it. Checking ID alone is insufficient: title,
 * ingredients and nested item fields can also be accessor-backed values.
 * Browser objects cannot be inspected for Proxy identity reliably, so do not
 * claim this is a general sandbox for arbitrary JS Proxy code.
 */
function inertLocalRecipe(value: unknown, seen = new WeakSet<object>(),
  budget = { count: 0 }, depth = 0): unknown {
  if (++budget.count > 4096 || depth > 16) throw new Error('invalid private recipe data')
  if (value === null || value === undefined ||
      typeof value === 'string' || typeof value === 'boolean' ||
      (typeof value === 'number' && Number.isFinite(value))) return value
  if (typeof value !== 'object' || seen.has(value)) {
    throw new Error('invalid private recipe data')
  }
  seen.add(value)
  const array = Array.isArray(value)
  const proto = Object.getPrototypeOf(value)
  if (array ? proto !== Array.prototype :
      proto !== Object.prototype && proto !== null) {
    throw new Error('invalid private recipe data')
  }
  const descriptors = Object.getOwnPropertyDescriptors(value)
  if (Reflect.ownKeys(descriptors).some(key => typeof key !== 'string')) {
    throw new Error('invalid private recipe data')
  }
  if (array) {
    const count = descriptors.length?.value
    if (!Number.isSafeInteger(count) || count > 256 ||
        Reflect.ownKeys(descriptors).length !== count + 1) {
      throw new Error('invalid private recipe data')
    }
    const copy: unknown[] = []
    for (let index = 0; index < count; index++) {
      const item = descriptors[index]
      if (!item || !Object.prototype.hasOwnProperty.call(item, 'value')) {
        throw new Error('invalid private recipe data')
      }
      copy.push(inertLocalRecipe(item.value, seen, budget, depth + 1))
    }
    return copy
  }
  if (Object.keys(descriptors).length > 64) throw new Error('invalid private recipe data')
  const copy: Record<string, unknown> = {}
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (key === '__proto__' || key.length > 128 ||
        !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
      throw new Error('invalid private recipe data')
    }
    copy[key] = inertLocalRecipe(descriptor.value, seen, budget, depth + 1)
  }
  return copy
}

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
  const libraryCopy: UnpricedPrivateRecipe[] = []
  let validLibrary = false
  try {
    // A sparse array or an inherited/accessor array slot must not provide
    // the library identity either. Include Array.isArray inside the guard:
    // a revoked Proxy can throw before any iteration happens.
    if (Array.isArray(recipes) && Object.getPrototypeOf(recipes) === Array.prototype &&
        recipes.length <= 100) {
      validLibrary = true
      const known = new Set<string>()
      for (let index = 0; index < recipes.length; index++) {
        const slot = Object.getOwnPropertyDescriptor(recipes, index)
        if (!slot || !Object.prototype.hasOwnProperty.call(slot, 'value')) {
          validLibrary = false
          break
        }
        const recipe = inertLocalRecipe(slot.value) as UnpricedPrivateRecipe
        if (!recipe || typeof recipe !== 'object' ||
            typeof recipe.title !== 'string' || !recipe.title.trim() ||
            !Array.isArray(recipe.ingredients)) { validLibrary = false; break }
        const descriptor = Object.getOwnPropertyDescriptor(recipe, 'id')
        const id = descriptor?.value
        if (!Object.prototype.hasOwnProperty.call(descriptor ?? {}, 'value') ||
            typeof id !== 'string' ||
            !/^private-recipe:[A-Za-z0-9_-]{1,64}$/.test(id) ||
            known.has(id)) { validLibrary = false; break }
        known.add(id)
        libraryIds.push(id)
        libraryCopy.push(recipe)
      }
    }
  } catch {
    validLibrary = false
  }
  const ids = validLibrary ? libraryIds : []
  // Snapshot host-controlled week selection before sending it into the child
  // planner. Missing data and accessor values are review-only, never render
  // exceptions or secretly accepted day selections.
  const safeDays: Record<string, string | null> = {}
  let validSelection = false
  try {
    if (selectedDays && typeof selectedDays === 'object' && !Array.isArray(selectedDays) &&
        (Object.getPrototypeOf(selectedDays) === Object.prototype ||
         Object.getPrototypeOf(selectedDays) === null)) {
      const descriptors = Object.getOwnPropertyDescriptors(selectedDays)
      const weekDays = new Set(['Ma', 'Di', 'Wo', 'Do', 'Vr', 'Za', 'Zo'])
      validSelection = true
      for (const [day, descriptor] of Object.entries(descriptors)) {
        if (!weekDays.has(day) || !Object.prototype.hasOwnProperty.call(descriptor, 'value') ||
            !(descriptor.value == null || typeof descriptor.value === 'string')) {
          validSelection = false
          break
        }
        if (typeof descriptor.value === 'string' && descriptor.value !== '' &&
            !libraryIds.includes(descriptor.value)) {
          validSelection = false
          break
        }
        safeDays[day] = descriptor.value ?? null
      }
    }
  } catch {
    validSelection = false
  }
  const validHostState = validLibrary && validSelection
  const current = validHostState
    ? prepareUnpricedPrivateRecipe(draft, draftLocalId, ids)
    : { status: 'review_required' as const, reasons: ['invalid_private_recipe_host_state'] }
  // Parent updates are asynchronous: reserve this rendered ID synchronously,
  // before invoking the parent's callback, so double-clicks cannot enqueue
  // two creates from the same stale recipe-ID snapshot.
  let submitted = false

  function confirm(reviewed: EditorRecipeDraft) {
    // Re-evaluate the event-time draft, not an earlier optimistic UI preview.
    // Refuse any importer/unknown amount/pending warning/ID conflict.
    if (submitted || !validHostState) return
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
      recipes: validHostState ? libraryCopy : [],
      selection:safeDays,
      onSelectionChange:onSelectedDaysChange,
    }),
  ])
}
