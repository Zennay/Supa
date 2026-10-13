# M5 — read-only Nederlandse supermarktketen-inventaris (PWQ-316 / #2069)

**Status: candidate research only. M3 is active; M5 is NOT authorized.** No scraping, API calls, proxy probing, HTML downloads, selector guesses or retailer contact are performed by this module. This candidate inventory must never be used as a runtime ingest allowlist.

## Why this exists

The May 2026 Consumentenbond price survey lists thirteen chains. Wageningen University & Research's supermarket dashboard also identifies Boon, Ekoplaza and Odin. Together these give the initial **16 candidate brands**, not a promise that every supermarket/banner or franchise in the Netherlands is included. Re-evaluate coverage prior to any M5 expansion.

- WUR market research: https://www.wur.nl/nl/onderzoek/producten-diensten/dashboard-supermarkten-duurzaamheid-en-gezondheid
- Consumentenbond, 6 May 2026 survey: https://www.consumentenbond.nl/voedingstests/prijspeiling-supermarkten
- Existing M1 source-permission gate: `scripts/m1-check-source-permission-gate.mjs` (PLUS/DekaMarkt only).
- Open permission work: Notion PWQ-316; expansion epic https://github.com/Zennay/Supa/issues/2069.

## Usage (offline; Node)

```bash
node scripts/m5-audit-retailer-discovery.mjs
node scripts/m5-audit-retailer-discovery.mjs --require-production-ready
node --test tests/m5-retailer-discovery.test.mjs
```

The strict production-ready mode **always exits 2**. This registry has no "permitted" switch and deliberately cannot grant production rights. The M1 permission gate still covers only its original two chains; never append unapproved retailers to it.

## Acceptance for each future adapter (NOT completed)

1. Human confirms active retailer identity, correct official source/feed URL, data owner, store/region, and source-specific technical access rules.
2. Obtain and record actual terms/licensing/written permission and owner approval, **separate from mere market-list presence**.
3. Only after approval: capture a representative source-versioned public HTML or official feed sample with UTC timestamp and hash, sanitize it, and inspect real selectors/embedded JSON instead of inventing them.
4. Build retailer-specific normalization and golden regression fixtures for identity, exact euro-cent price, unit/pack, offer, availability and freshness. Noncompliant, rate-limited, blocked or stale source is unknown/disabled; no evasion.
5. Get independent zCloud claim/lease, original M1 adapter-owner acceptance, hosted CI/permanent VPS proof and explicit M5 go after genuine M3 #78 and the M4 beta gates.

This PR has no operational source access, human or observed basket evidence, and no public savings claim.
