import { useEffect, useMemo, useRef, useState } from 'react'
import { aggregatePlanIngredients, buildOneStoreBasket, type RecipeWithIngredients, type BasketTraceLine, type OneStoreBasket } from '../../domain/basket.ts'
import { compareFullBaskets } from '../../domain/basketComparison.ts'
import type { PlannedMeal } from '../../domain/types.ts'
import { parseOfflinePriceSnapshots, type OfflinePriceSnapshots } from '../../domain/offlineReviewedImport.ts'
import { LocalTwoStorePriceEditor } from './LocalTwoStorePriceEditor.tsx'
import { exportPrivatePlannerWeek } from './exportPrivatePlannerWeek.ts'
import { exportPrivateBasketSession } from './exportPrivateBasketSession.ts'
import { makePrivateRecaptureCsv } from './privateRecaptureCsv.ts'
import { PrivateBasketComparisonExport } from './PrivateBasketComparisonExport.tsx'
import { ComparisonReadiness } from './ComparisonReadiness.tsx'
import { privatePackUnitRate } from './privateUnitPrice.ts'
import { replacePrivateStoreCapture } from './replacePrivateStoreCapture.ts'
import { describePrivateStoreCaptureChange } from './privateStoreCaptureDiff.ts'
import { importPrivateBasketSession } from './importPrivateBasketSession.ts'
import { currentTripKey, loadTripProgress, saveTripProgress } from '../../privateShoppingProgress.ts'
import { createPrivateBasketComparisonCsv } from '../../privateBasketComparisonCsv.ts'
import { UnpricedPlannerChecklist } from './UnpricedPlannerChecklist.tsx'
import type { PrivateReviewedBaskets } from './privateReviewedBasketBridge.ts'
import './offlineReviewedWorkbench.css'

const euros = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' })
const dateTime = new Intl.DateTimeFormat('nl-NL', { dateStyle: 'medium', timeStyle: 'short' })
const stores = ['PLUS', 'DekaMarkt'] as const
type Matched = Extract<BasketTraceLine, { status: 'matched' }>

function pricePerUnit(line: Matched): string | null {
  const { unit, amount, count } = line.pack
  const physical = amount * count
  const basis = unit === 'g' || unit === 'ml' ? physical / 1000 : physical
  if (!Number.isFinite(basis) || basis <= 0) return null
  const cents = line.pricePerPackCents / basis
  if (!Number.isFinite(cents) || cents < 0) return null
  return euros.format(cents / 100) + ' per ' +
    (unit === 'g' || unit === 'kg' ? 'kg' : unit === 'ml' || unit === 'l' ? 'liter' : 'stuk')
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
  return rate ? ' · ' + euros.format(rate.centsPerUnit / 100) + ' per ' + rate.unit : ''
}
function searchableSourceText(value: string): string {
  // Discoverability only: never change an original source name/SKU/price.
  // A user typing 'creme' should find an observed 'crème' article.
  return value.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase('nl').trim()
}
function sourceOptions(products: import('../../domain/basket.ts').StoreProduct[],
  unit: BasketTraceLine['requirement']['unit'], text: string, keepId: string) {
  const query = searchableSourceText(text)
  const matchesQuery = (product: import('../../domain/basket.ts').StoreProduct) =>
    !query || searchableSourceText(product.name).includes(query) ||
    searchableSourceText(product.id).includes(query)
  const physicallyCompatible = products.filter(p => compatibleSourceUnit(unit, p.packUnit))
  const available = physicallyCompatible.filter(p => p.available && p.packAmount !== null)
  const filtered = available.filter(matchesQuery)
  const shown = filtered.slice(0, 40)
  const current = available.find(p => p.id === keepId)
  if (current && !shown.some(p => p.id === keepId)) shown.unshift(current)

  // These are honest original capture records, but not purchasable price
  // candidates. Never put them in the select or recalculate a basket from them.
  const unpriced = physicallyCompatible.filter(p => !p.available || p.packAmount === null)
  const unpricedFiltered = unpriced.filter(matchesQuery)
  return {
    shown, total: filtered.length, availableCount: available.length,
    unpricedShown: unpricedFiltered.slice(0, 5),
    unpricedTotal: unpricedFiltered.length, unpricedCount: unpriced.length,
  }
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
  const money = (cents: number) => euros.format(cents / 100)
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

function shoppingChecklist(basket: OneStoreBasket, store: typeof stores[number], done: Record<string, boolean>): string {
  return [
    `Supa · boodschappen voor ${basket.store.name} · privé ingevoerde prijzen, niet geverifieerd`,
    ...basket.lines.map(line => line.status === 'matched'
      ? `${done[shoppingTaskKey(store, line)] ? '☑' : '☐'} ${line.ingredientLabel}: ${line.packs} × ${line.productName} (${euros.format(line.lineTotalCents / 100)})`
      : `${done[shoppingTaskKey(store, line)] ? '☑' : '☐'} ${line.ingredientLabel}: handmatig kiezen, hoeveelheid ${line.requirement.amount ?? '?'} ${line.requirement.unit}`),
    'Prijzen zijn alleen indicatief op basis van lokaal aangeleverde gegevens.',
  ].join('\n')
}

/** Independent opt-in local import. Never treats JSON as evidence of retailer licensing or physical verification. */
export function OfflineReviewedWorkbench({
  plan, recipes, activeDays, planKey, onReviewedBaskets,
}: {
  plan: PlannedMeal[]
  recipes: RecipeWithIngredients[]
  activeDays: string[]
  planKey?: string
  onReviewedBaskets?: (value: PrivateReviewedBaskets | null) => void
}) {
  const [text, setText] = useState('')
  const [imported, setImported] = useState<OfflinePriceSnapshots | null>(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const importRevision = useRef(0)
  const [pendingReplacement, setPendingReplacement] = useState<{
    sourceText: string; newText: string
    version: number; store: typeof stores[number]
    preview: ReturnType<typeof describePrivateStoreCaptureChange>
  } | null>(null)

  const [weekExportMessage, setWeekExportMessage] = useState('')
  const [reviewedLines, setReviewedLines] = useState<Record<string, boolean>>({})
  const [manualSku, setManualSku] = useState<Record<typeof stores[number], Record<string, string>>>({
    PLUS: {}, DekaMarkt: {},
  })
  const [skuFilter, setSkuFilter] = useState<Record<string, string>>({})
  const [doneTripItems, setDoneTripItems] = useState<Record<string, boolean>>({})
  const [openTripOnly, setOpenTripOnly] = useState(false)
  const [tripExportMessage, setTripExportMessage] = useState('')
  const [tripProgressMessage, setTripProgressMessage] = useState('')
  const [coverageMessage, setCoverageMessage] = useState('')
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

  function downloadPortableSession() {
    if (!imported || !basketPair) return
    try {
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
          const reviewed = reviewedLines[reviewedLineKey(store, capture.observedAt, line)]
          if (explicit || reviewed) selected[store][line.id] = line.productId
        }
      }
      const session = exportPrivateBasketSession({
        plan, recipes, activeDays, rawSource: text, selected,
      })
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
      const content = shoppingChecklist(basket, store, doneTripItems)
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
      if (imported && !window.confirm(
        'Beide vorige winkelopnames en controles vervangen door deze nieuwe invoer?')) {
        setMessage('Nieuwe invoer niet toegepast; vorige winkelopnames behouden.')
        return
      }
      setText(input)
      importSnapshots(input)
    } catch (error) {
      setMessage((error instanceof Error ? error.message : 'Ongeldige bron.') +
        ' Bestaande winkelopnames en controles zijn behouden.')
    }
  }

  function importSnapshots(input: string) {
    // A new import, even identical bytes, requires explicit source review.
    setReviewedLines({})
    setDoneTripItems({})
    setManualSku({ PLUS: {}, DekaMarkt: {} }); setSkuFilter({})
    try {
      const parsed = parseOfflinePriceSnapshots(input, Date.now())
      setClockMs(Date.now())
      setImported(parsed)
      setMessage(Object.keys(parsed.captures).length === 1
        ? 'Eén eigen winkelopname lokaal geladen. Een tweede winkel blijft onbekend tot je die werkelijk invoert.'
        : 'Twee privéopnames lokaal geladen; Supa heeft geen gegevens naar een server verstuurd.')
    } catch (error) {
      // Never retain/display a previous basket after an invalid new import.
      setImported(null)
      setMessage(error instanceof Error ? error.message : 'Ongeldige import.')
    }
  }
  async function loadSelectedSources(files: File[]) {
    if (files.length === 0) return
    if (files.length === 1) {
      await loadFile(files[0])
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
      const sources: unknown[] = []
      const seen = new Set<string>()
      for (const file of files) {
        if (!file.size || file.size > 256000)
          throw new Error('Elk origineel winkelbestand moet gevuld zijn en maximaal 256 kB bevatten.')
        const raw = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer())
        const isCsv = /\.csv$/iu.test(file.name) || file.type === 'text/csv'
        let json = raw
        if (isCsv) {
          const converterUrl = '/offline-two-store-csv.mjs'
          const module: unknown = await import(/* @vite-ignore */ converterUrl)
          if (!module || typeof module !== 'object' ||
              !('convertOwnStoreCsv' in module) || typeof module.convertOwnStoreCsv !== 'function')
            throw new Error('De bestaande lokale CSV-converter is niet beschikbaar.')
          json = (module.convertOwnStoreCsv as (input: string) => string)(raw)
        }
        const parsed = parseOfflinePriceSnapshots(json, Date.now())
        const shops = Object.keys(parsed.captures)
        if (shops.length !== 1)
          throw new Error('Gebruik voor deze import twee afzonderlijke bestanden met elk precies één werkelijk waargenomen winkel.')
        if (seen.has(shops[0]))
          throw new Error('Beide bronbestanden zijn van dezelfde winkel. Selecteer één PLUS- en één DekaMarkt-opname.')
        seen.add(shops[0])
        const original: unknown = JSON.parse(json)
        if (!original || typeof original !== 'object' || !('captures' in original) ||
            !Array.isArray(original.captures) || original.captures.length !== 1)
          throw new Error('Origineel winkelbestand ongeldig.')
        sources.push(original.captures[0])
      }
      // Preserve original SKUs, null prices and observation timestamps. The
      // canonical parser is the final authority for this composed capture.
      const combined = JSON.stringify({ schema: 'supa-offline-prices-v1', captures: sources })
      const admitted = parseOfflinePriceSnapshots(combined, Date.now())
      if (version !== importRevision.current) return
      setText(combined)
      setImported(admitted)
      setReviewedLines({})
      setDoneTripItems({})
      setManualSku({ PLUS: {}, DekaMarkt: {} })
      setSkuFilter({})
      setClockMs(Date.now())
      setMessage('Twee originele winkelbestanden samen geladen, elk met eigen bronmoment en productcodes. Controleer alle fysieke matches en prijzen opnieuw voordat een prijsverschil verschijnt.')
    } catch (error) {
      if (version !== importRevision.current) return
      setMessage((error instanceof Error ? error.message :
        'Twee winkelbestanden niet geldig.') +
        ' Eerder ingelezen originele bronopnames, reviews en afvinkingen zijn behouden.')
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
      const isCsv = /\.csv$/iu.test(file.name) || file.type === 'text/csv'
      let json = raw
      if (isCsv) {
        const converterUrl = '/offline-two-store-csv.mjs'
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
      const isCsv = /\.csv$/iu.test(file.name) || file.type === 'text/csv'
      let content = raw
      if (isCsv) {
        // Vite copies the existing public module without changing its parser.
        const converterUrl = '/offline-two-store-csv.mjs'
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
          ' geldig geladen; alle nieuwe fysieke artikelmatches en prijzen opnieuw controleren.')
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
    const accepted = keys.filter(key => reviewedLines[key]).length
    const complete = !!basket && basket.selectedMealCount > 0 && basket.lines.length > 0 &&
      basket.unresolvedLineCount === 0 && keys.length === basket.lines.length &&
      accepted === keys.length
    const nowNs = BigInt(Math.trunc(clockMs)) * 1_000_000n
    const fresh = !!capture && nowNs >= capture.observedNs - 300_000_000_000n &&
      nowNs - capture.observedNs <= 604_800_000_000_000n
    return { store, accepted, required: keys.length, complete, fresh }
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
          reviewedLines[reviewedLineKey(store, capture.observedAt, line)] === true)
      const nowNs = BigInt(Math.trunc(clockMs)) * 1_000_000n
      const fresh = nowNs >= capture.observedNs - 300_000_000_000n &&
        nowNs - capture.observedNs <= 604_800_000_000_000n
      if (complete && fresh) verified[store] = {
        basket, observedAt: capture.observedAt, capturedMs: capture.observedMs,
      }
    }
    return Object.keys(verified).length > 0 ? { planKey, stores: verified } : null
  }, [imported, basketPair, reviewedLines, clockMs, planKey])
  useEffect(() => {
    onReviewedBaskets?.(reviewedBridge)
  }, [onReviewedBaskets, reviewedBridge])
  function goToReviewRow(store: typeof stores[number], id: string) {
    setOpenTripOnly(false)
    window.setTimeout(() => document.getElementById(reviewRowId(store, id))?.scrollIntoView({
      behavior: 'smooth', block: 'center',
    }), 0)
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
      if (!capture) return { status: 'Geen bron', canReview: false, product: '' }
      if (!line) return { status: 'Planning niet koppelbaar', canReview: false, product: '' }
      if (line.status !== 'matched') return { status: 'SKU/verpakking ontbreekt', canReview: true, product: '' }
      const product = line.productName + ' · broncode ' + line.productId +
        ' · ' + line.pack.amount + ' ' + line.pack.unit + ' × ' + line.pack.count
      if (!perStoreReview.find(item => item.store === store)?.fresh)
        return { status: 'Opname verlopen of toekomstig', canReview: true, product }
      if (!reviewedLines[reviewedLineKey(store, capture.observedAt, line)])
        return { status: 'Product, verpakking en prijs controleren', canReview: true, product }
      return { status: 'Persoonlijk bevestigd', canReview: true, product }
    }
    return {
      id: need.id, label: need.ingredientLabel,
      amount: need.requirement.amount, unit: need.requirement.unit,
      PLUS: review('PLUS'), DekaMarkt: review('DekaMarkt'),
    }
  })
  const olderPairCapture = imported?.captures.PLUS && imported.captures.DekaMarkt &&
    !imported.pairedWithin24h
    ? imported.captures.PLUS.observedNs <= imported.captures.DekaMarkt.observedNs
      ? 'PLUS' : 'DekaMarkt'
    : null
  const openCoverageRows = coverageRows.filter(row =>
    !!olderPairCapture || stores.some(store => row[store].status !== 'Persoonlijk bevestigd'))
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
        <p>Vul producten en prijzen direct per winkel in, of laad een eerder rechtmatig verkregen JSON-export.
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
          <a className="ghost-button" href="/private-basket-mapping.html" target="_blank" rel="noopener noreferrer">
            Open uitgebreide privévergelijker
          </a>
        </div>
        <p role="status" aria-live="polite">{weekExportMessage}</p>
      </div>
      <LocalTwoStorePriceEditor
        plan={plan} recipes={recipes} activeDays={activeDays}
        onGenerated={acceptManualSource}
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
            onChange={event => { void restorePortableSession(event.currentTarget.files?.[0]) }} />
        </label>
        <label>Open één bronbestand, of selecteer tegelijk je aparte PLUS- en DekaMarkt-bestanden (CSV/JSON)
          <input type="file" accept=".csv,.json,text/csv,application/json" multiple disabled={busy}
            onChange={event => {
              const files = Array.from(event.currentTarget.files ?? [])
              event.currentTarget.value = ''
              void loadSelectedSources(files)
            }} />
          <small>Twee bestanden moeten ieder precies één verschillende winkel bevatten. Ongeldige of dubbele opnames worden samen geweigerd; onbekende prijzen blijven onbekend.</small>
        </label>
        {imported && Object.keys(imported.captures).length === 1 && (
          <label>Voeg de echte opname van de andere winkel toe (CSV of JSON)
            <input type="file" accept=".csv,.json,text/csv,application/json" disabled={busy}
              onChange={event => { void loadFile(event.currentTarget.files?.[0], true) }} />
            <small>De al gecontroleerde oorspronkelijke winkel blijft bewaard. Nieuwe producten moet je zelf bevestigen; er wordt geen tweede winkel verzonnen.</small>
          </label>
        )}
        <label>Of plak je eigen winkelopname(s) als JSON
          <textarea rows={5} value={text} maxLength={256000} spellCheck={false}
            placeholder={'{"schema":"supa-offline-prices-v1","captures":[...]}'}
            onChange={event => {
              importRevision.current += 1
              setBusy(false)
              setText(event.target.value)
              setImported(null)
              setReviewedLines({})
              setDoneTripItems({})
              setMessage('Invoer gewijzigd. Bereken opnieuw; eerder resultaat is niet meer geldig.')
            }} />
        </label>
        <div className="offline-price-workbench__actions">
          <button type="button" disabled={busy || !text.trim()} onClick={() => {
            importRevision.current += 1
            importSnapshots(text)
          }}>
            Bereken mandjes
          </button>
          <button type="button" className="ghost-button" disabled={!imported || busy} onClick={downloadOwnSources}>
            Download mijn originele bronopnames (JSON)
          </button>
          <button type="button" className="ghost-button" disabled={!imported || !basketPair || busy}
            onClick={downloadPortableSession}>
            Bewaar mijn winkelmand + gekozen producten (privésessie)
          </button>
          <button type="button" className="ghost-button" onClick={() => {
            importRevision.current += 1
            setBusy(false)
            setImported(null); setReviewedLines({}); setDoneTripItems({}); setText(''); setMessage('Geïmporteerde prijsdata uit dit scherm gewist.')
          }}>Wis lokaal geladen data</button>
        </div>
        <p role="status" aria-live="polite">{message}</p>
      </div>
      {imported && (
        <div className="offline-price-workbench__results">
          <h3>Winkelvergelijking voor jouw huidige weekmenu</h3>
          <div className="offline-price-workbench__dates">
            {stores.map(store => {
              const capture = imported.captures[store]
              return capture
                ? <div key={store}>
                    <p><strong>{store}</strong> · waargenomen {captureDate(capture.observedMs)}
                      {' '}· {capture.products.length} eigen bronproducten</p>
                    <button className="ghost-button" type="button" onClick={() => downloadPrivateRecaptureCsv(store)}>
                      Maak nieuw prijsinvulblad voor {store} (CSV)
                    </button>
                    <label>Vervang uitsluitend de {store}-opname met je nieuwe echte bron (CSV of JSON)
                      <input type="file" accept=".csv,.json,text/csv,application/json" disabled={busy}
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
                    <ul>{pendingReplacement.preview.priceExamples.map((item, index) => (
                      <li key={index}>{item.name} · broncode {item.sourceId}:
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
                          !reviewedLines[reviewedLineKey(store, capture.observedAt, line)]
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
                  </div>
                  {coverageMessage && <p role="status" aria-live="polite">{coverageMessage}</p>}
                  <div className="offline-price-workbench__breakdown-scroll">
                    <table>
                      <caption>Bron- en reviewstatus per ingrediënt, zonder fictieve prijs.</caption>
                      <thead><tr>
                        <th scope="col">Hetzelfde ingrediënt</th>
                        <th scope="col">PLUS</th>
                        <th scope="col">DekaMarkt</th>
                      </tr></thead>
                      <tbody>{coverageRows.map(row => (
                        <tr key={row.id}>
                          <th scope="row">{row.label}<small>{row.amount ?? '?'} {row.unit} nodig</small></th>
                          {stores.map(store => {
                            const item = row[store]
                            return <td key={store}>
                              <strong>{item.status}</strong>
                              {item.product && <small>{item.product}</small>}
                              {item.canReview && item.status !== 'Persoonlijk bevestigd' &&
                                <a href={'#' + reviewRowId(store, row.id)}
                                  onClick={() => setOpenTripOnly(false)}>Open productkeuze en controle</a>}
                            </td>
                          })}
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
                      <strong>{complete ? euros.format(basket.totalCents / 100) : 'Nog geen bevestigd volledig totaal'}</strong>
                      {!complete && basket.matchedLineCount > 0 && (
                        <span>Voorlopig gekoppelde regels: {euros.format(basket.totalCents / 100)} (geen bevestigd mandtotaal)</span>
                      )}
                      <span>{basket.matchedLineCount} automatisch gevonden, {basket.unresolvedLineCount} onbekend</span>
                      <span>{reviewedStore.accepted} van {reviewedStore.required} prijsregels door jou bevestigd</span>
                      {!reviewedStore.fresh && <span>Bron verouderd of toekomstig; geen actueel mandtotaal.</span>}
                    </section>
                  )
                })}
              </div>
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
                    : `${basketPair.comparison.deltaCents > 0 ? 'PLUS' : 'DekaMarkt'} is op basis van deze eigen invoer ${euros.format(Math.abs(basketPair.comparison.deltaCents) / 100)} goedkoper.`
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
                      <p key={line.id}><strong>{line.ingredientLabel}</strong> · PLUS {euros.format(line.baselineLineTotalCents / 100)}
                        {' '}· DekaMarkt {euros.format(line.candidateLineTotalCents / 100)}
                        {' '}· {line.deltaCents === 0 ? 'zelfde bedrag'
                          : `${euros.format(Math.abs(line.deltaCents) / 100)} verschil`}</p>
                    ))}
                </section>
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
                            <small>{plus.requirement.amount} {plus.requirement.unit} benodigd</small>
                          </th>
                          <td><strong>{euros.format(plus.lineTotalCents / 100)}</strong>
                            <small>{plus.productName} · broncode {plus.productId}</small>
                            <small>{plus.packs} × {plus.pack.amount} {plus.pack.unit} × {plus.pack.count}</small>
                            <small>{pricePerUnit(plus) ?? 'Eenheidsprijs onbekend'}</small>
                          </td>
                          <td><strong>{euros.format(deka.lineTotalCents / 100)}</strong>
                            <small>{deka.productName} · broncode {deka.productId}</small>
                            <small>{deka.packs} × {deka.pack.amount} {deka.pack.unit} × {deka.pack.count}</small>
                            <small>{pricePerUnit(deka) ?? 'Eenheidsprijs onbekend'}</small>
                          </td>
                          <td><strong>{delta.deltaCents === 0 ? 'Gelijk'
                            : (delta.deltaCents > 0 ? '+' : '−') +
                              euros.format(Math.abs(delta.deltaCents) / 100)}</strong>
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
                  const purchased = basket.lines.filter(line => doneTripItems[shoppingTaskKey(store, line)]).length
                  const visible = basket.lines.filter(line =>
                    !openTripOnly || !doneTripItems[shoppingTaskKey(store, line)])
                  return (
                    <section key={store}>
                      <h4>{store} · boodschappen</h4>
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
                          value={shoppingChecklist(basket, store, doneTripItems)} onFocus={event => event.currentTarget.select()} />
                      </details>
                      {visible.length === 0 && basket.lines.length > 0 &&
                        <p className="offline-price-workbench__trip-complete" role="status">
                          Alles afgevinkt voor {store}.
                        </p>}
                      {visible.map(line => {
                        const searchKey = JSON.stringify([store, line.id])
                        const choices = sourceOptions(capture.products, line.requirement.unit,
                          skuFilter[searchKey] ?? '', manualSku[store][line.id] ?? '')
                        return (
                        <article key={line.id} id={reviewRowId(store, line.id)} className="offline-price-workbench__line">
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
                                    onChange={event => setSkuFilter(current =>
                                      ({ ...current, [searchKey]: event.currentTarget.value }))} />
                                  <small>{choices.total} prijsklare en {choices.unpricedTotal} niet-prijsklare bronartikelen in deze zoekopdracht.</small>
                                </label>
                                {choices.availableCount > 0 && (
                                  <label>Kies een werkelijk waargenomen, prijsklaar bronartikel
                                    <select value={manualSku[store][line.id] ?? ''}
                                      onChange={event => {
                                        const id = event.currentTarget.value
                                        setManualSku(previous => ({
                                          ...previous, [store]: { ...previous[store], [line.id]: id },
                                        }))
                                        // A new SKU can change matching within this store,
                                        // but does not revoke the other store's independently
                                        // reviewed source or shopping progress.
                                        const sameStore = (key: string) =>
                                          key.startsWith('[' + JSON.stringify(store) + ',')
                                        setReviewedLines(previous => Object.fromEntries(
                                          Object.entries(previous).filter(([key]) => !sameStore(key))))
                                        setDoneTripItems(previous => Object.fromEntries(
                                          Object.entries(previous).filter(([key]) => !sameStore(key))))
                                        setTripExportMessage('')
                                        setTripProgressMessage('')
                                      }}>
                                      <option value="">Automatisch voorstellen (of onbekend)</option>
                                      {choices.shown.map(product => (
                                        <option key={product.id} value={product.id}>
                                          {product.name} · {product.id} · {(product.packCount ?? 1)} × {product.packAmount} {product.packUnit} · {euros.format(product.priceCents / 100)} per pak{sourcePackRate(product)}
                                        </option>
                                      ))}
                                    </select>
                                    <small>Maximaal 40 prijsklare keuzes tegelijk; verfijn de zoekterm. Een keuze vergt nog persoonlijke broncontrole.</small>
                                  </label>
                                )}
                                {choices.unpricedShown.length > 0 && (
                                  <div className="offline-price-workbench__missing">
                                    <strong>Wel in jouw bron, nog niet prijsklaar</strong>
                                    <p>Deze originele artikelen zijn niet beschikbaar of missen een bruikbare verpakking of prijs.
                                      Ze zijn niet te kiezen voor een mandbedrag. Neem de werkelijke brongegevens opnieuw op.</p>
                                    <ul>{choices.unpricedShown.map(product => (
                                      <li key={product.id}>{product.name} · broncode {product.id}
                                        {' '}· {product.packAmount ?? '?'} {product.packUnit}</li>
                                    ))}</ul>
                                    {choices.unpricedTotal > choices.unpricedShown.length &&
                                      <small>Er zijn meer ongeprijsde artikelen; verfijn de zoekterm.</small>}
                                  </div>
                                )}
                              </div>
                            )}

                            {line.status === 'matched' && <span>{line.productName} · {line.packs} × verpakking</span>}
                            {line.status === 'matched' && <span>Eenheidsprijs: {pricePerUnit(line) ?? 'onbekend'}</span>}
                            {line.status === 'matched' && <span>Bron-ID: {line.productId} · {line.pack.amount} {line.pack.unit} × {line.pack.count} per verpakking · {euros.format(line.pricePerPackCents / 100)} per verpakking</span>}
                            {line.reasons.length > 0 && (
                              <details className="offline-price-workbench__match-explanation">
                                <summary>Waarom is dit {line.status === 'matched' ? 'bronartikel voorgesteld' : 'ingrediënt nog niet gekoppeld'}?</summary>
                                <p>De productmatch is een rekenvoorstel, geen bewijs dat het oorspronkelijke
                                  artikel bij je ingrediënt hoort. Controleer de originele code, hoeveelheid en prijs.</p>
                                <ul>{line.reasons.map((reason, index) => (
                                  <li key={index}>{humanMatchReason(reason)}</li>
                                ))}</ul>
                                {line.matchScore !== null && <small>Interne zoekrangschikking: {line.matchScore} punten.
                                  Dit is geen kans op correctheid of externe productvalidatie.</small>}
                              </details>
                            )}
                            {line.status === 'matched' && <label className="offline-price-workbench__review">
                              <input type="checkbox"
                                checked={Boolean(reviewedLines[reviewedLineKey(store, capture.observedAt, line)])}
                                onChange={event => {
                                  const key = reviewedLineKey(store, capture.observedAt, line)
                                  const checked = event.currentTarget.checked
                                  setReviewedLines(previous => ({ ...previous, [key]: checked }))
                                }} />
                              <span>Product, inhoud en prijs met mijn bronopname gecontroleerd</span>
                            </label>}
                            {line.status === 'unresolved' && <span>{line.reasons.some(reason => reason.includes('same source SKU'))
                              ? 'Dezelfde winkel-SKU is aan meerdere ingrediënten gekoppeld. Combineer de fysieke hoeveelheden in Planner of kies andere echte artikelen; zonder die keuze geen volledige prijs.'
                              : 'Niet gekoppeld · controleer bronproduct, beschikbaarheid of verpakking.'}</span>}
                          </div>
                          <strong>{line.status === 'matched' ? euros.format(line.lineTotalCents / 100) : '—'}</strong>
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
