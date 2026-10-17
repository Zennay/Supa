/**
 * QA-only, conservative, OFFLINE documentary rights inspection for SUPA M3.
 *
 * This DOES NOT repair/replace the product source-permission gate or assert
 * ownership of a licence. It provides an independent, non-publishing operator
 * audit until #3782 is repaired by the exclusive source owner.
 *
 * No DNS, network, retailer HTML, source fixture prices or external API calls.
 * No URLs, credential values, or human records are emitted in the report.
 */
import { readFile } from 'node:fs/promises'
import { isIP } from 'node:net'
import { types as nodeTypes } from 'node:util'
import { pathToFileURL } from 'node:url'
import { evaluateSourcePermissionGate } from './m1-check-source-permission-gate.mjs'

const REFUSE = 'Independent M3 documentary rights audit refused'
const suspiciousQueryName = /(?:^|[_-])(?:token|access|refresh|password|passwd|secret|api[_-]?key|authorization|auth|code|client[_-]?secret)(?:$|[_-])/i

/**
 * This checks static documentary reference SHAPES, not legal entitlement.
 * Literal IP addresses are deliberately disallowed even when globally
 * routable: independent licence evidence should use a named public host.
 * Domain resolution and redirect safety still require human review.
 */
export function isPublicDocumentaryEvidenceUrl(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2048) return false
  try {
    const u = new URL(value)
    const host = u.hostname.toLowerCase()
    if (u.protocol !== 'https:' || !host ||
        u.username || u.password || u.hash || (u.port && u.port !== '443') ||
        host.endsWith('.') || host === 'localhost' ||
        host.endsWith('.localhost') || host.endsWith('.local') ||
        host.endsWith('.internal') || !host.includes('.') ||
        isIP(host.replace(/^\[|\]$/g, '')) !== 0) return false
    for (const name of u.searchParams.keys()) {
      // Even a safe-looking domain is not a licence reference if its link
      // embeds a credential-shaped parameter. Do not echo values anywhere.
      if (suspiciousQueryName.test(name)) return false
    }
    return true
  } catch {
    return false
  }
}

/**
 * Public-safe aggregates only. A syntactically acceptable HTTPS link is
 * NEVER proof of a licence. In particular this independent audit is
 * intentionally NOT a mechanism for turning productionReady true.
 */
/**
 * In-process callers may pass active JS objects even though the CLI reads
 * JSON. Snapshot ONLY own, enumerable plain-data descriptors before any
 * canonical permission code or URLs can access the submitted graph.
 * Reject shared/cyclic identities, exotic prototypes, sparse arrays, hidden
 * fields, symbols, accessors and proxies without invoking attacker getters.
 */
function snapshotInertDocumentaryData(root) {
  const seen = new WeakSet()
  let nodes = 0
  function copy(value, depth) {
    if (++nodes > 16000 || depth > 32) throw new Error(REFUSE)
    if (value === null || typeof value === 'boolean') return value
    if (typeof value === 'string') {
      if (value.length > 100000) throw new Error(REFUSE)
      return value
    }
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw new Error(REFUSE)
      return value
    }
    if (typeof value !== 'object' || nodeTypes.isProxy(value) ||
        seen.has(value)) throw new Error(REFUSE)
    const array = Array.isArray(value)
    const prototype = Object.getPrototypeOf(value)
    if (array ? prototype !== Array.prototype :
      prototype !== Object.prototype && prototype !== null) throw new Error(REFUSE)
    const length = array ? Object.getOwnPropertyDescriptor(value, 'length')?.value : null
    if (array && (!Number.isSafeInteger(length) || length < 0 ||
        length > 8192)) throw new Error(REFUSE)
    const descriptors = Object.getOwnPropertyDescriptors(value)
    const keys = Reflect.ownKeys(descriptors)
    if (keys.length > 8193 ||
        (array && keys.length !== length + 1)) throw new Error(REFUSE)
    seen.add(value)
    const result = array ? new Array(length) : Object.create(null)
    for (const key of keys) {
      if (array && key === 'length') continue
      if (typeof key !== 'string' ||
          ['__proto__', 'prototype', 'constructor'].includes(key) ||
          (array && (!/^(?:0|[1-9]\d*)$/.test(key) ||
            Number(key) >= length))) throw new Error(REFUSE)
      const descriptor = descriptors[key]
      if (!Object.hasOwn(descriptor, 'value') ||
          descriptor.enumerable !== true) throw new Error(REFUSE)
      Object.defineProperty(result, key, {
        enumerable: true, configurable: true, writable: true,
        value: copy(descriptor.value, depth + 1),
      })
    }
    if (array && [...Array(length).keys()].some(i =>
      !Object.hasOwn(result, String(i)))) throw new Error(REFUSE)
    return result
  }
  return copy(root, 0)
}

export function auditM3DocumentaryRights(document) {
  document = snapshotInertDocumentaryData(document)
  const canonical = evaluateSourcePermissionGate(document)
  let unsafeDocumentaryUrls = 0
  let referencedDocuments = 0
  let declaredAuthorizationDocuments = 0
  for (const source of document.sources) {
    for (const evidence of source.evidence) {
      referencedDocuments++
      if (!isPublicDocumentaryEvidenceUrl(evidence.url)) unsafeDocumentaryUrls++
      if (evidence.kind === 'written_permission' ||
          evidence.kind === 'official_license') declaredAuthorizationDocuments++
    }
  }
  const outcome = unsafeDocumentaryUrls > 0
    ? 'untrusted-documentary-url'
    : canonical.productionReady
      ? 'requires-independent-licence-review'
      : 'retailer-permission-not-yet-established'

  return {
    schemaVersion: 1,
    mode: 'qa-private-documentary-rights-review',
    projectMilestone: 'M3',
    outcome,
    reviewedSourceCount: canonical.expectedSources.length,
    referencedDocuments,
    unsafeDocumentaryUrls,
    declaredAuthorizationDocuments,
    underlyingGateClaimsReady: canonical.productionReady,
    independentlyVerifiedLegalRights: false,
    // A source-controlled JSON row alone cannot independently establish
    // authentic contractual authorization. Never emit a release token.
    productionReady: false,
    liveRequests: 0,
    publicSavingsClaimEligible: false,
    requiresHumanLegalReview: true,
    releaseDecision: 'hold',
  }
}

/**
 * Reject untrusted programmatic argv before getters, symbols, exotic Array
 * prototypes or Proxy traps can execute. The data descriptor of Array.length
 * is read without evaluating user JS. Only [] and ['--require-release'] pass.
 */
function checkedCliArgs(argv) {
  if (!Array.isArray(argv) || nodeTypes.isProxy(argv) ||
      Object.getPrototypeOf(argv) !== Array.prototype) throw new Error(REFUSE)
  const descriptors = Object.getOwnPropertyDescriptors(argv)
  const length = descriptors.length?.value
  if ((length !== 0 && length !== 1) ||
      Reflect.ownKeys(descriptors).length !== length + 1) throw new Error(REFUSE)
  if (length === 1 &&
      (!Object.hasOwn(descriptors[0] ?? {}, 'value') ||
        descriptors[0].value !== '--require-release')) throw new Error(REFUSE)
  return length === 1
}

export async function main(argv = process.argv.slice(2),
  write = line => process.stdout.write(line)) {
  // No arbitrary --file, --url, network, or inherited programmatic arguments.
  const strictRelease = checkedCliArgs(argv)
  const source = new URL('../evidence/m1/source-permission-gate.v1.json', import.meta.url)
  const document = JSON.parse(await readFile(source, 'utf8'))
  const report = auditM3DocumentaryRights(document)
  write(JSON.stringify(report, null, 2) + '\n')
  // A hold is a SUCCESSFUL QA inspection but never a release. A strict
  // production gate deliberately fails closed regardless of documentary
  // status; it cannot become "green" by editing a permission JSON file.
  if (strictRelease || report.unsafeDocumentaryUrls > 0 ||
      report.underlyingGateClaimsReady) process.exitCode = 2
  return report
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    console.error(REFUSE)
    process.exitCode = 2
  })
}
