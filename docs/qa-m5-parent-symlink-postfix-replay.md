# M5 private reviewer symlink-ancestor source-owner correction — independent exact-head QA replay

Original source-owner [DRAFT #2090](https://github.com/Zennay/Supa/pull/2090) updated to immutable **`d261c2b0af492835104f764d402af15b43ffce8e`** after QA [issue #2102](https://github.com/Zennay/Supa/issues/2102), earlier [expected RED PR #2103](https://github.com/Zennay/Supa/pull/2103).

The pre-repair [CI #38467466515](https://github.com/Zennay/Supa/actions/runs/38467466515) on earlier original owner `15e2a2bf...` proved **702/698 PASS/4 expected RED** for immediate/nested symlink ancestors via real `loadPrivateRetailerResearch` and CLI. This dedicated follow-up copies the original **same seven acceptance assertions** without relaxing checks; only test titles change from `expected RED` to `postrepair`. Completely isolated branch with one new test file plus this note, no original source or owner files edited.

Run `node --test tests/qa-m5-private-research-parent-postfix-replay.test.mjs`.

The owner's new read-only `openNoSymlinkResearchFile` uses a Linux directory-descriptor traversal through `/proc/self/fd/<dirfd>` with `O_DIRECTORY|O_NOFOLLOW` and still performs the final-file descriptor `fstat`. Non-Linux systems have a documented weaker best-effort `lstat` traversal. QA expects valid private 0600 direct file and CLI to pass, final symlink to fail, immediate/nested symlink-directory ancestors to fail with no private report and generic path-safe stderr. Fixture dirs are auto-cleaned and no real human/retailer/evidence data used. No retailer HTTP, proxy, prices, credentials or public savings.

This is an independent verification of the **frozen source-owner fix**, not an authorization to deploy, not proof of racing-during-resolution hardening on non-Linux or any other open M5 research issue (notably [#2104](https://github.com/Zennay/Supa/issues/2104) private IPv4 literal URLs).

**DRAFT/HOLD/NO MERGE/NO DEPLOY** pending source owner approval, independent zCloud preflight/write lease, all-green exact-head hosted/applicable permanent VPS, current-main integration and explicit human release go. M3 real PLUS+DekaMarkt [field #78](https://github.com/Zennay/Supa/issues/78) OPEN; M4/M5 ineligible.
