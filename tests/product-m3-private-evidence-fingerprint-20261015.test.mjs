import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import {
  chmod, link, mkdtemp, mkdir, readFile, rm, symlink, writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fingerprintPrivateM3Draft } from '../scripts/m3-private-evidence-fingerprint.mjs'

const SCRIPT = fileURLToPath(new URL('../scripts/m3-private-evidence-fingerprint.mjs', import.meta.url))

// Entirely fabricated format scaffold; no participant, shop price or observed retailer evidence.
function fictionalDraft(extra = '') {
  const lines = Array.from({ length: 11 }, (_, i) => ({
    ingredientId: 'synthetic-' + i, observedProduct: { available: null },
  }))
  return JSON.stringify({
    schemaVersion: 1,
    sheetType: 'm3-manual-cart-observation-sheet',
    requirements: Array.from({ length: 11 }, (_, i) => ({ id: 'synthetic-' + i })),
    baseline: { lines }, candidate: { lines },
    note: extra,
  })
}

async function withPrivateDraft(callback) {
  const directory = await mkdtemp(join(tmpdir(), 'supa-m3-private-sha-test-'))
  const filename = join(directory, 'synthetic-private.json')
  await writeFile(filename, fictionalDraft(), { mode: 0o600 })
  try { return await callback(filename, directory) }
  finally { await rm(directory, { recursive: true, force: true }) }
}

test('valid synthetic 11+11 private draft has byte-exact SHA256 and no content disclosure', async () => {
  await withPrivateDraft(async filename => {
    const bytes = await readFile(filename)
    const expected = createHash('sha256').update(bytes).digest('hex')
    assert.deepEqual(await fingerprintPrivateM3Draft(filename), {
      bytes: bytes.length, sha256: expected,
    })
    const child = spawnSync(process.execPath, [SCRIPT, filename], { encoding: 'utf8' })
    assert.equal(child.status, 0, child.stderr)
    assert.match(child.stdout, /^PRIVATE M3 draft \(not price verification, consent or savings proof\)\n/)
    assert.match(child.stdout, new RegExp('sha256: ' + expected))
    assert.doesNotMatch(child.stdout, /synthetic-private|ingredientId|observedProduct|participant/i)
    assert.equal(child.stderr, '')
  })
})

test('private draft source must be mode 0600-ish with only one hardlink', async () => {
  await withPrivateDraft(async (filename, dir) => {
    await chmod(filename, 0o644)
    await assert.rejects(fingerprintPrivateM3Draft(filename), /private M3 draft refused/)
    await chmod(filename, 0o600)
    const second = join(dir, 'duplicate.json')
    await link(filename, second)
    await assert.rejects(fingerprintPrivateM3Draft(filename), /private M3 draft refused/)
  })
})

test('symlinked final source and any symlinked ancestor are refused', async () => {
  await withPrivateDraft(async (filename, dir) => {
    const alias = join(dir, 'alias.json')
    await symlink(filename, alias)
    await assert.rejects(fingerprintPrivateM3Draft(alias), /private M3 draft refused/)
    const parent = join(dir, 'parent')
    await mkdir(parent)
    const real = join(parent, 'real.json')
    await writeFile(real, fictionalDraft(), { mode: 0o600 })
    const parentAlias = join(dir, 'alias-parent')
    await symlink(parent, parentAlias)
    await assert.rejects(
      fingerprintPrivateM3Draft(join(parentAlias, 'real.json')),
      /private M3 draft refused/,
    )
  })
})

test('malformed JSON, malformed UTF-8 and forged 11+11 structure are not fingerprinted', async () => {
  await withPrivateDraft(async filename => {
    for (const bytes of [
      Buffer.from('{ private contact: synthetic@invalid.example }'),
      Buffer.from([0xc3, 0x28]),
      Buffer.from(JSON.stringify({ schemaVersion: 1, sheetType: 'm3-manual-cart-observation-sheet', requirements: [], baseline: { lines: [] }, candidate: { lines: [] } })),
    ]) {
      await writeFile(filename, bytes, { mode: 0o600 })
      await assert.rejects(fingerprintPrivateM3Draft(filename), /private M3 draft refused/)
    }
  })
})

test('strict 2 MiB physical byte ceiling: exact boundary passes, next byte refuses', async () => {
  await withPrivateDraft(async filename => {
    const base = fictionalDraft('')
    const prefix = Buffer.byteLength(base)
    const exactly = fictionalDraft('x'.repeat(2 * 1024 * 1024 - prefix))
    assert.equal(Buffer.byteLength(exactly), 2 * 1024 * 1024)
    await writeFile(filename, exactly, { mode: 0o600 })
    const output = await fingerprintPrivateM3Draft(filename)
    assert.equal(output.bytes, 2 * 1024 * 1024)
    await writeFile(filename, fictionalDraft('x'.repeat(2 * 1024 * 1024 + 1 - prefix)), { mode: 0o600 })
    await assert.rejects(fingerprintPrivateM3Draft(filename), /private M3 draft refused/)
  })
})

test('CLI failure never prints private input path or synthetic direct contact text', async () => {
  await withPrivateDraft(async filename => {
    const sensitive = 'synthetic-contact@not-real.example'
    await writeFile(filename, JSON.stringify({ participant: sensitive }), { mode: 0o600 })
    const child = spawnSync(process.execPath, [SCRIPT, filename], { encoding: 'utf8' })
    assert.notEqual(child.status, 0)
    assert.equal(child.stdout, '')
    assert.equal(child.stderr.trim(), 'private M3 draft refused (regular 0600 single-link JSON file, maximum 2 MiB required)')
    assert.doesNotMatch(child.stderr, /synthetic-contact|not-real\.example|supa-m3-private-sha-test/)
  })
})

test('CLI --help is intentionally informational and does not touch files', () => {
  const child = spawnSync(process.execPath, [SCRIPT, '--help'], { encoding: 'utf8' })
  assert.equal(child.status, 0)
  assert.match(child.stdout, /Usage: node scripts\/m3-private-evidence-fingerprint\.mjs/)
})
