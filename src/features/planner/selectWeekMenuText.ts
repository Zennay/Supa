/**
 * Mobile browsers may need an explicit full text range after select().
 * Only touch the user's currently displayed read-only week menu; if the
 * plan re-rendered since the click, never select stale/private draft text.
 * No clipboard API, storage write, or network privileges.
 */
export function selectWeekMenuText(
  field: Pick<HTMLTextAreaElement, 'value' | 'readOnly' | 'focus' | 'select' | 'setSelectionRange'> | null,
  expectedText: string,
): boolean {
  if (!field || !field.readOnly || !expectedText || field.value !== expectedText) return false
  try {
    field.focus()
    if (field.value !== expectedText) return false
    field.select()
    field.setSelectionRange(0, expectedText.length)
    return true
  } catch {
    // Selection may be forbidden on this device. Manual long-press remains.
    return false
  }
}
