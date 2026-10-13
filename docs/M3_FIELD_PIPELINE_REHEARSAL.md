# M3 field-run pipeline rehearsal (synthetic only)

**M3 remains ACTIVE; the genuine human PLUS + DekaMarkt comparison [#78](https://github.com/Zennay/Supa/issues/78) remains OPEN.** This is an operator smoke test, not a field observation, production retailer-data authorization, M4 beta permission or savings proof.

## Before leaving for an authorized real-world field run

On the exact intended working revision, after installing dependencies, run:

```sh
node --experimental-strip-types scripts/m3-rehearse-field-run.mjs
```

No arguments, network access, input files, output paths, browser session, human observations or credentials are required. The command exercises **the actual canonical observation sheet builder → study converter → assessment reporter** in memory, with a fixed fictional PLUS/DekaMarkt 11 + 11 demand pair. It never writes evidence files. Everything is explicitly fictional; availability is set to *observed unavailable* solely for negative-control testing, and is never substituted for any real field measurement.

Checks include same canonical requirement IDs and demand, separate retailer identities, strict 11 + 11 unknown monetary outcomes, a bogus hidden price behind unavailable, refusal to treat unmeasured as unavailable, demand tampering, wrong retailer, and exactly 24h versus 24h + 1 second. It also runs **fully fictional but valid prices** through all eleven real matcher/pack-calculation paths to verify the private better/same/worse branches, then proves that an expired or partially unresolved priced basket becomes unknown/null. No fictional euro amounts or study identifiers appear in CLI output. A failure emits only a generic error and a nonzero exit; success emits a fixed summary with `syntheticOnly:true`, `m3ExitProven:false`, `realRetailerEvidenceVerified:false`, `publicSavingsClaimEligible:false`, `m4BetaEligible:false`.

This is a **safe pipeline rehearsal**, not a structural review of any filled real sheet. Existing M3 manual field readiness and human evidence-review procedures are separate. The script intentionally does not read files, identify participants, or print raw study JSON, retailer prices, provenance or any monetary estimate. Run it before collecting human data to detect an unexpectedly broken converter/assessor environment without contaminating the genuine evidence record.

## Genuine evidence remains a separate gate

On collection day, follow the [canonical manual observation sheet procedure](M3_OBSERVED_BASKET_STUDY.md), pin current `main` and dispatch the authorized field-run pack once, retain the exact SHA/run and collect a genuine 11 + 11 same-demand PLUS and DekaMarkt pair within 24 elapsed hours in one shared price context. Store original evidence privately, then use the existing verified converter, assessment and independent human review. Record *worse*, *same* or *unknown* as honestly as *better*. Do not commit receipts/real observation sheets or report public savings on the strength of any synthetic rehearsal.

**DRAFT / HOLD / NO MERGE / NO DEPLOY:** independent zCloud claim/lease preflight, product/M3 owner review, current-main integration, applicable exact-head CI/VPS and explicit release authorization remain necessary.
