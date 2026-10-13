# M5 — read-only Nederlandse supermarktketen-inventaris (PWQ-316 / #2069)

**Status: candidate research only. M3 is active; M5 is NOT authorized.** No scraping, API calls, proxy probing, HTML downloads, selector guesses or retailer contact are performed by this module. This candidate inventory must never be used as a runtime ingest allowlist.

## Why this exists

The May 2026 Consumentenbond price survey lists thirteen chains. Wageningen University & Research's supermarket dashboard also identifies Boon, Ekoplaza and Odin. Along with Boni (covered by a July 2026 Consumentenbond update), these give the initial **17 candidate brands**, not a promise that every supermarket/banner or franchise in the Netherlands is included. Re-evaluate coverage prior to any M5 expansion.

- Consumentenbond Boni reference: https://www.consumentenbond.nl/acties-claims/nieuws/2025/laagsteprijsclaims-van-supermarkten-update
- WUR market research: https://www.wur.nl/nl/onderzoek/producten-diensten/dashboard-supermarkten-duurzaamheid-en-gezondheid
- Consumentenbond, 6 May 2026 survey: https://www.consumentenbond.nl/voedingstests/prijspeiling-supermarkten
**Strict schema integrity (#2097):** Both the top-level discovery document and every retailer record have a complete, exact version-1 field allowlist. The top-level `purpose` must match the canonical *research-only* declaration byte-for-byte. Unknown permissions such as `ingestAuthorized`, hidden/non-enumerable metadata, missing fields and accessor properties are rejected before data is interpreted; future legitimate fields require an explicitly reviewed schema version rather than silent extensions. Independent QA reproduction: [#2097](https://github.com/Zennay/Supa/issues/2097) and [#2099](https://github.com/Zennay/Supa/pull/2099). The original nonauthorizing `productionReady=false` invariant remains.

**Market-list provenance control:** these v1 candidate links are now exact-URL pinned to the two cited research organisations and their three confirmed public articles. Replacing evidence with an unrelated/lookalike HTTPS URL is rejected by the offline audit. Extending the set requires independent manual source verification; none of these articles grants product-data reuse rights.

- Existing M1 source-permission gate: `scripts/m1-check-source-permission-gate.mjs` (PLUS/DekaMarkt only).
- Open permission work: Notion PWQ-316; expansion epic https://github.com/Zennay/Supa/issues/2069.

## Usage (offline; Node)

```bash
node scripts/m5-audit-retailer-discovery.mjs
node scripts/m5-audit-retailer-discovery.mjs --require-production-ready
node --test tests/m5-retailer-discovery.test.mjs
```

The strict production-ready mode **always exits 2**. All individual records explicitly keep region/assortment, terms, robots, data ownership, contact, refresh, risk, priority and permission evidence **unassessed/unreviewed/null** until a separately reviewed follow-up. This registry has no "permitted" switch and deliberately cannot grant production rights. The M1 permission gate still covers only its original two chains; never append unapproved retailers to it.

## New offline retailer review pack (read-only)

The previously separate discovery register now has a **human review worksheet exporter**. This is real executable code, but it does not fetch any retailer website, contact data owner, grant rights, or update permission statuses.

```bash
node scripts/m5-build-retailer-review-pack.mjs --format=csv
node scripts/m5-build-retailer-review-pack.mjs --format=markdown
node scripts/m5-build-retailer-review-pack.mjs --format=json
node --test tests/m5-retailer-review-pack.test.mjs
```

- CSV: fixed 14-column/17-row sheet (chain identity, market-source evidence, initial M1 proof pair, explicit unknown region/assortment/technical/terms/robots/owner/permission evidence, and concrete next-action checklist), ready to copy to a researcher-controlled document.
- CSV cells are quoted, spreadsheet-formula-prefixed safely, and control characters filtered; rendered Markdown escapes tables, markup and pipe characters. The register itself is never overwritten.
- JSON: deterministic offline work pack usable by a **separately approved** queue importer. It always reports `productionReady=false` and `productionEnabled=false`.
- `existingM1ProofPair=true` solely distinguishes the historical PLUS/DekaMarkt technical research pair; this never indicates that actual source reuse, field observation or production access is authorized.
- No implied rights or review acceptance: *market-listed* is not *licensed*, *robots-permitted* is not *data licensed*, and a working selector is not *permission*.
- Reviewer must retain explicit source owner confirmation, permission proof, current terms/robots, store/region rights, allowed refresh cadence, and scope separately. This automated exporter records none of those as reviewed.

## Current M1 → future M5 rights reconciliation (offline)

The second new command reads **the actual canonical** `evidence/m1/source-permission-gate.v1.json` without changing it, compares its explicit two-source permission states with the 17-chain M5 market inventory, and reports who is research-only versus who has never been part of M1. This avoids silently treating market coverage as proof of a licensed data feed.

```bash
node scripts/m5-reconcile-retailer-rights.mjs
node scripts/m5-reconcile-retailer-rights.mjs --require-m5-ready
node --test tests/m5-retailer-rights-reconciliation.test.mjs
```

- At this branch snapshot PLUS has `permission_required` and DekaMarkt `unresolved` **inside the canonical M1 gate**. All 15 other chains are `not-in-m1`.
- Explicit M1 provenance never changes the exploratory M5 `permissionStatus=unreviewed`; `m5Eligible=false` and `productionReady=false` under every input, and the strict readiness flag exits 2.
- If the M1 gate itself changes, the report reflects the validated canonical gate state without pretending that technical M1 evidence grants broader M5 rights. Tests include a **fictional** M1 permission-granted fixture to lock this separation.
- This is a **reporting/preparation feature**, not an M1/M3 migration, live capture, queue claim, signed approval, or M5 release switch.

## Hosted review artifacts (offline, no M5 go)

The new [M5 offline retailer review pack workflow](../.github/workflows/m5-offline-retailer-review.yml) checks out the exact PR head with `persist-credentials: false`, runs the isolated M5 regression files and builds a 14-day GitHub Actions artifact named `supa-m5-offline-retailer-review`. Only same-repository pull requests or explicitly dispatched runs are eligible. The workflow uses the GitHub-hosted runner; it performs no live retailer request, proxy probe, source ingestion, M3 observation, queue claim, production deploy or merge.

The downloadable archive contains `retailer-review.csv`, `retailer-review.md`, `retailer-review.json`, `m1-m5-rights-reconciliation.json`, `unreviewed-research-completeness.json`, `retailer-human-priorities.json`, `retailer-human-priorities.md`, `m5-blocked-production.json`, and `m5-blocked-readiness.json`. Both final reports must exit code 2 as a safety proof. These are *review-preparation artifacts*, not proof of access rights or savings.

## Offline human source-research intake — separate from production permission

A new **optional local-only human research file** is supported. Copy `docs/m5-retailer-research-template.v1.json` to a private, untracked location. Add only the fifteen documented fields per reviewed chain: `retailerId`, `reviewedAt`, `sourceKind`, `sourceUrl`, `termsUrl`, `robotsUrl`, `rightsState`, `rightsEvidenceUrl`, `regionScope` , `assortmentScope`, `termsReview`, `robotsReview`, `ownerContactStatus`, `freshnessPlan`, and `priority`. Each URL may be `null`. `sourceKind` is one of `unassessed`, `official-api`, `official-feed`, `public-html` or `no-public-source`. `rightsState` is one of `unknown`, `request-pending`, `denied` or `claimed-written-permission`. The extra human-research statuses use deliberately **non-authorizing** categories:
- `termsReview`: `unreviewed`, `restrictive`, `unclear`, `allowance-claimed`.
- `robotsReview`: `unreviewed`, `restrictive`, `conditional`, `allowance-claimed`.
- `ownerContactStatus`: `unassessed`, `owner-identified`, `contact-pending`, `reply-recorded`. No contact names or addresses in the ledger.
- `freshnessPlan`: `unassessed`, `manual-only`, `daily-claimed`, `weekly-claimed`.
- `priority`: `unprioritized`, `P1`, `P2`, `P3` (research priority only).

All researched categories describe reviewer claims, **never verified source permissions**. A non-null URL must use canonical HTTPS without credentials/fragments.

```bash
cp docs/m5-retailer-research-template.v1.json /private/path/review.json
# Edit the private copy only, then inspect safely:
node scripts/m5-assess-retailer-research.mjs /private/path/review.json
node --test tests/m5-retailer-research-review.test.mjs
```

The private file must be an ordinary **non-symlink**, at most **64 KiB**, and mode **0600 or otherwise group/other-inaccessible on Unix**.

**Bounded bytes and exact review schema:** the same open private descriptor is read in bounded chunks, capped at 64 KiB even if the file grows after its initial size check; invalid UTF-8 is rejected. Direct JavaScript reviewer inputs also require exact plain-object root/retailer schemas: non-enumerable permission claims, extra keys and property getters cannot be silently ignored. A local research report remains purely descriptive regardless of claimed rights.\n\n**No symlinked ancestors (QA #2102):** on Linux the reader opens every parent directory via an already verified directory descriptor and `O_DIRECTORY | O_NOFOLLOW`, then opens the final regular file via that trusted parent descriptor. This protects against intermediate symlinks and directory replacement between lookups; the same final descriptor is used for size/mode validation and reading. The reader requires Linux `/proc/self/fd` for this stronger path guarantee. Other platforms use an explicit `lstat` of every ancestor plus a nofollow final open, but cannot promise Linux-level protection against concurrent parent-directory swaps. Both review and priority CLIs share this guard, and their stderr stays path-free.
 The committed empty example template is the only intentionally public input exception. Invalid or unavailable private inputs fail with a **generic error that does not expose file paths or URL values**.\n\nThis reader **does not write or upload the private file**. Reports return only retailer ID, completeness flags, source category, rights *claim* (not permission), and evidence-presence booleans. They never echo reviewer-supplied source, terms, robots or permission-evidence URLs. Extra unstructured contact, note, name or email fields are rejected. The optional human file must never be committed, uploaded to public CI, attached to a review PR or treated as a source ingest allowlist.

Even if `claimed-written-permission` has an HTTPS evidence URL, it remains **unverified**, `rightsVerified=false`, `m5Eligible=false`, `productionReady=false`, and `productionEnabled=false`. Independent verification of the actual written license, current M1 policy, M3 #78 evidence, M4 beta eligibility, original source-owner authorization and an explicit M5-go remain separate human gates.

The GitHub-hosted workflow runs this assessment **only on the empty template**, producing `unreviewed-research-completeness.json` (17 pending, zero reviewed) in the research-only artifact. No human-provided private record is uploaded or accessed.

## Human-first retailer research priorities

The new `scripts/m5-build-retailer-priorities.mjs` combines the reviewed candidate registry, **canonical actual M1 rights statuses** and an optional local-only private research ledger to generate a stable next-action queue. The default command reads only the EMPTY public template, so no retailer data is requested.

```bash
node scripts/m5-build-retailer-priorities.mjs
node scripts/m5-build-retailer-priorities.mjs --format=markdown
node scripts/m5-build-retailer-priorities.mjs /private/path/review.json --format=json
node --test tests/m5-retailer-priorities.test.mjs
```

- Open written source-rights questions for **PLUS and DekaMarkt** appear ahead of unreviewed later-market brands. A claimed written permission is *only a claim* and is sorted into **independent human legal review**, never a source enablement.
- Missing research yields the next offline identity/source review task. A denied source is marked `do-not-ingest`, while a pending human request is marked `await-human-reply`, without scraping, invented contact details or automatic retries.
- Inside the **same required human-action tier**, a manual `P1` research preference ranks before `P2`, then `P3`, then `unprioritized`; retailer ID breaks any remaining tie. **This can never outrank unresolved M1 rights or source-denial/legal-review gates.**
- These are **research priority ranks only**, not release priority, data freshness assertions or permission. All output records keep `rightsVerified=false`, `productionEnabled=false` and `m5Eligible=false`.
- The JSON and Markdown summaries never echo local reviewer URLs, filenames, names, emails, terms links or written-license documents. Private inputs reuse the same one-file-descriptor, no-symlink, ≤64KiB and Unix restrictive-mode reader.
- The GitHub-hosted workflow only exports the public-empty-template `retailer-human-priorities.json` and `retailer-human-priorities.md`. It never reads a real private reviewer ledger from the build workspace.

## Permanent VPS read-only proof

The additional [VPS M5 workflow](../.github/workflows/m5-retailer-review-vps.yml) is restricted to same-repository PRs (or explicit dispatch), checks out the exact PR SHA without stored GitHub credentials, validates permanent host `vps-bb300bba`, configures Node 22, runs only the offline M5 domain/CLI tests and verifies the empty public template. It performs **no live supermarket/API/network/proxy access, no participant intake, no production deployment**. A queued run is not a green validation; retain exact run ID, conclusion and commit SHA once executed. The GitHub-hosted and VPS checks are separate and must not be conflated.

## Acceptance for each future adapter (NOT completed)

1. Human confirms active retailer identity, correct official source/feed URL, data owner, store/region, and source-specific technical access rules.
2. Obtain and record actual terms/licensing/written permission and owner approval, **separate from mere market-list presence**.
3. Only after approval: capture a representative source-versioned public HTML or official feed sample with UTC timestamp and hash, sanitize it, and inspect real selectors/embedded JSON instead of inventing them.
4. Build retailer-specific normalization and golden regression fixtures for identity, exact euro-cent price, unit/pack, offer, availability and freshness. Noncompliant, rate-limited, blocked or stale source is unknown/disabled; no evasion.
5. Get independent zCloud claim/lease, original M1 adapter-owner acceptance, hosted CI/permanent VPS proof and explicit M5 go after genuine M3 #78 and the M4 beta gates.

This PR has no operational source access, human or observed basket evidence, and no public savings claim.
