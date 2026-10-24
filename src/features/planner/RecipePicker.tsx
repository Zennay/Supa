import { useEffect, useRef } from 'react'
import type { Recipe } from '../../domain/types'
import { FigmaImage } from '../../components/FigmaImage'
import { figmaAssets, figmaPlannerThumbs } from '../home/figmaAssets'
import './recipePicker.css'

/**
 * Bottom sheet opened by every Planner "+" / day / row tap. Nothing is added
 * to the week until the user explicitly picks a recipe here.
 */
export function RecipePicker({
  day,
  dayLabel,
  recipes,
  selectedId,
  active,
  onChoose,
  onRemove,
  onClose,
}: {
  day: string
  dayLabel: string
  recipes: Recipe[]
  selectedId: string | null
  active: boolean
  onChoose: (recipeId: string) => void
  onRemove: () => void
  onClose: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const node = dialog.current
    // Unmounting removes the modal; calling close() here would fire onClose.
    if (node && !node.open) node.showModal?.()
  }, [])

  return (
    <dialog ref={dialog} className="hifi-recipe-picker" aria-labelledby="hifi-recipe-picker-title"
      onClose={onClose} onCancel={onClose}>
      <header>
        <h3 id="hifi-recipe-picker-title">Kies een recept voor {dayLabel}</h3>
        <button type="button" className="hifi-recipe-picker-close" aria-label="Sluiten" onClick={onClose}>×</button>
      </header>
      <ul>
        {recipes.map(recipe => {
          const image = figmaPlannerThumbs[recipe.id]
          const chosen = active && recipe.id === selectedId
          return (
            <li key={recipe.id}>
              <button type="button" aria-pressed={chosen} onClick={() => onChoose(recipe.id)}>
                <span className="hifi-meal-thumb" aria-hidden="true">
                  {image ? <FigmaImage asset={image} alt="" /> : <span>{recipe.title.slice(0, 1)}</span>}
                </span>
                <span className="hifi-recipe-picker-text">
                  <strong>{recipe.title}</strong>
                  <small className="hifi-meal-time">
                    <FigmaImage asset={figmaAssets.imgVector4} alt="" />
                    {recipe.minutes} min
                  </small>
                </span>
              </button>
            </li>
          )
        })}
      </ul>
      {active && (
        <button type="button" className="hifi-recipe-picker-remove"
          aria-label={`${day} uit planning halen`} onClick={onRemove}>
          Haal {dayLabel} van de planning
        </button>
      )}
    </dialog>
  )
}
