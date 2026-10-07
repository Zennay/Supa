import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const browserProof = await readFile(
  new URL('./m2-browser-e2e.mjs', import.meta.url),
  'utf8',
)

test('M2 browser evidence binds itself to GitHub run and revision provenance', () => {
  for (const requiredSource of [
    'GITHUB_SHA',
    'GITHUB_RUN_ID',
    'GITHUB_RUN_ATTEMPT',
    'GITHUB_EVENT_PATH',
    'pullRequestHeadSha',
    'pullRequestBaseSha',
    'provenance: null',
    'evidence.provenance = await readGithubProvenance()',
  ]) {
    assert.ok(
      browserProof.includes(requiredSource),
      `missing browser-evidence provenance source: ${requiredSource}`,
    )
  }

  assert.match(
    browserProof,
    /provenance\.eventName === ['"]pull_request['"][\s\S]*?pullRequestHeadSha[\s\S]*?\^\[0-9a-f\]\{40\}\$/i,
    'pull-request browser evidence must fail closed without a 40-character head SHA',
  )
  assert.match(
    browserProof,
    /provenance\.runId[\s\S]*?\^\\d\+\$/,
    'GitHub Actions browser evidence must require a numeric run ID',
  )

  const tryBoundary = browserProof.indexOf('try {')
  const provenanceRead = browserProof.indexOf(
    'evidence.provenance = await readGithubProvenance()',
  )
  const catchBoundary = browserProof.indexOf('} catch (error) {')

  assert.ok(tryBoundary >= 0, 'browser proof must keep an evidence try boundary')
  assert.ok(
    provenanceRead > tryBoundary && provenanceRead < catchBoundary,
    'provenance must be collected inside the evidence try/catch so failures still write result.json',
  )
})
