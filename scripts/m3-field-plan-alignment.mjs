import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { m2DefaultActiveDays, m2InitialPlan } from '../src/data/m2Fixture.ts'
import { buildObservationSheet, M3_EXPECTED_RETAILERS } from '../src/domain/m3ObservationSheet.ts'
import { m3FieldSheetMatchesPlannerWeek } from '../src/features/observation/m3PlannerMeasurementWeek.ts'
import { selectedFixtureWeek } from './retailer-reviewed-custom-week.mjs'

/**
 * Read-only operator preflight for the *frozen* four-meal M3 observation kit.
 * Reuse the reviewed planner CLI parser; it restricts input to public fixture
 * days and reviewed recipes, and never loads personal drafts or makes requests.
 *
 * The flexible preview CLI can review other plans, but the printed 11×2 study
 * worksheet cannot: no recipe substitution is allowed during field collection.
 *
 * CLI exit codes: 0 exact approved kit / 3 different plan / 2 invalid input.
 */
export function m3StudyWeekAlignment(argv = []) {
  const { days, plan } = selectedFixtureWeek(argv)
  // Verify the *actual* canonical blank field sheet still has precisely the
  // same 11 physical requirements on both sides before clearing any operator.
  const sheet = buildObservationSheet()
  if (sheet.evidenceStatus !== 'collection-template-not-evidence' ||
      sheet.requirements.length !== 11 ||
      sheet.baseline.lines.length !== sheet.requirements.length ||
      sheet.candidate.lines.length !== sheet.requirements.length) {
    throw new Error('Fixed M3 observation sheet is not a consistent blank template')
  }
  const approved = m3FieldSheetMatchesPlannerWeek(plan, days)
  const selected = new Set(days)
  const canonicalByDay = new Map(m2InitialPlan.map(meal => [meal.day, meal.recipeId]))
  const planByDay = new Map(plan.map(meal => [meal.day, meal.recipeId]))

  const missingDays = m2DefaultActiveDays.filter(day => !selected.has(day))
  const changedRecipes = m2DefaultActiveDays
    .filter(day => selected.has(day) && planByDay.get(day) !== canonicalByDay.get(day))
    .map(day => ({
      day,
      studyRecipeId: canonicalByDay.get(day),
      selectedRecipeId: planByDay.get(day),
    }))

  return {
    mode: 'offline-m3-field-plan-preflight',
    fixedStudyWeekMatches: approved,
    selectedDays: [...days],
    missingDays,
    changedRecipes,
    physicalStudyIngredientsPerStore: sheet.requirements.length,
    storesToObserve: [M3_EXPECTED_RETAILERS.baseline, M3_EXPECTED_RETAILERS.candidate],
    matchesFixedWorksheetDemand: approved,
    retailerReusePermissionVerified: false,
    fieldObservationEvidenceCollected: false,
    operatorInstruction: approved
      ? 'Deze planning past bij de vaste 11+11-vraag. Dit bevestigt geen bronrechten, echte winkelmetingen of veld-codeversie; controleer die voorwaarden afzonderlijk.'
      : 'Stop: de gekozen week wijkt af. Gebruik geen vast 11+11 veldformulier voor dit aangepaste plan. Herstel eerst de oorspronkelijke vier recepten en dagen.',
    evidenceStatus: 'preflight-only-not-an-observation',
    liveRetailerRequests: 0,
    publicSavingsClaimEligible: false,
  }
}

export function main(argv = process.argv.slice(2), write = text => process.stdout.write(text)) {
  const summary = m3StudyWeekAlignment(argv)
  write(JSON.stringify(summary) + '\n')
  return summary.fixedStudyWeekMatches ? 0 : 3
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    process.exitCode = main()
  } catch {
    // Do not echo malformed user-supplied plan tokens or private file paths.
    console.error('Ongeldige M3 voorcontrole: alleen vastgelegde demodagen en recepten zijn toegestaan.')
    process.exitCode = 2
  }
}
