import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { statSync } from 'node:fs'

// Run only on an explicitly downloaded synthetic GitHub Actions ZIP.
// No network, secrets, source screenshots, user identifiers, or VPS access.
const [archive, flagHead, head, flagRun, run] = process.argv.slice(2)
assert.ok(archive && flagHead === '--head' && flagRun === '--run',
  'Usage: node scripts/qa-audit-browser-archive-20261014.mjs archive.zip --head <40-hex> --run <run-id>')
assert.match(head, /^[0-9a-f]{40}$/i)
assert.match(run, /^[1-9][0-9]*$/)
assert.ok(statSync(archive).size <= 12 * 1024 * 1024, 'archive exceeds private QA byte budget')

const list = execFileSync('unzip', ['-Z', '-1', archive], {
  encoding: 'utf8', maxBuffer: 64 * 1024, timeout: 12000,
}).trim().split('\n')
assert.ok(list.length >= 2 && list.length <= 16, 'unexpected ZIP member count')
assert.equal(new Set(list).size, list.length, 'duplicate ZIP entry names not allowed')
for (const filename of list) {
  assert.match(filename, /^(?:[a-z0-9-]{1,72}\.png|result\.json|(?:geckodriver|vite|preview|webdriver)\.log)$/,
    'only exact flat synthetic browser evidence names are allowed')
}
assert.ok(list.includes('result.json'), 'missing browser provenance')
function read(name, cap) {
  return execFileSync('unzip', ['-p', archive, name], {
    maxBuffer: cap, timeout: 12000,
  })
}
const raw = read('result.json', 64 * 1024)
assert.ok(raw.length > 0 && raw.length <= 64 * 1024, 'result JSON too large')
const manifest = JSON.parse(raw.toString('utf8'))
assert.equal(manifest.schemaVersion, 1)
assert.equal(manifest.category, 'synthetic-M2-M3-product-flow')
assert.match(manifest.checkoutSha, /^[0-9a-f]{40}$/i, 'checkout must be pinned separately')
assert.equal(manifest.pullRequestHeadSha?.toLowerCase(), head.toLowerCase())
assert.equal(manifest.githubRunId, run)
assert.match(manifest.githubRunAttempt, /^[1-9][0-9]*$/)
assert.equal(manifest.retailerDataObserved, false)
assert.equal(manifest.realSavingsClaimEligible, false)
assert.ok(Array.isArray(manifest.checks) && manifest.checks.length >= 1)
assert.ok(manifest.checks.every(x => typeof x === 'string' && /^[a-z0-9-]{1,90}$/.test(x)))
assert.equal(new Set(manifest.checks).size, manifest.checks.length, 'duplicate claimed browser checks')
assert.ok(Array.isArray(manifest.screenshots))
assert.ok(Array.isArray(manifest.screenshotIntegrity))
assert.ok(manifest.screenshots.length >= 1 && manifest.screenshots.length <= 12)
assert.equal(manifest.screenshots.length, manifest.screenshotIntegrity.length)
const actual = list.filter(x => x.endsWith('.png'))
assert.deepEqual(actual.slice().sort(), manifest.screenshots.slice().sort(),
  'every archived PNG must be named in the attestation and vice versa')
assert.equal(new Set(manifest.screenshots).size, manifest.screenshots.length)
const metadataNames = []
for (const entry of manifest.screenshotIntegrity) {
  assert.ok(entry && typeof entry === 'object')
  const { filename, sha256, bytes, width, height } = entry
  assert.ok(typeof filename === 'string' && manifest.screenshots.includes(filename))
  metadataNames.push(filename)
  assert.match(sha256, /^[0-9a-f]{64}$/i)
  assert.ok(Number.isSafeInteger(bytes) && bytes >= 24 && bytes <= 1024 * 1024)
  assert.ok(Number.isSafeInteger(width) && width > 0 && width <= 10000)
  assert.ok(Number.isSafeInteger(height) && height > 0 && height <= 10000)
  const image = read(filename, 1024 * 1024 + 4096)
  assert.equal(image.length, bytes, 'PNG byte-count mismatch: ' + filename)
  assert.equal(image.subarray(0, 8).toString('hex'), '89504e470d0a1a0a')
  assert.equal(image.toString('ascii', 12, 16), 'IHDR')
  assert.equal(image.readUInt32BE(16), width)
  assert.equal(image.readUInt32BE(20), height)
  assert.equal(createHash('sha256').update(image).digest('hex'), sha256.toLowerCase(),
    'PNG sha mismatch: ' + filename)
}
assert.deepEqual(metadataNames.slice().sort(), manifest.screenshots.slice().sort())
process.stdout.write(JSON.stringify({
  verified: true,
  sourceHead: head,
  workflowRun: run,
  checks: manifest.checks.length,
  pngs: actual.length,
  bytes: actual.reduce((s, n) => s + manifest.screenshotIntegrity.find(m => m.filename === n).bytes, 0),
  humanFieldEvidence: false,
  releaseEligible: false,
}) + '\n')
