import type { UnpricedShoppingNote } from './ManualShoppingNotes.tsx'

/**
 * Stable comparison identity for a handwritten grocery label.
 *
 * NFKC and removal of default-ignorable code points are used for duplicate
 * detection only: the label shown to the user and written to backups is never
 * normalized. This prevents visually equivalent full-width or zero-width
 * variants from bypassing duplicate checks across add, move, CSV and recovery.
 */
export function privateNoteLabelIdentity(label: string): string {
  return label.normalize('NFKC')
    .replace(/\p{Default_Ignorable_Code_Point}/gu, '')
    .normalize('NFC')
    .toLocaleLowerCase('nl-NL')
}

export function privateNoteDuplicateKey(
  store: UnpricedShoppingNote['store'],
  label: string,
): string {
  return JSON.stringify([store, privateNoteLabelIdentity(label)])
}
