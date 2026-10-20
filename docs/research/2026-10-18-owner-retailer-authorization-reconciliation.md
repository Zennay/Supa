# SUPA — retailer owner-authorization reconciliation (18 October 2026)

## Owner statement (recorded, not silently discardable)
The SUPA project owner confirmed on 2026-10-18 that authorization exists for **all supermarkets within the current SUPA grocery-comparison scope** and that supporting documents have already been reviewed. The current M1 programmatic retailer pair is PLUS and DekaMarkt. Original statement and machine-readable register metadata: [issue #74](https://github.com/Zennay/Supa/issues/74#issuecomment-6247340961) and `evidence/m1/source-permission-gate.v1.json`.

This is an **owner-reported fact about the existence of permission**, not a fabricated direct statement from either retailer, not a verified document URL and not confirmation that price, promotion, storage, automated extraction, display and resale rights all have identical scope.

## Why the software said otherwise
- [d7fb37e](https://github.com/Zennay/Supa/commit/d7fb37e68297080dc743b669261a9b37edd03467) enabled both entries, but used the ordinary retailers' general terms as the only evidence.
- [c41c965](https://github.com/Zennay/Supa/commit/c41c9657a28cb78d5d1838930d4e34dbba7fed0a) reverted this change because the source register requires concrete written permission/licence evidence for production use. It did not disprove the existence of owner-held paperwork.
- The present register therefore must distinguish **owner has confirmed permission exists** from **the canonical technical register has checked the actual retailer granting document and its scope**. Absence of a pinned document is not evidence the owner never obtained permission.

## Permanent working rule for SUPA workers
1. Preserve the original owner attestation and its date/link; never silently delete/revert it simply because no private licence was found in GitHub.
2. On the next documentation handoff, locate the already obtained permission records, record per retailer: issuer, effective/expiry date, relevant licence/permission identifier, product and price fields, collection methods, geography, cache/retention, public display and automation terms. **Do not commit private contracts, personal email addresses, credentials or unredacted correspondence.** A restricted artifact identifier and privacy-safe outcome can be recorded instead.
3. Authenticate scope before changing `permissionStatus` to `permitted` and switching on scheduled retailer ingestion. An owner assertion or public general-conditions URL alone must not be represented as `written_permission` or `official_license`.
4. Do not block user-owned private CSV/JSON import, offline basket calculations, recipes, planner, or shopping-list functionality while source-specific production rights evidence is being reconciled.
5. Treat an owner statement and documentary status as distinct states in Notion/zCloud. When uncertain, report **"owner reports approval; document not yet linked"** instead of **"owner never obtained permission"**.
6. Keep the separate genuine observed PLUS and DekaMarkt same-demand 11×2 field-evidence process (#78) independent of licence/documentary verification (#74).

This documentation and associated register metadata do **not** authorize network crawling, circumvent access controls or enable production publication.
