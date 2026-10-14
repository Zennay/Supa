import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { buildObservationSheet } from '../scripts/m3-create-observation-sheet.mjs'
import { buildWeeklyBasketStudyFromObservationSheet } from '../scripts/m3-build-observed-study.mjs'

function syntheticSheet() {
  const sheet = buildObservationSheet()
  Object.assign(sheet.study, {
    studyId: 'synthetic-private-directories',
    participantKey: 'synthetic-only-participant',
    population: 'synthetic students',
    region: 'synthetic region',
    weekStart: '2026-10-05',
    priceContext: 'in-store',
  })
  for (const [side, store] of [['baseline', 'PLUS'], ['candidate', 'DekaMarkt']]) {
    const record = sheet[side]
    record.evidenceId = `synthetic-${side}`
    record.observedAt = side === 'baseline' ? '2026-10-07T12:00:00Z' : '2026-10-07T13:00:00Z'
    record.source = 'manual-cart'
    record.provenanceNote = 'Test-only fictional values; not real retailer evidence'
    record.store.id = `synthetic-${side}-store`
    record.store.name = `${store} synthetic fixture`
    record.lines.forEach((line) => { line.observedProduct = { available: false } })
  }
  return sheet
}

for (const kind of ['converter', 'assessment']) {
  test(`M3 ${kind} creates only new derived-output parent folders as private 0700`,
    { skip: process.platform === 'win32' }, async () => {
      const root = await mkdtemp(join(tmpdir(), `supa-qa-m3-${kind}-`))
      try {
        const original = join(root, 'preexisting-parent')
        const child = join(original, 'private-observations')
        const deeper = join(child, 'nested')
        const input = join(root, 'synthetic-input.json')
        const output = join(deeper, 'output.json')
        await mkdir(original)
        await chmod(original, 0o755)
        const source = syntheticSheet()
        const payload = kind === 'converter' ? source : buildWeeklyBasketStudyFromObservationSheet(source)
        await writeFile(input, JSON.stringify(payload))
        const script = kind === 'converter'
          ? 'scripts/m3-build-observed-study.mjs'
          : 'scripts/m3-assess-observed-week.mjs'
        const result = spawnSync(process.execPath,
          ['--experimental-strip-types', script, input, '--output', output],
          { cwd: process.cwd(), encoding: 'utf8', timeout: 15000 })
        assert.ifError(result.error)
        assert.equal(result.status, 0, result.stderr)
        assert.equal(result.stdout, '')
        assert.equal((await stat(original)).mode & 0o777, 0o755, 'existing directory permissions unchanged')
        for (const path of [child, deeper]) assert.equal((await stat(path)).mode & 0o777, 0o700)
        assert.equal((await stat(output)).mode & 0o777, 0o600)
        const data = JSON.parse(await readFile(output, 'utf8'))
        assert.equal(data.schemaVersion, 1)
        if (kind === 'assessment') assert.equal(data.publicSavingsClaimEligible, false)
      } finally {
        await rm(root, { recursive: true, force: true })
      }
    })
}
