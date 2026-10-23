import { importRecipeFromHtml, type UserRecipeDraft } from '../../domain/userRecipeImport.ts'
import { reviewRecipe } from './recipeLibrary.ts'

type JsonObject = Record<string, unknown>
function record(value: unknown): value is JsonObject {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
function isRecipe(value: JsonObject): boolean {
  const kinds = Array.isArray(value['@type']) ? value['@type'] : [value['@type']]
  return kinds.some(kind => typeof kind === 'string' &&
    /^(?:https?:\/\/schema\.org\/)?Recipe$/iu.test(kind))
}

/**
 * A user-supplied offline JSON-LD Recipe array or @graph. Each candidate
 * still passes through the existing single-Recipe importer and metric reviewer.
 * No remote URL is inferred, requested, or trusted as source-price evidence.
 */
export function importLocalJsonLdRecipeCollection(raw: string): UserRecipeDraft[] {
  if (typeof raw !== 'string' || !raw.trim() ||
      new TextEncoder().encode(raw).length > 500_000) {
    throw new Error('Gebruik maximaal 500 kB lokale JSON-LD-receptgegevens.')
  }
  let root: unknown
  try { root = JSON.parse(raw.replace(/^\uFEFF/u, '')) }
  catch { throw new Error('Dit bestand bevat geen geldige JSON-LD.') }

  const candidates: JsonObject[] = []
  const collect = (value: unknown, depth: number) => {
    if (depth > 5 || candidates.length > 15) return
    if (Array.isArray(value)) {
      if (value.length > 200) throw new Error('Te veel onderdelen in deze receptverzameling.')
      for (const item of value) collect(item, depth + 1)
    } else if (record(value)) {
      if (isRecipe(value)) {
        candidates.push(value)
      } else {
        if (value['@graph'] !== undefined) collect(value['@graph'], depth + 1)
        if (value.mainEntity !== undefined) collect(value.mainEntity, depth + 1)
      }
    }
  }
  collect(root, 0)
  if (!candidates.length || candidates.length > 15) {
    throw new Error('Selecteer 1–15 recepten met schema.org/Recipe in JSON-LD.')
  }
  return candidates.map((recipe, index) => {
    try {
      // Encode the script closing delimiter in JSON strings before reusing
      // the canonical safe offline HTML/schema.org reader.
      const json = JSON.stringify(recipe).replace(/</gu, '\\u003c')
      const html = '<script type="application/ld+json">' + json + '</script>'
      return reviewRecipe(importRecipeFromHtml(html))
    } catch (cause) {
      const why = cause instanceof Error ? cause.message : 'onleesbare bron'
      throw new Error('JSON-LD-recept ' + (index + 1) + ': ' + why)
    }
  })
}
