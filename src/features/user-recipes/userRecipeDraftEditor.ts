/** Editable, local-only model. Confirmation by the user is NOT durable saving. */
export type EditorUnit = 'g' | 'ml' | 'piece'
export type EditorIngredient = {
  /** UI-only stable React identity; never a database key or public recipe ID. */
  clientId: string
  original: string
  label: string
  query: string
  amount: number | null
  unit: EditorUnit | null
  reviewReason: string | null
}
export type EditorRecipeDraft = {
  source: 'manual' | 'url'
  sourceUrl: string | null
  title: string
  servings: number | null
  minutes: number | null
  steps: string[]
  ingredients: EditorIngredient[]
  warnings: string[]
  status: 'needs_review'
}

const MAX_TEXT = 180
const MAX_INGREDIENTS = 100
// The normalized importer accepts at most one million g, ml or pieces.
// The editor must never confirm a value its source parser would reject.
const MAX_CANONICAL_METRIC_AMOUNT = 1_000_000
let ingredientSequence = 0
function newClientIngredientId(): string {
  ingredientSequence += 1
  return 'local-ingredient-' + ingredientSequence
}

function validAmount(value: number | null): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= MAX_CANONICAL_METRIC_AMOUNT &&
    Math.abs(value * 1000 - Math.round(value * 1000)) <= 1e-7
}

export function emptyUserRecipeDraft(): EditorRecipeDraft {
  return {
    source: 'manual', sourceUrl: null, title: '', servings: 2,
    minutes: null, steps: [], warnings: [], status: 'needs_review',
    ingredients: [{ clientId: newClientIngredientId(), original: '', label: '', query: '', amount: null, unit: 'g', reviewReason: 'Vul een hoeveelheid in.' }],
  }
}

/** Assign stable UI keys without modifying imported parsed recipe drafts. */
export function prepareImportedRecipeForEditor(
  draft: Omit<EditorRecipeDraft, 'ingredients'> & { ingredients: Omit<EditorIngredient, 'clientId'>[] },
): EditorRecipeDraft {
  return { ...draft, ingredients: draft.ingredients.map((ingredient) => ({ ...ingredient, clientId: newClientIngredientId() })) }
}

export function parseMetricEditorAmount(value: string): number | null {
  if (!/^(?:\d{1,9})(?:[.,]\d{1,3})?$/.test(value.trim())) return null
  const amount = Number(value.trim().replace(',', '.'))
  return Number.isFinite(amount) && amount > 0 && amount <= MAX_CANONICAL_METRIC_AMOUNT ? amount : null
}

/**
 * Keep an in-progress Dutch decimal (e.g. "1,") visible only while it still
 * belongs to the same current model value. A parent-side portions update
 * invalidates stale raw text rather than hiding the changed amount.
 */
export function displayMetricEditorAmount(raw: string | undefined, amount: number | null): string {
  if (raw !== undefined && parseMetricEditorAmount(raw) === amount) return raw
  return amount === null ? '' : String(amount)
}

export function updateEditorIngredient(
  draft: EditorRecipeDraft,
  index: number,
  patch: Partial<Pick<EditorIngredient, 'label' | 'amount' | 'unit'>>,
): EditorRecipeDraft {
  if (!Number.isSafeInteger(index) || index < 0 || index >= draft.ingredients.length) return draft
  const ingredients = draft.ingredients.map((ingredient, row) => {
    if (row !== index) return ingredient
    const next = { ...ingredient, ...patch }
    next.label = next.label.trimStart().slice(0, MAX_TEXT)
    next.query = next.label.toLowerCase()
    next.reviewReason = !next.label.trim()
      ? 'Vul een ingrediëntnaam in.'
      : !validAmount(next.amount)
        ? 'Vul een geldige hoeveelheid in (maximaal 1.000.000 g, ml of stuks).'
        : !['g', 'ml', 'piece'].includes(next.unit ?? '')
          ? 'Kies gram, milliliter of stuks.'
          : null
    return next
  })
  return { ...draft, ingredients }
}

export function addEditorIngredient(draft: EditorRecipeDraft): EditorRecipeDraft {
  if (draft.ingredients.length >= MAX_INGREDIENTS) return draft
  return {
    ...draft,
    ingredients: [...draft.ingredients, {
      clientId: newClientIngredientId(), original: '', label: '', query: '', amount: null, unit: 'g', reviewReason: 'Vul een ingrediëntnaam en hoeveelheid in.',
    }],
  }
}

export function removeEditorIngredient(draft: EditorRecipeDraft, index: number): EditorRecipeDraft {
  if (!Number.isSafeInteger(index) || index < 0 || index >= draft.ingredients.length) return draft
  return { ...draft, ingredients: draft.ingredients.filter((_, row) => row !== index) }
}

/** This gate is for emitting a reviewed draft, NOT user authentication or database writes. */
export function canConfirmUserRecipeDraft(draft: EditorRecipeDraft): boolean {
  return Boolean(
    draft.title.trim().length >= 2 && draft.title.length <= MAX_TEXT &&
    Number.isSafeInteger(draft.servings) && (draft.servings ?? 0) >= 1 && (draft.servings ?? 0) <= 1000 &&
    (draft.minutes === null || (Number.isSafeInteger(draft.minutes) && draft.minutes >= 1 && draft.minutes <= 1440)) &&
    draft.ingredients.length >= 1 && draft.ingredients.length <= MAX_INGREDIENTS &&
    draft.ingredients.every((x) => x.label.trim().length > 0 && x.label.length <= MAX_TEXT &&
      x.reviewReason === null && validAmount(x.amount) &&
      (x.unit === 'g' || x.unit === 'ml' || x.unit === 'piece')),
  )
}
