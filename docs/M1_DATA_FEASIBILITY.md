# M1 data feasibility — bounded source capture

## Goal

Produce reproducible evidence from real public supermarket pages before any source-specific parser selectors are trusted.

This is a feasibility spike, not a production crawler. It intentionally captures a tiny fixed source set for the two M1 supermarkets selected in the project handoff: Albert Heijn and PLUS.

## Fixed source set

| Supermarket | Kind | URL |
| --- | --- | --- |
| Albert Heijn | product | https://www.ah.nl/producten/product/wi1525/halfvolle-melk |
| Albert Heijn | catalog | https://www.ah.nl/producten |
| Albert Heijn | offers | https://www.ah.nl/bonus |
| PLUS | product | https://www.plus.nl/product/zuivelmeester-halfvolle-melk-pak-1000-ml-579010 |
| PLUS | catalog | https://www.plus.nl/producten |
| PLUS | offers | https://www.plus.nl/aanbiedingen |

## Safety and scope contract

- Public HTTPS pages only.
- No login, cookies, credentials, private APIs or authenticated endpoints.
- No CAPTCHA or anti-bot bypass.
- No link discovery or recursive crawling.
- Only `www.ah.nl` and `www.plus.nl` are accepted, including after redirects.
- Maximum response size is 5 MiB per page.
- One request per fixed source per run.
- Failed/changed sources fail visibly instead of silently substituting guessed data.

## Evidence produced

Every run records:

- requested URL and final URL;
- capture timestamp;
- HTTP status;
- content type;
- ETag/Last-Modified when supplied;
- byte size;
- SHA-256 of the raw response body;
- raw HTML for successful bounded responses;
- a machine-readable manifest including failures.

The GitHub Actions workflow uploads the evidence as a short-retention artifact. Raw live HTML is deliberately not committed to `main` automatically; a parser fixture should only be promoted after inspection and sanitization.

## Next gate

After a successful VPS capture:

1. download/inspect the exact artifact;
2. identify stable structured data or selectors separately for AH and PLUS;
3. sanitize and commit minimal representative fixtures with the capture metadata/hash;
4. implement source-specific adapters against those fixtures;
5. add regression tests for product name, current price, pack/unit, offer mechanics and availability;
6. re-run the live bounded capture to prove at least one end-to-end extraction per source.

A source that blocks or changes materially is evidence for M1; do not work around restrictions by escalating scraping techniques.
