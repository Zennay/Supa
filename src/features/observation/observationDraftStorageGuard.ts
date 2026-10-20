/**
 * Compare a captured local draft to the current browser bytes before any write
 * or delete. Never deserialize or expose potentially private price observations.
 *
 * localStorage has no atomic compare-and-swap; this prevents ordinary stale-tab
 * clobbering but cannot claim transactional protection against a simultaneous
 * write between getItem and setItem. The caller must fail closed on conflicts.
 */
export type ObservationDraftStorageRead = { getItem(key: string): string | null }
export type ObservationDraftStorageStatus = 'unchanged' | 'changed' | 'unavailable'

export function observationDraftStorageStatus(
  getStorage: () => ObservationDraftStorageRead,
  key: string,
  expectedRaw: string | null | undefined,
): ObservationDraftStorageStatus {
  if (typeof key !== 'string' || key.length === 0 ||
      (expectedRaw !== null && typeof expectedRaw !== 'string')) {
    return 'unavailable'
  }
  try {
    const actual = getStorage().getItem(key)
    if (actual !== null && typeof actual !== 'string') return 'unavailable'
    return actual === expectedRaw ? 'unchanged' : 'changed'
  } catch {
    return 'unavailable'
  }
}
