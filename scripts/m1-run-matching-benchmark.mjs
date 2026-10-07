import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

import { evaluateMatchingBenchmark } from '../src/domain/matching.ts'

const fixtureUrl = new URL('../fixtures/matching/benchmark.v1.json', import.meta.url)
const CASE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

export function validateBenchmarkCaseIdentity(cases) {
  if (!Array.isArray(cases) || cases.length === 0) {
    throw new Error('matching benchmark must contain at least one case')
  }

  const seen = new Set()
  for (const [index, benchmarkCase] of cases.entries()) {
    const id = benchmarkCase?.id
    if (
      typeof id !== 'string' ||
      id.length > 128 ||
      !CASE_ID_PATTERN.test(id)
    ) {
      throw new Error(`matching benchmark case at index ${index} has an unsafe id`)
    }
    if (seen.has(id)) {
      throw new Error(`matching benchmark contains duplicate case id: ${id}`)
    }
    seen.add(id)
  }
}

export async function main() {
  const cases = JSON.parse(await readFile(fixtureUrl, 'utf8'))
  validateBenchmarkCaseIdentity(cases)
  const result = evaluateMatchingBenchmark(cases)

  console.log(JSON.stringify(result, null, 2))

  const required = {
    overallAccuracy: 0.9,
    matchAccuracy: 0.85,
    abstentionAccuracy: 1,
    falsePositiveMatches: 0,
  }

  const failures = []
  if (result.metrics.accuracy < required.overallAccuracy) {
    failures.push(
      `overall accuracy ${result.metrics.accuracy.toFixed(3)} < ${required.overallAccuracy}`,
    )
  }
  if (result.metrics.matchAccuracy < required.matchAccuracy) {
    failures.push(
      `match accuracy ${result.metrics.matchAccuracy.toFixed(3)} < ${required.matchAccuracy}`,
    )
  }
  if (result.metrics.abstentionAccuracy < required.abstentionAccuracy) {
    failures.push(
      `abstention accuracy ${result.metrics.abstentionAccuracy.toFixed(3)} < ${required.abstentionAccuracy}`,
    )
  }
  if (result.metrics.falsePositiveMatches > required.falsePositiveMatches) {
    failures.push(
      `false positive matches ${result.metrics.falsePositiveMatches} > ${required.falsePositiveMatches}`,
    )
  }

  if (failures.length > 0) {
    console.error('M1 matching benchmark failed:')
    for (const failure of failures) console.error(`- ${failure}`)
    process.exitCode = 1
  }

  return result
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}
