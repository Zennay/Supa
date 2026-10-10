# M3 filled CSV structural review (opt-in, never evidence approval)

This operator tool complements the **blank 22-row CSV template** from product draft #1162. It does not modify the template or any original M3 collector/assessment source. It is a **structural and completeness preflight** for privately completed copies, **not** an import, data-source attestation, retail permission, real-price verification or savings calculation.

## Use

Generate a blank CSV using `node --experimental-strip-types scripts/m3-export-blank-field-checklist.mjs > private-blank.csv`. Fill it yourself **only from actual observations** at PLUS (baseline) and DekaMarkt (candidate) in one shared price context, within 24 elapsed hours. Store it outside Git. Then:

```sh
node --experimental-strip-types scripts/m3-review-field-csv.mjs /your/private/observations.csv
```

This read-only command emits only `status`, 22-row completeness counts, allowlisted warning codes and explicit `evidenceVerified:false`, `releaseEligible:false`, `claimable:false`, `savingsCents:null`. It does **not** print products, notes, prices, URLs, participant information, raw timestamps, store observations or input file names. Bad input exits nonzero with one generic diagnostic, never raw data.

The template retains immutable demand IDs, amounts, retailer order, evidence marker and canonical row count. Supported `available` values: `ja`/`nee`, `yes`/`no`, `true`/`false`; use a numeric decimal for pack amount, positive whole pack count, nonnegative integer cents, and canonical `g`, `kg`, `ml`, `l`, `piece` units. Available lines need observed time, context, source, product, pack and price; explicitly unavailable lines need time/context/source but must leave product/pack/price empty. The context must be exactly `in-store` or `online-order` in every row, consistently across both retailers. The source must be exactly `manual-cart`, `receipt` or `consented-export` on each line; arbitrary notes, cached search results or a source-type placeholder cannot make a row complete. An unmeasured line stays blank (not zero). Source URLs, when present, must be HTTPS.

Captured timestamps use ISO 8601 with explicit `Z` or signed timezone offset, up to milliseconds. More precise timestamps fail review rather than being silently rounded. A timestamp later than the local review instant also fails closed (including a future-dated observation in just one of the 22 lines); timezone offsets are compared as real absolute instants, and equality with the review instant is allowed. The CLI uses the current system clock and has no override flag. Ensure the machine clock is correct before interpreting the local preflight. The tool detects mixed price contexts and timestamps more than 24 hours apart; this check cannot prove observations really occurred. CSV uses one physical line per item: embedded line breaks, malformed quoting, changed canonical demand or row order fail. A strict 128 KiB local-file cap avoids accidental massive/sensitive input. Symlinked or non-regular input files are rejected.

**A result of `requires-canonical-human-verification` is still NOT verified, suitable for publication or eligible for a savings claim.** It means only that the local file passes these limited syntactic checks. An independently checked genuine [issue #78](https://github.com/Zennay/Supa/issues/78) field run must still preserve the exact revision pin and source evidence, use the canonical M3 JSON observation sheet, run the existing converter and `npm run m3:assess-observed-week` checks, and retain worse/unknown outcomes. The canonical human assessment and retailer usage-permission gates remain authoritative. Do not commit filled CSV files or source/private observations.

This is a separate stacked **DRAFT / HOLD / NO MERGE / NO DEPLOY** until exact-head CI, applicable VPS gates and both original #1162 and M3 source owner acceptance.
