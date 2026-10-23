import type { UserRecipeDraft } from '../../domain/userRecipeImport.ts'
import { importPlainTextRecipe } from './importPlainTextRecipe.ts'
import { reviewRecipe } from './recipeLibrary.ts'

type RecipeSection = 'ingredients' | 'steps'
type MarkdownTitle = { index: number; level: 1 | 2 }

const collectionHeadings = new Set([
  'recepten', 'recipes', 'mijn recepten', 'my recipes',
  'kookboek', 'receptenbundel', 'recipe collection',
])
const nonRecipeHeadings = new Set([
  'tips', 'notities', 'notes', 'opmerkingen', 'variaties',
  'voedingswaarde', 'bewaren', 'serveertip', 'serveertips',
  'nutrition', 'storage', 'variations',
])

function normalizedHeading(line: string): string {
  return line.replace(/^#{1,6}\s+/u, '')
    .replace(/\s+#+\s*$/u, '')
    .replace(/^\*\*(.+?)\*\*:?$/u, '$1')
    .replace(/:$/u, '')
    .trim()
    .toLocaleLowerCase('nl')
    .replace(/[?!]$/u, '')
    .replace(/[()]/gu, '')
    .trim()
}

function recipeSection(line: string): RecipeSection | null {
  const heading = normalizedHeading(line)
  if (/^(?:ingredi[eë]nten|benodigdheden|wat heb je nodig|ingredients|what you need)(?:\s+(?:(?:voor|for|serves?)\s+)?\d{1,4}\s*(?:personen|porties|servings?|people)?)?$/u.test(heading)) {
    return 'ingredients'
  }
  if (/^(?:bereiding|bereidingswijze|instructies|stappen|werkwijze|zo maak je het|method|directions|instructions|steps|preparation|how to make it)(?:\s+(?:(?:ca\.?|approx\.?|about)\s*)?\d{1,4}\s*(?:min(?:uten)?|mins?|minutes?|uur|hours?))?$/u.test(heading)) {
    return 'steps'
  }
  return null
}

function isCompleteRecipe(lines: readonly string[]): boolean {
  let ingredients = false
  let steps = false
  for (const line of lines) {
    const section = recipeSection(line)
    if (section === 'ingredients') ingredients = true
    if (section === 'steps') steps = true
  }
  return ingredients && steps
}

function markdownTitles(lines: readonly string[]): MarkdownTitle[] {
  const result: MarkdownTitle[] = []
  lines.forEach((line, index) => {
    const match = /^(#{1,2})\s+(.+?)\s*#*\s*$/u.exec(line.trim())
    if (!match || recipeSection(line)) return
    const title = normalizedHeading(line)
    if (collectionHeadings.has(title) || nonRecipeHeadings.has(title)) return
    result.push({ index, level: match[1].length as 1 | 2 })
  })
  return result
}

function titleStartsAtLevel(
  lines: readonly string[],
  headings: readonly MarkdownTitle[],
  level: 1 | 2,
): number[] {
  return headings.filter(title => title.level === level).filter(title => {
    const boundary = headings.find(next =>
      next.index > title.index && next.level <= level)
    const end = boundary?.index ?? lines.length
    return isCompleteRecipe(lines.slice(title.index, end))
  }).map(title => title.index)
}

function splitMarkdownCollection(raw: string): string[] {
  const lines = raw.split('\n')
  const headings = markdownTitles(lines)
  if (headings.length < 2) return [raw]

  const h1 = titleStartsAtLevel(lines, headings, 1)
  const starts = h1.length >= 2 ? h1 : titleStartsAtLevel(lines, headings, 2)
  if (starts.length < 2) return [raw]

  // Do not silently discard prose before the first recipe. A single generic
  // cookbook heading is safe to omit; any other preamble keeps the old
  // all-or-nothing single-document path, which will ask for clearer structure.
  const prefix = lines.slice(0, starts[0]).filter(line => line.trim())
  if (prefix.some(line => !/^#{1,2}\s+(?:recepten|recipes|mijn recepten|my recipes|kookboek|receptenbundel|recipe collection)\s*#*\s*$/iu.test(line.trim()))) {
    return [raw]
  }

  const parts = starts.map((start, index) =>
    lines.slice(start, starts[index + 1] ?? lines.length).join('\n').trim())
  return parts.length >= 2 && parts.every(part => isCompleteRecipe(part.split('\n')))
    ? parts
    : [raw]
}

/**
 * Offline collection of personally supplied Markdown recipes. Recipes may be
 * separated by a line containing only "---", or by complete Markdown recipe
 * headings. No URL fetching or retailer-price evidence is involved.
 */
export function importPlainTextRecipeCollection(raw: string): UserRecipeDraft[] {
  if (typeof raw !== 'string' || !raw.trim() ||
      new TextEncoder().encode(raw).length > 500_000) {
    throw new Error('Kies een lokaal receptenbestand van maximaal 500 kB.')
  }
  const normalized = raw.replace(/\r\n?/gu, '\n')
  const parts = /^---[ \t]*$/mu.test(normalized)
    ? normalized.split(/^---[ \t]*$/gmu)
    : splitMarkdownCollection(normalized)
  if (parts.length > 15 || parts.some(part => !part.trim())) {
    throw new Error('Importeer maximaal 15 volledige recepten. Laat geen lege recepten tussen de scheidingsregels.')
  }
  // Reject the entire collection when any section is malformed. This must
  // never partially save a book where a recipe's quantity was misread.
  return parts.map((part, index) => {
    try {
      return reviewRecipe(importPlainTextRecipe(part))
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : 'onleesbaar recept'
      throw new Error('Recept ' + (index + 1) + ': ' + reason)
    }
  })
}
