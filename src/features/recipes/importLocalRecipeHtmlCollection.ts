import { importLocalJsonLdRecipeCollection } from './importLocalJsonLdRecipeCollection.ts'
import type { UserRecipeDraft } from '../../domain/userRecipeImport.ts'

/**
 * Read recipe JSON-LD from a locally saved HTML page WITHOUT mounting,
 * rendering, executing scripts, loading assets or making HTTP requests.
 * The page is not evidence of a supermarket price or a licensed feed.
 * Every Recipe candidate still goes through the existing review pipeline.
 */
type RecipeMicrodata = {
  name: string | null
  recipeIngredient: string[]
  recipeInstructions: string[]
  recipeYield: string | null
  totalTime: string | null
  prepTime: string | null
  cookTime: string | null
}

type HtmlFrame = {
  tag: string
  scope: RecipeMicrodata | null
  childScope: RecipeMicrodata | null
  props: string[]
  value: string | null
  text: string
}

const blockElements = new Set([
  'address', 'article', 'blockquote', 'br', 'dd', 'div', 'dl', 'dt',
  'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5',
  'h6', 'header', 'hr', 'li', 'main', 'nav', 'ol', 'p', 'pre', 'section',
  'table', 'tr', 'ul',
])
const voidElements = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link',
  'meta', 'param', 'source', 'track', 'wbr',
])
const namedHtmlEntities: Readonly<Record<string, string>> = {
  amp: '&', apos: "'", gt: '>', lt: '<', quot: '"', nbsp: ' ',
  copy: '©', reg: '®', ndash: '–', mdash: '—', hellip: '…',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
  frac12: '½', frac14: '¼', frac34: '¾', frac13: '⅓', frac23: '⅔',
  times: '×', deg: '°', eacute: 'é', Eacute: 'É', egrave: 'è',
  Egrave: 'È', aacute: 'á', Aacute: 'Á', agrave: 'à', Agrave: 'À',
  auml: 'ä', Auml: 'Ä', ouml: 'ö', Ouml: 'Ö', uuml: 'ü', Uuml: 'Ü',
  aring: 'å', Aring: 'Å', ccedil: 'ç', Ccedil: 'Ç', ntilde: 'ñ',
  Ntilde: 'Ñ', szlig: 'ß', euro: '€',
}

function decodeHtmlText(raw: string): string {
  return raw.replace(/&(#(?:x[0-9a-f]+|[0-9]+)|[a-z][a-z0-9]+);/giu, (entity, key: string) => {
    if (key[0] !== '#') return namedHtmlEntities[key] ?? entity
    const hexadecimal = key[1]?.toLowerCase() === 'x'
    const codePoint = Number.parseInt(key.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10)
    if (!Number.isInteger(codePoint) || codePoint <= 0 || codePoint > 0x10ffff ||
        (codePoint >= 0xd800 && codePoint <= 0xdfff)) return '�'
    return String.fromCodePoint(codePoint)
  })
}

function recipeType(itemtype: string): boolean {
  return itemtype.split(/\s+/u).some(value =>
    /(?:^|\/)recipe\/?$/iu.test(value.replace(/[?#].*$/u, '')))
}

function parseHtmlAttributes(raw: string): Map<string, string> {
  const result = new Map<string, string>()
  const pattern = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>]+)))?/giu
  let match: RegExpExecArray | null
  while ((match = pattern.exec(raw)) !== null) {
    const key = match[1].toLowerCase()
    if (!result.has(key)) result.set(key, match[2] ?? match[3] ?? match[4] ?? '')
  }
  return result
}

/**
 * Small, bounded schema.org microdata reader for saved HTML files.
 * It tokenizes inert source text only: no DOM, script execution, asset loads,
 * navigation, or network requests. Every extracted recipe still enters the
 * canonical JSON-LD and metric review pipeline below.
 */
function extractRecipeMicrodata(raw: string): Record<string, unknown>[] {
  const recipes: RecipeMicrodata[] = []
  const stack: HtmlFrame[] = []
  const tokens = /<!--[\s\S]*?-->|<script\b[^>]*>[\s\S]*?<\/script\s*>|<style\b[^>]*>[\s\S]*?<\/style\s*>|<![^>]*>|<\/?([a-z][\w:-]*)\b([^>]*)>/giu
  let cursor = 0
  let tokenCount = 0

  const appendText = (value: string) => {
    if (!value) return
    for (const frame of stack) frame.text += value
  }
  const finish = (frame: HtmlFrame) => {
    if (!frame.scope || !frame.props.length) return
    const source = frame.value ?? frame.text
    const value = decodeHtmlText(source).replace(/\s+/gu, ' ').trim()
    if (!value) return
    for (const prop of frame.props) {
      switch (prop) {
        case 'name':
          frame.scope.name ??= value
          break
        case 'recipeingredient':
          if (frame.scope.recipeIngredient.length < 200)
            frame.scope.recipeIngredient.push(value)
          break
        case 'recipeinstructions':
          if (frame.scope.recipeInstructions.length < 100)
            frame.scope.recipeInstructions.push(value)
          break
        case 'recipeyield':
          frame.scope.recipeYield ??= value
          break
        case 'totaltime':
          frame.scope.totalTime ??= value
          break
        case 'preptime':
          frame.scope.prepTime ??= value
          break
        case 'cooktime':
          frame.scope.cookTime ??= value
          break
      }
    }
  }

  let match: RegExpExecArray | null
  while ((match = tokens.exec(raw)) !== null) {
    if (++tokenCount > 20_000)
      throw new Error('Deze HTML bevat te veel onderdelen om veilig lokaal te verwerken.')
    appendText(raw.slice(cursor, match.index))
    cursor = tokens.lastIndex
    const tokenText = match[0]
    const tag = match[1]?.toLowerCase()
    if (!tag) {
      // Comments, declarations and whole script/style blocks are never read as
      // executable or recipe text.
      continue
    }
    if (tag === 'script' || tag === 'style') {
      // A malformed unclosed script/style must not turn its source into recipe
      // text. Skip to its close, or ignore the rest of the file.
      const closeStart = raw.toLowerCase().indexOf('</' + tag, cursor)
      if (closeStart < 0) {
        cursor = raw.length
        tokens.lastIndex = raw.length
      } else {
        const closeEnd = raw.indexOf('>', closeStart)
        cursor = closeEnd < 0 ? raw.length : closeEnd + 1
        tokens.lastIndex = cursor
      }
      continue
    }
    if (/^<\//u.test(tokenText)) {
      if (blockElements.has(tag)) appendText(' ')
      const index = stack.map(frame => frame.tag).lastIndexOf(tag)
      if (index < 0) continue
      while (stack.length > index) finish(stack.pop()!)
      continue
    }

    if (blockElements.has(tag)) appendText(' ')
    const attrs = parseHtmlAttributes(match[2] ?? '')
    const parentScope = stack.length ? stack[stack.length - 1].childScope : null
    const isRecipe = attrs.has('itemscope') && recipeType(attrs.get('itemtype') ?? '')
    let scope = parentScope
    if (isRecipe) {
      if (recipes.length >= 15)
        throw new Error('Deze HTML bevat meer dan 15 schema.org-recepten.')
      scope = {
        name: null, recipeIngredient: [], recipeInstructions: [],
        recipeYield: null, totalTime: null, prepTime: null, cookTime: null,
      }
      recipes.push(scope)
    }
    // Descendants of a nested non-Recipe item scope (for example author/Person)
    // belong to that item, not to the enclosing Recipe. Its own itemprop value
    // can still belong to the parent, e.g. recipeInstructions/HowToStep.
    const propertyScope = attrs.has('itemscope') && !isRecipe ? parentScope : scope
    const childScope = attrs.has('itemscope') && !isRecipe ? null : scope
    const props = (attrs.get('itemprop') ?? '')
      .split(/\s+/u).filter(Boolean).map(value => value.toLowerCase())
    const value = attrs.has('content') ? attrs.get('content')! :
      attrs.has('datetime') ? attrs.get('datetime')! :
      attrs.has('value') ? attrs.get('value')! : null
    const frame: HtmlFrame = {
      tag, scope: propertyScope, childScope, props, value, text: '',
    }
    if (voidElements.has(tag) || /\/\s*>$/u.test(tokenText)) finish(frame)
    else stack.push(frame)
  }
  appendText(raw.slice(cursor))
  while (stack.length) finish(stack.pop()!)

  return recipes.map(recipe => {
    const json: Record<string, unknown> = { '@type': 'Recipe' }
    if (recipe.name) json.name = recipe.name
    if (recipe.recipeIngredient.length) json.recipeIngredient = recipe.recipeIngredient
    if (recipe.recipeInstructions.length) json.recipeInstructions = recipe.recipeInstructions
    if (recipe.recipeYield) json.recipeYield = recipe.recipeYield
    if (recipe.totalTime) json.totalTime = recipe.totalTime
    if (recipe.prepTime) json.prepTime = recipe.prepTime
    if (recipe.cookTime) json.cookTime = recipe.cookTime
    return json
  })
}

export function importLocalRecipeHtmlCollection(raw: string): UserRecipeDraft[] {
  if (typeof raw !== 'string' || !raw.trim() ||
      new TextEncoder().encode(raw).length > 500_000) {
    throw new Error('Gebruik een lokaal HTML-receptbestand van maximaal 500 kB.')
  }
  const scripts: unknown[] = []
  // Match only script text; never instantiate a DOM, iframe or script element.
  // A genuine JSON-LD script cannot contain an unescaped </script> delimiter.
  const tags = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/giu
  let match: RegExpExecArray | null
  let seen = 0
  while ((match = tags.exec(raw)) !== null) {
    if (++seen > 80) throw new Error('Te veel scripts in deze HTML-bron.')
    const attrs = match[1]
    const type = /(?:^|\s)type\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/iu.exec(attrs)
    if (!type || (type[1] ?? type[2] ?? type[3]).trim().toLowerCase() !== 'application/ld+json') continue
    const body = match[2].trim()
    if (!body) continue
    try { scripts.push(JSON.parse(body.replace(/^\uFEFF/u, ''))) }
    catch {
      // An unrelated malformed metadata block is not a trustworthy recipe.
      // Refuse rather than silently importing a potentially partial page.
      throw new Error('De lokale HTML bevat ongeldige JSON-LD. Controleer het bronbestand.')
    }
  }
  if (!scripts.length) {
    const microdata = extractRecipeMicrodata(raw)
    if (!microdata.length) {
      throw new Error('Deze HTML bevat geen schema.org Recipe JSON-LD of Recipe-microdata. Gebruik anders de gewone tekstimport.')
    }
    return importLocalJsonLdRecipeCollection(JSON.stringify(microdata))
  }
  const normalized = JSON.stringify(scripts)
  if (new TextEncoder().encode(normalized).length > 500_000) {
    throw new Error('De ingesloten receptgegevens zijn groter dan 500 kB.')
  }
  return importLocalJsonLdRecipeCollection(normalized)
}
