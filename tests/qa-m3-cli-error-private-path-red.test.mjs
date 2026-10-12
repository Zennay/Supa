// Synthetic, add-only expected-RED QA for Supa issue #2035.
// Private names here are fictional canary strings. No retailer or participant data.
// This suite tests CLI error-channel privacy; it does not modify CLI owners.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CONVERTER = join(ROOT, 'scripts/m3-build-observed-study.mjs')
const ASSESSOR = join(ROOT, 'scripts/m3-assess-observed-week.mjs')
const PRIVATE_CANARY = 'SYNTHETIC_PARTICIPANT_DO_NOT_PRINT_13579'

function withScratch(callback) {
  const directory = mkdtempSync(join(tmpdir(), 'supa-cli-error-privacy-'))
  try {
    return callback(directory)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

function run(script, input, output) {
  const result = spawnSync(
    process.execPath,
    ['--experimental-strip-types', script, input, '--output', output],
    { cwd: ROOT, encoding: 'utf8', timeout: 15000 },
  )
  assert.equal(result.error, undefined, result.error?.message)
  assert.notEqual(result.status, 0, 'unreadable input must fail closed')
  assert.equal(result.stdout, '', 'failed CLI must not write study/report to stdout')
  assert.equal(existsSync(output), false, 'failed CLI must not publish a report')
  return result
}

for (const [label, script] of [
  ['converter', CONVERTER],
  ['assessor', ASSESSOR],
]) {
  test(`M3 ${label}: missing input path containing fictional private participant key is redacted from stderr [expected RED]`, () => {
    withScratch((directory) => {
      const missing = join(directory, PRIVATE_CANARY, 'source.json')
      const report = join(directory, 'report.json')
      const result = run(script, missing, report)
      assert.doesNotMatch(
        result.stderr,
        new RegExp(PRIVATE_CANARY),
        'reading an absent file must not echo a private path/participant key to logs',
      )
    })
  })

  test(`M3 ${label}: ordinary missing input remains a safe non-success without published output [control]`, () => {
    withScratch((directory) => {
      const missing = join(directory, 'unavailable.json')
      const report = join(directory, 'report.json')
      const result = run(script, missing, report)
      assert.match(result.stderr, /could not be read\/parsed/)
      assert.doesNotMatch(result.stderr, /SYNTHETIC_PARTICIPANT_DO_NOT_PRINT/)
    })
  })
}
