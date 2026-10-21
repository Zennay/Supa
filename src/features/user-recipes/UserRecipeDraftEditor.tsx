import { useState, type FormEvent } from 'react'
import {
  addEditorIngredient,
  displayMetricEditorAmount,
  canConfirmUserRecipeDraft,
  parseMetricEditorAmount,
  removeEditorIngredient,
  updateEditorIngredient,
  type EditorRecipeDraft,
  type EditorUnit,
} from './userRecipeDraftEditor.ts'

/**
 * Local review/edit form only. The onConfirm handler must be supplied by a
 * future authenticated persistence layer; this component performs no writes.
 */
export function UserRecipeDraftEditor({
  draft,
  onChange,
  onConfirm,
  onCancel,
}: {
  draft: EditorRecipeDraft
  onChange: (updated: EditorRecipeDraft) => void
  onConfirm: (reviewed: EditorRecipeDraft) => void
  onCancel: () => void
}) {
  const [rawAmounts, setRawAmounts] = useState<Record<string, string>>({})
  const canConfirm = canConfirmUserRecipeDraft(draft)

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (canConfirm) onConfirm(draft)
  }

  return (
    <section aria-labelledby="user-recipe-editor-title">
      <h2 id="user-recipe-editor-title">Mijn recept controleren</h2>
      <p>Pas de ingrediënten aan voordat je dit recept bevestigt. Alleen gram, milliliter en stuks zijn toegestaan.</p>
      {draft.sourceUrl && <p>Bronlink: <span>{draft.sourceUrl}</span></p>}
      <form onSubmit={submit} noValidate>
        <div>
          <label htmlFor="recipe-editor-name">Naam van het gerecht</label>
          <input id="recipe-editor-name" name="name" required maxLength={180} value={draft.title}
            onChange={(event) => onChange({ ...draft, title: event.target.value.slice(0, 180) })} />
        </div>
        <div>
          <label htmlFor="recipe-editor-servings">Aantal porties</label>
          <input id="recipe-editor-servings" name="servings" type="number" inputMode="numeric" required
            min="1" max="1000" step="1" value={draft.servings ?? ''}
            onChange={(event) => {
              const value = Number(event.target.value)
              onChange({ ...draft, servings: Number.isSafeInteger(value) && value > 0 && value <= 1000 ? value : null })
            }} />
        </div>
        <div>
          <label htmlFor="recipe-editor-minutes">Bereidingstijd (minuten, optioneel)</label>
          <input id="recipe-editor-minutes" type="number" min="1" max="1440" step="1"
            value={draft.minutes ?? ''}
            onChange={(event) => {
              const input = event.target.value
              const value = Number(input)
              onChange({ ...draft, minutes: !input ? null : Number.isSafeInteger(value) && value >= 1 && value <= 1440 ? value : null })
            }} />
        </div>
        <fieldset>
          <legend>Ingrediënten</legend>
          <ol>
            {draft.ingredients.map((ingredient, index) => (
              <li key={ingredient.clientId}>
                <label htmlFor={'recipe-ingredient-name-' + index}>Ingrediënt {index + 1}</label>
                <input id={'recipe-ingredient-name-' + index} maxLength={180} value={ingredient.label}
                  onChange={(event) => onChange(updateEditorIngredient(draft, index, { label: event.target.value }))} />
                <label htmlFor={'recipe-ingredient-amount-' + index}>Hoeveelheid</label>
                <input id={'recipe-ingredient-amount-' + index} type="text" inputMode="decimal"
                  value={displayMetricEditorAmount(rawAmounts[ingredient.clientId], ingredient.amount)}
                  aria-describedby={[
                    ingredient.reviewReason ? 'recipe-ingredient-warning-' + index : '',
                    ingredient.sourceReviewReason ? 'recipe-ingredient-source-warning-' + index : '',
                  ].filter(Boolean).join(' ') || undefined}
                  onChange={(event) => {
                    const value = event.target.value.slice(0, 24)
                    setRawAmounts((current) => ({ ...current, [ingredient.clientId]: value }))
                    onChange(updateEditorIngredient(draft, index, { amount: parseMetricEditorAmount(value) }))
                  }} />
                <label htmlFor={'recipe-ingredient-unit-' + index}>Eenheid</label>
                <select id={'recipe-ingredient-unit-' + index} value={ingredient.unit ?? ''}
                  onChange={(event) => onChange(updateEditorIngredient(draft, index, { unit: event.target.value as EditorUnit }))}>
                  <option value="">Kies eenheid</option>
                  <option value="g">gram (g)</option>
                  <option value="ml">milliliter (ml)</option>
                  <option value="piece">stuks</option>
                </select>
                {ingredient.reviewReason && (
                  <p id={'recipe-ingredient-warning-' + index} role="status">{ingredient.reviewReason}</p>
                )}
                {ingredient.sourceReviewReason && (
                  <p id={'recipe-ingredient-source-warning-' + index} role="status">
                    Bronwaarschuwing: {ingredient.sourceReviewReason}
                  </p>
                )}
                <button type="button" onClick={() => {
                  onChange(removeEditorIngredient(draft, index))
                  setRawAmounts((current) => { const updated = { ...current }; delete updated[ingredient.clientId]; return updated })
                }}>Verwijder ingrediënt {index + 1}</button>
              </li>
            ))}
          </ol>
          <button type="button" disabled={draft.ingredients.length >= 100} onClick={() => {
            onChange(addEditorIngredient(draft))
          }}>Ingrediënt toevoegen</button>
        </fieldset>
        <div>
          <label htmlFor="recipe-editor-steps">Bereidingsstappen, één per regel</label>
          <textarea id="recipe-editor-steps" rows={5} value={draft.steps.join('\n')}
            onChange={(event) => onChange({ ...draft, steps: event.target.value.split('\n').slice(0, 100).map((line) => line.slice(0, 1500)) })} />
        </div>
        {draft.warnings.length > 0 && (
          <div aria-live="polite"><h3>Controleer ook</h3>
            <p>{draft.warnings.join(' · ')}</p>
          </div>
        )}
        {!canConfirm && <p role="status">Vul een naam, porties en alle metrische ingrediënthoeveelheden in voordat je bevestigt.</p>}
        <p>Dit is alleen een bewerkbaar concept. Er is nog geen accountopslag of synchronisatie.</p>
        <button type="submit" disabled={!canConfirm}>Recept bevestigen voor verdere verwerking</button>
        <button type="button" onClick={onCancel}>Annuleren</button>
      </form>
    </section>
  )
}
