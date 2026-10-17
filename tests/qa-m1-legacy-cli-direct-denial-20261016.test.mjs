import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import { SOURCES } from '../scripts/m1-capture-sources.mjs'
import { evaluateSourcePermissionGate } from '../scripts/m1-check-source-permission-gate.mjs'

const repo = fileURLToPath(new URL('../', import.meta.url))
const captureCommand = fileURLToPath(new URL('../scripts/m1-capture-sources.mjs', import.meta.url))
const canonicalGate = new URL('../evidence/m1/source-permission-gate.v1.json', import.meta.url)

async function missing(file) {
  await assert.rejects(access(file), { code: 'ENOENT' }, file + ' must not be created')
}

test('independent acceptance: current PLUS/Deka denial covers every legacy M1 capture source', async () => {
  const current = JSON.parse(await readFile(canonicalGate, 'utf8'))
  const report = evaluateSourcePermissionGate(current)
  assert.equal(report.productionReady, false, 'this test protects the currently denied source policy')
  assert.deepEqual(report.blockers.map(x => x.supermarket).sort(), ['dekamarkt', 'plus'])
  assert.equal(SOURCES.length, 6, 'the guarded legacy command must cover six source routes')
  assert.deepEqual(
    [...new Set(SOURCES.map(s => s.supermarket))].sort(), ['dekamarkt', 'plus'],
  )
  for (const supermarket of ['plus', 'dekamarkt']) {
    assert.deepEqual(
      SOURCES.filter(s => s.supermarket === supermarket).map(s => s.kind).sort(),
      ['catalog', 'offers', 'product'],
    )
  }
})

test('real legacy M1 CLI rejects before fetch and artifact creation from repo or other working directory', async () => {
  const temp = await mkdtemp(path.join(tmpdir(), 'supa-independent-m1-cli-'))
  try {
    // This preload replaces fetch in the separate CLI process. A regression
    // can be proven RED without issuing even one real retailer request.
    const intercept = path.join(temp, 'intercept-fetch.mjs')
    await writeFile(intercept, [
      "import { writeFileSync } from 'node:fs'",
      "globalThis.fetch = () => {",
      "  writeFileSync(process.env.SUPA_QA_FETCH_MARK, 'intercepted')",
      "  throw new Error('QA_FETCH_MUST_NOT_RUN')",
      "}",
      '',
    ].join('\n'))
    for (const where of ['repository-root', 'unrelated-working-directory']) {
      const work = path.join(temp, where)
      await mkdir(work)
      const captureDir = path.join(work, 'capture-must-not-exist')
      const intercepted = path.join(work, 'fetch-must-not-exist')
      const cwd = where === 'repository-root' ? repo : work
      const child = spawnSync(process.execPath, [
        '--import', intercept, captureCommand,
      ], {
        cwd,
        encoding: 'utf8',
        timeout: 12_000,
        maxBuffer: 256_000,
        env: {
          ...process.env,
          SUPA_CAPTURE_DIR: captureDir,
          SUPA_QA_FETCH_MARK: intercepted,
          // A caller must not replace the checked-in canonical rights policy
          // with an arbitrary environment-controlled alternative.
          SUPA_SOURCE_PERMISSION_GATE: path.join(work, 'unreviewed.json'),
          SUPA_M1_SOURCE_PERMISSION_FILE: path.join(work, 'unreviewed.json'),
        },
      })
      assert.equal(child.error, undefined, String(child.error))
      assert.notEqual(child.status, 0, where + ': denied CLI must exit nonzero')
      const output = (child.stderr || '') + (child.stdout || '')
      assert.match(output, /M1 external capture denied: canonical retailer source rights not verified/,
        where + ': denial must be unambiguous')
      assert.doesNotMatch(output, /QA_FETCH_MUST_NOT_RUN/, where + ': transport must never start')
      await missing(intercepted)
      await missing(captureDir)
      await missing(path.join(work, 'artifacts'))
    }
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
})
