// Independent M3 quality-validation 2/2: human field-action CLI acceptance.
// All observations and identifiers in this test are synthetic, not retailer evidence.
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, writeFile, rm, stat, chmod, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildObservationSheet } from '../src/domain/m3ObservationSheet.ts'
import { buildFictionalPricedSheet } from '../scripts/m3-rehearse-field-run.mjs'
import { buildM3OutstandingFieldActions } from '../scripts/m3-private-outstanding-field-actions.mjs'
import { readPrivateM3ActionDraft } from '../scripts/m3-private-field-actions-input.mjs'

const cli = fileURLToPath(new URL('../scripts/m3-private-outstanding-field-actions.mjs', import.meta.url))
const privateMarker = 'private-do-not-print-observation-47'
const refClock = Date.parse('2026-10-15T12:00:00.000Z')
function invoke(cwd, input, ...flags) {
  return spawnSync(process.execPath,
    ['--experimental-strip-types', cli, input, ...flags],
    { cwd, encoding: 'utf8', timeout: 20_000 })
}
async function sandbox(t, sheet) {
  const dir = await mkdtemp(join(tmpdir(), 'supa-qa-human-field-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  sheet.study.participantKey = privateMarker
  sheet.baseline.evidenceId = 'SECRET-PLUS-EVIDENCE-REF'
  sheet.candidate.evidenceId = 'SECRET-DEKA-EVIDENCE-REF'
  const input = join(dir, 'participant-secret-sheet.json')
  const bytes = Buffer.from(JSON.stringify(sheet), 'utf8')
  await writeFile(input, bytes, { mode: 0o600 })
  return { dir, input, bytes }
}
function privateOutputOnly(run, dir) {
  assert.equal(run.error, undefined, run.error?.message)
  assert.equal(run.status, 0, run.stderr)
  assert.equal(run.stderr, '')
  for (const disallowed of [
    privateMarker, 'SECRET-PLUS-EVIDENCE-REF', 'SECRET-DEKA-EVIDENCE-REF',
    dir, 'participant-secret-sheet.json', '"priceCents"',
  ]) assert.equal(run.stdout.includes(disallowed), false, disallowed)
}

test('independent operator: mixed PLUS/DekaMarkt progress gives exact 10/11 and 11/11 pending lists', async t => {
  const sheet = buildObservationSheet()
  sheet.baseline.lines[0].observedProduct.available = false
  sheet.candidate.lines[0].observedProduct.available = true
  sheet.candidate.lines[0].observedProduct.productName = 'SECRET-PRIVATE-PRODUCT'
  sheet.candidate.lines[0].observedProduct.priceCents = 12345
  const { dir, input, bytes } = await sandbox(t, sheet)
  const json = invoke(dir, input)
  privateOutputOnly(json, dir)
  const report = JSON.parse(json.stdout)
  assert.equal(report.expectedTotalLines, 22)
  assert.equal(report.completedTotalLines, 1)
  assert.equal(report.remainingTotalLines, 21)
  assert.deepEqual(report.retailers.map(x => [x.retailer, x.completedLines, x.remainingLines]),
    [['PLUS', 1, 10], ['DekaMarkt', 0, 11]])
  assert.equal(report.retailers[1].pending[0].action, 'complete-product-pack-and-price')
  assert.equal(report.readyForPrivateReview, false)
  assert.equal(report.verifiedRetailerObservations, false)
  assert.equal(report.publicSavingsClaimEligible, false)
  for (const [selection, shop, other, expected] of [
    ['plus', 'PLUS', 'DekaMarkt', 10],
    ['dekamarkt', 'DekaMarkt', 'PLUS', 11],
  ]) {
    const result = invoke(dir, input, '--text', '--store', selection)
    privateOutputOnly(result, dir)
    assert.match(result.stdout, new RegExp('Openstaande boodschappen: ' + expected + ' van 11'))
    assert.match(result.stdout, new RegExp(shop + ': ' + expected + ' van 11 nog te meten'))
    assert.equal(result.stdout.includes(other + ':'), false)
    assert.equal(result.stdout.includes('SECRET-PRIVATE-PRODUCT'), false)
    assert.match(result.stdout, /Geen bewezen winkelprijzen of publieke besparingsclaim/)
  }
  assert.deepEqual(await readFile(input), bytes, 'printing must not modify field evidence')
  assert.equal((await stat(input)).mode & 0o777, 0o600)
})

test('independent operator: 22 recorded unavailable lines are not an observed financial proof', async t => {
  const sheet = buildObservationSheet()
  for (const side of ['baseline', 'candidate']) {
    for (const line of sheet[side].lines) line.observedProduct.available = false
  }
  const { dir, input, bytes } = await sandbox(t, sheet)
  const json = invoke(dir, input)
  privateOutputOnly(json, dir)
  const report = JSON.parse(json.stdout)
  assert.deepEqual([report.remainingTotalLines, report.completedTotalLines], [0, 22])
  assert.equal(report.readyForPrivateReview, false)
  assert.equal(report.publicSavingsClaimEligible, false)
  for (const store of ['plus', 'dekamarkt']) {
    const printed = invoke(dir, input, '--text', '--store', store)
    privateOutputOnly(printed, dir)
    assert.match(printed.stdout, /Openstaande boodschappen: 0 van 11/)
    assert.match(printed.stdout, /Geen openstaande regels/)
    assert.match(printed.stdout, /Privéreview mogelijk: nee/)
    assert.doesNotMatch(printed.stdout, /€|[0-9]+[,\.][0-9]{2}\s*euro/)
  }
  assert.deepEqual(await readFile(input), bytes)
})

test('independent operator: fully synthetic priced 11+11 cannot elevate reviewed to verified', async t => {
  const sheet = buildFictionalPricedSheet()
  sheet.study.participantKey = privateMarker
  sheet.candidate.lines[0].observedProduct.productName = 'SECRET-CANDIDATE-PRODUCT'
  const { dir, input, bytes } = await sandbox(t, sheet)
  const report = buildM3OutstandingFieldActions(await readFile(input, 'utf8'), refClock)
  assert.equal(report.expectedTotalLines, 22)
  assert.equal(report.remainingTotalLines, 0)
  assert.equal(report.completedTotalLines, 22)
  assert.equal(report.readyForPrivateReview, true)
  assert.equal(report.verifiedRetailerObservations, false)
  assert.equal(report.publicSavingsClaimEligible, false)
  for (const store of ['plus', 'dekamarkt']) {
    const printed = invoke(dir, input, '--text', '--store', store)
    privateOutputOnly(printed, dir)
    assert.match(printed.stdout, /Openstaande boodschappen: 0 van 11/)
    assert.doesNotMatch(printed.stdout, /SECRET-CANDIDATE-PRODUCT|PRIVATE-DO-NOT-PRINT/)
    assert.match(printed.stdout, /Geen bewezen winkelprijzen of publieke besparingsclaim/)
  }
  assert.deepEqual(await readFile(input), bytes)
})

test('independent operator: corrupted demand and public input refuse without a partial checklist', async t => {
  const sheet = buildObservationSheet()
  sheet.requirements[0].amount += 1
  const { dir, input, bytes } = await sandbox(t, sheet)
  for (const flags of [[], ['--text'], ['--text', '--store', 'plus']]) {
    const result = invoke(dir, input, ...flags)
    assert.notEqual(result.status, 0)
    assert.equal(result.stdout, '')
    assert.equal(result.stderr.includes(privateMarker), false)
    assert.equal(result.stderr.includes(dir), false)
  }
  assert.deepEqual(await readFile(input), bytes)
  await chmod(input, 0o644)
  const denied = invoke(dir, input, '--text', '--store', 'dekamarkt')
  assert.notEqual(denied.status, 0)
  assert.equal(denied.stdout, '')
  assert.equal(denied.stderr.includes(dir), false)
  assert.deepEqual(await readFile(input), bytes)
  await assert.rejects(access(join(dir, 'unexpected-generated-report.json')))
})

test('independent operator: one-store flags never act as an implicit financial readiness API', async t => {
  const sheet = buildObservationSheet()
  const { dir, input, bytes } = await sandbox(t, sheet)
  const both = invoke(dir, input, '--text')
  privateOutputOnly(both, dir)
  assert.match(both.stdout, /Openstaande boodschappen: 22 van 22/)
  assert.match(both.stdout, /Privéreview mogelijk: nee/)
  for(const flags of [
    ['--store','plus'], ['--text','--store','both'],
    ['--text','--store','PLUS'], ['--text','--store','dekamarkt','--json'],
    ['--text','--store',''], ['--text','--store','plus','--output','bad.txt'],
  ]) {
    const denied = invoke(dir, input, ...flags)
    assert.notEqual(denied.status, 0)
    assert.equal(denied.stdout, '')
    assert.equal(denied.stderr.includes(dir), false)
  }
  assert.deepEqual(await readFile(input), bytes)
})


test('independent input budget: exact 2 MiB private regular file is readable but one extra byte is rejected', async t => {
  const { dir, input } = await sandbox(t, buildObservationSheet())
  const atLimit = Buffer.alloc(2 * 1024 * 1024, 0x61)
  await writeFile(input, atLimit, { mode: 0o600 })
  const decoded = await readPrivateM3ActionDraft(input)
  assert.equal(decoded.length, atLimit.length)
  assert.equal(decoded[0], 'a')
  assert.equal(decoded.at(-1), 'a')
  assert.deepEqual(await readFile(input), atLimit)
  const overLimit = Buffer.concat([atLimit, Buffer.from('x')])
  await writeFile(input, overLimit, { mode: 0o600 })
  await assert.rejects(() => readPrivateM3ActionDraft(input), /unsafe private M3 input file/)
  const cliFailure = invoke(dir, input, '--text', '--store', 'plus')
  assert.notEqual(cliFailure.status, 0)
  assert.equal(cliFailure.stdout, '')
  assert.equal(cliFailure.stderr.includes(dir), false)
  assert.deepEqual(await readFile(input), overLimit)
})
