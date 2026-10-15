import { renderM3PaperChecklist } from './m3PaperWorksheet.ts'

/**
 * A user-initiated download of two wholly blank retailer worksheets.
 *
 * Never serialize the in-memory ObservationSheet or read localStorage here:
 * printed paper is not verified field evidence, and a failed download must
 * never overwrite an in-progress private field draft.
 */
export function downloadBlankM3PaperWorksheet(fieldRunCommitSha = ''): boolean {
  let href: string | null = null
  let anchor: HTMLAnchorElement | null = null
  try {
    const html = renderM3PaperChecklist(fieldRunCommitSha)
    href = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }))
    anchor = document.createElement('a')
    anchor.href = href
    anchor.download = 'supa-m3-leeg-plus-dekamarkt-veldformulier.html'
    document.body.append(anchor)
    anchor.click()
    return true
  } catch {
    return false
  } finally {
    anchor?.remove()
    if (href !== null) URL.revokeObjectURL(href)
  }
}
