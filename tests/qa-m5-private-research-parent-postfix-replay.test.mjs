import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { loadPrivateRetailerResearch } from '../scripts/m5-assess-retailer-research.mjs'

const SCRIPT = new URL('../scripts/m5-assess-retailer-research.mjs', import.meta.url).pathname
const LEDGER = JSON.stringify({ version: 1, purpose: 'manual-research-only', reviews: [] }, null, 2)
const UNSUPPORTED = process.platform === 'win32'

async function withPrivateFixture(run) {
  const temporary = await mkdtemp(join(tmpdir(), 'supa-m5-private-parent-qa-'))
  try {
    const real = join(temporary, 'private')
    const middle = join(temporary, 'middle')
    await mkdir(real, { mode: 0o700 })
    await mkdir(middle, { mode: 0o700 })
    const source = join(real, 'research.json')
    await writeFile(source, LEDGER, { mode: 0o600 })
    const linkedParent = join(temporary, 'alias')
    const nestedParent = join(middle, 'alias')
    const linkedFile = join(temporary, 'alias-file.json')
    await symlink(real, linkedParent, 'dir')
    await symlink(real, nestedParent, 'dir')
    await symlink(source, linkedFile, 'file')
    await run({ source, linkedParent, nestedParent, linkedFile })
    assert.equal(await readFile(source, 'utf8'), LEDGER, 'original private ledger must remain byte-identical')
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}

function invoke(path) {
  return spawnSync(process.execPath, [SCRIPT, path], {
    encoding: 'utf8', cwd: process.cwd(), timeout: 15000,
  })
}
function assertGenericRefusal(result) {
  assert.equal(result.status, 2, 'untrusted private file path must be rejected')
  assert.equal(result.stdout, '', 'invalid private file must not emit even redacted summary')
  assert.match(result.stderr, /Offline M5 research assessment rejected the supplied file/)
  assert.doesNotMatch(result.stderr, /supa-m5-private-parent|research\.json|alias-file|@example\.invalid/)
}

test('M5 QA valid control: regular 0600 reviewer file is read through one descriptor', { skip: UNSUPPORTED }, async () => {
  await withPrivateFixture(async ({ source }) => {
    const parsed = await loadPrivateRetailerResearch(source)
    assert.deepEqual(parsed, JSON.parse(LEDGER))
  })
})

test('M5 QA valid control: real CLI on regular 0600 reviewer file emits only blocked research summary', { skip: UNSUPPORTED }, async () => {
  await withPrivateFixture(async ({ source }) => {
    const result = invoke(source)
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.stderr, '')
    const report = JSON.parse(result.stdout)
    assert.equal(report.reviewedCount, 0)
    assert.equal(report.missingCount, 17)
    assert.equal(report.m5Eligible, false)
    assert.equal(report.productionReady, false)
    assert.ok(report.retailers.every(x => !x.rightsVerified && !x.productionEnabled))
  })
})

test('M5 QA valid control: final-component symlink cannot bypass current O_NOFOLLOW', { skip: UNSUPPORTED }, async () => {
  await withPrivateFixture(async ({ linkedFile }) => {
    await assert.rejects(loadPrivateRetailerResearch(linkedFile))
    assertGenericRefusal(invoke(linkedFile))
  })
})

for (const [label, selector] of [
  ['immediate parent directory', fixture => join(fixture.linkedParent, 'research.json')],
  ['nested ancestor directory', fixture => join(fixture.nestedParent, 'research.json')],
]) {
  test(`M5 QA postrepair: reject ${label} symlink via exported private reader`, { skip: UNSUPPORTED }, async () => {
    await withPrivateFixture(async (fixture) => {
      await assert.rejects(loadPrivateRetailerResearch(selector(fixture)),
        undefined, 'symlink ancestor must never be admitted as a private research source')
    })
  })
}

test('M5 QA postrepair: real CLI must reject immediate symlink-directory ancestor', { skip: UNSUPPORTED }, async () => {
  await withPrivateFixture(async (fixture) => {
    assertGenericRefusal(invoke(join(fixture.linkedParent, 'research.json')))
  })
})

test('M5 QA postrepair: real CLI must reject nested symlink-directory ancestor', { skip: UNSUPPORTED }, async () => {
  await withPrivateFixture(async (fixture) => {
    assertGenericRefusal(invoke(join(fixture.nestedParent, 'research.json')))
  })
})
