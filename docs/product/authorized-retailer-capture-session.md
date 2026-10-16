# SUPA — opt-in retailer capture session (P1 product-core)

This is a **small authorized-capture primitive**, not a live scraper, cron job, permission grant, retailer API client or M3 savings proof.

## Operator contract

The exported `createAuthorizedRetailerCaptureSession()` from `scripts/retailer-authorized-capture-session.mjs` returns `captureOne(request)` and `status()`. It only has network capability **if its caller explicitly injects** `fetchFn` and supplies a matching retailer-specific verified permission record plus exact HTTPS one-page grant.

```js
import { createAuthorizedRetailerCaptureSession } from './scripts/retailer-authorized-capture-session.mjs'

// These values must come from a separately reviewed, legitimate source.
// Do not fabricate gate/grant fields or use test-only synthetic approvals
// with real retailers. approvedTransport has NO implementation in SUPA.
const session = createAuthorizedRetailerCaptureSession()
const capture = await session.captureOne({
  source, permissionGate, grant, capturedAt, fetchFn: approvedTransport,
})
// capture.html is PRIVATE raw evidence: do not log, publish or attach it.
// capture.readyForIngestion === false; capture.published === false.
const privateAggregateStatus = session.status()
```

The *canonical* `captureApprovedRetailerPage` validates the entire inert permission-gate/source/grant graph, the HTTPS retailer host/path, no redirects, request header restrictions, captured-at clock and 2 MiB HTML body limit **before a capture can become eligible for review**. This wrapper never replaces that canonical check.

## Session safety guarantees

- One session keeps **independent PLUS and DekaMarkt host budgets** (three attempts max per host; >=10 s between attempts).
- One request per host at a time; the lock stays held through bounded HTML streaming and integrity verification, not just the HTTP headers.
- Any 403 or 429 irreversibly blocks that host **in this session**. A transport error, non-200 response, **or malformed/incomplete HTTP-200 body** adds a 60-second cooldown; the code never retries automatically. A malformed response cannot be polled again after only the ordinary 10-second gap.
- No proxy fallback/rotation, implicit network client, fetch schedule, cookies/credentials, automatic redirects or source permission escalation.
- The scope is **one in-memory session**. This is not a distributed/global rate limiter; it must not be used to defeat a retailer block by creating new sessions. A future orchestrator needs separate host-wide coordination and operator approval.

`status().stores[retailer]` is aggregate only and never contains a source URL, product identifier, HTML, price or secret:

| Counter | Exact meaning |
| --- | --- |
| `attemptedCaptures` | Count of actual injected transport invocations for that host |
| `successfulHttpResponses` | Count of HTTP-200 responses **before body validation** |
| `verifiedCaptures` | Count of captures whose **entire** HTML was successfully read, bounded, decoded and SHA-pinned |
| `hardStopped` | HTTP 403/429 seen in this session, no more requests on that host |
| `busy` | A request is still running, including HTML integrity read |
| `quotaExhausted` | Three attempts already consumed |

A 200 response carrying JSON, invalid UTF-8, oversized HTML or a broken stream may increase `successfulHttpResponses`, but **must never** increase `verifiedCaptures`. An accepted private HTML result remains `readyForIngestion:false`, `published:false`: manual review, rights, currentness, adapter evidence and any price claim are separate decisions.

## Validation and release gates

```sh
node --test tests/product-retailer-authorized-capture-session-20261015.test.mjs
npm test
npm run m1:matching-benchmark
npm run m1:source-permission-gate
npm run build
```

The tests use **mock transports and fictional grants only**. Actual M1 evidence still reports PLUS `permission_required`, DekaMarkt `unresolved`, `productionReady:false`. No commercial traffic should be initiated without genuine written permission [#74](https://github.com/Zennay/Supa/issues/74). The M3 exit still requires real identical same-demand PLUS11+Deka11 human observations within 24 hours [#78](https://github.com/Zennay/Supa/issues/78), an actual field-code SHA [#205](https://github.com/Zennay/Supa/issues/205), and a trusted permanent VPS gate [#2833](https://github.com/Zennay/Supa/issues/2833). No public/current product prices or savings are established by this session.

## New: bounded authorized capture → offline product preview

The isolated `createAuthorizedRetailerProductPreviewSession()` in `scripts/retailer-authorized-product-preview.mjs` now **connects** the previously separate permission-gated capture session to the existing `parseM3OfflineProductHtml` parser for a **single explicitly authorized product page**. This is the first direct, executable transport-to-offline-product vertical slice, not a commercial ready scraper.

```js
import { createAuthorizedRetailerProductPreviewSession } from './scripts/retailer-authorized-product-preview.mjs'

// source.kind MUST be 'product'; all inputs must be genuinely reviewed.
// Never use the synthetic test grants for actual retailer HTTP traffic.
const session = createAuthorizedRetailerProductPreviewSession()
const preview = await session.previewOne({
  source, permissionGate, grant, capturedAt, fetchFn: approvedTransport,
})
// preview.privateProductObservation is operator-private, not publishable.
```

Behavior: the original canonical permission / HTTPS route validator checks the entire trusted source before injected transport. A fully read and SHA-pinned HTML response then goes to the original offline JSON-LD parser; the wrapper requires product-page provenance (retailer, exact URL, timestamp, raw SHA-256) to match **on both** the capture and parsed observation. Only a single page-bound Product may appear as a private preview. A missing, contradictory or ambiguous Product yields `reviewStatus:'abstained'`, `privateProductObservation:null`; no guessed fallback price.

The return value intentionally **does not contain raw HTML**, although the original operator-only `captureOne()` API remains available for authorized private capture review. It can contain a private, historical product observation with monetary fields: **never log, upload, serve, publish or treat this result as current retailer data**. Flags `currentPriceVerified:false`, `currentAvailabilityVerified:false`, `productApprovedForIngestion:false`, `readyForIngestion:false`, `productionEnabled:false`, `publicPricePublicationEnabled:false`, and `publicSavingsClaimEligible:false` cannot be elevated by this bridge. Source rights and field proof #74/#78/#205/#2833 remain independently mandatory.

Offline end-to-end mock coverage:

```sh
node --experimental-strip-types --test tests/product-retailer-authorized-product-preview-20261016.test.mjs
```

The tests inject **only fictional plus/dekamarkt HTTP responses**, explicitly fictional grants and in-memory Schema.org price examples, never real access. They demonstrate positive source-bound previews, recommendation exclusion, refusal prior to networking, safe abstention and throttle hard-stop. Any later catalog/offers ingestion still needs its **own reviewed adapters and genuine rights**, not extrapolation from single-product JSON-LD.

### Product-review outcome metrics (privacy-safe)

`createAuthorizedRetailerProductPreviewSession().status()` includes all the transport counters **plus** `privateProductReviewCounts`, with isolated `plus` and `dekamarkt` rows. `accepted` increments only if the canonical offline product parser selected one SHA/URL/time-bound private observation; `abstained` increments for complete, valid HTML whose product identity or price proof could **not** safely be accepted. Refused source rights, unauthorized routes and transport/body errors never count as reviewed products.

These counters distinguish **HTTP 200 → valid HTML → recognized product**, and contain only integer totals: never HTML, product identity, prices, names, captured URLs or a source-hash inventory. Even a recognized product remains historical private review only; `currentPriceVerified:false`, `productionEnabled:false`, `publicSavingsClaimEligible:false` are unchanged.
