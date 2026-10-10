import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { buildBlankM3FieldChecklistCsv } from '../scripts/m3-export-blank-field-checklist.mjs'
import { parseM3FieldCsv } from '../scripts/m3-review-field-csv.mjs'

function syntheticFilledCsv() {
  const rows = parseM3FieldCsv(buildBlankM3FieldChecklistCsv())
  for (const row of rows.slice(1)) {
    row[7] = '2026-10-10T10:00:00Z'
    row[8] = 'in-store'
    row[9] = 'synthetic fictional product, not retail evidence'
    row[10] = '1'
    row[11] = row[6]
    row[12] = '1'
    row[13] = '199'
    row[14] = 'ja'
    row[15] = 'test-only source'
  }
  return rows.map(row => row.map(value =>
    '"' + String(value).replaceAll('"', '""') + '"').join(',')).join('\n') + '\n'
}

test('M3 optional --require-complete rejects blank CSV with JSON counts but no source disclosure', () => {
  const dir = mkdtempSync(join(tmpdir(), 'supa-preflight-required-'))
  try {
    const file = join(dir, 'private-m3-sensitive.csv')
    writeFileSync(file, buildBlankM3FieldChecklistCsv(), { mode: 0o600 })
    const run = (...args) => spawnSync(process.execPath, [
      '--experimental-strip-types', 'scripts/m3-review-field-csv.mjs', ...args,
    ], { encoding: 'utf8' })
    const original = run(file)
    assert.equal(original.status, 0, original.stderr)
    assert.equal(JSON.parse(original.stdout).completeRows, 0)

    const required = run('--require-complete', file)
    assert.equal(required.status, 2, required.stderr)
    const report = JSON.parse(required.stdout)
    assert.equal(report.status, 'incomplete-or-needs-review')
    assert.equal(report.completeRows, 0)
    assert.equal(report.evidenceVerified, false)
    assert.equal(report.releaseEligible, false)
    assert.equal(report.claimable, false)
    assert.equal(report.savingsCents, null)
    assert.equal(required.stderr, '')
    assert.doesNotMatch(required.stdout, /private-m3-sensitive|synthetic|199/)

    writeFileSync(file, syntheticFilledCsv(), { mode: 0o600 })
    const complete = run('--require-complete', file)
    assert.equal(complete.status, 0, complete.stderr)
    assert.equal(JSON.parse(complete.stdout).status, 'requires-canonical-human-verification')
    assert.equal(JSON.parse(complete.stdout).evidenceVerified, false)
    assert.equal(JSON.parse(complete.stdout).claimable, false)
    assert.equal(JSON.parse(complete.stdout).savingsCents, null)

    for (const badArgs of [
      ['--require-complete'], ['--require-complete', '--other'],
      ['--require-complete', file, file], [file, '--require-complete'],
      ['--unknown', file],
    ]) {
      const invalid = run(...badArgs)
      assert.equal(invalid.status, 1, badArgs.join(' '))
      assert.equal(invalid.stdout, '')
      assert.match(invalid.stderr, /field CSV review failed/)
      assert.doesNotMatch(invalid.stderr, /private-m3-sensitive|synthetic|199/)
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
