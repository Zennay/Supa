import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { dirname, relative, sep } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const testsDirectory = dirname(fileURLToPath(import.meta.url))
const packageJson = JSON.parse(
  await readFile(new URL('../package.json', import.meta.url), 'utf8'),
)

async function collectTestFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    const path = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, directory.endsWith('/') ? directory : `${directory}/`)

    if (entry.isDirectory()) {
      files.push(...await collectTestFiles(fileURLToPath(path)))
      continue
    }

    if (entry.isFile() && entry.name.endsWith('.test.mjs')) {
      files.push(fileURLToPath(path))
    }
  }

  return files
}

test('npm test keeps the explicit top-level Node test glob', () => {
  assert.equal(
    packageJson.scripts?.test,
    'node --experimental-strip-types --test tests/*.test.mjs',
  )
})

test('every Node test remains discoverable by the top-level test glob', async () => {
  const testFiles = await collectTestFiles(testsDirectory)
  const nestedTests = testFiles
    .map((path) => relative(testsDirectory, path))
    .filter((path) => path.includes(sep))

  assert.deepEqual(
    nestedTests,
    [],
    `nested Node tests are not selected by npm test: ${nestedTests.join(', ')}`,
  )
})
