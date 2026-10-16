import { readFile, lstat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { assertValidOfflineSelectorOrigin, proposeOfflineRetailerSelectors } from './retailer-offline-selector-discovery.mjs'

// A reviewer can run this ONLY on a locally saved HTML snapshot with a pinned
// SHA from an approved capture manifest. No browser/network/scrape entrypoint.
export async function main(argv = process.argv.slice(2), writeOutput = text => process.stdout.write(text)) {
  if (argv.length !== 5) {
    throw new Error('Usage: inspect-snapshot <retailerId> <https-source-url> <capturedAt> <sha256> <html-file>')
  }
  const [retailerId, url, capturedAt, expectedSha256, filename] = argv
  if (!/^[a-f0-9]{64}$/.test(expectedSha256)) {
    throw new Error('Offline source SHA-256 required')
  }
  // Reject forged retailer/domain or impossible source calendar before any
  // private path metadata/read. Reuse the exact direct-selector provenance gate.
  assertValidOfflineSelectorOrigin({ retailerId, url, capturedAt })
  const path = resolve(filename)
  const metadata = await lstat(path)
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > 2 * 1024 * 1024) {
    throw new Error('Offline input must be a bounded regular HTML file')
  }
  const raw = await readFile(path)
  if (raw.length > 2 * 1024 * 1024 ||
      createHash('sha256').update(raw).digest('hex') !== expectedSha256) {
    throw new Error('Offline snapshot SHA does not match capture manifest')
  }
  const html = new TextDecoder('utf-8', { fatal: true }).decode(raw)
  const report = proposeOfflineRetailerSelectors({
    html, origin: { retailerId, url, capturedAt },
  })
  writeOutput(JSON.stringify(report, null, 2) + '\n')
  return report
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => {
    console.error('Offline HTML selector inspection refused; no product data was published')
    process.exitCode = 2
  })
}
