# M3 — selected-week, two-retailer human observation worksheet

This **opt-in** offline command connects existing private, sanitized historical
PLUS/DekaMarkt source admission to the *actual selected plan days* and produces
a CSV that an operator can fill during real matched shopping observation.

```sh
node --experimental-strip-types scripts/retailer-private-selected-week-observation.mjs
node --experimental-strip-types scripts/retailer-private-selected-week-observation.mjs --days Ma,Do > private-field-template.csv
```

The CLI accepts only the canonical M2 default active days or a nonempty subset.
No output path, live retailer endpoint, product URL, proxy, credentials or
network request is accepted. The reusable
`buildPrivateSelectedWeekObservationWorksheet(records, days, {plan, recipes})`
API also supports locally curated inert custom weekday plans, including Friday,
Saturday and Sunday when a corresponding actual planned meal exists.

For each chosen ingredient requirement, exactly two rows are created: PLUS and
DekaMarkt. Required quantity and unit are derived from the planner, not from
a historical offer. The worksheet always marks each row
`UNOBSERVED_TEMPLATE_NOT_EVIDENCE`; every observed field stays blank:
date/time, store, price context, matched product and pack, observed shelf price,
availability, collection method, evidence reference and notes. No reviewed
historical price, product candidate, source URL, capture timestamp or hash is
exported. CSV fields are quoted and spreadsheet-formula prefixes escaped.

**Evidence gate remains closed.** This template does not mean observations
have occurred, prove source rights, certify current shelf prices, establish
11-by-2 matched baskets within 24 hours, or permit savings claims. A human
must separately collect, verify and feed real evidence into the canonical M3
observation/assessment process. The actual source-rights, field-SHA and
trusted-merge constraints remain unchanged; `productionReady:false`.
