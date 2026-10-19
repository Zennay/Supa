/**
 * Mobile browsers may need an explicit full text range after select().
 * Only touch the user's currently displayed read-only week menu; if the
 * plan re-rendered since the click, never select stale/private draft text.
 * No clipboard API, storage write, or network privileges.
 */
export function selectWeekMenuText(
  field: (Pick<HTMLTextAreaElement, 'value' | 'readOnly' | 'focus' | 'select' | 'setSelectionRange'> &
    Partial<Pick<HTMLTextAreaElement, 'selectionStart' | 'selectionEnd'>>) | null,
  expectedText: string,
): boolean {
  if (!field || !field.readOnly || !expectedText || field.value !== expectedText) return false
  try {
    field.focus()
    if (!field.readOnly || field.value !== expectedText) return false
    field.select()
    if (!field.readOnly || field.value !== expectedText) return false
    field.setSelectionRange(0, expectedText.length)
    if (!field.readOnly || field.value !== expectedText) return false
    // Real textarea controls expose these numeric positions. Some mobile
    // browsers quietly ignore selection requests; do not announce success
    // when the native positions prove no full range was selected.
    if (typeof field.selectionStart === 'number' &&
        typeof field.selectionEnd === 'number' &&
        (field.selectionStart !== 0 || field.selectionEnd !== expectedText.length)) return false
    return true
  } catch {
    // Selection may be forbidden on this device. Manual long-press remains.
    return false
  }
}

/** Honest action result for assistive tech; selecting is not the same as copying. */
export function weekMenuSelectionFeedback(selected: boolean): string {
  return selected
    ? 'Tekst geselecteerd. Kies Kopieer op je apparaat.'
    : 'Automatisch selecteren lukt niet. Houd de tekst ingedrukt om te kopiëren.'
}
