# Independent M3 Markdown privacy QA — quoted fields in embedded text

**Date:** 2026-10-11. **Scope:** synthetic, add-only acceptance for [#1528](https://github.com/Zennay/Supa/issues/1528), stacked on frozen draft [#1529](https://github.com/Zennay/Supa/pull/1529) (`712dff2`). No changes to product code, existing QA owner file, workflows, real evidence, or `main`.

## Finding
The first Markdown privacy scanner recognizes ordinary bare-label and email-like lines. It does **not** reliably reject direct-identifier fields when they appear as *quoted keys in fenced JSON/YAML* or within HTML markup/comments in Markdown notes. Committed Markdown is an allowed durable M3 evidence format; the repository privacy boundary must apply to all of its content, regardless of markup or fencing. No real participant data was used or observed.

## Executable independent acceptance
Run `node --test tests/qa-m3-evidence-markdown-quoted-field-blackbox.test.mjs`. The test spawns the **actual #1529 scanner file** in a new temporary synthetic repository, with its own `evidence/m3/README.md` and one generated Markdown field note per case. It asserts 5 separate negative controls must be rejected and 3 policy/pseudonymous positive controls remain accepted. No direct modifications to the parent scanner or committed evidence. Nested child-process output is kept for diagnostic review.

## Exit criteria
1. On immutable parent head, reproduce exactly the targeted rejection failures; unrelated parent tests stay green. Do **not** mark RED as a release-ready CI result.
2. Original #1529 owner reviews a narrow fix to the privacy guard, including handling quoted keys/code fences/HTML constructs without banning legitimate policy text or pseudonyms. A parsing/escaping design must not normalize or silently strip sensitive content.
3. Independent QA re-runs on the approved fix; all negative and positive fixtures must pass, plus the complete locked-install/audit/test/benchmark/source-permission/build gates.
4. Obtain verified zCloud lease/current-`main` review, applicable permanent self-hosted/browser/M3 checks and original-owner approval. Keep any PR **DRAFT / HOLD / NO MERGE / NO DEPLOY** until then.

**Limits:** this test does not make the scanner an exhaustive PII detector. Synthetic controls are never supermarket observations, source permission, human study evidence or savings proof. Real M3 field gate [#78](https://github.com/Zennay/Supa/issues/78) remains open.
