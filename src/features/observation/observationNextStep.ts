import {
  M3_EXPECTED_RETAILERS,
  nextIncompleteObservationLine,
  observationSheetReadiness,
  observationWindowSummary,
  observationStoreMatchesExpectedRetailer,
  type M3ObservationSide,
  type ObservationSheet,
} from '../../domain/m3ObservationSheet.ts'
import { nextObservationActionLabel } from './observationCollectionUi.ts'

/**
 * A task-first hint for a person collecting a real store observation.
 *
 * This is presentation only: never infer a price, mark a line as measured,
 * change the observation sheet, or replace the canonical readiness checks.
 */
export type ObservationNextAction = {
  stage: 'study' | 'store' | 'line' | 'review' | 'export'
  title: string
  detail: string
  side?: M3ObservationSide
  ingredientId?: string
}

const reviewAction: ObservationNextAction = {
  stage: 'review',
  title: 'Controleer de ingevulde gegevens',
  detail:
    'Er ontbreken nog gegevens of de twee winkelmetingen zijn niet vergelijkbaar. Controleer de meldingen bij de velden. Een ingevuld concept is nog geen gecontroleerd bewijs.',
}

const studySteps = [
  ['studyId', 'Geef deze meting een code', 'Kies een herkenbare code voor deze winkelvergelijking.'],
  ['participantKey', 'Voeg een anonieme deelnemerscode toe', 'Gebruik geen naam, e-mailadres of ander direct persoonsgegeven.'],
  ['population', 'Beschrijf voor wie je meet', 'Noteer de doelgroep van deze vergelijking.'],
  ['region', 'Vul de regio in', 'Gebruik dezelfde regio voor de twee winkels.'],
  ['weekStart', 'Kies de week van je maaltijdplan', 'Leg vast op welke planweek de ingrediëntenlijst betrekking heeft.'],
  ['priceContext', 'Kies hoe je de prijzen meet', 'Gebruik voor beide winkels dezelfde context: in de winkel of online.'],
] as const

const storeSteps = [
  ['name', 'Vul de winkelnaam in', 'Kies de juiste winkel voor deze meting.'],
  ['id', 'Geef de winkellocatie een code', 'Gebruik een herkenbare code voor deze specifieke vestiging.'],
  ['evidenceId', 'Geef de winkelmeting een code', 'Zo kun je de invoer later aan de juiste meting koppelen.'],
  ['observedAt', 'Leg de datum en tijd vast', 'Meet beide winkels binnen 24 uur van elkaar.'],
  ['provenanceNote', 'Beschrijf hoe je deze prijzen vastlegde', 'Noteer bijvoorbeeld winkelmand, kassabon of een export met toestemming.'],
] as const

function missing(value: unknown): boolean {
  return typeof value !== 'string' || value.trim().length === 0
}

function chooseStoreAction(
  sheet: ObservationSheet,
  side: M3ObservationSide,
): ObservationNextAction | null {
  const observation = sheet[side]
  const retailer = M3_EXPECTED_RETAILERS[side]
  if (
    missing(observation.store.name) ||
    !observationStoreMatchesExpectedRetailer(side, observation.store.name)
  ) {
    return {
      stage: 'store',
      side,
      title: 'Controleer de winkelnaam van ' + retailer,
      detail:
        'Vul de echte ' + retailer + '-vestiging in. Een andere supermarkt hoort niet bij deze vergelijking.',
    }
  }

  for (const [key, title, detail] of storeSteps) {
    const value = key === 'name' || key === 'id'
      ? observation.store[key]
      : observation[key]
    if (missing(value)) {
      return {
        stage: 'store',
        side,
        title: title + ' voor ' + retailer,
        detail,
      }
    }

    // A non-empty but unparsable date is an actionable field error.
    if (key === 'observedAt' && !Number.isFinite(Date.parse(value))) {
      return {
        stage: 'store',
        side,
        title: 'Controleer de datum en tijd van ' + retailer,
        detail:
          'Gebruik het echte meetmoment. Vul geen geschatte tijd in; beide winkels moeten binnen 24 uur worden gemeten.',
      }
    }
  }

  return null
}

function nextForValidSheet(sheet: ObservationSheet): ObservationNextAction {
  for (const [key, title, detail] of studySteps) {
    if (missing(sheet.study[key])) {
      return { stage: 'study', title, detail }
    }
  }

  // A non-empty but unrecognized context is still not a valid study choice.
  if (sheet.study.priceContext !== 'in-store' && sheet.study.priceContext !== 'online-order') {
    return {
      stage: 'study',
      title: 'Kies een geldige prijscontext',
      detail: 'Kies voor beide winkels dezelfde context: in de winkel of online.',
    }
  }

  for (const side of ['baseline', 'candidate'] as const) {
    const storeAction = chooseStoreAction(sheet, side)
    if (storeAction) return storeAction

    const line = nextIncompleteObservationLine(sheet)
    if (line && line.side === side) {
      return {
        stage: 'line',
        side,
        ingredientId: line.ingredientId,
        title: nextObservationActionLabel(sheet, line),
        detail:
          'Controleer beschikbaarheid, product, verpakking en prijs. Laat onbekende gegevens open; vul niets op basis van een gok in.',
      }
    }
  }

  // Surface a concrete, safe remedy rather than a raw evidence error count.
  if (observationWindowSummary(sheet).state === 'outside-window') {
    return {
      stage: 'review',
      title: 'Meet beide winkels binnen 24 uur',
      detail:
        'Deze winkelmetingen liggen te ver uit elkaar om eerlijk te vergelijken. Verzamel nieuwe echte metingen voor dezelfde boodschappenlijst en prijscontext; pas de tijden niet kunstmatig aan.',
    }
  }

  const readiness = observationSheetReadiness(sheet)
  const hasMeasuredLines = sheet.baseline.lines.length > 0 && sheet.candidate.lines.length > 0
  if (!readiness.ready || !hasMeasuredLines) return reviewAction

  return {
    stage: 'export',
    title: 'Bewaar de ingevulde winkelmetingen',
    detail:
      'De invoer is compleet volgens de formuliercontroles. Exporteer het concept voor aparte controle en beoordeling; dit bewijst nog geen besparing.',
  }
}

/** Fail closed on malformed persisted input: never announce that evidence is ready. */
export function observationNextAction(sheet: ObservationSheet): ObservationNextAction {
  try {
    if (!sheet || typeof sheet !== 'object' || Array.isArray(sheet)) {
      return reviewAction
    }
    return nextForValidSheet(sheet)
  } catch {
    return reviewAction
  }
}
