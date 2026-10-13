# M5 — read-only Nederlandse supermarktketen-inventaris (PWQ-316 / #2069)

**Status: candidate research only. M3 is active; M5 is NOT authorized.** No scraping, API calls, proxy probing, HTML downloads, selector guesses or retailer contact are performed by this module. This candidate inventory must never be used as a runtime ingest allowlist.

## Why this exists

The May 2026 Consumentenbond price survey lists thirteen chains. Wageningen University & Research's supermarket dashboard also identifies Boon, Ekoplaza and Odin. Along with Boni (covered by a July 2026 Consumentenbond update), these give the initial **17 candidate brands**, not a promise that every supermarket/banner or franchise in the Netherlands is included. Re-evaluate coverage prior to any M5 expansion.

- Consumentenbond Boni reference: https://www.consumentenbond.nl/acties-claims/nieuws/2025/laagsteprijsclaims-van-supermarkten-update
- WUR market research: https://www.wur.nl/nl/onderzoek/producten-diensten/dashboard-supermarkten-duurzaamheid-en-gezondheid
- Consumentenbond, 6 May 2026 survey: https://www.consumentenbond.nl/voedingstests/prijspeiling-supermarkten
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

## Acceptance for each future adapter (NOT completed)

1. Human confirms active retailer identity, correct official source/feed URL, data owner, store/region, and source-specific technical access rules.
2. Obtain and record actual terms/licensing/written permission and owner approval, **separate from mere market-list presence**.
3. Only after approval: capture a representative source-versioned public HTML or official feed sample with UTC timestamp and hash, sanitize it, and inspect real selectors/embedded JSON instead of inventing them.
4. Build retailer-specific normalization and golden regression fixtures for identity, exact euro-cent price, unit/pack, offer, availability and freshness. Noncompliant, rate-limited, blocked or stale source is unknown/disabled; no evasion.
5. Get independent zCloud claim/lease, original M1 adapter-owner acceptance, hosted CI/permanent VPS proof and explicit M5 go after genuine M3 #78 and the M4 beta gates.

This PR has no operational source access, human or observed basket evidence, and no public savings claim.
