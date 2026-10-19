import { useState } from 'react'
import { normalizeIngredientLine } from '../../domain/userRecipeImport.ts'

type Warning = { index: number; original: string; reason: string }

function MetricCorrection({
  index, raw, reason, onCorrect,
}: { index: number; raw: string; reason: string;
  onCorrect: (index: number, replacement: string) => void }) {
  const original = normalizeIngredientLine(raw)
  const [amount, setAmount] = useState(original.amount === null ? '' : String(original.amount).replace('.', ','))
  const [unit, setUnit] = useState<'g' | 'kg' | 'ml' | 'l' | 'piece'>(
    original.unit === 'g' || original.unit === 'ml' || original.unit === 'piece' ? original.unit : 'g')
  const [label, setLabel] = useState(original.label || '')
  const [error, setError] = useState('')
  function correct() {
    setError('')
    const trimmed = amount.trim()
    if (!/^(?:\d{1,7})(?:[.,]\d{1,3})?$/.test(trimmed)) {
      setError('Vul een positief getal in met maximaal drie decimalen.')
      return
    }
    const value = Number(trimmed.replace(',', '.'))
    const factor = unit === 'kg' || unit === 'l' ? 1000 : 1
    if (!Number.isFinite(value) || value <= 0 || value * factor > 1_000_000 ||
        (unit === 'piece' && !Number.isSafeInteger(value))) {
      setError(unit === 'piece'
        ? 'Stuks moeten hele aantallen zijn (maximaal 1.000.000).'
        : 'De hoeveelheid mag omgerekend niet boven 1.000.000 gram of milliliter uitkomen.')
      return
    }
    const name = label.replace(/\s+/g, ' ').trim()
    if (!name || name.length > 160) {
      setError('Vul een ingrediëntnaam van maximaal 160 tekens in.')
      return
    }
    const line = String(value).replace('.', ',') + ' ' +
      (unit === 'piece' ? 'stuks' : unit) + ' ' + name
    const normalized = normalizeIngredientLine(line)
    if (normalized.amount === null || normalized.unit === null ||
        normalized.reviewReason || normalized.amount <= 0) {
      setError('Deze maat kan niet exact in hele stuks of metrische grammen/milliliters worden omgerekend.')
      return
    }
    if (line.length > 400) {
      setError('Deze ingrediëntregel is te lang.')
      return
    }
    onCorrect(index, line)
  }
  return <li className="recipe-metric-fix">
    <div><strong>Ingrediënt {index + 1}</strong> · {raw}
      <small role="note">{reason}</small></div>
    <div className="recipe-metric-fix__form">
      <label>Werkelijk gebruikte hoeveelheid
        <input type="text" inputMode="decimal" maxLength={12}
          value={amount} onChange={event => setAmount(event.target.value)}
          placeholder="Bijv. 250" required />
      </label>
      <label>Eenheid
        <select value={unit} onChange={event => setUnit(event.target.value as typeof unit)}>
          <option value="g">gram</option>
          <option value="kg">kilogram</option>
          <option value="ml">milliliter</option>
          <option value="l">liter</option>
          <option value="piece">stuks (heel)</option>
        </select>
      </label>
      <label>Ingrediënt
        <input type="text" maxLength={160} required
          value={label} onChange={event => setLabel(event.target.value)} />
      </label>
      <button type="button" onClick={correct}>Pas deze maat toe</button>
    </div>
    {error && <small role="alert" className="recipe-metric-fix__error">{error}</small>}
  </li>
}

/** Local, user-confirmed correction of imported measurements.
 * Rewrites only the chosen line. It does not invent a conversion, clear a
 * provenance warning or silently make the ingredient plannable. */
export function ImportedIngredientReview({
  sourceReviews, ingredients, onCorrect,
}: {
  sourceReviews: readonly Warning[]
  ingredients: string
  onCorrect: (index: number, replacement: string) => void
}) {
  const lines = ingredients.split('\n').map(line => line.trim()).filter(Boolean)
  const pending = sourceReviews.filter(review => {
    const current = lines[review.index]
    if (!current) return false
    const previous = normalizeIngredientLine(review.original)
    const edited = normalizeIngredientLine(current)
    return previous.amount === edited.amount && previous.unit === edited.unit
  })
  if (!pending.length) return null
  return <section className="recipe-import-metric-review"
    aria-label="Controleer onzekere geïmporteerde hoeveelheden">
    <h3>Maak geïmporteerde maten bruikbaar</h3>
    <p>{pending.length} ingrediëntregels vragen nog om jouw eigen controle.
      Vul uitsluitend hoeveelheden in die je werkelijk kent. Een ongewijzigde
      meetwaarde blijft ter controle gemarkeerd.</p>
    <ol>{pending.map(warning => <MetricCorrection
      key={warning.index + ':' + lines[warning.index]}
      index={warning.index} raw={lines[warning.index]}
      reason={warning.reason} onCorrect={onCorrect}
    />)}</ol>
    <small>Na elke wijziging kies je opnieuw 'Controleer recept'.
      Onbekende of ongewijzigde maten worden niet automatisch voor boodschappen berekend.</small>
  </section>
}
