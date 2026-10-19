import { createManualRecipeDraft, type UserRecipeDraft } from '../../domain/userRecipeImport'

/** Offline fallback: never guesses quantities or exposes an external price source. */
export function importPlainTextRecipe(raw: string): UserRecipeDraft {
  if (!raw.trim() || new TextEncoder().encode(raw).length > 500_000 ||
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
    if (!original) continue
    const heading = original.replace(/:$/u, '').toLocaleLowerCase('nl')
    if (/^ingredi[eë]nten$/u.test(heading)) { section = 'ingredients'; continue }
    if (/^(?:bereiding|bereidingswijze|instructies|stappen)$/u.test(heading)) {
      section = 'steps'; continue
    }
    if (section === 'header') {
      const named = /^(?:recept|titel)\s*:\s*(.+)$/iu.exec(original)
      const count = /^(?:porties|personen)\s*:\s*(\d{1,4})$/iu.exec(original)
      const duration = /^(?:tijd|bereidingstijd|minuten)\s*:\s*(\d{1,4})(?:\s*(?:minuten|min))?$/iu.exec(original)
      if (named) title = named[1].trim()
      else if (count) servings = Number(count[1])
      else if (duration) minutes = Number(duration[1])
      else if (!title) title = original
      else throw new Error('Gebruik een titel, Porties: en Tijd:, gevolgd door Ingrediënten: en Bereiding:.')
      continue
    }
    const line = original.replace(/^(?:[-*•]\s+|\d{1,3}[.)]\s+)/u, '').trim()
    if (!line) continue
    if (section === 'ingredients') ingredients.push(line)
    else steps.push(line)
  }
  if (!title || !ingredients.length || ingredients.length > 80 || steps.length > 100) {
    throw new Error('Een titel en 1–80 regels onder Ingrediënten: zijn vereist.')
  }
  // Unknown servings, duration and units become review warnings from the
  // existing canonical recipe importer instead of inferred basket demand.
  return createManualRecipeDraft({ title, servings, minutes, ingredients, steps })
}
