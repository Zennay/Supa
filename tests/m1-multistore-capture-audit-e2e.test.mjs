import assert from 'node:assert/strict'
import { basename, join } from 'node:path'
import { chmod, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import test from 'node:test'

import { captureResearchSource } from '../scripts/m1-multistore-research.mjs'
import { auditCaptureFiles } from '../scripts/m1-research-snapshot-audit.mjs'

// Synthetic transport executable: no outbound network, live DOM, or price proof.
async function installSyntheticCurl(dir, responseStatus) {
  const bin = join(dir, 'bin')
  await mkdir(bin)
  const code = [
    '#!/bin/sh',
    "headers=''",
    "body=''",
    'while [ "$#" -gt 0 ]; do',
    '  case "$1" in',
    '    --dump-header) headers="$2"; shift 2 ;;',
    '    --output) body="$2"; shift 2 ;;',
    '    *) shift ;;',
    '  esac',
    'done',
    "printf 'HTTP/1.1 " + responseStatus + " Fixture\\r\\nContent-Type: text/html; charset=utf-8\\r\\n\\r\\n' > \"$headers\"",
    "printf '<html><body>synthetic fixture no pricing</body></html>' > \"$body\"",
    "printf '" + responseStatus + "'",
    '',
  ].join('\n')
  const file = join(bin, 'curl')
  await writeFile(file, code)
  await chmod(file, 0o700)
  return bin
}

for (const proxyEnabled of [false, true]) {
  test(`end-to-end private research capture -> offline audit: ${proxyEnabled ? 'fixed approved proxy' : 'direct'}`, async () => {
    const dir = await mkdtemp(join(tmpdir(), 'supa-m1-audit-e2e-'))
    try {
      const bin = await installSyntheticCurl(dir, 200)
      const outputDir = join(dir, 'snapshots')
      const env = { PATH: bin + ':/usr/bin:/bin', SUPA_RESEARCH_APPROVED: '1' }
      if (proxyEnabled) env.SUPA_RESEARCH_PROXY_URL = 'http://127.0.0.1:3128'
      const saved = await captureResearchSource('dirk-halvarine', { env, outputDir })
      const stem = basename(saved.html, '.html')
      const report = await auditCaptureFiles({ sourceId: 'dirk-halvarine', stem, outputDir })
      assert.equal(report.status, 'manual-review')
      assert.equal(report.semanticVerified, false)
      assert.equal(report.livePriceVerified, false)
      assert.equal(report.publicSavingsClaimEligible, false)
      assert.deepEqual(report.reasons, [])
      assert.equal(report.sourceId, 'dirk-halvarine')
      assert.doesNotMatch(JSON.stringify(report), /synthetic fixture|127\\.0\\.0\\.1|\/boodschappen|charset/)
      const savedMeta = JSON.parse(await readFile(saved.meta, 'utf8'))
      assert.equal(savedMeta.proxyMode, proxyEnabled ? 'approved-fixed-egress' : 'direct')
      assert.equal(savedMeta.sha256, saved.sha256)
      savedMeta.bytes += 1
      await writeFile(saved.meta, JSON.stringify(savedMeta))
      const tampered = await auditCaptureFiles({ sourceId: 'dirk-halvarine', stem, outputDir })
      assert.equal(tampered.status, 'rejected')
      assert.ok(tampered.reasons.includes('capture-integrity-mismatch'))
    } finally { await rm(dir, { recursive: true, force: true }) }
  })
}

test('denied request never creates a snapshot for offline audit', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'supa-m1-audit-denial-'))
  try {
    const bin = await installSyntheticCurl(dir, 403)
    const outputDir = join(dir, 'snapshots')
    await assert.rejects(captureResearchSource('dirk-halvarine', {
      outputDir, env: { PATH: bin + ':/usr/bin:/bin', SUPA_RESEARCH_APPROVED: '1' },
    }), /HTTP 403/)
    const files = await readdir(dir)
    assert.deepEqual(files, ['bin'])
  } finally { await rm(dir, { recursive: true, force: true }) }
})
