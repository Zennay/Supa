/**
 * Select only the currently displayed, explicitly read-only shopping export.
 * Deliberately no clipboard, persistence or network privileges.
 */
export function selectShoppingCopyText(
  field: Pick<HTMLTextAreaElement, 'value' | 'readOnly' | 'focus' | 'select' | 'setSelectionRange'> | null,
  expectedText: string,
): boolean {
  if (!field || !field.readOnly || !expectedText || field.value !== expectedText) {
    return false
  }
  try {
    field.focus()
    field.select()
    // Mobile Safari and Android can need an explicit full-range selection.
    field.setSelectionRange(0, expectedText.length)
    return true
  } catch {
    // A device can forbid programmatic selection; manual selection still works.
    return false
  }
}
