import { createElement, useId } from 'react'
import type { UnpricedShoppingPreview } from './unpricedShoppingPreview.ts'

/**
 * Accessible, mobile-friendly review view for an UNPRICED manual-recipe list.
 * Reuses the existing domain's pre-computed list; no clipboard permission,
 * active retailer requests, automatic print or background storage.
 *
 * Intentionally not mounted in App.tsx while the M3 app owner has that route.
 */
export function UnpricedPrivateShoppingPreviewView({
  preview,
}: {
  preview: UnpricedShoppingPreview
}) {
  const fieldId = useId()
  const noticeId = useId()

  if (preview.status !== 'manual_review_only') {
    return createElement('p', { role: 'status' },
      'De boodschappenlijst kan nog niet worden gemaakt. Controleer eerst je recepten en planning.')
  }

  const rows = preview.checklist.lines.map((line) =>
    createElement('li', { key: line.id }, [
      createElement('strong', { key: 'label' }, line.label),
      createElement('span', { key: 'quantity' }, ' — ' + line.quantity),
      createElement('em', { key: 'review' }, ' · zelf product kiezen'),
    ]),
  )

  return createElement('section', {
    className: 'supa-printable-shopping',
    'aria-label': 'Boodschappen uit mijn recepten',
  }, [
    createElement('h2', { key: 'title' }, 'Boodschappen uit mijn recepten'),
    createElement('p', { key: 'notice', id: noticeId, role: 'status' },
      'Winkel en prijzen zijn nog onbekend. Controleer alle producten en hoeveelheden zelf. Er is geen besparing berekend.'),
    createElement('p', { key: 'count' },
      preview.unresolvedItemCount +
      (preview.unresolvedItemCount === 1 ? ' product moet' : ' producten moeten') +
      ' nog handmatig worden gekozen.'),
    createElement('ol', {
      key: 'items', className: 'supa-printable-shopping__rows',
      'aria-describedby': noticeId,
    }, rows),
    createElement('label', { key: 'copy-label', htmlFor: fieldId },
      'Kopieerbare boodschappenlijst'),
    createElement('textarea', {
      key: 'copy', id: fieldId, readOnly: true, rows: 9,
      'aria-describedby': noticeId,
      value: preview.copyText,
      style: { maxWidth: '100%', width: '100%', boxSizing: 'border-box' },
      onFocus: (event: { currentTarget: HTMLTextAreaElement }) => event.currentTarget.select(),
    }),
    createElement('p', { key: 'help' },
      'Tik in de tekst en gebruik Kopieer op je apparaat.'),
  ])
}
