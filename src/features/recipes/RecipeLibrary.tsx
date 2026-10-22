import { useEffect, useRef, useState, type FormEvent } from 'react'
import { FigmaImage } from '../../components/FigmaImage'
import { figmaAssets as a } from '../home/figmaAssets'
import { createManualRecipeDraft, importRecipeFromHtml, type UserRecipeDraft } from '../../domain/userRecipeImport'
import { safeRecipeSourceUrl } from '../../domain/recipeSourceUrl'
import { RECIPE_LIBRARY_KEY, readRecipeLibrary, saveRecipeLibrary, reviewRecipe, retainUnresolvedRecipeReview, sourceOnlyRecipeWarnings, acknowledgeRecipeSourceWarnings, type LibraryState, type SavedRecipe } from './recipeLibrary.ts'
import { importRecipeLink, RecipeLinkImportUnavailableError } from './importRecipeLink'
import { importRecipeLinksCollection } from './importRecipeLinksCollection'
import { importPlainTextRecipe } from './importPlainTextRecipe'
import { importPlainTextRecipeCollection } from './importPlainTextRecipeCollection'
import { importLocalJsonLdRecipeCollection } from './importLocalJsonLdRecipeCollection'
import { importLocalRecipeHtmlCollection } from './importLocalRecipeHtmlCollection'
import { ownRecipeAsMarkdown } from './ownRecipeMarkdown'
import { prepareRecipeBackupImport, serializeRecipeBackup, type RecipeBackupPreview, RECIPE_BACKUP_MAX_BYTES } from './recipeBackup'
import { curatedFigmaRecipes } from './curatedFigmaRecipes'
import { m2InitialPlan } from '../../data/m2Fixture'
import { ownRecipeShoppingChecklist, formatOwnRecipeChecklist, personalRecipeShoppingNoteLabels, readableRecipeShoppingAmount } from './recipeShoppingChecklist'
import { ImportedRecipeGroceriesPanel } from './ImportedRecipeGroceriesPanel'
import { exportOwnRecipeChecklistCsv } from './recipeShoppingCsv'
import { toPlannerRecipe } from './plannerRecipes.ts'
import { scaleOwnRecipe, ownRecipeId } from './scaleOwnRecipe.ts'
import { assertRecipeNotUsedByPlanner } from './recipeDeletionGuard.ts'
import { exportOwnRecipePrivateWeek } from './exportOwnRecipePrivateWeek'
import { RECIPE_FAVORITES_KEY, readRecipeFavorites, toggleRecipeFavorite, type RecipeFavorites } from './recipeFavorites'
import './recipes.css'

type RecipeSearchable = {
  title: string
  ingredients: readonly { label: string; original?: string }[]
  tags?: readonly string[]
}
function searchableRecipeText(input: string): string {
  return input.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase('nl').trim()
}
/** Discoverability only: this does not substitute food, change ingredients or
 * make any recipe source, SKU or price evidence more trustworthy. */
function recipeIngredientHit(recipe: RecipeSearchable, query: string): string | null {
  if (!query) return null
  const found = recipe.ingredients.find(item =>
    searchableRecipeText(item.label).includes(query) ||
    (item.original && searchableRecipeText(item.original).includes(query)))
  return found?.label ?? null
}
function keyed<T>(items: readonly T[], identity: (item: T) => string) {
  const occurrences = new Map<string, number>()
  return items.map(value => {
    const label = identity(value); const count = occurrences.get(label) ?? 0
    occurrences.set(label, count + 1)
    return { key: JSON.stringify([label, count]), value }
  })
}

const figmaRecipeImages: Record<string, string> = {
  'supa-thai': a.recipeThai,
  'supa-quesadillas': a.recipeQuesadillas,
  'supa-fried-rice': a.imgRecepten,
  'supa-bao': a.imgRecepten1,
  'supa-katsu': a.imgRecepten2,
  'supa-veg-pasta': a.recipePasta,
}
const examples = curatedFigmaRecipes.map(recipe => ({
  ...recipe, image: figmaRecipeImages[recipe.id] ?? null,
  sourceLabel: 'SUPA-recept',
}))

const blank = { title: '', servings: '2', minutes: '20', ingredients: '', steps: '' }
/** Read local recipe/link files without guessing legacy encodings. UTF-16 is
 * accepted only when a .txt/.md workflow declares its byte order with a BOM;
 * HTML and JSON-LD remain strict UTF-8 to avoid silently reinterpreting data. */
function decodeLocalRecipeCollectionFile(buffer: ArrayBuffer, format: 'plain' | 'jsonld' | 'html' | 'links'): string {
  const bytes = new Uint8Array(buffer)
  const allowBomUtf16 = format === 'plain' || format === 'links'
  const encoding = allowBomUtf16 && bytes.length >= 2
    ? bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le'
      : bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be' : 'utf-8'
    : 'utf-8'
  try {
    return new TextDecoder(encoding, { fatal: true }).decode(bytes).replace(/^\uFEFF/u, '').trim()
  } catch {
    throw new Error('Bestand bevat geen geldige tekstcodering. Gebruik UTF-8; voor .txt/.md-recept- en linklijsten mag ook UTF-16 met BOM.')
  }
}

function initialLibrary(): LibraryState {
  if (typeof window === 'undefined') return { recipes: [], raw: null, error: null }
  try { return readRecipeLibrary(window.localStorage) }
  catch { return { recipes: [], raw: null, error: 'Browseropslag is niet beschikbaar. Je kunt recepten bekijken, maar nog niet bewaren.' } }
}

function initialFavorites(): RecipeFavorites {
  if (typeof window === 'undefined') return { ids: [], raw: null, error: null }
  try { return readRecipeFavorites(window.localStorage) }
  catch { return { ids: [], raw: null, error: 'Favorieten kunnen niet worden geopend in deze browser.' } }
}

export function RecipeLibrary({ onBack, onAddRecipeGroceries }: {
  onBack: () => void
  onAddRecipeGroceries?: (labels: readonly string[]) => string | null
}) {
  const [library, setLibrary] = useState(initialLibrary)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'all' | 'own' | 'favorites'>('all')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [sort, setSort] = useState(false)
  const [favoriteState, setFavoriteState] = useState(initialFavorites)
  const favoriteRef = useRef(favoriteState)
  const favorites = favoriteState.ids
  const [mode, setMode] = useState<'manual' | 'url' | 'paste' | 'plain'>('manual')
  const [form, setForm] = useState(blank)
  const [url, setUrl] = useState('')
  // Preview only the public attribution that will leave this browser.
  // The raw pasted link is never used by the network import.
  const publicRecipeLink = (() => {
    if (!url.trim()) return null
    try { return safeRecipeSourceUrl(url.trim()) }
    catch { return null }
  })()
  const [pastedSource, setPastedSource] = useState('')
  const [source, setSource] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [recentlyDeletedRecipe, setRecentlyDeletedRecipe] = useState<{
    recipe: SavedRecipe; afterRaw: string
  } | null>(null)
  const [selected, setSelected] = useState<SavedRecipe | typeof examples[number] | null>(null)
  const [preview, setPreview] = useState<UserRecipeDraft | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [isVariant, setIsVariant] = useState(false)
  const [shoppingPortions, setShoppingPortions] = useState('2')
  const [pendingRecipeRemoval, setPendingRecipeRemoval] = useState<{
    id: string; snapshot: string
  } | null>(null)
  const [portionVariantPreview, setPortionVariantPreview] = useState<{
    sourceId: string; sourceSnapshot: string; portions: number; draft: UserRecipeDraft
  } | null>(null)
  const [plannerDay, setPlannerDay] = useState(m2InitialPlan[0].day)
  const [shoppingChecks, setShoppingChecks] = useState<Record<string, boolean>>({})
  const [shoppingOpenOnly, setShoppingOpenOnly] = useState(false)
  const [showShoppingCopy, setShowShoppingCopy] = useState(false)
  const [privateWeekMessage, setPrivateWeekMessage] = useState('')
  const [recipeFileMessage, setRecipeFileMessage] = useState('')
  const shoppingCopy = useRef<HTMLTextAreaElement>(null)
  const [collectionText, setCollectionText] = useState('')
  const [collectionFormat, setCollectionFormat] = useState<'plain' | 'jsonld' | 'html' | 'links'>('plain')
  const [collectionExportBatch, setCollectionExportBatch] = useState(0)
  const [collectionSelected, setCollectionSelected] = useState<number[]>([])
  const [lastImportedIds, setLastImportedIds] = useState<string[]>([])
  const [groceryOpen, setGroceryOpen] = useState(false)
  const [lastBulkImport, setLastBulkImport] = useState<{
    afterRaw: string; ids: string[]; kind: 'import' | 'variants'
  } | null>(null)
  const [confirmBulkUndo, setConfirmBulkUndo] = useState(false)
  const [collectionPreview, setCollectionPreview] = useState<{
    source: string; format: 'plain' | 'jsonld' | 'html' | 'links'; libraryRaw: string | null; recipes: UserRecipeDraft[]; alreadyPresent: number
  } | null>(null)
  const [collectionError, setCollectionError] = useState('')
  const [collectionMessage, setCollectionMessage] = useState('')
  const [collectionBusy, setCollectionBusy] = useState(false)
  const collectionAbort = useRef<AbortController | null>(null)
  const collectionReadVersion = useRef(0)
  const [backupPreview, setBackupPreview] = useState<RecipeBackupPreview | null>(null)
  const [backupBusy, setBackupBusy] = useState(false)
  const [backupError, setBackupError] = useState('')
  const backupReadVersion = useRef(0)
  const pasteReadVersion = useRef(0)
  const [pasteFileMessage, setPasteFileMessage] = useState('')
  const editor = useRef<HTMLDialogElement>(null)
  const detail = useRef<HTMLDialogElement>(null)
  const request = useRef<AbortController | null>(null)
  const saving = useRef(false)
  const editingBaseline = useRef<{ id: string; raw: string } | null>(null)
  const importedReviewBaseline = useRef<UserRecipeDraft | null>(null)
  useEffect(() => () => { request.current?.abort(); collectionAbort.current?.abort() }, [])
  useEffect(() => {
    const refresh = (event: StorageEvent) => {
      if (event.key !== RECIPE_FAVORITES_KEY && event.key !== null) return
      const next = initialFavorites()
      favoriteRef.current = next
      setFavoriteState(next)
      if (next.error) setMessage(next.error)
    }
    window.addEventListener('storage', refresh)
    return () => window.removeEventListener('storage', refresh)
  }, [])
  useEffect(() => {
    const refreshOwnRecipes = (event: StorageEvent) => {
      if (event.key !== RECIPE_LIBRARY_KEY && event.key !== null) return
      if (event.storageArea && event.storageArea !== window.localStorage) return
      const next = initialLibrary()
      backupReadVersion.current += 1
      setBackupBusy(false)
      setBackupPreview(null)
      setCollectionPreview(null)
      setLastImportedIds([])
      setLastBulkImport(null); setConfirmBulkUndo(false)
      setLibrary(next)
      const editing = editingBaseline.current
      if (editing && JSON.stringify(next.recipes.find(recipe => recipe.id === editing.id) ?? null) !== editing.raw) {
        setPreview(null)
        setError('Dit recept is in een ander tabblad gewijzigd of verwijderd. Open de actuele versie opnieuw voordat je opslaat; je huidige invoer blijft zichtbaar.')
      }
      setSelected(previous => {
        if (!previous || !('savedAt' in previous)) return previous
        const current = next.recipes.find(recipe => recipe.id === previous.id)
        if (!current) {
          queueMicrotask(() => detail.current?.close())
          return null
        }
        return JSON.stringify(current) === JSON.stringify(previous) ? previous : current
      })
      setMessage(next.error ??
        'Je eigen recepten zijn bijgewerkt vanuit een ander tabblad. De Planner leest de actuele recepten.')
    }
    window.addEventListener('storage', refreshOwnRecipes)
    return () => window.removeEventListener('storage', refreshOwnRecipes)
  }, [])
  const searchTerm = searchableRecipeText(query)
  const matches = (r: RecipeSearchable & { id: string }) =>
    (filter !== 'favorites' || favorites.includes(r.id)) &&
    (!searchTerm || searchableRecipeText(r.title).includes(searchTerm) ||
      r.tags?.some(tag => searchableRecipeText(tag).includes(searchTerm)) ||
      recipeIngredientHit(r, searchTerm) !== null)
  const demo = filter === 'own' ? [] : examples.filter(matches)
  const own = library.recipes.filter(matches)
  const markdownExportable = library.recipes.filter(recipe => {
    try { ownRecipeAsMarkdown(recipe); return true } catch { return false }
  })
  if (sort) { demo.sort((x, y) => x.title.localeCompare(y.title, 'nl')); own.sort((x, y) => x.title.localeCompare(y.title, 'nl')) }
  const ownShopping = selected && 'savedAt' in selected ? ownRecipeShoppingChecklist(selected, Number(shoppingPortions)) : null
  const selectedRecipeShoppingText = ownShopping ? formatOwnRecipeChecklist(ownShopping, shoppingChecks) : ''
  const shoppingCompleted = ownShopping?.lines.filter(line => shoppingChecks[line.key]).length ?? 0
  const shoppingVisible = ownShopping?.lines.filter(line => !shoppingOpenOnly || !shoppingChecks[line.key]) ?? []
  const favorite = (id: string) => {
    try {
      const next = toggleRecipeFavorite(window.localStorage, favoriteRef.current, id)
      favoriteRef.current = next
      setFavoriteState(next)
      setMessage('Favorieten zijn uitsluitend op dit apparaat bewaard.')
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'Favorieten konden niet worden opgeslagen.')
    }
  }

  function downloadOwnRecipes() {
    setBackupError('')
    try {
      if (library.error) throw new Error(library.error)
      if (!library.recipes.length) throw new Error('Je hebt nog geen eigen recepten om te exporteren.')
      const output = serializeRecipeBackup(library.recipes)
      const link = document.createElement('a')
      const uri = URL.createObjectURL(new Blob([output], { type: 'application/json;charset=utf-8' }))
      try {
        link.href = uri
        link.download = 'supa-mijn-recepten.json'
        document.body.append(link)
        link.click()
        link.remove()
        setMessage('Eigen recepten lokaal opgeslagen als JSON-backup. Je hebt zelf de controle over dit bestand.')
      } finally { window.setTimeout(() => URL.revokeObjectURL(uri), 1000) }
    } catch (cause) {
      setBackupError(cause instanceof Error ? cause.message : 'Downloaden is niet gelukt.')
    }
  }
  function downloadSingleOwnRecipe(recipe: SavedRecipe) {
    setRecipeFileMessage('')
    try {
      if (library.error) throw new Error(library.error)
      if (!library.recipes.some(item => item.id === recipe.id && item === recipe)) {
        throw new Error('Dit recept is inmiddels gewijzigd. Open de actuele versie opnieuw.')
      }
      // Existing portable backup envelope, not an unvalidated JSON draft.
      const output = serializeRecipeBackup([recipe])
      const url = URL.createObjectURL(new Blob([output], { type: 'application/json;charset=utf-8' }))
      const link = document.createElement('a')
      try {
        link.href = url
        link.download = 'supa-eigen-recept.json'
        document.body.append(link)
        link.click()
        link.remove()
        setRecipeFileMessage('Dit ene eigen recept is als privé JSON-back-up opgeslagen. Importeer het via Mijn recepten.')
      } finally { window.setTimeout(() => URL.revokeObjectURL(url), 1000) }
    } catch (cause) {
      setRecipeFileMessage(cause instanceof Error ? cause.message : 'Kon dit recept niet exporteren.')
    }
  }
  function currentMarkdown(recipe: SavedRecipe): string {
    const current = library.recipes.find(item => item.id === recipe.id)
    if (!current || current !== recipe || library.error) {
      throw new Error('Dit recept is gewijzigd. Open de actuele versie opnieuw om het te delen.')
    }
    return ownRecipeAsMarkdown(current)
  }
  function downloadOwnRecipeMarkdown(recipe: SavedRecipe) {
    setRecipeFileMessage('')
    try {
      const markdown = currentMarkdown(recipe)
      const uri = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown;charset=utf-8' }))
      try {
        const link = document.createElement('a')
        link.href = uri
        link.download = 'supa-eigen-recept.md'
        document.body.append(link)
        try { link.click() } finally { link.remove() }
        setRecipeFileMessage('Recept als leesbare privé-Markdown opgeslagen. Je kunt dit opnieuw importeren via gewone recepttekst; er zijn geen winkelprijzen toegevoegd.')
      } finally { window.setTimeout(() => URL.revokeObjectURL(uri), 1000) }
    } catch (cause) {
      setRecipeFileMessage(cause instanceof Error ? cause.message : 'Recept exporteren mislukt.')
    }
  }
  async function copyOwnRecipeMarkdown(recipe: SavedRecipe) {
    setRecipeFileMessage('')
    try {
      const markdown = currentMarkdown(recipe)
      if (!navigator.clipboard?.writeText) throw new Error('Klembord is niet beschikbaar.')
      await navigator.clipboard.writeText(markdown)
      setRecipeFileMessage('Recepttekst gekopieerd, zonder prijs- of besparingsclaims.')
    } catch (cause) {
      setRecipeFileMessage((cause instanceof Error ? cause.message : 'Kopiëren mislukt.') +
        ' Gebruik de Markdown-download als alternatief.')
    }
  }
  function previewPortionVariant(recipe: SavedRecipe) {
    setPortionVariantPreview(null)
    setRecipeFileMessage('')
    try {
      if (library.error || !library.recipes.some(item => item === recipe)) {
        throw new Error('Dit recept is inmiddels veranderd. Open de actuele versie opnieuw.')
      }
      const portions = Number(shoppingPortions)
      const draft = scaleOwnRecipe(recipe, portions)
      setPortionVariantPreview({
        sourceId: recipe.id, sourceSnapshot: JSON.stringify(recipe), portions, draft,
      })
      setRecipeFileMessage('Bekijk de hoeveelheden. Er is nog niets opgeslagen.')
    } catch (cause) {
      setRecipeFileMessage(cause instanceof Error ? cause.message : 'Kan deze porties niet veilig omrekenen.')
    }
  }
  function savePortionVariant(recipe: SavedRecipe) {
    setRecipeFileMessage('')
    try {
      if (library.error || !library.recipes.some(item => item === recipe)) {
        throw new Error('Het recept is tussentijds gewijzigd. Open de actuele versie opnieuw.')
      }
      const portions = Number(shoppingPortions)
      if (!portionVariantPreview || portionVariantPreview.sourceId !== recipe.id ||
          portionVariantPreview.sourceSnapshot !== JSON.stringify(recipe) ||
          portionVariantPreview.portions !== portions) {
        throw new Error('Deze portiepreview is verlopen. Controleer de hoeveelheden opnieuw.')
      }
      const draft = scaleOwnRecipe(recipe, portions)
      if (JSON.stringify(draft) !== JSON.stringify(portionVariantPreview.draft)) {
        throw new Error('De hoeveelheden zijn gewijzigd. Bekijk de preview opnieuw.')
      }
      const variant: SavedRecipe = {
        ...reviewRecipe(draft), id: ownRecipeId(), savedAt: new Date().toISOString(),
      }
      if (library.recipes.some(item => item.id === variant.id)) {
        throw new Error('Er is een dubbele lokale recept-ID ontstaan. Probeer opnieuw.')
      }
      const next = saveRecipeLibrary(window.localStorage, library, [variant, ...library.recipes])
      const saved = next.recipes.find(item => item.id === variant.id)
      if (!saved) throw new Error('De receptvariant is niet beschikbaar.')
      setLibrary(next)
      setPortionVariantPreview(null)
      setSelected(saved)
      setFilter('own')
      setQuery('')
      window.dispatchEvent(new Event('supa-recipes-changed'))
      setRecipeFileMessage('Nieuwe ongeprijsde receptvariant voor ' + portions +
        ' porties bewaard. Gram/ml zijn conservatief naar boven afgerond op 0,001. ' +
        'Kies nu hieronder een Planner-dag; de winkelprijzen en matches moet je opnieuw controleren.')
    } catch (cause) {
      setRecipeFileMessage(cause instanceof Error ? cause.message : 'Variant maken mislukt. Het origineel is ongewijzigd.')
    }
  }
  /** Save an explicitly reviewed set of metric portion variants in one CAS
   * write. Originals and unrelated recipes remain byte-identical; a failure
   * cannot leave half the requested variants in the user's library. */
  function saveBatchPortionVariants(changes: readonly {
    recipeId: string; sourceSnapshot: string; portions: number; draftSnapshot: string
  }[]): SavedRecipe[] {
    if (library.error) throw new Error(library.error)
    if (!changes.length || changes.length > 15 ||
        new Set(changes.map(item => item.recipeId)).size !== changes.length ||
        library.recipes.length + changes.length > 100) {
      throw new Error('Kies 1–15 verschillende recepten; de bibliotheek ondersteunt maximaal 100 eigen recepten.')
    }
    const savedAt = new Date().toISOString()
    const additions = changes.map(change => {
      const source = library.recipes.find(recipe => recipe.id === change.recipeId)
      if (!source || JSON.stringify(source) !== change.sourceSnapshot) {
        throw new Error('Een bronrecept is gewijzigd. Controleer de nieuwe hoeveelheden opnieuw.')
      }
      const draft = scaleOwnRecipe(source, change.portions)
      if (JSON.stringify(draft) !== change.draftSnapshot) {
        throw new Error('De porties komen niet meer overeen met het beoordeelde voorbeeld.')
      }
      return { ...reviewRecipe(draft), id: ownRecipeId(), savedAt } satisfies SavedRecipe
    })
    const ids = additions.map(recipe => recipe.id)
    if (new Set(ids).size !== ids.length ||
        ids.some(id => library.recipes.some(recipe => recipe.id === id))) {
      throw new Error('Dubbele lokale recept-ID. Probeer opnieuw.')
    }
    const next = saveRecipeLibrary(window.localStorage, library,
      [...additions, ...library.recipes])
    setLibrary(next)
    if (next.raw !== null) setLastBulkImport({
      afterRaw: next.raw, ids: additions.map(recipe => recipe.id), kind: 'variants',
    })
    setConfirmBulkUndo(false)
    setCollectionError('')
    setCollectionMessage(additions.length + ' nieuwe portievarianten gezamenlijk bewaard. ' +
      'De originele recepten en winkelprijzen zijn ongewijzigd. ' +
      'Je kunt de laatste variantenbatch terugdraaien zolang ze niet zijn ingepland.')
    window.dispatchEvent(new Event('supa-recipes-changed'))
    return additions.map(recipe => {
      const saved = next.recipes.find(item => item.id === recipe.id)
      if (!saved) throw new Error('Een bewaarde portievariant is niet beschikbaar.')
      return saved
    })
  }
  function requestRecipeRemoval(recipe: SavedRecipe) {
    setPendingRecipeRemoval(null)
    setRecipeFileMessage('')
    try {
      if (library.error || !library.recipes.some(item => item === recipe)) {
        throw new Error('Heropen de nieuwste versie van dit recept voordat je het verwijdert.')
      }
      assertRecipeNotUsedByPlanner(window.localStorage, recipe.id)
      setPendingRecipeRemoval({ id: recipe.id, snapshot: JSON.stringify(recipe) })
    } catch (cause) {
      setRecipeFileMessage(cause instanceof Error ? cause.message : 'Verwijderen is niet beschikbaar.')
    }
  }
  function confirmRecipeRemoval(recipe: SavedRecipe) {
    setRecipeFileMessage('')
    try {
      if (!pendingRecipeRemoval || pendingRecipeRemoval.id !== recipe.id ||
          pendingRecipeRemoval.snapshot !== JSON.stringify(recipe) ||
          library.error || !library.recipes.some(item => item === recipe)) {
        throw new Error('Dit bevestigingsverzoek is verouderd. Open het recept opnieuw.')
      }
      assertRecipeNotUsedByPlanner(window.localStorage, recipe.id)
      const next = saveRecipeLibrary(
        window.localStorage, library, library.recipes.filter(item => item.id !== recipe.id),
      )
      setLibrary(next)
      if (next.raw === null) throw new Error('Receptenopslag is niet bijgewerkt.')
      setRecentlyDeletedRecipe({ recipe, afterRaw: next.raw })
      setPendingRecipeRemoval(null)
      setPortionVariantPreview(null)
      setSelected(null)
      detail.current?.close()
      window.dispatchEvent(new Event('supa-recipes-changed'))
      setMessage('Dit ongebruikte eigen recept is verwijderd. Je gekozen Planner-week blijft staan; controleer eventuele eerdere privé winkelbronreviews opnieuw.')
    } catch (cause) {
      setPendingRecipeRemoval(null)
      setRecipeFileMessage(cause instanceof Error ? cause.message : 'Verwijderen is niet gelukt. Het recept blijft bestaan.')
    }
  }
  function restoreRecentlyDeletedRecipe() {
    const removed = recentlyDeletedRecipe
    if (!removed || library.error || library.raw !== removed.afterRaw ||
        library.recipes.some(recipe => recipe.id === removed.recipe.id)) {
      setRecentlyDeletedRecipe(null)
      setMessage('De recepten zijn inmiddels gewijzigd. Herstel is hier niet meer beschikbaar.')
      return
    }
    try {
      const next = saveRecipeLibrary(
        window.localStorage, library, [removed.recipe, ...library.recipes],
      )
      setLibrary(next)
      setRecentlyDeletedRecipe(null)
      window.dispatchEvent(new Event('supa-recipes-changed'))
      setMessage('Het laatst verwijderde recept is teruggezet. Controleer eventuele winkelmatches opnieuw.')
    } catch (cause) {
      setRecentlyDeletedRecipe(null)
      setMessage(cause instanceof Error ? cause.message : 'Herstellen is niet gelukt; andere recepten zijn onaangeroerd.')
    }
  }
  function addSingleRecipeToOwnList() {
    if (!onAddRecipeGroceries || !selected || !('savedAt' in selected) ||
        !ownShopping?.canCopy) return
    try {
      const source = selected
      const assertCurrent = () => {
        const latest = readRecipeLibrary(window.localStorage)
        if (latest.error || !latest.recipes.some(item =>
          item.id === source.id && JSON.stringify(item) === JSON.stringify(source)))
          throw Error('Dit originele recept is in een ander tabblad gewijzigd of verwijderd. Open het opnieuw.')
      }
      assertCurrent()
      const remaining = ownShopping.lines.filter(line =>
        line.needsReview || shoppingChecks[line.key] !== true)
      // The per-line scaler does not represent *global* import warnings.
      // Respect the same source-review admission as the combined recipe List:
      // a not-yet-admitted recipe can only contribute explicitly unreviewed
      // questions, never seemingly confirmed quantities.
      const sourceReviewed = !!toPlannerRecipe(source, { usage: 'unpriced-demand' })
      const labels = personalRecipeShoppingNoteLabels(sourceReviewed ? remaining :
        remaining.map(line => ({ ...line, needsReview: true })))
      if (!window.confirm('Voeg ' + labels.length +
          ' nog openstaande ingrediënten van dit eigen recept toe aan je ongeprijsde Lijst? ' +
          'De gekozen porties gelden alleen voor deze lijst; je Planner, winkelprijzen en oude vinkjes blijven intact.')) return
      assertCurrent()
      const failure = onAddRecipeGroceries(labels)
      if (failure) setPrivateWeekMessage(failure)
    } catch (error) {
      setPrivateWeekMessage(error instanceof Error ? error.message :
        'De receptboodschappen konden niet veilig worden overgenomen.')
    }
  }

  function downloadOwnRecipeChecklist() {
    if (!ownShopping?.canCopy) return
    try {
      const uri = URL.createObjectURL(new Blob([selectedRecipeShoppingText], { type: 'text/plain;charset=utf-8' }))
      const link = document.createElement('a')
      try {
        link.href = uri
        link.download = 'supa-recept-boodschappen.txt'
        document.body.append(link)
        link.click()
        link.remove()
        setMessage('Je ongeprijsde receptboodschappen zijn als TXT opgeslagen.')
      } finally { window.setTimeout(() => URL.revokeObjectURL(uri), 1000) }
    } catch {
      setMessage('Downloaden lukte niet. Selecteer de tekst van je lijst om die zelf op te slaan.')
      setShowShoppingCopy(true)
    }
  }
  function downloadOwnRecipeChecklistCsv() {
    if (!ownShopping?.canCopy) return
    try {
      const csv = exportOwnRecipeChecklistCsv(ownShopping, shoppingChecks)
      const uri = URL.createObjectURL(new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' }))
      try {
        const link = document.createElement('a')
        link.href = uri
        link.download = 'supa-recept-boodschappen-ongeprijsd.csv'
        document.body.append(link)
        link.click()
        link.remove()
        setMessage('Je eigen ongeprijsde boodschappenlijst is als CSV opgeslagen; winkelprijzen blijven onbekend.')
      } finally { window.setTimeout(() => URL.revokeObjectURL(uri), 1000) }
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'Kon het CSV-bestand niet veilig exporteren.')
    }
  }
  function planOwnRecipe(recipe: SavedRecipe, destination: 'planner' | 'basket' | 'list' = 'planner') {
    if (library.error || !toPlannerRecipe(recipe)) {
      setMessage('Controleer eerst alle metrische hoeveelheden en hele stuks in dit recept.')
      return
    }
    if (!m2InitialPlan.some(meal => meal.day === plannerDay)) return
    const accepted = window.dispatchEvent(new CustomEvent('supa-plan-own-recipe', {
      cancelable: true,
      detail: { recipeId: recipe.id, day: plannerDay, destination },
    }))
    if (!accepted) {
      setPrivateWeekMessage('Het recept of de beveiligde Planner-opslag is veranderd of niet beschikbaar. Er is niets opnieuw ingepland. Controleer je recept en Planner-opslag.')
      return
    }
    setPrivateWeekMessage('')
    detail.current?.close()
  }
  function downloadForPrivateComparison() {
    setPrivateWeekMessage('')
    try {
      if (!selected || !('savedAt' in selected)) throw new Error('Open eerst een eigen recept.')
      const json = exportOwnRecipePrivateWeek(selected, Number(shoppingPortions))
      const uri = URL.createObjectURL(new Blob([json], { type: 'application/json;charset=utf-8' }))
      const link = document.createElement('a')
      try {
        link.href = uri
        link.download = 'supa-recept-voor-privevergelijker.json'
        document.body.append(link)
        link.click()
        link.remove()
        setPrivateWeekMessage('Ingrediënten veilig geëxporteerd. Open de privévergelijker, importeer dit JSON-bestand als weekmenu en koppel daarna je eigen waargenomen winkelproducten.')
      } finally { window.setTimeout(() => URL.revokeObjectURL(uri), 1000) }
    } catch (cause) {
      setPrivateWeekMessage(cause instanceof Error ? cause.message : 'Dit recept kan niet veilig worden geëxporteerd.')
    }
  }

  async function loadOwnRecipeBackup(file?: File) {
    if (!file) return
    const version = ++backupReadVersion.current
    setBackupPreview(null)
    setBackupError('')
    setBackupBusy(true)
    try {
      if (library.error) throw new Error(library.error)
      if (file.size > RECIPE_BACKUP_MAX_BYTES) throw new Error('Backup is groter dan 2 MB.')
      const data = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer())
      const result = prepareRecipeBackupImport(data, library.recipes)
      if (version !== backupReadVersion.current) return
      setBackupPreview(result)
      setMessage('Backup lokaal gelezen. Controleer eerst de aantallen en bevestig zelf de import.')
    } catch (cause) {
      if (version !== backupReadVersion.current) return
      setBackupError(cause instanceof Error ? cause.message : 'Kon deze backup niet lezen.')
    } finally {
      if (version === backupReadVersion.current) setBackupBusy(false)
    }
  }
  function confirmOwnRecipeBackup() {
    if (!backupPreview || !backupPreview.additions.length) return
    setBackupError('')
    try {
      if (library.error) throw new Error(library.error)
      const next = saveRecipeLibrary(
        window.localStorage, library, [...backupPreview.additions, ...library.recipes],
      )
      setLibrary(next)
      setBackupPreview(null)
      setFilter('own')
      setQuery('')
      window.dispatchEvent(new Event('supa-recipes-changed'))
      setMessage('Je eigen recepten zijn geïmporteerd en beschikbaar in Recepten en, met metrische hoeveelheden, Planner.')
    } catch (cause) {
      setBackupError(cause instanceof Error ? cause.message : 'Importeren is niet gelukt. Je bestaande recepten blijven staan.')
    }
  }
  function downloadPlainRecipeCollection() {
    setCollectionError(''); setCollectionMessage('')
    try {
      if (library.error) throw new Error(library.error)
      if (!markdownExportable.length) throw new Error('Geen recepten zonder openstaande broncontroles geschikt voor Markdown. Gebruik de volledige JSON-back-up.')
      // Large libraries can be transferred in explicit 15-recipe batches.
      // One user click only starts one local download.
      const batchCount = Math.ceil(markdownExportable.length / 15)
      const batch = Math.min(Math.max(0, collectionExportBatch), batchCount - 1)
      const from = batch * 15
      const selected = markdownExportable.slice(from, from + 15)
      // Readable Markdown cannot retain source-review holds. Each unreviewed
      // recipe must travel in the existing lossless JSON backup instead.
      const markdown = selected.map(ownRecipeAsMarkdown).join('\n---\n')
      if (new TextEncoder().encode(markdown).length > 500_000)
        throw new Error('Het Markdownbestand is groter dan 500 kB. Gebruik de JSON-back-up.')
      const url = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown;charset=utf-8' }))
      try {
        const link = document.createElement('a')
        link.href = url; link.download = 'supa-recepten-' + (from + 1) + '-tm-' + (from + selected.length) + '.md'
        document.body.append(link)
        try { link.click() } finally { link.remove() }
      } finally { window.setTimeout(() => URL.revokeObjectURL(url), 1000) }
      setCollectionMessage('Gecontroleerde recepten ' + (from + 1) + ' t/m ' + (from + selected.length) + ' staan in het Markdownbestand. Niet-geschikte recepten zijn niet stilzwijgend als Markdown meegenomen: gebruik de JSON-back-up voor de volledige bibliotheek.')
    } catch (cause) {
      setCollectionError(cause instanceof Error ? cause.message : 'Exporteren is niet gelukt.')
    }
  }
  async function loadPlainRecipeCollection(files: File[], format: 'plain' | 'jsonld' | 'html' | 'links') {
    if (!files.length) return
    const revision = ++collectionReadVersion.current
    setCollectionError(''); setCollectionMessage(''); setCollectionPreview(null)
    try {
      const maxFiles = format === 'links' ? 8 : 15
      const maxBytes = format === 'links' ? 32_000 : 500_000
      if (files.length > maxFiles || files.some(file => !file.size || file.size > maxBytes) ||
          files.reduce((bytes, file) => bytes + file.size, 0) > maxBytes)
        throw new Error(format === 'links'
          ? 'Kies maximaal acht gevulde .txt/.md-linklijsten, samen maximaal 32 kB.'
          : 'Kies maximaal 15 gevulde tekstbestanden, samen maximaal 500 kB.')
      const sources: string[] = []
      for (const file of files) {
        if (revision !== collectionReadVersion.current) return
        const allowedName = format === 'plain' || format === 'links'
          ? /\.(?:txt|md)$/iu.test(file.name)
          : format === 'html' ? /\.html?$/iu.test(file.name)
          : /\.(?:json|jsonld)$/iu.test(file.name)
        if (!allowedName) {
          const reason = format === 'links'
            ? 'Kies alleen .txt- en .md-bestanden met openbare receptlinks.'
            : format === 'plain' ? 'Kies alleen .txt- en .md-receptbestanden.'
            : format === 'html' ? 'Kies alleen .html- en .htm-receptbestanden.'
            : 'Kies alleen .json- en .jsonld-receptbestanden.'
          throw new Error(reason)
        }
        const content = decodeLocalRecipeCollectionFile(await file.arrayBuffer(), format)
        if (!content) throw new Error('Eén van de gekozen receptbestanden is leeg.')
        sources.push(content)
      }
      if (revision !== collectionReadVersion.current) return
      const combined = format === 'plain'
        ? sources.join('\n---\n')
        : format === 'html' || format === 'links' ? sources.join('\n')
        : sources.length === 1 ? sources[0] : JSON.stringify(sources.map(source => {
          try { return JSON.parse(source) }
          catch { throw new Error('Een van de JSON-LD-bestanden bevat ongeldige JSON.') }
        }))
      if (new TextEncoder().encode(combined).length > maxBytes)
        throw new Error(format === 'links' ? 'De linklijsten zijn samen groter dan 32 kB.' : 'De verzamelde recepten zijn groter dan 500 kB.')
      setCollectionFormat(format)
      setCollectionText(combined)
      setCollectionMessage(files.length + ' lokale ' + (format === 'jsonld' ? 'JSON-LD-' : format === 'html' ? 'HTML-' : format === 'links' ? 'receptlink-' : 'tekst') + 'bestanden gelezen. Controleer de afzonderlijke recepten en originele hoeveelheden vóór import.')
    } catch (cause) {
      if (revision === collectionReadVersion.current)
        setCollectionError(cause instanceof Error ? cause.message : 'Kon deze receptbestanden niet lezen.')
    }
  }
  async function previewPlainRecipeCollection() {
    collectionAbort.current?.abort()
    const revision = ++collectionReadVersion.current
    const controller = new AbortController()
    collectionAbort.current = controller
    setCollectionBusy(true)
    setCollectionError(''); setCollectionMessage(''); setCollectionPreview(null)
    try {
      if (library.error) throw new Error(library.error)
      const parsed = collectionFormat === 'jsonld'
        ? importLocalJsonLdRecipeCollection(collectionText)
        : collectionFormat === 'html' ? importLocalRecipeHtmlCollection(collectionText)
        : collectionFormat === 'links'
          ? await importRecipeLinksCollection(collectionText, controller.signal,
            (done, total) => {
              if (revision === collectionReadVersion.current)
                setCollectionMessage(done + ' van ' + total + ' openbare receptlinks opgehaald via de bestaande beveiligde import.')
            })
          : importPlainTextRecipeCollection(collectionText)
      if (revision !== collectionReadVersion.current || controller.signal.aborted) return
      // Attribution is meaningful recipe metadata. Identical ingredient
      // text from two different public sources must not silently collapse
      // into one imported recipe; source links remain sanitized at admission.
      const identity = (item: UserRecipeDraft) => JSON.stringify([
        item.title, item.source, item.sourceUrl, item.servings, item.minutes,
        item.ingredients.map(part => part.original), item.steps,
      ])
      const known = new Set(library.recipes.map(identity))
      const recipes: UserRecipeDraft[] = []
      let alreadyPresent = 0
      for (const recipe of parsed) {
        const key = identity(recipe)
        if (known.has(key)) { alreadyPresent++; continue }
        known.add(key); recipes.push(recipe)
      }
      if (!recipes.length) throw new Error('Alle recepten staan al op dit apparaat. Er is niets nieuws om te bewaren.')
      if (library.recipes.length + recipes.length > 100)
        throw new Error('Je kunt maximaal 100 eigen recepten bewaren. Maak eerst ruimte in je receptenlijst.')
      setCollectionSelected(recipes.map((_, index) => index))
      setLastImportedIds([])
      setCollectionPreview({ source: collectionText, format: collectionFormat, libraryRaw: library.raw, recipes, alreadyPresent })
      setCollectionMessage(recipes.length + ' nieuwe recepten lokaal herkend; ' + alreadyPresent + ' al aanwezig of dubbel. Controleer de hoeveelheden en bevestig zelf.')
    } catch (cause) {
      if (revision === collectionReadVersion.current)
        setCollectionError(cause instanceof Error ? cause.message : 'Kon de receptenverzameling niet lezen.')
    } finally {
      if (revision === collectionReadVersion.current) {
        setCollectionBusy(false)
        collectionAbort.current = null
      }
    }
  }
  function confirmPlainRecipeCollection() {
    setCollectionError('')
    try {
      if (!collectionPreview || collectionPreview.source !== collectionText ||
          collectionPreview.format !== collectionFormat ||
          collectionPreview.libraryRaw !== library.raw)
        throw new Error('De tekst of je opgeslagen recepten zijn veranderd. Controleer deze import opnieuw.')
      const savedAt = new Date().toISOString()
      const indexes = [...new Set(collectionSelected)]
      if (!indexes.length || indexes.some(index => !Number.isSafeInteger(index) ||
          index < 0 || index >= collectionPreview.recipes.length))
        throw new Error('Kies eerst ten minste één geldig recept om op te slaan.')
      const additions: SavedRecipe[] = indexes.map(index => ({
        ...reviewRecipe(collectionPreview.recipes[index]), id: ownRecipeId(), savedAt,
      }))
      const next = saveRecipeLibrary(window.localStorage, library,
        [...additions, ...library.recipes])
      setLibrary(next)
      setLastImportedIds(additions.map(recipe => recipe.id))
      setGroceryOpen(true)
      if (next.raw !== null) setLastBulkImport({ afterRaw: next.raw, ids: additions.map(recipe => recipe.id), kind: 'import' })
      setConfirmBulkUndo(false)
      setCollectionPreview(null); setCollectionText('')
      setFilter('own'); setQuery('')
      window.dispatchEvent(new Event('supa-recipes-changed'))
      setCollectionMessage(additions.length + ' eigen recepten bewaard op dit apparaat. Recepten met onzekere hoeveelheden vereisen nog controle vóór Planner. Winkelprijzen blijven onbekend.')
    } catch (cause) {
      setCollectionError(cause instanceof Error ? cause.message : 'Er is niets opgeslagen. Probeer opnieuw.')
    }
  }
  function undoLastBulkRecipeImport() {
    setCollectionError('')
    try {
      if (!confirmBulkUndo || !lastBulkImport || !library.raw ||
          library.raw !== lastBulkImport.afterRaw || library.error) {
        throw new Error('De recepten zijn intussen gewijzigd. De bulkimport kan niet veilig worden teruggedraaid.')
      }
      if (!lastBulkImport.ids.length ||
          lastBulkImport.ids.some(id => !library.recipes.some(recipe => recipe.id === id))) {
        throw new Error('De eerdere import is veranderd. Verwijderen is geannuleerd.')
      }
      // The existing Planner ownership guard is mandatory for EACH recipe.
      // Do not orphan physical week demand or price-linked checkmarks.
      for (const id of lastBulkImport.ids) assertRecipeNotUsedByPlanner(window.localStorage, id)
      const removed = new Set(lastBulkImport.ids)
      const next = saveRecipeLibrary(window.localStorage, library,
        library.recipes.filter(recipe => !removed.has(recipe.id)))
      setLibrary(next); setLastImportedIds([])
      setLastBulkImport(null); setConfirmBulkUndo(false)
      window.dispatchEvent(new Event('supa-recipes-changed'))
      setCollectionMessage('De laatste ' + (lastBulkImport.kind === 'variants' ? 'portievariantenbatch' : 'bulkimport') +
        ' is in één keer teruggedraaid. Eerdere eigen recepten zijn behouden.')
    } catch (cause) {
      setCollectionError(cause instanceof Error ? cause.message : 'De import kon niet worden teruggedraaid.')
      setConfirmBulkUndo(false)
    }
  }
  function openEditor(next: 'manual' | 'url' | 'paste' | 'plain') {
    pasteReadVersion.current++; setPasteFileMessage('')
    editingBaseline.current = null
    importedReviewBaseline.current = null
    request.current?.abort(); setBusy(false); setMode(next); setForm(blank); setSource(null); setUrl(''); setPastedSource(''); setPreview(null); setError(''); setEditingId(null); setIsVariant(false); saving.current = false
    setBackupPreview(null)
    editor.current?.showModal()
  }
  function closeEditor() { importedReviewBaseline.current = null; editingBaseline.current = null; pasteReadVersion.current++; request.current?.abort(); setBusy(false); editor.current?.close(); setEditingId(null); setIsVariant(false) }
  function openSavedRecipeEditor(recipe: SavedRecipe, duplicate = false) {
    if (library.error) { setMessage(library.error); return }
    request.current?.abort()
    setBusy(false); saving.current = false
    importedReviewBaseline.current = recipe
    editingBaseline.current = duplicate ? null : { id: recipe.id, raw: JSON.stringify(recipe) }
    setEditingId(duplicate ? null : recipe.id); setIsVariant(duplicate)
    setMode('manual')
    setForm({
      title: recipe.title,
      servings: recipe.servings?.toString() ?? '',
      minutes: recipe.minutes?.toString() ?? '',
      ingredients: recipe.ingredients.map(item => item.original).join('\n'),
      steps: recipe.steps.join('\n'),
    })
    setSource(recipe.sourceUrl); setUrl(''); setPastedSource('')
    setPreview(null); setError(''); setMessage('')
    detail.current?.close()
    editor.current?.showModal()
  }
  async function pasteRecipeLink() {
    try {
      if (!navigator.clipboard?.readText)
        throw new Error('Klembordtoegang ontbreekt in deze browser.')
      const pasted = (await navigator.clipboard.readText()).trim()
      if (pasted.length > 2048)
        throw new Error('De openbare receptlink is te lang (maximaal 2048 tekens).')
      // Do not send the pasted link until the user explicitly imports.
      setUrl(pasted)
      setError('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Plakken is niet beschikbaar. Gebruik het linkveld.')
    }
  }
  async function importLink(event: FormEvent) {
    event.preventDefault(); request.current?.abort()
    const controller = new AbortController(); request.current = controller
    setBusy(true); setError(''); setPreview(null)
    try {
      const draft = await importRecipeLink(url, controller.signal)
      if (controller.signal.aborted) return
      adoptImportedRecipe(draft, 'Recept opgehaald. Controleer de gegevens en sla het daarna op.')
    } catch (e) {
      if (!controller.signal.aborted) {
        if (e instanceof RecipeLinkImportUnavailableError) {
          setMode('paste')
          setError('Automatische linkimport is op deze website niet beschikbaar. De openbare link blijft behouden als bronvermelding. Open de receptpagina en upload lokaal opgeslagen HTML/JSON-LD of plak de JSON-LD hieronder; Supa verwerkt die lokaal zonder scripts uit te voeren.')
        } else {
          setError(e instanceof Error ? e.message : 'Importeren is niet gelukt.')
        }
      }
    }
    finally { if (!controller.signal.aborted) setBusy(false) }
  }
  function adoptImportedRecipe(draft: UserRecipeDraft, messageText: string) {
    importedReviewBaseline.current = draft
    setForm({
      title: draft.title,
      servings: draft.servings?.toString() ?? '',
      minutes: draft.minutes?.toString() ?? '',
      ingredients: draft.ingredients.map(item => item.original).join('\n'),
      steps: draft.steps.join('\n'),
    })
    const sourceUrl = draft.sourceUrl ? safeRecipeSourceUrl(draft.sourceUrl) : null
    setSource(sourceUrl)
    setMode('manual')
    setPastedSource('')
    setPreview(null)
    setMessage(messageText + (draft.sourceUrl && sourceUrl !== draft.sourceUrl
      ? ' Privé-inlogparameters zijn uit de bronlink verwijderd.' : ''))
  }
  async function loadLocalRecipeSource(file?: File, format: 'schema' | 'plain' = 'schema') {
    if (!file) return
    const revision = ++pasteReadVersion.current
    setPasteFileMessage(''); setError('')
    try {
      if (!file.size || file.size > 500_000) throw new Error('Selecteer een lokaal receptbestand van maximaal 500 kB.')
      const content = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer())
      if (revision !== pasteReadVersion.current) return
      setPastedSource(content)
      setPreview(null)
      setPasteFileMessage(format === 'plain' ? 'Tekstbestand lokaal gelezen. Controleer de ingrediënten vóór import.' : 'Bestand lokaal gelezen. Controleer de gegevens en vul de oorspronkelijke openbare HTTPS-bronlink in.')
    } catch (cause) {
      if (revision === pasteReadVersion.current) setError(cause instanceof Error ? cause.message : 'Het bestand kan niet lokaal worden gelezen.')
    }
  }
  function importPastedRecipe(event: FormEvent) {
    event.preventDefault()
    setError('')
    setPreview(null)
    try {
      const sourceText = pastedSource.trim()
      if (!sourceText || new TextEncoder().encode(sourceText).length > 500_000) {
        throw new Error('Plak maximaal 500 kB aan zelf verkregen HTML of JSON-LD.')
      }
      // Reuse the existing offline schema.org/Recipe normalizer; this does NOT
      // fetch the URL, navigate a site or execute any pasted HTML/JavaScript.
      const html = sourceText.startsWith('{') || sourceText.startsWith('[')
        ? '<script type="application/ld+json">' + sourceText + '</script>'
        : sourceText
      const draft = importRecipeFromHtml(html, url)
      adoptImportedRecipe(draft, 'Receptgegevens lokaal herkend. Controleer alle hoeveelheden vóór opslaan.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Kon de geplakte receptgegevens niet verwerken.')
    }
  }
  function importPlainText(event: FormEvent) {
    event.preventDefault()
    setError('')
    setPreview(null)
    try {
      const draft = importPlainTextRecipe(pastedSource)
      adoptImportedRecipe(draft, 'Recepttekst lokaal herkend. Controleer hoeveelheden en stappen vóór opslaan.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Kon deze recepttekst niet inlezen.')
    }
  }
  function check(event: FormEvent) {
    event.preventDefault(); setError('')
    try {
      const draft = createManualRecipeDraft({ title: form.title, servings: Number(form.servings), minutes: Number(form.minutes), ingredients: form.ingredients.split('\n').map(x => x.trim()).filter(Boolean), steps: form.steps.split('\n').map(x => x.trim()).filter(Boolean) })
      const current = importedReviewBaseline.current
      const withReview = current ? retainUnresolvedRecipeReview(draft, current) : draft
      setPreview(reviewRecipe({ ...withReview, source: source ? 'url' : 'manual', sourceUrl: source }))
    } catch (e) { setError(e instanceof Error ? e.message : 'Controleer de gegevens.') }
  }
  function save() {
    if (!preview || saving.current) return
    saving.current = true
    try {
      const reviewed = reviewRecipe(preview)
      const current = editingId ? library.recipes.find(recipe => recipe.id === editingId) : null
      if (editingId && (!current || !editingBaseline.current ||
          editingBaseline.current.id !== editingId ||
          JSON.stringify(current) !== editingBaseline.current.raw)) {
        throw new Error('Dit recept is tussentijds gewijzigd of verwijderd. Open de actuele versie opnieuw voordat je opslaat; je invoer blijft staan.')
      }
      // Keep the identity of a recipe already referenced by the weekly Planner.
      // The library's CAS write refuses newer changes from another browser tab.
      const recipe: SavedRecipe = current
        ? { ...reviewed, id: current.id, savedAt: current.savedAt }
        : { ...reviewed, id: ownRecipeId(), savedAt: new Date().toISOString() }
      const entries = current
        ? library.recipes.map(item => item.id === current.id ? recipe : item)
        : [recipe, ...library.recipes]
      const next = saveRecipeLibrary(window.localStorage, library, entries)
      setLibrary(next); setBackupPreview(null); window.dispatchEvent(new Event('supa-recipes-changed')); setFilter('own'); setQuery('')
      setSelected(recipe)
      setMessage(`${recipe.title} is ${current ? 'bijgewerkt' : 'opgeslagen'} op dit apparaat. ` +
        (toPlannerRecipe(recipe)
          ? 'Het recept is klaar voor Planner. Winkelprijzen blijven onbekend tot je echte brondata bevestigt.'
          : 'Het recept blijft bewaard. Controleer eerst onzekere hoeveelheden of gedeeltelijke stuks voordat je het in Planner gebruikt.'))
      closeEditor()
    } catch (e) { setError(e instanceof Error ? e.message : 'Opslaan is niet gelukt. Je invoer blijft staan.') }
    finally { saving.current = false }
  }
  return <div className="hifi-home recipe-library" data-figma-node="3342:5608">
    <header className="recipe-heading"><button className="recipe-back" onClick={onBack} aria-label="Terug naar Home"><FigmaImage asset={a.recipeBack} alt="" /></button><h1>{filter === 'own' ? 'Mijn eigen recepten' : 'Alle recepten'}</h1></header>
    <div className="hifi-search-row"><label className="hifi-search"><FigmaImage asset={a.recipeSearch} alt="" /><input type="search" aria-label="Zoek recepten op naam of ingrediënt" placeholder="Zoek recept of ingrediënt" value={query} onChange={e => setQuery(e.target.value)} /></label><button className="hifi-filter" aria-label="Receptfilters" aria-expanded={filtersOpen} onClick={() => setFiltersOpen(!filtersOpen)}><FigmaImage asset={a.imgVector2} alt="" /></button></div>
    {filtersOpen && <div className="recipe-tabs" aria-label="Receptfilter">{(['all', 'own', 'favorites'] as const).map((id, i) => <button key={id} aria-pressed={filter === id} onClick={() => setFilter(id)}>{['Alle recepten', 'Eigen recepten', 'Favorieten'][i]}</button>)}</div>}
    <section className="hifi-section"><div className="hifi-section-heading"><div><h2>Recepten</h2><p className="recipe-count">{demo.length + own.length} recepten</p></div><button aria-label="Sorteer recepten op naam" aria-pressed={sort} onClick={() => setSort(!sort)}><FigmaImage asset={a.recipeSort} alt="" /></button></div>
      <div className="hifi-recipe-grid">{[...own, ...demo].map(recipe => <article className={`hifi-recipe-card${'image' in recipe && recipe.image ? '' : ' own-recipe-card'}`} key={recipe.id}>
        {'image' in recipe && recipe.image && <FigmaImage className="hifi-recipe-photo" asset={recipe.image} alt="" />}
        <button className="hifi-recipe-open" aria-label={`Bekijk ${recipe.title}`} onClick={() => { setSelected(recipe); setShoppingPortions(String(recipe.servings ?? 2)); setShowShoppingCopy(false); setPrivateWeekMessage(''); setShoppingChecks({}); setShoppingOpenOnly(false); detail.current?.showModal() }} />
        <div className="hifi-recipe-top"><span className="hifi-saving">{'sourceLabel' in recipe ? recipe.sourceLabel : 'Eigen recept'}</span><button className="hifi-favorite" aria-label={`Favoriet: ${recipe.title}`}
          aria-pressed={favorites.includes(recipe.id)} disabled={!!favoriteState.error}
          onClick={() => favorite(recipe.id)}><FigmaImage asset={favorites.includes(recipe.id) ? a.recipeHeartActive : a.imgFilter} alt="" /></button></div>
        <div className="hifi-recipe-caption"><h3>{recipe.title}</h3>{searchTerm && recipeIngredientHit(recipe, searchTerm) &&
          <small className="recipe-ingredient-match">Ingrediënt: {recipeIngredientHit(recipe, searchTerm)}</small>}<p><span><FigmaImage asset={a.imgVector4} alt="" />{recipe.minutes ?? '?'}</span><span>{`${recipe.servings ?? '?'} porties`}</span></p>{'savedAt' in recipe && <small className="recipe-planner-readiness">{toPlannerRecipe(recipe) ? '✓ Klaar voor Planner · ongeprijsd' : 'Ingrediënten nog controleren voor Planner'}</small>}</div>
      </article>)}</div>
      {!demo.length && !own.length && <p className="hifi-empty">{query ? 'Geen recepten met deze naam of dit ingrediënt gevonden.' : 'Voeg je eerste eigen recept toe of importeer een receptlink.'}</p>}
      <small>Favorieten blijven lokaal bewaard in deze browser; receptgegevens en links worden niet meegestuurd.</small>
      {favoriteState.error && <p role="alert" className="recipe-error">{favoriteState.error}</p>}
    </section>
    <div className="recipe-add-actions"><button onClick={() => openEditor('manual')}>＋ Eigen recept</button><button onClick={() => openEditor('url')}>Importeer via link</button><button onClick={() => openEditor('paste')}>Plak receptgegevens (JSON-LD)</button><button onClick={() => openEditor('plain')}>Plak gewone recepttekst</button></div>
    <section className="recipe-backup-panel" aria-label="Meerdere eigen recepten tegelijk toevoegen">
      <h2>Meerdere eigen recepten importeren</h2>
      <p>Gebruik eigen tekst, Markdown, lokale schema.org JSON-LD of opgeslagen HTML-webpagina’s. Alleen bij expliciete import van openbare receptlinks haalt Supa via de bestaande beveiligde serverroute gegevens op. Winkelprijzen blijven onbekend en onzekere hoeveelheden blijven ter controle.</p>
      <label className="recipe-collection-label">Soort bestanden
        <select value={collectionFormat} onChange={event => {
          collectionReadVersion.current++
          collectionAbort.current?.abort(); setCollectionBusy(false)
          setCollectionFormat(event.currentTarget.value as 'plain' | 'jsonld' | 'html' | 'links')
          setCollectionText(''); setCollectionPreview(null); setCollectionError(''); setCollectionMessage('')
        }}>
          <option value="plain">Gewone tekst / Markdown</option>
          <option value="jsonld">JSON-LD met schema.org/Recipe</option>
          <option value="html">Opgeslagen HTML-webpagina met receptgegevens</option>
          <option value="links">Meerdere openbare HTTPS-receptlinks</option>
        </select>
      </label>
      <p>{collectionFormat === 'plain'
        ? 'Scheid meerdere recepten met een eigen regel ---. Gebruik titel, optioneel Porties:, Tijd: en Bron: https://…, gevolgd door Ingrediënten: en Bereiding:. Bron is alleen attributie, geen prijsbewijs.'
        : collectionFormat === 'html'
          ? 'Lees schema.org/Recipe uit opgeslagen HTML-webpagina’s, zonder scripts uit te voeren of iets op internet te openen.'
          : collectionFormat === 'links'
            ? 'Plak of upload maximaal acht openbare HTTPS-receptlinks. Markdown-koppen, scheidingslijnen, directe URL’s en [receptnaam](https://…) werken. Alleen na jouw klik worden ze via de bestaande beveiligde receptimport opgehaald; bij mislukking blijft de bibliotheek onveranderd.'
          : 'Kies 1–15 Recipe-objecten uit een JSON-LD-array of @graph. Bronlinks en winkelprijzen worden niet aangenomen.'}</p>
      <label className="recipe-collection-label">{collectionFormat === 'plain'
        ? 'Importeer .txt/.md-bestanden (samen maximaal 500 kB)'
        : collectionFormat === 'html' ? 'Importeer .html/.htm-bestanden (samen maximaal 500 kB)'
        : collectionFormat === 'links' ? 'Importeer .txt/.md-linklijsten (maximaal 8 bestanden, samen 32 kB)'
        : 'Importeer .json/.jsonld-bestanden (samen maximaal 500 kB)'}
        <input type="file" multiple key={collectionFormat}
          accept={collectionFormat === 'plain' || collectionFormat === 'links'
            ? '.txt,.md,text/plain,text/markdown'
            : collectionFormat === 'html' ? '.html,.htm,text/html' : '.json,.jsonld,application/json'}
          onChange={event => {
            const files = Array.from(event.currentTarget.files ?? [])
            void loadPlainRecipeCollection(files, collectionFormat); event.currentTarget.value = ''
          }} />
      </label>
      <label className="recipe-collection-label">{collectionFormat === 'plain'
        ? 'Recepttekst (titel, Ingrediënten:, Bereiding:)' : collectionFormat === 'html' ? 'HTML-bron van lokaal opgeslagen recepten'
        : collectionFormat === 'links' ? 'Openbare HTTPS-receptlinks (één per regel)'
        : 'JSON-LD receptverzameling'}
        <textarea rows={8} maxLength={collectionFormat === 'links' ? 32_000 : 500_000} value={collectionText}
          placeholder={collectionFormat === 'plain'
            ? 'Tomatensoep\nPorties: 2\nBron: https://voorbeeld.nl/recept/soep\nIngrediënten:\n500 g tomaten\nBereiding:\nKook tomaten\n---\nPasta\nIngrediënten:\n200 g pasta\nBereiding:\nKook pasta'
            : collectionFormat === 'html'
              ? '<script type="application/ld+json">{"@type":"Recipe","name":"...","recipeIngredient":["250 g ..."]}</script>'
              : collectionFormat === 'links' ? '# Mijn recepten\n\n- [Tomatensoep](https://voorbeeld.nl/recept/soep)\n- https://voorbeeld.nl/recept/pasta'
              : '{"@context":"https://schema.org","@graph":[{"@type":"Recipe","name":"...","recipeIngredient":["250 g ..."],"recipeInstructions":["..."]}]}'}
          onChange={event => {
            collectionAbort.current?.abort(); setCollectionBusy(false)
            collectionReadVersion.current++; setCollectionText(event.currentTarget.value)
            setCollectionPreview(null); setCollectionError(''); setCollectionMessage('')
          }} />
      </label>
      {collectionFormat === 'links' && <small>{collectionText.length.toLocaleString('nl-NL')} / 32.000 tekens · maximaal acht unieke HTTPS-receptlinks. Koppen en scheidingslijnen tellen niet mee.</small>}
      <p role="status">{markdownExportable.length} gecontroleerde recepten beschikbaar voor Markdown;
        {' '}{library.recipes.length - markdownExportable.length} recept(en) met openstaande waarschuwingen
        of ongeldig exportformaat blijven uitsluitend in de volledige JSON-back-up.
        Veilige openbare Bron:-links worden in Markdown behouden; prijs- en bronrechtenstatus niet.</p>
      {markdownExportable.length > 15 &&
        <label className="recipe-collection-label">Kies welke 15 recepten je als Markdown meeneemt
          <select value={Math.min(collectionExportBatch, Math.ceil(markdownExportable.length / 15) - 1)}
            onChange={event => { setCollectionExportBatch(Number(event.currentTarget.value)); setCollectionError(''); setCollectionMessage('') }}>
            {Array.from({ length: Math.ceil(markdownExportable.length / 15) }, (_, index) => <option
              value={index} key={index}>Recepten {index * 15 + 1} t/m {Math.min(markdownExportable.length, (index + 1) * 15)}</option>)}
          </select>
        </label>}
      <div className="recipe-backup-panel__actions">
        <button type="button" onClick={() => void previewPlainRecipeCollection()}
          disabled={!collectionText.trim() || !!library.error || collectionBusy}>{collectionBusy ? 'Receptlinks ophalen…' : 'Controleer'} {collectionFormat === 'jsonld' ? 'JSON-LD recepten' : collectionFormat === 'html' ? 'HTML-recepten' : collectionFormat === 'links' ? 'receptlinks' : 'mijn recepten'}</button>
        {collectionBusy && <button type="button" onClick={() => {
          ++collectionReadVersion.current; collectionAbort.current?.abort()
          setCollectionBusy(false); setCollectionPreview(null)
          setCollectionMessage('Ophalen geannuleerd. Er zijn geen recepten opgeslagen.')
        }}>Annuleer ophalen</button>}
        <button type="button" onClick={downloadPlainRecipeCollection}
          disabled={!!library.error || !markdownExportable.length}>Download mijn recepten (Markdown)</button>
        <button type="button" onClick={() => {
          collectionAbort.current?.abort(); setCollectionBusy(false)
          collectionReadVersion.current++; setCollectionText(''); setCollectionPreview(null)
          setCollectionError(''); setCollectionMessage('')
        }}>Wis invoer</button>
      </div>
      {collectionPreview && collectionPreview.source === collectionText &&
        collectionPreview.format === collectionFormat &&
        collectionPreview.libraryRaw === library.raw &&
        <div className="recipe-backup-panel__review" role="group" aria-label="Bevestig import van mijn recepten">
          <strong>{collectionPreview.recipes.length} nieuwe recepten gevonden</strong>
          <small>{collectionPreview.alreadyPresent} al aanwezig of dubbel — die worden niet opnieuw opgeslagen.</small>
          <div className="recipe-backup-panel__actions">
            <button type="button" onClick={() => setCollectionSelected(collectionPreview.recipes.map((_, i) => i))}>
              Selecteer alle nieuwe recepten
            </button>
            <button type="button" onClick={() => setCollectionSelected([])}>Deselecteer alles</button>
          </div>
          <div className="recipe-collection-preview">{collectionPreview.recipes.map((recipe, index) =>
            <div key={index} className="recipe-collection-preview__item">
              <label className="recipe-collection-preview__select">
                <input type="checkbox" checked={collectionSelected.includes(index)}
                  onChange={event => {
                    const checked = event.currentTarget.checked
                    setCollectionSelected(previous => checked
                      ? [...new Set([...previous, index])].sort((a, b) => a - b)
                      : previous.filter(value => value !== index))
                  }} />
                Bewaar {recipe.title}
              </label>
              <details><summary><strong>{recipe.title}</strong> · {recipe.ingredients.length} ingrediënten ·
                {' '}{recipe.warnings.length ? recipe.warnings.length + ' controlepunten' : 'Geen openstaande importwaarschuwingen'}</summary>
              <p>{recipe.servings ?? '?'} porties · {recipe.minutes ?? '?'} minuten.
                {' '}Originele hoeveelheden en waarschuwingen blijven bij het recept.</p>
              {recipe.sourceUrl && <small>Bronvermelding (geen prijsbewijs):{' '}
                <a href={safeRecipeSourceUrl(recipe.sourceUrl)} target="_blank" rel="noreferrer">
                  {safeRecipeSourceUrl(recipe.sourceUrl)}
                </a>
              </small>}
              <ul>{recipe.ingredients.map((ingredient, itemIndex) => <li key={itemIndex}>
                <span>{ingredient.original}</span>
                {ingredient.reviewReason
                  ? <small role="status">Controle vereist: {ingredient.reviewReason}</small>
                  : <small>{ingredient.amount} {ingredient.unit === 'piece' ? 'stuks' : ingredient.unit} genormaliseerd</small>}
              </li>)}</ul>
              {!!recipe.warnings.length && <div className="recipe-review-warnings">
                <strong>Voor gebruik in Planner corrigeren</strong>
                <ul>{recipe.warnings.map((warning, warningIndex) => <li key={warningIndex}>{warning}</li>)}</ul>
              </div>}
              <small>{recipe.steps.length} bereidingsstappen worden privé bewaard.</small>
              </details>
            </div>)}</div>
          <p>Geen prijzen of productmatches. Alleen de {collectionSelected.length} geselecteerde
            recepten worden na jouw bevestiging samen opgeslagen.</p>
          <div className="recipe-backup-panel__actions">
            <button type="button" onClick={confirmPlainRecipeCollection}
              disabled={!collectionSelected.length}>Bewaar {collectionSelected.length} geselecteerde recepten</button>
            <button type="button" onClick={() => setCollectionPreview(null)}>Annuleer</button>
          </div>
        </div>}
      {lastImportedIds.length > 0 && !library.error &&
        <section className="recipe-collection-result" aria-label="Nieuwe recepten direct plannen">
          <h3>Je nieuwe recepten gebruiken</h3>
          <p>Plan een recept op een gekozen dag en open direct je ongeprijsde lijst of
            de bestaande winkelbronimport. Eerdere winkelprijzen worden niet hergebruikt.</p>
          <label className="recipe-collection-label">Dag in Planner
            <select value={plannerDay} onChange={event => setPlannerDay(event.currentTarget.value)}>
              {m2InitialPlan.map(meal => <option key={meal.day} value={meal.day}>{meal.day}</option>)}
            </select>
          </label>
          {lastImportedIds.map(id => {
            const recipe = library.recipes.find(item => item.id === id)
            if (!recipe) return null
            const ready = !!toPlannerRecipe(recipe)
            return <div className="recipe-collection-result__recipe" key={id}>
              <strong>{recipe.title}</strong>
              {ready ? <div className="recipe-backup-panel__actions">
                <button type="button" onClick={() => planOwnRecipe(recipe, 'planner')}>
                  Plan op {plannerDay}
                </button>
                <button type="button" onClick={() => planOwnRecipe(recipe, 'list')}>
                  Plan en open Lijst
                </button>
                <button type="button" onClick={() => planOwnRecipe(recipe, 'basket')}>
                  Plan en vergelijk eigen winkelprijzen
                </button>
              </div> : <div className="recipe-backup-panel__actions">
                <small>Corrigeer eerst de bronwaarschuwingen, eenheden of gedeeltelijke stuks.</small>
                <button type="button" onClick={() => openSavedRecipeEditor(recipe)}>
                  Corrigeer {recipe.title}
                </button>
              </div>}
            </div>
          })}
        </section>}
      {lastBulkImport && library.raw === lastBulkImport.afterRaw &&
        <div className="recipe-collection-undo" aria-label="Laatste bulkimport terugdraaien">
          {confirmBulkUndo ? <>
            <strong>Alle {lastBulkImport.ids.length} zojuist {lastBulkImport.kind === 'variants'
              ? 'gemaakte portievarianten' : 'geïmporteerde recepten'} verwijderen?</strong>
            <p>Bestaande recepten blijven bewaard. Is één van deze recepten gepland,
              dan weigert Supa de verwijdering en blijft de volledige batch staan.</p>
            <div className="recipe-backup-panel__actions">
              <button type="button" onClick={undoLastBulkRecipeImport}>Bevestig: draai batch terug</button>
              <button type="button" onClick={() => setConfirmBulkUndo(false)}>Annuleer</button>
            </div>
          </> : <button type="button" className="ghost-button" onClick={() => setConfirmBulkUndo(true)}>
            Maak de laatste {lastBulkImport.kind === 'variants' ? 'portievariantenbatch' : 'receptenimport'}
            {' '}van {lastBulkImport.ids.length} recepten ongedaan
          </button>}
        </div>}
      <small>Download maximaal 15 al gecontroleerde recepten per Markdownbestand. Grotere
        verzamelingen kun je in opeenvolgende batches exporteren. Recepten met openstaande
        bron- of hoeveelheidswaarschuwingen of oorspronkelijke bronlinks neem je veilig mee via
        de volledige JSON-back-up hieronder; zo verdwijnen controlepunten en bronvermeldingen niet ongemerkt.</small>
      {collectionError && <p role="alert" className="recipe-error">{collectionError}</p>}
      {collectionMessage && <p role="status">{collectionMessage}</p>}
    </section>
    {!!library.recipes.length && !library.error && <details className="recipe-bulk-grocery-details"
      open={groceryOpen} onToggle={event => setGroceryOpen(event.currentTarget.open)}>
      <summary>Maak één boodschappenlijst van mijn eigen recepten</summary>
      <ImportedRecipeGroceriesPanel recipes={library.recipes}
        recentIds={lastImportedIds} onEdit={recipe => openSavedRecipeEditor(recipe)}
        onAddToOwnList={onAddRecipeGroceries}
        onSavePortionVariants={saveBatchPortionVariants} />
    </details>}
    <section className="recipe-backup-panel" aria-label="Eigen recepten meenemen naar een ander apparaat">
      <h2>Mijn recepten meenemen</h2>
      <p>Maak een privé-backup van je eigen recepten, of herstel een eerdere SUPA-receptenbackup.
        Dit gebruikt alleen je browser, geen upload en geen winkelprijzen. Eigen recepten verschijnen
        pas in Planner nadat ingrediënten, hele fysieke stuks en overige hoeveelheden bevestigd zijn.</p>
      <div className="recipe-backup-panel__actions">
        <button type="button" onClick={downloadOwnRecipes}
          disabled={!!library.error || !library.recipes.length}>
          Download mijn recepten (JSON)
        </button>
        <label>
          Importeer eigen receptenbackup (max. 2 MB)
          <input type="file" accept=".json,application/json"
            disabled={!!library.error || backupBusy}
            onChange={event => {
              void loadOwnRecipeBackup(event.currentTarget.files?.[0])
              event.currentTarget.value = ''
            }} />
        </label>
      </div>
      {backupBusy && <p role="status">Backup wordt lokaal gelezen…</p>}
      {backupPreview && <div className="recipe-backup-panel__review" aria-live="polite">
        <strong>Controleer je import</strong>
        <p>{backupPreview.sourceCount} recepten in het bestand;
          {' '}{backupPreview.alreadyPresent} al exact aanwezig;
          {' '}{backupPreview.additions.length} nieuwe recepten.</p>
        {backupPreview.additions.length > 0 && <ul>
          {backupPreview.additions.map(recipe => <li key={recipe.id}>{recipe.title}</li>)}
        </ul>}
        <div className="recipe-backup-panel__actions">
          <button type="button" onClick={confirmOwnRecipeBackup}
            disabled={!backupPreview.additions.length || !!library.error}>
            Importeer {backupPreview.additions.length} nieuwe recepten
          </button>
          <button type="button" onClick={() => { backupReadVersion.current++; setBackupPreview(null); setBackupError('') }}>
            Annuleren
          </button>
        </div>
      </div>}
      {backupError && <p role="alert" className="recipe-error">{backupError}</p>}
      <small>Onbekende versies, dubbele IDs met andere inhoud en te grote bestanden worden geweigerd.
        Bestaande recepten worden niet automatisch overschreven; je bevestigt elke import zelf.</small>
    </section>
    {!!demo.length && <p className="recipe-note">Zes uitgewerkte SUPA-recepten met ingrediënten en bereidingsstappen, ook beschikbaar in Planner. Dit zijn geen supermarktaanbiedingen; prijzen en besparingen zijn niet geverifieerd.</p>}
    {library.error && <p role="alert">{library.error}</p>}<p role="status" className="hifi-feedback">{message}</p>
    {recentlyDeletedRecipe && !library.error && library.raw === recentlyDeletedRecipe.afterRaw &&
      <button type="button" className="ghost-button" onClick={restoreRecentlyDeletedRecipe}>
        Maak verwijderen ongedaan: {recentlyDeletedRecipe.recipe.title}
      </button>}
    <dialog className="hifi-dialog recipe-dialog" ref={editor} aria-labelledby="recipe-editor-title" onCancel={closeEditor} onClose={() => { request.current?.abort(); setBusy(false) }}>
      <button className="recipe-close" onClick={closeEditor} aria-label="Recept sluiten">×</button><h2 id="recipe-editor-title">{mode === 'url' ? 'Recept importeren' : mode === 'paste' ? 'Receptgegevens lokaal plakken' : mode === 'plain' ? 'Recepttekst lokaal importeren' : editingId ? 'Mijn recept aanpassen' : isVariant ? 'Receptvariant maken' : 'Eigen recept toevoegen'}</h2>
      {mode === 'url' ? <form onSubmit={importLink} className="recipe-form"><p>Plak een openbare receptlink. Daarna kun je ingrediënten, porties en bereiding controleren.</p><label>Receptlink<input required type="url" maxLength={2048} placeholder="https://…" value={url} onChange={e => setUrl(e.target.value)} disabled={busy} /></label><button type="button" disabled={busy} onClick={() => void pasteRecipeLink()}>Plak receptlink vanuit klembord</button>{url.trim() && (publicRecipeLink === null ? <small role="alert">Controleer de openbare HTTPS-receptlink. Inloggegevens en ongeldige links worden niet verstuurd.</small> : publicRecipeLink !== url.trim() ? <small role="status">Privé-inlogparameters of fragmenten worden verwijderd vóór import en opslag. Alleen de openbare receptlink wordt gebruikt.</small> : <small>Deze openbare HTTPS-link wordt pas na je klik opgehaald. Productprijzen blijven onbekend.</small>)}<button className="recipe-primary" disabled={busy || !publicRecipeLink}>{busy ? 'Recept ophalen…' : 'Importeer recept'}</button><button type="button" onClick={() => { request.current?.abort(); setBusy(false); setMode('paste'); setError('') }}>Plak JSON-LD in plaats van de link op te halen</button><button type="button" onClick={() => { request.current?.abort(); setBusy(false); setMode('plain'); setError('') }}>Plak gewone recepttekst</button><button type="button" onClick={() => { request.current?.abort(); setBusy(false); setMode('manual'); setError('') }}>Handmatig toevoegen</button></form>
        : mode === 'plain' ? <form className="recipe-form" onSubmit={importPlainText}>
          <p>Plak een zelf verkregen recept, ook als Markdown uit een notitie of website.
            Nederlandse en Engelse koppen zoals Ingrediënten, Ingredients, Bereiding, Method en Directions worden herkend,
            net als lijstjes en genummerde stappen. Porties en tijd zijn optioneel;
            ontbrekende of onduidelijke hoeveelheden blijven ter controle staan.
            De omzetting blijft lokaal, zonder website- of prijsverzoek.</p>
          <label>Of kies een lokaal tekst- of Markdownbestand (.txt of .md, maximaal 500 kB)
            <input type="file" accept=".txt,.md,text/plain,text/markdown"
              onChange={event => { void loadLocalRecipeSource(event.currentTarget.files?.[0], 'plain'); event.currentTarget.value = '' }} />
          </label>
          {pasteFileMessage && <p role="status">{pasteFileMessage}</p>}
          <label>Recepttekst (maximaal 500 kB)
            <textarea required rows={12} maxLength={500000}
              placeholder={'Pasta met spinazie\nPorties: 2\nTijd: 20 minuten\nIngrediënten:\n- 200 g pasta\n- 100 g spinazie\nBereiding:\n1. Kook pasta'}
              value={pastedSource} onChange={event => setPastedSource(event.target.value)} />
          </label>
          <button className="recipe-primary" type="submit">Zet tekst om naar receptconcept</button>
          <button type="button" onClick={() => { setMode('manual'); setError('') }}>Handmatig toevoegen</button>
        </form>
        : mode === 'paste' ? <form className="recipe-form" onSubmit={importPastedRecipe}>
          <p>Importeer je eigen JSON-LD met schema.org/Recipe of lokaal bewaarde HTML.
            Een oorspronkelijke publieke HTTPS-link is optioneel voor bronvermelding.
            Zonder link blijft dit een privé, handmatig toegevoegd recept.
            Supa verwerkt alles lokaal: geen websitebezoek of uitvoering van code.</p>
          <label>Optionele openbare HTTPS-bronlink (alleen bronvermelding)
            <input type="url" placeholder="https://…" value={url}
              onChange={event => setUrl(event.target.value)} />
          </label>
          <label>Lokaal receptbestand (HTML of JSON-LD, maximaal 500 kB)
            <input type="file" accept=".html,.htm,.json,.jsonld,text/html,application/json"
              onChange={event => { void loadLocalRecipeSource(event.currentTarget.files?.[0]); event.currentTarget.value = '' }} />
          </label>
          {pasteFileMessage && <p role="status">{pasteFileMessage}</p>}
          <label>JSON-LD of HTML-broncode (maximaal 500 kB)
            <textarea required rows={9} maxLength={500000} spellCheck={false}
              placeholder={'{"@type":"Recipe","name":"...","recipeIngredient":[...],"recipeInstructions":[...]}'} 
              value={pastedSource}
              onChange={event => { pasteReadVersion.current++; setPastedSource(event.target.value) }} />
          </label>
          <button className="recipe-primary" type="submit">Lees lokale receptgegevens</button>
          <button type="button" onClick={() => { setMode('manual'); setError('') }}>
            Handmatig invoeren
          </button>
        </form>
        : <form className="recipe-form" onSubmit={check} onChange={() => setPreview(null)}><label>Naam van het recept<input required maxLength={160} value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /></label><div className="recipe-form-row"><label>Porties<input required type="number" min="1" max="1000" value={form.servings} onChange={e => setForm({ ...form, servings: e.target.value })} /></label><label>Minuten<input required type="number" min="1" max="1440" value={form.minutes} onChange={e => setForm({ ...form, minutes: e.target.value })} /></label></div><label>Ingrediënten<textarea required rows={5} placeholder={'200 g rijst\n1 paprika\n250 ml kokosmelk'} value={form.ingredients} onChange={e => setForm({ ...form, ingredients: e.target.value })} /></label><small>Eén ingrediënt per regel, met hoeveelheid en eenheid.</small><label>Bereiding<textarea required rows={5} placeholder="Eén stap per regel" value={form.steps} onChange={e => setForm({ ...form, steps: e.target.value })} /></label>{source && <p>Bron: <a href={source} target="_blank" rel="noopener noreferrer">Bekijk het oorspronkelijke recept</a></p>}<button className="recipe-primary">Controleer recept</button></form>}
      {preview && <section className="recipe-review"><h3>Zo wordt je recept bewaard</h3><ul>{keyed(preview.ingredients, i => i.original).map(({key, value:i}) => <li key={key}>
          <strong>{i.amount !== null
            ? `${i.amount} ${i.unit === 'piece' ? 'stuks' : i.unit} ${i.label}`
            : 'Originele hoeveelheid controleren'}</strong>
          <small> · Originele receptregel: {i.original}</small>
          {i.reviewReason && <small> · {i.reviewReason}</small>}
        </li>)}</ul>{preview.warnings.length > 0 && <div className="recipe-review-warnings" role="alert">
          <strong>Dit recept heeft {preview.warnings.length} openstaande controlepunt(en)</strong>
          <p>Onzekere hoeveelheden, gedeeltelijke stuks of oorspronkelijke bronwaarschuwingen
            blijven ook na opslaan bestaan. Alleen een daadwerkelijke correctie van de
            hoeveelheid of eenheid kan een ingrediëntwaarschuwing opheffen.
            Tot die tijd blijft de Planner- en winkelprijsvergelijking geblokkeerd.</p>
          <ul>{preview.warnings.map((warning, index) =>
            <li key={index}>{warning}</li>)}</ul>
        </div>}
        {sourceOnlyRecipeWarnings(preview).length > 0 && <button type="button"
          className="ghost-button" onClick={() => setPreview(current =>
            current ? acknowledgeRecipeSourceWarnings(current) : null)}>
          Ik heb de oorspronkelijke bronwaarschuwingen zelf nagekeken
        </button>}
        <p>Bij een bronbevestiging verdwijnen alleen algemene bronwaarschuwingen;
          onzekere hoeveelheden en gedeeltelijke stuks blijven te corrigeren.
          Dit levert geen winkelbronrechten, echte prijzen of onafhankelijk bewijs op.</p>
        <p>Bewaren op dit apparaat. Ingrediëntprijzen zijn nog onbekend.</p><button className="recipe-primary" onClick={save} disabled={!!library.error}>{editingId ? 'Wijzigingen opslaan' : isVariant ? 'Variant als nieuw recept opslaan' : 'Opslaan in mijn recepten'}</button></section>}
      {error && <p role="alert" className="recipe-error">{error}</p>}
    </dialog>
    <dialog className="hifi-dialog recipe-dialog" ref={detail} aria-labelledby="recipe-detail-title"><button className="recipe-close" onClick={() => detail.current?.close()} aria-label="Details sluiten">×</button>{selected && <>{'image' in selected && selected.image && <FigmaImage className="hifi-detail-photo" asset={selected.image} alt="" />}<h2 id="recipe-detail-title">{selected.title}</h2><p>{selected.minutes ?? '?'} minuten{'servings' in selected ? ` · ${selected.servings ?? '?'} porties` : ' · ontwerpvoorbeeld'}</p>{'ingredients' in selected ? <><h3>Ingrediënten</h3><ul>{selected.source === 'supa-original-recipe' ? keyed(selected.ingredients, i => i.id).map(({key, value:i}) => <li key={key}>{i.amount} {i.unit === 'piece' ? 'stuks' : i.unit} {i.label}</li>) : keyed(selected.ingredients, i => i.original).map(({key, value:i}) => <li key={key}>{i.original}</li>)}</ul><h3>Bereiding</h3><ol>{keyed(selected.steps, s => s).map(({key, value:s}) => <li key={key}>{s}</li>)}</ol>{'savedAt' in selected && selected.warnings.length > 0 && <section
          className="recipe-review-warnings" aria-label="Openstaande receptcontroles">
          <h3>Controleer dit recept vóór je ermee gaat winkelen</h3>
          <p>De oorspronkelijke import bevat nog {selected.warnings.length}
            {' '}waarschuwing(en). Supa kan deze ingrediënten nog niet veilig
            in Planner, Boodschappen of Vergelijk gebruiken. Je originele tekst blijft bewaard.</p>
          <ul>{selected.warnings.map((warning, index) =>
            <li key={index}>{warning}</li>)}</ul>
          <button type="button" onClick={() => openSavedRecipeEditor(selected)}>
            Corrigeer de oorspronkelijke hoeveelheden
          </button>
        </section>}{'sourceUrl' in selected && selected.sourceUrl && <a href={selected.sourceUrl} target="_blank" rel="noopener noreferrer">Oorspronkelijk recept</a>}<p>Ingrediëntprijzen nog onbekend of alleen een niet-actueel plannervoorbeeld.</p>{'savedAt' in selected && <><div className="recipe-detail-actions"><button type="button" onClick={() => openSavedRecipeEditor(selected)}>Bewerk mijn recept</button><button type="button" onClick={() => openSavedRecipeEditor(selected, true)}>Maak een variant</button><button type="button" onClick={() => requestRecipeRemoval(selected)}>Verwijder ongebruikt recept</button><button type="button" onClick={() => downloadSingleOwnRecipe(selected)}>Download alleen dit recept (JSON)</button><button type="button" onClick={() => downloadOwnRecipeMarkdown(selected)}>Download recept als Markdown</button><button type="button" onClick={() => void copyOwnRecipeMarkdown(selected)}>Kopieer recepttekst</button></div>
        {pendingRecipeRemoval?.id === selected.id &&
          pendingRecipeRemoval.snapshot === JSON.stringify(selected) && (
          <div className="recipe-backup-panel__review" role="group" aria-label="Bevestig recept verwijderen">
            <strong>Weet je zeker dat je dit eigen recept wilt verwijderen?</strong>
            <p>Alleen dit recept verdwijnt van dit apparaat. Geselecteerde Planner-recepten worden beschermd; eerdere privé bronreviews kunnen na een receptwijziging opnieuw nodig zijn.</p>
            <div className="recipe-backup-panel__actions">
              <button type="button" onClick={() => confirmRecipeRemoval(selected)}>Ja, verwijder dit recept</button>
              <button type="button" onClick={() => setPendingRecipeRemoval(null)}>Annuleer</button>
            </div>
          </div>
        )}
        {recipeFileMessage && <p role="status">{recipeFileMessage}</p>}
        <section className="recipe-plan-panel" aria-label="Zet eigen recept direct in de weekplanning">
          <h3>Plan dit eigen recept</h3>
          {toPlannerRecipe(selected) ? <>
            <p>Kies een dag. Supa plaatst dit recept in je Planner en activeert de dag.
              Eerdere prijsopnames moeten opnieuw passen bij de gewijzigde ingrediënten.</p>
            <label>Planner-dag
              <select value={plannerDay} onChange={event => setPlannerDay(event.currentTarget.value)}>
                {m2InitialPlan.map(meal => <option value={meal.day} key={meal.day}>{meal.day}</option>)}
              </select>
            </label>
            <button type="button" onClick={() => planOwnRecipe(selected)}>
              Zet {selected.title} op {plannerDay} in Planner
            </button>
            <button type="button" onClick={() => planOwnRecipe(selected, 'list')}>
              Plan dit recept en open mijn boodschappenlijst
            </button>
            <button type="button" onClick={() => planOwnRecipe(selected, 'basket')}>
              Plan dit recept en open mijn winkelvergelijking
            </button>
            <small>De vergelijking gebruikt alleen zelf ingevoerde en opnieuw gecontroleerde winkelprijzen.
              De boodschappenlijst werkt ook zonder prijzen. Ontbrekende of verlopen winkelprijzen blijven onbekend. Geen JSON-export nodig.</small>
            {privateWeekMessage && <p role="status">{privateWeekMessage}</p>}
          </> : <p>Controleer eerst de hoeveelheid, metrische eenheid en eventuele gedeeltelijke stuks.
            Pas daarna kun je dit recept zonder gokwerk plannen.</p>}
        </section>
        <section className="recipe-shopping-panel" aria-label="Boodschappen voor eigen recept">
          <h3>Mijn boodschappen voor dit recept</h3>
          <p>Maak een ongeprijsde lijst voor het gewenste aantal porties. Stuks die niet heel uitkomen, moet je zelf beoordelen.</p>
          <label>Gewenste porties
            <input type="number" min="1" max="100" step="1" value={shoppingPortions}
              onChange={event => { setShoppingPortions(event.target.value); setPortionVariantPreview(null); setShowShoppingCopy(false); setPrivateWeekMessage(''); setShoppingChecks({}); setShoppingOpenOnly(false) }} />
          </label>
          <button type="button" onClick={() => previewPortionVariant(selected)}>
            Bekijk hoeveelheden voor Planner-variant ({shoppingPortions || '…'} porties)
          </button>
          {portionVariantPreview?.sourceId === selected.id &&
            portionVariantPreview.sourceSnapshot === JSON.stringify(selected) &&
            portionVariantPreview.portions === Number(shoppingPortions) && (
            <div className="recipe-backup-panel__review" role="group"
              aria-label="Controleer alle hoeveelheden vóór bewaren">
              <strong>Nieuwe variant: {portionVariantPreview.draft.title}</strong>
              <p>Deze hoeveelheden worden ongeprijsd bewaard. Productmatching blijft apart.</p>
              <ul>{portionVariantPreview.draft.ingredients.map((ingredient, index) =>
                <li key={index}>{ingredient.original}</li>)}</ul>
              <div className="recipe-backup-panel__actions">
                <button type="button" onClick={() => savePortionVariant(selected)}>
                  Bevestig en bewaar deze variant
                </button>
                <button type="button" onClick={() => {
                  setPortionVariantPreview(null); setRecipeFileMessage('Geen variant opgeslagen.')
                }}>Annuleer</button>
              </div>
            </div>
          )}
          <small>Het originele recept blijft ongewijzigd. Bij gedeeltelijke stuks moet je de variant handmatig maken.
            De nieuwe variant bevat geen nieuwe winkelprijzen of goedgekeurde productmatches.</small>
          {ownShopping && ownShopping.canCopy ? <>
            <div className="recipe-shopping-panel__progress">
              <strong role="status">{shoppingCompleted} van {ownShopping.lines.length} boodschappen afgevinkt</strong>
              <label><input type="checkbox" checked={shoppingOpenOnly}
                onChange={event => setShoppingOpenOnly(event.currentTarget.checked)} /> Alleen nog te kopen</label>
              <button type="button" onClick={() => { setShoppingChecks({}); setShowShoppingCopy(false) }}>Wis vinkjes</button>
            </div>
            <ul>{shoppingVisible.map(line => <li key={line.key}>
              <label className="recipe-shopping-panel__row">
                <input type="checkbox" checked={!!shoppingChecks[line.key]}
                  onChange={event => setShoppingChecks(current => ({ ...current, [line.key]: event.currentTarget.checked }))} />
                <span>{line.needsReview ? `${line.original} — hoeveelheid controleren`
                  : `${line.amount === null ? 'hoeveelheid controleren' : readableRecipeShoppingAmount(line.amount)} ${line.unit === 'piece' ? 'stuks' : line.unit} ${line.label}`}</span>
              </label>
            </li>)}</ul>
            {!shoppingVisible.length && <p role="status">Alle boodschappen voor dit recept afgevinkt.</p>}
            {ownShopping.lines.some(line => line.needsReview) && <p role="status">Onbekende of gedeeltelijke stuks blijven voor handmatige controle gemarkeerd; er wordt niets gegokt.</p>}
            <button type="button" onClick={() => setShowShoppingCopy(value => !value)}>
              {showShoppingCopy ? 'Tekst verbergen' : 'Boodschappenlijst selecteren'}
            </button>
            {showShoppingCopy && <textarea ref={shoppingCopy} readOnly rows={Math.min(20, Math.max(6, ownShopping.lines.length + 4))}
              aria-label="Kopieer mijn ongeprijsde boodschappenlijst"
              value={selectedRecipeShoppingText} onFocus={event => event.currentTarget.select()} />}
            {showShoppingCopy && <button type="button" onClick={() => shoppingCopy.current?.select()}>Selecteer alle tekst</button>}
            {onAddRecipeGroceries && <button type="button"
              onClick={addSingleRecipeToOwnList}>
              Zet openstaande ingrediënten van dit recept op Lijst
            </button>}
            <button type="button" onClick={downloadOwnRecipeChecklist}>Download ongeprijsde lijst (TXT)</button>
            <button type="button" onClick={downloadOwnRecipeChecklistCsv}>Download ongeprijsde lijst (CSV)</button>
            <button type="button" onClick={downloadForPrivateComparison}>Gebruik dit recept in winkelvergelijker (JSON)</button>
            <a href={`${import.meta.env.BASE_URL}private-basket-mapping.html`} target="_blank" rel="noopener noreferrer">Open privéwinkelvergelijker met dit JSON-bestand</a>
            <a href={`${import.meta.env.BASE_URL}private-basket-mapping.html#own-recipe-import`} target="_blank" rel="noopener noreferrer">Of kies mijn lokaal opgeslagen recepten rechtstreeks in de vergelijker</a>
            {privateWeekMessage && <p role="status">{privateWeekMessage}</p>}
          </> : <p role="status">Vul 1 tot 100 hele porties in en controleer de oorspronkelijke hoeveelheid per recept.</p>}
        </section></>}</> : <p>Dit is een kaart uit het oorspronkelijke ontwerp. Ingrediënten en bereiding zijn nog niet beschikbaar.</p>}</>}</dialog>
  </div>
}
