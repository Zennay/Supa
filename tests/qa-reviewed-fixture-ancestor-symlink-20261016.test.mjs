import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readBoundedRegularReviewedFixture } from '../scripts/retailer-reviewed-ingest-engine.mjs'

// Synthetic private files only. This probes the newly exported archive reader,
// not an allowed retailer URL or live price capture.
async function fixturePaths(check) {
  const root = await mkdtemp(join(tmpdir(), 'supa-retailer-ancestor-'))
  const actualDirectory = join(root, 'actual')
  const aliases = join(root, 'alias')
  try {
    await mkdir(actualDirectory, { mode: 0o700 })
    const file = join(actualDirectory, 'source.json')
    const value = { source: { supermarket: 'plus', kind: 'product' }, version: 1 }
    await writeFile(file, JSON.stringify(value), { mode: 0o600, flag: 'wx' })
    await symlink(actualDirectory, aliases, 'dir')
    return await check({ root, actualDirectory, aliases, file, value })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

test('regular owner-private direct fixture path still yields exact original bytes', () =>
  fixturePaths(async ({ file, value }) => {
    assert.deepEqual(await readBoundedRegularReviewedFixture(file), value)
  }))

test('an intermediate symlink must not impersonate an authenticated reviewed fixture [EXPECTED RED]', () =>
  fixturePaths(async ({ aliases }) => {
    await assert.rejects(
      readBoundedRegularReviewedFixture(join(aliases, 'source.json')),
      /reviewed fixture|identity|ancestor|symlink|unsafe|regular file/i,
    )
  }))

test('a two-hop intermediate symlink must not be accepted by O_NOFOLLOW on final file [EXPECTED RED]', () =>
  fixturePaths(async ({ root, aliases }) => {
    const second = join(root, 'second-alias')
    await symlink(aliases, second, 'dir')
    await assert.rejects(
      readBoundedRegularReviewedFixture(join(second, 'source.json')),
      /reviewed fixture|identity|ancestor|symlink|unsafe|regular file/i,
    )
  }))
