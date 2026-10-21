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
  /** Original parser/source hold, separate from temporary editor validation messages. */
  sourceReviewReason?: string | null
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

const EDITOR_VALIDATION_REASONS = new Set([
  'Vul een ingrediëntnaam in.',
  'Vul een geldige hoeveelheid in.',
  'Vul een geldige hoeveelheid in (maximaal 1.000.000).',
  'Vul een geldige hoeveelheid in (maximaal 1.000.000 g, ml of stuks).',
  'Kies gram, milliliter of stuks.',
  'Een deel van een stuk: kies een heel aantal stuks.',
  'Vul een hoeveelheid in.',
  'Vul een ingrediëntnaam en hoeveelheid in.',
])

function editorValidationReason(
  ingredient: Pick<EditorIngredient, 'label' | 'amount' | 'unit'>,
): string | null {
  if (!ingredient.label.trim()) return 'Vul een ingrediëntnaam in.'
  if (!validAmount(ingredient.amount)) return 'Vul een geldige hoeveelheid in (maximaal 1.000.000).'
  if (!['g', 'ml', 'piece'].includes(ingredient.unit ?? '')) return 'Kies gram, milliliter of stuks.'
  if (ingredient.unit === 'piece' && !Number.isSafeInteger(ingredient.amount)) {
    return 'Een deel van een stuk: kies een heel aantal stuks.'
  }
  return null
}

function sourceReviewReasonOf(ingredient: EditorIngredient): string | null {
  // An explicit null means a previously reviewed source warning was cleared.
  // Only older drafts without this field need the legacy reviewReason fallback.
  if (Object.hasOwn(ingredient, 'sourceReviewReason')) {
    return typeof ingredient.sourceReviewReason === 'string' && ingredient.sourceReviewReason.length > 0
      ? ingredient.sourceReviewReason : null
  }
  return typeof ingredient.reviewReason === 'string' &&
    ingredient.reviewReason.length > 0 &&
    !EDITOR_VALIDATION_REASONS.has(ingredient.reviewReason)
    ? ingredient.reviewReason : null
}

function validAmount(value: number | null): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 &&
    value <= MAX_CANONICAL_METRIC_AMOUNT &&
    Math.abs(value * 1000 - Math.round(value * 1000)) <= 1e-7
}

export function emptyUserRecipeDraft(): EditorRecipeDraft {
  return {
    source: 'manual', sourceUrl: null, title: '', servings: 2,
    minutes: null, steps: [], warnings: [], status: 'needs_review',
    ingredients: [{ clientId: newClientIngredientId(), original: '', label: '', query: '', amount: null, unit: 'g', reviewReason: 'Vul een hoeveelheid in.', sourceReviewReason: null }],
  }
}

/** Assign stable UI keys without modifying imported parsed recipe drafts. */
export function prepareImportedRecipeForEditor(
  draft: Omit<EditorRecipeDraft, 'ingredients'> & { ingredients: Omit<EditorIngredient, 'clientId'>[] },
): EditorRecipeDraft {
  const ingredients = draft.ingredients.map((ingredient) => {
    const next = { ...ingredient, clientId: newClientIngredientId() }
    const sourceReviewReason = sourceReviewReasonOf(next)
    next.sourceReviewReason = sourceReviewReason
    // Imported data is a proposal, not permission to bypass the editor's
    // canonical quantity limits, whole-piece rule, or source review hold.
    next.reviewReason = editorValidationReason(next)
    return next
  })
  return { ...draft, ingredients }
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
    const measurementChanged =
      (Object.hasOwn(patch, 'amount') && patch.amount !== ingredient.amount) ||
      (Object.hasOwn(patch, 'unit') && patch.unit !== ingredient.unit)
    const next = { ...ingredient, ...patch }
    next.label = next.label.trimStart().slice(0, MAX_TEXT)
    next.query = next.label.toLowerCase()
    const validation = editorValidationReason(next)
    const previousSourceReview = sourceReviewReasonOf(ingredient)
    const correctedMeasurementIsValid = measurementChanged &&
      validAmount(next.amount) &&
      (next.unit === 'g' || next.unit === 'ml' || next.unit === 'piece') &&
      (next.unit !== 'piece' || Number.isSafeInteger(next.amount))
    const sourceReviewReason = correctedMeasurementIsValid ? null : previousSourceReview
    next.sourceReviewReason = sourceReviewReason
    next.reviewReason = validation
    return next
  })
  // Only retire the exact parser-generated warning for THIS ingredient after
  // a real, valid measurement correction. Source-wide and unrelated warnings
  // remain pending; label-only edits never erase import provenance.
  const previous = draft.ingredients[index]
  const reviewed = ingredients[index]
  const correctedMeasurement =
    (Object.hasOwn(patch, 'amount') && patch.amount !== previous.amount) ||
    (Object.hasOwn(patch, 'unit') && patch.unit !== previous.unit)
  const previousSourceReview = sourceReviewReasonOf(previous)
  const reviewedSourceReview = sourceReviewReasonOf(reviewed)
  if (correctedMeasurement && previousSourceReview && !reviewedSourceReview) {
    const resolvedWarning = `Ingrediënt ${index + 1}: ${previousSourceReview}`
    return { ...draft, ingredients,
      warnings: draft.warnings.filter(warning => warning !== resolvedWarning) }
  }
  return { ...draft, ingredients }
}

export function addEditorIngredient(draft: EditorRecipeDraft): EditorRecipeDraft {
  if (draft.ingredients.length >= MAX_INGREDIENTS) return draft
  return {
    ...draft,
    ingredients: [...draft.ingredients, {
      clientId: newClientIngredientId(), original: '', label: '', query: '', amount: null, unit: 'g', reviewReason: 'Vul een ingrediëntnaam en hoeveelheid in.', sourceReviewReason: null,
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
      x.reviewReason === null && x.sourceReviewReason == null && validAmount(x.amount) &&
      (x.unit === 'g' || x.unit === 'ml' || x.unit === 'piece') &&
      (x.unit !== 'piece' || Number.isSafeInteger(x.amount))),
  )
}
