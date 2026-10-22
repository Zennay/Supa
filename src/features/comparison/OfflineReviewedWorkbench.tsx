import { euro as exactEuro } from '../../lib/money.ts'
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { aggregatePlanIngredients, buildOneStoreBasket, type RecipeWithIngredients, type BasketTraceLine, type OneStoreBasket } from '../../domain/basket.ts'
import { compareFullBaskets, samePhysicalDemand } from '../../domain/basketComparison.ts'
import { calculateDecimalPackCount } from '../../domain/decimalPackArithmetic.ts'
import type { PlannedMeal } from '../../domain/types.ts'
import { parseOfflinePriceSnapshots, type OfflinePriceSnapshots, type OfflineStoreProduct } from '../../domain/offlineReviewedImport.ts'
import { LocalTwoStorePriceEditor, type ReviewedRecaptureSeed } from './LocalTwoStorePriceEditor.tsx'
import { ownPriceCapturesToCsv } from './ownPriceCsvExport.ts'
import { exportPrivatePlannerWeek } from './exportPrivatePlannerWeek.ts'
import { exportPrivateBasketSession } from './exportPrivateBasketSession.ts'
import { makePrivateRecaptureCsv } from './privateRecaptureCsv.ts'
import {
  privateFullStoreRecaptureCsv, privatePairedStoreRecaptureCsv,
  privateFullStoreRecaptureGuide, privatePairedStoreRecaptureGuide,
} from '../planner/privateFullStoreRecapture.ts'
import type { CaptureStore } from './plannerPriceCaptureSheet.ts'
import type { PrivateSourceFileHandoff } from './privateSourceFileHandoff.ts'
import { PrivateBasketComparisonExport } from './PrivateBasketComparisonExport.tsx'
import { ComparisonReadiness } from './ComparisonReadiness.tsx'
import { createMixedStoreShoppingPlan } from './mixedStoreShoppingPlan.ts'
// Source-heavy checkout, CSV/HTML exports and portable progress only load
// after BOTH owned source captures become complete and personally reviewed.
const MixedStoreShoppingCard = lazy(async () => {
  const module = await import('./MixedStoreShoppingCard.tsx')
  return { default: module.MixedStoreShoppingCard }
})
// Use the already built standalone one-store trip component, even when
// the other retailer still has missing prices or unreviewed products.
const PrivateStoreTripChecklist = lazy(async () => {
  const module = await import('./PrivateStoreTripChecklist.tsx')
  return { default: module.PrivateStoreTripChecklist }
})
import { privatePackUnitRate, formatPrivateUnitRate, privateUnitPrice } from './privateUnitPrice.ts'
import { rankOwnSourceSuggestions } from './ownSourceSuggestions.ts'
import { automaticallyAcceptedSourceLine } from './automaticSourceMatch.ts'
import { replacePrivateStoreCapture } from './replacePrivateStoreCapture.ts'
import { appendPrivateCaptureProducts } from './appendPrivateCaptureProducts.ts'
import { describePrivateStoreCaptureChange } from './privateStoreCaptureDiff.ts'
import { importPrivateBasketSession } from './importPrivateBasketSession.ts'
import { currentTripKey, loadTripProgress, saveTripProgress } from '../../privateShoppingProgress.ts'
import { createPrivateBasketComparisonCsv } from '../../privateBasketComparisonCsv.ts'
import { UnpricedPlannerChecklist } from './UnpricedPlannerChecklist.tsx'
import { PrivateCapturePastePreview } from './PrivateCapturePastePreview.tsx'
import { PortableBlankCapture } from './PortableBlankCapture.tsx'
import { CaptureMatchingPreview, type PreviewMatchLine } from './CaptureMatchingPreview.tsx'
import { CapturePairedPreview } from './CapturePairedPreview.tsx'
import { completePreviewProposal } from './privateTwoStorePreviewChecklist.ts'
import { samePrivatePhysicalDemand } from './samePrivatePhysicalDemand.ts'
import { readablePlannerDemandAmount } from './plannerPriceCaptureGuide.ts'
import { freshReviewedBaskets, recentOwnCaptureInstant, type PrivateReviewedBaskets, type PrivateCaptureProgress, type PrivateReviewFocus } from './privateReviewedBasketBridge.ts'
import './offlineReviewedWorkbench.css'
const dateTime = new Intl.DateTimeFormat('nl-NL', { dateStyle: 'medium', timeStyle: 'short' })
const stores = ['PLUS', 'DekaMarkt'] as const
type SourceSort = 'relevance' | 'whole-pack' | 'unit-price'
// Some spreadsheet exports and mobile shares arrive as .txt or generic
// application/octet-stream. Recognize only the EXACT existing nine-column
// Supa header, then delegate all source facts to the canonical converter.
// Never infer a retailer, observation time, SKU, package or price from a name.
const privateSourceColumns = [
  'retailer', 'observedAt', 'id', 'name', 'packAmount',
  'packUnit', 'packCount', 'priceCents', 'available',
] as const
function isPrivateCaptureCsv(file: File, source: string): boolean {
  if (/\.(?:csv|tsv)$/iu.test(file.name) || file.type === 'text/csv' ||
      file.type === 'text/tab-separated-values') return true
  const line = source.replace(/^\uFEFF/u, '').split(/\r?\n/u, 1)[0]
  return [',', ';', '\t'].some(separator =>
    line === privateSourceColumns.join(separator) ||
    line === privateSourceColumns.map(column => '"' + column + '"').join(separator))
}
/** Reuse canonical admission for both locally supplied shop snapshots. */
function combineTwoOwnShopCaptures(inputs: readonly string[]): string {
  if (inputs.length !== 2) throw Error('Geef twee afzonderlijke winkelopnames.')
  const captures: unknown[] = []
  const shops = new Set<string>()
  for (const source of inputs) {
    const parsed = parseOfflinePriceSnapshots(source, Date.now())
    const names = Object.keys(parsed.captures)
    if (names.length !== 1) throw Error('Per blad precies één waargenomen winkel.')
    if (shops.has(names[0])) throw Error('Dubbele winkel: kies PLUS en DekaMarkt.')
    shops.add(names[0])
    const original: unknown = JSON.parse(source)
    if (!original || typeof original !== 'object' ||
        !('captures' in original) || !Array.isArray(original.captures) ||
        original.captures.length !== 1) throw Error('Originele opname ongeldig.')
    captures.push(original.captures[0])
  }
  const combined = JSON.stringify({ schema: 'supa-offline-prices-v1', captures })
  const accepted = parseOfflinePriceSnapshots(combined, Date.now())
  if (!accepted.captures.PLUS || !accepted.captures.DekaMarkt)
    throw Error('PLUS of DekaMarkt ontbreekt.')
  return combined
}

const privateTabCheckpointKey = 'supa:private-basket-tab-checkpoint:v1'
function exactPlanCheckpointKey(planKey: string): string {
  let hash = 2166136261
  for (let i = 0; i < planKey.length; i++) {
    hash ^= planKey.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return privateTabCheckpointKey + ':' + (hash >>> 0).toString(16)
}
type Matched = Extract<BasketTraceLine, { status: 'matched' }>
type CapturePreviewStore = {
  retailer: CaptureStore; enteredProducts: number; unobservedRows: number
  appendableNewProducts?: number
  matching?: {
    proposed: number; unresolved: number; total: number
    lines: PreviewMatchLine[]
  }
  observedAt: string; observedNs?: bigint; unavailableProducts: number
  previewProducts: {
    id: string; name: string; packAmount: number | null; packUnit: string
    packCount: number | null; priceCents: number | null; available: boolean
  }[]
}

function pricePerUnit(line: Matched): string | null {
  // One exact decimal per-kg/litre/piece rate in the private workbench,
  // Planner product table, portable comparison and offline HTML report.
  // Never derive the advisory unit rate through binary floating arithmetic.
  return privateUnitPrice(line)?.replace(' / ', ' per ') ?? null
}

/**
 * Only an explicit review of THIS captured article can unlock an in-app total.
 * Changing the physical plan, original capture instant, package, price or SKU
 * changes the key and invalidates any old acceptance synchronously in render.
 */
function reviewedLineKey(store: typeof stores[number], observedAt: string, line: Matched): string {
  return JSON.stringify([
    store, observedAt, line.id, line.ingredientLabel,
    line.requirement.amount, line.requirement.unit, line.productId,
    line.productName, line.pack.amount, line.pack.unit, line.pack.count,
    line.packs, line.pricePerPackCents, line.lineTotalCents,
  ])
}
/** Invalidate only the edited physical ingredient. Unchanged captures,
 * SKU reviews and picked groceries for other requirements stay valid.
 * Serialized identities are generated locally by reviewedLineKey and
 * shoppingTaskKey; malformed entries are simply not trusted as matches. */
function isOwnIngredientKey(key: string, store: typeof stores[number],
  ingredientId: string, ingredientIndex: number): boolean {
  try {
    const parts: unknown = JSON.parse(key)
    return Array.isArray(parts) && parts[0] === store &&
      parts[ingredientIndex] === ingredientId
  } catch { return false }
}
function shoppingTaskKey(store: typeof stores[number], line: BasketTraceLine): string {
  // A trip tick belongs to the exact physical requirement and chosen pack,
  // not a demo store or a potentially changed price.
  return JSON.stringify([
    store, line.id, line.requirement.amount, line.requirement.unit,
    line.status === 'matched' ? line.productId : null,
    line.status === 'matched' ? line.pack.amount : null,
    line.status === 'matched' ? line.pack.unit : null,
    line.status === 'matched' ? line.pack.count : null,
    line.status === 'matched' ? line.packs : null,
  ])
}
function compatibleSourceUnit(demand: BasketTraceLine['requirement']['unit'],
  source: BasketTraceLine['requirement']['unit']): boolean {
  if (demand === 'unknown' || source === 'unknown') return false
  if (demand === source) return true
  return (['g', 'kg'].includes(demand) && ['g', 'kg'].includes(source)) ||
    (['ml', 'l'].includes(demand) && ['ml', 'l'].includes(source))
}
function humanMatchReason(reason: string): string {
  const reasons: Record<string, string> = {
    'own-source SKU explicitly selected by user, not independently verified':
      'Dit originele bronartikel is door jou gekozen en nog niet onafhankelijk gecontroleerd.',
    'query phrase present': 'De ingrediëntnaam komt als herkenbare tekst voor in de productnaam.',
    'pack closely covers requirement': 'De inhoud van het pak sluit goed aan op de benodigde hoeveelheid.',
    'pack covers requirement': 'De verpakking dekt de benodigde hoeveelheid.',
    'pack covers requirement with high oversupply':
      'De verpakking is veel groter dan de benodigde hoeveelheid. Controleer het aantal pakken.',
    'single pack underfills requirement': 'Eén pak is niet genoeg; Supa rondt het aantal benodigde pakken omhoog af.',
    'unit family mismatch': 'De fysieke eenheid past niet bij het ingrediënt.',
    'selected product is absent, duplicated or unavailable in this store capture':
      'Je eerder gekozen broncode ontbreekt of is niet meer prijsklaar in de huidige winkelopname.',
    'score below trust threshold':
      'De automatische overeenkomst is te onzeker. Kies zelf een geobserveerde broncode.',
    'top candidates too close':
      'Meer bronartikelen lijken even goed te passen. Kies en controleer zelf het juiste product.',
    'no candidates': 'Geen geschikte geprijsde bronartikelen gevonden.',
    'ingredient amount unknown or invalid': 'De fysieke ingrediënthoeveelheid ontbreekt of is ongeldig.',
    'basket quantity or price is not trusted': 'De productinhoud of prijs kan niet veilig tot hele verpakkingen worden omgerekend.',
    'basket quantity or pack count is not trusted': 'Het aantal benodigde verpakkingen kan niet veilig worden vastgesteld.',
  }
  if (reasons[reason]) return reasons[reason]
  const overlap = /^(\d+)\/(\d+) query tokens present$/.exec(reason)
  if (overlap) return overlap[1] + ' van ' + overlap[2] + ' zoekwoorden komen overeen met de originele productnaam.'
  const multi = /^multipack count (\d+) applied$/.exec(reason)
  if (multi) return 'Multipack met ' + multi[1] + ' losse verpakkingen is meegenomen in de berekening.'
  return 'Voor dit artikel is nog een handmatige controle van originele naam, code en verpakking nodig.'
}
function sourcePackRate(product: import('../../domain/basket.ts').StoreProduct): string {
  const rate = privatePackUnitRate({
    amount: product.packAmount,
    unit: product.packUnit,
    count: product.packCount ?? 1,
    priceCents: product.available ? product.priceCents : null,
  })
  return rate ? ' · ' + formatPrivateUnitRate(rate) : ''
}
/** Exact whole-pack preview for one original source candidate only.
 * The canonical basket/review gate still decides whether this can become
 * part of a complete priced weekly shop. */
function sourceWholePackCents(product: OfflineStoreProduct,
  required: BasketTraceLine['requirement']): number | null {
  if (!product.available || product.packAmount === null ||
      required.amount === null || !Number.isFinite(required.amount) ||
      required.amount <= 0) return null
  const packs = calculateDecimalPackCount(
    [{ amount: required.amount, unit: required.unit }],
    { amount: product.packAmount, unit: product.packUnit, count: product.packCount ?? 1 })
  if (packs === null || !Number.isSafeInteger(packs) || packs < 1) return null
  const totalCents = packs * product.priceCents
  return Number.isSafeInteger(totalCents) && totalCents >= 0 ? totalCents : null
}
function sourceWholePackPreview(product: OfflineStoreProduct,
  required: BasketTraceLine['requirement'], currentCents: number | null = null): string {
  const total = sourceWholePackCents(product, required)
  if (total === null) return ''
  const packs = calculateDecimalPackCount(
    [{ amount: required.amount!, unit: required.unit }],
    { amount: product.packAmount!, unit: product.packUnit, count: product.packCount ?? 1 })!
  const delta = currentCents === null || !Number.isSafeInteger(currentCents) ? '' :
    total === currentCents ? ' · gelijk aan huidige regel' :
      ' · ' + exactEuro.formatCents(Math.abs(total - currentCents)) +
      (total < currentCents ? ' rekenkundig lager' : ' rekenkundig hoger') +
      ' dan huidige regel (controleer productgelijkwaardigheid)'
  return ' · ' + packs + ' hele pak(ken): ' + exactEuro.formatCents(total) +
    ' voor deze ingrediëntregel' + delta
}
function searchableSourceText(value: string): string {
  // Discoverability only: never change an original source name/SKU/price.
  // A user typing 'creme' should find an observed 'crème' article.
  return value.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase('nl').trim()
}
function sourceOptions(products: OfflineStoreProduct[],
  unit: BasketTraceLine['requirement']['unit'], text: string, keepId: string,
  ingredient: string, requestedAmount: number | null, sort: SourceSort,
  cheaperThanCents: number | null = null, limit = 40, unpricedLimit = 5) {
  const query = searchableSourceText(text)
  const matchesQuery = (product: import('../../domain/basket.ts').StoreProduct) =>
    !query || searchableSourceText(product.name).includes(query) ||
    searchableSourceText(product.id).includes(query)
  const physicallyCompatible = products.filter(p => compatibleSourceUnit(unit, p.packUnit))
  const available = physicallyCompatible.filter(p => p.available && p.packAmount !== null)
  const filtered = rankOwnSourceSuggestions(
    available.filter(matchesQuery), ingredient, requestedAmount, unit, text)
  // Price sorting is DISCOVERY, never an accepted match or a claim about
  // products being interchangeable. Reject impossible whole-pack arithmetic.
  // The existing suggestion rank wins ties and remains the default.
  const wholeCost = (p: OfflineStoreProduct): number | null =>
    sourceWholePackCents(p, { amount: requestedAmount, unit })
  const rate = (p: OfflineStoreProduct): number | null =>
    privatePackUnitRate({ amount: p.packAmount, unit: p.packUnit,
      count: p.packCount ?? 1, priceCents: p.priceCents })?.centsPerUnit ?? null
  const pricedCandidates = cheaperThanCents === null ? filtered : filtered.filter(p => {
    const total = wholeCost(p)
    return total !== null && total < cheaperThanCents &&
      p.id !== keepId
  })
  const ranked = sort === 'relevance' ? pricedCandidates : [...pricedCandidates].sort((a, b) => {
    const left = sort === 'whole-pack' ? wholeCost(a) : rate(a)
    const right = sort === 'whole-pack' ? wholeCost(b) : rate(b)
    return left === null && right === null ? 0 :
      left === null ? 1 : right === null ? -1 : left - right
  })
  const shown = ranked.slice(0, Math.min(1000, Math.max(40, limit)))
  const current = available.find(p => p.id === keepId)
  if (current && !shown.some(p => p.id === keepId)) shown.unshift(current)

  // These are honest original capture records, but not purchasable price
  // candidates. Never put them in the select or recalculate a basket from them.
  const unpriced = physicallyCompatible.filter(p => !p.available || p.packAmount === null)
  const unpricedFiltered = rankOwnSourceSuggestions(
    unpriced.filter(matchesQuery), ingredient, requestedAmount, unit, text)
  return {
    shown, total: pricedCandidates.length, availableCount: available.length,
    unpricedShown: unpricedFiltered.slice(0, Math.min(1000, Math.max(5, unpricedLimit))),
    unpricedTotal: unpricedFiltered.length, unpricedCount: unpriced.length,
  }
}
function explainUnpricedSource(product: OfflineStoreProduct): string {
  const reasons: string[] = []
  if (product.sourceAvailable === false) reasons.push('niet beschikbaar volgens de opname')
  if (product.sourcePriceCents === null) reasons.push('prijs niet vastgelegd')
  if (product.packAmount === null) reasons.push('verpakkingsinhoud ontbreekt')
  return reasons.join(' · ') || 'nog niet volledig prijsklaar'
}
function captureDate(ms: number) { return dateTime.format(new Date(ms)) }
function reviewRowId(store: string, ingredientId: string): string {
  // Codepoints also support malformed user-supplied surrogate sequences without
  // URIError from encodeURIComponent; identifiers never become executable HTML.
  const suffix = Array.from(ingredientId, char => char.codePointAt(0)!.toString(16)).join('-')
  return 'supa-own-review-' + store.toLowerCase() + '-' + suffix
}

/** Human-readable, strictly private companion to the existing canonical CSV.
 * Called only after every original SKU/pack/price has been personally reviewed
 * for both complete, timely captures and the identical physical Planner demand.
 */
function readablePrivateComparison(
  plus: OneStoreBasket, deka: OneStoreBasket,
  captured: { PLUS: string; DekaMarkt: string },
  deltaCents: number,
  rows: { delta: { ingredientLabel: string; deltaCents: number }; plus: Matched; deka: Matched }[],
): string {
  const plain = (s: string) => s.replace(/[\r\n\u2028\u2029\u0000-\u001f\u007f-\u009f]/gu, ' ')
  const money = (cents: number) => exactEuro.formatCents(cents)
  return [
    'SUPA · persoonlijke vergelijking van twee zelf bevestigde winkelopnames',
    'Geen live winkelprijzen, retailerautorisatie of onafhankelijk besparingsbewijs.',
    'Weekmenu: exact dezelfde fysiek geplande ingrediënten voor beide winkels.',
    'PLUS bronmoment: ' + plain(captured.PLUS),
    'DekaMarkt bronmoment: ' + plain(captured.DekaMarkt),
    '',
    'PLUS hele mand: ' + money(plus.totalCents),
    'DekaMarkt hele mand: ' + money(deka.totalCents),
    'Verschil (DekaMarkt minus PLUS): ' + (deltaCents >= 0 ? '+' : '−') + money(Math.abs(deltaCents)),
    '',
    ...rows.flatMap(({ delta, plus: p, deka: d }, index) => [
      (index + 1) + '. ' + plain(delta.ingredientLabel) +
        ' · gevraagd ' + p.requirement.amount + ' ' + p.requirement.unit,
      '  PLUS: ' + plain(p.productName) + ' [broncode ' + plain(p.productId) + ']' +
        ' · ' + p.packs + ' × (' + p.pack.amount + ' ' + p.pack.unit +
        ' × ' + p.pack.count + ') · ' + (pricePerUnit(p) ?? 'eenheidsprijs onbekend') +
        ' · ' + money(p.lineTotalCents),
      '  DekaMarkt: ' + plain(d.productName) + ' [broncode ' + plain(d.productId) + ']' +
        ' · ' + d.packs + ' × (' + d.pack.amount + ' ' + d.pack.unit +
        ' × ' + d.pack.count + ') · ' + (pricePerUnit(d) ?? 'eenheidsprijs onbekend') +
        ' · ' + money(d.lineTotalCents),
      '  Verschil (DekaMarkt minus PLUS): ' +
        (delta.deltaCents >= 0 ? '+' : '−') + money(Math.abs(delta.deltaCents)),
      '',
    ]),
    'Dit overzicht is uitsluitend lokaal samengesteld uit jouw bevestigde gegevens.',
    'Niet verspreiden als onafhankelijk geverifieerde prijs- of besparingsclaim.',
  ].join('\n')
}

function shoppingChecklist(basket: OneStoreBasket, store: typeof stores[number],
  done: Record<string, boolean>, currentAndReviewed: boolean): string {
  // The original source may still contain historic prices. A practical trip
  // remains exportable without presenting stale/unreviewed euros as today's.
  return [
    `Supa · boodschappen voor ${basket.store.name} · eigen bron, geen kassagarantie`,
    currentAndReviewed ? 'Alle regels van dit winkelmandje persoonlijk bevestigd; eigen bronopname nog geldig.' :
      'Prijsinformatie ONBEKEND: bron verlopen of niet alle regels bevestigd. Geen actueel mandtotaal.',
    ...basket.lines.map(line => line.status === 'matched'
      ? `${done[shoppingTaskKey(store, line)] ? '☑' : '☐'} ${line.ingredientLabel}: ${line.packs} × ${line.productName} (` +
        (currentAndReviewed ? exactEuro.formatCents(line.lineTotalCents) : 'prijs onbekend / opnieuw controleren') + ')'
      : `${done[shoppingTaskKey(store, line)] ? '☑' : '☐'} ${line.ingredientLabel}: handmatig kiezen, hoeveelheid ${line.requirement.amount ?? '?'} ${line.requirement.unit} · prijs onbekend`),
    'Alleen eigen brongegevens; geen publieke winkelprijs- of besparingsclaim.',
  ].join('\n')
}

/** Independent opt-in local import. Never treats JSON as evidence of retailer licensing or physical verification. */
export function OfflineReviewedWorkbench({
  plan, recipes, activeDays, planKey, incomingSources, onSourceFilesConsumed, onReviewedBaskets, onCaptureProgress, focusReview,
}: {
  plan: PlannedMeal[]
  recipes: RecipeWithIngredients[]
  activeDays: string[]
  planKey?: string
  incomingSources?: PrivateSourceFileHandoff | null
  onSourceFilesConsumed?: (serial: number) => void
  onReviewedBaskets?: (value: PrivateReviewedBaskets | null) => void
  onCaptureProgress?: (value: PrivateCaptureProgress | null) => void
  focusReview?: PrivateReviewFocus | null
}) {
  // A pasted source is a proposal, never the admitted receipt currently
  // powering reviews, exports, and shopping progress.
  // A separate opt-in recovery slot for each exact physical Planner plan.
  // The original single-slot key stays read-only for backward compatibility.
  const tabCheckpointKey = planKey ? exactPlanCheckpointKey(planKey) : privateTabCheckpointKey
  const [text, setText] = useState('')
  const [pasteDraft, setPasteDraft] = useState('')
  const currentActiveSource = useRef(text)
  currentActiveSource.current = text
  const [imported, setImported] = useState<OfflinePriceSnapshots | null>(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [dropActive, setDropActive] = useState(false)
  const importRevision = useRef(0)
  const lastPlannerFileSerial = useRef(0)
  const currentlySelectedPlan = useRef(planKey)
  currentlySelectedPlan.current = planKey
  const [pendingReplacement, setPendingReplacement] = useState<{
    sourceText: string; newText: string
    version: number; store: typeof stores[number]
    preview: ReturnType<typeof describePrivateStoreCaptureChange>
  } | null>(null)

  const [pendingTwoStore, setPendingTwoStore] = useState<{
    sourceText: string
    newText: string
    version: number
    snapshots: OfflinePriceSnapshots
    changes: { store: typeof stores[number]; previousAt: string | null
      nextAt: string; previousCount: number; nextCount: number
      added: number; removed: number; changed: number
      previousPriced: number; nextPriced: number; unchanged: boolean
      examples: { id: string; name: string; before: string; after: string }[] }[]
  } | null>(null)

  const [weekExportMessage, setWeekExportMessage] = useState('')
  // A browser without clipboard/share permission gets the exact same local
  // missing-source guide as selectable text. No retailer prices or app storage.
  const [portableMissingGuide, setPortableMissingGuide] = useState<{
    source: object; week: string; text: string
  } | null>(null)
  const [captureSheetStore, setCaptureSheetStore] = useState<'both' | CaptureStore>('both')
  const [captureDelimiter, setCaptureDelimiter] = useState<',' | ';' | '\t'>(',')
  const [capturePreviewShown, setCapturePreviewShown] = useState<Record<CaptureStore, number>>({ PLUS: 20, DekaMarkt: 20 })
  const [capturePreviewSearch, setCapturePreviewSearch] = useState<Record<CaptureStore, string>>({ PLUS: '', DekaMarkt: '' })
  const [capturePreviewSort, setCapturePreviewSort] = useState<Record<CaptureStore, 'source' | 'name' | 'sku' | 'price' | 'unknown'>>({ PLUS: 'source', DekaMarkt: 'source' })
  const [capturePreview, setCapturePreview] = useState<{
    files: File[]; week: string
    stores: CapturePreviewStore[]
    unobservedOtherStoreRows: number
    pairedWithin24h: boolean
    retainedOther?: { retailer: CaptureStore; within24h: boolean; observedNs: bigint
      observedAt: string; matching: NonNullable<CapturePreviewStore['matching']> }
  } | null>(null)
  const [reviewedLines, setReviewedLines] = useState<Record<string, boolean>>({})
  const [rejectedAutoReviews, setRejectedAutoReviews] = useState<Record<string, boolean>>({})
  const [manualSku, setManualSku] = useState<Record<typeof stores[number], Record<string, string>>>({
    PLUS: {}, DekaMarkt: {},
  })
  const [skuFilter, setSkuFilter] = useState<Record<string, string>>({})
  const [sourceResultLimit, setSourceResultLimit] = useState<Record<string, number>>({})
  const [sourceUnpricedLimit, setSourceUnpricedLimit] = useState<Record<string, number>>({})
  const [sourceSort, setSourceSort] = useState<Record<string, SourceSort>>({})
  const [onlyCheaper, setOnlyCheaper] = useState<Record<string, boolean>>({})
  const [doneTripItems, setDoneTripItems] = useState<Record<string, boolean>>({})
  const [openTripOnly, setOpenTripOnly] = useState(false)
  const [tripExportMessage, setTripExportMessage] = useState('')
  const [tripProgressMessage, setTripProgressMessage] = useState('')
  const [coverageMessage, setCoverageMessage] = useState('')
  const [coverageScope, setCoverageScope] = useState<'all' | 'open' | 'PLUS' | 'DekaMarkt'>('open')
  const [coverageSearch, setCoverageSearch] = useState('')
  // Prevent stale imports from appearing comparable after an open browser tab
  // crosses a 7-day boundary. Refresh only the UI clock, not source observations.
  const [clockMs, setClockMs] = useState(() => Date.now())
  useEffect(() => {
    const refresh = () => setClockMs(Date.now())
    const interval = window.setInterval(refresh, 60000)
    document.addEventListener('visibilitychange', refresh)
    window.addEventListener('focus', refresh)
    return () => {
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', refresh)
      window.removeEventListener('focus', refresh)
    }
  }, [])

  const plannerCaptureNeeds = useMemo(() => {
    try { return aggregatePlanIngredients(plan, recipes, activeDays) }
    catch { return [] }
  }, [plan, recipes, activeDays])
  const captureWeek = JSON.stringify([planKey ?? null, plannerCaptureNeeds.map(n => [n.id, n.label, n.unit, n.amount])])
  const currentPreview = capturePreview?.week === captureWeek ? capturePreview : null
  const latestCapturePreview = useRef(currentPreview)
  latestCapturePreview.current = currentPreview
  const captureWeekRef = useRef(captureWeek)
  captureWeekRef.current = captureWeek
  const freshPreviewInstant = (observedNs?: bigint): boolean => {
    if (observedNs === undefined || !Number.isSafeInteger(clockMs)) return false
    const age = BigInt(Math.trunc(clockMs)) * 1_000_000n - observedNs
    return age >= -300_000_000_000n && age <= 604_800_000_000_000n
  }
  const capturePreviewFresh = (store: CapturePreviewStore) =>
    freshPreviewInstant(store.observedNs)
  const previewPlusLines = currentPreview?.stores.find(store => store.retailer === 'PLUS')?.matching?.lines ??
    (currentPreview?.retainedOther?.retailer === 'PLUS' ? currentPreview.retainedOther.matching.lines : null)
  const previewDekaLines = currentPreview?.stores.find(store => store.retailer === 'DekaMarkt')?.matching?.lines ??
    (currentPreview?.retainedOther?.retailer === 'DekaMarkt' ? currentPreview.retainedOther.matching.lines : null)
  const previewPlusAt = currentPreview?.stores.find(store => store.retailer === 'PLUS')?.observedAt ??
    (currentPreview?.retainedOther?.retailer === 'PLUS' ? currentPreview.retainedOther.observedAt : '')
  const previewDekaAt = currentPreview?.stores.find(store => store.retailer === 'DekaMarkt')?.observedAt ??
    (currentPreview?.retainedOther?.retailer === 'DekaMarkt' ? currentPreview.retainedOther.observedAt : '')
  const previewPairFresh = !!currentPreview && currentPreview.stores.every(capturePreviewFresh) &&
    (!currentPreview.retainedOther || freshPreviewInstant(currentPreview.retainedOther.observedNs))
  const previewPair24h = !!currentPreview && (currentPreview.retainedOther
    ? currentPreview.retainedOther.within24h : currentPreview.pairedWithin24h)


  function previewMatching(retailer: CaptureStore, products: OfflineStoreProduct[]): NonNullable<CapturePreviewStore['matching']> {
    const basket = buildOneStoreBasket({
      store: { id: retailer, name: retailer },
      plan, recipes, activeDays, products,
    })
    return {
      proposed: basket.matchedLineCount,
      unresolved: basket.unresolvedLineCount,
      total: basket.lines.length,
      lines: basket.lines.map(line => ({
        id: line.id, label: line.ingredientLabel,
        amount: line.requirement.amount, unit: line.requirement.unit,
        status: line.status,
        product: line.status === 'matched' ? line.productName : null,
        originalSku: line.status === 'matched' ? line.productId : null,
        packs: line.status === 'matched' ? line.packs : null,
        packAmount: line.status === 'matched' ? line.pack.amount : null,
        packUnit: line.status === 'matched' ? line.pack.unit : null,
        packCount: line.status === 'matched' ? line.pack.count : null,
        pricePerPackCents: line.status === 'matched' ? line.pricePerPackCents : null,
        lineTotalCents: line.status === 'matched' ? line.lineTotalCents : null,
        unitPrice: line.status === 'matched' ? privateUnitPrice(line) : null,
        reasons: line.reasons,
      })),
    }
  }

  function invalidateOwnMobileSourcePreview() {
    // When an original mobile draft changes, discard the asynchronous
    // candidate instead of letting a late import overwrite newer input.
    ++importRevision.current
    setCapturePreview(null)
    setWeekExportMessage('Je eigen nog onbevestigde winkelinvoer is gewijzigd. Bekijk de nieuwe bron opnieuw.')
  }

  async function previewFilledCsv(files: File[]): Promise<boolean> {
    if (files.length === 0) return false
    const version = ++importRevision.current
    setCapturePreview(null)
    setCapturePreviewShown({ PLUS: 20, DekaMarkt: 20 })
    setCapturePreviewSearch({ PLUS: '', DekaMarkt: '' })
    setCapturePreviewSort({ PLUS: 'source', DekaMarkt: 'source' })
    setBusy(true)
    try {
      if (files.length > 2) throw Error('Kies maximaal twee eigen CSV-bestanden.')
      const converterUrl = `${import.meta.env.BASE_URL}offline-two-store-csv.mjs`
      const module: unknown = await import(/* @vite-ignore */ converterUrl)
      if (!module || typeof module !== 'object' ||
        !('previewOwnStoreCsv' in module) || typeof module.previewOwnStoreCsv !== 'function' ||
        !('convertOwnStoreCsv' in module) || typeof module.convertOwnStoreCsv !== 'function')
        throw Error('De lokale CSV-converter is niet beschikbaar.')
      const storesInPreview: CapturePreviewStore[] = []
      const captures: unknown[] = []
      let blankOtherRows = 0
      const seen = new Set<string>()
      for (const file of files) {
        if (!file.size || file.size > 256000)
          throw Error('Elk ingevuld CSV-bestand moet gevuld zijn en maximaal 256 kB bevatten.')
        const raw = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer())
        const summary = (module.previewOwnStoreCsv as (v: string) => {
          stores: CapturePreviewStore[]; unobservedOtherStoreRows: number
        })(raw)
        const normalized = (module.convertOwnStoreCsv as (v: string) => string)(raw)
        const parsed = JSON.parse(normalized) as { captures: { retailer: CaptureStore }[] }
        // Each file is admitted individually and the pair is admitted again
        // as one full source. No guessed second retailer or synthesized price.
        parseOfflinePriceSnapshots(normalized, Date.now())
        if (files.length === 2 && summary.stores.length !== 1)
          throw Error('Kies twee afzonderlijke CSV-bestanden met elk precies één werkelijk ingevulde winkel.')
        for (const store of summary.stores) {
          if (seen.has(store.retailer))
            throw Error('Twee prijsbladen bevatten dezelfde winkel. Kies één PLUS- en één DekaMarkt-opname.')
          seen.add(store.retailer)
          storesInPreview.push(store)
        }
        blankOtherRows += summary.unobservedOtherStoreRows
        captures.push(...parsed.captures)
      }
      const combined = parseOfflinePriceSnapshots(JSON.stringify({
        schema: captures.length === 2
          ? 'supa-offline-prices-v1' : 'supa-private-single-store-prices-v1',
        captures,
      }), Date.now())
      if (files.length === 2) blankOtherRows = 0
      // Preview the SAME conservative matcher as the final shopping route.
      // These are unverified proposals, never confirmed pricing or savings.
      for (const entry of storesInPreview) {
        const source = combined.captures[entry.retailer]
        if (!source) throw Error('Een winkelbron ontbreekt in de gekoppelde opname.')
        entry.observedNs = source.observedNs
        const previousCapture = imported?.captures[entry.retailer]
        if (files.length === 1 && storesInPreview.length === 1 &&
            previousCapture && previousCapture.observedAt === source.observedAt &&
            source.products.length > 0) {
          const previousIds = new Set(previousCapture.products.map(item => item.id))
          const age = BigInt(Date.now()) * 1_000_000n - previousCapture.observedNs
          if (age >= -300_000_000_000n && age <= 604_800_000_000_000n &&
              source.products.every(item => !previousIds.has(item.id))) {
            entry.appendableNewProducts = source.products.length
          }
        }
        // A valid append adds genuine new SKUs while retaining the original
        // immutable capture. Preview the actual resulting entire catalogue,
        // not only the appended rows (which would falsely mark prior matches
        // missing). No previous human approval is manufactured.
        const projectedProducts = entry.appendableNewProducts && previousCapture
          ? [...previousCapture.products, ...source.products] : source.products
        entry.matching = previewMatching(entry.retailer, projectedProducts)
      }
      if (version !== importRevision.current || captureWeek !== captureWeekRef.current) return false
      // One newly imported store can be compared with the independently
      // retained other capture, not merely the stores inside this CSV file.
      // Never invent a missing retailer instant or silently refresh the old one.
      let retainedOther: NonNullable<NonNullable<typeof capturePreview>['retainedOther']> | undefined
      if (storesInPreview.length === 1) {
        const otherStore = stores.find(store => store !== storesInPreview[0].retailer)!
        const other = imported?.captures[otherStore]
        const incoming = combined.captures[storesInPreview[0].retailer]
        if (other && incoming) {
          const gap = other.observedNs > incoming.observedNs
            ? other.observedNs - incoming.observedNs : incoming.observedNs - other.observedNs
          retainedOther = {
            retailer: otherStore,
            within24h: gap <= 86_400_000_000_000n,
            observedNs: other.observedNs,
            observedAt: other.observedAt,
            // Existing accepted source is only a *proposed* match in this
            // pre-import comparison; original facts, time and SKU stay intact.
            matching: previewMatching(otherStore, other.products),
          }
        }
      }
      if (version !== importRevision.current || captureWeek !== captureWeekRef.current) return false
      setCapturePreview({
        files, week: captureWeek, stores: storesInPreview,
        unobservedOtherStoreRows: blankOtherRows,
        pairedWithin24h: combined.pairedWithin24h, retainedOther,
      })
      setWeekExportMessage('Eigen CSV-bronopnames lokaal gecontroleerd. Bekijk beide winkels en neem de brondata bewust over.')
      return true
    } catch (e) {
      if (version === importRevision.current) setWeekExportMessage(
        (e instanceof Error ? e.message : 'CSV ongeldig.') +
        ' Vorige winkeldata en productbevestigingen zijn behouden.')
      return false
    } finally { if (version === importRevision.current) setBusy(false) }
  }

  // Both the TXT download and mobile copy/share use THIS identical list of
  // unresolved original physical needs. This is not a product/price adapter.
  function missingPreviewGuide(): { text: string; count: number } {
    if (!currentPreview || busy) throw Error('Er is geen actuele bronpreview.')
    const clean = (value: string) =>
      value.replace(/[\\p{Cc}\\p{Cf}\\p{Zl}\\p{Zp}]/gu, ' ').trim().slice(0, 180)
    const lines = [
      'SUPA · ontbrekende prijzen voor het huidige echte weekmenu',
      'Dit is GEEN retailerproduct, prijsopname, bronautorisatie of besparingsbewijs.',
      'Controleer zelf originele SKU, verpakking, bronmoment en echte prijs per winkel.',
      '',
    ]
    let count = 0
    for (const store of stores) {
      const observation = currentPreview.stores.find(entry => entry.retailer === store)
      const needs = missingPreviewCaptureNeeds(store, Date.now())
      if (!observation && imported?.captures[store] && !needs.length) {
        lines.push(store + ' · andere eigen bronopname bestaat al; geen ontbrekende winkel gefingeerd.')
        lines.push('Gebruik na acceptatie de volledige winkeldekking om bestaande SKU’s en open controles te bekijken.', '')
        continue
      }
      lines.push(store + (observation
        ? needs.length === plannerCaptureNeeds.length && plannerCaptureNeeds.length > 0 &&
            (observation.observedNs === undefined ||
              !recentOwnCaptureInstant(observation.observedAt, Date.now()))
          ? ' · bronmoment verlopen: alle originele weekartikelen opnieuw controleren:'
          : ' · opname aanwezig, openstaande productmatches:'
        : imported?.captures[store]
          ? ' · opgeslagen opname niet actueel of niet gepaard; hele nieuwe bron nodig:'
          : ' · nog geen eigen winkelopname:'))
      if (!needs.length) lines.push('Geen openstaande matchingvoorstellen op basis van dit eigen bronblad.')
      for (const need of needs) {
        count++
        lines.push('- ' + clean(need.label) + ' · benodigd ' +
          (need.amount === null ? 'onbekend' : readablePlannerDemandAmount(need.amount)) +
          ' ' + clean(need.unit) + ' · zelf oorspronkelijk winkelproduct controleren')
      }
      lines.push('')
    }
    if (!count) throw Error('Geen ontbrekende matches. Bevestig alsnog de originele SKU’s en prijzen in Vergelijk.')
    lines.push('Onbekende regels zijn niet gelijk aan €0. Vul alleen echte rechtmatig verkregen gegevens in.')
    const text = lines.join('\\n') + '\\n'
    if (new TextEncoder().encode(text).length > 256000)
      throw Error('Lijst te groot voor lokaal gebruik.')
    return { text, count }
  }

  function downloadMissingFromPreview() {
    if (!currentPreview || busy) return
    try {
      const { text, count } = missingPreviewGuide()
      const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }))
      try {
        const link = document.createElement('a')
        link.href = url
        link.download = 'supa-alleen-ontbrekende-winkelproducten.txt'
        document.body.append(link)
        try { link.click() } finally { link.remove() }
      } finally { window.setTimeout(() => URL.revokeObjectURL(url), 1000) }
      setWeekExportMessage(count + ' nog openstaande fysieke winkelbehoeften lokaal opgeslagen; geen producten of prijzen verzonnen.')
    } catch (error) {
      setWeekExportMessage(error instanceof Error ? error.message :
        'Onbekende producten konden niet veilig lokaal worden gedownload.')
    }
  }

  async function downloadMissingPreviewCsv(delimiter: ',' | ';') {
    if (!currentPreview || busy) return
    const preview = currentPreview
    const week = captureWeek
    const revision = importRevision.current
    try {
      const needs = {
        PLUS: missingPreviewCaptureNeeds('PLUS', Date.now()),
        DekaMarkt: missingPreviewCaptureNeeds('DekaMarkt', Date.now()),
      }
      if (!needs.PLUS.length && !needs.DekaMarkt.length)
        throw Error('Geen ontbrekende bronartikelen voor een nieuw invulblad.')
      // Canonical nine-column CSV producer: its SKU, amount, availability,
      // observedAt and price cells deliberately stay UNOBSERVED.
      const { selectiveTwoStoreCaptureCsv, selectiveTwoStoreCaptureGuide } =
        await import('../planner/selectiveTwoStoreCapture.ts')
      if (revision !== importRevision.current || week !== captureWeekRef.current ||
          latestCapturePreview.current !== preview ||
          JSON.stringify(needs) !== JSON.stringify({
            PLUS: missingPreviewCaptureNeeds('PLUS', Date.now()),
            DekaMarkt: missingPreviewCaptureNeeds('DekaMarkt', Date.now()),
          })) throw Error('De opnames of weekbehoeften zijn gewijzigd. Maak het actuele blad opnieuw.')
      const content = selectiveTwoStoreCaptureCsv(needs, delimiter)
      // No tenth column is allowed in the strict source importer. Show the
      // companion mapping of EXACT CSV line numbers -> original Planner needs.
      const guide = selectiveTwoStoreCaptureGuide(needs)
      const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }))
      try {
        const link = document.createElement('a')
        link.href = url
        link.download = 'supa-ontbrekende-plus-deka-' +
          (delimiter === ';' ? 'spreadsheet' : 'import') + '.csv'
        document.body.append(link)
        try { link.click() } finally { link.remove() }
      } finally { window.setTimeout(() => URL.revokeObjectURL(url), 1000) }
      setPortableMissingGuide({ source: preview, week, text: guide })
      setWeekExportMessage('Leeg broninvulblad voor ' + needs.PLUS.length +
        ' PLUS- en ' + needs.DekaMarkt.length +
        ' DekaMarkt-artikelen opgeslagen. De rijgids hieronder koppelt elke lege ' +
        'CSV-regel aan de originele Planner-behoefte. Vul uitsluitend echte SKU, verpakking, ' +
        'prijs, beschikbaarheid en bronmoment in; importeer daarna opnieuw in Vergelijk.')
    } catch (error) {
      setWeekExportMessage(error instanceof Error ? error.message :
        'Kon het ontbrekende invul-CSV niet veilig maken.')
    }
  }

  async function shareMissingFromPreview(action: 'copy' | 'share') {
    if (!currentPreview || busy) return
    setPortableMissingGuide(null)
    const preview = currentPreview
    const week = captureWeek
    const revision = importRevision.current
    try {
      const { text, count } = missingPreviewGuide()
      // The user may replace both files while a share/clipboard promise waits.
      // A stale guide is never presented as the currently admitted source.
      const samePreview = () => importRevision.current === revision &&
        captureWeekRef.current === week && latestCapturePreview.current === preview
      if (!samePreview()) throw Error('De bronpreview is veranderd. Bekijk de actuele ontbrekende artikelen.')
      if (action === 'share' && typeof navigator.share === 'function') {
        await navigator.share({ title: 'Supa · ontbrekende winkelproducten', text })
        if (samePreview()) setWeekExportMessage(count +
          ' ongeprijsde artikelen aangeboden aan jouw mobiele deelmenu.')
      } else if (navigator.clipboard?.writeText) {
        try {
          await navigator.clipboard.writeText(text)
          if (samePreview()) setWeekExportMessage(count +
            ' ongeprijsde winkelartikelen gekopieerd; geen winkelprijzen of besparingsclaim.')
        } catch {
          if (!samePreview()) throw Error('Bronpreview gewijzigd tijdens kopiëren.')
          setPortableMissingGuide({ source: preview, week, text })
          setWeekExportMessage('Klembord geweigerd. Selecteer de volledige lokale lijst hieronder.')
        }
      } else {
        if (!samePreview()) throw Error('Bronpreview gewijzigd tijdens kopiëren.')
        setPortableMissingGuide({ source: preview, week, text })
        setWeekExportMessage('Klembord niet beschikbaar. Selecteer de lokale lijst hieronder.')
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        setWeekExportMessage('Delen geannuleerd; jouw bronbestanden blijven behouden.')
      } else if (importRevision.current === revision && captureWeekRef.current === week &&
          latestCapturePreview.current === preview) {
        try {
          const { text } = missingPreviewGuide()
          setPortableMissingGuide({ source: preview, week, text })
          setWeekExportMessage('Mobiel delen geweigerd; selecteer de lokale ongeprijsde lijst hieronder.')
        } catch {
          setWeekExportMessage('De bronpreview is veranderd. Maak de lijst opnieuw.')
        }
      } else {
        setWeekExportMessage('De bronpreview is veranderd. Maak de lijst opnieuw.')
      }
    }
  }

  // Use physical Planner needs only; a match hint never becomes a retailer SKU.
  function missingPreviewCaptureNeeds(store: CaptureStore, now = Date.now()) {
    if (!currentPreview) return []
    const source = currentPreview.stores.find(item => item.retailer === store)
    if (source) {
      // A still-open preview is NOT permanent price evidence. If its captured
      // instant expired, all items need a new genuine observation.
      if (source.observedNs === undefined ||
          !recentOwnCaptureInstant(source.observedAt, now)) return plannerCaptureNeeds
      // Two valid but distant store sources also cannot be compared. Ask
      // for recapture of the older shop rather than just unmatched SKU rows.
      const other = currentPreview.stores.find(item => item.retailer !== store)
      const retained = currentPreview.retainedOther
      if ((other && !currentPreview.pairedWithin24h &&
            other.observedNs !== undefined && source.observedNs < other.observedNs) ||
          (retained && retained.retailer !== store && !retained.within24h &&
            source.observedNs < retained.observedNs)) {
        return plannerCaptureNeeds
      }
      const incomplete = new Set(source.matching?.lines.filter(line =>
        !completePreviewProposal(line)).map(line => line.id) ?? [])
      return plannerCaptureNeeds.filter(need => incomplete.has(need.id))
    }
    // With one new upload and one retained capture, a 24-hour mismatch
    // requires a repeat of the OLDER shop, not always the retained shop.
    // Never instruct the shopper to replace a newer, still-valid observation.
    if (imported?.captures[store]) {
      const kept = currentPreview.retainedOther
      if (!kept || kept.retailer !== store) return plannerCaptureNeeds
      if (!freshPreviewInstant(kept.observedNs)) return plannerCaptureNeeds
      const incoming = currentPreview.stores.find(item => item.retailer !== store)
      if (!kept.within24h && incoming?.observedNs !== undefined &&
          kept.observedNs < incoming.observedNs) return plannerCaptureNeeds
      const incomplete = new Set(kept.matching.lines.filter(line =>
        !completePreviewProposal(line)).map(line => line.id))
      return plannerCaptureNeeds.filter(need => incomplete.has(need.id))
    }
    return plannerCaptureNeeds
  }

  async function downloadPreviewMissingCapture(store: CaptureStore, kind: 'csv' | 'guide') {
    if (!currentPreview || busy) return
    const needs = missingPreviewCaptureNeeds(store)
    if (!needs.length) return
    const revision = importRevision.current
    const selectedWeek = captureWeek
    try {
      const content = kind === 'csv'
        ? (await import('./plannerPriceCaptureSheet.ts')).makeBlankPlannerCaptureCsv(needs, [store], captureDelimiter)
        : (await import('./plannerPriceCaptureGuide.ts')).makePlannerCaptureGuide(needs, [store])
      if (revision !== importRevision.current || selectedWeek !== captureWeekRef.current) {
        setWeekExportMessage('Weekmenu of bronimport is veranderd. Bekijk eerst de actuele ontbrekende regels.')
        return
      }
      const url = URL.createObjectURL(new Blob([content], { type:
        kind === 'csv' ? 'text/csv;charset=utf-8' : 'text/plain;charset=utf-8' }))
      try {
        const link = document.createElement('a')
        link.href = url
        link.download = 'supa-' + store.toLowerCase() + '-ontbrekend-' + needs.length +
          (kind === 'csv' ? '.csv' : '-gids.txt')
        document.body.append(link)
        try { link.click() } finally { link.remove() }
      } finally { window.setTimeout(() => URL.revokeObjectURL(url), 1000) }
      setWeekExportMessage(store + ': ' + needs.length + ' fysieke bronregels als ' +
        (kind === 'csv' ? 'leeg CSV' : 'opnamegids') +
        ' gedownload. Er zijn geen originele SKU’s, observatietijden of prijzen ingevuld.')
    } catch {
      setWeekExportMessage('Kort opnameblad niet beschikbaar; gebruik het volledige lege Planner-blad.')
    }
  }

  function applyPreviewCsv() {
    if (!currentPreview || busy) return
    const files = currentPreview.files
    const file = files[0]
    const incoming = currentPreview.stores.map(s => s.retailer)
    const previous = imported ? Object.keys(imported.captures) : []
    if (files.length === 2)
      void loadSelectedSources(files)
    else if (incoming.length === 1 && currentPreview.stores[0].appendableNewProducts &&
             imported?.captures[incoming[0]])
      void appendSameCapture(incoming[0], file)
    else if (incoming.length === 1 && imported?.captures[incoming[0]])
      void replaceStoreFile(incoming[0], file)
    else if (incoming.length === 1 && previous.length === 1)
      void loadFile(file, true)
    else if (previous.length === 0 || window.confirm(
      'Deze bron vervangt eerdere winkelopnames en productbevestigingen. Doorgaan?'))
      void loadFile(file)
    else return
    setCapturePreview(null)
  }

  function saveSelectedWeek() {
    try {
      const json = exportPrivatePlannerWeek(plan, recipes, activeDays)
      const blob = new Blob([json], { type: 'application/json;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      try {
        const a = document.createElement('a')
        a.href = url
        a.download = 'supa-geselecteerd-weekmenu-prive.json'
        document.body.appendChild(a)
        try { a.click() } finally { a.remove() }
      } finally {
        window.setTimeout(() => URL.revokeObjectURL(url), 1000)
      }
      setWeekExportMessage('Je geselecteerde weekmenu is lokaal gedownload. Open het bestand in de privévergelijker onder stap 2. Geen winkelprijzen of winkelproduct-ID’s meegestuurd.')
    } catch {
      setWeekExportMessage('Weekmenu niet exporteerbaar. Controleer geselecteerde dagen, eigen recepten en metrische hoeveelheden in Planner.')
    }
  }

  async function downloadBlankPlannerCaptureCsv() {
    try {
      const target = captureSheetStore
      const storesToCapture: readonly CaptureStore[] = target === 'both'
        ? stores : [target]
      const { makeBlankPlannerCaptureCsv } = await import('./plannerPriceCaptureSheet.ts')
      const csv = makeBlankPlannerCaptureCsv(plannerCaptureNeeds, storesToCapture, captureDelimiter)
      const url = URL.createObjectURL(new Blob([csv], { type: captureDelimiter === '\t'
        ? 'text/tab-separated-values;charset=utf-8' : 'text/csv;charset=utf-8' }))
      try {
        const link = document.createElement('a')
        link.href = url
        link.download = 'supa-weekmenu-eigen-prijsopname-' +
          (target === 'both' ? 'PLUS-DekaMarkt' : target) +
          (captureDelimiter === ';' ? '-excel' : '') +
          (captureDelimiter === '\t' ? '.tsv' : '.csv')
        document.body.append(link)
        try { link.click() } finally { link.remove() }
      } finally { window.setTimeout(() => URL.revokeObjectURL(url), 1000) }
      setWeekExportMessage('Leeg CSV-invulblad voor ' + (target === 'both' ? 'beide winkels' : target) + ' gedownload. De andere winkel kun je later apart importeren. Zonder echte productcodes, verpakking, bronmoment, beschikbaarheid en prijs wordt niets geprijsd.')
    } catch {
      setWeekExportMessage('Geen geldig weekmenu voor het prijsinvulblad. Controleer eerst je Planner-ingrediënten en hoeveelheden.')
    }
  }

  async function downloadPlannerCaptureGuide() {
    try {
      const target = captureSheetStore
      const selected: readonly CaptureStore[] = target === 'both'
        ? stores : [target]
      const { makePlannerCaptureGuide } = await import('./plannerPriceCaptureGuide.ts')
      const guide = makePlannerCaptureGuide(plannerCaptureNeeds, selected)
      const url = URL.createObjectURL(new Blob([guide], { type: 'text/plain;charset=utf-8' }))
      try {
        const link = document.createElement('a')
        link.href = url
        link.download = target === 'both'
          ? 'supa-weekmenu-PLUS-Deka-opnamegids.txt'
          : 'supa-weekmenu-' + target + '-opnamegids.txt'
        document.body.append(link)
        try { link.click() } finally { link.remove() }
      } finally { window.setTimeout(() => URL.revokeObjectURL(url), 1000) }
      setWeekExportMessage('Opnamegids lokaal gedownload. De CSV-regels en oorspronkelijke Planner-hoeveelheden staan erin; bronproducten en prijzen moet je zelf echt vastleggen.')
    } catch {
      setWeekExportMessage('Geen geldig weekmenu voor de opnamegids. Controleer de Planner-ingrediënten.')
    }
  }

  async function downloadPrintablePlannerCapture() {
    try {
      const target = captureSheetStore
      const selected: readonly CaptureStore[] = target === 'both'
        ? stores : [target]
      const { makePrintablePlannerCaptureHtml } = await import('./plannerPriceCapturePrint.ts')
      const html = makePrintablePlannerCaptureHtml(plannerCaptureNeeds, selected)
      const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }))
      try {
        const link = document.createElement('a')
        link.href = url
        link.download = target === 'both'
          ? 'supa-weekmenu-PLUS-Deka-opnameformulier.html'
          : 'supa-weekmenu-' + target + '-opnameformulier.html'
        document.body.append(link)
        try { link.click() } finally { link.remove() }
      } finally { window.setTimeout(() => URL.revokeObjectURL(url), 1000) }
      setWeekExportMessage('Printbaar opnameformulier lokaal opgeslagen. Open de HTML zonder internet en print het; schrijf alleen echte bronproducten, verpakkingen en prijzen op. Vul later de bijhorende CSV in.')
    } catch {
      setWeekExportMessage('Geen geldig weekmenu voor het opnameformulier. Controleer de Planner-ingrediënten.')
    }
  }

  function portableSessionText(): string {
    if (!imported || !basketPair) throw Error('Maak eerst een geldige lokale winkelmand.')
    const selected = { PLUS: {} as Record<string, string>, DekaMarkt: {} as Record<string, string> }
      for (const store of stores) {
        const capture = imported.captures[store]
        const basket = store === 'PLUS' ? basketPair.plus : basketPair.deka
        if (!basket || !capture) continue
        for (const line of basket.lines) {
          if (line.status !== 'matched') continue
          // A consciously chosen SKU can travel, but the independent
          // wizard must still ask the user to inspect source/matches.
          const explicit = manualSku[store][line.id] === line.productId
          const reviewed = isAcceptedKey(reviewedLineKey(store, capture.observedAt, line))
          if (explicit || reviewed) selected[store][line.id] = line.productId
        }
      }
    return exportPrivateBasketSession({
      plan, recipes, activeDays, rawSource: text, selected,
    })
  }

  function downloadPortableSession() {
    if (!imported || !basketPair) return
    try {
      const session = portableSessionText()
      const url = URL.createObjectURL(new Blob([session], { type: 'application/json;charset=utf-8' }))
      try {
        const link = document.createElement('a')
        link.href = url
        link.download = 'supa-prive-mand-sessie.json'
        document.body.append(link)
        try { link.click() } finally { link.remove() }
        setMessage('Privésessie lokaal bewaard. Open hem in de uitgebreide privévergelijker onder Herstel privésessie. De bronmomenten en productkeuzes moeten opnieuw worden gecontroleerd.')
      } finally { window.setTimeout(() => URL.revokeObjectURL(url), 1000) }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Kan deze privémand-sessie niet maken.')
    }
  }

  function saveTabCheckpoint() {
    try {
      const session = portableSessionText()
      const existing = window.sessionStorage.getItem(tabCheckpointKey)
      if (existing !== null && !window.confirm(
        'Er bestaat al een privéherstelpunt voor dit exacte weekmenu. Vervang het bewust door de huidige bron en artikelkeuzes?')) return
      window.sessionStorage.setItem(tabCheckpointKey, session)
      setMessage('Privéherstelpunt voor dit weekmenu bewaard in deze browsertab. Bij herladen kun je de bron en SKU-keuzes terughalen; alle reviews moeten opnieuw. Download JSON voor langer bewaren.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message :
        'Opslaan van het privéherstelpunt is niet gelukt. Gebruik de JSON-download.')
    }
  }

  function restoreTabCheckpoint() {
    ++importRevision.current
    setPendingReplacement(null)
    setBusy(false)
    try {
      const saved = window.sessionStorage.getItem(tabCheckpointKey) ??
        (tabCheckpointKey === privateTabCheckpointKey ? null :
          window.sessionStorage.getItem(privateTabCheckpointKey))
      if (saved === null) throw Error('Geen privéherstelpunt voor dit weekmenu gevonden.')
      const result = importPrivateBasketSession({
        text: saved, plan, recipes, activeDays, now: Date.now(),
      })
      if (!window.confirm(
        'Dit herstelpunt hoort bij je huidige fysieke weekmenu. Vervang de huidige winkelbron en SKU-keuzes? Alle productbevestigingen en afvinkingen worden opnieuw gestart.')) return
      setText(result.rawSource)
      setImported(result.captured)
      setManualSku(result.selected)
      setSkuFilter({})
      setReviewedLines({})
      setDoneTripItems({})
      setClockMs(Date.now())
      setTripExportMessage('')
      setTripProgressMessage('')
      setMessage('De originele privébron en keuzes zijn lokaal hersteld. Controleer alle producten, prijzen en originele opnametijden opnieuw; herstel is nooit een prijsvalidatie.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Herstelpunt niet bruikbaar; vorige invoer bewaard.')
    }
  }

  function deleteTabCheckpoint() {
    try {
      let ownedKey = tabCheckpointKey
      if (window.sessionStorage.getItem(ownedKey) === null &&
          ownedKey !== privateTabCheckpointKey) {
        // The original global slot may contain another week's saved private
        // prices. Only delete it when strict import admits this exact week.
        const old = window.sessionStorage.getItem(privateTabCheckpointKey)
        if (old) {
          try {
            importPrivateBasketSession({ text: old, plan, recipes, activeDays, now: Date.now() })
            ownedKey = privateTabCheckpointKey
          } catch { /* Never delete another week's snapshot. */ }
        }
      }
      if (window.sessionStorage.getItem(ownedKey) === null) {
        setMessage('Voor dit weekmenu bestaat geen opgeslagen privéherstelpunt.')
        return
      }
      if (!window.confirm('Wis het bewaarde privéherstelpunt voor dit weekmenu? Andere weken blijven onaangeroerd.')) return
      window.sessionStorage.removeItem(ownedKey)
      setMessage('Herstelpunt voor deze week gewist; andere weken en geopende winkeldata blijven intact.')
    } catch {
      setMessage('De browseropslag kon niet worden gewist. Gebruik de privacyinstellingen van je browser.')
    }
  }

  async function restorePortableSession(file?: File) {
    if (!file) return
    const version = ++importRevision.current
    setBusy(true)
    try {
      if (!file.size || file.size > 256000) throw Error('Privésessie is leeg of groter dan 256 kB.')
      const data = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer())
      if (version !== importRevision.current) return
      const result = importPrivateBasketSession({
        text: data, plan, recipes, activeDays, now: Date.now(),
      })
      // Consent is required before replacing a local, possibly unsaved source.
      if (!window.confirm('Herstel de originele winkelopname(s) en bronartikelkeuzes voor ditzelfde weekmenu? Bestaande lokale invoer, productbevestigingen en afvinkingen worden vervangen. Alle prijzen moeten opnieuw worden beoordeeld.')) return
      if (version !== importRevision.current) return
      setText(result.rawSource)
      setImported(result.captured)
      setManualSku(result.selected)
      setSkuFilter({})
      setReviewedLines({})
      setDoneTripItems({})
      setClockMs(Date.now())
      setTripExportMessage('')
      setTripProgressMessage('')
      setMessage('Je originele bron en gekozen SKU’s zijn hersteld voor exact dit weekmenu. Controleer iedere verpakking, prijs en bronopname opnieuw; er zijn geen oude goedkeuringen hersteld.')
    } catch (error) {
      if (version === importRevision.current)
        setMessage(error instanceof Error ? error.message : 'Privésessie niet geldig; bestaande invoer behouden.')
    } finally {
      if (version === importRevision.current) setBusy(false)
    }
  }

  function downloadFreshProductReobservation(
    retailer: 'PLUS' | 'DekaMarkt' | 'both',
    format: 'csv' | 'csv-excel' | 'guide' = 'csv',
  ) {
    if (!imported) return
    try {
      // Read the canonical original data again at the actual click. Historical
      // SKU names are lookup aids, not a new observed price/pack/time.
      const current = parseOfflinePriceSnapshots(text, Date.now())
      const plus = current.captures.PLUS
      const deka = current.captures.DekaMarkt
      const capture = retailer === 'both' ? null : current.captures[retailer]
      if (retailer === 'both' && (!plus || !deka))
        throw new Error('Voor beide winkels zijn twee oorspronkelijke winkelbronnen nodig.')
      if (retailer !== 'both' && !capture)
        throw new Error('Selecteer eerst een oorspronkelijke ' + retailer + '-winkelbron.')
      const csvDelimiter = format === 'csv-excel' ? ';' : ','
      const content = retailer === 'both'
        ? format === 'guide'
          ? privatePairedStoreRecaptureGuide(plus!, deka!)
          : privatePairedStoreRecaptureCsv(plus!, deka!, csvDelimiter)
        : format === 'guide'
          ? privateFullStoreRecaptureGuide(capture!)
          : privateFullStoreRecaptureCsv(capture!, csvDelimiter)
      const url = URL.createObjectURL(new Blob([content], {
        type: format === 'guide' ? 'text/plain;charset=utf-8' : 'text/csv;charset=utf-8',
      }))
      try {
        const link = document.createElement('a')
        link.href = url
        link.download = 'supa-' + (retailer === 'both' ? 'plus-deka' : retailer.toLowerCase()) +
          (format === 'guide' ? '-hele-bronopname-handleiding.txt' : '-complete-nieuwe-bronopname.csv')
        document.body.append(link)
        try { link.click() } finally { link.remove() }
      } finally { window.setTimeout(() => URL.revokeObjectURL(url), 1000) }
      setMessage((retailer === 'both' ? 'PLUS en DekaMarkt' : retailer) +
        ': nieuwe broninvoer voorbereid. Alleen originele SKU en naam zijn zoekhulp; oude tijden, pakgegevens, voorraad en prijzen zijn LEEG. Gebruik uitsluitend werkelijk opnieuw geobserveerde gegevens en controleer ze hier.')
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message :
        'Een volledig lege bronopname kon niet uit de oorspronkelijke artikelen worden gemaakt.')
    }
  }

  function downloadPrivateRecaptureCsv(store: typeof stores[number]) {
    if (!imported?.captures[store]) return
    try {
      const csv = makePrivateRecaptureCsv(imported, store)
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
      try {
        const a = document.createElement('a')
        a.href = url
        a.download = 'supa-' + store.toLowerCase() + '-nieuwe-prijsopname.csv'
        document.body.append(a)
        try { a.click() } finally { a.remove() }
        setMessage(store + ': nieuw CSV-invulblad gedownload. Originele artikelcodes en verpakkingen zijn overgenomen, maar oude opnametijd, prijzen en beschikbaarheid zijn expres LEEG/onbevestigd. Vul echte nieuwe feiten in en importeer het blad opnieuw.')
      } finally { window.setTimeout(() => URL.revokeObjectURL(url), 1000) }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Kan geen veilig herobservatieblad maken.')
    }
  }

  function downloadOwnSources() {
    if (!imported) return
    try {
      // Keep original unknown-price nulls and physical source timestamps.
      // Revalidate exactly the already accepted original JSON before backup.
      parseOfflinePriceSnapshots(text, Date.now())
      const url = URL.createObjectURL(new Blob([text], { type: 'application/json;charset=utf-8' }))
      try {
        const link = document.createElement('a')
        link.href = url
        link.download = 'supa-eigen-winkelopnames-prive.json'
        document.body.append(link)
        try { link.click() } finally { link.remove() }
        setMessage('De originele privébronopname(s) lokaal gedownload; je kunt dit bestand later opnieuw importeren.')
      } finally { window.setTimeout(() => URL.revokeObjectURL(url), 1000) }
    } catch {
      setMessage('De bronopname is niet meer geldig om te bewaren. Importeer je originele bronbestand opnieuw.')
    }
  }

  async function downloadOwnSourcesCsv(store?: typeof stores[number]) {
    if (!imported || !text) return
    const snapshot = text
    const revision = importRevision.current
    try {
      const csv = await ownPriceCapturesToCsv(snapshot, store)
      // Changes made during the converter import must not download the
      // previous source after the user has replaced or edited a capture.
      if (revision !== importRevision.current || snapshot !== currentActiveSource.current) return
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
      try {
        const link = document.createElement('a')
        link.href = url
        link.download = store ? 'supa-mijn-bronopname-' + store + '.csv' :
          'supa-mijn-twee-bronopnames.csv'
        document.body.append(link)
        try { link.click() } finally { link.remove() }
        setMessage('Je eigen ' + (store ?? 'PLUS/DekaMarkt') +
          '-bronopname is als herimporteerbare CSV opgeslagen, zonder brongegevens te wijzigen.')
      } finally { window.setTimeout(() => URL.revokeObjectURL(url), 1000) }
    } catch (error) {
      if (revision !== importRevision.current || snapshot !== currentActiveSource.current) return
      setMessage((error instanceof Error ? error.message : 'Kan de bronopname niet als CSV bewaren.') +
        ' Download eventueel de oorspronkelijke JSON; de bron en reviews blijven behouden.')
    }
  }

  function downloadTripProgress(basket: OneStoreBasket, store: typeof stores[number], observedAt: string) {
    try {
      const key = currentTripKey(basket, observedAt)
      if (!key) throw new Error('Nog geen fysiek volledig gekoppeld mandje.')
      const checked = new Set(basket.lines.filter(line =>
        doneTripItems[shoppingTaskKey(store, line)]).map(line => line.id))
      const content = saveTripProgress(key, checked, basket)
      const url = URL.createObjectURL(new Blob([content], { type: 'application/json;charset=utf-8' }))
      try {
        const a = document.createElement('a')
        a.href = url
        a.download = 'supa-' + store.toLowerCase() + '-afvinkstatus-prive.json'
        document.body.append(a)
        try { a.click() } finally { a.remove() }
        setTripProgressMessage(store + ': afvinkingen lokaal opgeslagen. Het bestand bevat geen nieuwe prijsbron.')
      } finally { window.setTimeout(() => URL.revokeObjectURL(url), 1000) }
    } catch {
      setTripProgressMessage(store + ': afvinkstatus kan pas bij een volledig gekoppelde fysieke lijst worden bewaard.')
    }
  }
  async function restoreTripProgress(file: File | undefined, basket: OneStoreBasket,
    store: typeof stores[number], observedAt: string) {
    if (!file) return
    const version = importRevision.current
    try {
      if (!file.size || file.size > 256000) throw new Error('Bestand is leeg of te groot.')
      const key = currentTripKey(basket, observedAt)
      if (!key) throw new Error('Nog geen volledig gekoppelde winkelmand.')
      const content = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer())
      if (version !== importRevision.current) return
      const restored = loadTripProgress(content, key, basket)
      setDoneTripItems(previous => {
        const next = { ...previous }
        for (const line of basket.lines) {
          const task = shoppingTaskKey(store, line)
          delete next[task]
          if (restored.has(line.id)) next[task] = true
        }
        return next
      })
      setTripProgressMessage(store + ': afvinkingen uitsluitend voor dezelfde originele winkelbron en fysieke mand hersteld.')
    } catch {
      if (version === importRevision.current)
        setTripProgressMessage(store + ': afvinkbestand ongeldig of behoort bij andere prijzen, artikelen of bronopname. Niets hersteld.')
    }
  }

  function downloadShoppingTrip(basket: OneStoreBasket, store: typeof stores[number]) {
    try {
      const latest = freshReviewedBaskets(reviewedBridge, reviewedBridge?.planKey ?? '', Date.now())
      // A complete, still-authoritative *identical* source is required for any
      // monetary cells. Missing or expired sources still export unpriced needs.
      const eligible = latest?.stores[store]?.basket === basket
      const content = shoppingChecklist(basket, store, doneTripItems, eligible)
      const url = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }))
      try {
        const link = document.createElement('a')
        link.href = url
        link.download = 'supa-' + store.toLowerCase() + '-boodschappen-prive.txt'
        document.body.append(link)
        try { link.click() } finally { link.remove() }
        setTripExportMessage(store + ': boodschappenlijst lokaal gedownload, inclusief je huidige vinkjes. Ongecontroleerde prijzen zijn geen winkelbewijs.')
      } finally { window.setTimeout(() => URL.revokeObjectURL(url), 1000) }
    } catch {
      setTripExportMessage('Download mislukt. Open de kopieerbare lijst en selecteer de tekst.')
    }
  }

  function sameCanonicalCapture(
    previous: OfflinePriceSnapshots['captures'][typeof stores[number]],
    incoming: OfflinePriceSnapshots['captures'][typeof stores[number]],
  ): boolean {
    if (!previous || !incoming || previous.observedAt !== incoming.observedAt ||
        previous.products.length !== incoming.products.length) return false
    const bySku = new Map(previous.products.map(product => [product.id, product]))
    return incoming.products.every(product => {
      const old = bySku.get(product.id)
      return !!old && old.name === product.name &&
        old.packAmount === product.packAmount && old.packUnit === product.packUnit &&
        old.packCount === product.packCount &&
        old.sourcePriceCents === product.sourcePriceCents &&
        old.sourceAvailable === product.sourceAvailable
    })
  }

  function stageBothStoreReplacement(input: string, version: number) {
    // Reuse canonical source admission. This is a preview of local user
    // files, never a retailer-authorization or independent price claim.
    const next = parseOfflinePriceSnapshots(input, Date.now())
    if (!next.captures.PLUS || !next.captures.DekaMarkt)
      throw new Error('Selecteer een oorspronkelijke PLUS- en DekaMarkt-opname.')
    if (!imported) {
      importSnapshots(input)
      return
    }
    // Admission compares original facts, independent of JSON whitespace or SKU
    // order. No approval may outlive a changed original shop observation.
    const sameCapture = (store: typeof stores[number]) =>
      sameCanonicalCapture(imported.captures[store], next.captures[store])
    if (stores.every(sameCapture)) {
      setPendingTwoStore(null)
      setMessage('Beide bronopnames zijn inhoudelijk identiek aan je huidige bronnen. Eerdere productcontroles en afvinkingen zijn behouden.')
      return
    }
    const changes = stores.map(store => {
      const prior = imported.captures[store]
      const incoming = next.captures[store]!
      const oldBySku = new Map(prior?.products.map(product => [product.id, product]))
      const newBySku = new Map(incoming.products.map(product => [product.id, product]))
      const added = incoming.products.filter(item => !oldBySku.has(item.id)).length
      const removed = prior?.products.filter(item => !newBySku.has(item.id)).length ?? 0
      const changed = incoming.products.filter(item => {
        const old = oldBySku.get(item.id)
        return old && (old.name !== item.name ||
          old.packAmount !== item.packAmount || old.packUnit !== item.packUnit ||
          old.packCount !== item.packCount ||
          old.sourcePriceCents !== item.sourcePriceCents ||
          old.sourceAvailable !== item.sourceAvailable)
      }).length
      const priceLabel = (product?: OfflineStoreProduct) => {
        if (!product) return 'niet meer in bestand'
        if (product.sourceAvailable !== true || product.sourcePriceCents === null ||
            product.sourcePriceCents === undefined || product.packAmount === null)
          return 'pakprijs of beschikbaarheid onbekend'
        return exactEuro.formatCents(product.sourcePriceCents) + ' per pak · ' +
          product.packCount + ' × ' + product.packAmount + ' ' + product.packUnit
      }
      const examples = [...new Set([...oldBySku.keys(), ...newBySku.keys()])]
        .filter(id => {
          const old = oldBySku.get(id)
          const latest = newBySku.get(id)
          return !old || !latest || old.name !== latest.name ||
            old.packAmount !== latest.packAmount || old.packUnit !== latest.packUnit ||
            old.packCount !== latest.packCount ||
            old.sourcePriceCents !== latest.sourcePriceCents ||
            old.sourceAvailable !== latest.sourceAvailable
        })
        .slice(0, 6)
        .map(id => {
          const before = oldBySku.get(id)
          const after = newBySku.get(id)
          return { id, name: after?.name ?? before?.name ?? id,
            before: before ? priceLabel(before) : 'nieuw bronproduct',
            after: priceLabel(after) }
        })
      const priced = (product: OfflineStoreProduct) =>
        product.sourceAvailable === true && product.sourcePriceCents !== null &&
        product.sourcePriceCents !== undefined && product.packAmount !== null
      return { store, previousAt: prior?.observedAt ?? null,
        nextAt: incoming.observedAt, previousCount: prior?.products.length ?? 0,
        nextCount: incoming.products.length, added, removed, changed,
        previousPriced: prior?.products.filter(priced).length ?? 0,
        nextPriced: incoming.products.filter(priced).length,
        unchanged: sameCapture(store), examples }
    })
    setPendingReplacement(null)
    setPendingTwoStore({ sourceText: text, newText: input, version,
      snapshots: next, changes })
    setMessage('Twee originele bronbestanden gecontroleerd; vergelijk eerst de wijzigingen. Geen oude winkeldata of vinkjes zijn vervangen.')
  }

  async function downloadTwoStoreChanges() {
    const pending = pendingTwoStore
    if (!pending || pending.version !== importRevision.current ||
        pending.sourceText !== text) {
      setMessage('Het wijzigingenoverzicht is verouderd; laad je eigen bronnen opnieuw.')
      return
    }
    try {
      const { twoStoreReplacementCsv } = await import('./twoStoreReplacementCsv.ts')
      if (pending.version !== importRevision.current || pending.sourceText !== currentActiveSource.current)
        throw new Error('De actieve winkelopnames zijn veranderd. Bekijk de nieuwe bronbestanden opnieuw.')
      const content = twoStoreReplacementCsv(pending.sourceText, pending.newText, Date.now())
      const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }))
      try {
        const link = document.createElement('a')
        link.href = url
        link.download = 'supa-mijn-plus-deka-bronwijzigingen.csv'
        document.body.append(link)
        try { link.click() } finally { link.remove() }
      } finally { window.setTimeout(() => URL.revokeObjectURL(url), 1000) }
      setMessage('Alle oorspronkelijke SKU-verschillen lokaal als CSV opgeslagen. Dit bestand bewijst geen actuele retailerprijzen.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Het lokale verschillenbestand kon niet worden opgeslagen.')
    }
  }

  function confirmBothStoreReplacement() {
    const pending = pendingTwoStore
    if (!pending || pending.version !== importRevision.current ||
        pending.sourceText !== text) {
      setPendingTwoStore(null)
      setMessage('De actieve winkelopnames zijn ondertussen gewijzigd. Laad de twee nieuwe bestanden opnieuw.')
      return
    }
    try {
      // Recheck age and pair context at the actual approval moment.
      const source = parseOfflinePriceSnapshots(pending.newText, Date.now())
      if (!source.captures.PLUS || !source.captures.DekaMarkt)
        throw new Error('Beide originele winkelopnames moeten aanwezig zijn.')
      if (!imported) throw new Error('Je oorspronkelijke winkeldata zijn niet meer geladen.')
      const changed = stores.filter(store =>
        !sameCanonicalCapture(imported.captures[store], source.captures[store]))
      const invalidates = (key: string) => changed.some(store =>
        key.startsWith('[' + JSON.stringify(store) + ','))
      ++importRevision.current
      setPendingTwoStore(null)
      setPendingReplacement(null)
      setText(pending.newText)
      setImported(source)
      setClockMs(Date.now())
      // Preserve user-reviewed SKUs and physical shopping ticks only for
      // exactly identical underlying source records. A changed original
      // capture always revokes its store's former choices and price approvals.
      setManualSku(previous => ({
        PLUS: changed.includes('PLUS') ? {} : previous.PLUS,
        DekaMarkt: changed.includes('DekaMarkt') ? {} : previous.DekaMarkt,
      }))
      setSkuFilter(previous => Object.fromEntries(
        Object.entries(previous).filter(([key]) => !invalidates(key))))
      setReviewedLines(previous => Object.fromEntries(
        Object.entries(previous).filter(([key]) => !invalidates(key))))
      setDoneTripItems(previous => Object.fromEntries(
        Object.entries(previous).filter(([key]) => !invalidates(key))))
      setTripExportMessage('')
      setTripProgressMessage('')
      setMessage(changed.join(' en ') +
        ': de nieuwe opname moet opnieuw worden gecontroleerd. ' +
        stores.filter(store => !changed.includes(store)).join(' en ') +
        (changed.length < 2 ? ' blijft met eigen originele bron, productkeuzes en afvinkingen behouden.' :
          ' Geen oude prijsbevestigingen zijn overgenomen.'))
    } catch (error) {
      setPendingTwoStore(null)
      setMessage((error instanceof Error ? error.message : 'Nieuwe brondata niet geldig.') +
        ' De oude winkeldata en afvinkingen zijn behouden.')
    }
  }

  function isSameSingleStoreCapture(preview: ReturnType<typeof describePrivateStoreCaptureChange>) {
    return preview.previousObservedAt === preview.nextObservedAt &&
      preview.previousCount === preview.nextCount &&
      preview.added === 0 && preview.removed === 0 && preview.changed === 0
  }

  function acceptManualSource(input: string) {
    ++importRevision.current
    setPendingReplacement(null)
    setBusy(false)
    try {
      const next = parseOfflinePriceSnapshots(input, Date.now())
      const shops = Object.keys(next.captures) as (typeof stores[number])[]
      if (imported && shops.length === 1) {
        const store = shops[0]
        if (imported.captures[store]) {
          const preview = describePrivateStoreCaptureChange(text, input, store, Date.now())
          if (isSameSingleStoreCapture(preview)) {
            setMessage(store + ': deze winkelopname is volledig identiek. Je gekozen producten en afvinkingen blijven behouden.')
            return
          }
          setPendingReplacement({ sourceText: text, newText: input, store,
            version: importRevision.current, preview })
          setMessage(store + ': bekijk eerst de bronverschillen en bevestig de vervanging. De andere winkel blijft behouden.')
          return
        }
        const previous = JSON.parse(text) as { captures: unknown[] }
        const added = JSON.parse(input) as { captures: unknown[] }
        const combined = JSON.stringify({ schema: 'supa-offline-prices-v1',
          captures: [...previous.captures, ...added.captures] })
        const admitted = parseOfflinePriceSnapshots(combined, Date.now())
        const isNew = (key: string) => key.startsWith('[' + JSON.stringify(store) + ',')
        setText(combined)
        setImported(admitted)
        setManualSku(previous => ({ ...previous, [store]: {} }))
        setSkuFilter(previous => Object.fromEntries(
          Object.entries(previous).filter(([key]) => !isNew(key))))
        setReviewedLines(previous => Object.fromEntries(
          Object.entries(previous).filter(([key]) => !isNew(key))))
        setDoneTripItems(previous => Object.fromEntries(
          Object.entries(previous).filter(([key]) => !isNew(key))))
        setClockMs(Date.now())
        setTripExportMessage('')
        setTripProgressMessage('')
        setMessage(store + ': tweede echte privéopname toegevoegd; de andere winkel en zijn controles blijven intact. Controleer de nieuwe SKU’s.')
        return
      }
      if (imported && shops.length === 2) {
        stageBothStoreReplacement(input, importRevision.current)
        return
      }
      importSnapshots(input)
    } catch (error) {
      setMessage((error instanceof Error ? error.message : 'Ongeldige bron.') +
        ' Bestaande winkelopnames en controles zijn behouden.')
    }
  }

  function importSnapshots(input: string) {
    try {
      // Validate the entire proposed capture before changing the active
      // source, review keys, physical ticks, or any derived basket totals.
      const parsed = parseOfflinePriceSnapshots(input, Date.now())
      setText(input)
      setImported(parsed)
      setReviewedLines({})
      setDoneTripItems({})
      setManualSku({ PLUS: {}, DekaMarkt: {} })
      setSkuFilter({})
      setClockMs(Date.now())
      setMessage(Object.keys(parsed.captures).length === 1
        ? 'Eén eigen winkelopname lokaal geladen. Voeg een echte andere winkel toe voor een prijsverschil.'
        : 'Twee privéopnames lokaal geladen. Controleer de fysieke SKU’s en prijzen opnieuw.')
    } catch (error) {
      setMessage((error instanceof Error ? error.message : 'Ongeldige import.') +
        ' Vorige brondata, reviews en afvinkingen blijven intact.')
    }
  }
  /** Paste CSV straight from the user's own sheet; still use canonical
   * source admission and require every original SKU/price to be reviewed. */
  async function importPastedSource() {
    const raw = pasteDraft
    const pastePlan = currentlySelectedPlan.current
    const version = ++importRevision.current
    if (!raw.trim()) {
      setMessage('Plak eerst eigen CSV- of JSON-brongegevens.')
      return
    }
    if (raw.trimStart().startsWith('{')) {
      acceptManualSource(raw)
      return
    }
    setBusy(true)
    try {
      const converterUrl = `${import.meta.env.BASE_URL}offline-two-store-csv.mjs`
      const module: unknown = await import(/* @vite-ignore */ converterUrl)
      if (!module || typeof module !== 'object' ||
          !('convertOwnStoreCsv' in module) ||
          typeof module.convertOwnStoreCsv !== 'function') {
        throw new Error('De bestaande lokale CSV-converter is niet beschikbaar.')
      }
      const sheets = raw.split(/(?:\r\n|\n|\r)---(?:\r\n|\n|\r)/u)
      if (sheets.length > 2)
        throw Error('Gebruik één losse --- regel tussen twee winkelbladen.')
      if (sheets.some(sheet => !sheet.trim()))
        throw Error('Beide winkelbladen moeten productgegevens bevatten.')
      const convert = module.convertOwnStoreCsv as (input: string) => string
      const sources = sheets.map(sheet => convert(sheet))
      if (version !== importRevision.current) return
      if (pastePlan !== currentlySelectedPlan.current) {
        setMessage('Je Planner-week is tijdens het lezen gewijzigd. Plak de originele bronnen opnieuw voor dit weekmenu.')
        return
      }
      if (sources.length === 2) {
        const combined = combineTwoOwnShopCaptures(sources)
        if (version !== importRevision.current) return
        if (imported) stageBothStoreReplacement(combined, version)
        else importSnapshots(combined)
        setMessage(imported
          ? 'Twee bladen ontvangen. Controleer en bevestig de bronvervanging.'
          : 'Twee echte winkelbladen geladen. Controleer alle originele SKU’s, verpakkingen en prijzen.')
      } else acceptManualSource(sources[0])
    } catch (error) {
      if (version !== importRevision.current) return
      setMessage((error instanceof Error ? error.message : 'CSV kon niet worden verwerkt.') +
        ' De oude winkeldata en productreviews zijn behouden.')
    } finally {
      if (version === importRevision.current) setBusy(false)
    }
  }
  // Opening one file (including a drag/drop) should never silently replace
  // the other already-reviewed shop. Reuse the same append/replacement preview
  // that the manual editor and pasted CSV use.
  async function stageSelectedSource(file: File, selectedForPlan?: string) {
    const version = ++importRevision.current
    setPendingReplacement(null)
    setBusy(true)
    try {
      if (!file.size || file.size > 256000)
        throw new Error('Bronbestand is leeg of groter dan 256 kB.')
      const raw = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer())
      const isCsv = isPrivateCaptureCsv(file, raw)
      let source = raw
      if (isCsv) {
        const converterUrl = `${import.meta.env.BASE_URL}offline-two-store-csv.mjs`
        const module: unknown = await import(/* @vite-ignore */ converterUrl)
        if (!module || typeof module !== 'object' ||
            !('convertOwnStoreCsv' in module) ||
            typeof module.convertOwnStoreCsv !== 'function')
          throw new Error('De bestaande lokale CSV-converter is niet beschikbaar.')
        source = (module.convertOwnStoreCsv as (input: string) => string)(raw)
      }
      if (version !== importRevision.current) return
      if (selectedForPlan !== undefined && selectedForPlan !== currentlySelectedPlan.current) {
        setMessage('Je weekmenu veranderde tijdens het lezen van dit bestand. Kies het opnieuw voor de huidige week.')
        return
      }
      acceptManualSource(source)
    } catch (error) {
      if (version !== importRevision.current) return
      setMessage((error instanceof Error ? error.message : 'Ongeldig bronbestand.') +
        ' De huidige winkeldata en productreviews zijn behouden.')
    } finally {
      if (version === importRevision.current) setBusy(false)
    }
  }

  async function loadSelectedSources(files: File[], selectedForPlan?: string) {
    if (files.length === 0) return
    if (files.length === 1) {
      await stageSelectedSource(files[0], selectedForPlan)
      return
    }
    // Keep current admitted sources and human checks intact until BOTH
    // new files pass canonical admission. An invalid attempt is not a source
    // revocation, and must not erase the user's previous complete basket.
    const version = ++importRevision.current
    setPendingReplacement(null)
    setBusy(true)
    try {
      if (files.length !== 2) throw new Error('Selecteer maximaal twee originele winkelbestanden.')
      const sources: string[] = []
      for (const file of files) {
        if (!file.size || file.size > 256000)
          throw new Error('Elk origineel winkelbestand moet gevuld zijn en maximaal 256 kB bevatten.')
        const raw = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer())
        const isCsv = isPrivateCaptureCsv(file, raw)
        let json = raw
        if (isCsv) {
          const converterUrl = `${import.meta.env.BASE_URL}offline-two-store-csv.mjs`
          const module: unknown = await import(/* @vite-ignore */ converterUrl)
          if (!module || typeof module !== 'object' ||
              !('convertOwnStoreCsv' in module) || typeof module.convertOwnStoreCsv !== 'function')
            throw new Error('De bestaande lokale CSV-converter is niet beschikbaar.')
          json = (module.convertOwnStoreCsv as (input: string) => string)(raw)
        }
        sources.push(json)
      }
      if (selectedForPlan !== undefined && selectedForPlan !== currentlySelectedPlan.current) {
        setMessage('Je weekmenu veranderde tijdens het lezen. Selecteer deze twee opnames opnieuw voor je huidige week.')
        return
      }
      // Preserve original SKUs, null prices and observation timestamps. The
      // canonical parser is the final authority for this composed capture.
      const combined = combineTwoOwnShopCaptures(sources)
      if (version !== importRevision.current) return
      if (imported) {
        stageBothStoreReplacement(combined, version)
        return
      }
      importSnapshots(combined)
      setMessage('Twee echte winkelbestanden lokaal geladen. Controleer per ingrediënt alle originele SKU’s en fysieke verpakkingen.')
    } catch (error) {
      if (version !== importRevision.current) return
      setMessage((error instanceof Error ? error.message :
        'Twee winkelbestanden niet geldig.') +
        ' Eerder ingelezen originele bronopnames, reviews en afvinkingen zijn behouden.')
    } finally {
      if (version === importRevision.current) setBusy(false)
    }
  }

  // Planner only passes original user-picked File objects. This effect does
  // not authorize their content: the existing importer and human review decide.
  useEffect(() => {
    if (!incomingSources || incomingSources.serial <= lastPlannerFileSerial.current) return
    lastPlannerFileSerial.current = incomingSources.serial
    // Release original File references after admission (or refusal), so
    // selected source bytes never linger in App's long-lived tab state.
    const release = () => onSourceFilesConsumed?.(incomingSources.serial)
    if (incomingSources.planKey !== planKey) {
      release()
      setMessage('Je weekmenu is veranderd na de bestandskeuze. Kies opnieuw voor deze week.')
      return
    }
    if (incomingSources.files.length === 0 || incomingSources.files.length > 2) {
      setMessage('Selecteer maximaal twee eigen winkelbronbestanden.')
      release()
      return
    }
    void loadSelectedSources(incomingSources.files, incomingSources.planKey).finally(release)
  }, [incomingSources, planKey, onSourceFilesConsumed])

  async function appendSameCapture(store: typeof stores[number], file?: File) {
    if (!file || !imported?.captures[store]) return
    const version = ++importRevision.current
    setBusy(true)
    setPendingReplacement(null)
    try {
      if (!file.size || file.size > 256000)
        throw new Error('Een aanvulbestand moet gevuld zijn en maximaal 256 kB bevatten.')
      const raw = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer())
      const isCsv = isPrivateCaptureCsv(file, raw)
      let source = raw
      if (isCsv) {
        const converterUrl = `${import.meta.env.BASE_URL}offline-two-store-csv.mjs`
        const module: unknown = await import(/* @vite-ignore */ converterUrl)
        if (!module || typeof module !== 'object' ||
            !('convertOwnStoreCsv' in module) || typeof module.convertOwnStoreCsv !== 'function')
          throw new Error('De lokale bron-CSV-converter is niet beschikbaar.')
        source = (module.convertOwnStoreCsv as (input: string) => string)(raw)
      }
      if (version !== importRevision.current) return
      const candidate = appendPrivateCaptureProducts(text, source, store, Date.now())
      if (!window.confirm(
        store + ': voeg ' + candidate.added + ' nieuw geobserveerde bronartikelen toe ' +
        'aan je bestaande opname van exact hetzelfde originele bronmoment? ' +
        'Oorspronkelijke producten en prijzen blijven letterlijk behouden. ' +
        'Een oude SKU-beslissing geldt alleen zolang ook de gekozen brondata ongewijzigd blijven.')) {
        setMessage(store + ': aanvulling geannuleerd. Oorspronkelijke prijzen en winkelreviews behouden.')
        return
      }
      if (version !== importRevision.current) return
      const admitted = parseOfflinePriceSnapshots(candidate.source, Date.now())
      setText(candidate.source)
      setImported(admitted)
      setClockMs(Date.now())
      setTripExportMessage('')
      setTripProgressMessage('')
      setMessage(store + ': ' + candidate.added +
        ' daadwerkelijk ingevoerde nieuwe bronartikelen toegevoegd. Nu ' +
        candidate.products + ' unieke producten met onveranderd origineel bronmoment. ' +
        'Kies en controleer eventueel nieuwe SKU’s; er zijn geen prijzen verzonnen.')
    } catch (error) {
      if (version === importRevision.current)
        setMessage((error instanceof Error ? error.message : 'De bronaanvulling is ongeldig.') +
          ' Bestaande beide winkelopnames, reviews en vinkjes blijven behouden.')
    } finally {
      if (version === importRevision.current) setBusy(false)
    }
  }

  async function replaceStoreFile(store: typeof stores[number], file?: File) {
    if (!file || !imported?.captures[store]) return
    setPendingReplacement(null)
    const version = ++importRevision.current
    setBusy(true)
    try {
      if (!file.size || file.size > 256000)
        throw new Error('Nieuwe winkelopname is leeg of groter dan 256 kB.')
      const raw = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer())
      const isCsv = isPrivateCaptureCsv(file, raw)
      let json = raw
      if (isCsv) {
        const converterUrl = `${import.meta.env.BASE_URL}offline-two-store-csv.mjs`
        const module: unknown = await import(/* @vite-ignore */ converterUrl)
        if (!module || typeof module !== 'object' ||
            !('convertOwnStoreCsv' in module) || typeof module.convertOwnStoreCsv !== 'function')
          throw new Error('De bestaande lokale CSV-converter is niet beschikbaar.')
        json = (module.convertOwnStoreCsv as (input: string) => string)(raw)
      }
      if (version !== importRevision.current) return
      // Stage ONLY: do not touch admitted source or previous checkmarks.
      // The original-price-null-sensitive comparison is purely informational.
      const preview = describePrivateStoreCaptureChange(text, json, store, Date.now())
      if (version !== importRevision.current) return
      if (isSameSingleStoreCapture(preview)) {
        setMessage(store + ': deze oorspronkelijke opname is identiek. Je producten en afvinkingen blijven staan.')
        return
      }
      setPendingReplacement({ sourceText: text, newText: json, store, version, preview })
      setMessage(store + ': nieuw bronbestand geldig gelezen. Bekijk eerst welke originele producten en prijzen wijzigen. De twee bestaande winkelopnames zijn nog niet vervangen.')
    } catch (error) {
      if (version === importRevision.current)
        setMessage(error instanceof Error ? error.message :
          'Deze vervanging is geweigerd. Bestaande winkelopnames en bevestigingen zijn bewaard.')
    } finally {
      if (version === importRevision.current) setBusy(false)
    }
  }


  function confirmPrivateStoreReplacement() {
    const proposed = pendingReplacement
    if (!proposed) return
    setPendingReplacement(null)
    if (!imported || importRevision.current !== proposed.version ||
        text !== proposed.sourceText) {
      setMessage('Je oorspronkelijke winkeldata zijn ondertussen gewijzigd. Importeer de gewenste vervanging opnieuw.')
      return
    }
    try {
      // Revalidate the exact original and new sources at the moment of click:
      // a stale/too-far-future capture never travels through a preview.
      const result = replacePrivateStoreCapture(text, proposed.newText, proposed.store, Date.now())
      const store = proposed.store
      const otherStore = stores.find(item => item !== store)!
      const fromReplaced = (key: string) => key.startsWith('[' + JSON.stringify(store) + ',')
      importRevision.current += 1
      setText(result.source)
      setImported(result.captured)
      setClockMs(Date.now())
      setManualSku(previous => ({ ...previous, [store]: {} }))
      setSkuFilter(previous => Object.fromEntries(
        Object.entries(previous).filter(([key]) => !fromReplaced(key))))
      setReviewedLines(previous => Object.fromEntries(
        Object.entries(previous).filter(([key]) => !fromReplaced(key))))
      setDoneTripItems(previous => Object.fromEntries(
        Object.entries(previous).filter(([key]) => !fromReplaced(key))))
      setTripExportMessage('')
      setTripProgressMessage('')
      setMessage(store + ': nieuwe originele opname toegepast. ' + otherStore +
        ' en zijn bestaande fysieke reviewregels zijn behouden. Controleer de gewijzigde winkel en prijs opnieuw.')
    } catch {
      setMessage('Vervanging niet toegepast: een oorspronkelijk of nieuw bronmoment is ongeldig. De oude bronnen zijn behouden.')
    }
  }
  async function loadFile(file?: File, addSecond = false) {
    if (!file) return
    const version = ++importRevision.current
    setPendingReplacement(null)
    setBusy(true)
    try {
      if (!file.size || file.size > 256000) {
        throw new Error('Bronbestand is leeg of groter dan 256 kB.')
      }
      // The same canonical local CSV converter is already used by the
      // independent browser mapping wizard. It does not request retailer data.
      const raw = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer())
      const isCsv = isPrivateCaptureCsv(file, raw)
      let content = raw
      if (isCsv) {
        // Vite copies the existing public module without changing its parser.
        const converterUrl = `${import.meta.env.BASE_URL}offline-two-store-csv.mjs`
        const module: unknown = await import(/* @vite-ignore */ converterUrl)
        if (!module || typeof module !== 'object' ||
          !('convertTwoStoreCsv' in module) ||
          typeof module.convertTwoStoreCsv !== 'function') {
          throw new Error('De bestaande lokale CSV-converter is niet beschikbaar.')
        }
        if (!('convertOwnStoreCsv' in module) || typeof module.convertOwnStoreCsv !== 'function') {
          throw new Error('De lokale één-winkel CSV-converter is niet beschikbaar.')
        }
        content = (module.convertOwnStoreCsv as (input: string) => string)(raw)
      }
      if (version !== importRevision.current) return
      if (addSecond) {
        if (!imported || Object.keys(imported.captures).length !== 1)
          throw new Error('Voeg alleen bij precies één bestaande eigen winkelopname een tweede winkel toe.')
        const next = parseOfflinePriceSnapshots(content, Date.now())
        const existingShop = Object.keys(imported.captures)[0]
        const addedShop = Object.keys(next.captures)
        if (addedShop.length !== 1 || addedShop[0] === existingShop)
          throw new Error('Selecteer één opname van de andere winkel. Bestaande brondata zijn niet gewijzigd.')
        // Preserve the original source products, timestamp and unknown prices
        // byte-for-byte in value; never reconstruct unknowns as zero-priced packs.
        const previousRaw = JSON.parse(text) as { captures: unknown[] }
        const addedRaw = JSON.parse(content) as { captures: unknown[] }
        const combined = JSON.stringify({
          schema: 'supa-offline-prices-v1',
          captures: [...previousRaw.captures, ...addedRaw.captures],
        })
        const result = parseOfflinePriceSnapshots(combined, Date.now())
        setText(combined)
        setImported(result)
        setClockMs(Date.now())
        // The prior store's reviewedLineKeys are preserved only if that
        // physical input was unchanged; the added retailer starts unreviewed.
        setMessage('De tweede werkelijk ingevoerde winkel is gekoppeld. Controleer de nieuwe producten; de oorspronkelijke opname is behouden.')
      } else {
        // A single new file can itself contain one or two captured shops.
        // Only after canonical admission may it revoke previous human
        // selections. Invalid files leave the prior exact data untouched.
        const admitted = parseOfflinePriceSnapshots(content, Date.now())
        if (version !== importRevision.current) return
        if (imported && !window.confirm(
          'Vervang je bestaande eigen winkelopname(s) met dit ' +
          (isCsv ? 'CSV-' : 'JSON-') + 'bestand? De vorige bronprijzen, ' +
          'productreviews en boodschappenafvinkingen worden hierbij ingetrokken; ' +
          'bewaar eerst desgewenst je oorspronkelijke privébron.')) {
          setMessage('Nieuwe bronimport geannuleerd. Je eerdere winkelopnames en productkeuzes blijven behouden.')
          return
        }
        if (version !== importRevision.current) return
        setText(content)
        setImported(admitted)
        setReviewedLines({})
        setDoneTripItems({})
        setManualSku({ PLUS: {}, DekaMarkt: {} })
        setSkuFilter({})
        setClockMs(Date.now())
        setTripExportMessage('')
        setTripProgressMessage('')
        setMessage('Eigen originele ' + (isCsv ? 'winkel-CSV' : 'winkel-JSON') +
          ' geladen. Eenduidige producten worden automatisch gekoppeld; twijfelgevallen blijven open voor controle.')
      }
    } catch (error) {
      if (version !== importRevision.current) return
      setMessage((error instanceof Error ? error.message : 'Kon dit bronbestand niet lezen.') +
        ' De vorige originele bronopname en winkelbevestigingen zijn behouden.')
    } finally {
      if (version === importRevision.current) setBusy(false)
    }
  }

  const basketPair = useMemo(() => {
    if (!imported) return null
    try {
      const plus = imported.captures.PLUS
        ? buildOneStoreBasket({
            store: { id: 'PLUS', name: 'PLUS' }, plan, recipes, activeDays,
            products: imported.captures.PLUS.products,
          selectedProducts: manualSku.PLUS,
          }) : null
      const deka = imported.captures.DekaMarkt
        ? buildOneStoreBasket({
            store: { id: 'DekaMarkt', name: 'DekaMarkt' }, plan, recipes, activeDays,
            products: imported.captures.DekaMarkt.products,
          selectedProducts: manualSku.DekaMarkt,
          }) : null
      return { plus, deka, comparison: plus && deka
        ? compareFullBaskets({ baseline: plus, candidate: deka }) : null }
    } catch { return null }
  }, [imported, plan, recipes, activeDays, manualSku])
  // Decisive, exact-semantic matches from the currently admitted local capture
  // are accepted automatically. Every key includes original SKU, pack/price,
  // physical demand and observation instant; old facts never carry over.
  const autoReviewKeys = useMemo(() => {
    const keys = new Set<string>()
    if (!imported || !basketPair) return keys
    try {
      const ingredients = aggregatePlanIngredients(plan, recipes, activeDays)
      const byId = new Map(ingredients.map(item => [item.id, item.query]))
      for (const store of stores) {
        const capture = imported.captures[store]
        const basket = store === 'PLUS' ? basketPair.plus : basketPair.deka
        if (!capture || !basket) continue
        for (const line of basket.lines) {
          const query = byId.get(line.id)
          if (line.status === 'matched' && query && automaticallyAcceptedSourceLine(
            line, capture.products, query, manualSku[store][line.id],
          )) keys.add(reviewedLineKey(store, capture.observedAt, line))
        }
      }
    } catch {
      return new Set<string>()
    }
    return keys
  }, [imported, basketPair, plan, recipes, activeDays, manualSku])

  const isAcceptedKey = (key: string): boolean =>
    reviewedLines[key] === true ||
    (autoReviewKeys.has(key) && rejectedAutoReviews[key] !== true)
  const isAutomaticKey = (key: string): boolean =>
    autoReviewKeys.has(key) && rejectedAutoReviews[key] !== true

  const reviewedRecaptureSeeds = useMemo(() => {
    const seeds: Record<string, ReviewedRecaptureSeed> = {}
    if (!imported || !basketPair) return seeds
    for (const store of stores) {
      const capture = imported.captures[store]
      const basket = store === 'PLUS' ? basketPair.plus : basketPair.deka
      if (!capture || !basket) continue
      for (const line of basket.lines) {
        if (line.status !== 'matched' || line.pack.unit === 'unknown' ||
            !isAcceptedKey(reviewedLineKey(store, capture.observedAt, line)))
          continue
        seeds[JSON.stringify([store, line.id])] = {
          sourceId: line.productId, name: line.productName,
          packAmount: String(line.pack.amount), packUnit: line.pack.unit,
          packCount: String(line.pack.count),
        }
      }
    }
    return seeds
  }, [imported, basketPair, reviewedLines, autoReviewKeys, rejectedAutoReviews])

  function downloadConfirmedComparisonCsv() {
    try {
      if (!canShowDifference || !eligibleComparisonRightNow() || !basketPair?.plus || !basketPair.deka ||
          !basketPair.comparison || !imported?.captures.PLUS || !imported.captures.DekaMarkt) {
        throw new Error('Vergelijking nog niet bevestigd.')
      }
      const source = createPrivateBasketComparisonCsv({
        ingredients: aggregatePlanIngredients(plan, recipes, activeDays).map(
          ({ id, label, amount, unit }) => ({ id, label, amount, unit }),
        ),
        captures: {
          PLUS: { observedAt: imported.captures.PLUS.observedAt },
          DekaMarkt: { observedAt: imported.captures.DekaMarkt.observedAt },
        },
        baskets: { PLUS: basketPair.plus, DekaMarkt: basketPair.deka },
        fresh: { PLUS: true, DekaMarkt: true },
        paired: imported.pairedWithin24h,
        deltas: new Map(basketPair.comparison.lineDeltas.map(line => [line.id, line.deltaCents])),
      })
      const url = URL.createObjectURL(new Blob([source], { type: 'text/csv;charset=utf-8' }))
      try {
        const link = document.createElement('a')
        link.href = url
        link.download = 'supa-prive-twee-winkelvergelijking.csv'
        document.body.append(link)
        try { link.click() } finally { link.remove() }
        setTripExportMessage('De volledig door jou bevestigde privévergelijking is als CSV gedownload. Dit is geen onafhankelijk retailer- of besparingsbewijs.')
      } finally { window.setTimeout(() => URL.revokeObjectURL(url), 1000) }
    } catch {
      setTripExportMessage('CSV niet beschikbaar: bevestig de exacte producten in beide actuele winkelopnames.')
    }
  }

  const currentEnough = useMemo(() => {
    if (!imported) return false
    const nowNs = BigInt(Math.trunc(clockMs)) * 1_000_000n
    const instants = Object.values(imported.captures).map(capture => capture.observedNs)
    const oldest = instants.reduce((a, b) => a < b ? a : b)
    const newest = instants.reduce((a, b) => a > b ? a : b)
    return nowNs >= newest - 300_000_000_000n && nowNs - oldest <= 604_800_000_000_000n
  }, [imported, clockMs])
  const perStoreReview = stores.map(store => {
    const basket = store === 'PLUS' ? basketPair?.plus : basketPair?.deka
    const capture = imported?.captures[store]
    const keys = basket && capture ? basket.lines.flatMap(line => line.status === 'matched'
      ? [reviewedLineKey(store, capture.observedAt, line)] : []) : []
    const accepted = keys.filter(isAcceptedKey).length
    const autoMatched = keys.filter(isAutomaticKey).length
    const complete = !!basket && basket.selectedMealCount > 0 && basket.lines.length > 0 &&
      basket.unresolvedLineCount === 0 && keys.length === basket.lines.length &&
      accepted === keys.length
    const nowNs = BigInt(Math.trunc(clockMs)) * 1_000_000n
    const fresh = !!capture && nowNs >= capture.observedNs - 300_000_000_000n &&
      nowNs - capture.observedNs <= 604_800_000_000_000n
    return { store, accepted, autoMatched, required: keys.length, complete, fresh }
  })
  const reviewedBridge = useMemo((): PrivateReviewedBaskets | null => {
    if (!imported || !basketPair || !planKey) return null
    const verified: PrivateReviewedBaskets['stores'] = {}
    for (const store of stores) {
      const capture = imported.captures[store]
      const basket = store === 'PLUS' ? basketPair.plus : basketPair.deka
      if (!capture || !basket) continue
      const complete = basket.selectedMealCount > 0 && basket.lines.length > 0 &&
        basket.unresolvedLineCount === 0 &&
        basket.matchedLineCount === basket.lines.length &&
        basket.lines.every(line => line.status === 'matched' &&
          isAcceptedKey(reviewedLineKey(store, capture.observedAt, line)))
      const nowNs = BigInt(Math.trunc(clockMs)) * 1_000_000n
      const fresh = nowNs >= capture.observedNs - 300_000_000_000n &&
        nowNs - capture.observedNs <= 604_800_000_000_000n
      if (complete && fresh) verified[store] = {
        basket, observedAt: capture.observedAt, capturedMs: capture.observedMs,
      }
    }
    return Object.keys(verified).length > 0 ? { planKey, stores: verified } : null
  }, [imported, basketPair, reviewedLines, autoReviewKeys, rejectedAutoReviews, clockMs, planKey])
  useEffect(() => {
    onReviewedBaskets?.(reviewedBridge)
  }, [onReviewedBaskets, reviewedBridge])
  // Never promote partial source matching to a priced Planner budget.
  // This metadata is for navigation and explaining what remains to review.
  const captureProgress = useMemo((): PrivateCaptureProgress | null => {
    if (!imported || !planKey) return null
    const statuses: PrivateCaptureProgress['stores'] = {}
    for (const store of stores) {
      const capture = imported.captures[store]
      const basket = store === 'PLUS' ? basketPair?.plus : basketPair?.deka
      if (!capture) continue
      const nowNs = BigInt(Math.trunc(clockMs)) * 1_000_000n
      statuses[store] = {
        observedAt: capture.observedAt,
        originalProductCount: capture.products.length,
        nextIngredientId: basket?.lines.find(line =>
          line.status !== 'matched' || !isAcceptedKey(reviewedLineKey(store, capture.observedAt, line)))?.id ?? null,
        pricedProductCount: capture.products.filter(product =>
          product.sourceAvailable === true &&
          product.sourcePriceCents !== null &&
          product.sourcePriceCents !== undefined &&
          product.packAmount !== null).length,
        demandLineCount: basket?.lines.length ?? 0,
        matchedLineCount: basket?.matchedLineCount ?? 0,
        reviewedLineCount: perStoreReview.find(item => item.store === store)?.accepted ?? 0,
        autoMatchedLineCount: perStoreReview.find(item => item.store === store)?.autoMatched ?? 0,
        // These original source amounts exist only after canonical matching
        // AND the exact receipt-bound review/automatic-identity admission.
        // Never send a partial sum upstream as an eligible basket total.
        confirmedSourceLines: basket?.lines.flatMap(line => {
          if (line.status !== 'matched' || !isAcceptedKey(
            reviewedLineKey(store, capture.observedAt, line))) return []
          if (!Number.isSafeInteger(line.pricePerPackCents) ||
              line.pricePerPackCents < 0 ||
              !Number.isSafeInteger(line.packs) || line.packs <= 0 ||
              !Number.isSafeInteger(line.lineTotalCents) ||
              line.lineTotalCents < 0) return []
          return [{
            ingredientId: line.id, ingredientLabel: line.ingredientLabel,
            requiredAmount: line.requirement.amount,
            requiredUnit: line.requirement.unit,
            lineTotalCents: line.lineTotalCents,
            productId: line.productId, productName: line.productName,
            packAmount: line.pack.amount, packUnit: line.pack.unit,
            packCount: line.pack.count, packagesNeeded: line.packs,
            pricePerPackCents: line.pricePerPackCents,
            unitPrice: privateUnitPrice(line),
            review: isAutomaticKey(reviewedLineKey(store, capture.observedAt, line))
              ? 'automatic' as const : 'manual' as const,
          }]
        }) ?? [],
        missingIngredients: basket?.lines.filter(line =>
          line.status !== 'matched')
          .map(line => ({
            id: line.id, label: line.ingredientLabel,
            amount: line.requirement.amount, unit: line.requirement.unit,
          })) ?? [],
        awaitingReviewIngredients: basket?.lines.filter(line =>
          line.status === 'matched' &&
          !isAcceptedKey(reviewedLineKey(store, capture.observedAt, line)))
          .map(line => ({
            id: line.id, label: line.ingredientLabel,
            amount: line.requirement.amount, unit: line.requirement.unit,
          })) ?? [],
        fresh: nowNs >= capture.observedNs - 300_000_000_000n &&
          nowNs - capture.observedNs <= 604_800_000_000_000n,
      }
    }
    return { planKey, stores: statuses }
  }, [imported, planKey, basketPair, reviewedLines, autoReviewKeys, rejectedAutoReviews, clockMs])
  useEffect(() => {
    onCaptureProgress?.(captureProgress)
  }, [onCaptureProgress, captureProgress])
  const handledReviewFocus = useRef<number | null>(null)
  // Planner may navigate into a lazily mounted compare view. The focus
  // intent stays in App state until the actual article exists in the DOM.
  // It is strictly navigation, never an approval of a suggested SKU.
  useEffect(() => {
    if (!focusReview || focusReview.planKey !== planKey || !imported ||
        handledReviewFocus.current === focusReview.serial) return
    setOpenTripOnly(false)
    const timer = window.setTimeout(() => {
      const target = document.getElementById(
        reviewRowId(focusReview.store, focusReview.ingredientId))
      if (target) {
        handledReviewFocus.current = focusReview.serial
        target.scrollIntoView({ behavior: 'smooth', block: 'center' })
        // A visible keyboard focus completes the jump for screen-reader
        // and keyboard users. Do not select or approve the product.
        const search = target.querySelector<HTMLInputElement>('input[type="search"]')
        if (search) search.focus({ preventScroll: true })
        else target.focus({ preventScroll: true })
      }
    }, 100)
    return () => window.clearTimeout(timer)
  }, [focusReview, imported, planKey])
  function goToReviewRow(store: typeof stores[number], id: string) {
    setOpenTripOnly(false)
    window.setTimeout(() => document.getElementById(reviewRowId(store, id))?.scrollIntoView({
      behavior: 'smooth', block: 'center',
    }), 0)
  }
  function chooseSourceSku(store: typeof stores[number], line: BasketTraceLine, id: string) {
    // Selecting a candidate is never the human's price/pack review.
    if (manualSku[store][line.id] === id) return
    setManualSku(previous => ({
      ...previous, [store]: { ...previous[store], [line.id]: id },
    }))
    setReviewedLines(previous => Object.fromEntries(
      Object.entries(previous).filter(([key]) =>
        !isOwnIngredientKey(key, store, line.id, 2))))
    setDoneTripItems(previous => Object.fromEntries(
      Object.entries(previous).filter(([key]) =>
        !isOwnIngredientKey(key, store, line.id, 1))))
    setTripExportMessage('')
    setTripProgressMessage('')
    setMessage(store + ': bronartikel voor ' + line.ingredientLabel +
      ' gekozen. Bevestig de originele code, verpakking en prijs hieronder. ' +
      'Overige fysieke boodschappen en bronreviews zijn behouden.')
  }

  const allReviewed = perStoreReview.every(item => item.complete)
  const comparisonNextSteps = perStoreReview.flatMap(item => {
    const capture = imported?.captures[item.store]
    const basket = item.store === 'PLUS' ? basketPair?.plus : basketPair?.deka
    if (!capture) return [`${item.store}: voeg je werkelijk geobserveerde eigen winkelbron toe.`]
    if (!item.fresh) return [`${item.store}: vervang je toekomstige of meer dan zeven dagen oude bronopname door een actuele eigen opname.`]
    if (!basket) return [`${item.store}: controleer de geselecteerde Planner-dagen en fysieke ingrediëntbehoefte.`]
    const missing = basket.lines.filter(line => line.status === 'unresolved')
    if (missing.length) return [`${item.store}: ${missing.length} ingrediënten nog onbekend, waaronder ${missing[0].ingredientLabel}. Voeg de werkelijk bijbehorende bronproducten toe of corrigeer de verpakking.`]
    if (item.accepted < item.required) return [`${item.store}: bevestig de oorspronkelijke SKU, verpakking en prijs bij nog ${item.required - item.accepted} voorgestelde productmatches.`]
    return []
  })
  if (imported && Object.keys(imported.captures).length === 2 && !imported.pairedWithin24h) {
    comparisonNextSteps.push('De twee eigen winkelopnames liggen meer dan 24 uur uiteen. Neem beide prijzen opnieuw op binnen één tijdcontext.')
  }
  const canShowDifference = !!imported && currentEnough && imported.pairedWithin24h &&
    allReviewed && !!basketPair?.comparison?.claimable
  /** Exact click-time gate; a 60-second render clock must never authorize
   * exporting a stale price delta when it just crossed its expiry boundary. */
  function eligibleComparisonRightNow(): boolean {
    if (!imported?.captures.PLUS || !imported.captures.DekaMarkt ||
        !imported.pairedWithin24h || !allReviewed ||
        !basketPair?.plus || !basketPair.deka ||
        basketPair.comparison?.claimable !== true) return false
    const nowNs = BigInt(Date.now()) * 1_000_000n
    return stores.every(store => {
      const observed = imported.captures[store]!.observedNs
      return nowNs >= observed - 300_000_000_000n &&
        nowNs - observed <= 604_800_000_000_000n
    })
  }

  const mixedStorePlans = useMemo(() =>
    canShowDifference && basketPair?.plus && basketPair.deka
      ? {
          mixed: createMixedStoreShoppingPlan(basketPair.plus, basketPair.deka),
          single: createMixedStoreShoppingPlan(basketPair.plus, basketPair.deka, 'single'),
        }
      : null,
  [canShowDifference, basketPair])

  const fullDifferenceRows = canShowDifference && basketPair?.plus && basketPair.deka &&
    basketPair.comparison ? [...basketPair.comparison.lineDeltas]
      .sort((a, b) => Math.abs(b.deltaCents) - Math.abs(a.deltaCents))
      .flatMap(delta => {
        const plus = basketPair.plus!.lines.find(line => line.id === delta.id)
        const deka = basketPair.deka!.lines.find(line => line.id === delta.id)
        return plus?.status === 'matched' && deka?.status === 'matched'
          ? [{ delta, plus, deka }] : []
      }) : []

  // Always show the physical 2-shop coverage, even if the second capture,
  // one SKU, a price review or a recent observation is missing. Do not show
  // any unreviewed partial amounts as a complete financial comparison.
  const coverageRows = (basketPair?.plus?.lines ?? basketPair?.deka?.lines ?? []).map(need => {
    const review = (store: typeof stores[number]) => {
      const capture = imported?.captures[store]
      const basket = store === 'PLUS' ? basketPair?.plus : basketPair?.deka
      const line = basket?.lines.find(item => item.id === need.id)
      if (!capture) return { status: 'Geen bron', canReview: false, product: '', confirmedPrice: null as string | null }
      if (!line) return { status: 'Planning niet koppelbaar', canReview: false, product: '', confirmedPrice: null as string | null }
      if (line.status !== 'matched') return { status: 'SKU/verpakking ontbreekt', canReview: true, product: '', confirmedPrice: null as string | null }
      const product = line.productName + ' · broncode ' + line.productId +
        ' · ' + line.pack.amount + ' ' + line.pack.unit + ' × ' + line.pack.count
      if (!perStoreReview.find(item => item.store === store)?.fresh)
        return { status: 'Opname verlopen of toekomstig', canReview: true, product, confirmedPrice: null as string | null }
      if (!isAcceptedKey(reviewedLineKey(store, capture.observedAt, line)))
        return { status: 'Product, verpakking en prijs controleren', canReview: true, product, confirmedPrice: null as string | null }
      return { status: 'Persoonlijk bevestigd', canReview: true, product,
        confirmedPrice: exactEuro.formatCents(line.lineTotalCents) +
          ' voor ' + line.packs + ' hele pak(ken) · ' +
          (pricePerUnit(line) ?? 'eenheidsprijs onbekend') }
    }
    const plus = review('PLUS')
    const deka = review('DekaMarkt')
    const plusLine = basketPair?.plus?.lines.find(item => item.id === need.id)
    const dekaLine = basketPair?.deka?.lines.find(item => item.id === need.id)
    // Only compare an individual, identical physical demand if BOTH exact
    // source records are fresh, paired and personally/automatically approved.
    // This never supplies an unverified whole-basket delta or winner.
    let singleLineDelta: string | null = null
    if (imported?.pairedWithin24h && plus.confirmedPrice && deka.confirmedPrice &&
        plusLine?.status === 'matched' && dekaLine?.status === 'matched' &&
        samePhysicalDemand(plusLine.requirement, dekaLine.requirement)) {
      const cents = dekaLine.lineTotalCents - plusLine.lineTotalCents
      if (Number.isSafeInteger(cents)) {
        singleLineDelta = cents === 0 ? 'Gelijk voor deze ingrediëntregel' :
          (cents > 0 ? 'PLUS' : 'DekaMarkt') + ' rekent bij jouw gekozen artikelen ' +
          exactEuro.formatCents(Math.abs(cents)) + ' minder voor deze ingrediëntregel'
      }
    }
    return {
      id: need.id, label: need.ingredientLabel,
      amount: need.requirement.amount, unit: need.requirement.unit,
      PLUS: plus, DekaMarkt: deka, singleLineDelta,
    }
  })
  const olderPairCapture = imported?.captures.PLUS && imported.captures.DekaMarkt &&
    !imported.pairedWithin24h
    ? imported.captures.PLUS.observedNs <= imported.captures.DekaMarkt.observedNs
      ? 'PLUS' : 'DekaMarkt'
    : null
  const openCoverageRows = coverageRows.filter(row =>
    !!olderPairCapture || stores.some(store => row[store].status !== 'Persoonlijk bevestigd'))
  // Display filters do not affect source prices, human review, or completeness.
  const outstandingByStore = Object.fromEntries(stores.map(store => [store,
    coverageRows.filter(row => olderPairCapture === store ||
      row[store].status !== 'Persoonlijk bevestigd').length,
  ])) as Record<(typeof stores)[number], number>
  const storeCoverageProgress = stores.map(store => {
    const confirmed = coverageRows.filter(row => row[store].status === 'Persoonlijk bevestigd').length
    const pending = coverageRows.filter(row => row[store].status !== 'Persoonlijk bevestigd')
    const older = olderPairCapture === store
    const source = imported?.captures[store]
    const recapture = older || !source || pending.some(row =>
      row[store].status === 'Opname verlopen of toekomstig')
    const actionable = pending.find(row => row[store].canReview &&
      (row[store].status === 'SKU/verpakking ontbreekt' ||
       row[store].status === 'Product, verpakking en prijs controleren'))
    return { store, confirmed, total: coverageRows.length, pending: pending.length,
      older, recapture, actionable }
  })
  function openNextCoverageStep(store: typeof stores[number]) {
    const progress = storeCoverageProgress.find(item => item.store === store)
    if (!progress) return
    if (progress.recapture) {
      document.getElementById('supa-own-price-import')?.scrollIntoView({
        behavior: 'smooth', block: 'start',
      })
      return
    }
    if (progress.actionable) goToReviewRow(store, progress.actionable.id)
  }
  const normalizedCoverageSearch = searchableSourceText(coverageSearch)
  const visibleCoverageRows = coverageRows.filter(row => {
    if (coverageScope === 'open' && !openCoverageRows.includes(row)) return false
    if ((coverageScope === 'PLUS' || coverageScope === 'DekaMarkt') &&
        olderPairCapture !== coverageScope &&
        row[coverageScope].status === 'Persoonlijk bevestigd') return false
    return !normalizedCoverageSearch || searchableSourceText([row.label, row.id,
      row.PLUS.status, row.PLUS.product, row.DekaMarkt.status, row.DekaMarkt.product,
    ].join(' ')).includes(normalizedCoverageSearch)
  })
  // Price capture is needed only for missing source facts or stale
  // observations. An existing matched SKU awaiting human review does not
  // require another fictitious catalog observation.
  const missingPriceCaptureNeeds = Object.fromEntries(stores.map(store => {
    const missing = coverageRows.filter(row =>
      olderPairCapture === store ||
      ['Geen bron', 'SKU/verpakking ontbreekt', 'Planning niet koppelbaar',
        'Opname verlopen of toekomstig'].includes(row[store].status))
    const ids = new Set(missing.map(row => row.id))
    return [store, plannerCaptureNeeds.filter(need => ids.has(need.id))]
  })) as Record<(typeof stores)[number], typeof plannerCaptureNeeds>

  function missingCaptureNeedsNow(store: (typeof stores)[number]) {
    // Both file download and phone clipboard use the same live source-age
    // admission. A newly expired source needs a whole fresh capture, not a
    // short list that misleadingly reuses old package prices or timestamps.
    const capture = imported?.captures[store]
    const nowNs = BigInt(Date.now()) * 1_000_000n
    const sourceFresh = !!capture && nowNs >= capture.observedNs - 300_000_000_000n &&
      nowNs - capture.observedNs <= 604_800_000_000_000n
    return !sourceFresh || olderPairCapture === store
      ? plannerCaptureNeeds : missingPriceCaptureNeeds[store]
  }

  async function downloadMissingPriceCapture(store: (typeof stores)[number], kind: 'csv' | 'guide') {
    const needs = missingCaptureNeedsNow(store)
    if (!needs.length) return
    try {
      const text = kind === 'csv'
        ? (await import('./plannerPriceCaptureSheet.ts')).makeBlankPlannerCaptureCsv(needs, [store], captureDelimiter)
        : (await import('./plannerPriceCaptureGuide.ts')).makePlannerCaptureGuide(needs, [store])
      const url = URL.createObjectURL(new Blob([text], {
        type: kind === 'csv' ? (captureDelimiter === '\t'
          ? 'text/tab-separated-values;charset=utf-8' : 'text/csv;charset=utf-8') : 'text/plain;charset=utf-8',
      }))
      try {
        const link = document.createElement('a')
        link.href = url
        link.download = 'supa-' + store.toLowerCase() + '-ontbrekende-' + needs.length +
          (kind === 'csv' ? (captureDelimiter === '\t' ? '.tsv' : '.csv') : '-gids.txt')
        document.body.append(link)
        try { link.click() } finally { link.remove() }
      } finally { window.setTimeout(() => URL.revokeObjectURL(url), 1000) }
      setCoverageMessage(store + ': ' + needs.length +
        ' onvolledige of verlopen bronregels als nieuwe lege ' +
        (kind === 'csv' ? 'CSV' : 'opnamegids') +
        ' gedownload. Vul alleen echte nieuwe productfeiten in; oude prijzen, namen en bronmomenten zijn niet gekopieerd.')
    } catch {
      setCoverageMessage('Geen geldig kort invulblad. Gebruik het volledige Planner-invulblad.')
    }
  }
  function downloadCoverageChecklist(onlyOpen = false) {
    if (!imported || coverageRows.length === 0) return
    // Refresh source age at the moment the field list is downloaded rather
    // than reusing the 60-second screen clock. The list is a work aid, never
    // authoritative evidence of a current shop price.
    const nowNs = BigInt(Date.now()) * 1_000_000n
    const rows = coverageRows.map(row => ({
      ...row,
      ...Object.fromEntries(stores.map(store => {
        const captured = imported.captures[store]
        const fresh = !!captured &&
          nowNs >= captured.observedNs - 300_000_000_000n &&
          nowNs - captured.observedNs <= 604_800_000_000_000n
        const item = row[store]
        return [store, !fresh && item.status === 'Persoonlijk bevestigd'
          ? { ...item, status: 'Eigen opname verouderd of toekomstig; opnieuw opnemen' }
          : olderPairCapture === store && item.status === 'Persoonlijk bevestigd'
            ? { ...item, status: 'Ouder bronmoment; neem binnen 24 uur van de andere winkel opnieuw op' }
            : item]
      })),
    })) as typeof coverageRows
    const selected = onlyOpen ? rows.filter(row =>
      stores.some(store => row[store].status !== 'Persoonlijk bevestigd')) : rows
    if (!selected.length) {
      setCoverageMessage('Geen open productcontroles. Alle beschikbare eigen bronartikelen zijn afzonderlijk bevestigd.')
      return
    }
    const content = [
      onlyOpen ? 'SUPA · uitsluitend OPEN winkelproductcontroles uit jouw Planner' :
        'SUPA · privé veld- en productcontrole voor exact dezelfde Planner-vraag',
      'Geen prijs- of bronrechtenbewijs. Ontbrekend/verlopen is onbekend, niet EUR 0.',
      ...stores.map(store => store + ' · eigen waarneming: ' +
        (imported.captures[store]?.observedAt ?? 'ONTBREEKT')),
      '',
      ...selected.flatMap(row => [
        row.label.replace(/[\r\n\u0000-\u001f\u007f-\u009f]/gu, ' ') +
          ' · ' + (row.amount ?? '?') + ' ' + row.unit,
        '  PLUS: ' + row.PLUS.status + (row.PLUS.product ? ' · voorgesteld bronartikel ' + row.PLUS.product.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ') : ''),
        '  DekaMarkt: ' + row.DekaMarkt.status + (row.DekaMarkt.product ? ' · voorgesteld bronartikel ' + row.DekaMarkt.product.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ') : ''),
      ]),
      'Controleer iedere SKU, verpakking en prijs tegen je eigen bron. Geen publieke besparingsclaim.',
    ].join('\n')
    const url = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }))
    try {
      const link = document.createElement('a')
      link.href = url
      link.download = onlyOpen ? 'supa-alleen-open-winkelcontroles.txt' :
        'supa-prive-dekking-en-ontbrekende-producten.txt'
      document.body.append(link)
      try { link.click() } finally { link.remove() }
      setCoverageMessage((onlyOpen ? 'Alleen de ' + selected.length + ' nog open Planner-regels' :
        'Alle ' + selected.length + ' Planner-regels') +
        ' lokaal bewaard met bronstatus per winkel. Geen prijzen of bronrechten toegevoegd.')
    } finally { window.setTimeout(() => URL.revokeObjectURL(url), 1000) }
  }

  async function downloadReviewedIngredientLedger(format: 'csv' | 'html' = 'csv') {
    if (!imported || !basketPair || !coverageRows.length) return
    const sourceRevision = importRevision.current
    const originalSource = text
    const originalPlan = captureWeek
    try {
      const { literalCsv } = await import('../../privateBasketComparisonCsv.ts')
      // An async module load must not export a previous week or withdrawn
      // source receipt after the user edits/replaces the local capture.
      if (sourceRevision !== importRevision.current ||
          originalSource !== currentActiveSource.current ||
          originalPlan !== captureWeekRef.current)
        throw Error('Source or week changed while preparing private export')
      const nowNs = BigInt(Date.now()) * 1_000_000n
      const exactLine = (store: typeof stores[number], id: string) => {
        const source = imported.captures[store]
        const basket = store === 'PLUS' ? basketPair.plus : basketPair.deka
        const line = basket?.lines.find(item => item.id === id)
        const fresh = !!source && nowNs >= source.observedNs - 300_000_000_000n &&
          nowNs - source.observedNs <= 604_800_000_000_000n
        const empty = (status: string) => ({ values: [status, source?.observedAt ?? '', ...new Array<string>(9).fill('')], line: null as Matched | null })
        if (!source) return empty('Geen bron')
        if (!fresh) return empty('Bron verlopen of toekomstig')
        if (!line || line.status !== 'matched' ||
            !isAcceptedKey(reviewedLineKey(store, source.observedAt, line)))
          return empty('Niet persoonlijk bevestigd')
        return { values: ['Bevestigde eigen bron', source.observedAt, line.productId,
          line.productName, String(line.packs), String(line.pack.amount),
          line.pack.unit, String(line.pack.count), String(line.pricePerPackCents),
          String(line.lineTotalCents), privateUnitPrice(line) ?? ''], line }
      }
      const rows = [[
        'ingredient_id', 'ingredient', 'benodigd', 'eenheid',
        ...stores.flatMap(store => ['status', 'bronmoment', 'productcode', 'product',
          'hele_pakken', 'pakinhoud', 'pakeenheid', 'stuks_per_verpakking',
          'pakprijs_cent', 'regel_cent', 'eenheidsprijs'].map(field => store + '_' + field)),
        'Deka_minus_PLUS_cent', 'betekenis',
      ]]
      for (const need of coverageRows) {
        const plus = exactLine('PLUS', need.id)
        const deka = exactLine('DekaMarkt', need.id)
        const both = imported.pairedWithin24h && plus.line && deka.line &&
          samePhysicalDemand(plus.line.requirement, deka.line.requirement)
        const delta = both ? deka.line!.lineTotalCents - plus.line!.lineTotalCents : null
        const comparable = delta !== null && Number.isSafeInteger(delta)
        rows.push([need.id, need.label, need.amount === null ? '' : String(need.amount),
          need.unit, ...plus.values, ...deka.values,
          comparable ? String(delta) : '',
          comparable ? 'Eigen gekoppelde ingredientregels' : 'Prijsverschil onbekend'])
      }
      const csv = '\uFEFF' + rows.map(row => row.map((cell, index) =>
        literalCsv(cell, index === rows[0].length - 2)).join(';')).join('\r\n') + '\r\n'
      if (new TextEncoder().encode(csv).length > 256000) throw Error('Bestand te groot')
      const content = format === 'html'
        ? (await import('./partialReviewedPrintHtml.ts')).partialReviewedPricePrintHtml(rows)
        : csv
      if (sourceRevision !== importRevision.current ||
          originalSource !== currentActiveSource.current ||
          originalPlan !== captureWeekRef.current)
        throw Error('Bron of week tijdens export veranderd')
      if (new TextEncoder().encode(content).length > 512000) throw Error('Bestand te groot')
      const url = URL.createObjectURL(new Blob([content], {
        type: format === 'html' ? 'text/html;charset=utf-8' : 'text/csv;charset=utf-8',
      }))
      try {
        const link = document.createElement('a')
        link.href = url
        link.download = format === 'html' ? 'supa-mijn-prive-prijzen-afdrukken.html' :
          'supa-prive-deelprijzen-gecontroleerd.csv'
        document.body.append(link)
        try { link.click() } finally { link.remove() }
      } finally { window.setTimeout(() => URL.revokeObjectURL(url), 1000) }
      setCoverageMessage('Eigen bevestigde bronprijzen als privé ' +
        (format === 'html' ? 'afdrukoverzicht' : 'CSV-werkblad') +
        ' gedownload. Onbekend blijft onbekend; geen totaal of besparingsclaim.')
    } catch {
      setCoverageMessage('Prijswerkblad niet beschikbaar; vorige brondata en beoordelingen blijven intact.')
    }
  }

  const readableReport = canShowDifference && basketPair?.plus && basketPair.deka &&
    basketPair.comparison && basketPair.comparison.deltaCents !== null &&
    imported?.captures.PLUS && imported.captures.DekaMarkt &&
    fullDifferenceRows && fullDifferenceRows.length === basketPair.plus.lines.length &&
    fullDifferenceRows.length === basketPair.deka.lines.length
    ? readablePrivateComparison(basketPair.plus, basketPair.deka,
        { PLUS: imported.captures.PLUS.observedAt, DekaMarkt: imported.captures.DekaMarkt.observedAt },
        basketPair.comparison.deltaCents!, fullDifferenceRows)
    : null

  function downloadReadableReport() {
    if (!readableReport || !eligibleComparisonRightNow()) {
      setTripExportMessage('Het bronmoment of een productbevestiging is inmiddels verlopen: geen privéverschil meer te downloaden. Neem nieuwe geldige prijzen op.')
      return
    }
    const url = URL.createObjectURL(new Blob([readableReport], { type: 'text/plain;charset=utf-8' }))
    try {
      const link = document.createElement('a')
      link.href = url
      link.download = 'supa-prive-vergelijking-leesbaar.txt'
      document.body.append(link)
      try { link.click() } finally { link.remove() }
      setTripExportMessage('Jouw leesbare privévergelijking lokaal opgeslagen, met alle bronartikelen, verpakkingen en bedragen.')
    } finally { window.setTimeout(() => URL.revokeObjectURL(url), 1000) }
  }

  return (
    <section className="offline-price-workbench" aria-label="Geïmporteerde winkelprijzen vergelijken">
      <div className="offline-price-workbench__intro">
        <span className="eyebrow">Jouw planner → brongegevens → winkelmandjes</span>
        <h2>Vergelijk twee winkels met eigen prijsdata</h2>
        <p>Vul producten en prijzen direct per winkel in, of laad een eerder rechtmatig verkregen CSV- of JSON-export.
          Supa koppelt producten aan jouw huidige weekmenu, rondt verpakkingen naar boven af
          en berekent eenheidsprijzen en volledige mandtotalen. De import start geen scraper of netwerkverzoek.</p>
        <p className="disclaimer">Privé rekenhulp: een aangeleverd bestand bewijst geen toestemming, productidentiteit,
          actuele winkelprijs of besparing. Onbekende producten krijgen nooit een verzonnen prijs.
          PLUS en DekaMarkt zijn hier uitsluitend vergelijkingslabels.</p>
      </div>
      <UnpricedPlannerChecklist plan={plan} recipes={recipes} activeDays={activeDays} />
      <div className="offline-price-workbench__input" aria-label="Weekmenu naar eigen-bronvergelijker">
        <h3>Gebruik ditzelfde weekmenu met jouw eigen winkelbronbestanden</h3>
        <p>Exporteer alleen de werkelijk geselecteerde maaltijden en fysieke ingrediënten naar de
          uitgebreide privéwerkbank. Importeer daar jouw eigen PLUS- en/of DekaMarkt-opname en
          kies zelf de bijpassende bronproducten. Recepten en hoeveelheden gaan alleen in het
          lokaal gedownloade bestand; geen prijzen of winkelrechten worden overgedragen.</p>
        <div className="offline-price-workbench__actions">
          <button type="button" onClick={saveSelectedWeek}>
            Download geselecteerd weekmenu (JSON)
          </button>
          <label>Invulblad voor winkel(s)
            <select value={captureSheetStore}
              onChange={event => setCaptureSheetStore(event.target.value as 'both' | CaptureStore)}>
              <option value="both">PLUS en DekaMarkt</option>
              <option value="PLUS">Alleen PLUS</option>
              <option value="DekaMarkt">Alleen DekaMarkt</option>
            </select>
          </label>
          <label>Bestandsindeling voor spreadsheet
            <select value={captureDelimiter}
              onChange={event => setCaptureDelimiter(event.target.value as ',' | ';' | '\t')}>
              <option value=",">CSV met komma's</option>
              <option value=";">Excel Nederlands met puntkomma's</option>
              <option value={'\t'}>TSV met tabs</option>
            </select>
          </label>
          <button type="button" className="ghost-button"
            disabled={plannerCaptureNeeds.length === 0}
            onClick={downloadBlankPlannerCaptureCsv}>
            Download leeg prijsinvulblad (CSV)
          </button>
          <button type="button" className="ghost-button"
            disabled={plannerCaptureNeeds.length === 0}
            onClick={downloadPlannerCaptureGuide}>
            Download bijhorende opnamegids (TXT)
          </button>
          <button type="button" className="ghost-button"
            disabled={plannerCaptureNeeds.length === 0}
            onClick={downloadPrintablePlannerCapture}>
            Download printbaar opnameformulier (HTML)
          </button>
          <PortableBlankCapture needs={plannerCaptureNeeds}
            stores={captureSheetStore === 'both' ? stores : [captureSheetStore]}
            delimiter={captureDelimiter}
            onReview={files => previewFilledCsv(files)}
            onDraftChange={invalidateOwnMobileSourcePreview}
            captureKey={captureWeek + ':' + captureSheetStore + ':' + captureDelimiter} />
          <a className="ghost-button" href={`${import.meta.env.BASE_URL}private-basket-mapping.html`} target="_blank" rel="noopener noreferrer">
            Open uitgebreide privévergelijker
          </a>
        </div>
        {plannerCaptureNeeds.length > 0 && (
          <details>
            <summary>Welke prijsinvulregel hoort bij welk Planner-ingrediënt?</summary>
            <p>Vul uitsluitend je werkelijk waargenomen winkelproduct in. In de CSV staan eerst
              {captureSheetStore === 'both'
                ? ` ${plannerCaptureNeeds.length} PLUS-regels, gevolgd door ${plannerCaptureNeeds.length} DekaMarkt-regels.`
                : ` ${plannerCaptureNeeds.length} ${captureSheetStore}-regels.`}
              De eerste regel bevat kolomkoppen. Alle productcodes, namen, bronmomenten,
              verpakkingsinhouden en prijzen zijn bewust leeg. De voorgestelde eenheid is
              alleen een hulp; controleer de echte verpakking. Zet beschikbaarheid alleen
              op <code>true</code> na controle van je echte bron. Lege regels worden overgeslagen.
              De twee winkels hoeven niet allebei ingevuld te zijn; zonder tweede winkel
              verschijnt geen prijsverschil.</p>
            <ol>{plannerCaptureNeeds.map((need, index) => (
              <li key={need.id}>
                {captureSheetStore !== 'DekaMarkt' && <>PLUS CSV-regel {index + 2}</>}
                {captureSheetStore === 'both' && ' / '}
                {captureSheetStore !== 'PLUS' && <>DekaMarkt CSV-regel {index + 2 +
                  (captureSheetStore === 'both' ? plannerCaptureNeeds.length : 0)}</>}:
                {' '}{need.label} · gevraagd {need.amount ?? '?'} {need.unit}
              </li>
            ))}</ol>
          </details>
        )}
        <section id="supa-price-sheet-review"
          className="offline-price-workbench__input offline-price-workbench__capture-review"
          aria-label="Eigen ingevuld prijsblad eerst controleren">
          <label>Controleer één ingevuld CSV-prijsblad of twee aparte winkelbladen vóór import
            <input type="file" accept=".csv,.tsv,text/csv,text/tab-separated-values" multiple
              disabled={busy || plannerCaptureNeeds.length === 0}
              onChange={event => {
                const files = Array.from(event.currentTarget.files ?? [])
                event.currentTarget.value = ''
                void previewFilledCsv(files)
              }} />
            <small>Controleert lokaal de oorspronkelijke bronvelden en timestamps.
              Een gedeeltelijk ingevulde regel wordt nooit stilzwijgend weggegooid.</small>
          </label>
          <PrivateCapturePastePreview disabled={busy || plannerCaptureNeeds.length === 0}
            onDraftChange={() => {
              // A changed pasted sheet invalidates only the unaccepted
              // price preview, never a separately accepted active source.
              ++importRevision.current
              setCapturePreview(null)
              setWeekExportMessage('De geplakte bron is gewijzigd. Controleer het hele bronblad opnieuw voordat je prijzen overneemt.')
            }}
            onPreview={sources => {
              // File identity is used only to reuse the already-reviewed CSV
              // preview route; source identity and facts come from its parser.
              const files = sources.map((raw, index) => new File(
                [raw], 'supa-eigen-bron-' + (index + 1) + '.csv',
                { type: 'text/csv;charset=utf-8' },
              ))
              void previewFilledCsv(files)
            }} />
          {currentPreview && (
            <div className="offline-price-workbench__capture-preview" role="region" aria-label="Controle van ingevuld bronblad">
              <strong>Bronblad leesbaar, nog geen productmatch goedgekeurd</strong>
              {currentPreview.stores.map(store => (
                <p key={store.retailer}>{store.retailer}: {store.enteredProducts}
                  {' '}zelf ingevoerde bronproducten, {store.unobservedRows}
                  {' '}lege en ongeprijsde regels.</p>
              ))}
              {currentPreview.stores.map(store => (
                <p key={'fresh-' + store.retailer} role="status"
                  className={capturePreviewFresh(store) ? 'disclaimer' : 'offline-price-workbench__capture-alert'}>
                  {store.retailer}: {capturePreviewFresh(store)
                    ? 'bronmoment binnen 7 dagen; controleer altijd de oorspronkelijke prijs'
                    : 'bronmoment ouder dan 7 dagen, onmogelijk toekomstig of onbekend; géén actuele winkelprijs'}
                </p>
              ))}
              {currentPreview.stores.length === 2 && !currentPreview.pairedWithin24h && (
                <p role="status" className="offline-price-workbench__capture-alert">
                  De twee oorspronkelijke bronmomenten liggen meer dan 24 uur uiteen.
                  Ook na import kan Supa hieruit geen vergelijkbaar prijsverschil afleiden.
                </p>
              )}
              {currentPreview.retainedOther && (
                <p role="status" className={
                  currentPreview.retainedOther.within24h &&
                  freshPreviewInstant(currentPreview.retainedOther.observedNs)
                    ? 'disclaimer' : 'offline-price-workbench__capture-alert'
                }>
                  Je hebt al een eigen {currentPreview.retainedOther.retailer}-opname geladen.
                  {freshPreviewInstant(currentPreview.retainedOther.observedNs)
                    ? ' Dat bewaarde bronmoment ligt nog binnen zeven dagen.'
                    : ' Dat bewaarde bronmoment is verlopen of toekomstig.'}
                  {currentPreview.retainedOther.within24h
                    ? ' De twee werkelijk ingevoerde bronmomenten liggen binnen 24 uur.'
                    : ' De nieuwe bron en de bewaarde winkel liggen meer dan 24 uur uiteen. ' +
                      (currentPreview.retainedOther.observedNs <
                        (currentPreview.stores[0]?.observedNs ?? currentPreview.retainedOther.observedNs)
                        ? 'Herobserveer de oudere bewaarde winkel, niet de nieuwere upload.'
                        : 'Herobserveer de oudere winkel uit je nieuwe upload, niet de nieuwere bewaarde opname.')}
                  {' '}Een prijsverschil blijft onbekend totdat beide bronopnames
                  actueel zijn en alle fysieke productmatches afzonderlijk zijn bevestigd.
                </p>
              )}
              {currentPreview.stores.map(store => {
                const query = capturePreviewSearch[store.retailer]
                  .normalize('NFC').trim().toLocaleLowerCase('nl-NL')
                const filteredProducts = store.previewProducts.filter(product => {
                  if (!query) return true
                  const searchable = [product.name, product.id, product.packAmount, product.packUnit]
                    .map(value => String(value ?? '')).join(' ')
                    .normalize('NFC').toLocaleLowerCase('nl-NL')
                  return searchable.includes(query)
                })
                const sort = capturePreviewSort[store.retailer]
                const visibleProducts = [...filteredProducts].sort((a, b) => {
                  if (sort === 'source') return 0
                  if (sort === 'name') return a.name.localeCompare(b.name, 'nl-NL')
                  if (sort === 'sku') return a.id.localeCompare(b.id, 'nl-NL')
                  const aPriced = a.available && a.priceCents !== null
                  const bPriced = b.available && b.priceCents !== null
                  if (sort === 'unknown')
                    return Number(aPriced) - Number(bPriced) || a.name.localeCompare(b.name, 'nl-NL')
                  return (aPriced ? a.priceCents! : Number.MAX_SAFE_INTEGER) -
                    (bPriced ? b.priceCents! : Number.MAX_SAFE_INTEGER) ||
                    a.name.localeCompare(b.name, 'nl-NL')
                })
                const shownProducts = visibleProducts.slice(0, capturePreviewShown[store.retailer])
                return (
                <details key={'details-' + store.retailer}>
                  <summary>{store.retailer}: originele ingevoerde artikelen bekijken
                    {' '}({store.unavailableProducts} zonder bruikbare pakprijs)</summary>
                  <p>Oorspronkelijk ingevoerd bronmoment:
                    {' '}<time>{store.observedAt}</time>. Nog géén match- of herkomstbevestiging.</p>
                  <label>Zoek in originele producten op naam, broncode of verpakking
                    <input type="search" maxLength={100}
                      value={capturePreviewSearch[store.retailer]}
                      placeholder="Bijv. tomaten of SKU"
                      onChange={event => {
                        const value = event.currentTarget.value
                        setCapturePreviewSearch(current => ({
                          ...current, [store.retailer]: value,
                        }))
                        setCapturePreviewShown(current => ({ ...current, [store.retailer]: 20 }))
                      }} />
                  </label>
                  <label>Sorteer originele bronartikelen
                    <select value={capturePreviewSort[store.retailer]}
                      onChange={event => {
                        const value = event.currentTarget.value as 'source' | 'name' | 'sku' | 'price' | 'unknown'
                        setCapturePreviewSort(current => ({ ...current, [store.retailer]: value }))
                        setCapturePreviewShown(current => ({ ...current, [store.retailer]: 20 }))
                      }}>
                      <option value="source">Oorspronkelijke volgorde</option>
                      <option value="name">Productnaam A–Z</option>
                      <option value="sku">Broncode A–Z</option>
                      <option value="price">Laagste pakprijs eerst</option>
                      <option value="unknown">Onbekende pakprijs eerst</option>
                    </select>
                  </label>
                  <p role="status">{visibleProducts.length} van {store.previewProducts.length} originele artikelen gevonden.
                    {' '}Zoeken verandert bronprijzen of productmatches niet.</p>
                  <ul>
                    {shownProducts.map(product => {
                      const rate = privatePackUnitRate({
                        amount: product.packAmount, unit: product.packUnit,
                        count: product.packCount ?? 0,
                        priceCents: product.available ? product.priceCents : null,
                      })
                      return <li key={product.id}>
                        <strong>{product.name}</strong> · originele code {product.id}
                        {' '}· {product.packAmount ?? 'onbekend'} {product.packUnit}
                        {' '}× {product.packCount === null ? 'niet opgegeven' : product.packCount}
                        {' '}· {product.available && product.priceCents !== null
                          ? exactEuro.formatCents(product.priceCents) + ' per verpakking'
                          : 'pakprijs onbekend / niet beschikbaar'}
                        {rate && <> · {exactEuro.formatCents(rate.roundedCentsPerUnit)} / {rate.unit}</>}
                      </li>
                    })}
                    {visibleProducts.length === 0 && <li>Geen origineel bronartikel gevonden. Wis je zoekterm om alles te bekijken.</li>}
                  </ul>
                  {shownProducts.length < visibleProducts.length && (
                    <button type="button" className="ghost-button" disabled={busy}
                      onClick={() => setCapturePreviewShown(current => ({ ...current,
                        [store.retailer]: Math.min(visibleProducts.length,
                          current[store.retailer] + 20),
                      }))}>
                      Toon volgende bronartikelen ({shownProducts.length}
                      {' '}van {visibleProducts.length} gevonden)
                    </button>
                  )}
                </details>
                )
              })}
              {previewPlusLines && previewDekaLines && (
                  <CapturePairedPreview
                    key={'paired:' + captureWeek + ':' +
                      currentPreview.stores.map(store => store.observedAt).join(':') + ':' +
                      (currentPreview.retainedOther?.observedAt ?? '')}
                    plus={previewPlusLines} deka={previewDekaLines}
                    within24h={previewPair24h} sourceFresh={previewPairFresh}
                    delimiter={captureDelimiter}
                    plusFresh={freshPreviewInstant(
                      currentPreview.stores.find(store => store.retailer === 'PLUS')?.observedNs ??
                      (currentPreview.retainedOther?.retailer === 'PLUS'
                        ? currentPreview.retainedOther.observedNs : undefined))}
                    dekaFresh={freshPreviewInstant(
                      currentPreview.stores.find(store => store.retailer === 'DekaMarkt')?.observedNs ??
                      (currentPreview.retainedOther?.retailer === 'DekaMarkt'
                        ? currentPreview.retainedOther.observedNs : undefined))}
                    plusObservedAt={previewPlusAt} dekaObservedAt={previewDekaAt}
                    retainedStore={currentPreview.retainedOther?.retailer}
                    describeReason={humanMatchReason} />
                )}
              {currentPreview.stores.map(store => store.matching && (
                <CaptureMatchingPreview
                  key={store.retailer + ':' + store.observedAt + ':' + captureWeek}
                  retailer={store.retailer} lines={store.matching.lines}
                  proposed={store.matching.proposed} unresolved={store.matching.unresolved}
                  appended={!!store.appendableNewProducts} reason={humanMatchReason} />
              ))}
              {currentPreview.unobservedOtherStoreRows > 0 && !currentPreview.retainedOther && (
                <p>{currentPreview.unobservedOtherStoreRows}
                  {' '}niet geobserveerde regels bij de andere winkel;
                  geen tweede winkelprijs.</p>
              )}
              <div id="supa-two-store-capture-followup" tabIndex={-1}
                className="offline-price-workbench__capture-followup">
                <strong>Vul ontbrekende of verlopen winkelproducten aan</strong>
                <p>Per winkel kun je een kort leeg CSV-opnameblad plus de bijhorende
                  ingrediëntenrijgids downloaden. Er wordt geen winkelprijs,
                  productcode of bronmoment voor je ingevuld. Bij een verlopen
                  of buiten 24 uur gepaarde bron is een volledige nieuwe opname nodig.</p>
                <p className="disclaimer">Vul een nieuwe opname met het echte waarnemingsmoment in.
                  Een losse aanvulling kan alleen bij exact dezelfde oorspronkelijk
                  waargenomen opname worden gevoegd. Heb je ontbrekende producten later
                  pas gecontroleerd? Neem dan de hele winkel opnieuw op: geef nieuwe
                  prijzen nooit kunstmatig het oudere bronmoment om de import te laten passen.
                  Supa controleert vóór vervangen welke oorspronkelijke SKU’s verdwijnen.</p>
                {stores.map(store => {
                  const missingNeeds = missingPreviewCaptureNeeds(store)
                  const missing = missingNeeds.length
                  const source = currentPreview.stores.find(item => item.retailer === store)
                  const other = currentPreview.stores.find(item => item.retailer !== store)
                  const retained = currentPreview.retainedOther
                  // This label must agree with missingPreviewCaptureNeeds:
                  // a one-file comparison recaptures the OLDER capture only.
                  const expiredSource = source ? !capturePreviewFresh(source) :
                    retained?.retailer === store
                      ? !freshPreviewInstant(retained.observedNs) : false
                  const olderSource = source && source.observedNs !== undefined
                    ? (other && !currentPreview.pairedWithin24h &&
                        other.observedNs !== undefined && source.observedNs < other.observedNs) ||
                      (retained && retained.retailer !== store && !retained.within24h &&
                        source.observedNs < retained.observedNs)
                    : retained?.retailer === store && !retained.within24h &&
                      !!other?.observedNs && retained.observedNs < other.observedNs
                  const recapture = expiredSource || olderSource
                  return <div key={'missing-' + store} className="offline-price-workbench__capture-followup-row">
                    <span>{store}: {missing
                      ? missing + (recapture
                        ? ' volledige opnieuw te observeren fysieke regels (verlopen of oudste bron)'
                        : ' nog onbekende productregels')
                      : 'geen ontbrekende nieuwe bronregels vanuit deze preview'}</span>
                    <button type="button" className="ghost-button" disabled={busy || !missing}
                      onClick={() => { void downloadPreviewMissingCapture(store, 'csv') }}>
                      {store} opname-CSV
                    </button>
                    <button type="button" className="ghost-button" disabled={busy || !missing}
                      onClick={() => { void downloadPreviewMissingCapture(store, 'guide') }}>
                      {store} rijgids (TXT)
                    </button>
                    {missing > 0 && <details>
                      <summary>{store}: vul ontbrekende bronregels mobiel in zonder download</summary>
                      <PortableBlankCapture purpose="missing"
                        onReview={files => previewFilledCsv(files)}
                        needs={missingNeeds}
                        needsAtClick={() => missingPreviewCaptureNeeds(store)}
                        stores={[store]} delimiter={captureDelimiter}
                        captureKey={captureWeek + ':preview-missing:' + store + ':' +
                          captureDelimiter + ':' + importRevision.current + ':' +
                          Math.floor(clockMs / 60000)} />
                    </details>}
                  </div>
                })}
              </div>
              <p className="disclaimer">Deze lokale CSV-controle geeft geen
                retailerrechten, bronverificatie of besparingsbewijs.
                Controleer na overname zelf ieder oorspronkelijk artikel,
                de verpakking, prijs en datum.</p>
              {stores.some(store => missingPreviewCaptureNeeds(store).length > 0) ? (
                <>
                  <button type="button" className="ghost-button" disabled={busy}
                    onClick={downloadMissingFromPreview}>
                    Download alleen ontbrekende winkelproducten (TXT)
                  </button>
                  <button type="button" className="ghost-button" disabled={busy}
                    onClick={() => { void downloadMissingPreviewCsv(';') }}>
                    Download Excel-invulblad voor ontbrekende PLUS/Deka (CSV)
                  </button>
                  <button type="button" className="ghost-button" disabled={busy}
                    onClick={() => { void downloadMissingPreviewCsv(',') }}>
                    Download import-CSV voor ontbrekende PLUS/Deka
                  </button>
                  <button type="button" className="ghost-button" disabled={busy}
                    onClick={() => { void shareMissingFromPreview('copy') }}>
                    Kopieer ontbrekende PLUS/Deka-producten voor onderweg
                  </button>
                  {typeof navigator !== 'undefined' && typeof navigator.share === 'function' &&
                    <button type="button" className="ghost-button" disabled={busy}
                      onClick={() => { void shareMissingFromPreview('share') }}>
                      Deel ontbrekende producten op mijn telefoon
                    </button>}
                  {portableMissingGuide?.source === currentPreview &&
                    portableMissingGuide.week === captureWeek && (
                    <div className="offline-price-workbench__missing-copy">
                      <label htmlFor="supa-missing-source-copy">Ontbrekende producten / bijbehorende CSV-rijgids</label>
                      <textarea id="supa-missing-source-copy" rows={9} readOnly
                        value={portableMissingGuide.text}
                        onFocus={event => event.currentTarget.select()}
                        style={{ display: 'block', width: '100%', maxWidth: '100%',
                          minHeight: 160, boxSizing: 'border-box' }} />
                      <button type="button" className="ghost-button"
                        onClick={() => setPortableMissingGuide(null)}>
                        Sluit kopieertekst
                      </button>
                    </div>
                  )}
                </>
              ) : null}
              {currentPreview.stores.length === 1 &&
                currentPreview.stores[0].appendableNewProducts && (
                <p className="disclaimer" role="status">
                  Deze {currentPreview.stores[0].appendableNewProducts} nieuwe originele
                  artikelcode(s) horen bij exact hetzelfde eerdere winkelbronmoment.
                  Je kunt ze zonder oude productcodes of prijzen te vervangen aan
                  dezelfde privéopname toevoegen. Supa vraagt nog om je toestemming;
                  alle nieuwe matches moeten opnieuw worden gecontroleerd.
                </p>
              )}
              <button type="button" disabled={busy} onClick={applyPreviewCsv}>
                {currentPreview.files.length === 2
                  ? 'Neem beide eigen winkelopnames over en controleer producten'
                  : currentPreview.stores.length === 1 &&
                    currentPreview.stores[0].appendableNewProducts
                    ? 'Voeg nieuwe bronproducten toe zonder bestaande prijzen te vervangen'
                  : currentPreview.stores.length === 1 &&
                    imported?.captures[currentPreview.stores[0].retailer]
                  ? 'Bekijk bronverschillen vóór vervanging'
                  : currentPreview.stores.length === 1 && imported &&
                    Object.keys(imported.captures).length === 1
                    ? 'Voeg tweede winkelopname toe'
                    : 'Neem eigen brondata over en controleer producten'}
              </button>
              <button type="button" className="ghost-button"
                onClick={() => setCapturePreview(null)}>Annuleer zonder import</button>
            </div>
          )}
        </section>
        <p role="status" aria-live="polite">{weekExportMessage}</p>
      </div>
      <LocalTwoStorePriceEditor
        plan={plan} recipes={recipes} activeDays={activeDays}
        reviewedRecaptureSeeds={reviewedRecaptureSeeds}
        onGenerated={acceptManualSource}
        onPreviewSourceFiles={files => {
          void previewFilledCsv(files).then(() => {
            document.getElementById('supa-price-sheet-review')?.scrollIntoView({
              behavior: 'smooth', block: 'start',
            })
          })
        }}
        onEdit={() => {
          // Cancel in-flight file admission or stale preview; editing a draft
          // does not revoke a separately accepted and reviewed source.
          ++importRevision.current
          setPendingReplacement(null)
          setBusy(false)
          setMessage('Je bewerkt alleen het invoerconcept. Bestaande winkelopnames blijven actief totdat je een nieuwe opname bevestigt.')
        }}
      />
      <details className="offline-price-workbench__schema">
        <summary>Welk importbestand werkt?</summary>
        <p>UTF-8 JSON met <code>schema: "supa-offline-prices-v1"</code> en precies twee
          <code> captures</code>, of <code>supa-private-single-store-prices-v1</code> met één opname; elk met <code>retailer</code> (PLUS / DekaMarkt),
          <code>observedAt</code> (ISO-tijd met tijdzone) en een <code>products</code>-lijst.
          Elk product bevat <code>id</code>, <code>name</code>, <code>packAmount</code>,
          <code>packUnit</code> (g/kg/ml/l/piece), <code>priceCents</code> (geheel aantal centen of
          null), en <code>available</code> (true/false). Optioneel <code>packCount</code>.
          Gebruik uitsluitend gegevens die je mag bewaren en verwerken.
          Ontbrekende prijzen: zet <code>priceCents: null</code> en <code>available: false</code>.</p>
      </details>
      <div id="supa-own-price-import" className="offline-price-workbench__input">
        <label>Herstel eerdere privémand-sessie van ditzelfde weekmenu (zonder oude bevestigingen)
          <input type="file" accept=".json,application/json" disabled={busy}
            onChange={event => {
              const file = event.currentTarget.files?.[0]
              event.currentTarget.value = ''
              void restorePortableSession(file)
            }} />
        </label>
        <div className={'offline-price-workbench__dropzone' + (dropActive ? ' is-dragging' : '')}
          onDragOver={event => {
            if (busy || !Array.from(event.dataTransfer.types).includes('Files')) return
            event.preventDefault()
            event.dataTransfer.dropEffect = 'copy'
            setDropActive(true)
          }}
          onDragLeave={event => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropActive(false)
          }}
          onDrop={event => {
            if (!Array.from(event.dataTransfer.types).includes('Files')) return
            event.preventDefault()
            setDropActive(false)
            if (!busy) void loadSelectedSources(Array.from(event.dataTransfer.files))
          }}>
          <strong>{dropActive ? 'Laat je eigen bestanden los om ze lokaal te openen' :
            'Sleep eigen PLUS-/Deka-prijsbestanden hierheen'}</strong>
          <label>Open één bronbestand, of selecteer tegelijk je aparte PLUS- en DekaMarkt-bestanden (CSV/TSV/JSON of negenkoloms-TXT)
            <input type="file" accept=".csv,.tsv,.json,.txt,text/csv,text/plain,text/tab-separated-values,application/json" multiple disabled={busy}
              onChange={event => {
                const files = Array.from(event.currentTarget.files ?? [])
                event.currentTarget.value = ''
                void loadSelectedSources(files)
              }} />
            <small>Twee bestanden moeten ieder precies één verschillende winkel bevatten. Ongeldige of dubbele opnames worden samen geweigerd; onbekende prijzen blijven onbekend.</small>
          </label>
          <small>Sleep of selecteer maximaal twee eigen CSV/JSON-bestanden (elk 256 kB), ook tekstbestanden met exact de Supa-CSV-kop.
            Excel-/spreadsheetgegevens mogen komma's, puntkomma's of tabs tussen kolommen hebben;
            een verpakkingsmaat mag een decimale komma gebruiken (bijvoorbeeld 0,75 kg).
            Beschikbaarheid: true/false of ja/nee; prijs uitsluitend in hele eurocenten.
            Deze import gebruikt dezelfde lokale broncontrole als de bestandskiezer:
            ontbrekende prijzen blijven onbekend, en iedere SKU vereist jouw review.</small>
        </div>
        {imported && Object.keys(imported.captures).length === 1 && (
          <label>Voeg de echte opname van de andere winkel toe (CSV of JSON)
            <input type="file" accept=".csv,.tsv,.json,.txt,text/csv,text/plain,text/tab-separated-values,application/json" disabled={busy}
              onChange={event => {
                const file = event.currentTarget.files?.[0]
                event.currentTarget.value = ''
                void loadFile(file, true)
              }} />
            <small>De al gecontroleerde oorspronkelijke winkel blijft bewaard. Nieuwe producten moet je zelf bevestigen; er wordt geen tweede winkel verzonnen.</small>
          </label>
        )}
        <label>Of plak je eigen winkelopname(s) als CSV of JSON
          <textarea rows={8} value={pasteDraft} maxLength={256000} spellCheck={false}
            placeholder={'{"schema":"supa-offline-prices-v1","captures":[...]}'}
            onChange={event => {
              importRevision.current += 1
              setBusy(false)
              setPasteDraft(event.target.value)
              setPendingReplacement(null)
              setMessage('Concept gewijzigd. Eerder bevestigde winkeldata en vinkjes blijven actief totdat je de nieuwe bron expliciet importeert.')
            }} />
          <small>Plak één eigen CSV-blad of twee afzonderlijke CSV-bladen met op een
            losse regel <code>---</code> ertussen. Ieder blad heeft zijn eigen
            negenkolomskop, originele winkel, bronmoment, SKU's en waargenomen prijzen.
            Dubbele of ongeldige winkels worden samen geweigerd; je bestaande
            winkelprijzen en vinkjes blijven bewaard tot expliciete bevestiging.</small>
        </label>
        <div className="offline-price-workbench__actions">
          <button type="button" disabled={busy || !pasteDraft.trim()} onClick={() => {
            void importPastedSource()
          }}>
            Importeer CSV/JSON en bereken mandjes
          </button>
          <button type="button" className="ghost-button" disabled={!imported || busy} onClick={downloadOwnSources}>
            Download mijn originele bronopnames (JSON)
          </button>
          <button type="button" className="ghost-button" disabled={!imported || busy}
            onClick={() => void downloadOwnSourcesCsv()}>
            Download mijn bronopname(s) als CSV
          </button>
          {imported && (['PLUS', 'DekaMarkt'] as const).filter(store => !!imported.captures[store]).map(store => (
            <button type="button" className="ghost-button" key={'download-source-' + store}
              disabled={busy} onClick={() => void downloadOwnSourcesCsv(store)}>
              Download alleen {store} als CSV
            </button>
          ))}
          <button type="button" className="ghost-button" disabled={!imported || !basketPair || busy}
            onClick={downloadPortableSession}>
            Bewaar mijn winkelmand + gekozen producten (privésessie)
          </button>
          <button type="button" className="ghost-button" disabled={!imported || !basketPair || busy}
            onClick={saveTabCheckpoint}>
            Bewaar privéherstelpunt voor deze browsertab
          </button>
          <button type="button" className="ghost-button" disabled={busy}
            onClick={restoreTabCheckpoint}>
            Herstel privéherstelpunt na herladen
          </button>
          <button type="button" className="ghost-button" onClick={deleteTabCheckpoint}>
            Wis privéherstelpunt
          </button>
          <small>Een herstelpunt bevat je originele eigen bron en gekozen artikelcodes, uitsluitend na jouw klik in sessionStorage. Het kan een herladen pagina herstellen, maar niet alle browsersessies overleven. Productreviews worden nooit als akkoord hersteld. Maak voor langer bewaren een JSON-download.</small>
          <button type="button" className="ghost-button" onClick={() => {
            importRevision.current += 1
            setPendingReplacement(null)
            setBusy(false)
            setImported(null); setReviewedLines({}); setDoneTripItems({})
            setManualSku({ PLUS: {}, DekaMarkt: {} }); setSkuFilter({})
            setText(''); setMessage('Lokaal geladen winkeldata gewist. Een eventueel apart privéherstelpunt kun je hierboven afzonderlijk wissen.')
          }}>Wis lokaal geladen data</button>
        </div>
        <p role="status" aria-live="polite">{message}</p>
      </div>
      {pendingTwoStore && pendingTwoStore.version === importRevision.current &&
        pendingTwoStore.sourceText === text && (
        <section className="offline-price-workbench__replace-preview"
          aria-label="Controleer beide nieuwe winkelopnames vóór vervangen">
          <h3>Vergelijk beide nieuwe winkelopnames met je huidige mandje</h3>
          <p>De nieuwe bestanden zijn uitsluitend lokaal gelezen. Je vorige producten,
            originele bronmomenten, persoonlijke productkeuzes en afvinkingen blijven staan
            tot je zelf bevestigt. Alleen winkels met gewijzigde bronfeiten
            moeten daarna opnieuw worden beoordeeld.</p>
          <ul>
            {pendingTwoStore.changes.map(change => (
              <li key={change.store}>
                <strong>{change.store}</strong> · {change.unchanged
                  ? 'Ongewijzigde originele bron — eerdere controles blijven behouden.'
                  : 'Gewijzigde of nieuwe bron — productkeuzes opnieuw controleren.'}
                <br />{change.previousCount} → {change.nextCount} producten
                {' '}({change.added} nieuwe codes, {change.removed} verdwenen,
                {' '}{change.changed} gewijzigde artikelen)
                <br />Oud: {change.previousAt ?? 'Nog geen eigen opname'}
                <br />Nieuw: {change.nextAt}
                <br />Met vastgelegde beschikbare pakprijs:
                {' '}{change.previousPriced}/{change.previousCount} →{' '}
                {change.nextPriced}/{change.nextCount}.
                {' '}{change.nextCount - change.nextPriced} producten zonder bruikbare geobserveerde pakprijs.
                {change.examples.length > 0 && <details>
                  <summary>Bekijk originele SKU- en pakprijswijzigingen (maximaal 6)</summary>
                  <ul>{change.examples.map(item => (
                    <li key={item.id}>{item.name} · broncode {item.id}
                      <br />Oud: {item.before}
                      <br />Nieuw: {item.after}</li>
                  ))}</ul>
                </details>}
              </li>
            ))}
          </ul>
          <p role="status">
            {pendingTwoStore.snapshots.currentEnough
              ? 'Beide nieuwe bronmomenten vallen binnen het geldige zeven-dagenvenster.'
              : 'Een bronmoment is verlopen of te ver in de toekomst; geen actueel prijsverschil.'}
            {' '}{pendingTwoStore.snapshots.pairedWithin24h
              ? 'De opnamecontext valt binnen 24 uur.'
              : 'De nieuwe opnames liggen meer dan 24 uur uiteen; het prijsverschil blijft onbekend.'}
            {' '}De bedragen zijn uitsluitend jouw opgegeven brondata, geen retailerbewijs.
          </p>
          <div className="offline-price-workbench__actions">
            <button type="button" className="ghost-button" disabled={busy}
              onClick={() => void downloadTwoStoreChanges()}>
              Download volledig origineel SKU- en prijsverschillenoverzicht (CSV)
            </button>
            <button type="button" disabled={busy} onClick={confirmBothStoreReplacement}>
              Bevestig nieuwe bronnen en hercontroleer alleen gewijzigde winkels
            </button>
            <button type="button" className="ghost-button" disabled={busy}
              onClick={() => {
                ++importRevision.current
                setPendingTwoStore(null)
                setMessage('Twee-winkelvervanging geannuleerd; je bestaande opnames, productkeuzes en vinkjes blijven intact.')
              }}>Annuleer en behoud mijn huidige winkels</button>
          </div>
        </section>
      )}
      {imported && (
        <div className="offline-price-workbench__results">
          <h3>Winkelvergelijking voor jouw huidige weekmenu</h3>
          {imported.captures.PLUS && imported.captures.DekaMarkt && <div
            className="offline-price-workbench__recapture-both" aria-label="Beide originele winkelbronnen opnieuw opnemen">
            <strong>PLUS en DekaMarkt opnieuw opnemen voor hetzelfde weekmandje</strong>
            <p>Maak één nieuw winkelbronblad op basis van je oorspronkelijke SKU's.
              De oude winkelprijzen, pakgroottes, voorraad en opnametijden zijn leeg.
              Vul beide winkels werkelijk opnieuw in en controleer de hele vergelijking.
              Deze actie vervangt of bevestigt nog niets in Supa.</p>
            <button type="button" className="ghost-button"
              onClick={() => downloadFreshProductReobservation('both', 'csv')}>
              Maak nieuw twee-winkelbronblad (CSV)
            </button>
            <button type="button" className="ghost-button"
              onClick={() => downloadFreshProductReobservation('both', 'csv-excel')}>
              Beide winkels als spreadsheet-CSV (puntkomma)
            </button>
            <button type="button" className="ghost-button"
              onClick={() => downloadFreshProductReobservation('both', 'guide')}>
              Nieuwe echte bronopname: stappen (TXT)
            </button>
          </div>}
          <div className="offline-price-workbench__dates">
            {stores.map(store => {
              const capture = imported.captures[store]
              return capture
                ? <div key={store}>
                    <p><strong>{store}</strong> · waargenomen {captureDate(capture.observedMs)}
                      {' '}· {capture.products.length} eigen bronproducten</p>
                    <button className="ghost-button" type="button" onClick={() => downloadPrivateRecaptureCsv(store)}>
                      Alleen nieuwe prijsopname: oude verpakking als invulhulp behouden (CSV)
                    </button>
                    <button className="ghost-button" type="button"
                      onClick={() => downloadFreshProductReobservation(store, 'csv')}>
                      Nieuwe volledige {store}-meting: ook verpakking en opnametijd leeg (CSV)
                    </button>
                    <button className="ghost-button" type="button"
                      onClick={() => downloadFreshProductReobservation(store, 'csv-excel')}>
                      Hele {store}-opname in spreadsheet-CSV (puntkomma)
                    </button>
                    <button className="ghost-button" type="button"
                      onClick={() => downloadFreshProductReobservation(store, 'guide')}>
                      Uitleg voor nieuwe {store}-opname (TXT)
                    </button>
                    <label>Voeg originele nog ontbrekende {store}-producten toe uit dezelfde opname (CSV/JSON)
                      <input type="file" accept=".csv,.tsv,.json,.txt,text/csv,text/plain,text/tab-separated-values,application/json" disabled={busy}
                        onChange={event => {
                          const file = event.currentTarget.files?.[0]
                          event.currentTarget.value = ''
                          void appendSameCapture(store, file)
                        }} />
                      <small>Alleen producten met nieuwe broncodes en exact hetzelfde oorspronkelijke
                        waarnemingstijdstip. Bij verschillende momenten geen oude prijzen doorschuiven:
                        vervang dan de hele winkelopname. Eerdere artikelen worden nooit overschreven.</small>
                    </label>
                    <label>Vervang uitsluitend de {store}-opname met je nieuwe echte bron (CSV of JSON)
                      <input type="file" accept=".csv,.tsv,.json,.txt,text/csv,text/plain,text/tab-separated-values,application/json" disabled={busy}
                        onChange={event => {
                          const file = event.currentTarget.files?.[0]
                          event.currentTarget.value = ''
                          void replaceStoreFile(store, file)
                        }} />
                      <small>Andere winkelbron blijft exact behouden. Productcontrole en afvinkingen van {store}
                        worden pas na jouw bevestiging ingetrokken. Een onjuist bestand vervangt niets.</small>
                    </label>
                  </div>
                : <p key={store}><strong>{store}</strong> · geen bronopname; prijs onbekend.</p>
            })}
          </div>
          {pendingReplacement && pendingReplacement.version === importRevision.current &&
            pendingReplacement.sourceText === text && (
              <section className="offline-price-workbench__replace-preview"
                aria-label="Vergelijk oorspronkelijke en nieuwe winkelopname vóór vervangen">
                <h4>{pendingReplacement.store} vervangen? Bekijk eerst de echte bronverschillen</h4>
                <p><strong>Oud bronmoment:</strong> {pendingReplacement.preview.previousObservedAt}
                  <br /><strong>Nieuw bronmoment:</strong> {pendingReplacement.preview.nextObservedAt}</p>
                <p>{pendingReplacement.preview.previousCount} bestaande bronartikelen →{' '}
                  {pendingReplacement.preview.nextCount} nieuwe;
                  {' '}{pendingReplacement.preview.added} toegevoegd,
                  {' '}{pendingReplacement.preview.removed} verdwenen,
                  {' '}{pendingReplacement.preview.changed} met gewijzigde product-/prijsgegevens.</p>
                {pendingReplacement.preview.priceExamples.length > 0 && (
                  <div>
                    <strong>Prijs- of beschikbaarheidswijzigingen (maximaal 8)</strong>
                    <ul>{pendingReplacement.preview.priceExamples.map(item => (
                      <li key={item.sourceId + ':' + item.name + ':' + item.before + ':' + item.after}>{item.name} · broncode {item.sourceId}:
                        {' '}{item.before} → {item.after}</li>
                    ))}</ul>
                  </div>
                )}
                <p>Alle eerder bevestigde productkeuzes en afvinkingen van <strong>{pendingReplacement.store}</strong>
                  {' '}worden ingetrokken bij bevestigen.
                  {' '}{pendingReplacement.preview.otherStore} blijft met oorspronkelijke
                  productcodes, onbekende prijzen en eigen controles behouden.</p>
                <p className="disclaimer">
                  {pendingReplacement.preview.currentEnough
                    ? 'Bronmomenten vallen binnen het zeven-dagenvenster.'
                    : 'Een bronmoment is verlopen of te ver in de toekomst: geen actueel verschil.'}
                  {' '}{pendingReplacement.preview.pairedWithin24h
                    ? 'Opnames liggen binnen 24 uur; controleer nog alle nieuwe producten zelf.'
                    : 'Opnames liggen meer dan 24 uur uiteen of er ontbreekt een tweede winkel; geen vergelijkbaar verschil.'}
                  {' '}Dit zijn verschillen tussen eigen bestanden, geen bewijs van retailerrechten of actuele winkelprijzen.
                </p>
                <div className="offline-price-workbench__actions">
                  <button type="button" disabled={busy} onClick={confirmPrivateStoreReplacement}>
                    Bevestig en vervang alleen {pendingReplacement.store}
                  </button>
                  <button type="button" className="ghost-button" disabled={busy}
                    onClick={() => {
                      setPendingReplacement(null)
                      setMessage('Winkelvervanging geannuleerd; alle originele bronnen en controles blijven behouden.')
                    }}>Annuleer, behoud beide winkelopnames</button>
                </div>
              </section>
            )}
          <p className="disclaimer">
            Nieuwe winkelopname nodig? Download per winkel het invulblad met je eerder gekozen
            echte productcodes en verpakkingen. Oude prijzen, opnametijd en beschikbaarheid
            gaan <strong>niet</strong> mee. Vul de werkelijke nieuwe observatietijd
            met UTC-offset, geobserveerde eurocenten en <code>available=true</code> per
            beschikbaar product in. Daarna laad je één of beide CSV’s hierboven opnieuw.
            Een oningevuld blad levert nooit een geprijsd mandje.
          </p>
          {!currentEnough && <p role="alert" className="attention-card">
            Oude prijsdata (ouder dan 7 dagen). Er wordt geen actueel prijsverschil getoond.
          </p>}
          {Object.keys(imported.captures).length === 1
            ? <p role="status" className="attention-card">De tweede winkel is nog onbekend. Het eigen complete winkelmandje kan na broncontrole worden getoond; er is geen prijsverschil te berekenen.</p>
            : !imported.pairedWithin24h && <p role="alert" className="attention-card">
              Waarnemingen liggen meer dan 24 uur uiteen. Het prijsverschil is niet vergelijkbaar.
            </p>}
          {(Object.keys(imported.captures).length < 2 || !basketPair?.plus || !basketPair?.deka) && comparisonNextSteps.length > 0 && (
            <section className="offline-price-workbench__missing" aria-label="Volgende stappen voor prijsvergelijking">
              <h4>Wat ontbreekt nog voor hetzelfde winkelmandje?</h4>
              <ul>{comparisonNextSteps.map(step => <li key={step}>{step}</li>)}</ul>
              <p>Werk de ontbrekende feiten in je eigen bron of Planner bij. De vergelijking rekent niets bij op basis van aannames.</p>
            </section>
          )}
          {!basketPair ? <p role="alert">Deze planning kon niet veilig aan de import worden gekoppeld.</p> : (
            <>
              {basketPair.plus && basketPair.deka && imported.captures.PLUS &&
                imported.captures.DekaMarkt && (
                  <ComparisonReadiness
                    plus={basketPair.plus}
                    deka={basketPair.deka}
                    captures={{ PLUS: imported.captures.PLUS, DekaMarkt: imported.captures.DekaMarkt }}
                    sourceFresh={currentEnough}
                    pairedWithin24h={imported.pairedWithin24h}
                    comparable={canShowDifference}
                    nowMs={clockMs}
                    pendingHumanReview={perStoreReview.reduce((sum, item) =>
                      sum + item.required - item.accepted, 0)}
                    onReviewFirstPending={() => {
                      const pending = stores.flatMap(store => {
                        const basket = store === 'PLUS' ? basketPair.plus : basketPair.deka
                        const capture = imported.captures[store]
                        return basket && capture ? basket.lines.filter(line =>
                          line.status === 'matched' &&
                          !isAcceptedKey(reviewedLineKey(store, capture.observedAt, line))
                        ).map(line => ({ store, id: line.id })) : []
                      })[0]
                      if (pending) goToReviewRow(pending.store, pending.id)
                    }}
                    onReviewMissing={goToReviewRow}
                    onOpenImport={() => document.getElementById('supa-own-price-import')?.scrollIntoView({
                      behavior: 'smooth', block: 'start',
                    })}
                  />
                )}
              {coverageRows.length > 0 && (
                <section className="offline-price-workbench__full-breakdown" aria-label="Dekking van hetzelfde mandje bij beide winkels">
                  <h4>Hetzelfde mandje: {coverageRows.length} ingrediënten × twee winkels</h4>
                  <p>Bekijk welke originele bronregels en eigen controles ontbreken. Dit is de fysieke
                    Planner-vraag voor beide winkels; onvolledige of oude prijzen leveren geen winnaar.</p>
                  <p>{openCoverageRows.length} van {coverageRows.length} ingrediënten
                    hebben nog een ontbrekende bron, verlopen opname of niet-bevestigde productregel.</p>
                  <div className="offline-price-workbench__store-progress" aria-label="Voortgang per supermarkt">
                    {storeCoverageProgress.map(item => <section key={item.store}>
                      <h5>{item.store}: {item.confirmed} van {item.total} ingrediëntregels bevestigd</h5>
                      <progress max={Math.max(1, item.total)} value={item.confirmed}
                        aria-label={item.store + ' gecontroleerde ingrediëntregels'} />
                      <p>{item.older ? 'De opname van deze winkel moet opnieuw binnen 24 uur met de andere winkel worden gepaard.' :
                        item.recapture ? 'Een eigen bron ontbreekt of is verlopen: laad een werkelijke nieuwe bronopname.' :
                        item.pending ? item.pending + ' artikelen ontbreken of wachten op je productcontrole.' :
                        'Alle afzonderlijke artikelregels zijn bevestigd. Dit is nog geen onafhankelijke veldvalidatie.'}</p>
                      <div className="offline-price-workbench__store-progress-actions">
                        <button type="button" className="ghost-button"
                          disabled={!item.recapture && !item.actionable}
                          onClick={() => openNextCoverageStep(item.store)}>
                          {item.recapture ? 'Ga naar bronimport voor ' + item.store :
                            item.actionable ? 'Open eerstvolgende ' + item.store + '-productcontrole' :
                            'Geen productcontrole meer open'}
                        </button>
                        <button type="button" className="ghost-button"
                          onClick={() => { setCoverageScope(item.store); setCoverageSearch('') }}>
                          Toon open {item.store}-regels
                        </button>
                      </div>
                    </section>)}
                  </div>
                  <p>Nieuw bronbewijs nodig? Download per winkel uitsluitend de ontbrekende
                    of verlopen fysieke Planner-producten als lege CSV met bijpassende
                    regelnummergids. Alleen nog te bevestigen bestaande SKU’s blijven buiten deze lijst.</p>
                  <div className="offline-price-workbench__actions">
                    {stores.map(store => <div key={store}>
                      <strong>{store} · {missingPriceCaptureNeeds[store].length} bronregels opnieuw opnemen</strong>
                      <div className="offline-price-workbench__actions">
                        <button className="ghost-button" type="button"
                          disabled={missingPriceCaptureNeeds[store].length === 0}
                          onClick={() => void downloadMissingPriceCapture(store, 'csv')}>
                          Download open {store}-opnames (CSV)
                        </button>
                        <button className="ghost-button" type="button"
                          disabled={missingPriceCaptureNeeds[store].length === 0}
                          onClick={() => void downloadMissingPriceCapture(store, 'guide')}>
                          {store}-regelnummergids (TXT)
                        </button>
                      </div>
                      {missingPriceCaptureNeeds[store].length > 0 &&
                        <PortableBlankCapture purpose="missing"
                          onReview={files => previewFilledCsv(files)}
                          onDraftChange={invalidateOwnMobileSourcePreview}
                          needs={missingPriceCaptureNeeds[store]}
                          needsAtClick={() => missingCaptureNeedsNow(store)}
                          stores={[store]}
                          delimiter={captureDelimiter}
                          captureKey={captureWeek + ':missing:' + store + ':' + captureDelimiter + ':' +
                            (imported?.captures[store]?.observedAt ?? 'none') + ':' +
                            Math.floor(clockMs / 60000)} />}
                    </div>)}
                  </div>
                  <div className="offline-price-workbench__actions">
                    <button className="ghost-button" type="button"
                      disabled={openCoverageRows.length === 0}
                      onClick={() => downloadCoverageChecklist(true)}>
                      Download uitsluitend open controles (TXT)
                    </button>
                    <button className="ghost-button" type="button"
                      onClick={() => downloadCoverageChecklist(false)}>
                      Download complete winkeldekking (TXT)
                    </button>
                    <button className="ghost-button" type="button"
                      disabled={!imported || !basketPair || coverageRows.length === 0}
                      onClick={() => void downloadReviewedIngredientLedger()}>
                      Download bevestigde regelprijzen + onbekende regels (CSV)
                    </button>
                    <button className="ghost-button" type="button"
                      disabled={!imported || !basketPair || coverageRows.length === 0}
                      onClick={() => void downloadReviewedIngredientLedger('html')}>
                      Download offline leesbaar prijsblad (HTML)
                    </button>
                  </div>
                  <p className="disclaimer">Privé-werkblad, geen bronimport: alleen actuele
                    geaccepteerde artikelen krijgen geldvelden. Het prijsverschil geldt per
                    identieke ingrediëntbehoefte bij tijdsvergelijkbare eigen winkelopnames,
                    nooit als totale besparing of bewijs van retailerprijzen.</p>
                  {coverageMessage && <p role="status" aria-live="polite">{coverageMessage}</p>}
                  <div className="offline-price-workbench__coverage-filters" role="group"
                    aria-label="Filter de winkeldekking van jouw mandje">
                    <label>Toon ingrediënten
                      <select value={coverageScope}
                        onChange={event => setCoverageScope(event.currentTarget.value as typeof coverageScope)}>
                        <option value="open">Nog open ({openCoverageRows.length})</option>
                        <option value="all">Alle ingrediënten ({coverageRows.length})</option>
                        <option value="PLUS">Nog open bij PLUS ({outstandingByStore.PLUS})</option>
                        <option value="DekaMarkt">Nog open bij DekaMarkt ({outstandingByStore.DekaMarkt})</option>
                      </select>
                    </label>
                    <label>Zoek ingrediënt of origineel bronartikel
                      <input type="search" value={coverageSearch} maxLength={120}
                        placeholder="Bijvoorbeeld rijst of artikelcode"
                        onChange={event => setCoverageSearch(event.currentTarget.value)} />
                    </label>
                    <p role="status" aria-live="polite">{visibleCoverageRows.length} van {coverageRows.length}
                      {' '}ingrediënten zichtbaar. Dit filter wijzigt geen brondata of prijsbevestiging.</p>
                  </div>
                  <div className="offline-price-workbench__breakdown-scroll">
                    <table>
                      <caption>Bron- en reviewstatus per ingrediënt. Alleen eigen, actuele, persoonlijk bevestigde regels tonen een hele-pakbedrag en eenheidsprijs; onvolledige mandjes hebben geen bewezen totaal of winnaar.</caption>
                      <thead><tr>
                        <th scope="col">Hetzelfde ingrediënt</th>
                        <th scope="col">PLUS</th>
                        <th scope="col">DekaMarkt</th>
                        <th scope="col">Eigen prijsverschil per complete ingrediëntregel</th>
                      </tr></thead>
                      <tbody>{visibleCoverageRows.map(row => (
                        <tr key={row.id}>
                          <th scope="row">{row.label}<small>{row.amount ?? '?'} {row.unit} nodig</small></th>
                          {stores.map(store => {
                            const item = row[store]
                            return <td key={store}>
                              <strong>{item.status}</strong>
                              {item.product && <small>{item.product}</small>}
                              {item.confirmedPrice && <small className="offline-price-workbench__confirmed-unit">
                                {item.confirmedPrice} · eigen gecontroleerde bronregel; nog geen volledig winkelmandje.
                              </small>}
                              {item.canReview && item.status !== 'Persoonlijk bevestigd' &&
                                <a href={'#' + reviewRowId(store, row.id)}
                                  onClick={() => setOpenTripOnly(false)}>Open productkeuze en controle</a>}
                            </td>
                          })}
                          <td>{row.singleLineDelta ? <>
                            <strong>{row.singleLineDelta}</strong>
                            <small>Uitsluitend jouw bevestigde actuele bronartikelen; productgelijkwaardigheid en totale besparing niet bewezen.</small>
                          </> : <small>Onbekend: eerst beide actuele bronartikelen bevestigen.</small>}</td>
                        </tr>
                      ))}</tbody>
                    </table>
                  </div>
                </section>
              )}
              <div className="offline-price-workbench__totals">
                {stores.map(store => {
                  const basket = store === 'PLUS' ? basketPair.plus : basketPair.deka
                  if (!basket) return null
                  const reviewedStore = perStoreReview.find(item => item.store === store)!
                  const complete = reviewedStore.complete && reviewedStore.fresh
                  return (
                    <section key={store}>
                      <h4>{store}</h4>
                      <strong>{complete ? exactEuro.formatCents(basket.totalCents) : 'Nog geen bevestigd volledig totaal'}</strong>
                      {!complete && basket.matchedLineCount > 0 && (
                        <span>Voorlopig gekoppelde regels: {exactEuro.formatCents(basket.totalCents)} (geen bevestigd mandtotaal)</span>
                      )}
                      <span>{basket.matchedLineCount} automatisch gevonden, {basket.unresolvedLineCount} onbekend</span>
                      <span>{reviewedStore.accepted} van {reviewedStore.required} prijsregels door jou bevestigd</span>
                      {!reviewedStore.fresh && <span>Bron verouderd of toekomstig; geen actueel mandtotaal.</span>}
                    </section>
                  )
                })}
              </div>
              {reviewedBridge && <section className="offline-price-workbench__own-trips"
                aria-label="Mijn afzonderlijke gecontroleerde winkellijsten">
                <h4>Een winkel klaar? Neem die boodschappen alvast mee</h4>
                <p>Een volledig gecontroleerd winkelmandje kun je al afvinken en offline
                  bewaren. De andere winkel mag nog onvolledig zijn. Onbevestigde of
                  verlopen bedragen komen niet in deze lijst.</p>
                {stores.map(store => {
                  const original = reviewedBridge.stores[store]
                  if (!original) return null
                  return <Suspense key={JSON.stringify([planKey, store,
                    original.observedAt, original.basket.lines])}
                    fallback={<p role="status">Privélijst voor {store} laden…</p>}>
                    <PrivateStoreTripChecklist
                      basket={original.basket}
                      observedAt={original.observedAt}
                      fresh
                      checkedIds={new Set(original.basket.lines.filter(line =>
                        doneTripItems[shoppingTaskKey(store, line)]).map(line => line.id))}
                      onToggleChecked={id => {
                        const line = original.basket.lines.find(item => item.id === id)
                        if (!line) return
                        const key = shoppingTaskKey(store, line)
                        setDoneTripItems(previous => ({ ...previous, [key]: !previous[key] }))
                      }}
                      onClearChecked={() => setDoneTripItems(previous => {
                        const next = { ...previous }
                        for (const line of original.basket.lines)
                          delete next[shoppingTaskKey(store, line)]
                        return next
                      })}
                      eligibleNow={() => {
                        const current = freshReviewedBaskets(reviewedBridge, reviewedBridge.planKey, Date.now())
                        return current?.stores[store]?.basket === original.basket
                      }} />
                  </Suspense>
                })}
              </section>}
              {((basketPair.plus?.unresolvedLineCount ?? 0) > 0 || (basketPair.deka?.unresolvedLineCount ?? 0) > 0) && (
                <p className="offline-price-workbench__missing" role="status">
                  Deze vergelijking is nog niet volledig. Vul onbekende artikelen in beide winkels in.
                  Bekende deelbedragen zijn geen complete winkelmandprijs en worden niet als besparing vergeleken.
                </p>
              )}
              {!allReviewed && <p className="offline-price-workbench__missing" role="status">
                Controleer per winkel iedere voorgestelde productmatch, verpakking en prijs
                tegen jouw eigen oorspronkelijke bron. Zonder jouw bevestiging geen
                geaccepteerd volledig mandtotaal of winkelwinnaar.
              </p>}
              <p className="offline-price-workbench__difference" role="status">
                {canShowDifference && basketPair.comparison && basketPair.comparison.deltaCents !== null
                  ? basketPair.comparison.deltaCents === 0
                    ? 'Deze twee ingevoerde volledige mandjes hebben hetzelfde rekenkundige totaal.'
                    : `${basketPair.comparison.deltaCents > 0 ? 'PLUS' : 'DekaMarkt'} is op basis van deze eigen invoer ${exactEuro.formatCents(Math.abs(basketPair.comparison.deltaCents))} goedkoper.`
                  : 'Nog geen vergelijkbaar prijsverschil: controleer productmatches of vul ontbrekende / actuele bronnen aan.'}
                <small> Dit is nooit een gecontroleerde publieke besparingsclaim.</small>
              </p>
              {canShowDifference && basketPair.comparison && basketPair.comparison.lineDeltas.length > 0 && (
                <section className="offline-price-workbench__drivers" aria-label="Prijsverschil per ingrediënt">
                  <h4>Wat veroorzaakt het verschil?</h4>
                  {[...basketPair.comparison.lineDeltas]
                    .sort((a, b) => Math.abs(b.deltaCents) - Math.abs(a.deltaCents))
                    .slice(0, 5)
                    .map(line => (
                      <p key={line.id}><strong>{line.ingredientLabel}</strong> · PLUS {exactEuro.formatCents(line.baselineLineTotalCents)}
                        {' '}· DekaMarkt {exactEuro.formatCents(line.candidateLineTotalCents)}
                        {' '}· {line.deltaCents === 0 ? 'zelfde bedrag'
                          : `${exactEuro.formatCents(Math.abs(line.deltaCents))} verschil`}</p>
                    ))}
                </section>
              )}
              {canShowDifference && mixedStorePlans?.mixed && mixedStorePlans.single &&
                imported.captures.PLUS && imported.captures.DekaMarkt && (
                  <Suspense fallback={<p role="status">
                    Je persoonlijke twee-winkel-boodschappenroute wordt geopend.
                  </p>}>
                    <MixedStoreShoppingCard
                      mixed={mixedStorePlans.mixed}
                      single={mixedStorePlans.single}
                      plus={basketPair.plus!}
                      deka={basketPair.deka!}
                      captured={{
                        PLUS: imported.captures.PLUS.observedAt,
                        DekaMarkt: imported.captures.DekaMarkt.observedAt,
                      }}
                      eligibleNow={eligibleComparisonRightNow}
                      privatePlanKey={planKey}
                    />
                  </Suspense>
                )}
              {canShowDifference && (
                <div className="offline-price-workbench__actions">
                  <button type="button" onClick={downloadConfirmedComparisonCsv}>
                    Download volledige privévergelijking (CSV)
                  </button>
                  <small>Originele PLUS- en Deka-productcodes, geobserveerde pakprijzen, indicatieve eenheidsprijzen en per-ingrediënt verschil. Uitsluitend jouw geaccepteerde lokale opname; geen publieke besparingsclaim.</small>
                </div>
              )}
              {imported?.captures.PLUS && imported.captures.DekaMarkt &&
                basketPair.plus && basketPair.deka && (
                  <section aria-label="Afdrukbaar privéoverzicht van je originele winkelbronnen">
                    <h4>Bewaar of print beide mandjes, ook als een prijs nog ontbreekt</h4>
                    <PrivateBasketComparisonExport
                      plus={basketPair.plus}
                      deka={basketPair.deka}
                      plusObservedAt={imported.captures.PLUS.observedAt}
                      dekaObservedAt={imported.captures.DekaMarkt.observedAt}
                      comparable={canShowDifference}
                      showCsv={false}
                      eligibleNow={eligibleComparisonRightNow}
                    />
                  </section>
                )}
              {readableReport && (
                <details className="offline-price-workbench__full-breakdown">
                  <summary>Kopieer of bewaar een leesbaar privéoverzicht van beide mandjes</summary>
                  <p>Alle oorspronkelijke bronartikelen, benodigde hele verpakkingen, indicatieve eenheidsprijzen en bedragen per ingrediënt. Dit is jouw eigen invoer, geen geverifieerde supermarktprijs.</p>
                  <button type="button" className="ghost-button" onClick={downloadReadableReport}>
                    Download leesbare vergelijking (TXT)
                  </button>
                  <label>Zelf kopiëren, zonder klembordtoestemming
                    <textarea readOnly rows={12} spellCheck={false}
                      aria-label="Leesbare privévergelijking"
                      value={readableReport} onFocus={event => event.currentTarget.select()} />
                  </label>
                </details>
              )}
              {canShowDifference && fullDifferenceRows.length > 0 && (
                <details className="offline-price-workbench__full-breakdown">
                  <summary>Bekijk alle {fullDifferenceRows.length} prijsverschillen, bronartikelen en verpakkingen</summary>
                  <div className="offline-price-workbench__breakdown-scroll">
                    <table>
                      <caption>Zelf bevestigde prijsvergelijking van exact dezelfde Planner-ingrediënten; geen onafhankelijke retailerprijzen.</caption>
                      <thead><tr>
                        <th scope="col">Benodigd ingrediënt</th>
                        <th scope="col">PLUS · eigen artikel</th>
                        <th scope="col">DekaMarkt · eigen artikel</th>
                        <th scope="col">Verschil (Deka − PLUS)</th>
                      </tr></thead>
                      <tbody>{fullDifferenceRows.map(({ delta, plus, deka }) => (
                        <tr key={delta.id}>
                          <th scope="row">{delta.ingredientLabel}
                            <small>{readablePlannerDemandAmount(plus.requirement.amount)} {plus.requirement.unit} benodigd
                              {samePrivatePhysicalDemand(plus.requirement, deka.requirement) &&
                                (plus.requirement.amount !== deka.requirement.amount ||
                                  plus.requirement.unit !== deka.requirement.unit) &&
                                  <> = {readablePlannerDemandAmount(deka.requirement.amount)} {deka.requirement.unit}
                                    {' '}(dezelfde fysieke behoefte)</>}
                            </small>
                          </th>
                          <td><strong>{exactEuro.formatCents(plus.lineTotalCents)}</strong>
                            <small>{plus.productName} · broncode {plus.productId}</small>
                            <small>{plus.packs} × {plus.pack.amount} {plus.pack.unit} × {plus.pack.count}</small>
                            <small>{pricePerUnit(plus) ?? 'Eenheidsprijs onbekend'}</small>
                          </td>
                          <td><strong>{exactEuro.formatCents(deka.lineTotalCents)}</strong>
                            <small>{deka.productName} · broncode {deka.productId}</small>
                            <small>{deka.packs} × {deka.pack.amount} {deka.pack.unit} × {deka.pack.count}</small>
                            <small>{pricePerUnit(deka) ?? 'Eenheidsprijs onbekend'}</small>
                          </td>
                          <td><strong>{delta.deltaCents === 0 ? 'Gelijk'
                            : (delta.deltaCents > 0 ? '+' : '−') +
                              exactEuro.formatCents(Math.abs(delta.deltaCents))}</strong>
                            <small>Bedragen voor gehele benodigde verpakkingen.</small>
                          </td>
                        </tr>
                      ))}</tbody>
                    </table>
                  </div>
                </details>
              )}
              <div className="offline-price-workbench__trip-actions">
                <label><input type="checkbox" checked={openTripOnly}
                    onChange={event => setOpenTripOnly(event.currentTarget.checked)} />
                  Toon alleen nog te kopen</label>
                <button type="button" className="ghost-button" onClick={() => setDoneTripItems({})}>
                  Alle afvinkingen wissen
                </button>
              </div>
              <p role="status" aria-live="polite">{tripExportMessage}</p>
              <p role="status" aria-live="polite">{tripProgressMessage}</p>
              <div className="offline-price-workbench__stores">
                {stores.map(store => {
                  const basket = store === 'PLUS' ? basketPair.plus : basketPair.deka
                  const capture = imported.captures[store]
                  if (!basket || !capture) return null
                  const admittedNow = freshReviewedBaskets(reviewedBridge,
                    reviewedBridge?.planKey ?? '', Date.now())?.stores[store]?.basket === basket
                  const purchased = basket.lines.filter(line => doneTripItems[shoppingTaskKey(store, line)]).length
                  const visible = basket.lines.filter(line =>
                    !openTripOnly || !doneTripItems[shoppingTaskKey(store, line)])
                  return (
                    <section key={store}>
                      <h4>{store} · boodschappen</h4>
                      {!admittedNow && <p className="offline-price-workbench__missing" role="status">
                        Prijsinformatie voor dit winkelmandje onbekend: de oorspronkelijke bron is
                        verlopen of niet alle artikelen zijn bevestigd. De bronselectie eronder is
                        uitsluitend historische/in te vullen invoer, geen actuele winkelprijs.
                      </p>}
                      <p className="offline-price-workbench__trip-progress" role="status">
                        {purchased} van {basket.lines.length} afgevinkt · alleen privé op dit apparaat
                      </p>
                      <button type="button" className="ghost-button" onClick={() => downloadShoppingTrip(basket, store)}>
                        Download boodschappenlijst (TXT)
                      </button>
                      <button type="button" className="ghost-button"
                        onClick={() => downloadTripProgress(basket, store, capture.observedAt)}>
                        Download afvinkingen van deze exacte winkelmand (JSON)
                      </button>
                      <label>Herstel afvinkingen van precies deze bron en winkelmand
                        <input type="file" accept=".json,application/json"
                          onChange={event => { void restoreTripProgress(event.currentTarget.files?.[0], basket, store, capture.observedAt) }} />
                      </label>
                      <details className="offline-price-workbench__checklist">
                        <summary>Kopieer boodschappenlijst voor {store}</summary>
                        <p>Selecteer en kopieer deze lijst; de tekst blijft op je apparaat.</p>
                        <textarea readOnly rows={Math.min(18, basket.lines.length + 4)}
                          aria-label={`Boodschappenlijst ${store}`}
                          value={shoppingChecklist(basket, store, doneTripItems, admittedNow)}
                          onFocus={event => event.currentTarget.select()} />
                      </details>
                      {visible.length === 0 && basket.lines.length > 0 &&
                        <p className="offline-price-workbench__trip-complete" role="status">
                          Alles afgevinkt voor {store}.
                        </p>}
                      {visible.map(line => {
                        const searchKey = JSON.stringify([store, line.id])
                        const choices = sourceOptions(capture.products, line.requirement.unit,
                          skuFilter[searchKey] ?? '', manualSku[store][line.id] ?? '',
                          line.ingredientLabel, line.requirement.amount,
                          sourceSort[searchKey] ?? 'relevance',
                          onlyCheaper[searchKey] && line.status === 'matched'
                            ? line.lineTotalCents : null, sourceResultLimit[searchKey] ?? 40,
                          sourceUnpricedLimit[searchKey] ?? 5)
                        return (
                        <article key={line.id} id={reviewRowId(store, line.id)} tabIndex={-1}
                          className="offline-price-workbench__line">
                          <div>
                            <label className="offline-price-workbench__trip-tick">
                              <input type="checkbox" checked={Boolean(doneTripItems[shoppingTaskKey(store, line)])}
                                onChange={event => {
                                  const key = shoppingTaskKey(store, line)
                                  const checked = event.currentTarget.checked
                                  setDoneTripItems(previous => ({ ...previous, [key]: checked }))
                                }} />
                              <strong>{line.ingredientLabel}</strong>
                              <span>Afvinken als gekocht</span>
                            </label>
                            <span>Benodigd: {line.requirement.amount ?? '?'} {line.requirement.unit}</span>
                            {(choices.availableCount > 0 || choices.unpricedCount > 0) && (
                              <div className="offline-price-workbench__source-choices">
                                <label>Zoek eigen bronartikel voor dit ingrediënt
                                  <span>Zoek op originele productnaam of artikelcode; ook zonder accent.</span>
                                  <input type="search" value={skuFilter[searchKey] ?? ''}
                                    maxLength={120} placeholder="Zoek product of artikelcode"
                                    onChange={event => {
                                      setSkuFilter(current => ({ ...current, [searchKey]: event.currentTarget.value }))
                                      setSourceResultLimit(previous => ({ ...previous, [searchKey]: 40 }))
                                      setSourceUnpricedLimit(previous => ({ ...previous, [searchKey]: 5 }))
                                    }} />
                                  <small>{choices.total} prijsklare en {choices.unpricedTotal} niet-prijsklare bronartikelen in deze zoekopdracht.</small>
                                </label>
                                {choices.availableCount > 0 && (
                                  <label>Sorteer mijn beschikbare geprijsde bronartikelen
                                    <select value={sourceSort[searchKey] ?? 'relevance'}
                                      onChange={event => setSourceSort(previous => ({ ...previous,
                                        [searchKey]: event.currentTarget.value as SourceSort,
                                      }))}>
                                      <option value="relevance">Beste tekst- en verpakkingsmatch</option>
                                      <option value="whole-pack" disabled={line.requirement.amount === null}>
                                        Laagste prijs voor alle benodigde hele pakken
                                      </option>
                                      <option value="unit-price">Laagste indicatieve eenheidsprijs</option>
                                    </select>
                                    <small>Alleen jouw oorspronkelijke prijsklare en fysiek passende bronartikelen.
                                      Goedkoopst betekent niet automatisch hetzelfde product; controleer zelf de verpakking,
                                      broncode en toepassing voor je de match bevestigt.</small>
                                  </label>
                                )}
                                {choices.availableCount > 0 && line.status === 'matched' && (
                                  <label><input type="checkbox" checked={Boolean(onlyCheaper[searchKey])}
                                    onChange={event => setOnlyCheaper(previous => ({ ...previous,
                                      [searchKey]: event.currentTarget.checked,
                                    }))} /> Toon alleen bronproducten met een lager berekend bedrag
                                    voor deze hele benodigde hoeveelheid
                                    <small>Geen substitutieadvies: een goedkoper bronartikel hoeft niet geschikt
                                      of identiek te zijn. Jouw bestaande match blijft altijd beschikbaar
                                      en geen bronreview wordt automatisch goedgekeurd.</small>
                                  </label>
                                )}
                                {choices.availableCount > 0 && (
                                  <label>Kies een werkelijk waargenomen, prijsklaar bronartikel
                                    <select value={manualSku[store][line.id] ?? ''}
                                      onChange={event => chooseSourceSku(store, line, event.currentTarget.value)}>
                                      <option value="">Automatisch voorstellen (of onbekend)</option>
                                      {choices.shown.map(product => (
                                        <option key={product.id} value={product.id}>
                                          {product.name} · {product.id} · {(product.packCount ?? 1)} × {product.packAmount} {product.packUnit} · {exactEuro.formatCents(product.priceCents)} per pak{sourcePackRate(product)}{sourceWholePackPreview(product, line.requirement,
                                            line.status === 'matched' ? line.lineTotalCents : null)}
                                        </option>
                                      ))}
                                    </select>
                                    <small>Bekijk tot {choices.total} passende bronartikelen, eerst 40.
                                      Het gekozen bronartikel blijft beschikbaar; controleer zelf SKU, inhoud en prijs.</small>
                                    {(sourceResultLimit[searchKey] ?? 40) < choices.total && (
                                      <div className="offline-price-workbench__matching-actions">
                                        <button type="button" className="ghost-button"
                                          onClick={() => setSourceResultLimit(previous => ({
                                            ...previous, [searchKey]: Math.min(1000, (previous[searchKey] ?? 40) + 40),
                                          }))}>
                                          Toon volgende {Math.min(40, choices.total - (sourceResultLimit[searchKey] ?? 40))} bronartikelen
                                        </button>
                                        <button type="button" className="ghost-button"
                                          onClick={() => setSourceResultLimit(previous => ({
                                            ...previous, [searchKey]: Math.min(1000, choices.total),
                                          }))}>
                                          Toon alle {choices.total} passende originele artikelen
                                        </button>
                                      </div>
                                    )}
                                    {choices.shown.length > 0 && <details className="offline-price-workbench__candidate-preview">
                                      <summary>Bekijk de eerste bronartikelen met benodigde hele verpakkingen</summary>
                                      <p>Dit zijn ongetoetste alternatieven uit je eigen bron.
                                        De berekening betreft alleen dit ingrediënt, nog niet het totale winkelmandje.</p>
                                      <ul>{choices.shown.slice(0, 3).map(product => (
                                        <li key={product.id}>
                                          <strong>{product.name}</strong> · SKU {product.id}
                                          {' '}· {product.packCount ?? 1} × {product.packAmount} {product.packUnit}
                                          {' '}· {exactEuro.formatCents(product.priceCents)} per verpakking
                                          {sourcePackRate(product)}
                                          {sourceWholePackPreview(product, line.requirement,
                                            line.status === 'matched' ? line.lineTotalCents : null)}
                                          <button type="button"
                                            disabled={manualSku[store][line.id] === product.id}
                                            aria-label={'Kies bronartikel ' + product.name + ' voor ' + line.ingredientLabel}
                                            onClick={() => chooseSourceSku(store, line, product.id)}>
                                            {manualSku[store][line.id] === product.id
                                              ? 'Dit artikel is gekozen' : 'Kies deze broncode'}
                                          </button>
                                        </li>
                                      ))}</ul>
                                    </details>}
                                  </label>
                                )}
                                {choices.unpricedShown.length > 0 && (
                                  <div className="offline-price-workbench__missing">
                                    <strong>Wel in jouw bron, nog niet prijsklaar</strong>
                                    <p>Per bronartikel staat hieronder waarom het nog niet voor een
                                      rekenbaar mandbedrag kan worden gekozen. Maak alleen een nieuwe opname
                                      als je het ontbrekende gegeven werkelijk kunt vaststellen; onbekend is nooit € 0.</p>
                                    <ul>{choices.unpricedShown.map(product => (
                                      <li key={product.id}>{product.name} · broncode {product.id}
                                        {' '}· {product.packAmount ?? '?'} {product.packUnit}
                                        <small> — {explainUnpricedSource(product)}</small></li>
                                    ))}</ul>
                                    {choices.unpricedTotal > choices.unpricedShown.length && (
                                      <div className="offline-price-workbench__matching-actions">
                                        <button type="button" className="ghost-button"
                                          onClick={() => setSourceUnpricedLimit(previous => ({
                                            ...previous, [searchKey]: Math.min(1000, (previous[searchKey] ?? 5) + 20),
                                          }))}>
                                          Bekijk volgende {Math.min(20, choices.unpricedTotal - choices.unpricedShown.length)} onvolledige bronartikelen
                                        </button>
                                        <button type="button" className="ghost-button"
                                          onClick={() => setSourceUnpricedLimit(previous => ({
                                            ...previous, [searchKey]: Math.min(1000, choices.unpricedTotal),
                                          }))}>
                                          Bekijk alle {choices.unpricedTotal} bronartikelen met ontbrekende prijs of verpakking
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            )}

                            {line.status === 'matched' && <span>{line.productName} · {line.packs} × verpakking</span>}
                            {line.status === 'matched' && <span>Eenheidsprijs: {admittedNow
                              ? pricePerUnit(line) ?? 'onbekend' : 'onbekend · originele bron eerst controleren'}</span>}
                            {line.status === 'matched' && <span>Bron-ID: {line.productId} · {line.pack.amount} {line.pack.unit} × {line.pack.count} per verpakking · {admittedNow
                              ? exactEuro.formatCents(line.pricePerPackCents) + ' per verpakking'
                              : 'prijs onbekend / nieuwe opname of bevestiging nodig'}</span>}
                            {line.reasons.length > 0 && (
                              <details className="offline-price-workbench__match-explanation">
                                <summary>Waarom is dit {line.status === 'matched' ? 'bronartikel voorgesteld' : 'ingrediënt nog niet gekoppeld'}?</summary>
                                <p>De productmatch is een rekenvoorstel, geen bewijs dat het oorspronkelijke
                                  artikel bij je ingrediënt hoort. Controleer de originele code, hoeveelheid en prijs.</p>
                                <ul>{line.reasons.map(reason => (
                                  <li key={reason}>{humanMatchReason(reason)}</li>
                                ))}</ul>
                                {line.matchScore !== null && <small>Interne zoekrangschikking: {line.matchScore} punten.
                                  Dit is geen kans op correctheid of externe productvalidatie.</small>}
                              </details>
                            )}
                            {line.status === 'matched' && (() => {
                              const key = reviewedLineKey(store, capture.observedAt, line)
                              const automatic = isAutomaticKey(key)
                              const rejected = autoReviewKeys.has(key) && rejectedAutoReviews[key] === true
                              return <label className="offline-price-workbench__review">
                                <input type="checkbox"
                                  checked={isAcceptedKey(key)}
                                  onChange={event => {
                                    const checked = event.currentTarget.checked
                                    // Rejecting an automatic match keeps it unknown until the
                                    // user deliberately approves the original SKU or changes it.
                                    setRejectedAutoReviews(previous => ({ ...previous,
                                      [key]: !checked }))
                                    setReviewedLines(previous => ({ ...previous,
                                      [key]: checked }))
                                  }} />
                                <span>{automatic
                                  ? 'Automatisch gekoppeld: exacte ingrediënt- en productnaam, originele SKU, passende verpakking en bekende bronprijs. Haal het vinkje weg als dit niet klopt.'
                                  : rejected
                                    ? 'Automatische match door jou afgewezen. Kies een ander bronartikel, of controleer en bevestig dit product bewust.'
                                    : 'Match niet eenduidig: controleer de originele SKU, inhoud en bronprijs. Alleen hier is nog een vinkje nodig.'}</span>
                              </label>
                            })()}
                            {line.status === 'unresolved' && <span>{line.reasons.some(reason => reason.includes('same source SKU'))
                              ? 'Dezelfde winkel-SKU is aan meerdere ingrediënten gekoppeld. Combineer de fysieke hoeveelheden in Planner of kies andere echte artikelen; zonder die keuze geen volledige prijs.'
                              : 'Niet gekoppeld · controleer bronproduct, beschikbaarheid of verpakking.'}</span>}
                          </div>
                          <strong>{line.status === 'matched' ? exactEuro.formatCents(line.lineTotalCents) : '—'}</strong>
                        </article>
                      )})}
                    </section>
                  )
                })}
              </div>
            </>
          )}
        </div>
      )}
    </section>
  )
}
