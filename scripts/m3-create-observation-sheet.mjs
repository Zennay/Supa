import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { pathToFileURL } from 'node:url'

import { aggregatePlanIngredients } from '../src/domain/basket.ts'
import {
  m2DefaultActiveDays,
  m2InitialPlan,
  m2Recipes,
} from '../src/data/m2Fixture.ts'

function blankStoreObservation(requirements) {
  return {
    evidenceId: '',
    observedAt: '',
    source: 'manual-cart',
    provenanceNote: '',
    store: {
      id: '',
      name: '',
    },
    lines: requirements.map((requirement) => ({
      ingredientId: requirement.id,
      ingredientLabel: requirement.label,
      requirement: {
        amount: requirement.amount,
        unit: requirement.unit,
      },
      observedProduct: {
        productId: '',
        productName: '',
        packAmount: null,
        packUnit: null,
        packCount: 1,
        priceCents: null,
        available: null,
        sourceUrl: '',
        note: '',
      },
    })),
  }
}

export function buildObservationSheet() {
  const requirements = aggregatePlanIngredients(
    m2InitialPlan,
    m2Recipes,
    m2DefaultActiveDays,
  ).map(({ id, label, query, amount, unit }) => ({
    id,
    label,
    query,
    amount,
    unit,
  }))

  return {
    schemaVersion: 1,
    sheetType: 'm3-manual-cart-observation-sheet',
    evidenceStatus: 'collection-template-not-evidence',
    plannerFixture: 'm2-default-week',
    selectedMealCount: m2InitialPlan.filter((meal) =>
      m2DefaultActiveDays.includes(meal.day),
    ).length,
    study: {
      studyId: '',
      participantKey: '',
      population: '',
      region: '',
      weekStart: '',
      maxObservationWindowHours: 24,
    },
    requirements,
    baseline: blankStoreObservation(requirements),
    candidate: blankStoreObservation(requirements),
    instructions: [
      'Observe both stores for the exact same requirement list.',
      'Record actual pack, price and availability; do not guess missing values.',
      'Keep baseline and candidate observations within 24 hours.',
      'Use a pseudonymous participant key and never store names, email addresses or account IDs.',
      'This sheet is collection support only. Convert verified observations into the WeeklyBasketStudy contract, then run npm run m3:assess-observed-week.',
    ],
  }
}

function parseArgs(argv) {
  if (argv.length === 0) return { output: null }
  if (argv.length === 2 && argv[0] === '--output' && argv[1]) {
    return { output: argv[1] }
  }
  throw new Error(
    'usage: m3:create-observation-sheet [--output observation-sheet.json]',
  )
}

export async function main(argv = process.argv.slice(2)) {
  const { output } = parseArgs(argv)
  const serialized = `${JSON.stringify(buildObservationSheet(), null, 2)}\n`

  if (output) {
    await mkdir(dirname(output), { recursive: true })
    await writeFile(output, serialized, 'utf8')
  } else {
    process.stdout.write(serialized)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
