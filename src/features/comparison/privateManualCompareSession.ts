import type { ManualEntries, ManualNeed } from '../../domain/manualStoreComparison.ts'

export type PrivateManualSession = Readonly<{
  entries: ManualEntries
  demandSignature: string | null
  recordedNeeds: readonly ManualNeed[]
}>

// Per browser tab and only in RAM. Never localStorage, sessionStorage,
// IndexedDB, cookies, server state or cross-tab channels.
const sessions = new WeakMap<Window, PrivateManualSession>()

function validSession(value: PrivateManualSession): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      !value.entries || typeof value.entries !== 'object' ||
      !Array.isArray(value.recordedNeeds) || value.recordedNeeds.length > 100 ||
      (value.demandSignature !== null && (typeof value.demandSignature !== 'string' ||
       value.demandSignature.length > 50000))) return false
  const keys = Object.keys(value.entries)
  if (keys.length > 200) return false
  return keys.every(key => {
    const quote = value.entries[key]
    return key.length <= 800 && quote && typeof quote === 'object' &&
      typeof quote.product === 'string' && quote.product.length <= 160 &&
      typeof quote.packAmount === 'string' && quote.packAmount.length <= 32 &&
      typeof quote.packUnit === 'string' && quote.packUnit.length <= 16 &&
      typeof quote.packCount === 'string' && quote.packCount.length <= 16 &&
      typeof quote.price === 'string' && quote.price.length <= 20
  })
}

/** Read only the draft in this tab. No personal data leaves memory. */
export function readPrivateManualSession(): PrivateManualSession | null {
  if (typeof window === 'undefined') return null
  return sessions.get(window) ?? null
}

/** Replace the tiny in-memory draft snapshot after a committed React update. */
export function savePrivateManualSession(session: PrivateManualSession): void {
  if (typeof window === 'undefined') return
  if (!validSession(session)) {
    sessions.delete(window)
    return
  }
  sessions.set(window, {
    entries: Object.fromEntries(Object.entries(session.entries).map(([key, quote]) =>
      [key, { ...quote }])) as ManualEntries,
    demandSignature: session.demandSignature,
    recordedNeeds: session.recordedNeeds.map(need => ({ ...need })),
  })
}

export function clearPrivateManualSession(): void {
  if (typeof window !== 'undefined') sessions.delete(window)
}
