import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import { chmod, link, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildObservationSheet } from '../src/domain/m3ObservationSheet.ts'
import { safeM3OutstandingFieldChecklist } from '../scripts/qa-m3-private-outstanding-field-readguard-20261017.mjs'

const cli = fileURLToPath(new URL('../scripts/qa-m3-private-outstanding-field-readguard-20261017.mjs', import.meta.url))
const SECRET = 'FICTIONAL_PRIVATE_FIELD_PARTICIPANT_9981'
const ERROR = 'Private M3 outstanding checklist refused'
async function setup(t) {
  const dir = await mkdtemp(join(tmpdir(), 'supa-qa-outstanding-private-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  await chmod(dir, 0o700)
  const source = join(dir, 'original-secret-sheet.json')
  const sheet = buildObservationSheet()
  sheet.study.participantKey = SECRET
  sheet.baseline.lines[0].observedProduct.available = false
  sheet.candidate.lines[1].observedProduct.available = true
  sheet.candidate.lines[1].observedProduct.productName = 'DO_NOT_ECHO_FICTIONAL_PRODUCT'
  sheet.candidate.lines[1].observedProduct.priceCents = 981273
  const original = JSON.stringify(sheet)
  await writeFile(source, original, { mode: 0o600 })
  return { dir, source, original, sheet }
}
function run(...args) {
  const child = spawnSync(process.execPath, ['--experimental-strip-types', cli, ...args],
    { encoding: 'utf8', timeout: 15000 })
  assert.equal(child.error, undefined)
  return child
}
function assertPrivate(result, source) {
  const output = result.stdout + result.stderr
  for (const marker of [SECRET, 'DO_NOT_ECHO_FICTIONAL_PRODUCT',
    '981273', source, 'original-secret-sheet']) {
    assert.equal(output.includes(marker), false, 'private source value leaked')
  }
}
function assertRefusal(result, source) {
  assert.notEqual(result.status, 0)
  assert.equal(result.stdout, '')
  assert.equal(result.stderr, ERROR + '\n')
  assertPrivate(result, source)
}

test('private read-only checklist conserves exact PLUS/Deka 11x2 demand and never echoes private fields', async t => {
  const { source, original } = await setup(t)
  const before = await readFile(source, 'utf8')
  const report = await safeM3OutstandingFieldChecklist(source)
  assert.equal(report.expectedTotalLines, 22)
  assert.equal(report.remainingTotalLines, 21)
  assert.equal(report.retailers[0].completedLines, 1)
  assert.equal(report.retailers[1].pending[1].action, 'complete-product-pack-and-price')
  assert.deepEqual(report.retailers.map(x => x.retailer), ['PLUS', 'DekaMarkt'])
  assert.equal(report.verifiedRetailerObservations, false)
  assert.equal(report.publicSavingsClaimEligible, false)
  assert.equal(report.readyForPrivateReview, false)
  const json = run(source)
  assert.equal(json.status, 0, json.stderr)
  assert.deepEqual(JSON.parse(json.stdout), report)
  assertPrivate(json, source)
  const text = run(source, '--text')
  assert.equal(text.status, 0, text.stderr)
  assert.match(text.stdout, /PLUS: 10\/11 open/u)
  assert.match(text.stdout, /DekaMarkt: 11\/11 open/u)
  assert.match(text.stdout, /Geen onafhankelijke PLUS\/Deka-prijsverificatie/u)
  assertPrivate(text, source)
  assert.equal(await readFile(source, 'utf8'), original)
  assert.equal(before, original)
})

test('private checklist refuses permissive leaf, oversized draft, symlink, hardlink and directories', async t => {
  const { dir, source, original } = await setup(t)
  await chmod(source, 0o644)
  assertRefusal(run(source), source)
  await chmod(source, 0o600)
  const leaf = join(dir, 'alias-secret.json')
  await symlink(source, leaf)
  assertRefusal(run(leaf), leaf)
  const hard = join(dir, 'hard-secret.json')
  await link(source, hard)
  assertRefusal(run(source), source)
  await rm(hard)
  const actual = join(dir, 'actual')
  const alias = join(dir, 'aliased')
  await mkdir(actual, { mode: 0o700 })
  await symlink(actual, alias, 'dir')
  const nested = join(actual, 'field.json')
  await writeFile(nested, original, { mode: 0o600 })
  assertRefusal(run(join(alias, 'field.json')), join(alias, 'field.json'))
  assertRefusal(run(dir), dir)
  await writeFile(source, ' '.repeat(2 * 1024 * 1024 + 1), { mode: 0o600 })
  assertRefusal(run(source), source)
})

test('malformed UTF-8, BOM, invalid JSON and untrusted CLI args refuse without disclosure', async t => {
  const { dir, source, original } = await setup(t)
  for (const bytes of [Buffer.from([0xff, 0xfe]), '\ufeff' + original,
    '{ "participantKey":"'+SECRET+'",', 'null']) {
    await writeFile(source, bytes, { mode: 0o600 })
    assertRefusal(run(source), source)
  }
  await writeFile(source, original, { mode: 0o600 })
  for (const args of [
    [], [source, '--debug'], [source, '--text', '--verbose'],
    ['--help'], ['-' + source], [join(dir, 'unknown.json')],
  ]) assertRefusal(run(...args), source)
})

test('direct API rejects unsafe reference clocks and other invalid programmatic values', async t => {
  const { source } = await setup(t)
  await assert.rejects(safeM3OutstandingFieldChecklist(source, Infinity), /Private M3 outstanding checklist refused/u)
  await assert.rejects(safeM3OutstandingFieldChecklist(source, -1), /Private M3 outstanding checklist refused/u)
  await assert.rejects(safeM3OutstandingFieldChecklist(null), /Private M3 outstanding checklist refused/u)
})
