# AUD-005 retailer-permission evidence

This directory is reserved for **durable, privacy-safe derived stakeholder-response records** produced by:

```bash
npm run aud005:record-retailer-response -- <private-sanitized-response.json> --output evidence/aud005/<retailer>-<response-id>.json
```

## Allowed here

- the validated JSON emitted by the AUD-005 response recorder;
- a unique, stable file for each meaningful retailer/data-owner response;
- repository-safe team, scope, outcome, constraint, evidence-reference and consequence fields that passed the recorder's privacy checks.

## Never store here

- raw email, contact-form, meeting or call correspondence;
- names, email addresses, phone numbers or other direct personal details;
- credentials, authenticated exports or private retailer-system data;
- a rewritten replacement for an earlier response artifact.

Keep raw correspondence only in an approved private location. The recorder uses exclusive output creation: if a path already exists, preserve it and choose the correct new response id rather than overwriting history.

## Evidence boundary

These records document the stakeholder permission/licensing path only. They do **not**:

- authorize production automated retailer-data reuse by themselves;
- replace the separate explicit production-permission gate;
- count as M3 observed-basket evidence;
- prove a savings outcome or support a public savings claim.

M3 remains dependent on the genuine same-demand PLUS + DekaMarkt field observation under GitHub issue #78.
