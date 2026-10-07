# SUPA pull request checklist

## Scope and ownership

- [ ] I checked the current open pull requests before editing these paths and I am not taking over another active owner's scope without explicit coordination.
- [ ] This change is limited to the smallest coherent scope needed for the linked finding or milestone.

Linked issue / finding:

Scope summary:

Files / surfaces intentionally changed:

Ownership or coordination notes:

## Evidence boundary

- [ ] Mock, generated, deterministic, replayed, or fixture data in this PR is test material only; it is not genuine retailer evidence and is not proof of savings.
- [ ] I did not infer or fabricate retailer observations, prices, pack data, basket outcomes, stakeholder responses, user evidence, or savings results.
- [ ] M3 remains open unless the genuine same-demand **PLUS baseline + DekaMarkt candidate** observation required by issue #78 has been collected in one valid price context and accepted by the canonical converter/assessment path.

Evidence used by this PR:

What this evidence does **not** prove:

## Exact-head validation

Exact base SHA:

Exact head SHA:

Validation commands executed on that exact head:

```text
npm ci
npm test
npm run m1:matching-benchmark
npm run m1:source-permission-gate
npm run build
```

Required gates / run IDs and conclusions:

- Hosted CI:
- Path-selected permanent workflow(s), if applicable:
- Other focused validation:

- [ ] Every validation result cited above belongs to the exact head SHA written above; I did not reuse an older green run after changing the branch.
- [ ] Any dedicated path-selected workflow required by the changed paths passed on the exact PR head, or I explained why no such workflow applies.

## Current-main compatibility

Current `main` SHA at landing check:

Branch relation to current `main` (`ahead / behind`):

- [ ] I rechecked current `main` after validation. If it moved since the recorded base, I either replayed/rebased the isolated change onto current `main` and reran required exact-head validation, or documented why the existing head remains safe and merge-compatible.

## M3 claim impact

Does this PR change retailer data, observation evidence, basket economics, savings attribution, public savings wording, or the M3 exit state? **Yes / No**

If yes, describe the exact claim/evidence impact and why the supporting evidence is sufficient:

If no, state the preserved boundary (for example: “Issue #78 remains the genuine M3 field-evidence dependency; this change creates no retailer observation or savings outcome.”):

## Security and privacy

- [ ] This PR contains no credentials, personal data, receipt images, exploit details, or other sensitive evidence.
- [ ] Sensitive vulnerability findings are routed through [SECURITY.md](https://github.com/Zennay/Supa/blob/main/SECURITY.md) instead of being disclosed in a public PR or issue.
- [ ] This change does not treat repository tooling, public fixtures, parsers, or evidence workflows as authorization for active testing of third-party retailers or services.

## Reviewer handoff

Key risk or regression to inspect:

What would invalidate the landing decision:

Follow-up intentionally left out of scope:
