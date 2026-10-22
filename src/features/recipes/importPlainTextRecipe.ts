import { createManualRecipeDraft, type UserRecipeDraft } from '../../domain/userRecipeImport'
import { safeRecipeSourceUrl } from '../../domain/recipeSourceUrl.ts'

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
    .replace(/[?!]$/u, '').replace(/[()]/gu, '').trim()
  if (/^(?:ingredi[eë]nten|benodigdheden|wat heb je nodig|ingredients|what you need)(?:\s+(?:(?:voor|for|serves?)\s+)?\d{1,4}\s*(?:personen|porties|servings?|people)?)?$/u.test(heading)) return 'ingredients'
  if (/^(?:bereiding|bereidingswijze|instructies|stappen|werkwijze|zo maak je het|method|directions|instructions|steps|preparation|how to make it)(?:\s+(?:(?:ca\.?|approx\.?|about)\s*)?\d{1,4}\s*(?:min(?:uten)?|mins?|minutes?|uur|hours?))?$/u.test(heading)) return 'steps'
  return null
}

function headerNumber(line: string, kind: 'servings' | 'minutes'): number | null {
  const normalized = headingText(line)
  const match = kind === 'servings'
    ? /^(?:(?:aantal\s+)?porties|personen|voor|servings?|serves?|yield|for)\s*:?\s*(\d{1,4})(?:\s*(?:personen|porties|servings?|people))?$/iu.exec(normalized)
    : /^(?:tijd|bereidingstijd|totale\s+tijd|klaar\s+in|minuten|time|prep(?:aration)?\s+time|cook(?:ing)?\s+time|total\s+time|ready\s+in)\s*:?\s*(\d{1,4})(?:\s*(min(?:uten)?|mins?|minutes?|uur|hours?))?$/iu.exec(normalized)
  if (!match) return null
  const value = Number(match[1]) *
    (kind === 'minutes' && /^(?:uur|hours?)$/iu.test(match[2] ?? '') ? 60 : 1)
  return Number.isSafeInteger(value) && value > 0 &&
    (kind === 'minutes' ? value <= 1440 : value <= 1000) ? value : null
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
  let sourceUrl: string | null = null
  const sourceWarnings: string[] = []
  let servings: number | null = null
  let minutes: number | null = null
  let section: 'header' | 'ingredients' | 'steps' = 'header'
  const ingredients: string[] = []
  const steps: string[] = []

  for (const original of lines) {
    if (!original || /^---+$/u.test(original)) continue
    const sectionHeading = recognizedSection(original)
    if (sectionHeading) {
      const caption = headingText(original).replace(/[()]/gu, '').trim()
      const count = /\b(?:(?:voor|for|serves?)\s+)?(\d{1,4})\s*(?:personen|porties|servings?|people)?\s*$/iu.exec(caption)
      if (sectionHeading === 'ingredients' && count && servings === null) {
        const value = Number(count[1])
        if (value > 0 && value <= 1000) servings = value
      }
      const duration = /(?:(?:ca\.?|approx\.?|about)\s*)?(\d{1,4})\s*(min(?:uten)?|mins?|minutes?|uur|hours?)\s*$/iu.exec(caption)
      if (sectionHeading === 'steps' && duration && minutes === null) {
        const value = Number(duration[1]) * (/^(?:uur|hours?)$/iu.test(duration[2]) ? 60 : 1)
        if (value > 0 && value <= 1440) minutes = value
      }
      section = sectionHeading
      continue
    }

    if (section === 'header') {
      // Preserve a sanitized public attribution when a recipe is shared as
      // Markdown/plain text. This is metadata only: it never fetches the URL
      // or turns the recipe into a verified retailer product or price.
      const sourceLine = /^(?:bron(?:link|url)?|source(?:\s+url)?)\s*:\s*(.+)$/iu.exec(headingText(original))
      if (sourceLine) {
        if (sourceUrl !== null) throw new Error('Gebruik maximaal één Bron:-regel per recept.')
        const candidate = sourceLine[1].trim()
        const markdownLink = /^\[[^\]\r\n]{1,180}\]\((https:\/\/[^()\s]+)\)$/iu.exec(candidate)
        const autolink = /^<([^<>\s]+)>$/u.exec(candidate)
        const rawSource = markdownLink?.[1] ?? autolink?.[1] ?? candidate
        sourceUrl = safeRecipeSourceUrl(rawSource)
        const canonicalOriginal = new URL(rawSource)
        canonicalOriginal.hash = ''
        // URL canonicalization (for example adding a trailing slash) is not
        // itself a warning. Only a change beyond normal URL serialization
        // means sensitive query parameters were removed.
        if (sourceUrl !== canonicalOriginal.toString()) sourceWarnings.push(
          'De bronlink is veilig opgeschoond; controleer de openbare bronvermelding.')
        continue
      }
      const named = /^(?:recept|recipe|titel|title|naam)\s*:\s*(.+)$/iu.exec(headingText(original))
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
  const draft = createManualRecipeDraft({ title, servings, minutes, ingredients, steps })
  return {
    ...draft,
    source: sourceUrl ? 'url' : 'manual',
    sourceUrl,
    warnings: [...draft.warnings, ...sourceWarnings],
  }
}
