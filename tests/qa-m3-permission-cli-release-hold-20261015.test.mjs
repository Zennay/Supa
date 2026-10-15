import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Black-box proof of the actual production-source-rights CLI, not merely
// evaluateSourcePermissionGate() as a pure function. All authorizations below
// are *fictional negative/positive controls*, never actual retailer consent.
const CLI = fileURLToPath(new URL('../scripts/m1-check-source-permission-gate.mjs', import.meta.url))
const CURRENT = new URL('../evidence/m1/source-permission-gate.v1.json', import.meta.url)
const SYNTHETIC_GRANT = {
  kind: 'written_permission',
  url: 'https://example.invalid/fictional-test-authorization',
  finding: 'FICTIONAL TEST ONLY. Not actual retailer authorization.',
}

async function fixture() {
  return JSON.parse(await readFile(CURRENT, 'utf8'))
}

function runGate(path, strict = true) {
  const result = spawnSync(process.execPath,
    [CLI, ...(strict ? ['--require-production-ready'] : [])],
    {
      encoding: 'utf8',
      timeout: 20_000,
      env: { ...process.env, SUPA_SOURCE_PERMISSION_GATE: path },
    })
  assert.equal(result.error, undefined, result.error?.message)
  return result
}

async function withPrivateSyntheticFile(t, data) {
  const dir = await mkdtemp(join(tmpdir(), 'supa-qa-rights-cli-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const path = join(dir, 'fictional-gate.json')
  await writeFile(path, JSON.stringify(data), { mode: 0o600 })
  return path
}

test('M3 release hold: real repository rights record is readable but strict production CLI refuses it', () => {
  const strict = runGate(fileURLToPath(CURRENT))
  assert.equal(strict.status, 2, strict.stderr)
  assert.equal(strict.stderr, '')
  const record = JSON.parse(strict.stdout)
  assert.equal(record.productionReady, false)
  assert.deepEqual(record.blockers.map(x => [x.supermarket, x.permissionStatus, x.productionEnabled]), [
    ['plus', 'permission_required', false],
    ['dekamarkt', 'unresolved', false],
  ])
  const advisory = runGate(fileURLToPath(CURRENT), false)
  assert.equal(advisory.status, 0, advisory.stderr)
  assert.equal(JSON.parse(advisory.stdout).productionReady, false)
})

test('M3 release hold: fictional permission to only PLUS must not unlock DekaMarkt production', async t => {
  const document = await fixture()
  const plus = document.sources.find(x => x.supermarket === 'plus')
  plus.permissionStatus = 'permitted'
  plus.productionEnabled = true
  plus.evidence.push(SYNTHETIC_GRANT)
  const path = await withPrivateSyntheticFile(t, document)
  const result = runGate(path)
  assert.equal(result.status, 2, result.stderr)
  assert.equal(result.stderr, '')
  const state = JSON.parse(result.stdout)
  assert.equal(state.productionReady, false)
  assert.deepEqual(state.blockers.map(x => x.supermarket), ['dekamarkt'])
  assert.equal(state.blockers[0].productionEnabled, false)
})

test('M3 release hold: fictional permission to only DekaMarkt must not unlock PLUS production', async t => {
  const document = await fixture()
  const deka = document.sources.find(x => x.supermarket === 'dekamarkt')
  deka.permissionStatus = 'permitted'
  deka.productionEnabled = true
  deka.evidence.push(SYNTHETIC_GRANT)
  const path = await withPrivateSyntheticFile(t, document)
  const result = runGate(path)
  assert.equal(result.status, 2, result.stderr)
  const state = JSON.parse(result.stdout)
  assert.equal(state.productionReady, false)
  assert.deepEqual(state.blockers.map(x => x.supermarket), ['plus'])
})

test('M3 release hold: strict CLI accepts both explicitly authorized *fictional* sources only', async t => {
  const document = await fixture()
  for (const source of document.sources) {
    source.permissionStatus = 'permitted'
    source.productionEnabled = true
    source.evidence.push({ ...SYNTHETIC_GRANT })
  }
  const path = await withPrivateSyntheticFile(t, document)
  const result = runGate(path)
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stderr, '')
  const state = JSON.parse(result.stdout)
  assert.equal(state.productionReady, true)
  assert.deepEqual(state.blockers, [])
  assert.deepEqual(state.expectedSources, ['dekamarkt', 'plus'])
})

test('M3 release hold: forged permitted flags with no explicit grant fail closed in actual CLI', async t => {
  const document = await fixture()
  for (const source of document.sources) {
    source.permissionStatus = 'permitted'
    source.productionEnabled = true
    // Original terms/unknown-rights notes are not authorizations.
  }
  const path = await withPrivateSyntheticFile(t, document)
  const result = runGate(path)
  assert.notEqual(result.status, 0)
  assert.equal(result.stdout.includes('"productionReady": true'), false)
  assert.match(result.stderr, /cannot be marked permitted without explicit authorization evidence/)
})

test('M3 release hold: removing one retailer or inserting an unknown source cannot bypass pair coverage', async t => {
  const missing = await fixture()
  missing.sources = missing.sources.filter(x => x.supermarket !== 'dekamarkt')
  const unknown = await fixture()
  unknown.sources[1].supermarket = 'unknown-chain'
  for (const [scenario, document] of [['missing', missing], ['unknown', unknown]]) {
    const path = await withPrivateSyntheticFile(t, document)
    const result = runGate(path)
    assert.notEqual(result.status, 0, scenario)
    assert.equal(result.stdout.includes('"productionReady": true'), false, scenario)
    assert.ok(result.stderr.includes('source') || result.stderr.includes('permission gate'), scenario)
  }
})
