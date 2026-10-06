export const MAX_OBSERVATION_DRAFT_FILE_BYTES = 1024 * 1024

export function observationDraftFileSizeAllowed(size: unknown): boolean {
  return (
    typeof size === 'number' &&
    Number.isSafeInteger(size) &&
    size >= 0 &&
    size <= MAX_OBSERVATION_DRAFT_FILE_BYTES
  )
}
