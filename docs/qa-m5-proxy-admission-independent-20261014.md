# SUPA quality-validation — independent M5 Proxy boundary acceptance (2026-10-14)

## Evidence ancestry and ownership

- **Frozen product-owner source:** [#2349](https://github.com/Zennay/Supa/pull/2349), exact HEAD `fa83b8b1692c99312a245ed56142a92d8840ca2c`; [hosted CI #38514767836](https://github.com/Zennay/Supa/actions/runs/38514767836) confirms 1,298/1,298 Node and npm high audit/M1 controls/build green. No assumption of owner-independent QA success.
- **Independent QA scope 2/2:** add-only test files and this provenance document on a separate QA branch. Product source is untouched; no main, live retailer sources, UI, workflows, VPS, security bypass, participant or observed price access.
- **Replayed historical QA:** eleven unchanged byte-identical QA test files containing **189 test cases**, copied from [#2347](https://github.com/Zennay/Supa/pull/2347) frozen HEAD `7271ef8eeee2b74364df5f149aa9ef894fe89aca`. Original [#2346](https://github.com/Zennay/Supa/pull/2346) shared-source object regression had exactly 8 expected RED against earlier unsafe source; unchanged SHA test blob `981ae290c845a23e6d987313c144f572b394ab40` went green on product-core #2344 in #2347, CI #38514609654, **1,455/1,455**.
- **New QA 30-case suite** `tests/qa-m5-proxy-admission-independent-20261014.test.mjs` checks literal synthetic M1 inspected Product HTML, true independent clones and P1/P2/P3 manual outcomes, flat and nested Proxy traps at root/source-array/source-object/HTML/JSON-LD/scripts/schema boundaries, revoked Proxy fail-closed error attribution and zero trap invocations, privacy-safe review source tokens and always-false permission/selector/production/eligibility gates.

## Acceptance target

Require the **exact SHA** of the final QA branch to complete **1,517 total Node tests** (1,298 product source + 189 immutable independent regression replay + 30 new independent Proxy tests), 0 fail/skip/todo, npm high audit 0, M1 matching/source-permission gate PASS, TS/Vite build PASS. These are *targets*, not facts until verified in hosted CI.

Neither simulated fake Product JSON-LD nor repeated P3 means a genuine independent historical price observation. The pure QA suite does **not** authorize production store scraping, rights or release.

## M3 and release boundary

Notion SUPA canonical phase is **M3 ACTIVE**. [#78](https://github.com/Zennay/Supa/issues/78) requires 11 authentic PLUS baseline and 11 DekaMarkt candidate observations on the same demand in a shared in-store / online order price context within 24 hours; collection is a human activity. The M3 collector and assessment path are already implemented, so do not manufacture new prices or a field run. M4/M5 **INELIGIBLE**.

**DRAFT / HOLD / NO MERGE / NO DEPLOY** pending independent zCloud SQLite task/scope lease, original product + QA owner review, actual current-main/trusted runner where relevant, live field/retailer source rights and explicit human release approval.
