# M3 field readiness: privacy-safe local checklist

This is an operator aid for [the genuine two-retailer, same-demand field proof](https://github.com/Zennay/Supa/issues/78). It does **not** collect prices, generate retailer evidence, authorize retailer-data reuse, or establish a savings claim.

## 1. Prepare the canonical empty sheet

On a trusted local or authorized VPS workspace, make a **private** location outside this Git repository. Run:

```sh
npm run m3:create-observation-sheet -- --output /private/location/observation-sheet.json
```

The created file is a collection **template**, not evidence. The generator refuses to overwrite it. Do not commit the filled JSON, put it in a PR, or paste its sensitive contents in public CI logs, issues, chat, or documentation.

## 2. Human collection

For **the same canonical 11 ingredients**, independently record an actual PLUS baseline and DekaMarkt candidate, each with 11 availability decisions, product/pack descriptions and observed prices where available. Record separate observation timestamps with explicit UTC offsets. Use one shared price context, `in-store` or `online-order`, and stay within **24 elapsed hours**. Preserve the source/provenance locally. Do not guess missing products/prices; `available:false` is more honest than a fabricated match.

Use a pseudonymous participant key, never a real name, email, loyalty-card number or account identifier. Any real-world collection and subsequent production source reuse must respect consent, terms and the independent permission gate.

## 3. Check locally before conversion

```sh
node --experimental-strip-types scripts/m3-check-field-readiness.mjs /private/location/observation-sheet.json
```

The command reads but does **not** modify the sheet, create files, print raw prices, source URLs, participant identifiers or provenance. Its JSON output can be inspected locally:

- `needs-field-input`: count and canonical labels for missing work, plus the 24-hour window state. Finish or explicitly record unavailable products; never invent answers.
- `invalid` (exit code 1): a malformed sheet, structural drift, coerced restored values or unreadable JSON. Preserve the original; investigate before continuing.
- `ready-for-human-review`: all 22 availability/line slots and metadata passed the existing shape and converter preflight. It is **still not independently verified retailer evidence**, and **not proof of savings**.

No status asserts that the person actually visited the retailers, used a permitted source, established current prices or justified publishing financial claims. That requires source-specific human review and the existing evidence acceptance rubric.

## 4. Existing trusted converter and assessment path

Only after verifying actual collection and authorization in the private workspace:

```sh
npm run m3:build-observed-study -- /private/location/observation-sheet.json --output /private/location/study.json
npm run m3:assess-observed-week -- /private/location/study.json --output /private/location/report.json
```

Retain the raw observations and reproducibility context privately; do not publish participant data. Better, same, worse and unknown outcomes are all legitimate if supported by observations. The report's public-savings gate and any M3 exit decision remain separate; a green automated test or completed synthetic sheet is never enough.

## Isolation

The checker reuses the canonical draft-restoration and field-readiness contracts and makes a **read-only** converter preflight. It never alters the active observation UI, stored draft, converter, retailer extraction, savings maths, workflows or `main`. Its tests use explicitly synthetic values only.
