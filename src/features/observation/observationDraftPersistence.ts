export type ObservationDraftStorage = {
  setItem(key: string, value: string): void
}

export function persistObservationDraft(
  getStorage: () => ObservationDraftStorage,
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
