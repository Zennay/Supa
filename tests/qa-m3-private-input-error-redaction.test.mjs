import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

const cases = [
  ['converter', 'scripts/m3-build-observed-study.mjs', /observation sheet JSON could not be read\/parsed/u],
  ['assessor', 'scripts/m3-assess-observed-week.mjs', /study JSON could not be read\/parsed/u],
]
const canary = 'SYNTHETIC_PRIVATE_ERROR_CANARY'

for (const [name, script, safeError] of cases) {
  for (const malformed of [false, true]) {
    test(`M3 ${name} redacts ${malformed ? 'invalid private JSON' : 'private missing path'} before stderr`, async () => {
      const root = await mkdtemp(join(tmpdir(), 'supa-m3-error-redaction-'))
      try {
        const input = join(root, canary + (malformed ? '-invalid.json' : '-missing.json'))
        const output = join(root, 'never-created-report.json')
        if (malformed) await writeFile(input, canary + '\n' + '{PRIVATE_JSON_FRAGMENT', 'utf8')
        const run = spawnSync(process.execPath,
          ['--experimental-strip-types', script, input, '--output', output],
          { cwd: process.cwd(), encoding: 'utf8', timeout: 15000 })
        assert.ifError(run.error)
        assert.notEqual(run.status, 0)
        assert.equal(run.stdout, '')
        assert.match(run.stderr, safeError)
        assert.doesNotMatch(run.stderr, /SYNTHETIC_PRIVATE_ERROR_CANARY|PRIVATE_JSON_FRAGMENT/u)
        assert.doesNotMatch(run.stderr, /ENOENT|Unexpected token|position \d+/u)
        await assert.rejects(stat(output), { code: 'ENOENT' })
      } finally { await rm(root, { recursive: true, force: true }) }
    })
  }
}
