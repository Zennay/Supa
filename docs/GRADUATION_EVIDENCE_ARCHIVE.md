# Graduation evidence archive

SUPA's original graduation evidence is now bound to a durable project archive instead of relying on a historical chat.

## Canonical storage

The retained evidence set lives in the ChatGPT Library folder:

`/Supa/Evidence/Graduation-2026`

Two large core PDFs have byte-preserving canonical copies there. Their SHA-256 values are recorded in `evidence/graduation/manifest.v1.json`.

| Artifact | Bytes | SHA-256 | Archive state |
| --- | ---: | --- | --- |
| `Design_Rationale_Supa_Zennay.pdf` | 26,462,749 | `65722ca0711d55f03ac91439a024aba07f4a9f3c6230c9df2d1fa9ca1d65772b` | canonical Library copy |
| `Productbiografie_Supa_Zennay.pdf` | 47,623,784 | `d1bb6fb792458ddf2a9788c845487ff659f7d2b334ca4b4fa7dd9ea580e7afc7` | canonical Library copy |
| `Reflectie_Supa_Zennay.pdf` | 36,056 | not byte-verified yet | retrieve exact Library source `Reflectie_Supa_Zennay_500858050.pdf` |

## Integrity policy

- A SHA-256 is only recorded after hashing the original PDF bytes.
- Do not infer or synthesize a checksum from parsed text.
- Duplicate historical uploads are not silently treated as the same version even when filenames look similar.
- The manifest records the exact source filename and upload timestamp used for each canonical artifact.
- The reflection remains retrievable in Library as exact file `file_000000006154820d8689de4f81ee8784`, version `1`, filename `Reflectie_Supa_Zennay_500858050.pdf`, size 36,056 bytes. The current backend still does not expose an authorized raw-byte clone/materialization path for that Project file. Its missing SHA-256 is therefore an explicit open evidence item, not hidden uncertainty.

## Continuation rule

When a future worker needs graduation evidence:

1. read `evidence/graduation/manifest.v1.json`;
2. retrieve the canonical Library copies by exact path/filename;
3. verify SHA-256 before using the Design Rationale or Productbiografie as exact evidence;
4. for the reflection, retrieve file `file_000000006154820d8689de4f81ee8784` version `1` (filename `Reflectie_Supa_Zennay_500858050.pdf`) and confirm 36,056 bytes until a byte-verifiable canonical copy exists;
5. never replace these with a similarly named historical duplicate without updating the manifest and documenting why.

This closes the chat-dependency part of M0 continuity while keeping the unresolved reflection byte-integrity gap explicit.
