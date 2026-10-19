import { createManualRecipeDraft, type UserRecipeDraft } from '../../domain/userRecipeImport'

const maxBytes = 500_000
const headingPrefix = /^#{1,6}\s+/u
const markdownStrong = /^\*\*(.+?)\*\*:?$/u
const bulletPrefix = /^(?:[-*•]\s+|\d{1,3}[.)]\s+)/u
const checkboxPrefix = /^(?:[-*•]\s*)?\[[ xX]\]\s+/u

function headingText(line: string): string {
  return line.replace(headingPrefix, '').replace(markdownStrong, '$1')
    .replace(/:$/u, '').trim()
}

function recognizedSection(line: string): 'ingredients' | 'steps' | null {
  const heading = headingText(line).toLocaleLowerCase('nl')
  if (/^(?:ingredi[eë]nten|benodigdheden|wat heb je nodig)(?:\s+(?:voor\s+)?\d{1,4}\s*(?:personen|porties))?$/u.test(heading)) return 'ingredients'
  if (/^(?:bereiding|bereidingswijze|instructies|stappen|werkwijze|zo maak je het)(?:\s*\(?(?:ca\.?\s*)?\d{1,4}\s*(?:min(?:uten)?|uur)\)?)?$/u.test(heading)) return 'steps'
  return null
}

function headerNumber(line: string, kind: 'servings' | 'minutes'): number | null {
  const normalized = headingText(line)
  const match = kind === 'servings'
    ? /^(?:(?:aantal\s+)?porties|personen|voor)\s*:?\s*(\d{1,4})(?:\s*(?:personen|porties))?$/iu.exec(normalized)
    : /^(?:tijd|bereidingstijd|totale\s+tijd|klaar\s+in|minuten)\s*:?\s*(\d{1,4})(?:\s*(?:minuten|min))?$/iu.exec(normalized)
  if (!match) return null
  const value = Number(match[1])
  return Number.isSafeInteger(value) && value > 0 ? value : null
}

/**
 * Import locally pasted Dutch recipe/Markdown text, without fetching pages,
 * guessing quantities or promoting an uncertain ingredient into a priced basket.
 * Every ingredient goes through the canonical metric reviewer before planning.
 */
export function importPlainTextRecipe(raw: string): UserRecipeDraft {
  if (!raw.trim() || new TextEncoder().encode(raw).length > maxBytes ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(raw)) {
    throw new Error('Plak maximaal 500 kB aan recepttekst zonder verborgen stuurtekens.')
  }
  const lines = raw.replace(/\r\n?/gu, '\n').split('\n').map(line => line.trim())
  if (lines.length > 400 || lines.some(line => line.length > 5000)) {
    throw new Error('Te veel of te lange regels. Controleer de invoer handmatig.')
  }

  let title = ''
  let servings: number | null = null
  let minutes: number | null = null
  let section: 'header' | 'ingredients' | 'steps' = 'header'
  const ingredients: string[] = []
  const steps: string[] = []

  for (const original of lines) {
    if (!original || /^---+$/u.test(original)) continue
    const sectionHeading = recognizedSection(original)
    if (sectionHeading) {
      const count = /\b(?:voor\s+)?(\d{1,4})\s*(?:personen|porties)\s*$/iu.exec(headingText(original))
      if (sectionHeading === 'ingredients' && count && servings === null) servings = Number(count[1])
      const duration = /(?:ca\.?\s*)?(\d{1,4})\s*(min(?:uten)?|uur)\)?$/iu.exec(headingText(original))
      if (sectionHeading === 'steps' && duration && minutes === null) {
        const value = Number(duration[1]) * (duration[2] === 'uur' ? 60 : 1)
        if (value > 0 && value <= 1440) minutes = value
      }
      section = sectionHeading
      continue
    }

    if (section === 'header') {
      const named = /^(?:recept|titel|naam)\s*:\s*(.+)$/iu.exec(original)
      const count = headerNumber(original, 'servings')
      const duration = headerNumber(original, 'minutes')
      if (named) title = headingText(named[1])
      else if (count !== null) servings = count
      else if (duration !== null) minutes = duration
      else if (!title) title = headingText(original)
      else throw new Error('Gebruik een titel, optioneel Porties: en Tijd:, gevolgd door Ingrediënten: en Bereiding:.')
      continue
    }

    // Keep styled ingredients and instructions intact: unrecognised food
    // becomes an explicit human-review warning, never a silently omitted item.
    const line = headingText(original).replace(checkboxPrefix, '').replace(bulletPrefix, '').trim()
    if (!line) continue
    if (section === 'ingredients') ingredients.push(line)
    else steps.push(line)
  }
  if (!title || !ingredients.length || ingredients.length > 80 || steps.length > 100) {
    throw new Error('Een titel en 1–80 regels onder Ingrediënten: zijn vereist.')
  }
  return createManualRecipeDraft({ title, servings, minutes, ingredients, steps })
}
