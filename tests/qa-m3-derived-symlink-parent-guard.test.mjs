import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { buildObservationSheet } from '../scripts/m3-create-observation-sheet.mjs'
import { buildWeeklyBasketStudyFromObservationSheet } from '../scripts/m3-build-observed-study.mjs'

function inputSheet() {
  const sheet = buildObservationSheet()
  Object.assign(sheet.study, {
    studyId: 'synthetic-symlink-parent', participantKey: 'fictional-only',
    population: 'test-only', region: 'test-only', weekStart: '2026-10-05',
    priceContext: 'in-store',
  })
  for (const [side, name] of [['baseline', 'PLUS'], ['candidate', 'DekaMarkt']]) {
    const s = sheet[side]
    s.evidenceId = `${side}-fictional`
    s.observedAt = side === 'baseline' ? '2026-10-07T12:00:00Z' : '2026-10-07T13:00:00Z'
    s.source = 'manual-cart'
    s.provenanceNote = 'Fictional QA data, not observed retail evidence'
    s.store.id = `qa-${side}`
    s.store.name = `${name} synthetic fixture`
    for (const line of s.lines) line.observedProduct = { available: false }
  }
  return sheet
}

for (const kind of ['converter', 'assessment']) {
  test(`M3 ${kind} refuses symlinked parent directories without writing private evidence`,
    { skip: process.platform === 'win32' }, async () => {
      const dir = await mkdtemp(join(tmpdir(), `supa-m3-symlink-${kind}-`))
      try {
        const target = join(dir, 'actual-target')
        const alias = join(dir, 'output-alias')
        const input = join(dir, 'synthetic-input.json')
        const output = join(alias, 'nested-private', 'derived.json')
        const payload = kind === 'converter' ? inputSheet() : buildWeeklyBasketStudyFromObservationSheet(inputSheet())
        await writeFile(input, JSON.stringify(payload))
        await import('node:fs/promises').then(({ mkdir }) => mkdir(target))
        await symlink(target, alias, 'dir')
        const before = await readFile(input, 'utf8')
        const command = kind === 'converter'
          ? 'scripts/m3-build-observed-study.mjs'
          : 'scripts/m3-assess-observed-week.mjs'
        const run = spawnSync(process.execPath,
          ['--experimental-strip-types', command, input, '--output', output],
          { cwd: process.cwd(), encoding: 'utf8', timeout: 15000 })
        assert.ifError(run.error)
        assert.notEqual(run.status, 0)
        assert.equal(run.stdout, '')
        assert.match(run.stderr, /refusing symlinked M3 output parent directory/u)
        assert.doesNotMatch(run.stderr, /fictional-only|synthetic-symlink-parent/u)
        assert.equal(await readFile(input, 'utf8'), before)
        await assert.rejects(stat(join(target, 'nested-private', 'derived.json')), { code: 'ENOENT' })
        await assert.rejects(stat(join(target, 'nested-private')), { code: 'ENOENT' })
      } finally { await rm(dir, { recursive: true, force: true }) }
    })
}

// The kernel follows the symlink BEFORE resolving ".."; a lexical resolve
// done by preflight would erase this unsafe ancestor and miss the alias.
for (const kind of ['converter', 'assessment']) {
  test(`M3 ${kind} refuses symlink before a parent traversal in raw output`,
    { skip: process.platform === 'win32' }, async () => {
      const root = await mkdtemp(join(tmpdir(), `supa-m3-dotdot-${kind}-`))
      try {
        const physical = join(root, 'redirected')
        const inside = join(physical, 'inside')
        const alias = join(root, 'alias')
        const input = join(root, 'private-input.json')
        await mkdir(inside, { recursive: true })
        await symlink(inside, alias, 'dir')
        // Deliberately do not use path.join(), which erases /alias/../ first.
        const output = alias + '/..' + '/new-private/derived.json'
        const payload = kind === 'converter' ? inputSheet() : buildWeeklyBasketStudyFromObservationSheet(inputSheet())
        await writeFile(input, JSON.stringify(payload))
        const original = await readFile(input, 'utf8')
        const command = kind === 'converter'
          ? 'scripts/m3-build-observed-study.mjs'
          : 'scripts/m3-assess-observed-week.mjs'
        const run = spawnSync(process.execPath,
          ['--experimental-strip-types', command, input, '--output', output],
          { cwd: process.cwd(), encoding: 'utf8', timeout: 15000 })
        assert.ifError(run.error)
        assert.notEqual(run.status, 0)
        assert.equal(run.stdout, '')
        assert.match(run.stderr, /refusing symlinked M3 output parent directory/u)
        assert.equal(await readFile(input, 'utf8'), original)
        assert.doesNotMatch(run.stderr, /fictional-only|synthetic-symlink-parent/u)
        await assert.rejects(stat(join(physical, 'new-private', 'derived.json')), { code: 'ENOENT' })
        await assert.rejects(stat(join(root, 'new-private', 'derived.json')), { code: 'ENOENT' })
      } finally { await rm(root, { recursive: true, force: true }) }
    })
}
