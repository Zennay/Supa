/**
 * Human-entered metric shopping list -> canonical, UNPRICED private basket.
 * No source URL, retailer calls, automatic SKU assignment or storage writes.
 * A complete invalid paste is rejected atomically before notifying the wizard.
 */
import { sumDecimalDemandUnits } from './domain/decimalPackArithmetic.ts'
import type { MatchUnit } from './domain/matching.ts'

type MetricUnit = MatchUnit
type ParsedRow = { label: string; amount: number | null; unit: MetricUnit }
type DemandLine = ParsedRow & {
  id: string
  productIds: { PLUS: null; DekaMarkt: null }
}

const textArea = document.querySelector<HTMLTextAreaElement>('#quick-demand-text')!
const importButton = document.querySelector<HTMLButtonElement>('#quick-demand-import')!
const fileInput = document.querySelector<HTMLInputElement>('#quick-demand-file')!
const status = document.querySelector<HTMLElement>('#quick-demand-status')!
const mealsInput = document.querySelector<HTMLInputElement>('#meal-count')!
const existingLines = document.querySelector<HTMLElement>('#lines')!
const maxChars = 40000
const maxRows = 200
const units: Record<string, MetricUnit> = {
  g: 'g', gram: 'g', kg: 'kg', ml: 'ml', l: 'l',
  stuk: 'piece', stuks: 'piece', stukken: 'piece', 'stuk(s)': 'piece', piece: 'piece',
}
const quantity = '(\\d{1,7}(?:[.,]\\d{1,6})?)'
const unit = '(kg|gram|g|ml|l|stukken|stuks|stuk\\(s\\)|stuk)'
const leading = new RegExp('^' + quantity + '\\s*' + unit + '\\s+(.+)$', 'iu')
const trailing = new RegExp('^(.+?)\\s*[:;–—-]\\s*' + quantity + '\\s*' + unit + '$', 'iu')
const unknown = /^(.+?)\s*:\s*\?\s*(kg|g|ml|l|piece)$/iu
const allowedLabel = (label: string) => label.length > 0 && label.length <= 160 &&
  label === label.trim() && /[\p{L}\p{N}]/u.test(label) &&
  !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(label) &&
  !/^[=+@-]/u.test(label)
const family = (value: MetricUnit) => value === 'g' || value === 'kg'
  ? 'mass' : value === 'ml' || value === 'l' ? 'volume' : 'piece'

function parseLine(rawLine: string, lineNumber: number): ParsedRow {
  const value = rawLine.trim().replace(/^[•*]\s+/, '')
  const pending = unknown.exec(value)
  if (pending) {
    const label = pending[1].trim()
    if (!allowedLabel(label)) throw Error('Regel ' + lineNumber + ': onveilige ingrediëntnaam.')
    return { label, amount: null, unit: units[pending[2].toLocaleLowerCase('nl-NL')] }
  }
  const first = leading.exec(value)
  const last = first ? null : trailing.exec(value)
  if (!first && !last) {
    throw Error('Regel ' + lineNumber + ': schrijf bijvoorbeeld "450 g basmati rijst" of "basmati rijst: 450 g".')
  }
  const rawAmount = first ? first[1] : last![2]
  const rawUnit = (first ? first[2] : last![3]).toLocaleLowerCase('nl-NL')
  const label = (first ? first[3] : last![1]).trim()
  if (!allowedLabel(label)) throw Error('Regel ' + lineNumber + ': ongeldige of onveilige ingrediëntnaam.')
  // In a Dutch shopping list "1.000 g" often means one thousand grams,
  // while JS would silently interpret it as ONE gram. Abstain on that
  // ambiguous punctuation; require "1000 g", "1 kg" or an explicit
  // decimal comma instead of silently underbuying.
  if (/^[1-9]\d{0,2}\.\d{3}$/.test(rawAmount)) {
    throw Error('Regel ' + lineNumber + ': punt als duizendtalseparator is dubbelzinnig. ' +
      'Gebruik 1000 g, 1 kg of een decimale komma, zodat de hoeveelheid niet verkeerd wordt gelezen.')
  }
  const amount = Number(rawAmount.replace(',', '.'))
  const parsedUnit = units[rawUnit]
  if (!parsedUnit || !Number.isFinite(amount) || amount <= 0 || amount > 100000 ||
    (parsedUnit === 'piece' && !Number.isSafeInteger(amount))) {
    throw Error('Regel ' + lineNumber + ': hoeveelheid of fysieke stuks moeten worden gecontroleerd.')
  }
  return { label, amount, unit: parsedUnit }
}

/** Combine only human-identical ingredient labels, never infer equivalent products. */
export function readQuickMetricDemand(text: string, selectedMealCount: number) {
  if (text.length > maxChars) throw Error('Je plaklijst is te lang; maximaal 40.000 tekens.')
  if (!Number.isSafeInteger(selectedMealCount) || selectedMealCount < 1 ||
      selectedMealCount > 1000) throw Error('Kies eerst een geldig aantal maaltijden van 1 tot 1000.')
  let rawLines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter(line => line.trim())
  let meals = selectedMealCount
  // Reopen the existing plain-text Supa shopping checklist as editable,
  // unpriced demand. Headers/checkbox state are not product prices or SKUs.
  if (rawLines[0] === 'SUPA · eigen ongeprijsde ingrediëntenlijst') {
    const savedMeals = /^Geselecteerde maaltijden: ([1-9]\d{0,3})$/.exec(rawLines[2] ?? '')
    if (rawLines.length < 6 ||
        !rawLines[1]?.startsWith('Aangemaakt op: ') ||
        !savedMeals || Number(savedMeals[1]) > 1000 ||
        rawLines[3] !== 'Geen winkelprijzen, automatische productmatching of besparingsclaim.' ||
        rawLines.at(-1) !== 'Gebruik jouw eigen feitelijke verpakkingsinformatie bij het winkelen.') {
      throw Error('Het eigen Supa TXT-overzicht is incompleet of heeft onbekende velden.')
    }
    meals = Number(savedMeals[1])
    rawLines = rawLines.slice(4, -1).map((row, index) => {
      if (!/^\[[ x]\] /.test(row)) {
        throw Error('De originele Supa TXT-regel ' + (index + 1) + ' is niet herkenbaar.')
      }
      const body = row.slice(4)
      const separator = body.lastIndexOf(' · ')
      if (separator <= 0) throw Error('Onbekende hoeveelheid in de originele Supa TXT-lijst.')
      const label = body.slice(0, separator)
      const amount = body.slice(separator + 3)
      if (amount === 'hoeveelheid nog controleren') {
        throw Error('Deze oude lijst mist de eenheid bij ' + label + '. Vul die zelf in; Supa verzint geen fysieke maat.')
      }
      const pending = /^hoeveelheid nog controleren \((g|kg|ml|l|piece)\)$/.exec(amount)
      return pending ? label + ': ? ' + pending[1] : label + ': ' + amount
    })
  }
  // Portable own-recipe TXT from the Recepten detail uses exactly one
  // preparation. The embedded portion count is physical servings, NOT a
  // number of selected meals. Checked boxes never imply a retailer purchase
  // and are deliberately not omitted from full same-demand comparisons.
  if (rawLines[0]?.startsWith('Mijn recept: ')) {
    const heading = /^Mijn recept: (.+) — ([1-9]\d?|100) porties$/u.exec(rawLines[0])
    if (!heading || rawLines.length < 4 ||
        rawLines[1] !== 'Eigen ongeprijsde boodschappenlijst · controleer hoeveelheden en verpakking zelf.' ||
        rawLines.at(-1) !== 'Prijzen, winkelvoorraad en besparingen zijn onbekend.') {
      throw Error('Deze eigen receptenlijst is incompleet of heeft onbekende velden.')
    }
    meals = 1
    rawLines = rawLines.slice(2, -1).map((line, index) => {
      if (/^\[\?\] /u.test(line)) {
        throw Error('Receptregel ' + (index + 1) + ': onzekere hoeveelheid. Corrigeer die in Recepten voordat je vergelijkt.')
      }
      if (!/^\[[ x]\] /u.test(line)) {
        throw Error('Receptregel ' + (index + 1) + ': verwacht een eigen [ ] of [x] ingrediëntregel.')
      }
      return line.slice(4)
    })
  }
  if (!rawLines.length || rawLines.length > maxRows) {
    throw Error('Plak 1 tot 200 ingrediëntregels met een metrische hoeveelheid.')
  }
  const rows: ParsedRow[] = []
  const keys = new Map<string, number>()
  for (let i = 0; i < rawLines.length; i++) {
    const item = parseLine(rawLines[i], i + 1)
    const key = item.label.normalize('NFC').toLocaleLowerCase('nl-NL')
    const position = keys.get(key)
    if (position === undefined) {
      keys.set(key, rows.length)
      rows.push(item)
      continue
    }
    const previous = rows[position]
    if (family(previous.unit) !== family(item.unit)) {
      throw Error('Regel ' + (i + 1) + ': dezelfde naam heeft verschillende maateenheden; controleer de ingrediënten.')
    }
    if (previous.amount === null || item.amount === null) {
      throw Error('Regel ' + (i + 1) + ': herhaald ingrediënt met onbekende hoeveelheid; eerst handmatig controleren.')
    }
    const baseUnit: MetricUnit = family(previous.unit) === 'mass' ? 'g'
      : family(previous.unit) === 'volume' ? 'ml' : 'piece'
    const sum = sumDecimalDemandUnits(
      [{ amount: previous.amount, unit: previous.unit }, { amount: item.amount, unit: item.unit }],
      baseUnit,
    )
    if (sum === null || sum <= 0 || sum > 100000 ||
        (baseUnit === 'piece' && !Number.isSafeInteger(sum))) {
      throw Error('Regel ' + (i + 1) + ': hoeveelheid kan niet zonder afronding worden samengevoegd.')
    }
    rows[position] = { label: previous.label, amount: sum, unit: baseUnit }
  }
  if (rows.length > maxRows) throw Error('Meer dan 200 verschillende ingrediënten.')
  const ingredients: DemandLine[] = rows.map((item, index) => ({
    ...item, id: 'plaklijst-' + (index + 1),
    productIds: { PLUS: null, DekaMarkt: null },
  }))
  return { schema: 'supa-private-basket-demand-v1' as const, selectedMealCount: meals, ingredients }
}

// Optional opt-in source from Supa's own exported TXT (or an ordinary
// plaintext list). Reading the file NEVER changes the admitted basket.
// Conversion happens only after a second explicit import button press.
let fileRevision = 0
fileInput.addEventListener('change', async () => {
  const file = fileInput.files?.[0]
  const attempt = ++fileRevision
  if (!file) return
  try {
    if (!file.size || file.size > 128000) {
      throw Error('Kies een eigen UTF-8 tekstlijst van maximaal 128 KB.')
    }
    const input = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer())
    if (attempt !== fileRevision) return
    if (input.length > maxChars) throw Error('De tekst bevat meer dan 40.000 tekens.')
    textArea.value = input
    status.textContent = 'Eigen lokale tekstlijst ingelezen als concept. Controleer de regels en kies Maak van deze lijst een privémandje; je huidige geaccepteerde mand en winkelprijzen zijn nog ongewijzigd.'
    status.className = 'notice'
  } catch (error) {
    if (attempt !== fileRevision) return
    status.textContent = error instanceof Error ? error.message : 'Ongeldig tekstbestand. Huidige mand is bewaard.'
    status.className = 'notice error'
  } finally {
    if (attempt === fileRevision) fileInput.value = ''
  }
})

importButton.addEventListener('click', () => {
  try {
    const count = Number(mealsInput.value)
    if (!/^[1-9]\d*$/.test(mealsInput.value)) {
      throw Error('Vul eerst bij het aantal maaltijden een geheel getal van 1 tot 1000 in.')
    }
    // Parse the entire text BEFORE replacing any existing physical demand or
    // discarding SKU choices, shopping checks and previous financial output.
    const demand = readQuickMetricDemand(textArea.value, count)
    if (existingLines.children.length && !window.confirm(
      'Vervang je huidige ingrediëntbehoefte door ' + demand.ingredients.length +
      ' regels uit de plaklijst? Alle eerder handmatig gekozen winkel-SKU’s en afvinkstatus ' +
      'voor dat mandje moeten opnieuw worden bevestigd. Eigen winkelbronprijzen blijven onaangeroerd.'
    )) return
    document.dispatchEvent(new CustomEvent('supa:private-planner-demand', { detail: demand }))
    status.textContent = demand.ingredients.length + ' fysieke, metrische ingrediënten ingevoerd voor ' +
      demand.selectedMealCount + ' maaltijd(en). Gelijke namen zijn exact samengevoegd; winkelproducten en prijzen ' +
      'blijven onbekend totdat je jouw echt waargenomen SKU’s zelf koppelt.'
    status.className = 'notice'
  } catch (error) {
    status.textContent = error instanceof Error ? error.message :
      'De ingrediënten konden niet veilig worden ingelezen. De vorige mand blijft ongewijzigd.'
    status.className = 'notice error'
  }
})
