import { useState } from 'react'
import { recipeShoppingChangeText, type RecipeShoppingChange } from './recipeShoppingChange.ts'
import { makeBlankPlannerCaptureCsv } from '../comparison/plannerPriceCaptureSheet.ts'
import { makePlannerCaptureGuide } from '../comparison/plannerPriceCaptureGuide.ts'

/** Source-free physical shopping preview; no SKU or stored retailer price. */
export function RecipeShoppingChangePanel({ preview, day }: {
  preview: RecipeShoppingChange
  day: string
}) {
  const [notice, setNotice] = useState('')
  const [showCopy, setShowCopy] = useState(false)
  if (preview.status !== 'ready') return <section className="recipe-reuse-preview-shopping"
    aria-label="Boodschappenwijziging niet beschikbaar">
    <h4>Nieuwe boodschappen nog niet betrouwbaar</h4>
    <p role="alert">{preview.reason}</p>
    <p>Controleer de hoeveelheden in Recepten. Er wordt geen product of prijs aangenomen.</p>
  </section>
  const added = preview.changes.filter(line => line.kind === 'added').length
  const removed = preview.changes.filter(line => line.kind === 'removed').length
  const updated = preview.changes.filter(line => line.kind === 'changed').length
  function getText() { return recipeShoppingChangeText(preview, day) }
  function download() {
    try {
      const url = URL.createObjectURL(new Blob([getText()], { type: 'text/plain;charset=utf-8' }))
      try {
        const link = document.createElement('a')
        link.href = url
        link.download = 'supa-ongeprijsde-receptwijziging.txt'
        document.body.append(link)
        try { link.click() } finally { link.remove() }
      } finally { window.setTimeout(() => URL.revokeObjectURL(url), 1000) }
      setNotice('De fysieke boodschappenwijziging is lokaal opgeslagen, zonder winkelprijzen.')
    } catch { setNotice('Kan het voorstel niet downloaden. Selecteer de kopieertekst hieronder.') ; setShowCopy(true) }
  }
  function downloadCapture(kind: 'csv' | 'guide') {
    try {
      // The two existing import formats share the SAME next-week physical
      // requirements and row order. No retailer product or price is invented.
      const stores = ['PLUS', 'DekaMarkt'] as const
      const output = kind === 'csv'
        ? makeBlankPlannerCaptureCsv(preview.nextNeeds, stores, ';')
        : makePlannerCaptureGuide(preview.nextNeeds, stores)
      const url = URL.createObjectURL(new Blob([output], {
        type: kind === 'csv' ? 'text/csv;charset=utf-8' : 'text/plain;charset=utf-8',
      }))
      try {
        const link = document.createElement('a')
        link.href = url
        link.download = kind === 'csv'
          ? 'supa-nieuw-weekmandje-leeg-plus-deka.csv'
          : 'supa-nieuw-weekmandje-opnamegids.txt'
        document.body.append(link)
        try { link.click() } finally { link.remove() }
      } finally { window.setTimeout(() => URL.revokeObjectURL(url), 1000) }
      setNotice(kind === 'csv' ? 'Leeg broninvulblad voor het voorgestelde nieuwe weekmandje opgeslagen.' :
        'Bijpassende opnamegids opgeslagen. Volg dezelfde rijvolgorde als de lege CSV.')
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : 'Kan het broninvulblad niet maken.')
    }
  }
  async function copy() {
    try {
      const output = getText()
      if (!navigator.clipboard?.writeText) throw Error('Klembord niet beschikbaar')
      await navigator.clipboard.writeText(output)
      setNotice('Fysieke boodschappenwijziging gekopieerd, zonder supermarktprijzen.')
    } catch {
      setNotice('Selecteer de ongeprijsde tekst hieronder om zelf te kopiëren.')
      setShowCopy(true)
    }
  }
  return <section className="recipe-reuse-preview-shopping"
    aria-label="Voorlopige fysieke boodschappenwijziging">
    <h4>Wat verandert er aan je hele weekmandje?</h4>
    <p><strong>{added} nieuw</strong> · <strong>{removed} vervalt</strong> ·
      {' '}<strong>{updated} andere hoeveelheid</strong> ·
      {' '}{preview.previousCount} → {preview.nextCount} fysieke ingrediënten.</p>
    <p>Ook andere dagen tellen mee. Dezelfde ingrediënten worden eerst samengevoegd;
      hoeveelheden zijn metrisch (g/ml) of hele stuks, zonder een prijs te schatten.</p>
    {preview.changes.length === 0 ? <p>De fysieke boodschappenbehoefte verandert niet.</p> :
      <ul className="recipe-reuse-preview-shopping__rows">
        {preview.changes.map(line => <li key={line.id}>
          <strong>{line.label}</strong>
          <span>{line.kind === 'added' ? 'Nieuw' :
            line.kind === 'removed' ? 'Vervalt' : 'Andere hoeveelheid'}</span>
          <span>{line.before ?? 'Niet nodig'} → {line.after ?? 'Niet nodig'}</span>
        </li>)}
      </ul>}
    <p><strong>Prijsverschil nog onbekend.</strong> Na je receptkeuze moeten
      de volledige fysieke mandjes en oorspronkelijke PLUS/Deka-SKU’s opnieuw
      worden gecontroleerd. Oude productmatches zijn geen geldige nieuwe vergelijking.</p>
    <div className="recipe-reuse-preview-shopping__actions">
      <button type="button" className="ghost-button" onClick={download}>Download wijziging (TXT)</button>
      <button type="button" className="ghost-button" onClick={() => void copy()}>Kopieer wijziging</button>
      <button type="button" className="ghost-button" onClick={() => downloadCapture('csv')}>
        Leeg PLUS/Deka-prijsinvulblad voor nieuw weekmandje (CSV)
      </button>
      <button type="button" className="ghost-button" onClick={() => downloadCapture('guide')}>
        Bijpassende fysieke opnamegids (TXT)
      </button>
    </div>
    <small>De invulbladen bevatten geen bronproducten of bedragen en horen alleen bij dit
      voorgestelde weekmenu. Kies het recept eerst en vul uitsluitend echt waargenomen
      brongegevens in voordat je de CSV via Vergelijk importeert.</small>
    {notice && <p role="status" aria-live="polite">{notice}</p>}
    {showCopy && <label>Zelf kopiëren (zonder prijzen)
      <textarea readOnly rows={Math.min(preview.changes.length + 7, 16)}
        value={getText()} onFocus={event => event.currentTarget.select()} />
    </label>}
  </section>
}
