/**
 * Pure product-owned integration of already tested recipe modules.
 * Neither this composition nor its "review-ready" result grants permission
 * to fetch a URL, persist a user account record, price ingredients, or publish.
 */
import {
  canConfirmUserRecipeDraft,
  prepareImportedRecipeForEditor,
  type EditorRecipeDraft,
} from './userRecipeDraftEditor.ts'
import {
  scaleMetricRecipeDraft,
  type PortionWarning,
} from '../../domain/userRecipePortions.ts'
import { assessRecipeSourceUrl, type RecipeUrlAssessment } from '../../domain/userRecipeSourceUrl.ts'
import {
  readRecipeDeviceDraft,
  saveRecipeDeviceDraft,
  type RecipeDraftStorage,
  type DraftStorageWrite,
} from './recipeDraftDeviceStorage.ts'

export type LocalRecipePreview = {
  draft: EditorRecipeDraft
  portionWarnings: PortionWarning[]
  sourceAssessment: RecipeUrlAssessment | null
  needsReview: boolean
  fetchAuthorized: false
  cloudSaved: false
}

/** Review the proposed change, WITHOUT changing the source or saving it. */
export function previewLocalRecipePortions(
  source: EditorRecipeDraft,
  desiredServings: number,
): LocalRecipePreview {
  const scaled = scaleMetricRecipeDraft(source, desiredServings)
  const sourceAssessment = source.source === 'url' && source.sourceUrl !== null
    ? assessRecipeSourceUrl(source.sourceUrl)
    : null
  const sourceNotReviewed = source.source === 'url' &&
    (!sourceAssessment || sourceAssessment.accepted === false)
  // Review of the original import/measurement/provenance cannot disappear
  // merely because scaled ingredient numbers are valid. Shopping needs uses
  // this same source-level warning requirement.
  const originalWarningsPending = !Array.isArray(source.warnings) || source.warnings.length > 0
  return {
    draft: scaled.draft,
    portionWarnings: scaled.warnings,
    sourceAssessment,
    needsReview: sourceNotReviewed || originalWarningsPending ||
      scaled.status === 'needs_review' ||
      !canConfirmUserRecipeDraft(scaled.draft),
    fetchAuthorized: false,
    cloudSaved: false,
  }
}

/**
 * Storing a REVIEW DRAFT on a device must be opt-in; do not confuse a saved
 * draft with an accepted recipe. This does not perform user login or syncing.
 */
export function saveLocalRecipeReviewDraft(
  storage: RecipeDraftStorage,
  id: string,
  draft: EditorRecipeDraft,
  expectedRevision: number | null,
  explicitDeviceStorageConsent: boolean,
): DraftStorageWrite | { status: 'consent_required' } {
  // Callers may cross JS/TS boundaries with form, URL or settings values.
  // Only explicit *primitive* boolean true authorizes unencrypted local I/O.
  // All other types must return before any storage.getItem/setItem call.
  if (explicitDeviceStorageConsent !== true) return { status: 'consent_required' }
  return saveRecipeDeviceDraft(storage, id, draft, expectedRevision)
}

/** Recover a draft with new UI-only row IDs; preserve its need for review. */
export function restoreLocalRecipeReviewDraft(storage: RecipeDraftStorage, id: string):
  | { status: 'found'; draft: EditorRecipeDraft; revision: number }
  | { status: 'missing' | 'protected' | 'unavailable' } {
  const stored = readRecipeDeviceDraft(storage, id)
  if (stored.status !== 'found') return { status: stored.status }
  return {
    status: 'found',
    revision: stored.record.revision,
    draft: prepareImportedRecipeForEditor(stored.record.draft),
  }
}
