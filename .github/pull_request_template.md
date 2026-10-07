## Summary

<!-- What changes, and why? Keep the scope narrow. -->

## Ownership / parallel boundary

<!-- List the files or surface this PR owns. Confirm it does not overwrite an active owner branch/PR. -->

- Owned surface:
- Active-owner overlap checked: yes / no

## Evidence boundary

<!-- State explicitly what this PR does NOT claim. Mock/generated data is never genuine retailer evidence or savings proof. -->

- Retailer observation/evidence changed: yes / no
- Basket economics or savings outcome changed: yes / no
- Public savings claim eligibility changed: yes / no
- M3 issue #78 genuine PLUS + DekaMarkt field-evidence dependency changed: yes / no

If any answer above is `yes`, explain the evidence source, provenance and acceptance contract in detail.

## Validation

Exact head SHA:

```text
<sha>
```

Run the applicable validation path:

- [ ] `npm ci`
- [ ] `npm test`
- [ ] `npm run m1:matching-benchmark`
- [ ] `npm run m1:source-permission-gate`
- [ ] `npm run build`
- [ ] Any path-selected hosted/permanent workflow is green on this exact head, or not applicable with rationale below.

Validation evidence / run IDs:

<!-- Include exact workflow run IDs and conclusions. -->

## Security

- [ ] No credentials, personal data, tokens, receipt images, or sensitive exploit details are included.
- [ ] Any security-sensitive finding follows [SECURITY.md](../SECURITY.md).
- [ ] This change does not interpret SUPA tooling as authorization to actively test or scrape third-party retailer systems.

## Reviewer notes

<!-- Call out uncertainty, replay/landing guards, or dependencies on other PRs. -->
