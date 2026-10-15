import { mkdir, lstat, open, rm } from 'node:fs/promises'
import { resolve, dirname, basename } from 'node:path'
import { pathToFileURL } from 'node:url'
import { loadReviewedRepositoryFixtures } from './retailer-reviewed-ingest-engine.mjs'
import { buildUniversalRetailerCatalog } from './retailer-universal-catalog.mjs'
import { assertNoSymlinkedM3OutputParents } from './m3-source-output-preservation.mjs'

// Optional private local JSON database export. Never publishes a catalog or
// chooses a price winner across conflicting captures. No default output.
export async function writePrivateRetailerCatalog(catalog, filename) {
  if (!catalog || catalog.schemaVersion !== 1 ||
      catalog.model !== 'universal-retailer-product-captures' ||
      catalog.status !== 'private-review-only' ||
      catalog.productionEnabled !== false ||
      catalog.publicSavingsClaimEligible !== false ||
      !Array.isArray(catalog.products)) {
    throw new Error('Refusing non-private/unvalidated catalog export')
  }
  if (typeof filename !== 'string' ||
      filename.trim() !== filename ||
      !filename.endsWith('.json') ||
      filename.length > 500) {
    throw new Error('Invalid private catalog output path')
  }
  const path = resolve(filename)
  if (!/^[a-z0-9][a-z0-9_.-]*\.json$/i.test(basename(path)) ||
      basename(path).startsWith('.')) {
    throw new Error('Invalid private catalog filename')
  }
  // Resolve() alone is insufficient to catch aliases. Walk existing parents
  // before mkdir and again before exclusive creation; concurrent hostile path
  // swaps are NOT fully prevented by Node pathname-based filesystem operations.
  await assertNoSymlinkedM3OutputParents(path)
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  await assertNoSymlinkedM3OutputParents(path)
  const parent = await lstat(dirname(path))
  if (!parent.isDirectory() || parent.isSymbolicLink()) {
    throw new Error('Untrusted private catalog directory')
  }
  const data = JSON.stringify(catalog, null, 2) + '\n'
  let handle
  let created = false
  try {
    handle = await open(path, 'wx', 0o600)
    created = true
    await handle.writeFile(data, 'utf8')
    await handle.chmod(0o600)
    await handle.sync()
    await handle.close()
    handle = undefined
  } catch (error) {
    if (handle) await handle.close()
    // Exclusive creation never overwrites preexisting evidence. If write
    // fails after creating a file, avoid leaving an incomplete apparent DB.
    if (created) {
      try {
        await assertNoSymlinkedM3OutputParents(path)
        const now = await lstat(path)
        if (now.isFile() && !now.isSymbolicLink()) await rm(path)
      } catch {
        // Avoid unlinking through an unsafe changed parent.
      }
    }
    throw new Error('Private catalog export failed; existing files preserved')
  }
  return { records: catalog.productCount, bytes: Buffer.byteLength(data, 'utf8') }
}

export async function main(argv = process.argv.slice(2)) {
  if (argv.length !== 2 || argv[0] !== '--output') {
    throw new Error('Usage: retailer-private-catalog-store.mjs --output <private.json>')
  }
  const batch = await loadReviewedRepositoryFixtures()
  const catalog = buildUniversalRetailerCatalog(batch)
  const result = await writePrivateRetailerCatalog(catalog, argv[1])
  process.stdout.write(JSON.stringify({ ...result, productionEnabled: false }) + '\n')
  return result
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => {
    console.error('Private retailer export refused; no public catalog published')
    process.exitCode = 2
  })
}
