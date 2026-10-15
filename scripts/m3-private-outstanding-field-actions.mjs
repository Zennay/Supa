import { readPrivateM3ActionDraft } from './m3-private-field-actions-input.mjs'
import { pathToFileURL } from 'node:url'

import {
  buildObservationSheet,
  observationLineCollectionComplete,
  observationSheetReadiness,
  observationWindowSummary,
  restoreObservationSheetDraft,
} from '../src/domain/m3ObservationSheet.ts'

/**
 * A read-only shopping-field to-do list for the exact canonical M3 demand.
 * Never echo free-form participant/store/product values, prices, evidence
 * identifiers, source URLs or timestamp strings from a private field draft.
 *
 * This is an operator aide, NOT independent proof of a genuine store visit.
 */
// Canonical static product-field hints. Raw product names, prices and notes
// must never reach an operator JSON/TXT report.
const MISSING_PRODUCT_FIELD_LABELS = {
  availability: 'Beschikbaarheid',
  productName: 'Productnaam',
  packAmount: 'Verpakkingshoeveelheid',
  packUnit: 'Verpakkingseenheid',
  packCount: 'Aantal per verpakking',
  priceCents: 'Prijs per verpakking',
}
const M3_VISIBLE_TEXT = /[^\p{M}\p{Cf}\p{Cc}\p{Cs}\s\u115F\u1160\u3164\uFFA0\u2800]/u

function missingObservedProductFields(product) {
  if (product.available !== true) {
    return product.available === false ? [] : ['availability']
  }
  const missing = []
  if (typeof product.productName !== 'string' ||
      !M3_VISIBLE_TEXT.test(product.productName)) missing.push('productName')
  if (product.packAmount === null || !Number.isFinite(product.packAmount) ||
      product.packAmount <= 0) missing.push('packAmount')
  if (product.packUnit === null || product.packUnit === 'unknown') missing.push('packUnit')
  if (!Number.isSafeInteger(product.packCount) || product.packCount < 1) missing.push('packCount')
  if (!Number.isSafeInteger(product.priceCents) || product.priceCents < 0) {
    missing.push('priceCents')
  }
  return missing
}

/**
 * The shared draft restorer deliberately repairs invalid UI fields for old
 * browser state. The local human-evidence operator tool must not quietly
 * report a repaired source as an original measurement. In particular a fake
 * collection source or a nonpositive/invalid packCount must never become a
 * clean 11+11 progress signal through a permissive default.
 *
 * This preflight reads parsed JSON only (no user-controlled JS getters), and
 * never returns any untrusted source fields or values.
 */
function assertUnrepairedObservedFacts(serialized) {
  let raw
  try {
    raw = JSON.parse(serialized)
  } catch {
    throw new Error('private M3 draft is not canonical JSON')
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('private M3 draft has invalid root')
  }
  const unavailableDetails = { baseline: 0, candidate: 0 }
  for (const side of ['baseline', 'candidate']) {
    const store = raw[side]
    if (!store || typeof store !== 'object' || Array.isArray(store) ||
        !['manual-cart', 'receipt', 'consented-export'].includes(store.source) ||
        !Array.isArray(store.lines) || store.lines.length !== 11) {
      throw new Error('private M3 draft has invalid observation source')
    }
    for (const line of store.lines) {
      const product = line && typeof line === 'object' && !Array.isArray(line)
        ? line.observedProduct : null
      if (!product || typeof product !== 'object' || Array.isArray(product)) {
        throw new Error('private M3 draft has invalid observed product')
      }
      if (product.available === true &&
          (!Number.isSafeInteger(product.packCount) || product.packCount < 1)) {
        throw new Error('private M3 draft has invalid observed pack count')
      }
      // The browser sometimes restores stale product details when availability
      // changes to false. Keep the explicit unavailability (as canonical UI
      // restoration does), but make the inconsistency visible for a human check.
      // This cannot make the draft private-review-ready, and emits no raw facts.
      if (product.available === false &&
          ((typeof product.productName === 'string' && product.productName.trim() !== '') ||
           (typeof product.productId === 'string' && product.productId.trim() !== '') ||
           (product.packAmount !== null && product.packAmount !== undefined) ||
           (product.packUnit !== null && product.packUnit !== undefined) ||
           (product.priceCents !== null && product.priceCents !== undefined))) {
        unavailableDetails[side] += 1
      }
    }
  }
  return unavailableDetails
}

export function buildM3OutstandingFieldActions(serialized, referenceNowMs = Date.now()) {
  if (typeof serialized !== 'string' || !Number.isSafeInteger(referenceNowMs) ||
      referenceNowMs < 0) {
    throw new Error('invalid private M3 draft input or reference clock')
  }
  const unavailableDetails = assertUnrepairedObservedFacts(serialized)
  const sheet = restoreObservationSheetDraft(serialized)
  if (!sheet) throw new Error('private M3 draft is not a canonical collection sheet')

  const requirements = buildObservationSheet().requirements
  if (requirements.length !== 11 ||
      sheet.baseline.lines.length !== 11 || sheet.candidate.lines.length !== 11) {
    throw new Error('M3 paired eleven-line demand does not match the planner')
  }

  const toDo = (side, retailer) => {
    const pending = sheet[side].lines.flatMap((line, index) => {
      const expected = requirements[index]
      if (!expected || line.ingredientId !== expected.id ||
          line.requirement.amount !== expected.amount ||
          line.requirement.unit !== expected.unit) {
        throw new Error('M3 row differs from canonical planner requirement')
      }
      if (observationLineCollectionComplete(line)) return []
      return [{
        ingredientId: expected.id,
        ingredientLabel: expected.label,
        requiredAmount: expected.amount,
        requiredUnit: expected.unit,
        action: line.observedProduct.available === true
          ? 'complete-product-pack-and-price' : 'record-availability',
        missingFields: missingObservedProductFields(line.observedProduct),
      }]
    })
    return {
      retailer,
      expectedLines: 11,
      completedLines: 11 - pending.length,
      remainingLines: pending.length,
      pending,
    }
  }
  const plus = toDo('baseline', 'PLUS')
  const dekamarkt = toDo('candidate', 'DekaMarkt')
  const readiness = observationSheetReadiness(sheet, referenceNowMs)
  const window = observationWindowSummary(sheet, referenceNowMs)
  const windowState = window.state
  const observationWindowExpired = window.state === 'single-observation' &&
    Date.parse(window.deadlineAt) < referenceNowMs
  const pendingMetadata = pendingM3Metadata(
    readiness, windowState, observationWindowExpired, unavailableDetails,
  )
  const readyForPrivateReview = plus.remainingLines === 0 &&
    dekamarkt.remainingLines === 0 && readiness.ready &&
    unavailableDetails.baseline === 0 && unavailableDetails.candidate === 0

  return {
    schemaVersion: 1,
    reportType: 'm3-private-outstanding-field-actions',
    evidenceStatus: 'unverified-operator-draft',
    verifiedRetailerObservations: false,
    publicSavingsClaimEligible: false,
    readyForPrivateReview,
    observationWindowState: windowState,
    observationWindowExpired,
    pendingMetadata,
    unavailableDetailWarnings: {
      plus: unavailableDetails.baseline,
      dekamarkt: unavailableDetails.candidate,
    },
    pendingMetadataCount: pendingMetadata.study.length +
      pendingMetadata.plus.length + pendingMetadata.dekamarkt.length,
    expectedTotalLines: 22,
    completedTotalLines: plus.completedLines + dekamarkt.completedLines,
    remainingTotalLines: plus.remainingLines + dekamarkt.remainingLines,
    retailers: [plus, dekamarkt],
  }
}

// Only a finite, source-owned set of canonical readiness messages is mapped.
// Never copy an issue string, field value, private path or timestamp into output.
const PRIVATE_STUDY_METADATA = [
  ['studyId', 'Studiecode', ['Study ID ontbreekt.', 'Study ID moet een veilige pseudonieme sleutel zijn.']],
  ['participantKey', 'Pseudonieme deelnemercode', ['Participant key ontbreekt.', 'Participant key moet een veilige pseudonieme sleutel zijn.']],
  ['population', 'Doelgroep', ['Populatie ontbreekt.']],
  ['region', 'Regio', ['Regio ontbreekt.']],
  ['weekStart', 'Begindatum van de week', ['Week start ontbreekt.', 'Week start moet een geldige datum in JJJJ-MM-DD zijn.']],
  ['priceContext', 'Gedeelde prijscontext', ['Prijscontext ontbreekt.', 'Prijscontext moet in-store of online-order zijn.']],
]
const PRIVATE_RETAILER_METADATA = [
  ['storeName', 'Juiste winkelnaam', 'winkelnaam ontbreekt.', 'winkelnaam moet'],
  ['storeId', 'Winkelcode', 'winkel-ID ontbreekt.'],
  ['evidenceId', 'Bewijscode', 'evidence ID ontbreekt.'],
  ['provenanceNote', 'Herkomstnotitie', 'provenance-notitie ontbreekt.'],
  ['observedAt', 'Waarnemingstijd met tijdzone', 'geldige observatietijd ontbreekt.'],
]

function pendingM3Metadata(readiness, windowState, observationWindowExpired, unavailableDetails) {
  const issues = new Set(readiness.issues)
  const study = PRIVATE_STUDY_METADATA
    .filter(([, , reasons]) => reasons.some(reason => issues.has(reason)))
    .map(([field, label]) => ({ field, label }))
  const retailerFields = (prefix) => PRIVATE_RETAILER_METADATA
    .filter(([, , ...reasons]) =>
      reasons.some(reason => [...issues].some(issue => issue.startsWith(prefix + ': ' + reason))),
    )
    .map(([field, label]) => ({ field, label }))
  const plus = retailerFields('Winkel A')
  const dekamarkt = retailerFields('Winkel B')
  if (issues.has("Winkel A en Winkel B moeten verschillende winkel-ID's hebben.")) {
    plus.push({ field: 'distinctStoreId', label: 'Unieke winkelcode tegenover de andere winkel' })
    dekamarkt.push({ field: 'distinctStoreId', label: 'Unieke winkelcode tegenover de andere winkel' })
  }
  if (issues.has("Winkel A en Winkel B moeten verschillende evidence-ID's hebben.")) {
    plus.push({ field: 'distinctEvidenceId', label: 'Unieke bewijscode tegenover de andere winkel' })
    dekamarkt.push({ field: 'distinctEvidenceId', label: 'Unieke bewijscode tegenover de andere winkel' })
  }
  if (windowState === 'outside-window' || observationWindowExpired) {
    study.push({ field: 'observationWindow', label: 'Meet beide winkels binnen maximaal 24 uur opnieuw' })
  }
  const conflictAction = () => ({
    field: 'unavailableDetails',
    label: 'Controleer achtergebleven product- of prijsvelden bij niet-beschikbaarheid',
  })
  if (unavailableDetails.baseline > 0) plus.push(conflictAction())
  if (unavailableDetails.candidate > 0) dekamarkt.push(conflictAction())
  return { study, plus, dekamarkt }
}

function humanQuantity(amount, unit) {
  const quantity = String(amount).replace('.', ',')
  if (unit === 'piece') return quantity + ' ' + (amount === 1 ? 'stuk' : 'stuks')
  return quantity + ' ' + unit
}

// Human-readable coarse states, deliberately without revealing either store's
// private observation timestamp or local timezone. JSON keeps its stable keys.
const WINDOW_HELP = {
  'not-started': 'nog geen geldige observatietijd; vul beide winkels in',
  'single-observation': 'één winkel heeft een geldige observatietijd; meet de andere binnen 24 uur',
  'within-window': 'twee geldige observatietijden binnen 24 uur; controleer alle overige velden',
  'outside-window': 'langer dan 24 uur uit elkaar; voer een nieuwe gekoppelde meting uit',
}

function renderHumanChecklist(report, selection = 'both') {
  const retailers = selection === 'both'
    ? report.retailers
    : report.retailers.filter(store => store.retailer === selection)
  const pending = retailers.reduce((count, store) => count + store.remainingLines, 0)
  const lines = [
    'SUPA M3 · nog te meten (geen geverifieerde winkelwaarneming)',
    'Openstaande boodschappen: ' + pending + ' van ' + (retailers.length * 11) + '.',
  ]
  for (const store of retailers) {
    lines.push('', store.retailer + ': ' + store.remainingLines + ' van 11 nog te meten')
    if (store.pending.length === 0) lines.push('  Geen openstaande regels.')
    for (const item of store.pending) {
      const nextStep = item.action === 'record-availability'
        ? 'beschikbaarheid vastleggen'
        : 'product, verpakking en prijs aanvullen'
      const missingLabels = item.missingFields
        .filter(field => Object.hasOwn(MISSING_PRODUCT_FIELD_LABELS, field))
        .map(field => MISSING_PRODUCT_FIELD_LABELS[field])
      lines.push('  - ' + item.ingredientLabel + ' (' +
        humanQuantity(item.requiredAmount, item.requiredUnit) + '): ' + nextStep +
        (item.action === 'complete-product-pack-and-price' && missingLabels.length
          ? ' — nog nodig: ' + missingLabels.join(', ')
          : ''))
    }
  }
  const showActions = (label, pending) => {
    if (pending.length === 0) return
    lines.push('', label + ': nog ' + pending.length + ' veld(en) te controleren')
    for (const item of pending) lines.push('  - ' + item.label)
  }
  showActions('Studiegegevens', report.pendingMetadata.study)
  if (selection === 'both' || selection === 'PLUS') {
    showActions('PLUS-meetgegevens', report.pendingMetadata.plus)
  }
  if (selection === 'both' || selection === 'DekaMarkt') {
    showActions('DekaMarkt-meetgegevens', report.pendingMetadata.dekamarkt)
  }
  const windowHelp = report.observationWindowExpired
    ? 'de eerste meting is ouder dan 24 uur; meet beide winkels opnieuw'
    : WINDOW_HELP[report.observationWindowState]
  lines.push('', 'Meetvenster: ' + windowHelp +
    '. Privéreview mogelijk: ' + (report.readyForPrivateReview ? 'ja' : 'nee') + '.',
    'Geen bewezen winkelprijzen of publieke besparingsclaim.')
  return lines.join('\n') + '\n'
}

export async function main(argv = process.argv.slice(2)) {
  const isText = argv.length >= 2 && argv[1] === '--text'
  const isStoreText = isText && argv.length === 4 &&
    argv[2] === '--store' && ['plus', 'dekamarkt'].includes(argv[3])
  const ordinary = argv.length === 1 || (argv.length === 2 && isText)
  if ((!ordinary && !isStoreText) ||
      typeof argv[0] !== 'string' ||
      !argv[0].trim() || argv[0] !== argv[0].trim() ||
      argv[0].startsWith('-')) {
    throw new Error('usage: m3-private-outstanding-field-actions <private-sheet.json> [--text [--store plus|dekamarkt]]')
  }
  let serialized
  try {
    serialized = await readPrivateM3ActionDraft(argv[0])
  } catch {
    throw new Error('could not read private M3 draft')
  }
  const result = buildM3OutstandingFieldActions(serialized)
  process.stdout.write(isText
    ? renderHumanChecklist(result, isStoreText ? (argv[3] === 'plus' ? 'PLUS' : 'DekaMarkt') : 'both')
    : JSON.stringify(result, null, 2) + '\n')
  return result
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    // Never print private source paths, observer identifiers, store metadata,
    // untrusted error messages or the sensitive draft itself.
    process.stderr.write('M3 private outstanding field actions could not be generated\n')
    process.exitCode = 1
  })
}
