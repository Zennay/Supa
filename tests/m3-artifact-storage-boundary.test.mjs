import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

function gitCheckIgnore(path) {
  return spawnSync(
    'git',
    ['check-ignore', '--no-index', '--quiet', path],
    { encoding: 'utf8' },
  )
}

test('generated M3 artifacts stay unversioned while canonical evidence stays versionable', () => {
  const generatedArtifact = gitCheckIgnore('artifacts/m3/observation-sheet.json')
  assert.equal(
    generatedArtifact.status,
    0,
    generatedArtifact.stderr || 'artifacts/m3 output must be ignored by Git',
  )

  const canonicalEvidence = gitCheckIgnore('evidence/m3/week-2026-40.json')
  assert.equal(
    canonicalEvidence.status,
    1,
    canonicalEvidence.stderr || 'evidence/m3 must remain versionable',
  )
})
