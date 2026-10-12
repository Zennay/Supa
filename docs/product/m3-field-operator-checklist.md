# M3 field operator checklist — PLUS baseline versus DekaMarkt

**Status:** field-ready procedure only; no observation has been collected by this document. Human field issue [#78](https://github.com/Zennay/Supa/issues/78) remains open. No public savings claim or M4 beta authorization.

## Before leaving

1. Use the existing canonical M3 observation-sheet generator, not a newly invented shopping basket. Freeze exactly the same 11 ingredient requirements and quantities for both retailers.
2. Confirm the approved source-permission and collection protocol, consent/privacy expectations, and the same price context (e.g. both in-store, not one in-store and one online).
3. Record local capture date/time and timezone for each observation. Complete the pair within **24 hours**.
4. Do not place participant names, contact details or sensitive identifiers in screenshots, public reports or repository commits.

## At each retailer

- Capture each of the 11 requirements independently, including unit, requested quantity, observed pack size, quantity of packs required, exact observed EUR price, and evidence reference where genuinely available.
- When no comparable product is available, mark it explicitly unavailable/unresolved; never substitute zero euros, guessed prices or a smaller basket.
- Retain original evidence privately under the approved collection protocol. Do not scrape, automate, or bypass a retailer's terms.
- Record promotion conditions (loyalty, multi-buy, minimum purchase) rather than silently applying discounts that the shopper may not qualify for.

## After collection

1. Check both baskets represent identical demand and matching price context; explicitly mark any discrepancy as unresolved.
2. Run the repository's existing `m3:build-observed-study` and `m3:assess-observed-week` commands using **distinct input and output paths**. Never use `--output` to overwrite an evidence input.
3. Preserve both the private input and a privacy-safe derived report. Do not publish raw participant identifiers or private provenance.
4. Record the actual result, including `worse` or `unknown` if applicable. Do not turn missing items into a positive savings estimate.
5. Attach evidence references, exact source revision and CLI run metadata to issue #78 for independent review. Only the reviewer may decide whether M3 has enough genuine proof.

## Stop conditions

Stop and preserve evidence without making a claim if: a retailer is missing, a required item is unresolved, the pair exceeds 24 hours, the price contexts differ, provenance is inadequate, a private identifier appears in public output, or source integrity cannot be guaranteed. **No merge/deploy/recruitment is authorized by this checklist.**
