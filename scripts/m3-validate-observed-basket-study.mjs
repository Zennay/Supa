import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { assessWeeklyBasketStudy } from '../src/domain/observedBasketStudy.ts'

function fail(message, code = 1) {
  process.stderr.write(message + '\n')
  process.exitCode = code
}

function usage() {
  return 'Usage: npm run m3:validate-observed-study -- <study.json>'
}

const input = process.argv[2]
if (!input) {
  fail(usage())
} else {
  try {
    if (path.extname(input).toLowerCase() !== '.json') {
      throw new Error('input must be a .json study document')
    }

    const raw = await readFile(input, 'utf8')
    const study = JSON.parse(raw)
    const assessment = assessWeeklyBasketStudy(study)

    const result = {
      schemaVersion: 1,
      studyId:
        typeof study?.studyId === 'string' && study.studyId.length > 0
          ? study.studyId
          : null,
      claimable: assessment.claimable,
      outcome: assessment.comparison.outcome,
      baselineTotalCents: assessment.comparison.baselineTotalCents,
      candidateTotalCents: assessment.comparison.candidateTotalCents,
      deltaCents: assessment.comparison.deltaCents,
      savingsCents: assessment.comparison.savingsCents,
      observationWindowHours: assessment.observationWindowHours,
      reasons: assessment.reasons,
    }

    process.stdout.write(JSON.stringify(result, null, 2) + '\n')
    process.exitCode = assessment.claimable ? 0 : 2
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    fail(`Invalid observed-basket study document: ${detail}`)
  }
}
