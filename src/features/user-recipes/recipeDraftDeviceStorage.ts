/**
 * Explicit, opt-in device draft recovery only. NOT an authenticated database,
 * cross-device sync, private/encrypted storage, or an atomic multi-tab lock.
 * The component owner decides when a user opts into local device storage.
 */
export type DeviceRecipeIngredient = {
  original: string
  label: string
  query: string
  amount: number | null
  unit: 'g' | 'ml' | 'piece' | null
  reviewReason: string | null
}
export type DeviceRecipeDraft = {
  source: 'manual' | 'url'
  sourceUrl: null // source links never stored on this device: may include private tokens
  title: string
  servings: number | null
  minutes: number | null
  steps: string[]
  ingredients: DeviceRecipeIngredient[]
  warnings: string[]
  status: 'needs_review' // recovering never turns a draft into an approved recipe
}
export type DeviceDraftInput = Omit<DeviceRecipeDraft, 'sourceUrl'> & {
  sourceUrl: string | null
  ingredients: Array<DeviceRecipeIngredient & { clientId?: string }>
}

export type RecipeDraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
export type DeviceDraftRecord = {
  format: 'supa-recipe-device-draft'
  version: 1
  revision: number
  savedAt: string
  draft: DeviceRecipeDraft
}

export type DraftStorageRead =
  | { status: 'found'; record: DeviceDraftRecord }
  | { status: 'missing' | 'protected' | 'unavailable' }

export type DraftStorageWrite =
  | { status: 'saved'; record: DeviceDraftRecord }
  | { status: 'deleted' | 'conflict' | 'invalid' | 'protected' | 'unavailable' }

const STORAGE_PREFIX = 'supa:recipe:device-draft:v1:'
const DRAFT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const MAX_BYTES = 65_536

export function createDeviceDraftId(): string {
  // Never use Math.random for device draft IDs.
  return crypto.randomUUID()
}

function storageKey(id: string): string | null {
  return typeof id === 'string' && DRAFT_ID.test(id) ? STORAGE_PREFIX + id : null
}

// Keep only a non-content high-watermark after deleting a draft. It prevents a
// stale tab's old numeric revision from matching a different draft recreated
// under the same UUID (the ABA problem); recipe content is still removed.
function revisionKey(id: string): string | null {
  return typeof id === 'string' && DRAFT_ID.test(id)
    ? STORAGE_PREFIX + 'revision:' + id : null
}

function readRevisionCounter(storage: RecipeDraftStorage, id: string): number | null {
  const key = revisionKey(id)
  if (!key) return null
  const raw = storage.getItem(key)
  if (raw === null) return 0
  if (!/^(0|[1-9][0-9]*)$/.test(raw)) return null
  const revision = Number(raw)
  return Number.isSafeInteger(revision) && revision >= 0 ? revision : null
}

function plainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function boundedText(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)
}

function knownPositive(value: unknown, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 &&
    value <= max && Math.abs(value * 1000 - Math.round(value * 1000)) <= 1e-7
}

function safeDraft(value: unknown): DeviceRecipeDraft | null {
  if (!plainRecord(value)) return null
  if (value.source !== 'manual' && value.source !== 'url') return null
  if (!boundedText(value.title, 180)) return null
  if (value.servings !== null && (!Number.isSafeInteger(value.servings) ||
      (value.servings as number) <= 0 || (value.servings as number) > 1000)) return null
  if (value.minutes !== null && (!Number.isSafeInteger(value.minutes) ||
      (value.minutes as number) <= 0 || (value.minutes as number) > 1440)) return null
  if (!Array.isArray(value.steps) || value.steps.length > 100 ||
      !value.steps.every((part) => boundedText(part, 1500))) return null
  if (!Array.isArray(value.ingredients) || value.ingredients.length > 100 ||
      !Array.isArray(value.warnings) || value.warnings.length > 50 ||
      !value.warnings.every((warning) => boundedText(warning, 300))) return null

  const ingredients: DeviceRecipeIngredient[] = []
  for (const raw of value.ingredients) {
    if (!plainRecord(raw)) return null
    if (!boundedText(raw.original, 500) || !boundedText(raw.label, 180) ||
        !boundedText(raw.query, 180) || (raw.reviewReason !== null &&
          !boundedText(raw.reviewReason, 300))) return null
    if (raw.unit !== null && raw.unit !== 'g' && raw.unit !== 'ml' && raw.unit !== 'piece') return null
    if (raw.amount !== null && !knownPositive(raw.amount, 1_000_000_000)) return null
    ingredients.push({
      original: raw.original,
      label: raw.label,
      query: raw.query,
      amount: raw.amount as number | null,
      unit: raw.unit,
      reviewReason: raw.reviewReason,
    } as DeviceRecipeIngredient)
  }

  // Whitelist fields, strip clientId, unsafe source URL, price, identity and
  // arbitrary undeclared properties. Source URL is intentionally never kept.
  return {
    source: value.source, sourceUrl: null, title: value.title,
    servings: value.servings as number | null,
    minutes: value.minutes as number | null,
    steps: [...value.steps] as string[],
    ingredients,
    warnings: [...value.warnings] as string[],
    status: 'needs_review',
  }
}

function recordFromRaw(raw: string): DeviceDraftRecord | null {
  if (new TextEncoder().encode(raw).byteLength > MAX_BYTES) return null
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { return null }
  if (!plainRecord(parsed) || parsed.format !== 'supa-recipe-device-draft' ||
      parsed.version !== 1 || !Number.isSafeInteger(parsed.revision) ||
      (parsed.revision as number) < 1 || !boundedText(parsed.savedAt, 35) ||
      Number.isNaN(Date.parse(parsed.savedAt as string))) return null
  if (!plainRecord(parsed.draft) || parsed.draft.sourceUrl !== null ||
      parsed.draft.status !== 'needs_review') return null
  const draft = safeDraft(parsed.draft)
  return draft ? {
    format: 'supa-recipe-device-draft', version: 1, revision: parsed.revision as number,
    savedAt: parsed.savedAt as string, draft,
  } : null
}

export function readRecipeDeviceDraft(storage: RecipeDraftStorage, id: string): DraftStorageRead {
  const key = storageKey(id)
  if (!key) return { status: 'protected' }
  let raw: string | null
  try { raw = storage.getItem(key) } catch { return { status: 'unavailable' } }
  if (raw === null) return { status: 'missing' }
  const record = recordFromRaw(raw)
  return record ? { status: 'found', record } : { status: 'protected' }
}

export function saveRecipeDeviceDraft(
  storage: RecipeDraftStorage,
  id: string,
  input: DeviceDraftInput,
  expectedRevision: number | null,
): DraftStorageWrite {
  const key = storageKey(id)
  const counterKey = revisionKey(id)
  if (!key || !counterKey || (expectedRevision !== null &&
    (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1))) return { status: 'invalid' }
  const draft = safeDraft(input)
  if (!draft) return { status: 'invalid' }
  const previous = readRecipeDeviceDraft(storage, id)
  if (previous.status === 'protected' || previous.status === 'unavailable') return { status: previous.status }
  if ((previous.status === 'missing') !== (expectedRevision === null) ||
      (previous.status === 'found' && previous.record.revision !== expectedRevision)) {
    return { status: 'conflict' }
  }
  let highWatermark: number | null
  try { highWatermark = readRevisionCounter(storage, id) }
  catch { return { status: 'unavailable' } }
  if (highWatermark === null) return { status: 'protected' }
  const previousRevision = previous.status === 'found' ? previous.record.revision : 0
  const revision = Math.max(highWatermark, previousRevision) + 1
  if (!Number.isSafeInteger(revision)) return { status: 'protected' }

  const record: DeviceDraftRecord = {
    format: 'supa-recipe-device-draft', version: 1, revision,
    savedAt: new Date().toISOString(), draft,
  }
  const serialized = JSON.stringify(record)
  if (new TextEncoder().encode(serialized).byteLength > MAX_BYTES) return { status: 'invalid' }

  // LocalStorage read-then-write is NOT an atomic CAS transaction. Re-check
  // reduces ordinary stale-tab overwrite but is not cross-tab serializable.
  const lastCheck = readRecipeDeviceDraft(storage, id)
  if (lastCheck.status !== previous.status ||
      (lastCheck.status === 'found' && previous.status === 'found' &&
        lastCheck.record.revision !== previous.record.revision)) return { status: 'conflict' }
  let lastCounter: number | null
  try { lastCounter = readRevisionCounter(storage, id) }
  catch { return { status: 'unavailable' } }
  if (lastCounter === null) return { status: 'protected' }
  if (lastCounter !== highWatermark) return { status: 'conflict' }
  // Persist the high-watermark first. If content writing fails, skipping a
  // revision is safe; reusing an old revision after deletion is not.
  try {
    storage.setItem(counterKey, String(revision))
    storage.setItem(key, serialized)
  } catch { return { status: 'unavailable' } }
  return { status: 'saved', record }
}

export function deleteRecipeDeviceDraft(
  storage: RecipeDraftStorage,
  id: string,
  expectedRevision: number,
): DraftStorageWrite {
  const key = storageKey(id)
  const counterKey = revisionKey(id)
  if (!key || !counterKey || !Number.isSafeInteger(expectedRevision) || expectedRevision < 1) return { status: 'invalid' }
  const current = readRecipeDeviceDraft(storage, id)
  if (current.status === 'protected' || current.status === 'unavailable') return { status: current.status }
  if (current.status !== 'found' || current.record.revision !== expectedRevision) {
    return { status: 'conflict' }
  }
  let highWatermark: number | null
  try { highWatermark = readRevisionCounter(storage, id) }
  catch { return { status: 'unavailable' } }
  if (highWatermark === null) return { status: 'protected' }
  // Leave a numeric tombstone, not recipe content, so old tabs cannot match a
  // new draft incarnation after this record is removed.
  try {
    storage.setItem(counterKey, String(Math.max(highWatermark, current.record.revision)))
    storage.removeItem(key)
  } catch { return { status: 'unavailable' } }
  return { status: 'deleted' }
}
