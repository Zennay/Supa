import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const root = new URL('../', import.meta.url)

async function read(relativePath) {
  return readFile(new URL(relativePath, root), 'utf8')
}

test('repository enforces the same Node 22 major used by local and hosted installs', async () => {
  const [packageText, nvmrc, npmrc, workflow] = await Promise.all([
    read('package.json'),
    read('.nvmrc'),
    read('.npmrc'),
    read('.github/workflows/ci.yml'),
  ])

  const manifest = JSON.parse(packageText)
  const localMajor = nvmrc.trim()

  assert.equal(localMajor, '22')
  assert.equal(manifest.engines?.node, `${localMajor}.x`)
  assert.match(npmrc, /^engine-strict=true\s*$/m)
  assert.match(workflow, /node-version:\s*22(?:\s|$)/)
  assert.match(workflow, /- run:\s*npm ci(?:\s|$)/)
})
