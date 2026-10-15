# Independent M3 QA — sparse active day holes must never silence the field-study mismatch warning

**Frozen product owner:** [#3010](https://github.com/Zennay/Supa/pull/3010), HEAD `3e8cd4c1a7ed44bcd7950cd58a7bb8c62270c8e4`, exact main parent `ac09ea8bb99d34321983e6639f6c7b2d962a3a38`. Source under test: `src/features/observation/m3PlannerMeasurementWeek.ts` from [#3008](https://github.com/Zennay/Supa/pull/3008), Git blob `0f269ef91223578ee4cda87d455482c525f6dbb4`.

The current input contract requires exactly the four frozen M2 days for the 11-item per-store fixed M3 research template. Existing owner QA proves standard missing/duplicate/unknown days; it does **not** exercise sparse `Array` holes.

**One completely standalone QA add-only test**:
- Real canonical plan and reversed ordering continue to match, but missing/duplicated normal day lists do not. Verify the blank template still has 11+11 observations and `collection-template-not-evidence`.
- For each of the four day slots, delete the index while preserving `array.length===4`. `new Set(array)` sees the missing slot as `undefined` and still has size 4, but `Array.every()` skips holes. The current validator can thus return **true** even though only three actual day strings exist. Assert it must return **false** (the UI shows its privacy-safe alert when passed false), without modifying either input or the M3 evidence.
- No live retailer request, source rights change, customer data, pricing, real savings or release claim.

**Expected RED on unchanged owner code**, not a demonstrated real user incident. Run exact hosted Node suite + audit; only file independent QA defects on confirmed negative tests with a clean positive control. Do not silently edit product/peer (#3011) code or workflow to make tests green. Product owner must fix on its own branch (explicit own indexed slots/canonical membership), then replay **the original QA blob byte-for-byte** on the corrected source. Keep this QA PR DRAFT/NONMERGE. Human [#78](https://github.com/Zennay/Supa/issues/78), rights [#74](https://github.com/Zennay/Supa/issues/74), real revision pin [#205](https://github.com/Zennay/Supa/issues/205), trusted VPS [#2833](https://github.com/Zennay/Supa/issues/2833), independent review and scoped zCloud SQLite lease all remain separate release holds.
