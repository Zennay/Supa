import assert from 'node:assert/strict'
import test from 'node:test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { cp, copyFile, mkdtemp, mkdir, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Revalidate open P1 #3182 on the newer six-adapter offline reader.
// Each run executes in its own temporary COPY of only the local code/fixtures.
// Never mutate a checked-in fixture or a parallel worker's checkout.
const exec = promisify(execFile)
const project = fileURLToPath(new URL('../', import.meta.url))
const fixtureName = 'plus-rendered-product-halfvolle-melk.v1.json'

async function isolatedCopy() {
  const root = await mkdtemp(join(tmpdir(), 'supa-qa-reviewed-archive-'))
  await cp(join(project, 'src'), join(root, 'src'), { recursive: true })
  await cp(join(project, 'fixtures', 'm1'), join(root, 'fixtures', 'm1'), { recursive: true })
  await mkdir(join(root, 'scripts'))
  for (const name of ['retailer-reviewed-ingest-engine.mjs', 'retailer-inert-json-admission.mjs']) {
    await copyFile(join(project, 'scripts', name), join(root, 'scripts', name))
  }
  await writeFile(join(root, 'package.json'), '{"type":"module"}\n')
  return root
}

async function run(root) {
  return exec(process.execPath, [
    '--experimental-strip-types',
    join(root, 'scripts', 'retailer-reviewed-ingest-engine.mjs'),
  ], { cwd: root, timeout: 30_000, maxBuffer: 128 * 1024 })
}

test('unaltered local historical six-fixture archive is usable privately', async () => {
  const root = await isolatedCopy()
  try {
    const { stdout } = await run(root)
    const result = JSON.parse(stdout)
    assert.equal(result.sources, 6)
    assert.equal(result.acceptedSources, 6)
    assert.equal(result.rejectedSources, 0)
    assert.equal(result.permissionVerified, false)
    assert.equal(result.productionEnabled, false)
    assert.equal(result.publicSavingsClaimEligible, false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('reviewed fixture reader refuses symlink leaf even if it contains identical bytes', async () => {
  const root = await isolatedCopy()
  try {
    const path = join(root, 'fixtures', 'm1', fixtureName)
    const archive = path + '.archive'
    await rename(path, archive)
    await symlink(archive, path)
    assert.equal(await readFile(path, 'utf8'), await readFile(archive, 'utf8'))
    await assert.rejects(run(root), error => error.code === 2)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('reviewed fixture reader refuses one-hop symlink ancestor directory with identical archive', async () => {
  const root = await isolatedCopy()
  try {
    const fixtureDir = join(root, 'fixtures', 'm1')
    await rename(fixtureDir, fixtureDir + '-archive')
    await symlink(fixtureDir + '-archive', fixtureDir, 'dir')
    await assert.rejects(run(root), error => error.code === 2)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
