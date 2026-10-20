# Private reviewed PLUS/DekaMarkt capture pipeline — safe replay

SUPA's six archived, already reviewed retailer shapes remain an **offline technical rehearsal**. This pipeline never acquires current supermarket prices or permits their publication.

## First run: prepare and pin

1. In a local owner-only folder (`0700`), stage 6–32 `capture-*.json` files (`0600`) that include all six PLUS and DekaMarkt product/catalog/offers shapes. Do not put real customer identifiers in this folder.
2. Run: `node --experimental-strip-types scripts/retailer-private-offline-end-to-end.mjs --dir /private/review`.
3. The one-shot command creates a private `manifest.json` with SHA-256 hashes and replays all six adapters. Its stdout contains counts only.
4. **Do not rerun the one-shot command** against an existing manifest. It deliberately refuses to overwrite it.

## Repeatable validation: read-only

Run: `node --experimental-strip-types scripts/retailer-private-offline-end-to-end.mjs --dir /private/review --verify`

- Requires an existing, owner-only SHA-pinned manifest and source files. Fails if the manifest is absent, a source was modified, file permissions are unsafe, the expected six retailer shapes are incomplete, or the adapter or provenance checks reject input.
- Never recreates or overwrites the manifest. This is suitable for VPS repeat verification of the **same already staged data**, including after a job restart.
- Output explicitly reports `manifestCreated: false`, `manifestVerified: true`, aggregate source/observation/product counts and the private-only/nonpublication gates.
- Do **not** construe a successful replay as current prices, retailer permission, a user savings result or M3 exit approval. The independent M3 human 11×2 basket, written rights and permanent runner proof remain separate requirements.

For creation and verification the only output shared with logs must be the aggregate report; retain raw capture files, source URLs, manifest bytes and source identities privately. Do not add any automatic external fetch or proxy activity to the verification path.
