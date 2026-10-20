# M3 — secure private operator fieldkit

Independent **quality-validation** CLI for Supa's outstanding **actual PLUS/DekaMarkt 11×2 field-observation** work. It is an immediately usable *read-only alternative* to the currently permissive product-owned `scripts/m3-private-field-progress.mjs` operator entrypoint (**P1 #3785**). It does **not** fix, override or edit the product CLI.

## Running with real local private field evidence

The already-created file must be a **regular, single-linked JSON file owned by the current operator** with group/world permissions removed (`0600`) and no symlinks in its path. The input cannot exceed 2 MiB, cannot be malformed UTF-8 and must restore as a valid canonical M3 draft.

```bash
# Keep real participant/store/product/price evidence private; never commit it.
chmod 600 /absolute/private/location/operator-sheet.json
node --experimental-strip-types scripts/qa-m3-private-operator-fieldkit-20261017.mjs --file /absolute/private/location/operator-sheet.json --text
# Or machine-readable, counts-only:
node --experimental-strip-types scripts/qa-m3-private-operator-fieldkit-20261017.mjs --file /absolute/private/location/operator-sheet.json
```

The operator must **not** copy participant IDs, real product names, real paid prices, retailer URLs, SHA fingerprints, raw notes or source dates into public CI. The tool prints none of those fields. It does not write, truncate, fix or upload the input.

## What it checks (actual code paths)

1. The established, reviewed QA reader `readPrivateM3OperatorFile` opens a **single pinned file descriptor** with `O_NOFOLLOW|O_NONBLOCK`, validates owner UID, `0600` permissions, single link, regular type, non-symlink parent components, bounded size, byte stability and strict UTF-8.
2. **Both** canonical `buildPrivateM3FieldProgress` and `buildM3OutstandingFieldActions` independently parse the **same original byte snapshot**. Disagreement about canonical 22-line demand, completed/missing retailer rows, private review readiness or time-window state is a generic refusal; it is **never** normalized away as a misleading green result.
3. The output shows exactly the outstanding **PLUS 11** and **DekaMarkt 11** line counts, total missing, metadata remaining, coarse time-window state and whether human **private** review may proceed. The status cannot be converted into a verified store visit, public savings claim, production capability, authoritative source rights or proof of permanent runner execution.

The external M3 exit blockers always remain explicit: [#74 written source rights](https://github.com/Zennay/Supa/issues/74), [#78 real 11+11 ≤24h matched observation](https://github.com/Zennay/Supa/issues/78), [#205 persisted source SHA](https://github.com/Zennay/Supa/issues/205), and [#2833 attested permanent self-hosted gate](https://github.com/Zennay/Supa/issues/2833).

`readyForPrivateHumanReview:true` means **only** that a valid private draft is ready to be considered by an independent human. It is **not** an authenticated in-store price measurement or consent to redistribute product data. `releaseDecision` remains `hold`, with `productionEnabled:false`, `publicSavingsClaimEligible:false`, `livePricesAvailable:false` and `externalRequests:0`.

## Failing closed

Invalid CLI flags, missing file, NUL paths, path aliases/symlink components, group/world-readable source, hardlinked source, oversized file, malformed UTF-8, noncanonical observations, programmatic getter/proxy argv or contradictory independent progress projections exit nonzero, emit **no successful stdout** and show only a fixed generic refusal. No paths, participant or price fields appear in the generic error.

```bash
node --experimental-strip-types --test tests/qa-m3-private-operator-fieldkit-20261017.test.mjs
```

This is QA lane 1/2, in new `qa-m3-` paths only. The source-owner should still remediate the original product CLI #3785 using its existing expected-RED [PR #3784](https://github.com/Zennay/Supa/pull/3784); do not silently close that issue because an opt-in safer tool exists.
