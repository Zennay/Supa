/** Offline 0600 HTML+manifest replay. No HTTP, rights grant or publication. */
import { createHash } from 'node:crypto'
import { readFile, lstat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { assertNoSymlinkedM3OutputParents } from './m3-source-output-preservation.mjs'
import { readAuthorizedHtmlScriptEvidence } from './retailer-approved-html-script-evidence.mjs'
import { parseSchemaOrgProductForPage } from '../src/data/schemaOrgProductPageSelection.ts'
import { parseDekaNuxtFromAuthorizedHtml } from './retailer-approved-deka-nuxt-product.mjs'
import { proposeOfflineRetailerSelectors } from './retailer-offline-selector-discovery.mjs'

const LIMIT = 2 * 1024 * 1024
const HOST = Object.freeze({ plus: 'www.plus.nl', dekamarkt: 'www.dekamarkt.nl' })
const fail = () => { throw Error('Private source replay refused: untrusted HTML or manifest') }
async function privateBytes(path, size) {
  await assertNoSymlinkedM3OutputParents(path)
  const meta = await lstat(path)
  if (!meta.isFile() || meta.isSymbolicLink() || (meta.mode & 0o077) !== 0 ||
      meta.size <= 0 || meta.size > size) fail()
  const bytes = await readFile(path)
  if (bytes.length !== meta.size || bytes.length > size) fail()
  return bytes
}
function admitManifest(record) {
  if (!record || record.schemaVersion !== 1 ||
      record.recordType !== 'one-page-private-html-capture' ||
      record.status !== 'private-review-required' ||
      record.selectorReviewComplete !== false || record.releaseReady !== false ||
      record.publicSavingsClaimEligible !== false ||
      !record.source || record.source.kind !== 'product' ||
      !Object.hasOwn(HOST, record.source.retailerId) ||
      typeof record.source.url !== 'string' ||
      typeof record.source.capturedAt !== 'string' ||
      typeof record.source.sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(record.source.sha256) ||
      !Number.isSafeInteger(record.bytes) || record.bytes < 1 || record.bytes > LIMIT) fail()
  const src = record.source
  let url
  try { url = new URL(src.url) } catch { fail() }
  if (url.href !== src.url || url.protocol !== 'https:' ||
      url.hostname !== HOST[src.retailerId] || url.port || url.search || url.hash ||
      url.username || url.password ||
      !url.pathname.startsWith(src.retailerId === 'plus' ? '/product/' : '/producten/')) fail()
  const ms = Date.parse(src.capturedAt)
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(src.capturedAt) ||
      !Number.isFinite(ms) || new Date(ms).toISOString() !== src.capturedAt ||
      ms > Date.now() + 60_000) fail()
  return src
}

/** Existing private capture bytes only: this function cannot fetch or publish. */
export async function replayPrivateProductHtmlSnapshot(filename) {
  if (typeof filename !== 'string' || !filename.endsWith('.html') ||
      filename.length > 512 || filename.trim() !== filename) fail()
  const path = resolve(filename)
  const manifest = JSON.parse(new TextDecoder('utf-8', { fatal: true })
    .decode(await privateBytes(path + '.manifest.json', 32_768)))
  const src = admitManifest(manifest)
  const bytes = await privateBytes(path, LIMIT)
  if (bytes.length !== manifest.bytes ||
      createHash('sha256').update(bytes).digest('hex') !== src.sha256) fail()
  const html = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  const provenance = { supermarket: src.retailerId, kind: src.kind,
    url: src.url, capturedAt: src.capturedAt, sha256: src.sha256 }
  const scripts = readAuthorizedHtmlScriptEvidence(html)
  if (scripts.invalid || scripts.jsonLdBlocks.length > 16) fail()
  let parsed = parseSchemaOrgProductForPage(scripts.jsonLdBlocks, provenance)
  if (src.retailerId === 'dekamarkt' &&
      (parsed.type !== 'observation' || parsed.observation.currentPriceCents === null ||
       parsed.observation.pack.amount === null)) {
    const alt = parseDekaNuxtFromAuthorizedHtml({
      html, provenance, jsonLdBlocks: scripts.jsonLdBlocks,
    })
    if (alt.type === 'observation') parsed = alt
  }
  const selectors = proposeOfflineRetailerSelectors({
    html, origin: { retailerId: src.retailerId, url: src.url, capturedAt: src.capturedAt },
  })
  if (selectors.source.sha256 !== src.sha256) fail()
  const price = parsed.type === 'observation' ? parsed.observation : null
  const plausible = price && Number.isSafeInteger(price.currentPriceCents) &&
    price.currentPriceCents > 0 && price.pack.amount !== null &&
    !['unknown', 'pack'].includes(price.pack.unit)
  return {
    schemaVersion: 1, mode: 'offline-private-product-review',
    source: { retailerId: src.retailerId, capturedAt: src.capturedAt, sha256: src.sha256 },
    status: plausible ? 'candidate_for_human_review' : 'unverified_product',
    observation: plausible ? price : null,
    selectorProposals: selectors.selectors, selectorReviewRequired: true,
    permissionVerifiedForThisReplay: false, sourceRightsForPublicationVerified: false,
    verifiedCurrentCheckoutPrice: false, readyForIngestion: false,
    publicSavingsClaimEligible: false, productionEnabled: false, published: false,
  }
}
