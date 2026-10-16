import assert from 'node:assert/strict'
import test from 'node:test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { cp, copyFile, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Current integrated CLI replay of existing open P1 #3178. Fixture edits happen
// ONLY inside short-lived throwaway directory copies, never repo fixtures or
// parallel-worker working trees. No live HTTP, public prices or permissions.
const exec = promisify(execFile)
const repo = fileURLToPath(new URL('../', import.meta.url))

async function copyRunner() {
  const root = await mkdtemp(join(tmpdir(), 'supa-qa-raw-json-'))
  await cp(join(repo, 'src'), join(root, 'src'), { recursive: true })
  await cp(join(repo, 'fixtures', 'm1'), join(root, 'fixtures', 'm1'), { recursive: true })
  await mkdir(join(root, 'scripts'))
  for (const name of ['retailer-reviewed-ingest-engine.mjs', 'retailer-inert-json-admission.mjs']) {
    await copyFile(join(repo, 'scripts', name), join(root, 'scripts', name))
  }
  await writeFile(join(root, 'package.json'), '{"type":"module"}\n')
  return root
}

async function cli(root) {
  return exec(process.execPath, [
    '--experimental-strip-types',
    join(root, 'scripts', 'retailer-reviewed-ingest-engine.mjs'),
  ], { cwd: root, timeout: 30_000, maxBuffer: 128 * 1024 })
}

async function runWithRawMutation(mutate) {
  const root = await copyRunner()
  try {
    const path = join(root, 'fixtures', 'm1', 'plus-rendered-product-halfvolle-melk.v1.json')
    const before = await readFile(path, 'utf8')
    const after = mutate(before)
    assert.notEqual(after, before, 'fixture mutation must actually apply')
    assert.doesNotThrow(() => JSON.parse(after), 'ambiguous JSON is syntactically valid')
    await writeFile(path, after)
    await assert.rejects(cli(root), error => error.code === 2)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

test('canonical original six-fixture historical JSON remains privately readable', async () => {
  const root = await copyRunner()
  try {
    const result = JSON.parse((await cli(root)).stdout)
    assert.equal(result.sources, 6)
    assert.equal(result.acceptedSources, 6)
    assert.equal(result.permissionVerified, false)
    assert.equal(result.productionEnabled, false)
    assert.equal(result.publicSavingsClaimEligible, false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('raw archive rejects duplicate top-level source even if the last source is genuine', async () => {
  await runWithRawMutation(before => before.replace(
    '"version": 1,',
    '"version": 1,\\n  "source": {"id":"fictional-other", "supermarket":"dekamarkt", "kind":"product"},',
  ))
})

test('raw archive rejects conflicting duplicate capturedAt before JSON.parse last-write-wins', async () => {
  await runWithRawMutation(before => before.replace(
    '"capturedAt": "2026-10-04T18:08:57.837Z",',
    '"capturedAt": "2099-10-16T12:00:00Z",\\n    "capturedAt": "2026-10-04T18:08:57.837Z",',
  ))
})

test('raw archive rejects conflicting duplicate price values before parser can trust last value', async () => {
  await runWithRawMutation(before => before.replace(
    '"price": 0.85,',
    '"price": 99.99,\\n          "price": 0.85,',
  ))
})
