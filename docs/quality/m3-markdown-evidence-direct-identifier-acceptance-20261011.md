# QA acceptance — privacy boundary for M3 Markdown evidence (2026-10-11)

Related [issue #1528](https://github.com/Zennay/Supa/issues/1528). The M3 evidence directory permits converted JSON and small Markdown notes. The existing M3 repository-boundary test inspects JSON direct-identifier keys and email-like values but does not inspect Markdown file contents. This independent add-only QA test closes the **obvious text disclosure** hole for allowed Markdown files without touching other owners' files.

## Executable control
`tests/qa-m3-evidence-markdown-direct-identifier-boundary.test.mjs` recursively scans actual `evidence/m3/**/*.md` (including README), rejects symlinks, rejects email-like address strings and clearly labelled direct-identifier field/value lines (including Markdown bullets, quoted lines and table columns). Synthetic tests assert rejection of contact emails, name/email/account identifier aliases and acceptance of neutral policy text, pseudonymous `participantKey`, `studyId`, ordinary ingredient and store names.

## Reproduce
`node --test tests/qa-m3-evidence-markdown-direct-identifier-boundary.test.mjs`

Use exact-head hosted npm test, locked install, audit, M1 benchmark, permission gate, and TypeScript/Vite build. This new guard is intentionally narrower than a general PII scrubber: it cannot reliably detect unlabelled natural-language names, addresses, intentional obfuscation, or all Unicode confusables. Human review of each field artifact remains mandatory.

## Isolation, safety and release
Only NEW QA test and documentation files; do not rewrite the JSON guard currently owned by [DRAFT #1523](https://github.com/Zennay/Supa/pull/1523), production source, workflows, original evidence, or main. All fixture strings are synthetic; no field data, retailer prices, source rights, public savings or real participant identity has been acquired. Genuine M3 field issue [#78](https://github.com/Zennay/Supa/issues/78) remains open.

**DRAFT/HOLD/NO MERGE/NO DEPLOY** until verified zCloud lease, original QA/source owners' review, exact-head CI and relevant permanent runner proof; rebase safely against latest main and avoid scope collisions with #1523.
