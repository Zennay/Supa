# SUPA retailer outreach routing — 2026-10-05

## Purpose

Make AUD-005 operational without weakening the M3 evidence boundary.

This note turns the existing retailer-permission research into a concrete routing package using current official contact information. It does **not** treat public webpage access, customer-service availability, Brandbank/GS1 participation, or technical accessibility as permission for automated production reuse.

## Current project boundary

- M3 remains dependent on one genuine same-demand PLUS + DekaMarkt basket pair observed within 24 hours in one shared price context.
- Manual research observations may continue under the existing M3 protocol.
- Production automated retailer reuse remains disabled until explicit permission, a licensed route, an official feed/API with suitable terms, or another reviewed lawful route exists.
- A retailer denial, licensing requirement, or “no suitable route” is useful evidence and must be preserved rather than reinterpreted as approval.

## Official first-contact routes

### PLUS

Official PLUS sources identify:
- PLUS Retail B.V., Archimedeslaan 21, 3584 BA Utrecht;
- PLUS Consumentenservice: 0800-2224443;
- consumentenservice@plus.nl is published in current PLUS action terms as a consumer-service email route;
- the official supplier page documents Brandbank as a product-content partner and says supplier product information can be uploaded into GS1 DAS;
- Brandbank Netherlands contact listed by PLUS: infonl@brandbank.com, 030-2040770.

Sources:
- https://www.plus.nl/organisatie/leveranciers-info
- https://www.plus.nl/voorwaarden/privacy-statement
- https://www.plus.nl/voorwaarden/actievoorwaarden/social-media

### DekaMarkt

Official DekaMarkt sources identify:
- Deka Supermarkten B.V., Olieweg 6, 1951 NH Velsen-Noord;
- general office: 088-3136000;
- customer service: klantenservice@dekamarkt.nl and 088-3135555;
- customer service explicitly routes assortment requests to the purchasing department;
- no public developer/data-feed route was found in the current official-source pass.

Sources:
- https://www.dekamarkt.nl/services/klantenservice
- https://www.dekamarkt.nl/services/klantenservice/assortiment-en-aanbiedingen
- https://www.dekamarkt.nl/meer/over-ons

## Routing objective

The first contact is not expected to decide licensing. Its purpose is to route SUPA to the person/team that owns one or more of:

- e-commerce product data;
- retail price and promotion data;
- store/regional availability;
- commercial partnerships/licensing;
- purchasing/product-content governance.

If first-line support cannot answer the permission questions, explicitly ask them to forward the request or provide the correct team/contact.

## PLUS first-contact message

Subject: SUPA pilot — routing request for product and price data permission

Hello,

I am developing SUPA, a small grocery-planning pilot for independently living students. SUPA converts a weekly meal plan into a complete grocery basket and compares that same basket across a deliberately small number of supermarkets.

Before any production use, I want to confirm the correct permission and data route rather than treating publicly accessible webshop data as reusable by default.

For a limited pilot, could you route this request to the team that owns e-commerce/product data, price/promotion data, or commercial data partnerships?

We would like to understand whether SUPA may use:
- product name and pack size/unit;
- current retail price and promotion information;
- store or regional availability where applicable;
- source/store and observation timestamp for reproducibility.

We also want to know:
1. whether this limited pilot use is permitted;
2. whether PLUS recommends an official feed, API, licensed provider or partner route;
3. whether Brandbank/GS1 covers only product content or can also be part of the route for retail price/promotion data;
4. whether temporary storage of source/store/timestamp snapshots is allowed;
5. who owns a production-permission or licensing decision.

The pilot uses only a small controlled product set and will not present stale or inferred prices as current.

Thank you.

## DekaMarkt first-contact message

Subject: SUPA pilot — routing request for product and price data permission

Hello,

I am developing SUPA, a small grocery-planning pilot for independently living students. SUPA converts a weekly meal plan into a complete grocery basket and compares that same basket across a deliberately small number of supermarkets.

Before any production use, I want to confirm the correct permission and data route rather than treating publicly accessible catalog information as reusable by default.

Could you route this request to the team responsible for e-commerce/catalog data, purchasing/product data, price/promotion data, or commercial partnerships?

For a limited pilot, we would like to understand whether SUPA may use:
- product name and pack size/unit;
- current retail price and promotion information;
- store-specific availability where applicable;
- source/store and observation timestamp for reproducibility.

We also want to know:
1. whether this limited pilot use is permitted;
2. whether DekaMarkt offers or recommends an official feed, API, licensed provider or partner route;
3. whether product-content rights and price/promotion rights are handled separately;
4. whether temporary storage of source/store/timestamp snapshots is allowed;
5. who owns a production-permission or licensing decision.

The pilot uses only a small controlled product set and will not bulk republish the catalog or present stale/inferred prices as current.

Thank you.

## Response capture contract

For each meaningful response, retain:
- retailer/data owner;
- date and channel;
- responding team (not personal contact details in Git);
- exact scope discussed;
- whether the answer covers product content, prices, promotions, availability, automation, or storage;
- permission outcome: allowed / allowed with conditions / licensed route required / research-only / denied / no suitable route / unclear / routed;
- any rate, retention, attribution, geography/store, or commercial constraints;
- next owner/team if routed;
- product/architecture/cost/source-strategy consequence for SUPA.

The repository-safe contract is executable through:

```bash
npm run aud005:record-retailer-response -- <private-sanitized-response.json> --output evidence/aud005/<retailer>-<response-id>.json
```

Use a new, stable `response-id` for every meaningful response so each privacy-safe artifact has its own tracked path under `evidence/aud005/`. The recorder intentionally fails if the output path already exists; do not delete, overwrite, or reuse a prior response artifact just to make a later capture succeed. Follow `evidence/aud005/README.md` for the durable storage boundary; generated/local material under ignored `artifacts/` is not the repository record. The validator fails closed when required scope/consequence fields are missing, rejects direct PII-style keys and obvious email/phone content, and always marks generated records as ineligible for public product claims. Keep the original/raw correspondence in an approved private location; commit only the privacy-safe derived record.

## AUD-005 decision rule

AUD-005 is not closed by sending outreach.

Meaningful closure evidence requires:
- one substantive response or interview from PLUS or its designated data owner;
- one substantive response or interview from DekaMarkt or its designated data owner;
- documented consequences for SUPA architecture, operating cost, retailer scope, or source strategy.

Until then:
- keep automated production reuse disabled;
- keep M3 manual evidence collection independent of these permission discussions;
- do not expand retailer scope merely because a source is technically accessible.
