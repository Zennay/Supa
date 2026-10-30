import { createHash } from 'node:crypto'
import { readFile, mkdir, lstat, open, rm } from 'node:fs/promises'
import { resolve, dirname, basename } from 'node:path'
import { pathToFileURL } from 'node:url'
import { captureApprovedRetailerPage } from './retailer-approved-snapshot-capture.mjs'
import { assertNoSymlinkedM3OutputParents } from './m3-source-output-preservation.mjs'

const CANONICAL_PERMISSION_DOCUMENT = new URL(
  '../evidence/m1/source-permission-gate.v1.json', import.meta.url,
)

function validatePrivateOutput(filename) {
  if (typeof filename !== 'string' || filename !== filename.trim() ||
      filename.split(/[\\/]/).includes('..') ||
      !/^[a-z0-9][a-z0-9_.-]{0,120}\.html$/i.test(basename(filename))) {
    throw new Error('Invalid private snapshot output name')
  }
  return resolve(filename)
}

async function refuseExistingOutput(filename) {
  try {
    await lstat(filename)
    throw new Error('Private snapshot output already exists')
  } catch (error) {
    if (error?.code === 'ENOENT') return
    throw error
  }
}

// Never issue even a permission-approved request when its known output parent
// is already world/group accessible. Such files cannot later be replayed
// through the strict owner-only private source reader.
async function refusePublicExistingParent(path) {
  let parent
  try { parent = await lstat(dirname(path)) }
  catch (error) {
    if (error?.code === 'ENOENT') return
    throw error
  }
  if (!parent.isDirectory() || parent.isSymbolicLink() ||
      (parent.mode & 0o077) !== 0) {
    throw new Error('Untrusted private snapshot parent')
  }
}

// A second process may have replaced a name after we opened it with wx.
// The failure handler must never unlink another writer's replacement.
export async function cleanupOnlyOwnSnapshotFile(path, originalInode) {
  if (!originalInode) return
  await assertNoSymlinkedM3OutputParents(path)
  let current
  try { current = await lstat(path) }
  catch (error) {
    if (error?.code === 'ENOENT') return
    throw error
  }
  if (current.isFile() && !current.isSymbolicLink() &&
      current.dev === originalInode.dev && current.ino === originalInode.ino) {
    await rm(path)
  }
}

// For real execution this CLI always reads the permission source gate PINNED
// in this repository. Dependency injection exists only for offline tests.
// No M1 permissions = no network. It NEVER uses free proxies or rotates 403/429.
export async function main(argv = process.argv.slice(2), {
  fetchFn = fetch,
  testGateDocument = null,
  writeOutput = text => process.stdout.write(text),
} = {}) {
  if (argv.length !== 2) {
    throw new Error('Usage: retailer-download-reviewed-source.mjs <approved-grant.json> <private-output.html>')
  }
  const [grantFilename, outputFilename] = argv
  const output = validatePrivateOutput(outputFilename)
  const manifestFile = output + '.manifest.json'
  await assertNoSymlinkedM3OutputParents(output)
  await refuseExistingOutput(output)
  await refuseExistingOutput(manifestFile)
  await refusePublicExistingParent(output)

  const permissionGate = testGateDocument ?? JSON.parse(
    await readFile(CANONICAL_PERMISSION_DOCUMENT, 'utf8'),
  )
  const grant = JSON.parse(await readFile(grantFilename, 'utf8'))
  // Raw grant files are human-reviewed metadata, not automatically a license.
  // Approved URL must agree with the canonical source permission register.
  const source = { supermarket: grant.supermarket, kind: grant.kind, url: grant.sourceUrl }
  const capture = await captureApprovedRetailerPage({
    source, permissionGate, grant, fetchFn,
  })
  const archive = {
    schemaVersion: 1,
    recordType: 'one-page-private-html-capture',
    status: 'private-review-required',
    source: capture.source,
    bytes: capture.bytes,
    selectorReviewComplete: false,
    releaseReady: false,
    publicSavingsClaimEligible: false,
  }
  const payload = Buffer.from(capture.html, 'utf8')
  if (createHash('sha256').update(payload).digest('hex') !== capture.source.sha256) {
    throw new Error('Captured HTML hash changed before archive')
  }

  await assertNoSymlinkedM3OutputParents(output)
  await mkdir(dirname(output), { recursive: true, mode: 0o700 })
  await assertNoSymlinkedM3OutputParents(output)
  const directory = await lstat(dirname(output))
  if (!directory.isDirectory() || directory.isSymbolicLink() ||
      (directory.mode & 0o077) !== 0) {
    throw new Error('Untrusted private snapshot parent')
  }

  let htmlHandle, manifestHandle
  let htmlCreated = false, manifestCreated = false
  let htmlInode = null, manifestInode = null
  try {
    htmlHandle = await open(output, 'wx', 0o600)
    htmlCreated = true
    htmlInode = await htmlHandle.stat()
    manifestHandle = await open(manifestFile, 'wx', 0o600)
    manifestCreated = true
    manifestInode = await manifestHandle.stat()

    await htmlHandle.writeFile(payload)
    await htmlHandle.chmod(0o600)
    await htmlHandle.sync()
    await manifestHandle.writeFile(JSON.stringify(archive, null, 2) + '\n', 'utf8')
    await manifestHandle.chmod(0o600)
    await manifestHandle.sync()
    await htmlHandle.close()
    htmlHandle = undefined
    await manifestHandle.close()
    manifestHandle = undefined
  } catch {
    if (htmlHandle) await htmlHandle.close()
    if (manifestHandle) await manifestHandle.close()
    try {
      await assertNoSymlinkedM3OutputParents(output)
      if (htmlCreated) await cleanupOnlyOwnSnapshotFile(output, htmlInode)
      if (manifestCreated) await cleanupOnlyOwnSnapshotFile(manifestFile, manifestInode)
    } catch {
      // Do not chase a possibly changed parent on cleanup.
    }
    throw new Error('Private HTML archive failed and existing files were preserved')
  }
  // Only non-sensitive aggregate + content digest to CLI. Never raw HTML,
  // product prices, grant contents, retailer URL or credentials to stdout.
  writeOutput(JSON.stringify({
    status: 'private-review-required',
    bytes: capture.bytes,
    sha256: capture.source.sha256,
    productionEnabled: false,
  }) + '\n')
  return archive
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => {
    console.error('Retailer capture refused or private output incomplete; no source published')
    process.exitCode = 2
  })
}
