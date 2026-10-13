# M5 private research reader — ancestor symlink acceptance

Tracks [QA issue #2102](https://github.com/Zennay/Supa/issues/2102), distinct from existing M1 path-ancestor checks and current M5 final-file race protection. Original product: [DRAFT #2090](https://github.com/Zennay/Supa/pull/2090), frozen source commit `15e2a2bfdc31b8077b55cadea65c71d438da98fe`.

## Run

`node --test tests/qa-m5-private-research-ancestor-symlink-red.test.mjs` (Linux/Unix; skipped on Windows where symlink privilege/semantics differ).

Seven tests use only automatically removed local fixture directories and the committed **empty** manual-research JSON schema, with file `0600` and private directory `0700`. No network, scraping, retailer URLs or participant records.

| Contract | Method | Frozen owner source |
| --- | --- | --- |
| Real local reviewer file remains readable without leaking identity or production authorization | exported private loader and actual CLI | 2 GREEN |
| Final-component symbolic link is refused using existing `O_NOFOLLOW` | exported loader + CLI | 1 GREEN |
| Symlink pointing to a private directory directly above the JSON | exported loader + actual CLI | 2 expected RED |
| Symlink nested in an ancestor directory path | exported loader + actual CLI | 2 expected RED |

The existing descriptor-level `O_NOFOLLOW` prevents **final-component** alias following, not ancestor directory traversal. On Linux, file-descriptor `fstat` still sees a mode-0600 regular file when a **parent** is a symlink. QA requires rejection of a deliberately symlinked ancestor path to make private-file provenance consistent with the documented no-symlink trust boundary. A secure fix should consider platform differences and maintain final-component race protection; coordinate with the existing product owner before adjusting file access code.

The suite always verifies source bytes unchanged, no output for rejected paths and generic path-free diagnostics. This is a synthetic robustness finding, not evidence of any real file/data leak. Genuine M3 PLUS+DekaMarkt 11+11 observed field [#78](https://github.com/Zennay/Supa/issues/78) remains OPEN.

**DRAFT/HOLD/NO MERGE/NO DEPLOY** without independent zCloud lease/preflight, original owner review and correction, exact all-green corrected-head hosted and applicable permanent VPS proof, latest-main composition, and explicit human release approval.
