import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  m2DefaultActiveDays, m2InitialPlan, m2Recipes,
} from '../src/data/m2Fixture.ts'
import { m3StudyWeekAlignment } from '../scripts/m3-field-plan-alignment.mjs'

// Independent quality-validation of the product owner's *unchanged* offline
// operator CLI on frozen PR #3021. This tests real Node processes, never real
// retailer data, personal files, price claims or network requests.
const script = fileURLToPath(new URL('../scripts/m3-field-plan-alignment.mjs', import.meta.url))
const dayOrder = [...m2DefaultActiveDays]
const canonicalByDay = new Map(m2InitialPlan.map(x => [x.day, x.recipeId]))
const recipes = m2Recipes.map(x => x.id)
const sourcePlan = structuredClone(m2InitialPlan)

function run(args, cwd) {
  const result = spawnSync(process.execPath, [
    '--experimental-strip-types', script, ...args,
  ], {
    cwd, encoding: 'utf8', timeout: 15000, maxBuffer: 256 * 1024,
  })
  assert.ifError(result.error)
  assert.equal(result.signal, null)
  return result
}

function assertNeverClaimed(summary, message) {
  assert.equal(summary.evidenceStatus, 'preflight-only-not-an-observation', message)
  assert.equal(summary.retailerReusePermissionVerified, false, message)
  assert.equal(summary.fieldObservationEvidenceCollected, false, message)
  assert.equal(summary.publicSavingsClaimEligible, false, message)
  assert.equal(summary.liveRetailerRequests, 0, message)
  assert.equal(summary.physicalStudyIngredientsPerStore, 11, message)
  assert.deepEqual(summary.storesToObserve, ['PLUS', 'DekaMarkt'], message)
}

function temporaryProcessScope(runCases) {
  const directory = mkdtempSync(join(tmpdir(), 'supa-independent-m3-preflight-'))
  try {
    runCases(directory)
    assert.deepEqual(readdirSync(directory), [],
      'offline preflight must not generate a participant sheet, private log or output file')
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

test('QA real Node CLI: all 15 nonempty --days combinations preserve honest field mismatch', () => {
  temporaryProcessScope(cwd => {
    let accepted = 0
    let denied = 0
    for (let mask = 1; mask < 16; mask++) {
      const selected = dayOrder.filter((_, index) => mask & (1 << index))
      const reversed = [...selected].reverse()
      const args = ['--days', reversed.join(',')]
      const result = run(args, cwd)
      const matches = selected.length === dayOrder.length
      assert.equal(result.status, matches ? 0 : 3, args.join(' '))
      assert.equal(result.stderr, '')
      assert.equal(result.stdout.split('\n').length, 2, 'one JSON line only')
      const summary = JSON.parse(result.stdout)
      assert.equal(summary.mode, 'offline-m3-field-plan-preflight')
      assert.equal(summary.fixedStudyWeekMatches, matches)
      assert.equal(summary.matchesFixedWorksheetDemand, matches)
      assert.deepEqual(summary.selectedDays, selected, 'caller order cannot change canonical week')
      assert.deepEqual(summary.missingDays, dayOrder.filter(day => !selected.includes(day)))
      assert.deepEqual(summary.changedRecipes, [])
      assertNeverClaimed(summary, args.join(' '))
      assert.match(summary.operatorInstruction, matches ? /Deze planning past/ : /Stop:/)
      if (matches) accepted++
      else denied++
    }
    assert.equal(accepted, 1)
    assert.equal(denied, 14)
  })
  assert.deepEqual(m2InitialPlan, sourcePlan)
})

test('QA real Node CLI: full four-day recipe substitutions never impersonate the fixed 11+11 kit', () => {
  temporaryProcessScope(cwd => {
    let checked = 0
    for (const day of dayOrder) for (const replacement of recipes) {
      const assignments = dayOrder.map(item =>
        item + ':' + (item === day ? replacement : canonicalByDay.get(item)))
      const result = run(['--plan', assignments.reverse().join(',')], cwd)
      const matches = canonicalByDay.get(day) === replacement
      assert.equal(result.status, matches ? 0 : 3)
      assert.equal(result.stderr, '')
      const summary = JSON.parse(result.stdout)
      assert.equal(summary.fixedStudyWeekMatches, matches)
      assert.equal(summary.matchesFixedWorksheetDemand, matches)
      assert.deepEqual(summary.selectedDays, dayOrder)
      assert.deepEqual(summary.missingDays, [])
      assert.deepEqual(summary.changedRecipes.map(x => x.day), matches ? [] : [day])
      if (!matches) {
        assert.deepEqual(summary.changedRecipes, [{
          day, studyRecipeId: canonicalByDay.get(day), selectedRecipeId: replacement,
        }])
      }
      assertNeverClaimed(summary, day + ' ' + replacement)
      checked++
    }
    assert.equal(checked, dayOrder.length * recipes.length)
  })
  assert.deepEqual(m2InitialPlan, sourcePlan)
})

test('QA real Node CLI: invalid tokens are refused with no private token/path reflection', () => {
  const badInputs = [
    ['--plan', 'Ma:PRIVATE_PERSONAL_RECIPE_TOKEN'],
    ['--days', 'Ma,Ma'],
    ['--days', 'Do,Do'],
    ['--days', 'Ma,,Di'],
    ['--days', 'Ma,Di,Wo,Do,Ma'],
    ['--plan', 'Ma:tikka,Ma:pasta'],
    ['--plan', 'Ma:unknown'],
    ['--plan', 'Ma:private-file:///tmp/private-person'],
    ['--days', 'PRIVATE_PERSONAL_LOCATION'],
    ['--days', 'Ma', '--output', '/tmp/private-basket.json'],
    ['--plan', 'Ma:tikka', '--source', 'private-secret'],
    ['--plan', ''],
    ['--days', ''],
    ['--unapproved', 'Ma'],
    ['--days'],
    ['--plan'],
  ]
  temporaryProcessScope(cwd => {
    for (const argv of badInputs) {
      const result = run(argv, cwd)
      assert.equal(result.status, 2, argv.join(' '))
      assert.equal(result.stdout, '', argv.join(' '))
      assert.match(result.stderr, /Ongeldige M3 voorcontrole/)
      assert.doesNotMatch(result.stderr,
        /PRIVATE_PERSONAL|private-file|private-person|private-basket|private-secret|unknown|unapproved|tikka|pasta/)
    }
  })
  assert.deepEqual(m2InitialPlan, sourcePlan)
})

test('QA direct API and subprocess agree on the same canonical read-only safety contract', () => {
  temporaryProcessScope(cwd => {
    const runs = [
      [],
      ['--days', 'Wo,Ma'],
      ['--days', 'Do,Wo,Di,Ma'],
      ['--plan', dayOrder.map(day => day + ':' + canonicalByDay.get(day)).join(',')],
    ]
    for (const argv of runs) {
      const expected = m3StudyWeekAlignment(argv)
      const processResult = run(argv, cwd)
      assert.deepEqual(JSON.parse(processResult.stdout), expected)
      assert.equal(processResult.status, expected.fixedStudyWeekMatches ? 0 : 3)
      assertNeverClaimed(expected, JSON.stringify(argv))
    }
  })
})
