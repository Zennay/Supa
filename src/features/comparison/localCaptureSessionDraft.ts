import type { LocalCaptureDraft } from './localCaptureEditorBackup.ts'
import { exportLocalCaptureDraft, restoreLocalCaptureDraft } from './localCaptureEditorBackup.ts'

/**
 * Explicitly opted-in tab-local convenience copy. It never becomes a
 * retailer source, review decision, network message, or accepted price.
 * Unlike localStorage, sessionStorage does not sync this data across tabs.
 */
const KEY = 'supa-private-capture-editor-tab-v1'
const schema = 'supa-private-capture-editor-session-v1'
const maxBytes = 256000
const ttlMs = 12 * 60 * 60 * 1000
const own = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype

function store(): Storage {
  if (typeof window === 'undefined' || !window.sessionStorage)
    throw Error('Tijdelijke tabopslag is op dit apparaat niet beschikbaar.')
  return window.sessionStorage
}

export function saveLocalCaptureTab(fingerprint: string, draft: LocalCaptureDraft): void {
  const value = JSON.stringify({
    schema, savedAt: Date.now(),
    draft: exportLocalCaptureDraft(fingerprint, draft),
  })
  if (new TextEncoder().encode(value).byteLength > maxBytes)
    throw Error('Tijdelijk bronconcept is te groot. Bewaar je lokale JSON-bestand.')
  store().setItem(KEY, value)
}

export function readLocalCaptureTab(
  fingerprint: string, selectedStores: readonly string[], count: number,
): LocalCaptureDraft | null {
  const storage = store()
  const raw = storage.getItem(KEY)
  if (!raw) return null
  if (new TextEncoder().encode(raw).byteLength > maxBytes) {
    storage.removeItem(KEY)
    throw Error('Tijdelijk bronconcept te groot; automatisch verwijderd.')
  }
  let value: unknown
  try { value = JSON.parse(raw) }
  catch {
    storage.removeItem(KEY)
    throw Error('Tijdelijk bronconcept is ongeldig en verwijderd.')
  }
  if (!own(value) || value.schema !== schema ||
      !Number.isSafeInteger(value.savedAt) ||
      typeof value.draft !== 'string') {
    storage.removeItem(KEY)
    throw Error('Onbekende tijdelijke tabopslag is verwijderd.')
  }
  const age = Date.now() - (value.savedAt as number)
  if (age < -300000 || age > ttlMs) {
    storage.removeItem(KEY)
    throw Error('Tijdelijk bronconcept is verlopen of heeft een ongeldige tijd; verwijderd.')
  }
  // Fail closed without deleting a previous week's legitimate private draft:
  // restoreLocalCaptureDraft enforces the exact physical week + selected stores.
  return restoreLocalCaptureDraft(value.draft, fingerprint, selectedStores, count)
}

export function clearLocalCaptureTab(): void {
  store().removeItem(KEY)
}
