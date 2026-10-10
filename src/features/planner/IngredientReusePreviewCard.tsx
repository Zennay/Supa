import type { RecipeReusePreview, ReuseTransition } from '../../domain/ingredientReusePreview.ts'
import './ingredient-reuse-preview.css'

function ChangeList({
  title,
  items,
}: {
  title: string
  items: ReuseTransition[]
}) {
  if (items.length === 0) return null

  return (
    <div className="ingredient-reuse-preview-group">
      <h4>{title}</h4>
      <ul>
        {items.map((item) => (
          <li key={item.ingredientId}>
            <strong>{item.label}</strong>
            <span>
              {item.afterDays.length > 0
                ? `Gedeeld op: ${item.afterDays.join(', ')}`
                : 'Niet meer gedeeld tussen gekozen maaltijden'}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Passive proposal only. The owning planner controls actual user choice. */
export function IngredientReusePreviewCard({
  preview,
}: {
  preview: RecipeReusePreview | null
}) {
  return (
    <section
      className="ingredient-reuse-preview"
      role="status"
      aria-live="polite"
      aria-label="Voorbeeld van gedeelde ingrediënten"
    >
      <h3>Als je dit gerecht kiest</h3>
      {preview === null ? (
        <p>Controleer eerst je planning om deze wijziging te bekijken.</p>
      ) : (
        <>
          <p>
            {preview.beforeSharedCount} gedeelde ingrediënten nu,{' '}
            {preview.afterSharedCount} met dit gerecht.
          </p>
          <ChangeList title="Nieuw gedeeld" items={preview.newlyShared} />
          <ChangeList title="Niet langer gedeeld" items={preview.noLongerShared} />
          <ChangeList title="Anders verdeeld" items={preview.changedShared} />
          {preview.newlyShared.length === 0 &&
            preview.noLongerShared.length === 0 &&
            preview.changedShared.length === 0 && (
              <p>Geen verandering in gedeelde ingrediënten.</p>
            )}
        </>
      )}
      <p className="ingredient-reuse-preview-note">
        Alleen een voorbeeld. Het gerecht wordt niet automatisch gewijzigd.
        Gedeelde ingrediënten bewijzen geen minder restjes, minder verpakkingen
        of besparing.
      </p>
    </section>
  )
}
