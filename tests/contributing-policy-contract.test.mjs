import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const guideUrl = new URL('../CONTRIBUTING.md', import.meta.url)

test('contributor guide locks validation and evidence boundaries', async () => {
  const guide = await readFile(guideUrl, 'utf8')

  for (const command of [
    'npm ci',
    'npm audit --audit-level=high',
    'npm test',
    'npm run m1:matching-benchmark',
    'npm run m1:source-permission-gate',
    'npm run build',
  ]) {
    assert.match(guide, new RegExp(command.replace(/[.*+?^$()|[\]{}\\]/g, '\\$&')))
  }

  assert.match(guide, /npm ci\s+\n?npm audit --audit-level=high\s+\n?npm test/)
  assert.match(guide, /exact (PR )?head/i)
  assert.match(guide, /mock, generated, deterministic, replayed, or fixture data/i)
  assert.match(guide, /not.*genuine retailer evidence/i)
  assert.match(guide, /not.*proof of savings/i)
  assert.match(guide, /issue #78/i)
  assert.match(guide, /PLUS baseline \+ DekaMarkt candidate/i)
  assert.match(guide, /permission\/licensing gated/i)
  assert.match(guide, /SECURITY\.md/)
})

test('contributor guide preserves active-owner coordination', async () => {
  const guide = await readFile(guideUrl, 'utf8')

  assert.match(guide, /Check open pull requests/i)
  assert.match(guide, /active owner/i)
  assert.match(guide, /Do not overwrite or absorb another active worker/i)
})
