import { readFile } from 'node:fs/promises'

import { evaluateMatchingBenchmark } from '../src/domain/matching.ts'

const fixtureUrl = new URL('../fixtures/matching/benchmark.v1.json', import.meta.url)
const cases = JSON.parse(await readFile(fixtureUrl, 'utf8'))
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
