export type ObservationDraftWriteStorage = {
  setItem(key: string, value: string): void
}

export type ObservationDraftRemovalStorage = {
  removeItem(key: string): void
}

export function persistObservationDraft(
  getStorage: () => ObservationDraftWriteStorage,
  key: string,
  draft: unknown,
): boolean {
  try {
    const serialized = JSON.stringify(draft)
    if (typeof serialized !== 'string') return false

    getStorage().setItem(key, serialized)
    return true
  } catch {
    return false
  }
}

export function removeObservationDraft(
  getStorage: () => ObservationDraftRemovalStorage,
  key: string,
): boolean {
  try {
    getStorage().removeItem(key)
    return true
  } catch {
    return false
  }
}
