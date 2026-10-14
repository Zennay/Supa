import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { compareCaptureDirectories } from '../scripts/m5-compare-capture-signatures.mjs'

async function makeManifest(results) {
  const root = await mkdtemp(join(tmpdir(), 'supa-m5-mixed-raw-success-'))
  const raw = JSON.stringify({
    milestone: 'M1 Data Feasibility', bounded: true,
    sourceCount: results.length, results,
  })
  const file = join(root, 'manifest.json')
  await writeFile(file, raw)
  return { root, file, raw }
}
const record = (id, success) => ({
  id, supermarket: 'fictional', kind: 'product',
  success, sha256: 'a'.repeat(64),
})

test('one malformed success rejects entire local cohort before missing HTML traversal', async () => {
  for (const success of ['false', 'true', '0', 0, 1, null, {}, [], '']) {
    const input = await makeManifest([
      record('would-require-file', true),
      record('forged-status', success),
    ])
    try {
      await assert.rejects(
        () => compareCaptureDirectories(input.root),
        /^Error: Invalid or oversized M1 capture manifest$/)
      assert.equal(await readFile(input.file, 'utf8'), input.raw)
    } finally {
      await rm(input.root, { recursive: true, force: true })
    }
  }
})

test('bad baseline raw success is refused before reading current SHA-verified source file', async () => {
  const current = await makeManifest([record('would-require-current-file', true)])
  const baseline = await makeManifest([record('bad-baseline', 'false')])
  try {
    await assert.rejects(
      () => compareCaptureDirectories(current.root, baseline.root),
      /^Error: Invalid or oversized M1 capture manifest$/)
    assert.equal(await readFile(current.file, 'utf8'), current.raw)
    assert.equal(await readFile(baseline.file, 'utf8'), baseline.raw)
  } finally {
    await rm(current.root, { recursive: true, force: true })
    await rm(baseline.root, { recursive: true, force: true })
  }
})
