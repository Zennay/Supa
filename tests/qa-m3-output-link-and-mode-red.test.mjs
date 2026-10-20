import assert from 'node:assert/strict'
import test from 'node:test'
import { chmod, lstat, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { writeDerivedM3Output } from '../scripts/m3-source-output-preservation.mjs'

// Independent, synthetic-only expected-RED acceptance for #2039. The reviewed
// #2038 helper deliberately does NOT promise adversarial atomic publication.
// No real observation, retailer service, canonical schema or production file is touched.
async function withFiles(run) {
  const dir = await mkdtemp(join(tmpdir(), 'supa-m3-publish-'))
  const source = join(dir, 'source.json')
  const output = join(dir, 'derived.json')
  const sourceBytes = '{"private":"SYNTHETIC_ONLY_NOT_A_PARTICIPANT"}\n'
  await writeFile(source, sourceBytes)
  try {
    await run({ dir, source, output, sourceBytes })
    assert.equal(await readFile(source, 'utf8'), sourceBytes, 'original source bytes must remain intact')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

test('M3 output must refuse a symlink changed to a different private target before publication [expected RED]', async () => {
  await withFiles(async ({ dir, source, output }) => {
    const benign = join(dir, 'benign.json')
    const victim = join(dir, 'private-target.json')
    const victimBytes = '{"private":"KEEP_THESE_EXACT_BYTES"}\n'
    await writeFile(benign, 'benign\n')
    await writeFile(victim, victimBytes)

    // A controlled *pre-publication* link swap. This proves the pre-open link
    // behavior, not a precisely scheduled between-stat-and-open TOCTOU attack.
    await symlink(benign, output)
    await rm(output)
    await symlink(victim, output)
    assert.equal((await lstat(output)).isSymbolicLink(), true)

    await assert.rejects(
      () => writeDerivedM3Output(source, output, '{"derived":true}\n'),
      'a derived output must never follow a replaceable symlink into a third-party file',
    )
    assert.equal(await readFile(victim, 'utf8'), victimBytes)
    assert.equal(await readFile(benign, 'utf8'), 'benign\n')
  })
})

test('M3 republishing to a preexisting permissive report must not leave it world-readable [expected RED]', async () => {
  await withFiles(async ({ source, output }) => {
    await writeFile(output, 'OLD_SYNTHETIC_REPORT\n')
    await chmod(output, 0o644)
    await writeDerivedM3Output(source, output, '{"report":"SYNTHETIC_ONLY"}\n')
    assert.equal(await readFile(output, 'utf8'), '{"report":"SYNTHETIC_ONLY"}\n')
    assert.equal((await stat(output)).mode & 0o777, 0o600, 'republished M3 outputs must remain private')
  })
})

test('M3 brand-new distinct output stays private and leaves original source unmodified [positive control]', async () => {
  await withFiles(async ({ source, output }) => {
    const derived = '{"outcome":"unknown","deltaCents":null,"savingsCents":null,"publicSavingsClaimEligible":false}\n'
    await writeDerivedM3Output(source, output, derived)
    assert.equal(await readFile(output, 'utf8'), derived)
    assert.equal((await stat(output)).mode & 0o777, 0o600)
  })
})
