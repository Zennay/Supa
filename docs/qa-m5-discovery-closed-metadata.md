# M5 candidate registry — independent closed metadata contract (QA)

**Read-only / offline / NO retailer access.** Product source is frozen from [DRAFT #2090](https://github.com/Zennay/Supa/pull/2090) SHA `7c0d073ef44cb71c55af5d1a3b22949b7d189f92`; source code and original four files unchanged. Issue [#2097](https://github.com/Zennay/Supa/issues/2097).

## Reproduce

`node --test tests/qa-m5-discovery-closed-metadata-red.test.mjs`

The source `assessRetailerDiscovery()` enforces `productionReady=false` in its derived report, but it currently ignores unrelated object properties and an arbitrarily altered `purpose`. That can make an offline source document carry contradictory assertions without audit failure. It **does not** directly enable production ingest, create rights, prove a live incident, or authorize retailer traffic.

## Isolated acceptance

| Group | Synthetic mutation | Expected |
|---|---|---|
| GREEN | Original 17-candidate JSON unchanged | Stable 17 stores, deterministic report, all disabled |
| GREEN | `permissionStatus=denied` and `permission-requested` | Denial remains no-ingest; productionReady false |
| RED x4 | Root `productionEnabled=true`, `permissionGranted=true`, `ingestReady=true`, `licenseVerified=true` | **Reject** unexpected rights flags |
| RED x3 | Extra per-retailer `ingestAuthorized=true`, `licenseApproved=true`, `proxyOverridePermitted=true` | **Reject** unexpected rights flags |
| RED x1 | Replace top-level `purpose` with production allowlist assertion | **Reject** misleading purpose |
| RED x1 | Actual CLI processes a disposable candidate JSON with root `productionEnabled=true` | Exit nonzero without printing a plausible report; input unchanged |

**11 total executable tests** (2 GREEN + 9 expected RED). All mutations run fully in memory; the CLI case uses an auto-deleted directory and synthetic JSON, not real retailer credentials or endpoint requests.

The product owner may implement a closed/versioned allowlist of allowed top-level and record keys and exact research-only purpose, avoiding accidental backward incompatibility with future explicitly reviewed schemas. Keep `permissionStatus` restricted to the existing non-authorizing statuses. Production permission remains governed separately by the existing M1 source-permission gate.

Independent zCloud preflight/write lease, original owner review, all-GREEN corrected-head hosted and applicable permanent VPS proof, integration on latest main, M3/M4 prerequisite completion and explicit human release authorization are required before merge or deploy. Until then **DRAFT/HOLD/NO MERGE/NO DEPLOY**; M3 authentic PLUS + DekaMarkt [#78](https://github.com/Zennay/Supa/issues/78) remains OPEN.
