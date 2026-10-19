// A private week menu can only be saved after the user prepared and saw its
// exact current text. No network, clipboard, auto-download or localStorage.
export type WeekMenuDownloadPort = {
  createObjectURL: (text: string) => string
  triggerDownload: (url: string, filename: string) => void
  scheduleRevoke: (url: string) => void
}

export const weekMenuDownloadName = 'supa-weekmenu.txt'

/**
 * Trigger a single explicit, local UTF-8 download from the CURRENT read-only
 * preview. Fail closed when a plan changes, a browser feature is unavailable,
 * or the preview is malformed. Caller owns the Blob URL's timed revocation.
 */
export function downloadPreparedWeekMenu(
  field: Pick<HTMLTextAreaElement, 'value' | 'readOnly'> | null,
  expectedText: string,
  port: WeekMenuDownloadPort,
): boolean {
  let objectUrl: string | null = null
  try {
    if (!field || field.readOnly !== true ||
        typeof expectedText !== 'string' ||
        !expectedText.startsWith('SUPA · Weekmenu\n') ||
        !expectedText.includes('Dit is een planning, geen prijsopgave.') ||
        !expectedText.endsWith('Receptschattingen en echte winkelprijzen zijn niet inbegrepen.') ||
        new TextEncoder().encode(expectedText).length > 16384 ||
        field.value !== expectedText) return false

    objectUrl = port.createObjectURL(expectedText)
    if (typeof objectUrl !== 'string' || !objectUrl.startsWith('blob:')) return false

    // The browser can mutate DOM focus/input while preparing the resource.
    // Never start a download if the displayed private preview changed.
    if (!field.readOnly || field.value !== expectedText) return false
    port.triggerDownload(objectUrl, weekMenuDownloadName)
    return true
  } catch {
    // Keep selection-by-hand available on browsers that deny local downloads.
    return false
  } finally {
    if (typeof objectUrl === 'string' && objectUrl.startsWith('blob:')) {
      try { port.scheduleRevoke(objectUrl) } catch { /* browser cleanup may fail */ }
    }
  }
}
