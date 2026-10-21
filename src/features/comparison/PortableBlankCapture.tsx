import { useRef, useState } from 'react'
import { makeBlankPlannerCaptureCsv, type CaptureStore } from './plannerPriceCaptureSheet.ts'
import { makePlannerCaptureGuide, type PlannerCaptureGuideNeed } from './plannerPriceCaptureGuide.ts'
import { LocalObservationCaptureEditor } from './LocalObservationCaptureEditor.tsx'

type CaptureDocument = 'csv' | 'guide'
type Displayed = { key: string; kind: CaptureDocument; text: string }

/**
 * A phone-friendly alternative to downloading the two existing canonical
 * blank-capture documents. No offer, SKU, timestamp or price is inferred.
 */
export function PortableBlankCapture({
  needs, stores, captureKey, needsAtClick, purpose = 'blank', delimiter = ',',
  onReview, onDraftChange,
}: {
  needs: readonly PlannerCaptureGuideNeed[]
  stores: readonly CaptureStore[]
  captureKey: string
  needsAtClick?: () => readonly PlannerCaptureGuideNeed[]
  purpose?: 'blank' | 'missing'
  delimiter?: ',' | ';' | '\t'
  onReview?: (files: File[]) => void | Promise<void>
  onDraftChange?: () => void
}) {
  const [displayed, setDisplayed] = useState<Displayed | null>(null)
  const [feedback, setFeedback] = useState<{key: string; message: string} | null>(null)
  const activeKey = useRef(captureKey)
  activeKey.current = captureKey
  const current = displayed?.key === captureKey ? displayed : null
  const currentFeedback = feedback?.key === captureKey ? feedback.message : ''

  function documentText(kind: CaptureDocument): string {
    const currentNeeds = needsAtClick ? needsAtClick() : needs
    if (!currentNeeds.length) throw new Error('Geen ontbrekende winkelproducten voor dit invulblad.')
    const value = kind === 'csv'
      ? makeBlankPlannerCaptureCsv(currentNeeds, stores, delimiter)
      : makePlannerCaptureGuide(currentNeeds, stores)
    if (new TextEncoder().encode(value).byteLength > 256000) {
      throw new Error('Dit invulblad is te groot om veilig lokaal te delen.')
    }
    return value
  }

  async function act(kind: CaptureDocument, method: 'show' | 'copy' | 'share') {
    const key = captureKey
    try {
      const value = documentText(kind)
      // Always reveal a selectable local fallback. Even clipboard denial must
      // never destroy accepted store captures or add a draft price.
      setDisplayed({ key, kind, text: value })
      setFeedback(null)
      if (method === 'show') return
      if (method === 'copy') {
        if (!navigator.clipboard?.writeText) throw new Error(
          'Automatisch kopiëren niet toegestaan. Selecteer de tekst hieronder om hem zelf te kopiëren.',
        )
        await navigator.clipboard.writeText(value)
        if (key === activeKey.current) setFeedback({ key, message:
          'Leeg origineel ' + (kind === 'csv' ? 'CSV-invulblad' : 'rijgids') +
          ' gekopieerd; plak het op jouw toestel of in je spreadsheet.',
        })
        return
      }
      if (!navigator.share) throw new Error(
        'Mobiel delen is hier niet beschikbaar. Gebruik de selecteerbare tekst hieronder.',
      )
      await navigator.share({
        title: 'Supa · privé invulblad zonder winkelprijzen',
        text: value,
      })
      if (key === activeKey.current) setFeedback({ key, message: 'Leeg winkelopnameblad gedeeld via je toestel.' })
    } catch (cause) {
      if (cause instanceof Error && cause.name === 'AbortError') {
        if (key === activeKey.current) setFeedback({ key, message: 'Delen geannuleerd. Het lege document blijft hieronder beschikbaar.' })
        return
      }
      if (key === activeKey.current) setFeedback({ key, message: cause instanceof Error ? cause.message :
        'Document kan niet worden gedeeld. Download het bestand als alternatief.' })
    }
  }

  return <section className="offline-price-workbench__capture-portable"
    aria-label="Leeg winkelopnameblad zonder download gebruiken">
    <strong>{purpose === 'missing'
      ? 'De nog ontbrekende winkelproducten meenemen zonder download'
      : 'Ook zonder download je eigen prijsblad invullen'}</strong>
    <p>{purpose === 'missing'
      ? 'Alleen nog ontbrekende bronregels, of een volledige nieuwe winkelopname wanneer de oude bron verlopen is. Een nieuwe opname krijgt nooit stilzwijgend een oud bronmoment.'
      : 'Gebruik exact dezelfde blanco PLUS-/DekaMarkt-CSV en regelnummergids als de downloads.'}
      {' '}Op je telefoon kun je deze lege bronkolommen en originele Planner-hoeveelheden
      kopiëren of bewust delen. Je gekozen kolomscheiding (komma, puntkomma of tab) blijft behouden.
      Er worden geen winkelprijzen, artikelcodes,
      waarnemingstijden of bronrechten ingevuld.</p>
    <div className="offline-price-workbench__actions">
      <button type="button" className="ghost-button" disabled={!needs.length}
        onClick={() => void act('csv', 'copy')}>Kopieer leeg CSV-invulblad</button>
      <button type="button" className="ghost-button" disabled={!needs.length}
        onClick={() => void act('csv', 'show')}>Toon selecteerbare CSV</button>
      <button type="button" className="ghost-button" disabled={!needs.length}
        onClick={() => void act('csv', 'share')}>Deel leeg CSV/TSV-invulblad op mijn telefoon</button>
      <button type="button" className="ghost-button" disabled={!needs.length}
        onClick={() => void act('guide', 'show')}>Toon fysieke hoeveelheden en rijnummers</button>
      <button type="button" className="ghost-button" disabled={!needs.length}
        onClick={() => void act('guide', 'share')}>Deel opnamegids op mijn telefoon</button>
    </div>
    <LocalObservationCaptureEditor needs={needs} stores={stores}
      needsAtClick={needsAtClick} delimiter={delimiter}
      context={captureKey.replace(/:\d{6,}$/, '')}
      onReview={onReview} onDraftChange={onDraftChange} />
    {current && <div className="offline-price-workbench__missing-copy">
      <label>Alleen dit geselecteerde weekmenu en {stores.join(' + ')} ·
        {current.kind === 'csv' ? ' blanco CSV' : ' bijbehorende opnamegids'}
        <textarea readOnly rows={9} spellCheck={false} value={current.text}
          onFocus={event => event.currentTarget.select()}
          style={{ display: 'block', width: '100%', maxWidth: '100%',
            minHeight: 160, boxSizing: 'border-box' }} />
      </label>
      <button type="button" className="ghost-button" onClick={() => setDisplayed(null)}>
        Sluit kopieertekst
      </button>
    </div>}
    {currentFeedback && <p role="status" aria-live="polite">{currentFeedback}</p>}
    <small>Na wijziging van weekmenu of winkelkeuze wordt een eerder getoonde
      kopie niet opnieuw gebruikt. Dit is geen bewijs van geobserveerde prijzen.</small>
  </section>
}
