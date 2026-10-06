# Security Policy

## Reporting a Vulnerability

We take the security of SUPA seriously. If you believe you have found a security vulnerability, please report it through [GitHub's private vulnerability reporting](https://github.com/Zennay/Supa/security/advisories/new) rather than via a public issue. Private reporting keeps sensitive details from being exposed prematurely.

If private reporting is not available for any reason, submit a public issue but **do not include credentials, personal data, secrets, or detailed exploit instructions** — redact or omit those before posting.

## What to Include in a Report

To help us assess and remediate issues efficiently, please provide:

- A concise description of the impact.
- Minimal, reproducible steps or configuration that demonstrate the issue.
- Environment details (OS, Node version, etc.) when relevant.
- Any supporting logs or screenshots that **do not contain** credentials, API keys, personal data, or tokens.

Avoid including destructive proof-of-concept material or data scraped from third-party systems in your report.

## Authorized Testing Boundary

**SUPA does not grant permission to actively test, probe, scrape, or otherwise interact with any third-party retailer or external system without explicit authorization.**

- Integration points, evidence tooling, and validation lanes in this repository are intended for **authorized, internal, or own-infrastructure use only**.
- GitHub Actions may include permanent self-hosted validation lanes; these are **not** an invitation to test external services.
- Using SUPA or its tooling against third-party systems without permission may violate applicable terms of service or laws.

## Retailer Data & Permissions Gate

SUPA's existing permission/licensing gate governing retailer-data reuse remains in effect. This security policy does not alter or waive any such gates.

## Supported Versions

We ask that reporters target the latest stable release when possible. Older versions may still be considered on a case-by-case basis.

## SLA & Rewards

We strive to acknowledge reports promptly, but **we do not promise a specific response SLA** and **do not offer bounties or rewards** for vulnerability reports.

## Acknowledgments

Security contributors who follow this policy will be acknowledged (with permission) in release notes or security advisories.
