# M3 output publication — isolated race validation matrix

Status: DRAFT / HOLD / NO MERGE / NO DEPLOY. Related: #2039, #2035, #2038, human evidence #78.

This is a synthetic QA protocol, not evidence of a reproduced exploit or observed retailer prices.

## Fixture constraints

Use temporary directories, synthetic participant-free payloads and distinct source/output files. Snapshot original input and any preexisting output as byte buffers and compare exact bytes after each failing case. Never write to real observation sheets or ingest retailer data.

## Cases

1. **Same inode**: identical paths, normalized `../` alias and symlink alias must be rejected before publication. Source bytes remain identical.
2. **Symlink swap**: between destination validation and publish, replace destination with a symlink to the source. Publisher must not follow it, must preserve source bytes, and must not leave a partial report.
3. **Concurrent writers**: race two independent conversions targeting one output. The published result must equal one complete validated report, never an interleaving or truncation; neither writer mutates the input.
4. **Interrupted write**: simulate failure before atomic rename. Existing output bytes remain unchanged and temporary files are cleaned up.
5. **Preexisting output**: on validation failure, retain exact original output bytes, with no partial replacement.
6. **Permissions/logging**: newly published output and temporary artifacts use restrictive permissions; stdout/stderr contain no private participant/provenance markers.
7. **Positive control**: distinct output regeneration succeeds through generator → converter → assessor for 11+11 explicitly unavailable synthetic items. Financial outcome remains `unknown`, monetary values null, and `publicSavingsClaimEligible:false`.

## Execution gate

Coordinate original converter/assessor owners and verify independent zCloud preflight/claim/lease before modifying owned implementation. Execute expected-RED tests first on an isolated child branch, then narrow repair, exact-head hosted CI, applicable permanent VPS gates, latest-main replay and explicit authorization before merge/deploy. Do not close #78 or make public savings claims based on synthetic controls.
