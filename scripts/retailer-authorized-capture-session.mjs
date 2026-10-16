/**
 * One operator-scoped, consent-gated retailer capture session.
 *
 * This adds an in-memory host budget to the existing exact-source/grant/rights
 * validator. No timer, network transport, crawl loop, proxy, or scheduler is
 * created here. A caller must separately inject a transport for each capture.
 * Mock permission grants used in tests are NOT release authorization.
 */
import { types as nodeTypes } from 'node:util'
import { captureApprovedRetailerPage } from './retailer-approved-snapshot-capture.mjs'

const ALLOWED_FIELDS = Object.freeze([
  'source', 'permissionGate', 'grant', 'fetchFn', 'capturedAt',
])
const HOSTS = Object.freeze({
  'www.plus.nl': 'plus',
  'www.dekamarkt.nl': 'dekamarkt',
})
const MAX_REQUESTS_PER_HOST = 3
const MIN_GAP_MS = 10_000
const ERROR_COOLDOWN_MS = 60_000
const refuse = () => { throw new Error('Retailer capture session refused') }

/**
 * Inspect ONLY descriptors of a direct caller's container. The underlying
 * capture code separately deep-pins source/grant/permission records before it
 * performs any network request. Never access a caller getter at this layer.
 */
function snapshotRequest(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      nodeTypes.isProxy(input) ||
      (Object.getPrototypeOf(input) !== Object.prototype &&
       Object.getPrototypeOf(input) !== null)) refuse()
  const descriptors = Object.getOwnPropertyDescriptors(input)
  if (Reflect.ownKeys(descriptors).some(key => !ALLOWED_FIELDS.includes(key))) refuse()
  const copy = {}
  for (const field of ALLOWED_FIELDS) {
    const descriptor = descriptors[field]
    if (!descriptor) continue
    if (!Object.hasOwn(descriptor, 'value')) refuse()
    copy[field] = descriptor.value
  }
  if (typeof copy.fetchFn !== 'function' || nodeTypes.isProxy(copy.fetchFn)) refuse()
  return copy
}

/**
 * A distinct session is required for any further work after hard throttle or
 * quota. Never retry a blocked store with a different proxy or URL.
 * Counters are aggregate-only and do not contain raw prices, HTML or URLs.
 */
export function createAuthorizedRetailerCaptureSession() {
  const states = new Map(Object.values(HOSTS).map(id =>
    [id, { attempts: 0, completed: 0, verified: 0, blocked: false,
      inFlight: false, nextEligibleAt: 0 }]))

  async function captureOne(input) {
    const request = snapshotRequest(input)
    const transport = request.fetchFn
    let reserved = null
    try {
      const capture = await captureApprovedRetailerPage({
      ...request,
      fetchFn: async (url, init) => {
        // The canonical capture validates its permission gate and exact HTTPS
        // retailer URL before invoking this wrapper. Check again here to
        // ensure an unexpected downstream route cannot consume the budget.
        let retailer
        try {
          const parsed = new URL(url)
          if (parsed.protocol !== 'https:' || parsed.port || parsed.username ||
              parsed.password || !Object.hasOwn(HOSTS, parsed.hostname)) refuse()
          retailer = HOSTS[parsed.hostname]
        } catch { refuse() }
        const state = states.get(retailer)
        const now = Date.now()
        if (state.blocked || state.inFlight ||
            state.attempts >= MAX_REQUESTS_PER_HOST ||
            now < state.nextEligibleAt) refuse()
        // Reserve BEFORE invoking the injected transport. A concurrent call
        // cannot bypass the budget while the first response is pending.
        state.inFlight = true
        reserved = state
        state.attempts++
        state.nextEligibleAt = now + MIN_GAP_MS
        let response
        try {
          response = await transport(url, init)
        } catch {
          state.nextEligibleAt = Math.max(state.nextEligibleAt,
            Date.now() + ERROR_COOLDOWN_MS)
          refuse()
        }
        if (response?.status === 403 || response?.status === 429) {
          state.blocked = true
        } else if (response?.status !== 200 || response?.ok !== true) {
          state.nextEligibleAt = Math.max(state.nextEligibleAt,
            Date.now() + ERROR_COOLDOWN_MS)
        } else {
          state.completed++
        }
        return response
      },
    })
      // Count a verified capture only after the entire bounded HTML body
      // has passed content-type, size, stream and UTF-8 integrity checks.
      // An HTTP 200 alone is never successful evidence.
      if (reserved) reserved.verified++
      return capture
    } catch (error) {
      // Even HTTP 200 can contain an invalid type, malformed stream or
      // oversized/unreadable HTML. Do not hammer a broken source after these
      // capture-body failures. Authorization refusals reserve no host.
      if (reserved) {
        reserved.nextEligibleAt = Math.max(
          reserved.nextEligibleAt, Date.now() + ERROR_COOLDOWN_MS,
        )
      }
      throw error
    } finally {
      // Reserve the host until the source reader has also finished verifying
      // the bounded HTML body, not merely until response headers arrive.
      if (reserved) reserved.inFlight = false
    }
  }

  function status() {
    const stores = Object.fromEntries(
      [...states.entries()].map(([retailer, state]) =>
        [retailer, {
          attemptedCaptures: state.attempts,
          successfulHttpResponses: state.completed,
          verifiedCaptures: state.verified,
          hardStopped: state.blocked,
          busy: state.inFlight,
          quotaExhausted: state.attempts >= MAX_REQUESTS_PER_HOST,
        }])
    )
    return {
      schemaVersion: 1,
      mode: 'authorized-capture-session-budget',
      perHostQuota: MAX_REQUESTS_PER_HOST,
      minGapMs: MIN_GAP_MS,
      stores,
      automaticRetries: 0,
      proxyRotationEnabled: false,
      scheduledCaptureEnabled: false,
      publicPricePublicationEnabled: false,
    }
  }
  return Object.freeze({ captureOne, status })
}
