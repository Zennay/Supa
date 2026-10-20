import { euro as exactEuro } from '../../lib/money.ts'
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
// Optional local camera scanner is never loaded by users who type product codes.
const LocalDeviceBarcodeScanner = lazy(() => import('./LocalDeviceBarcodeScanner.tsx')
  .then(module => ({ default: module.LocalDeviceBarcodeScanner })))
import { aggregatePlanIngredients, type RecipeWithIngredients } from '../../domain/basket.ts'
import { calculateDecimalPackCount } from '../../domain/decimalPackArithmetic.ts'
import type { MatchUnit } from '../../domain/matching.ts'
import { privatePackUnitRate, formatPrivateUnitRate } from './privateUnitPrice.ts'
import { ownPriceCapturesToCsv } from './ownPriceCsvExport.ts'
import { historicalRetailerProducts } from '../products/historicalRetailerProducts.ts'
import type { PlannedMeal } from '../../domain/types.ts'
import { parseOfflinePriceSnapshots, type OfflineRetailer } from '../../domain/offlineReviewedImport.ts'

type Unit = 'g' | 'kg' | 'ml' | 'l' | 'piece'
export type ReviewedRecaptureSeed = {
  sourceId: string
  name: string
  packAmount: string
  packUnit: 'g' | 'kg' | 'ml' | 'l' | 'piece'
  packCount: string
}
type ProductDraft = {
  sourceId?: string
  name: string
  packAmount: string
  packUnit: Unit
  packCount: string
  priceEuros: string
  available: boolean
  availabilityReviewed?: boolean
}
const stores: OfflineRetailer[] = ['PLUS', 'DekaMarkt']
const supportedUnits: Unit[] = ['g', 'kg', 'ml', 'l', 'piece']
const emptyDraft = (unit: string): ProductDraft => ({
  sourceId: '', name: '', packAmount: '', packUnit: supportedUnits.includes(unit as Unit) ? unit as Unit : 'g',
  packCount: '1', priceEuros: '', available: false, availabilityReviewed: false,
})
const key = (store: OfflineRetailer, ingredientId: string) => JSON.stringify([store, ingredientId])

/** Convert real Dutch retailer civil time to the physical NL UTC offset.
 * Never borrow the browser/device timezone: a shopper can enter prices from
 * abroad and UK/NL offsets differ for much of the year. DST gaps and repeated
 * 02:xx times are refused rather than guessed as independent field evidence.
 */
function timestampWithOffset(value: string): string | null {
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(value)) return null
  const [year, month, day, hour, minute] =
    value.split(/[-T:]/u).map(Number)
  if (year < 2000 || year > 2100) return null
  const localMs = Date.UTC(year, month - 1, day, hour, minute)
  const date = new Date(localMs)
  if (!Number.isFinite(localMs) || date.getUTCFullYear() !== year ||
      date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day ||
      date.getUTCHours() !== hour || date.getUTCMinutes() !== minute) return null
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Amsterdam', year: 'numeric', month: '2-digit',
    day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  })
  const legalOffsets = [60, 120].filter(offsetMinutes => {
    const instant = new Date(localMs - offsetMinutes * 60000)
    const parts = Object.fromEntries(formatter.formatToParts(instant)
      .map(part => [part.type, part.value]))
    return Number(parts.year) === year && Number(parts.month) === month &&
      Number(parts.day) === day && Number(parts.hour) === hour &&
      Number(parts.minute) === minute
  })
  if (legalOffsets.length !== 1) return null
  return value + ':00+' + (legalOffsets[0] === 60 ? '01:00' : '02:00')
}
// Display guidance only; authoritative freshness and the paired physical
// capture instant are rechecked by the existing admitted-source comparator.
function captureTimeAdvice(local: string, now = Date.now()): string {
  if (!local) return 'Bronmoment nog onbekend: vul alleen een echt genoteerde tijd in.'
  const observedAt = timestampWithOffset(local)
  if (observedAt === null) return 'Dit Nederlandse bronmoment bestaat niet of is dubbelzinnig door zomer-/wintertijd.'
  const age = now - Date.parse(observedAt)
  if (age < -300000) return 'Bronmoment ligt in de toekomst: controleer de echte tijd.'
  if (age > 604800000) return 'Opname is ouder dan zeven dagen. Nieuwe eigen prijzen nodig voor het volledige prijsverschil.'
  if (age < 0) return 'Kleine tijdafwijking: controleer de apparaatklok en originele bron.'
  return 'Binnen het zeven-dagenvenster; dit is géén onafhankelijke prijs- of bronverificatie.'
}

function amountOrNull(raw: string): number | null {
  if (!/^\d{1,6}(?:[.,]\d{1,4})?$/.test(raw)) return null
  const value = Number(raw.replace(',', '.'))
  return Number.isFinite(value) && value > 0 && value <= 100000 ? value : null
}
function eurosToCents(raw: string): number | null {
  if (!/^\d{1,5}(?:[.,]\d{1,2})?$/.test(raw)) return null
  const [whole, decimal = ''] = raw.replace(',', '.').split('.')
  const cents = Number(whole) * 100 + Number(decimal.padEnd(2, '0'))
  return Number.isSafeInteger(cents) && cents >= 0 && cents <= 1000000 ? cents : null
}

// A completed form is still only an unverified personal observation.
// Canonical SKU matching, freshness and human review remain separate.
function isCompleteOwnPriceDraft(row: ProductDraft): boolean {
  const id = row.sourceId ?? ''
  const amount = amountOrNull(row.packAmount.trim())
  const count = Number(row.packCount)
  return row.available && id.length > 0 && id === id.trim() && id.length <= 100 &&
    /[\p{L}\p{N}]/u.test(id) &&
    !/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(id) &&
    row.name.trim().length > 0 && row.name === row.name.trim() &&
    amount !== null && (row.packUnit !== 'piece' || Number.isSafeInteger(amount)) &&
    /^\d{1,4}$/.test(row.packCount) && Number.isSafeInteger(count) && count >= 1 && count <= 1000 &&
    eurosToCents(row.priceEuros.trim()) !== null
}

function isReviewedUnavailableDraft(row: ProductDraft): boolean {
  const id = row.sourceId ?? ''
  const amount = row.packAmount.trim() ? amountOrNull(row.packAmount.trim()) : null
  const count = Number(row.packCount)
  return row.availabilityReviewed === true && !row.available &&
    id.length > 0 && id === id.trim() && id.length <= 100 &&
    /[\p{L}\p{N}]/u.test(id) &&
    !/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(id) &&
    row.name.trim().length > 0 && row.name === row.name.trim() &&
    !row.priceEuros.trim() &&
    (row.packAmount.trim().length === 0 || (amount !== null &&
      (row.packUnit !== 'piece' || Number.isSafeInteger(amount)))) &&
    /^\d{1,4}$/.test(row.packCount) && Number.isSafeInteger(count) && count >= 1 && count <= 1000
}
const isEnteredOwnCapture = (row: ProductDraft) =>
  isCompleteOwnPriceDraft(row) || isReviewedUnavailableDraft(row)

// Default pack-count and unit do not count as an observed product. Unfinished
// identities and prices remain in the editing draft, not a retailer snapshot.
function hasPartialOwnCapture(row: ProductDraft): boolean {
  return !isEnteredOwnCapture(row) && Boolean(
    (row.sourceId ?? '').trim() || row.name.trim() ||
    row.packAmount.trim() || row.priceEuros.trim() ||
    row.available || row.availabilityReviewed,
  )
}

type DraftPackMath = {
  packagesNeeded: number
  pricePerPackCents: number
  lineTotalCents: number
  unitRate: string | null
}

// This calculation is for an UNAPPROVED personally typed product only.
// It reuses the canonical physical whole-pack arithmetic; the final basket
// continues to require the original source import + product/price review.
function currentDraftPackMath(row: ProductDraft,
  need: { amount: number | null; unit: MatchUnit }): DraftPackMath | null {
  if (!isCompleteOwnPriceDraft(row) || need.amount === null ||
      !Number.isFinite(need.amount) || need.amount <= 0 ||
      (need.unit === 'piece' && !Number.isSafeInteger(need.amount))) return null
  const packAmount = amountOrNull(row.packAmount.trim())
  const priceCents = eurosToCents(row.priceEuros.trim())
  if (packAmount === null || priceCents === null) return null
  const count = Number(row.packCount)
  const packs = calculateDecimalPackCount(
    [{ amount: need.amount, unit: need.unit }],
    { amount: packAmount, unit: row.packUnit, count },
  )
  if (packs === null || !Number.isSafeInteger(packs) || packs <= 0) return null
  const total = packs * priceCents
  if (!Number.isSafeInteger(total) || total < 0) return null
  const rate = privatePackUnitRate({
    amount: packAmount, unit: row.packUnit, count, priceCents,
  })
  return { packagesNeeded: packs, pricePerPackCents: priceCents,
    lineTotalCents: total, unitRate: rate ? formatPrivateUnitRate(rate) : null }
}

function currentDraftPackPreview(row: ProductDraft,
  need: { amount: number | null; unit: MatchUnit }): string | null {
  const math = currentDraftPackMath(row, need)
  if (!math) return null
  return math.packagesNeeded + ' hele verpakking(en) × ' +
    exactEuro.formatCents(math.pricePerPackCents) + ' = ' +
    exactEuro.formatCents(math.lineTotalCents) + ' voor deze ingrediëntvraag' +
    (math.unitRate ? ' · ' + math.unitRate : '')
}

type CaptureStatus = 'priced' | 'unavailable' | 'incompatible' | 'partial' | 'missing'
function ownCaptureStatus(row: ProductDraft, need: { amount: number | null; unit: MatchUnit }): CaptureStatus {
  if (isReviewedUnavailableDraft(row)) return 'unavailable'
  if (isCompleteOwnPriceDraft(row)) {
    return currentDraftPackPreview(row, need) !== null ? 'priced' : 'incompatible'
  }
  return hasPartialOwnCapture(row) ? 'partial' : 'missing'
}
const captureStatusNames: Record<CaptureStatus, string> = {
  priced: 'Ingevuld · nog te beoordelen',
  unavailable: 'Zelf gecontroleerd niet beschikbaar',
  incompatible: 'Verpakking past niet bij de vraag',
  partial: 'Onvolledig concept',
  missing: 'Nog geen product',
}

const privateDraftStorageKey = 'supa:local-two-store-price-draft:v1'

type StoredDraft = {
  saved: boolean
  sourceSelection: 'both' | OfflineRetailer
  rows: Record<string, ProductDraft>
  capturedAt: Record<OfflineRetailer, string>
  raw: string | null
  protected: boolean
}
function readPrivateDraft(fingerprint: string, allowedRows: ReadonlySet<string>, importedRaw?: string): StoredDraft {
  const empty: StoredDraft = { saved: false, sourceSelection: 'both', rows: {}, capturedAt: { PLUS: '', DekaMarkt: '' }, raw: null, protected: false }
  if (typeof window === 'undefined' && importedRaw === undefined) return empty
  let raw: string | null = importedRaw ?? null
  if (importedRaw === undefined) {
    try { raw = window.sessionStorage.getItem(privateDraftStorageKey) }
    catch { return { ...empty, protected: true } }
  }
  if (raw === null) return empty
  if (raw.length > 256000) return { ...empty, raw, protected: true }
  try {
    const value: unknown = JSON.parse(raw)
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('shape')
    const r = value as Record<string, unknown>
    if (r.schemaVersion !== 1 || typeof r.fingerprint !== 'string' ||
        Object.keys(r).some(k => !['schemaVersion', 'fingerprint', 'rows', 'capturedAt', 'sourceSelection'].includes(k)) ||
        (r.sourceSelection !== undefined && !['both', 'PLUS', 'DekaMarkt'].includes(String(r.sourceSelection))) ||
        !r.rows || typeof r.rows !== 'object' || Array.isArray(r.rows) ||
        !r.capturedAt || typeof r.capturedAt !== 'object' || Array.isArray(r.capturedAt)) throw Error('shape')
    if (r.fingerprint !== fingerprint) return { ...empty, raw, protected: true }
    const dates = r.capturedAt as Record<string, unknown>
    if (Object.keys(dates).some(k => !['PLUS', 'DekaMarkt'].includes(k)) ||
        typeof dates.PLUS !== 'string' || dates.PLUS.length > 16 ||
        typeof dates.DekaMarkt !== 'string' || dates.DekaMarkt.length > 16) throw Error('times')
    const rows = r.rows as Record<string, unknown>
    if (Object.keys(rows).length > 2000 || !Object.entries(rows).every(([k, rawRow]) => {
      // A portable or session draft must be bound to a REAL selected Planner
      // ingredient/store pair, not arbitrary hidden rows from another week.
      if (k.length > 500 || !allowedRows.has(k) ||
          !rawRow || typeof rawRow !== 'object' || Array.isArray(rawRow)) return false
      const row = rawRow as Record<string, unknown>
      return (row.sourceId === undefined || (typeof row.sourceId === 'string' && row.sourceId.length <= 100)) &&
        Object.keys(row).every(field => ['sourceId', 'name', 'packAmount', 'packUnit', 'priceEuros', 'packCount', 'available', 'availabilityReviewed'].includes(field)) &&
        (row.availabilityReviewed === undefined || typeof row.availabilityReviewed === 'boolean') &&
        typeof row.name === 'string' && row.name.length <= 160 &&
        typeof row.packAmount === 'string' && row.packAmount.length <= 24 &&
        typeof row.packUnit === 'string' && supportedUnits.includes(row.packUnit as Unit) &&
        typeof row.packCount === 'string' && row.packCount.length <= 8 &&
        typeof row.priceEuros === 'string' && row.priceEuros.length <= 24 &&
        typeof row.available === 'boolean'
    })) throw Error('rows')
    return { saved: true, sourceSelection: (r.sourceSelection ?? 'both') as 'both' | OfflineRetailer,
      rows: rows as Record<string, ProductDraft>,
      capturedAt: { PLUS: dates.PLUS, DekaMarkt: dates.DekaMarkt }, raw, protected: false }
  } catch {
    return { ...empty, raw, protected: true }
  }
}

type Props = {
  plan: PlannedMeal[]
  recipes: RecipeWithIngredients[]
  activeDays: string[]
  onGenerated: (json: string) => void
  onEdit: () => void
  reviewedRecaptureSeeds?: Record<string, ReviewedRecaptureSeed>
}
/**
 * UI-only source authoring: a real user's *own* entry, never an auto-captured
 * licensed catalog, attestation, retailer permission, or independent evidence.
 */
export function LocalTwoStorePriceEditor({
  plan, recipes, activeDays, onGenerated, onEdit, reviewedRecaptureSeeds = {},
}: Props) {
  const [open, setOpen] = useState(false)
  const [onlyOpenRows, setOnlyOpenRows] = useState(false)
  const [preparedOpenCaptureCopy, setPreparedOpenCaptureCopy] = useState<{ identity: string; text: string } | null>(null)
  const [pricePreviewNow, setPricePreviewNow] = useState(() => Date.now())
  const [sourceSelection, setSourceSelection] = useState<'both' | OfflineRetailer>('both')
  const [scanTarget, setScanTarget] = useState<{
    store: OfflineRetailer; ingredientId: string; fingerprint: string
  } | null>(null)
  const selectedStores = sourceSelection === 'both' ? stores : [sourceSelection]
  // Do not leave a provisional pair visible forever in a long-running tab.
  // This only updates advisory UI, never revives or admits source evidence.
  useEffect(() => {
    if (!open || sourceSelection !== 'both') return
    const refresh = () => setPricePreviewNow(Date.now())
    refresh()
    const timer = window.setInterval(refresh, 60_000)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [open, sourceSelection])

  const [rows, setRows] = useState<Record<string, ProductDraft>>({})
  const [capturedAt, setCapturedAt] = useState<Record<OfflineRetailer, string>>({ PLUS: '', DekaMarkt: '' })
  const sameTimePair = (() => {
    const plus = timestampWithOffset(capturedAt.PLUS)
    const deka = timestampWithOffset(capturedAt.DekaMarkt)
    if (!plus || !deka) return false
    const first = Date.parse(plus)
    const second = Date.parse(deka)
    return Number.isFinite(first) && Number.isFinite(second) &&
      Math.abs(first - second) <= 86_400_000 &&
      [first, second].every(time => pricePreviewNow - time >= -300_000 &&
        pricePreviewNow - time <= 604_800_000)
  })()

  const [error, setError] = useState('')
  const [output, setOutput] = useState('')
  const currentPreparedOutput = useRef(output)
  currentPreparedOutput.current = output
  const needs = useMemo(() => {
    try { return aggregatePlanIngredients(plan, recipes, activeDays) }
    catch { return [] }
  }, [plan, recipes, activeDays])
  const activeNeeds = needs.filter(item => item.label.trim() && item.query.trim())
  // Count the SAME physical ingredient needs with two complete provisional
  // price entries. No partial total or store winner may be inferred from this.
  const readyPairedDraftIds = new Set(activeNeeds.filter(need =>
    currentDraftPackMath(rows[key('PLUS', need.id)] ?? emptyDraft(need.unit), need) &&
    currentDraftPackMath(rows[key('DekaMarkt', need.id)] ?? emptyDraft(need.unit), need),
  ).map(need => need.id))
  const nextIncompletePairIndex = activeNeeds.findIndex(need =>
    !readyPairedDraftIds.has(need.id))
  const openCaptureTasks = selectedStores.flatMap(store => activeNeeds.flatMap(need => {
    const row = rows[key(store, need.id)] ?? emptyDraft(need.unit)
    const status = ownCaptureStatus(row, need)
    return status === 'priced' || status === 'unavailable'
      ? []
      : [{ store, need, status }]
  }))


  const allowedDraftRows = new Set(activeNeeds.flatMap(need => stores.map(store => key(store, need.id))))
  // Ingredient identity includes its human meaning, not just a stable ID.
  // Editing a recipe from e.g. 'rice' to 'pasta' with the same ID, quantity
  // and unit must never silently revive that rice SKU, price or stock review.
  const selectedPlanFingerprint = JSON.stringify([
    plan, activeDays, needs.map(item => [item.id, item.label, item.query, item.amount, item.unit]),
  ])
  const openCaptureIdentity = JSON.stringify([selectedPlanFingerprint, sourceSelection,
    openCaptureTasks.map(task => [task.store, task.need.id, task.need.label,
      task.need.amount, task.need.unit, task.status])])
  const latestOpenCaptureIdentity = useRef(openCaptureIdentity)
  latestOpenCaptureIdentity.current = openCaptureIdentity
  const selectableOpenCaptureText = preparedOpenCaptureCopy?.identity === openCaptureIdentity
    ? preparedOpenCaptureCopy.text : null
  // Avoid importing a draft into a different plan if it changed during File.text().
  const currentPlanFingerprint = useRef(selectedPlanFingerprint)
  currentPlanFingerprint.current = selectedPlanFingerprint
  // A camera stream belongs only to the selected physical Planner week.
  useEffect(() => setScanTarget(null), [selectedPlanFingerprint])
  const [preparedFor, setPreparedFor] = useState('')
  const [savedDraftRaw, setSavedDraftRaw] = useState<string | null>(null)
  const [draftOptIn, setDraftOptIn] = useState(false)
  const [draftFingerprint, setDraftFingerprint] = useState('')
  const [draftProtected, setDraftProtected] = useState(false)
  const [draftStatus, setDraftStatus] = useState('')

  // Explicitly opt-in to *session-only* recovery. A different planner or
  // unknown/future record can never silently be reinterpreted or replaced.
  useEffect(() => {
    const old = readPrivateDraft(selectedPlanFingerprint, allowedDraftRows)
    setRows(old.rows)
    setSourceSelection(old.sourceSelection)
    setCapturedAt(old.capturedAt)
    setDraftOptIn(old.saved)
    setDraftFingerprint(selectedPlanFingerprint)
    setDraftProtected(old.protected)
    setSavedDraftRaw(old.raw)
    if (old.saved) setDraftStatus('Je vorige privéconcept voor deze week is hersteld in deze browsertab.')
    else if (old.protected) setDraftStatus('Een eerder concept voor een andere week of versie is beschermd tegen overschrijven.')
    else setDraftStatus('')
  }, [selectedPlanFingerprint])

  useEffect(() => {
    if (!draftOptIn || draftProtected || draftFingerprint !== selectedPlanFingerprint ||
        typeof window === 'undefined') return
    try {
      const actual = window.sessionStorage.getItem(privateDraftStorageKey)
      if (actual !== savedDraftRaw) {
        setDraftProtected(true)
        setDraftStatus('Een ander of onbekend concept is bewaard; SUPA overschrijft dit niet.')
        return
      }
      const next = JSON.stringify({ schemaVersion: 1, fingerprint: selectedPlanFingerprint, rows, capturedAt, sourceSelection })
      if (new TextEncoder().encode(next).length > 256000) throw Error('oversized')
      if (next !== actual) window.sessionStorage.setItem(privateDraftStorageKey, next)
      setSavedDraftRaw(next)
      setDraftStatus('Dit concept blijft alleen in deze browsertab bewaard tot je het wist of de tab sluit.')
    } catch {
      setDraftOptIn(false)
      setDraftStatus('Kon dit privéconcept niet bewaren. Gebruik desgewenst de lokale JSON-download.')
    }
  }, [draftOptIn, draftProtected, draftFingerprint, rows, capturedAt, sourceSelection, selectedPlanFingerprint])

  function clearDraft() {
    if (typeof window !== 'undefined') {
      try {
        const actual = window.sessionStorage.getItem(privateDraftStorageKey)
        if (!draftProtected && actual === savedDraftRaw) window.sessionStorage.removeItem(privateDraftStorageKey)
      } catch { /* keep protected bytes */ }
    }
    setDraftOptIn(false)
    setDraftStatus('Concept niet langer automatisch bewaard in deze browsertab.')
    setSavedDraftRaw(null)
  }

  // Unknown versions and other-week drafts are deliberately never overwritten.
  // The user must still be able to explicitly discard a stale/private tab draft
  // without having to open developer tools or clear unrelated site storage.
  function discardProtectedDraft() {
    if (!draftProtected || typeof window === 'undefined' || !window.confirm(
      'Verwijder het beschermde prijsconcept uit deze browsertab? Dit kan invoer van een andere week of nieuwere appversie zijn. Je kunt het niet herstellen zonder eigen backup.')) return
    try {
      const current = window.sessionStorage.getItem(privateDraftStorageKey)
      if (current !== savedDraftRaw) {
        setSavedDraftRaw(current)
        setDraftStatus('Het opgeslagen concept is tussentijds veranderd. Controleer opnieuw voordat je het verwijdert.')
        return
      }
      window.sessionStorage.removeItem(privateDraftStorageKey)
      setSavedDraftRaw(null)
      setDraftProtected(false)
      setDraftOptIn(false)
      setDraftFingerprint(selectedPlanFingerprint)
      setDraftStatus('Het oude beschermde concept is gewist. Je huidige invulscherm blijft behouden.')
    } catch {
      setDraftStatus('Het beschermde concept kon niet worden gewist. Bestaande opslag blijft behouden.')
    }
  }

  function prefillReviewedSources() {
    const seeds = Object.entries(reviewedRecaptureSeeds)
    if (!seeds.length || !window.confirm(
      'Neem alleen eerder door jou gecontroleerde bronartikelen, codes en verpakkingen over? Het huidige invoerconcept wordt vervangen. Prijzen, beschikbaarheid en nieuwe opnametijden blijven leeg.')) return
    const replacements: Record<string, ProductDraft> = {}
    const included = new Set<OfflineRetailer>()
    const allowedIds = new Set(activeNeeds.map(need => need.id))
    for (const [rowKey, item] of seeds) {
      let pair: unknown
      try { pair = JSON.parse(rowKey) } catch { continue }
      if (!Array.isArray(pair) || pair.length !== 2 ||
          (pair[0] !== 'PLUS' && pair[0] !== 'DekaMarkt') ||
          typeof pair[1] !== 'string' || !allowedIds.has(pair[1])) continue
      const store = pair[0] as OfflineRetailer
      included.add(store)
      replacements[rowKey] = { ...item, priceEuros: '', available: false, availabilityReviewed: false }
    }
    if (!included.size) {
      setDraftStatus('Er zijn geen eerder persoonlijk gecontroleerde bronartikelen voor deze exacte Planner-week.')
      return
    }
    setRows(replacements)
    setCapturedAt({ PLUS: '', DekaMarkt: '' })
    setSourceSelection(included.size === 2 ? 'both' : [...included][0])
    setOpen(true)
    setOutput(''); setError(''); setPreparedFor('')
    setDraftStatus('Bronidentiteiten overgenomen als nieuw concept. Vul echte actuele prijzen en opnametijd opnieuw in.')
    onEdit()
  }

  // Re-record one store without destroying the other store’s unfinished
  // form, timestamp, receipts or user-entered details. Only previously
  // reviewed source identities are reused; prices and stock are never copied.
  function prefillReviewedStore(store: OfflineRetailer) {
    const allowedIds = new Set(activeNeeds.map(need => need.id))
    const replacements: Record<string, ProductDraft> = {}
    for (const [rowKey, item] of Object.entries(reviewedRecaptureSeeds)) {
      let pair: unknown
      try { pair = JSON.parse(rowKey) } catch { continue }
      if (!Array.isArray(pair) || pair.length !== 2 || pair[0] !== store ||
          typeof pair[1] !== 'string' || !allowedIds.has(pair[1])) continue
      replacements[rowKey] = {
        ...item, priceEuros: '', available: false, availabilityReviewed: false,
      }
    }
    if (!Object.keys(replacements).length) {
      setDraftStatus(store + ': er zijn nog geen eerder persoonlijk gecontroleerde bronartikelen beschikbaar.')
      return
    }
    if (!window.confirm(
      store + ': vervang alleen jouw conceptregels voor deze winkel door de eerder gecontroleerde ' +
      'codes en verpakkingen? De oude prijzen, voorraadstatus en opnametijd worden gewist. ' +
      'Alle ingevoerde regels van de andere winkel blijven bewaard.')) return
    setRows(prev => ({
      ...Object.fromEntries(Object.entries(prev).filter(([rowKey]) => {
        try { const pair: unknown = JSON.parse(rowKey)
          return !Array.isArray(pair) || pair[0] !== store
        } catch { return true }
      })),
      ...replacements,
    }))
    setCapturedAt(prev => ({ ...prev, [store]: '' }))
    setOutput(''); setError(''); setPreparedFor('')
    setDraftStatus(store + ': alleen eerdere gecontroleerde bronidentiteiten hergebruikt. ' +
      'Voer alle actuele prijzen, beschikbaarheid en het echte nieuwe bronmoment zelf opnieuw in.')
    onEdit()
  }

  function changeRow(store: OfflineRetailer, id: string, patch: Partial<ProductDraft>, unit: string) {
    const idKey = key(store, id)
    const prior = rows[idKey] ?? emptyDraft(unit)
    const identityFields: (keyof ProductDraft)[] = ['sourceId', 'name', 'packAmount', 'packUnit', 'packCount']
    const identityChanged = identityFields.some(field =>
      Object.prototype.hasOwnProperty.call(patch, field) && patch[field] !== prior[field])
    const hasPreviousDecision = prior.available || prior.availabilityReviewed ||
      Boolean(prior.priceEuros.trim())
    setRows(prev => {
      const current = prev[idKey] ?? emptyDraft(unit)
      const changed = identityFields.some(field =>
        Object.prototype.hasOwnProperty.call(patch, field) && patch[field] !== current[field])
      const updated = { ...current, ...patch }
      // A SKU/pack edit cannot inherit the former product's availability
      // confirmation or financial facts, even before the downstream review.
      if (changed) {
        updated.available = false
        updated.availabilityReviewed = false
        updated.priceEuros = ''
      }
      return { ...prev, [idKey]: updated }
    })
    if (identityChanged && hasPreviousDecision) {
      setDraftStatus(`${store}: na wijziging van het bronartikel of de verpakking zijn oude prijs en beschikbaarheidsbevestiging ingetrokken. Controleer het nieuwe artikel opnieuw.`)
    }
    setOutput(''); setError(''); setPreparedFor(''); onEdit()
  }
  function openCaptureTasksText(): string {
    const printable = (value: string) =>
      value.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ').trim().slice(0, 180)
    const rows = [
        'Supa · nog te verzamelen eigen winkelproducten voor dit exacte Planner-weekmenu',
        'Dit is een ongeprijsde werklijst, geen winkelbron, voorraadbevestiging of prijsbewijs.',
        'Gebruik uitsluitend eigen rechtmatig verkregen producten, echte opnamemomenten en echte pakprijzen.',
        '',
        ...openCaptureTasks.map(item => [
          '[ ] ' + item.store + ': ' + printable(item.need.label) +
            ' · nodig ' + (item.need.amount === null ? 'hoeveelheid controleren' :
              String(item.need.amount).replace('.', ',') + ' ' + item.need.unit),
          '    Nog te doen: ' + captureStatusNames[item.status] +
            (item.need.unit === 'piece' && item.need.amount === null
              ? ' · corrigeer eerst het aantal stuks in Recepten' : ''),
        ].join('\n')),
        '',
        'Na de echte winkelopname: vul SKU, naam, pakmaat, aantal, prijs, voorraad en bronmoment in Supa in.',
        'Pas na volledige originele broncontrole kan Vergelijk een mandverschil berekenen.',
      ]
    const output = rows.join('\n') + '\n'
    if (new TextEncoder().encode(output).length > 100_000)
      throw Error('De openstaande winkelcontroles passen niet in één bestand.')
    return output
  }

  function downloadOpenCaptureTasks() {
    if (!openCaptureTasks.length) return
    try {
      const output = openCaptureTasksText()
      const url = URL.createObjectURL(new Blob([output], {
        type: 'text/plain;charset=utf-8',
      }))
      try {
        const link = document.createElement('a')
        link.href = url
        link.download = 'supa-plus-deka-open-winkelproducten.txt'
        document.body.append(link)
        try { link.click() } finally { link.remove() }
        setDraftStatus('Ongeprijsde open winkelproducten lokaal gedownload. Alleen je eigen originele bronnen kunnen prijzen leveren.')
      } finally { window.setTimeout(() => URL.revokeObjectURL(url), 1000) }
    } catch {
      setDraftStatus('Kon de open winkelproducten niet downloaden. Je invoer blijft bewaard.')
    }
  }

  async function copyOpenCaptureTasks() {
    if (!openCaptureTasks.length) return
    const identity = openCaptureIdentity
    try {
      const output = openCaptureTasksText()
      if (!navigator.clipboard?.writeText) throw Error('clipboard-unavailable')
      await navigator.clipboard.writeText(output)
      if (latestOpenCaptureIdentity.current !== identity) return
      setPreparedOpenCaptureCopy(null)
      setDraftStatus('Openstaande PLUS/Deka-winkelcontroles zonder prijzen lokaal gekopieerd.')
    } catch {
      if (latestOpenCaptureIdentity.current !== identity) return
      try {
        const output = openCaptureTasksText()
        setPreparedOpenCaptureCopy({ identity, text: output })
        setDraftStatus('Automatisch kopiëren is niet beschikbaar: selecteer hieronder de ongeprijsde werklijst.')
      } catch {
        setDraftStatus('De werklijst kon niet worden gekopieerd. Je eigen concept blijft bewaard.')
      }
    }
  }

  function changeTimestamp(store: OfflineRetailer, value: string) {
    const previousTime = capturedAt[store]
    if (previousTime === value) return
    // Editing an EXISTING capture time must never re-date a previous price or
    // stock confirmation. An initially empty time may still be entered after
    // the person wrote down the original prices; that is not a recapture.
    const previousCapture = previousTime.trim().length > 0
    const hasDecisions = previousCapture && activeNeeds.some(need => {
      const row = rows[key(store, need.id)]
      return row && (row.available || row.availabilityReviewed ||
        row.priceEuros.trim().length > 0)
    })
    if (hasDecisions && !window.confirm(
      store + ': je past het bestaande opnamemoment aan. Een andere opnametijd is ' +
      'geen bewijs dat eerdere prijzen of voorraad nog kloppen. Wis daarom de ' +
      'prijzen en beschikbaarheidsbevestigingen van alleen deze winkel? ' +
      'De oorspronkelijke productcodes, namen en verpakkingen blijven behouden; ' +
      'de andere winkel verandert niet.')) return
    if (hasDecisions) {
      setRows(prev => {
        const next = { ...prev }
        for (const need of activeNeeds) {
          const rowKey = key(store, need.id)
          const row = prev[rowKey]
          if (!row) continue
          next[rowKey] = {
            ...row, priceEuros: '', available: false, availabilityReviewed: false,
          }
        }
        return next
      })
      setDraftStatus(store + ': het oude bronmoment is gewijzigd. Bestaande prijzen ' +
        'en voorraadbevestigingen voor deze winkel zijn gewist. Neem echte nieuwe ' +
        'prijzen en beschikbaarheid op; de andere winkel is bewaard.')
    }
    setCapturedAt(prev => ({ ...prev, [store]: value }))
    setOutput(''); setError(''); setPreparedFor(''); onEdit()
  }
  function createSourceFile() {
    setError(''); setOutput('')
    try {
      if (!activeNeeds.length || activeNeeds.length > 1000) {
        throw new Error('Kies eerst een weekmenu met ondersteunde ingrediënten (maximaal 1.000).')
      }
      const captureStores = selectedStores.filter(store => activeNeeds.some(need =>
        isEnteredOwnCapture(rows[key(store, need.id)] ?? emptyDraft(need.unit))))
      if (captureStores.length === 0) {
        throw new Error('Er is nog geen volledig ingevoerd bronartikel. Vul minstens één echt product bij één winkel in.')
      }
      const missingStores = selectedStores.filter(store => !captureStores.includes(store))
      const times = captureStores.map(store => timestampWithOffset(capturedAt[store]))
      if (times.some(time => time === null)) {
        throw new Error('Vul de echte Nederlandse opnametijd in. Een onbestaand of dubbel tijdstip bij de zomer-/wintertijdwissel kan niet automatisch als bronmoment worden bevestigd; importeer dan eigen JSON met expliciete juiste UTC-offset.')
      }
      if (times.some(time => Date.parse(time!) > Date.now() + 300000)) {
        throw new Error('Een waarnemingstijd ligt in de toekomst.')
      }
      // Only explicitly entered, complete local observations enter the
      // canonical source gate. Warn before omitting drafts, never discard
      // them or silently reinterpret missing data as free or out of stock.
      const incompleteRows = selectedStores.flatMap(store => activeNeeds.flatMap(need => {
        const draft = rows[key(store, need.id)] ?? emptyDraft(need.unit)
        return hasPartialOwnCapture(draft) ? [`${store} · ${need.label}`] : []
      }))
      const incompatibleRows = captureStores.flatMap(store => activeNeeds.flatMap(need => {
        const draft = rows[key(store, need.id)] ?? emptyDraft(need.unit)
        return ownCaptureStatus(draft, need) === 'incompatible'
          ? [`${store} · ${need.label} (${need.amount ?? '?'} ${need.unit})`] : []
      }))
      if ((incompleteRows.length || missingStores.length || incompatibleRows.length) && !window.confirm(
        (missingStores.length
          ? 'De volgende winkel(s) hebben nog geen complete geobserveerde productregel en worden niet als winkelbron opgeslagen: ' +
            missingStores.join(', ') + '.\nEr is dus nog GEEN volledige twee-winkelvergelijking.\n'
          : '') +
        (incompleteRows.length
          ? `${incompleteRows.length} half ingevulde artikelregel(s) worden overgeslagen:\n` +
            incompleteRows.slice(0, 10).join('\n') +
            (incompleteRows.length > 10 ? `\n… en nog ${incompleteRows.length - 10}` : '') + '\n'
          : '') +
        (incompatibleRows.length
          ? `\n${incompatibleRows.length} geprijsde bronregel(s) passen NIET fysiek bij de Planner-hoeveelheid:\n` +
            incompatibleRows.slice(0, 10).join('\n') +
            (incompatibleRows.length > 10 ? `\n… en nog ${incompatibleRows.length - 10}` : '') +
            '\nDeze originele producten mogen als eigen bron worden bewaard, maar zullen GEEN prijs-match opleveren.\n'
          : '') +
        '\nJe invoerconcept blijft behouden en ontbrekende prijzen blijven onbekend. ' +
        'Wil je de echte volledige bronregels verwerken en de genoemde problemen later corrigeren?'
      )) {
        setError('Niets verwerkt: vul ontbrekende brongegevens aan of bevestig bewust dat deze regels onbekend blijven.')
        return
      }
      const captures = captureStores.map((store, storeIndex) => {
        const products = activeNeeds.flatMap((need) => {
          const draft = rows[key(store, need.id)] ?? emptyDraft(need.unit)
          if (!isEnteredOwnCapture(draft)) return []
          if (draft.name !== draft.name.trim() || !draft.name.trim()) {
            throw new Error(`${store} · ${need.label}: vul een werkelijke, complete productnaam in.`)
          }
          const originalId = draft.sourceId ?? ''
          if (!originalId || originalId !== originalId.trim() || originalId.length > 100 ||
              !/[\p{L}\p{N}]/u.test(originalId) ||
              /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(originalId)) {
            throw new Error(`${store} · ${need.label}: vul de echte productcode uit je eigen bron in, geen verzonnen winkel-SKU.`)
          }
          const packAmount = draft.packAmount ? amountOrNull(draft.packAmount.trim()) : null
          if (draft.packAmount && packAmount === null) {
            throw new Error(`${store} · ${need.label}: ongeldige fysieke verpakking.`)
          }
          if (draft.packUnit === 'piece' && packAmount !== null &&
              !Number.isSafeInteger(packAmount)) {
            throw new Error(`${store} · ${need.label}: losse stuks op de verpakking moeten een heel aantal zijn.`)
          }
          const count = Number(draft.packCount)
          if (!/^\d{1,4}$/.test(draft.packCount) || !Number.isSafeInteger(count) || count < 1 || count > 1000) {
            throw new Error(`${store} · ${need.label}: multipack-aantal moet 1–1.000 zijn.`)
          }
          const price = draft.priceEuros ? eurosToCents(draft.priceEuros.trim()) : null
          if (draft.priceEuros && price === null) {
            throw new Error(`${store} · ${need.label}: bedrag moet een geldige, daadwerkelijk geobserveerde prijs in euro's zijn.`)
          }
          if (draft.available && (packAmount === null || price === null)) {
            throw new Error(`${store} · ${need.label}: beschikbaar vereist geobserveerde verpakking en prijs.`)
          }
          if (!draft.available && price !== null) {
            throw new Error(`${store} · ${need.label}: prijs ingevuld maar beschikbaarheid niet bevestigd.`)
          }
          if (!draft.available && !draft.availabilityReviewed) {
            throw new Error(`${store} · ${need.label}: markeer het geobserveerde artikel expliciet als niet beschikbaar, of bevestig de geobserveerde prijs. Laat een onbekend artikel helemaal leeg.`)
          }
          return [{
            id: originalId,
            name: draft.name, packAmount, packUnit: draft.packUnit,
            packCount: count, available: draft.available,
            priceCents: draft.available ? price : null,
          }]
        })
        if (products.length === 0) {
          throw new Error(`Vul bij ${store} minimaal één echt product in. Andere ingrediënten mogen onbekend blijven.`)
        }
        const unique = new Map<string, (typeof products)[number]>()
        for (const product of products) {
          const earlier = unique.get(product.id)
          if (earlier && JSON.stringify(earlier) !== JSON.stringify(product)) {
            throw new Error(`${store}: dezelfde originele productcode heeft conflicterende naam, verpakking, prijs of voorraad. Corrigeer de bronregels.`)
          }
          unique.set(product.id, product)
        }
        return { retailer: store, observedAt: times[storeIndex], products: [...unique.values()] }
      })
      const schema = captures.length === 1
        ? 'supa-private-single-store-prices-v1' : 'supa-offline-prices-v1'
      const json = JSON.stringify({ schema, captures }, null, 2)
      if (new TextEncoder().encode(json).length > 256000) {
        throw new Error('Je invoer is te groot voor de lokale import van maximaal 256 kB.')
      }
      // The edited source file must pass the exact same admission gate as an
      // uploaded file *before* we offer it as a prepared/exportable snapshot.
      parseOfflinePriceSnapshots(json, Date.now())
      setPreparedFor(selectedPlanFingerprint)
      setOutput(json)
      onGenerated(json)
    } catch (exception) {
      setPreparedFor('')
      setError(exception instanceof Error ? exception.message : 'Kon deze gegevens niet opbouwen.')
    }
  }
  const validOutput = output && selectedPlanFingerprint === preparedFor
  const exportableStores: OfflineRetailer[] = validOutput
    ? (JSON.parse(output) as { captures: { retailer: OfflineRetailer }[] })
        .captures.map(capture => capture.retailer)
    : []

  // A pocket-sized to-do from only the still-unresolved *current* Planner
  // demands. Unlike the admitted source JSON, this never states a retailer
  // price, availability or permission and cannot be fed to the price parser.
  function downloadMissingCaptureList() {
    try {
      const plain = (value: string) =>
        value.replace(/[\r\n\u2028\u2029\u0000-\u001f\u007f-\u009f]/gu, ' ').trim()
      const tasks = selectedStores.flatMap(store => activeNeeds.flatMap(need => {
        const draft = rows[key(store, need.id)] ?? emptyDraft(need.unit)
        if (isEnteredOwnCapture(draft)) return []
        return [{ store, need, draft }]
      }))
      if (!tasks.length) {
        setDraftStatus('Geen open artikelregels meer in de gekozen winkel(s). Controleer nog de bronmomenten en de persoonlijke productreviews.')
        return
      }
      const text = [
        'SUPA · nog zelf te observeren winkelproducten',
        'Dit is een privé-invulhulp, GEEN prijsopname, productgoedkeuring of bronrechtenbewijs.',
        'Laat een artikel onbekend totdat je de echte code, naam, inhoud, status en prijs hebt gecontroleerd.',
        '',
        ...selectedStores.flatMap(store => {
          const pending = tasks.filter(task => task.store === store)
          if (!pending.length) return []
          return [
            'Winkel: ' + store + ' · ' + pending.length + ' open artikel(en)',
            ...pending.flatMap(({ need, draft }, index) => [
              (index + 1) + '. [ ] ' + plain(need.label) +
                ' · gevraagd ' + (need.amount ?? '?') + ' ' + plain(need.unit),
              '    Originele broncode: ' + (draft.sourceId?.trim() ? plain(draft.sourceId) + ' [CONCEPT]' : '__________'),
              '    Productnaam: ' + (draft.name.trim() ? plain(draft.name) + ' [CONCEPT]' : '__________'),
              '    Verpakking, aantal pakken, prijs, beschikbaarheid, werkelijk bronmoment: zelf controleren.',
            ]),
            '',
          ]
        }),
        'Na je winkelbezoek: werk het bestaande persoonlijke concept bij in SUPA;',
        'de winkelvergelijking blijft onbekend tot beide mandjes werkelijk compleet en bevestigd zijn.',
      ].join('\n')
      const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }))
      try {
        const link = document.createElement('a')
        link.href = url
        link.download = 'supa-open-winkelwaarnemingen.txt'
        link.style.display = 'none'
        document.body.appendChild(link)
        link.click()
        link.remove()
        setDraftStatus(tasks.length + ' nog te controleren winkelregels als privé-TXT gedownload.')
      } finally {
        window.setTimeout(() => URL.revokeObjectURL(url), 1000)
      }
    } catch {
      setDraftStatus('De lokale lijst met open artikelregels kon niet worden gedownload.')
    }
  }

  // Portable *unfinished form*, not an admitted retailer price snapshot.
  // The two formats intentionally cannot be mistaken for one another.
  function downloadUnfinishedDraft() {
    try {
      const json = JSON.stringify({
        schemaVersion: 1, fingerprint: selectedPlanFingerprint, rows, capturedAt, sourceSelection,
      }, null, 2)
      if (new TextEncoder().encode(json).length > 256000) {
        throw Error('Dit invulconcept is groter dan 256 kB.')
      }
      const url = URL.createObjectURL(new Blob([json], { type: 'application/json;charset=utf-8' }))
      try {
        const link = document.createElement('a')
        link.href = url
        link.download = 'supa-onvoltooid-prijsconcept.json'
        link.style.display = 'none'
        document.body.appendChild(link)
        link.click()
        link.remove()
        setDraftStatus('Privéconcept gedownload. Dit is geen gevalideerde winkelprijsbron.')
      } finally {
        window.setTimeout(() => URL.revokeObjectURL(url), 1000)
      }
    } catch {
      setDraftStatus('Kon het invulconcept niet lokaal downloaden.')
    }
  }

  async function importUnfinishedDraft(file: File) {
    const fingerprint = selectedPlanFingerprint
    try {
      if (file.size > 256000) throw Error('size')
      const raw = await file.text()
      if (currentPlanFingerprint.current !== fingerprint) {
        setDraftStatus('Het weekmenu veranderde tijdens het lezen. Kies het concept opnieuw.')
        return
      }
      const restored = readPrivateDraft(fingerprint, allowedDraftRows, raw)
      if (!restored.saved) {
        setDraftStatus('Dit concept hoort niet bij dit exacte weekmenu, is te groot of heeft een onbekende indeling.')
        return
      }
      if (!window.confirm('Vervang de huidige, mogelijk onvoltooide invoer door dit lokale privéconcept? ' +
        'Oude prijzen en waarnemingstijden moeten opnieuw op actualiteit worden gecontroleerd.')) return
      // Opt-in storage is paused. Do not overwrite an existing tab draft simply
      // because a file was imported. User can deliberately enable saving later.
      setDraftOptIn(false)
      setRows(restored.rows)
      setCapturedAt(restored.capturedAt)
      setSourceSelection(restored.sourceSelection)
      setPreparedFor(''); setOutput(''); setError('')
      setDraftStatus('Onvoltooid concept lokaal geladen. Controleer prijzen en bronmomenten en bereken opnieuw.')
      onEdit()
    } catch {
      setDraftStatus('Het gekozen JSON-concept kon niet veilig worden gelezen. Bestaande invoer blijft staan.')
    }
  }

  async function downloadPreparedCsv(store?: OfflineRetailer) {
    if (!validOutput || typeof window === 'undefined') return
    const prepared = output
    const planFingerprint = selectedPlanFingerprint
    setError('')
    try {
      const csv = await ownPriceCapturesToCsv(prepared, store)
      if (prepared !== currentPreparedOutput.current ||
          planFingerprint !== currentPlanFingerprint.current) return
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
      try {
        const link = document.createElement('a')
        link.href = url
        link.download = store
          ? 'supa-mijn-geobserveerde-prijzen-' + store + '.csv'
          : 'supa-mijn-geobserveerde-winkelprijzen.csv'
        link.style.display = 'none'
        document.body.appendChild(link)
        link.click()
        link.remove()
        setDraftStatus('Eigen bronopname als CSV opgeslagen en verliesvrij opnieuw gecontroleerd.')
      } finally { window.setTimeout(() => URL.revokeObjectURL(url), 1000) }
    } catch (exception) {
      if (prepared !== currentPreparedOutput.current ||
          planFingerprint !== currentPlanFingerprint.current) return
      setError((exception instanceof Error ? exception.message : 'CSV-download mislukt.') +
        ' De JSON-kopie en je eigen concept blijven beschikbaar.')
    }
  }

  function downloadPreparedSource() {
    if (!validOutput || typeof window === 'undefined') return
    const bytes = new Blob([output], { type: 'application/json;charset=utf-8' })
    const url = URL.createObjectURL(bytes)
    try {
      const link = document.createElement('a')
      link.href = url
      link.download = 'supa-prijzen-eigen-invoer.json'
      link.style.display = 'none'
      document.body.appendChild(link)
      link.click()
      link.remove()
    } finally {
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    }
  }

  return <section className="offline-manual-editor" aria-label="Productprijzen zelf invoeren">
    <div className="offline-manual-editor__header">
      <div><h3>Geen JSON? Vul de winkels hier in</h3>
        <p>Gebruikt automatisch je gekozen weekmaaltijden. Alleen zelf daadwerkelijk geobserveerde producten en bedragen invullen.</p>
      </div>
      <button type="button" className="ghost-button" aria-expanded={open}
        onClick={() => setOpen(value => !value)}>{open ? 'Sluit invoer' : 'Open invulscherm'}</button>
    </div>
    {open && <>
      {Object.keys(reviewedRecaptureSeeds).length > 0 && (
        <div className="offline-manual-editor__draft">
          <button type="button" className="ghost-button" onClick={prefillReviewedSources}>
            Hergebruik mijn gecontroleerde bronartikelen (zonder prijzen)
          </button>
          <small>Alleen eerder persoonlijk gecontroleerde codes en verpakkingen; nieuwe prijzen, beschikbaarheid en opnametijden moet je zelf opnieuw invullen.</small>
        </div>
      )}
      <p className="disclaimer">Dit is een particuliere invoerhulp. Een zelf ingevulde tijd of prijs is geen onafhankelijk veldbewijs,
        geen bewijs van bronrechten en geen actuele publiceerbare supermarktprijs. Niets wordt naar een server gestuurd.</p>
      {activeNeeds.length === 0 ? <p role="status">Selecteer in Planner minimaal één maaltijd met ingrediënten.</p> : (
        <p role="status">{activeNeeds.length} verschillende ingrediënten uit je huidige weekmenu.
          Lege of onbekende producten blijven niet gekoppeld en krijgen nooit een nulprijs.</p>
      )}
      <div className="offline-manual-editor__draft">
        <label><input type="checkbox" checked={draftOptIn} disabled={draftProtected}
          onChange={e => { setDraftOptIn(e.target.checked); if (!e.target.checked) clearDraft() }} />
          Onvoltooide invoer bewaren in deze browsertab (optioneel, niet naar een server)
        </label>
        <span role="status">{draftStatus}</span>
        <div className="offline-manual-editor__progress-actions">
          <button type="button" className="ghost-button" onClick={downloadMissingCaptureList}>
            Download open winkelwaarnemingen (TXT)
          </button>
          <button type="button" className="ghost-button" onClick={downloadUnfinishedDraft}>
            Download onvoltooid invulconcept (JSON)
          </button>
          <label>Herstel een eigen onvoltooid invulconcept
            <input type="file" accept=".json,application/json"
              onChange={event => {
                const file = event.currentTarget.files?.[0]
                event.currentTarget.value = ''
                if (file) void importUnfinishedDraft(file)
              }} />
          </label>
        </div>
        <small>Concepten bevatten jouw eigen invoer en mogelijk oude bedragen.
          Alleen een exact gelijk weekmenu wordt geaccepteerd; import activeert
          nooit automatisch prijsvergelijking of opslag.</small>
        {draftOptIn && <button type="button" className="ghost-button" onClick={clearDraft}>
          Stop automatisch bewaren en wis concept
        </button>}
        {draftProtected && <button type="button" className="ghost-button"
          onClick={discardProtectedDraft}>
          Verwijder beschermd concept na bevestiging
        </button>}
      </div>
      <label>Welke winkel(s) heb je daadwerkelijk geobserveerd?
        <select value={sourceSelection} onChange={event => {
          setScanTarget(null)
          setSourceSelection(event.currentTarget.value as 'both' | OfflineRetailer)
          setOutput(''); setError(''); setPreparedFor(''); onEdit()
        }}>
          <option value="PLUS">Alleen PLUS</option>
          <option value="DekaMarkt">Alleen DekaMarkt</option>
          <option value="both">PLUS en DekaMarkt (twee echte opnames)</option>
        </select>
      </label>
      <p className="disclaimer">Voer alleen winkels in die je werkelijk hebt waargenomen. De andere winkel blijft onbekend; je kunt zijn aparte bronopname later toevoegen.</p>
      {sourceSelection === 'both' && activeNeeds.length > 0 && (
        <section className="offline-manual-editor__pair-matrix" aria-label="PLUS en DekaMarkt per ingrediënt">
          <h4>Hetzelfde weekmandje · voortgang per winkel</h4>
          <p>Dezelfde Planner-behoefte staat bij beide winkels. Invoer is nog geen
            bevestigde SKU, actuele winkelprijs of vergelijkbaar volledig mandje.</p>
          <div className="offline-manual-editor__pair-coverage" role="status">
            <strong>{readyPairedDraftIds.size} van {activeNeeds.length} fysieke ingrediënten
              hebben een ingevuld, rekenbaar PLUS- én DekaMarkt-concept.</strong>
            <progress value={readyPairedDraftIds.size} max={activeNeeds.length}
              aria-label="Dekgraad voorlopig prijsconcept bij beide winkels" />
            <small>{sameTimePair
              ? 'Beide originele bronmomenten zijn voorlopig binnen 24 uur en maximaal zeven dagen oud.'
              : 'Prijsverschillen blijven verborgen tot beide echte winkelmomenten geldig en maximaal 24 uur uit elkaar zijn.'}
              {' '}Dit is geen bevestigde match en geen volledig mandtotaal.</small>
            {openCaptureTasks.length > 0 && <button type="button" className="ghost-button"
              onClick={downloadOpenCaptureTasks}>
              Download {openCaptureTasks.length} openstaande winkelcontroles (zonder prijzen)
            </button>}
            {openCaptureTasks.length > 0 && <button type="button" className="ghost-button"
              onClick={() => void copyOpenCaptureTasks()}>
              Kopieer mijn openstaande winkelcontroles (mobiel)
            </button>}
            {selectableOpenCaptureText !== null && <label>
              Selecteer mijn privéwerklijst voor de winkel
              <textarea readOnly value={selectableOpenCaptureText}
                rows={Math.min(openCaptureTasks.length * 2 + 5, 12)}
                onFocus={event => event.currentTarget.select()}
                aria-label="Kopieer openstaande persoonlijke winkelcontroles zonder prijzen" />
            </label>}
            {nextIncompletePairIndex >= 0 && <button type="button" className="ghost-button"
              onClick={() => {
                const need = activeNeeds[nextIncompletePairIndex]
                const plusReady = currentDraftPackMath(
                  rows[key('PLUS', need.id)] ?? emptyDraft(need.unit), need)
                const store = plusReady ? 'DekaMarkt' : 'PLUS'
                setOnlyOpenRows(false)
                window.requestAnimationFrame(() => {
                  const field = document.getElementById(`own-price-${store}-${nextIncompletePairIndex}`)
                  field?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                  field?.querySelector('input')?.focus({ preventScroll: true })
                })
              }}>Vul volgend ontbrekend winkelproduct aan</button>}
            {readyPairedDraftIds.size === activeNeeds.length && !sameTimePair &&
              <small>Alle conceptregels zijn ingevuld, maar kijk eerst de echte
                opnamemomenten na; anders zijn de winkelprijzen niet vergelijkbaar.</small>}
          </div>
          {activeNeeds.map((need, index) => <div key={need.id}
            className="offline-manual-editor__pair-row">
            <strong>{need.label} <small>· {need.amount ?? '?'} {need.unit}</small></strong>
            <div className="offline-manual-editor__pair-stores">
              {stores.map(store => {
                const state = ownCaptureStatus(rows[key(store, need.id)] ?? emptyDraft(need.unit), need)
                return <button key={store} type="button" className="ghost-button"
                  data-capture-status={state}
                  onClick={() => {
                    setOnlyOpenRows(false)
                    window.requestAnimationFrame(() => {
                      const field = document.getElementById(`own-price-${store}-${index}`)
                      field?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                      field?.querySelector('input')?.focus({ preventScroll: true })
                    })
                  }}>
                  <span>{store}</span><small>{captureStatusNames[state]}</small>
                </button>
              })}
            </div>
            {sameTimePair && (() => {
              const plus = currentDraftPackMath(
                rows[key('PLUS', need.id)] ?? emptyDraft(need.unit), need)
              const deka = currentDraftPackMath(
                rows[key('DekaMarkt', need.id)] ?? emptyDraft(need.unit), need)
              if (!plus || !deka) return null
              const difference = deka.lineTotalCents - plus.lineTotalCents
              if (!Number.isSafeInteger(difference)) return null
              return <div className="offline-manual-editor__pair-provisional" role="note">
                <small>Alleen voorlopig, uit je twee handmatig ingevoerde concepten</small>
                <span>PLUS {plus.packagesNeeded} × pak: <strong>{exactEuro.formatCents(plus.lineTotalCents)}</strong>
                  {' · '}DekaMarkt {deka.packagesNeeded} × pak:
                  {' '}<strong>{exactEuro.formatCents(deka.lineTotalCents)}</strong></span>
                <small>Indicatieve eenheidsprijzen vanuit je invoer:
                  {' '}PLUS {plus.unitRate ?? 'onbekend'} ·
                  {' '}DekaMarkt {deka.unitRate ?? 'onbekend'}.</small>
                <strong>{difference === 0 ? 'Gelijke voorlopige regelprijs' :
                  exactEuro.formatCents(Math.abs(difference)) +
                  ' op deze ene regel lager bij ' + (difference > 0 ? 'PLUS' : 'DekaMarkt')}</strong>
                <small>Geen volledig mandtotaal of besparing. Eerst originele SKU,
                  productequivalentie en actuele eigen prijzen bevestigen in Vergelijk.</small>
              </div>
            })()}
          </div>)}
          <p className="disclaimer">Alleen jouw lokale concepten. De echte vergelijking volgt
            pas na beide volledige bronopnames, menselijke reviews en tijd-/prijscontroles.</p>
        </section>
      )}
      {sourceSelection === 'both' && capturedAt.PLUS && capturedAt.DekaMarkt && (() => {
        const plus = timestampWithOffset(capturedAt.PLUS)
        const deka = timestampWithOffset(capturedAt.DekaMarkt)
        const gap = plus && deka ? Math.abs(Date.parse(plus) - Date.parse(deka)) : null
        return gap !== null && gap > 86400000 ? <p role="alert" className="attention-card">
          PLUS en DekaMarkt zijn meer dan 24 uur na elkaar geobserveerd.
          Je eigen opnames kun je afzonderlijk bewaren, maar nog geen volledig
          vergelijkbaar prijsverschil tonen. Vernieuw de oudere echte winkelopname.
        </p> : null
      })()}
      <div className="offline-manual-editor__stores">
        {selectedStores.map(store => <section key={store} aria-label={`Productprijzen bij ${store}`}>
          <h4>{store}</h4>
          <p className="disclaimer">Suggesties voor productnamen komen alleen uit historische, prijsloze bronwaarnemingen
            van 4 oktober 2026. Controleer zelf of het product vandaag echt bestaat; er wordt nooit een
            prijs, verpakking of beschikbaarheid uit dit archief automatisch overgenomen.</p>
          {Object.keys(reviewedRecaptureSeeds).some(rawKey => {
            try {
              const pair: unknown = JSON.parse(rawKey)
              return Array.isArray(pair) && pair.length === 2 && pair[0] === store &&
                activeNeeds.some(need => need.id === pair[1])
            } catch { return false }
          }) && <button type="button" className="ghost-button"
            onClick={() => prefillReviewedStore(store)}>
            Hergebruik mijn gecontroleerde {store}-artikelen · alleen deze winkel, zonder prijzen
          </button>}
          <datalist id={`historical-products-${store}`}>
            {historicalRetailerProducts.filter(item => item.store === store).map(item => (
              <option key={item.id} value={item.name} label={`Historisch: ${item.pack}`} />
            ))}
          </datalist>
          <label className="offline-manual-editor__time">Wanneer zijn deze producten echt waargenomen? (Nederlandse tijd)
            <input type="datetime-local" value={capturedAt[store]} onChange={e => changeTimestamp(store, e.target.value)} />
            <small role="status">{captureTimeAdvice(capturedAt[store])}</small>
          </label>
          {(() => {
            const completed = activeNeeds.filter(need => isEnteredOwnCapture(
              rows[key(store, need.id)] ?? emptyDraft(need.unit))).length
            const unavailable = activeNeeds.filter(need => isReviewedUnavailableDraft(
              rows[key(store, need.id)] ?? emptyDraft(need.unit))).length
            const next = activeNeeds.findIndex(need => !isEnteredOwnCapture(
              rows[key(store, need.id)] ?? emptyDraft(need.unit)))
            return <div className="offline-manual-editor__progress" role="status">
              <strong>{completed} van {activeNeeds.length} bronregels vastgelegd</strong>
              <small>{completed - unavailable} met ingevoerde prijs · {unavailable} expliciet niet beschikbaar · {activeNeeds.length - completed} open</small>
              <small>Eigen invoer; bronmatching, actualiteit en persoonlijke prijsreview volgen nog.</small>
              <div className="offline-manual-editor__progress-actions">
                <button type="button" className="ghost-button" disabled={next < 0}
                  onClick={() => {
                    const target = document.getElementById(`own-price-${store}-${next}`)
                    target?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                    target?.querySelector('input')?.focus({ preventScroll: true })
                  }}>Naar volgende open ingrediënt</button>
                <button type="button" className="ghost-button" aria-pressed={onlyOpenRows}
                  onClick={() => setOnlyOpenRows(value => !value)}>
                  {onlyOpenRows ? 'Toon alle producten' : 'Toon alleen open producten'}
                </button>
              </div>
            </div>
          })()}
          {onlyOpenRows && activeNeeds.length > 0 && activeNeeds.every(need => isEnteredOwnCapture(
            rows[key(store, need.id)] ?? emptyDraft(need.unit))) &&
            <p role="status">Alle regels voor {store} zijn ingevuld. Toon alle producten om ze na te kijken.</p>}
          {activeNeeds.map((need, index) => {
            const row = rows[key(store, need.id)] ?? emptyDraft(need.unit)
            const unavailable = isReviewedUnavailableDraft(row)
            const complete = isEnteredOwnCapture(row)
            if (onlyOpenRows && complete) return null
            return <fieldset key={need.id} id={`own-price-${store}-${index}`} className="offline-manual-editor__row">
              <legend>{need.label} · benodigd {need.amount ?? '?'} {need.unit}
                <small className="offline-manual-editor__row-status">
                  {unavailable ? ' · gecontroleerd niet beschikbaar, geen prijs'
                    : complete ? ' · prijs ingevuld, nog niet bevestigd' : ' · invoer onvolledig'}
                </small>
              </legend>
              <label>Originele productcode uit jouw waarneming (EAN of artikelnummer)
                <input value={row.sourceId ?? ''} maxLength={100} autoComplete="off"
                  placeholder="Code op verpakking, bon of bronartikel"
                  onChange={e => changeRow(store, need.id, { sourceId: e.target.value }, need.unit)} />
              </label>
              <button type="button" className="ghost-button"
                aria-expanded={scanTarget?.store === store && scanTarget.ingredientId === need.id}
                onClick={() => setScanTarget({
                  store, ingredientId: need.id, fingerprint: selectedPlanFingerprint,
                })}>
                Scan barcode van echte verpakking (optioneel)
              </button>
              {scanTarget?.store === store && scanTarget.ingredientId === need.id &&
                scanTarget.fingerprint === selectedPlanFingerprint &&
                <Suspense fallback={<p role="status">Lokale scanner laden…</p>}>
                  <LocalDeviceBarcodeScanner
                    onAccept={code => {
                      if (currentPlanFingerprint.current !== scanTarget.fingerprint ||
                          !allowedDraftRows.has(key(store, need.id))) {
                        setScanTarget(null)
                        return
                      }
                      changeRow(store, need.id, { sourceId: code }, need.unit)
                      setDraftStatus('Barcode als eigen broncode ingevuld. Controleer dat de code op je ' +
                        store + '-product of bon hoort. Prijs, verpakking, voorraadstatus en opnamemoment ' +
                        'moet je nog zelf vastleggen; er is geen automatische winkelmatch.')
                      setScanTarget(null)
                      // After accepting the original barcode, continue with
                      // the still-required name, actual pack, price and time.
                      // Never auto-mark the scanned product as reviewed.
                      window.requestAnimationFrame(() =>
                        document.getElementById(`own-price-name-${store}-${index}`)
                          ?.focus({ preventScroll: false }))
                    }}
                    onClose={() => setScanTarget(null)} />
                </Suspense>}
              <label>Werkelijke productnaam (laat leeg als onbekend)
                <input id={`own-price-name-${store}-${index}`}
                  value={row.name} maxLength={160} autoComplete="off"
                  list={`historical-products-${store}`}
                  placeholder="Naam op product of bon"
                  onChange={e => changeRow(store, need.id, { name: e.target.value }, need.unit)} />
              </label>
              <div className="offline-manual-editor__quantities">
                <label>Inhoud per verpakking
                  <input type="text" inputMode="decimal" placeholder="Bijv. 500" value={row.packAmount}
                    onChange={e => changeRow(store, need.id, { packAmount: e.target.value }, need.unit)} />
                </label>
                <label>Eenheid
                  <select value={row.packUnit} onChange={e => changeRow(store, need.id, { packUnit: e.target.value as Unit }, need.unit)}>
                    {supportedUnits.map(unit => <option key={unit} value={unit}>{unit === 'piece' ? 'stuk' : unit}</option>)}
                  </select>
                </label>
                <label>Stuks per multipack
                  <input inputMode="numeric" type="number" min="1" max="1000" value={row.packCount}
                    onChange={e => changeRow(store, need.id, { packCount: e.target.value }, need.unit)} />
                </label>
              </div>
              <label>Geobserveerde prijs voor één verpakking (€)
                <input type="text" inputMode="decimal" placeholder="Bijv. 2,49 (0,00 alleen als echt geobserveerd)" value={row.priceEuros}
                  onChange={e => changeRow(store, need.id, { priceEuros: e.target.value }, need.unit)} />
              </label>
              <label className="offline-manual-editor__available">
                <input type="checkbox" checked={row.available} onChange={e => changeRow(store, need.id,
                  { available: e.target.checked, availabilityReviewed: e.target.checked }, need.unit)} />
                Beschikbaar en prijs zelf gecontroleerd
              </label>
              <label className="offline-manual-editor__available">
                <input type="checkbox" checked={!row.available && row.availabilityReviewed === true}
                  onChange={e => changeRow(store, need.id, {
                    available: false, availabilityReviewed: e.target.checked,
                    priceEuros: e.target.checked ? '' : row.priceEuros,
                  }, need.unit)} />
                Zelf gecontroleerd niet beschikbaar (geen prijs; aangevinkte status wist een ingevoerde prijs)
              </label>
              {currentDraftPackPreview(row, need) && (
                <p className="offline-manual-editor__pack-preview">
                  <strong>Verpakkingsberekening uit jouw concept</strong><br />
                  {currentDraftPackPreview(row, need)}
                  <small>Alleen rekenhulp: originele SKU, prijs en beschikbaarheid
                    worden pas in de volgende stap persoonlijk beoordeeld.</small>
                </p>
              )}
            </fieldset>
          })}
        </section>)}
      </div>
      <div className="offline-price-workbench__actions">
        <button type="button" onClick={createSourceFile}>Bereken met mijn ingevoerde prijzen</button>
        <button type="button" className="ghost-button" onClick={() => {
          setRows({}); setCapturedAt({ PLUS: '', DekaMarkt: '' })
          setOutput(''); setError(''); setPreparedFor(''); onEdit()
        }}>Wis het invulscherm</button>
      </div>
      {error && <p role="alert" className="attention-card">{error}</p>}
      {validOutput && <details className="offline-manual-editor__export">
        <summary>Maak een lokale kopie van jouw prijsinvoer</summary>
        <p>Je gegevens blijven uitsluitend op dit apparaat. Download de JSON zodat je je invoer later opnieuw kunt importeren.</p>
        <button type="button" className="ghost-button" onClick={downloadPreparedSource}>
          Bewaar mijn invoer als JSON
        </button>
        <button type="button" className="ghost-button" onClick={() => void downloadPreparedCsv()}>
          Bewaar mijn prijsopname als herimporteerbare CSV
        </button>
        {exportableStores.length === 2 && exportableStores.map(store => (
          <button type="button" className="ghost-button" key={store}
            onClick={() => void downloadPreparedCsv(store)}>
            Bewaar alleen {store} als aparte bron-CSV
          </button>
        ))}
        <small>Dezelfde negen bronkolommen als in Supa's bestaande CSV-import.
          Een afwijkende of onveilige waarde wordt niet stilzwijgend aangepast; JSON blijft beschikbaar.</small>
        <textarea readOnly rows={6} value={output} aria-label="Zelf ingevoerde prijsdata als JSON"
          onFocus={e => e.currentTarget.select()} />
      </details>}
    </>}
  </section>
}
