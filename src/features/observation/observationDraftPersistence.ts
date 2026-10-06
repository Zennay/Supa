export type ObservationDraftStorage = {
  setItem(key: string, value: string): void
}

export function persistObservationDraft(
  storage: ObservationDraftStorage,
  key: string,
  draft: unknown,
): boolean {
  try {
    storage.setItem(key, JSON.stringify(draft))
    return true
  } catch {
    return false
  }
}
