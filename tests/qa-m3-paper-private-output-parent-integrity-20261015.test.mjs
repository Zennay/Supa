import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, lstat, readFile, symlink, writeFile, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { renderM3PaperChecklist } from '../scripts/m3-print-field-checklist.mjs'

// Independent offline QA for the human paper worksheet. It contains NO real
// retailer prices, participants or evidence. Avoid modifying production/peer.
const command = 'scripts/m3-print-field-checklist.mjs'
function cli(path) {
  return spawnSync(process.execPath, [
    '--experimental-strip-types', command, '--output', path,
  ], { encoding: 'utf8', timeout: 8000 })
}
async function fixture(callback) {
  const temp = await mkdtemp(join(tmpdir(), 'supa-paper-private-output-'))
  try {
    const operator = join(temp, 'operator')
    const other = join(temp, 'other')
    const nested = join(other, 'nested')
    await mkdir(operator)
    await mkdir(nested, { recursive: true })
    const alias = join(operator, 'alias')
    await symlink(nested, alias, 'dir')
    await callback({ temp, operator, other, nested, alias })
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
}
async function assertAbsent(path) {
  await assert.rejects(() => lstat(path), error => error?.code === 'ENOENT')
}
function deny(result) {
  assert.equal(result.error, undefined, String(result.error))
  assert.equal(result.status, 1, 'unsafe output path must be refused')
  assert.equal(result.stdout, '', 'unsafe path must not produce a document')
  assert.equal(
    result.stderr.trim(),
    'Could not create blank M3 field worksheet; no observed prices were generated',
  )
  assert.doesNotMatch(result.stderr, /supa-paper-private-output-|worksheet\.html|operator|other/)
}

test('M3 paper CLI writes one canonical empty 22-row 3-state worksheet to safe private output', async () => {
  await fixture(async ({ operator }) => {
    const path = join(operator, 'worksheet.html')
    const run = cli(path)
    assert.equal(run.error, undefined, String(run.error))
    assert.equal(run.status, 0, run.stderr)
    assert.equal(run.stdout, '')
    const html = await readFile(path, 'utf8')
    assert.equal(html, renderM3PaperChecklist())
    assert.equal((html.match(/<tr data-m3-row="/g) || []).length, 22)
    assert.equal((html.match(/☐ ja ☐ nee ☐ onbekend/g) || []).length, 22)
    assert.doesNotMatch(html, /<script\b|https?:\/\/(?:plus|dekamarkt)\.nl/i)
    if (process.platform !== 'win32') {
      assert.equal((await lstat(path)).mode & 0o777, 0o600)
    }
  })
})

test('M3 paper CLI refuses to publish a new worksheet through a symlinked parent directory', async (t) => {
  if (process.platform !== 'linux') return t.skip('Linux static parent path boundary')
  await fixture(async ({ nested, alias }) => {
    const escaped = join(nested, 'worksheet.html')
    await assertAbsent(escaped)
    deny(cli(join(alias, 'worksheet.html')))
    await assertAbsent(escaped)
  })
})

test('M3 paper CLI rejects symlink-before-dotdot parent aliases, without creating an external file', async (t) => {
  if (process.platform !== 'linux') return t.skip('Linux kernel symlink traversal boundary')
  await fixture(async ({ temp, alias }) => {
    const destination = join(temp, 'other', 'target')
    await mkdir(destination)
    const actual = join(destination, 'worksheet.html')
    const raw = alias + '/../target/worksheet.html'
    const marker = join(destination, 'marker.txt')
    await writeFile(marker, 'marker', { mode: 0o600 })
    assert.equal(await readFile(alias + '/../target/marker.txt', 'utf8'), 'marker')
    assert.notEqual(resolve(raw), actual, 'Node lexical normalization must lose alias provenance')
    await assertAbsent(actual)
    deny(cli(raw))
    await assertAbsent(actual)
  })
})

test('M3 paper CLI denies an existing destination including a final component symlink', async (t) => {
  if (process.platform !== 'linux') return t.skip('Linux symlink boundary')
  await fixture(async ({ operator, other }) => {
    const existing = join(other, 'private-existing.html')
    await writeFile(existing, 'retain-original', { mode: 0o600 })
    const alias = join(operator, 'linked.html')
    await symlink(existing, alias)
    deny(cli(alias))
    assert.equal(await readFile(existing, 'utf8'), 'retain-original')
    deny(cli(existing))
    assert.equal(await readFile(existing, 'utf8'), 'retain-original')
  })
})
