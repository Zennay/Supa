# M3 retailer selector provenance — independent QA acceptance matrix

Last independently reviewed: **2026-10-16**. Project phase: **ACTIVE M3 / release HOLD**.
This note is **quality-validation-owned documentation**, not permission, a field observation,
a live scraping instruction or evidence of a deploy.

## Two independent OFFLINE selector entrypoints

| Question | Research-only `proposeOfflineRetailerSelectors({ html, origin })` | SHA-pinned `proposeRetailerSelectors(source, html)` |
|---|---|---|
| Product path | `scripts/retailer-offline-selector-discovery.mjs` | `scripts/retailer-snapshot-selector-proposals.mjs` |
| Who provides bytes? | In-memory HTML input; computes **its own** SHA | Already reviewed in-memory capture source, **must match source.sha256** |
| Merchant | `origin.retailerId` / `origin.url`; known PLUS and Deka hostname must match | `source.supermarket` + source URL; canonical known host only |
| Metadata | Preserve original source `capturedAt`; physically possible Gregorian UTC; source identity must not come from getters/Proxy | Keep original SHA, source ID, `capturedAt`, URL, kind and supermarket; physically possible archive time with 1–9 fraction digits |
| Intended result | Only reviewable CSS candidates, not extracted products | Only hash-linked **unverified** human-review proposals |
| Unknown research shop | Explicit research-only unknown retailer accepted, still **no rights** | This entrypoint's canonical capture source contract is limited to known allowed retailer IDs |
| Safety | `readyForIngestion=false`, `permissionVerified=false`, `productionEnabled=false`, `publicSavingsClaimEligible=false` | `readyForScraping=false`, `sourcePermissionVerified=false`, `currentPricesExtracted=false`, `publicationAllowed=false` |
| Network / live data | **Never fetches**. No current price. | **Never fetches**. SHA of archived HTML does not prove the *current* price. |

A SHA digest binds *specific original bytes*, **not** retailer licensing, a real checkout
observation, product availability or a savings calculation. Both forms of seller/source
provenance must be coherent, with no automatic selector promotion.

## Independent evidence and regression ownership

- **Canonical-host and physical UTC** original-main RED: [#3147](https://github.com/Zennay/Supa/pull/3147), [#3148](https://github.com/Zennay/Supa/pull/3148); unmodified QA GREEN replay on latest owner [#3157](https://github.com/Zennay/Supa/pull/3157) — [CI #38840931141](https://github.com/Zennay/Supa/actions/runs/38840931141), 3,175 Node PASS. Covers product [#3152](https://github.com/Zennay/Supa/pull/3152), **not** a merged main release.
- **Direct research selector inert JS inputs**: independent original-main [#3154](https://github.com/Zennay/Supa/pull/3154), 4 RED due to getters, inherited identity and Proxy inputs. Product [#3159](https://github.com/Zennay/Supa/pull/3159), independent peer QA [#3161](https://github.com/Zennay/Supa/pull/3161) work on this **other source path**. Do not edit their source/tests.
- **SHA-pinned selector impossible dates**: original-main [#3155](https://github.com/Zennay/Supa/pull/3155) 2 RED; identical Git blob `acbba7045e66f983be39bb03715d0a44465004b1` replay [#3165](https://github.com/Zennay/Supa/pull/3165) on product [#3163](https://github.com/Zennay/Supa/pull/3163), [CI #38842078728](https://github.com/Zennay/Supa/actions/runs/38842078728): 3,166 Node PASS + npm ci/audit-high/M1 matching/real denied rights/TS Vite build success, **still stacked**.
- **SHA-pinned selector descriptor Proxy safety**: independent original-main [#3168](https://github.com/Zennay/Supa/pull/3168) and product [issue #3170](https://github.com/Zennay/Supa/issues/3170), [CI #38842211155](https://github.com/Zennay/Supa/actions/runs/38842211155): 3,160 PASS, **2 intentional RED**; ordinary source and own accessor positivity remain green. Product owner must coordinate this **same second source path** with #3163 instead of overwriting its date fix.
- **Cross-entrypoint hash/attribution contract**: QA [#3169](https://github.com/Zennay/Supa/pull/3169) (this branch), `tests/qa-offline-selector-cross-api-sha-retailer-privacy-20261016.test.mjs`. It must validate both known merchants in-memory, preserve exact byte SHA/source time and own inputs, prove SHA mismatch is refused by the already-reviewed archive API, allow research-only rehash but never rights/public price. Run CI on **exact final HEAD** before green status.

## Required validation and release boundary

A valid software acceptance claim needs exact commit SHA and job, original failure-to-
success provenance, unaltered original QA assertions, **full** GitHub `npm ci`,
`npm audit --audit-level=high`, `npm test`, `npm run m1:matching-benchmark`,
`npm run m1:source-permission-gate` and `npm run build`.
A deliberately failing Node test **skips** later M1/build steps; never call those green
without real CI evidence.

On the **real** checked-in M1 permission gate: PLUS remains
`permission_required`, DekaMarkt `unresolved`, `productionReady:false`.
No live scheduler, retailer scraping, present product prices or public savings.
Before any actual main promotion validate authoritative zCloud **scoped SQLite write
claim** and the applicable permanent trusted M3 self-hosted VPS runner
[#2833](https://github.com/Zennay/Supa/issues/2833). Still required:
written PLUS+Deka reuse permission [#74](https://github.com/Zennay/Supa/issues/74),
a genuine same-demand PLUS11+Deka11 human basket pair within 24 hours
[#78](https://github.com/Zennay/Supa/issues/78), and real field-run code SHA
[#205](https://github.com/Zennay/Supa/issues/205).

**All QA PRs described here are intentionally draft / nonmerge unless their own
applicable authenticated integration gates are separately satisfied.**
