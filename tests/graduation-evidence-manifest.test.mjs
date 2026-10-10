import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const manifestPath = 'evidence/graduation/manifest.v1.json'

test('graduation evidence manifest keeps verified hashes and unresolved reflection provenance fail-closed', async () => {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))

  assert.equal(manifest.schemaVersion, 1)
  assert.equal(manifest.project, 'SUPA')
  assert.equal(manifest.artifactSet, 'graduation-2026')
  assert.equal(manifest.storage.provider, 'ChatGPT Library')

  const roles = manifest.artifacts.map((artifact) => artifact.role)
  assert.equal(new Set(roles).size, roles.length, 'artifact roles must stay unique')

  const canonicalNames = manifest.artifacts.map(
    (artifact) => artifact.canonicalFilename,
  )
  assert.equal(
    new Set(canonicalNames).size,
    canonicalNames.length,
    'canonical filenames must stay unique',
  )

  for (const artifact of manifest.artifacts) {
    assert.equal(Number.isSafeInteger(artifact.sizeBytes), true)
    assert.equal(artifact.sizeBytes > 0, true)

    if (artifact.archiveState === 'copied-to-canonical-folder') {
      assert.match(
        artifact.sha256,
        /^[0-9a-f]{64}$/,
        `${artifact.role} must retain a byte-verified SHA-256`,
      )
    }
  }

  const reflection = manifest.artifacts.find(
    (artifact) => artifact.role === 'reflection',
  )
  assert.ok(reflection, 'reflection artifact must remain in the manifest')
  assert.equal(reflection.sha256, null)
  assert.equal(reflection.archiveState, 'library-reference-only')
  assert.equal(reflection.sizeBytes, 36056)
  assert.equal(
    reflection.retrievalKey,
    'Reflectie_Supa_Zennay_500858050.pdf',
  )
  assert.equal(
    reflection.sourceFileId,
    'file_000000006154820d8689de4f81ee8784',
  )
  assert.equal(reflection.sourceVersionId, '1')
  assert.equal(
    reflection.lastRawByteVerificationAttemptResult,
    'blocked-unauthorized-materialization',
  )
  assert.match(
    reflection.lastRawByteVerificationAttemptAt,
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/,
  )
  assert.match(reflection.verificationNote, /No SHA-256 is claimed or inferred/i)
  assert.match(reflection.verificationNote, /raw-byte materialization is still unauthorized/i)
})
