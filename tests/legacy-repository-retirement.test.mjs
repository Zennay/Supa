import assert from 'node:assert/strict'
import { access, readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'

const removedLegacyFiles = [
  'src/data/repository.ts',
  'src/data/mockRepository.ts',
  'src/data/mock.ts',
]

async function sourceFiles(root) {
  const entries = await readdir(root, { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    const entryPath = path.join(root, entry.name)
    if (entry.isDirectory()) {
      files.push(...await sourceFiles(entryPath))
    } else if (/\.(?:ts|tsx)$/.test(entry.name)) {
      files.push(entryPath)
    }
  }

  return files
}

test('legacy repository and mock fixture stay retired from product source', async () => {
  for (const file of removedLegacyFiles) {
    await assert.rejects(
      access(file),
      (error) => error?.code === 'ENOENT',
      `${file} must remain removed`,
    )
  }

  for (const file of await sourceFiles('src')) {
    const source = await readFile(file, 'utf8')
    assert.doesNotMatch(
      source,
      /\b(?:GroceryRepository|mockRepository)\b/,
      `${file} must not depend on the retired repository abstraction`,
    )
    assert.doesNotMatch(
      source,
      /(?:from|import)\s*['"][^'"]*\/data\/mock(?:\.ts)?['"]/,
      `${file} must not import the retired legacy mock fixture`,
    )
  }
})
