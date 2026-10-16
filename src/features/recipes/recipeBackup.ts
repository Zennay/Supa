import { reviewRecipe, saveRecipeLibrary, type LibraryState, type SavedRecipe } from './recipeLibrary.ts'
import type { UserRecipeDraft } from '../../domain/userRecipeImport.ts'

const FORMAT = 'supa-private-recipes-backup'
const MAX_BYTES = 2_000_000
const MAX_RECIPES = 100

/**
 * File.size is measured in UTF-8 bytes, not JavaScript UTF-16 code units.
 * Reject obviously oversized text before encoding to bound temporary memory.
 * TextEncoder works identically in modern browsers and native Node tests.
 */
function withinBackupByteBudget(value: string): boolean {
  return value.length <= MAX_BYTES && new TextEncoder().encode(value).byteLength <= MAX_BYTES
}

type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>
type BackupRecipe = Pick<UserRecipeDraft, 'title' | 'servings' | 'minutes' | 'source' | 'sourceUrl'> & {
  ingredients: string[]
  steps: string[]
}

function safeLink(value: unknown): string | null {
  if (value === null) return null
  if (typeof value !== 'string' || value.length > 2048 || /[\u0000-\u001f\u007f]/.test(value)) throw new Error('Ongeldige bronlink in de back-up.')
  let url: URL
  try { url = new URL(value) } catch { throw new Error('Ongeldige bronlink in de back-up.') }
  if (url.protocol !== 'https:' || url.username || url.password || !url.hostname.includes('.') ||
      /(?:^|\.)(?:localhost|local|internal|test|invalid)$/i.test(url.hostname) ||
      /^(?:\d+\.){3}\d+$/.test(url.hostname)) {
    throw new Error('Back-up bevat een onveilige receptlink.')
  }
  for (const encodedKey of url.searchParams.keys()) {
    // URLSearchParams performs ONE percent decoding pass. A further-escaped
    // OAuth/PKCE/SAML key must never escape into a portable JSON backup.
    // Every pass is checked; still-escaped, malformed or excessive nesting
    // fails closed without including a source URL or any query value in errors.
    let key = encodedKey
    let resolved = false
    for (let layer = 0; layer < 8; layer += 1) {
      // Percent-encoded query delimiters can become an entirely new auth
      // parameter if a downstream importer or link resolver decodes again.
      // Reject that ambiguity, including control characters, instead of
      // serializing a portable URL that changes meaning across applications.
      const canonical = key.normalize('NFKC')
      // Fullwidth/compatibility Unicode becomes ASCII delimiters and percent
      // escapes AFTER normalization. Never evaluate source URL query safety on
      // the pre-normalized text (it could gain a new OAuth query parameter).
      // Reject all default-ignorable Unicode characters (including Mn
      // grapheme joiners and variation selectors, not just Cc/Cf) in
      // QUERY KEYS before each decode. Downstream canonicalizers may strip
      // these characters and reinterpret e.g. co<ignorable>de as 'code'.
      // Such keys can display as a harmless label while resolving to an auth
      // field when a downstream app removes default-ignorable markers.
      // Query VALUES (including human recipe names) are not affected.
      if (/[&=?#\p{Default_Ignorable_Code_Point}\p{Cc}]/u.test(canonical)) {
        throw new Error('Back-up bevat een onveilige receptlink.')
      }
      const normalized = canonical.toLowerCase()
      const compact = normalized.replace(/[-_\s]/g, '')
      if (/(?:oauth|saml|token|secret|password|signature|apikey|session|authorization|pkce|codeverifier|codechallenge|authcode)/.test(compact) ||
          /(?:^|[_-])(?:code|sig|auth|state)(?:$|[_-])/.test(normalized)) {
        throw new Error('Back-up mag geen geheime inloggegevens in receptlinks bevatten.')
      }
      // Decode the canonical version: NFKC can itself produce a fresh %
      // escape from a fullwidth percent sign (U+FF05).
      if (!canonical.includes('%')) {
        resolved = true
        break
      }
      let decoded: string
      try {
        decoded = decodeURIComponent(canonical)
      } catch {
        throw new Error('Back-up bevat een onveilige receptlink.')
      }
      if (decoded === canonical) {
        throw new Error('Back-up bevat een onveilige receptlink.')
      }
      key = decoded
    }
    if (!resolved) throw new Error('Back-up bevat een onveilige receptlink.')
  }
  url.hash = ''
  return url.href
}

/** Portable, intentionally minimal private backup: no retailer matches or pricing. */
export function exportRecipeBackup(state: LibraryState): string {
  if (state.error) throw new Error(state.error)
  const recipes: BackupRecipe[] = state.recipes.map(recipe => ({
    title: recipe.title, servings: recipe.servings, minutes: recipe.minutes,
    source: recipe.source, sourceUrl: recipe.source === 'url' ? safeLink(recipe.sourceUrl) : null,
    ingredients: recipe.ingredients.map(item => item.original), steps: [...recipe.steps],
  }))
  const text = JSON.stringify({ format: FORMAT, version: 1, recipes }, null, 2)
  if (!withinBackupByteBudget(text)) throw new Error('De receptenverzameling is te groot om te exporteren.')
  return text
}

/** Validate every recipe before touching storage: corrupted backups never replace data. */
export function parseRecipeBackup(text: string): UserRecipeDraft[] {
  if (typeof text !== 'string' || !withinBackupByteBudget(text)) throw new Error('Back-upbestand is te groot of ongeldig.')
  let payload: unknown
  try { payload = JSON.parse(text) } catch { throw new Error('Back-upbestand bevat geen geldige JSON.') }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Geen Supa-receptenback-up.')
  const value = payload as { format?: unknown; version?: unknown; recipes?: unknown }
  if (value.format !== FORMAT || value.version !== 1 || !Array.isArray(value.recipes) ||
      value.recipes.length > MAX_RECIPES) throw new Error('Onbekend of te groot Supa-back-upformaat.')
  return value.recipes.map((item: unknown) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('Back-up bevat een ongeldig recept.')
    const entry = item as Partial<BackupRecipe>
    if (entry.source !== 'manual' && entry.source !== 'url') throw new Error('Onbekende receptbron in de back-up.')
    if ((entry.source === 'manual' && entry.sourceUrl !== null) ||
        (entry.source === 'url' && typeof entry.sourceUrl !== 'string')) {
      throw new Error('Receptbron en bronlink spreken elkaar tegen.')
    }
    const url = safeLink(entry.sourceUrl)
    if (entry.source === 'url' && !url) throw new Error('Geïmporteerd recept mist een bronlink.')
    if (typeof entry.title !== 'string' || entry.title.length > 160 || !Array.isArray(entry.ingredients) ||
        entry.ingredients.length === 0 || entry.ingredients.length > 100 ||
        !entry.ingredients.every(x => typeof x === 'string' && x.length <= 400) ||
        !Array.isArray(entry.steps) || entry.steps.length === 0 || entry.steps.length > 100 ||
        !entry.steps.every(x => typeof x === 'string' && x.length <= 5000) ||
        (entry.servings !== null && (typeof entry.servings !== 'number' || !Number.isFinite(entry.servings))) ||
        (entry.minutes !== null && (typeof entry.minutes !== 'number' || !Number.isFinite(entry.minutes)))) {
      throw new Error('Back-up bevat ongeldige receptvelden.')
    }
    const candidate: UserRecipeDraft = {
      title: entry.title, servings: entry.servings, minutes: entry.minutes,
      source: entry.source, sourceUrl: url, ingredients: entry.ingredients.map(original => ({
        original, label: original, query: original.toLocaleLowerCase('nl'), amount: null, unit: null, reviewReason: 'Hercontrole vereist',
      })),
      steps: entry.steps, warnings: [], status: 'needs_review',
    }
    return reviewRecipe(candidate)
  })
}

/**
 * Safe merge, not an overwrite. Newly minted IDs avoid collisions across devices;
 * the existing raw storage CAS prevents stale tabs overwriting later changes.
 */
export function restoreRecipeBackup(
  storage: Storage,
  previous: LibraryState,
  text: string,
  mintId: () => string,
  savedAt: string,
): LibraryState {
  if (previous.error) throw new Error(previous.error)
  const drafts = parseRecipeBackup(text)
  if (previous.recipes.length + drafts.length > MAX_RECIPES) throw new Error('Maximaal 100 eigen recepten op dit apparaat.')
  if (!/^\d{4}-\d\d-\d\dT/.test(savedAt) || !Number.isFinite(Date.parse(savedAt))) {
    throw new Error('Ongeldige bewaartijd.')
  }
  const existingIds = new Set(previous.recipes.map(recipe => recipe.id))
  const restored: SavedRecipe[] = drafts.map(draft => {
    const id = mintId()
    if (typeof id !== 'string' || !/^own-[a-zA-Z0-9-]{4,80}$/.test(id) || existingIds.has(id)) {
      throw new Error('Dubbel of ongeldig nieuw recept-ID; er is niets geïmporteerd.')
    }
    existingIds.add(id)
    return { ...draft, id, savedAt }
  })
  return saveRecipeLibrary(storage, previous, [...restored, ...previous.recipes])
}
