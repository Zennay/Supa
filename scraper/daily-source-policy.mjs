/**
 * Default-deny retailer provenance register for the existing nine-store
 * scraper engine. A reviewed lawful basis (not necessarily written consent)
 * is needed before unattended collection AND publication.
 *
 * A checked-in project policy is not a statement of Dutch law. The operator
 * must assess the actual website conditions, database rights and scope.
 */
import { readFile } from 'node:fs/promises'
import { adapters } from './adapters/index.mjs'

const ALLOWED_BASES = new Set(['written_permission', 'public_license', 'documented_legal_review'])
const REVIEW_MAX_AGE_MS = 90 * 24 * 3600_000
const validDate = d => typeof d === 'string' && /^\d{4}-\d\d-\d\d$/.test(d) &&
  Number.isFinite(Date.parse(d + 'T00:00:00Z')) &&
  new Date(Date.parse(d + 'T00:00:00Z')).toISOString().slice(0,10) === d

export function reviewedRetailerIds(policy, now = new Date()) {
  if (!policy || policy.version !== 1 || !Array.isArray(policy.sources) ||
      policy.sources.length < 1 || policy.sources.length > 16 ||
      !(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new Error('Retailer daily source policy missing or malformed')
  }
  const ids = new Set()
  const supported = new Map(adapters.map(adapter => [adapter.id, adapter]))
  const current = now.getTime()
  for (const item of policy.sources) {
    if (!item || typeof item.id !== 'string' || ids.has(item.id) ||
        !supported.has(item.id)) throw new Error('Unknown or duplicate retailer in policy')
    ids.add(item.id)
  }
  const admitted = []
  for (const item of policy.sources) {
    if (item.enabled !== true) continue
    const adapter = supported.get(item.id)
    if (adapter.status !== 'active' ||
        item.publicationApproved !== true ||
        item.scope !== 'public-product-prices' ||
        !ALLOWED_BASES.has(item.basis) ||
        !validDate(item.reviewedAt) ||
        typeof item.evidenceUrl !== 'string' ||
        !/^https:\/\/[A-Za-z0-9.-]+\/\S{1,500}$/.test(item.evidenceUrl) ||
        typeof item.scopeNote !== 'string' || item.scopeNote.trim().length < 16 ||
        item.scopeNote.length > 2000) {
      throw new Error('Enabled retailer lacks documented price-use scope')
    }
    const reviewed = Date.parse(item.reviewedAt + 'T00:00:00Z')
    if (reviewed > current || current - reviewed > REVIEW_MAX_AGE_MS) {
      throw new Error('Retailer price-use review expired or future-dated')
    }
    admitted.push(item.id)
  }
  return admitted
}
export async function loadReviewedDailyPolicy(filename, now = new Date()) {
  if (typeof filename !== 'string' || !filename.trim()) throw new Error('Private retailer policy path required')
  const policy = JSON.parse(await readFile(filename, 'utf8'))
  return reviewedRetailerIds(policy, now)
}
