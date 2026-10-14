# Supa independent pinned store ancestry acceptance — 14 Oct 2026

**Frozen corrected product:** DRAFT #2223 SHA `304ca0f17ce5119bbe9238ff55fce5bdb8a960ff`, original owner #2220 SHA `e1b37f5efc4c3cc5f011a46943013e373ea151a1`.

**Immutable preservation:** copy 18 unchanged QA suites (156 independent cases) from independently hosted-green QA #2221 SHA `77136aea4d1069f8833a0468b3a7667960d6f6f9` by exact Git blob SHA. Add same (byte-identical) deterministic ancestry-race QA test Git blob `1f3ab5b5b601515fa1ad08425f2406148bd002ee` as original expected-RED DRAFT QA #2224, plus own provenance note. No edits to product code, other worker branches, main, workflows, real data or permanent VPS.

**Exact risk:** original source checked store `lstat/realpath` then reopened mutable parent HTML path. Test synchronously replaces original store with alias to different SHA-invalid HTML only upon the pre-read source ID access. A pinned `O_DIRECTORY|O_NOFOLLOW` original store descriptor should still read original bytes through `/proc/self/fd` despite mutable outer path. Preserve P1/P2/P3 and earlier SHA, privacy and bounded reader controls. No remote network, real retailer prices, permission grants, user personal data, beta or real savings.

**HOLD**: M3 ACTIVE (#78 genuine PLUS 11/DekaMarkt 11 within 24h outstanding), M4/M5 ineligible. DRAFT/NO MERGE/NO DEPLOY pending independent zCloud SQLite task-write claim+lease, source/QA owners, trusted latest-main/permanent VPS and human field approval. Does not guarantee root pin-before-path atomicity or malicious same-UID tampering.
