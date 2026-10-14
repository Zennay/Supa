# Direct future-M5 report envelope: one own-data snapshot

Independent product issue [#2325](https://github.com/Zennay/Supa/issues/2325), child of product [#2323](https://github.com/Zennay/Supa/pull/2323) at frozen SHA `0b089507faa27932fba75b2bb28dd7a517a27284`.

Canonical offline `compareInspections()` returns an object whose nine required report fields are own ordinary data properties. The pure exported `buildOfflineSelectorReviewQueue(report)` also accepts synthetic direct inputs. Previously it read `contractVersion`, `mode`, `productionReady`, `m5Eligible`, `reviewerActionRequired`, `baselineProvided`, `captureCount`, `driftCount`, and `changes` through normal access, which may execute accessors or read changing values before reporting a human action.

This product-core child snapshots **own data property descriptors** for these nine required envelope fields *before* any checks, validates and uses the snapshot consistently for all P1/P2/P3 decisions, counts and output. Inherited, missing and getter fields are invalid; no user-defined getters should execute during these root-field reads. Nested own change-row and snapshot fields were already independently pinned in parent #2323. Strict error is generic and does not include source metadata. This is not a claim of arbitrary Proxy-trap immunity or general proof of untrusted object authenticity.

Own **14** fully fictional Node tests cover all nine top-level getters, inherited/missing metadata, genuine no-baseline P2, unavailable P1, historical unchanged P3 and inline fake Product M1→M5 human-only review. All rights/selector/production/M5 flags remain false; no real retailer/price network, users, PII, or source permissions.

Supa **M3 ACTIVE**; authentic matched PLUS11+DekaMarkt11 human 24-hour basket pair [#78](https://github.com/Zennay/Supa/issues/78) not yet received. M4/M5 INELIGIBLE. This child and predecessors **DRAFT/HOLD/NO MERGE/NO DEPLOY** pending independently verified zCloud SQLite task/scope write lease, original source and QA reviews, full exact-head hosted CI and latest-main/trusted runner as applicable, actual field observations/source-rights evidence and explicit human approval.
