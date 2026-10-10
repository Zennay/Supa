# M3 field-session 24-hour clock (operator-only)

This read-only product-core helper supports the **genuine** PLUS baseline + DekaMarkt candidate observation task [#78](https://github.com/Zennay/Supa/issues/78). It does not request network access, store any observations, change the canonical study, or authorize retailer reuse or a public savings claim.

## During one human session

Record genuine observations in the existing private canonical M3 sheet. Record a timezone-bearing ISO observation instant separately for each shop (for example, `2026-10-09T12:00:00+02:00` is syntax only, **not an actual observation**). Use one common `in-store` or `online-order` context and the identical eleven-ingredient demand for both retailers.

After the PLUS capture, check whether the 24-hour period remains open:

```sh
node scripts/m3-field-window-preflight.mjs --baseline '<actual PLUS ISO instant>'
```

When the DekaMarkt observation exists, check the strict *elapsed* period between both real instants:

```sh
node scripts/m3-field-window-preflight.mjs --baseline '<actual PLUS ISO instant>' --candidate '<actual DekaMarkt ISO instant>'
```

This helper accepts only exact date/time with seconds and a real explicit timezone (`Z` or a numeric UTC offset not exceeding ±14:00). Dates must exist on the calendar, observations must not be future-dated relative to the machine's real clock, and the two timestamps must be no more than exactly 24 elapsed hours apart. The comparison is symmetric in time (not a naive difference of displayed local hours). The CLI has **no test-time `--now` flag** that could retroactively approve future inputs.

## Outcomes, not savings claims

- Exit **0** / `WINDOW ONLY`: both instants fall within 24h. This checks the clock **only**; it does not validate the basket, sources, permission, quantities, contexts or prices, and does not make savings claimable.
- Exit **2** / `PENDING`: the candidate instant is missing but the baseline clock remains within the 24-hour deadline. The CLI displays **hours and rounded-up remaining minutes** (never the captured timestamp); a single remaining second is shown as one minute to avoid implying there is no time left. A displayed 0 minutes means the cutoff is *exactly* now, not that the second observation was already captured. Never treat as collected evidence.
- Exit **1** / `NOT READY`: invalid/future instants, elapsed window >24h, or missing/invalid parameters. Recollect when needed; do not silently substitute fixture values.

The CLI intentionally does **not** print the supplied input timestamps, person keys, URLs, amounts or prices. Keep any real filled sheet, receipts and original provenance outside Git and CI logs. This auxiliary preflight does **not** replace the canonical `m3:build-observed-study` and `m3:assess-observed-week` validation/report path. Both the real measurement and those gates are still required for M3 exit, and even a successful single field study does not authorize a public savings claim.

Regression: `node --test tests/product-m3-field-window-preflight.test.mjs` (fully synthetic dates; tests are not field evidence).
