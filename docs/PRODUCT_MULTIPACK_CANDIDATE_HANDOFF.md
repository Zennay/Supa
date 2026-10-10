# Product-core #168 — safe multipack candidate projection (draft)

The current reviewed pack parser retains `count` for e.g. `6 x 1 l`, but `RawPack` in the existing source-adapter ingestion shape stores only `rawText`, `amount` and `unit`. Mapping that raw shape into a matching candidate without a count could make a six-pack look like a one-litre pack.

## Implemented, isolated scope

The opt-in pure `projectTrustedPackForMatching(pack)` derives pack count from the original text, then **requires exact agreement** with the adapter's parsed amount and unit. It returns `null` on absent/unparseable text, contradictory quantity/unit or count, malformed input, and effective amount above the safe numeric range. It never defaults an unknown multipack to count 1. A future explicit `count` field must agree with the original text.

The additional `projectTrustedObservationPack(observation)` entry point first validates the complete raw observation and its supermarket/HTTPS source provenance; invalid, inconsistent or malformed observations cannot expose a trusted pack. This does not constitute a retailer-use permission check.

New executable test `tests/product-trusted-multipack-candidate.test.mjs` exercises the **real** one-store basket calculation with a synthetic 6 × 1 l candidate: a 4 l requirement needs one pack (199 cents), while 7 l requires two packs (398 cents). Also tests one-pack, comma decimal, unit mismatch, conflicting count, overflow and immutable input. The values are synthetic only.

## Integration required before issue closure

This intentionally leaves the active `src/data/ingestion.ts` (#117) and PLUS/DekaMarkt/schema.org adapters (#122) untouched. Source owners must agree on a canonical `RawPack.count` or a reviewed candidate-projection integration, then route trusted pack counts to downstream matching/basket decisions with authentic source-backed regression fixtures. A new helper does **not** mean source adapters already preserve count end-to-end.

No automatic store retrieval, source terms/permissions change, collection evidence, observed price or verified savings is introduced. Do not merge/deploy until source-owner review, exact-head hosted CI, path-selected permanent M1/VPS gates, and main integration approval. M3 human issue #78 remains open.
