# Security Policy

## Reporting a vulnerability

For sensitive security findings, use GitHub's private vulnerability reporting / security-advisory flow when it is available for this repository. Do not publish credentials, personal data, exploit details, receipt images, or other sensitive evidence in a public issue.

Provide the smallest reproducible description needed to understand the impact:

- affected revision or commit;
- affected component/path;
- expected versus observed behavior;
- bounded reproduction steps;
- relevant logs or screenshots only when they contain no secrets or personal data.

Do not include destructive proof when a safer reproduction demonstrates the same issue. SUPA does not promise a response SLA, bounty, or reward.

## Authorized-testing boundary

This repository does **not** grant permission to actively test third-party retailers, external services, accounts, infrastructure, or APIs.

Do not perform authentication bypass, anti-bot bypass, private API probing, credential testing, destructive testing, high-volume scanning, or similar active techniques against external systems unless the system owner has explicitly authorized that activity.

Retailer data reuse remains subject to SUPA's existing permission/licensing gate. Public fixtures, parsers, capture tooling, and evidence workflows are not authorization for production scraping or intrusive verification.

## Evidence and privacy

Security reports must not be treated as retailer-observation evidence or savings proof. Mock/generated fixtures remain test material only, and the genuine M3 field-evidence gate under issue #78 is unchanged.
