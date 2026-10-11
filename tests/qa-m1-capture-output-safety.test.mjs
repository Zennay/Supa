import assert from 'node:assert/strict'
import { chmod, lstat, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { captureResearchSource } from '../scripts/m1-multistore-research.mjs'

// All paths use an injected local fake curl executable. NO retailer/network fetch.
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'supa-qa-research-output-'))
  const bin = join(root, 'bin')
  await mkdir(bin, { mode: 0o700 })
  const script = [
    '#!/bin/sh', "header=''", "body=''",
    'while [ "$#" -gt 0 ]; do',
    '  case "$1" in',
    '    --dump-header) header="$2"; shift 2 ;;',
    '    --output) body="$2"; shift 2 ;;',
    '    *) shift ;;',
    '  esac',
    'done',
    "printf 'HTTP/1.1 200 Synthetic\\r\\nContent-Type: text/html\\r\\n\\r\\n' > \"$header\"",
    "printf '<html>synthetic-local-no-retailer-response</html>' > \"$body\"",
    "printf '200'",
    '',
  ].join('\n')
  const curl = join(bin, 'curl')
  await writeFile(curl, script, { mode: 0o700 })
  await chmod(curl, 0o700)
  return { root, env: { PATH: bin + ':/usr/bin:/bin', SUPA_RESEARCH_APPROVED: '1' } }
}

function capture(f, outputDir) {
  return captureResearchSource('dirk-boodschappen', { env: f.env, outputDir })
}

test('local fake-HTTP capture creates owner-private nested directory and 0600 evidence files', async () => {
  const f = await fixture()
  try {
    const outputDir = join(f.root, 'private', 'snapshots')
    const result = await capture(f, outputDir)
    assert.equal(result.status, 'saved')
    assert.equal((await lstat(outputDir)).mode & 0o777, 0o700)
    assert.equal((await lstat(join(outputDir, 'dirk-boodschappen'))).mode & 0o777, 0o700)
    assert.equal((await lstat(result.html)).mode & 0o777, 0o600)
    assert.equal((await lstat(result.meta)).mode & 0o777, 0o600)
    assert.match(await readFile(result.html, 'utf8'), /synthetic-local/)
    const meta = JSON.parse(await readFile(result.meta, 'utf8'))
    assert.equal(meta.type, 'research-only-not-price-proof')
    assert.equal(meta.httpStatus, 200)
  } finally { await rm(f.root, { recursive: true, force: true }) }
})

test('parent symlink must reject before creating redirected private capture directories', async () => {
  const f = await fixture()
  try {
    const external = join(f.root, 'external-private')
    const alias = join(f.root, 'alias')
    await mkdir(external, { mode: 0o700 })
    await symlink(external, alias)
    await assert.rejects(capture(f, join(alias, 'new', 'snapshots')),
      /private|directory|alias|symlink|reject/i)
    await assert.rejects(lstat(join(external, 'new')), { code: 'ENOENT' })
  } finally { await rm(f.root, { recursive: true, force: true }) }
})

test('existing 0700 capture target reached through ancestor alias cannot receive snapshots', async () => {
  const f = await fixture()
  try {
    const external = join(f.root, 'external-private')
    const dest = join(external, 'snapshots')
    const alias = join(f.root, 'alias')
    await mkdir(dest, { recursive: true, mode: 0o700 })
    await symlink(external, alias)
    await assert.rejects(capture(f, join(alias, 'snapshots')),
      /private|directory|alias|symlink|reject/i)
    await assert.rejects(lstat(join(dest, 'dirk-boodschappen')), { code: 'ENOENT' })
  } finally { await rm(f.root, { recursive: true, force: true }) }
})

test('pre-existing group-readable capture root must be refused rather than silently reused', async () => {
  const f = await fixture()
  try {
    const shared = join(f.root, 'shared-output')
    await mkdir(shared, { mode: 0o755 })
    await assert.rejects(capture(f, shared), /private|directory|mode|permission|reject/i)
    await assert.rejects(lstat(join(shared, 'dirk-boodschappen')), { code: 'ENOENT' })
  } finally { await rm(f.root, { recursive: true, force: true }) }
})
