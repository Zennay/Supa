# Security Policy

## Reporting a vulnerability

Please do not publish sensitive vulnerability details, credentials, personal data, or exploitable secrets in a public issue.

When GitHub private vulnerability reporting or a repository security advisory is available, use that private channel and include only the minimum reproducible information needed to understand the affected version, impact, preconditions, and a safe reproduction path. If no private GitHub reporting path is available, open a minimal public issue that asks the maintainer for a private contact route without including exploit details.

Do not include live credentials, authentication tokens, personal information, full receipt images, or unrelated production data in a report.

## Authorized testing boundary

Testing this repository, local development copies, controlled fixtures, and systems you own or are explicitly authorized to assess is in scope.

SUPA's code, documentation, data adapters, retailer evidence tooling, or public retailer references do not grant permission to actively test, probe, bypass controls on, scrape, overload, or otherwise interact intrusively with PLUS, DekaMarkt, or any other third-party system. Obtain explicit authorization from the relevant system owner before active security testing or automated production data reuse.

Keep proof-of-concept work minimally destructive. Prefer deterministic local fixtures and mocked or consented data whenever they can demonstrate the issue safely.

## Project evidence boundary

Security reports must not be used to fabricate retailer observations, prices, basket outcomes, or savings evidence. M3 field evidence remains governed by the project's genuine observation protocol and retailer-data production reuse remains separately permission/licensing gated.

## Response expectations

This project does not promise a vulnerability-response SLA, bounty, or reward. Reports will be assessed based on reproducibility, impact, scope, and whether the testing stayed within an authorized boundary.
