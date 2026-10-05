# SUPA retailer permission & stakeholder path — 2026-10-05

## Purpose

Reduce **AUD-005 (stakeholder/business-operability)** and the production-data permission risk without weakening the current M3 evidence boundary.

M1 proved bounded technical feasibility for PLUS + DekaMarkt. That does **not** grant permission for systematic production reuse. This document separates:

1. product-content provenance;
2. current price / promotion / availability provenance;
3. research-only manual observation;
4. production/automated reuse permission.

## Current official-source findings

### PLUS

Official supplier information describes a structured product-content route through **Brandbank** and **GS1 DAS**.

PLUS states that Brandbank is used to make supplier product imagery and product data available to retail partners for webshop publication. Suppliers can manage their own product content in Brandbank and upload product information into GS1 DAS.

Source:
- https://www.plus.nl/organisatie/leveranciers-info

Important boundary:

- this is evidence of an established **product-content ecosystem**;
- it is **not** evidence that SUPA may reuse PLUS retail prices, offers or store-level availability;
- PLUS product pages explicitly warn that web prices can differ because of local price differences, intervening price changes and errors, and that the actual price can depend on delivery moment/store context.

Example official price/product-information notice:
- https://www.plus.nl/product/plus-puntenslijpers-doos-2-st-281875

PLUS also exposes a normal consumer/customer-service route and identifies PLUS Retail B.V. as the central entity behind the website/app, while local PLUS entrepreneurs handle store/order execution.

### DekaMarkt

DekaMarkt exposes current product/catalog information publicly and provides official customer-service/general-office routes, but no public developer/datafeed/partner API or equivalent product-data permission path was found in this research pass.

Official sources:
- https://www.dekamarkt.nl/services/klantenservice
- https://www.dekamarkt.nl/meer/over-ons
- https://www.dekamarkt.nl/services/klantenservice/assortiment-en-aanbiedingen
- https://boodschappen.dekamarkt.nl/producten

Operational signals:

- DekaMarkt says assortment can be store-specific in its app;
- official FAQ routes assortment requests to purchasing through customer service;
- DekaMarkt has stopped home delivery and is currently focused on stores rather than expanding its online delivery proposition;
- product and assortment information remains available online.

This means SUPA should **not infer** a permission model from technical accessibility alone.

## Verified outreach endpoints — 2026-10-05

These routes were re-checked against current official pages so AUD-005 outreach can be sent without guessing the receiving channel.

### PLUS
- **PLUS Consumerservice:** 0800-2224443. Use this as the routing fallback and ask explicitly for the team owning e-commerce/product data or commercial data permissions.
- **PLUS supplier/product-content route:** PLUS names Brandbank as its partner for webshop product imagery/product information and publishes Brandbank Limited contact details: +31 (0)30 204 0770 and infonl@brandbank.com.
- **Boundary:** Brandbank is a product-content route. It is not evidence that Brandbank or GS1 can grant rights to reuse PLUS retail prices, promotions or store-level availability. Those questions still need a PLUS-owned permission answer.

Official sources:
- https://www.plus.nl/organisatie/leveranciers-info
- https://www.plus.nl/voorwaarden/privacy-statement

### DekaMarkt
- **Customer-service e-mail:** klantenservice@dekamarkt.nl.
- **Customer-service phone:** 088-3135555.
- **General/head-office phone:** 088-3136000.
- **Head office:** Olieweg 6, 1951 NH Velsen-Noord.
- DekaMarkt's assortment FAQ says assortment requests sent through customer service are forwarded to purchasing for investigation. For SUPA, the initial message should therefore ask customer service to route the request to the owner of e-commerce/catalog data and price/promotion permissions rather than treating customer service itself as the final approver.

Official sources:
- https://www.dekamarkt.nl/services/klantenservice
- https://www.dekamarkt.nl/services/klantenservice/assortiment-en-aanbiedingen
- https://www.dekamarkt.nl/meer/over-ons

### Outreach handling rule
Record the **first response path** as evidence too: whether the retailer routes SUPA to e-commerce, purchasing, commercial, product-data, a licensed provider, or rejects the request. A routing response is not permission, but it is useful stakeholder evidence and should be attached to issue #74 with date/channel and next owner.

## Permission model SUPA should use

### Lane A — research-only manual observation

Allowed project use:
- genuine manual-cart, receipt or consented-export observations;
- one explicitly named price context;
- store/timestamp provenance;
- no invented values;
- no systematic commercial reuse claim.

This remains the current M3 lane.

### Lane B — product identity/content

Goal:
obtain a durable, licensed or explicitly permitted way to use product name, pack size, unit, imagery/category metadata where needed.

Questions for PLUS:
- Is Brandbank/GS1 the preferred route for a third-party consumer application that needs normalized product identity and pack metadata?
- Can an external application license/read the subset needed for comparison/planning?
- Which party grants the rights: PLUS, Brandbank, GS1, supplier, or a combination?

Questions for DekaMarkt:
- Is there an approved supplier/content network or product-data provider behind the online catalog?
- Is there a licensed feed or commercial contact for third-party product metadata use?

### Lane C — price / promotion / availability

This must be treated separately from product content.

Ask each retailer:
- May SUPA display or calculate with current retail prices for a limited student pilot?
- May prices be stored temporarily with source URL/store/timestamp for reproducibility?
- Is automated retrieval permitted, rate-limited, licensed, or prohibited?
- Are promotions subject to separate rights/conditions?
- Does permission differ for store-specific vs nationwide prices?
- Is there a preferred official feed or partner channel?

### Lane D — production automation

Do not enable production-scale source reuse until at least one of these is true:

- explicit written retailer permission;
- a licensed/contracted data provider covers the required fields;
- an official API/feed with terms permitting the intended use;
- legal review establishes a clearly acceptable alternative.

Technical feasibility or a public webpage alone is not sufficient.

## Recommended outreach sequence

### 1. PLUS

Primary objective:
route the request to the team responsible for e-commerce/product data and distinguish Brandbank/GS1 product content from retailer-controlled price/promotion data.

Initial request should ask for:
- correct data/e-commerce/commercial contact;
- pilot permission for a narrow student-research use case;
- available official feeds/licensing;
- conditions for storing source/timestamp snapshots;
- whether store-specific prices may be compared.

### 2. DekaMarkt

Primary objective:
identify the owner of online product/catalog data and get an explicit answer on third-party pilot use.

Initial route:
- customer service / general office;
- ask to route to e-commerce, commercial, purchasing or product-data owner;
- explicitly state this is a narrow student grocery-planning pilot, not bulk republication.

## Outreach template

Subject:
SUPA pilot — permission for limited product/price data use

Body:

Hello,

I am developing SUPA, a narrow grocery-planning pilot for independently living students. The product creates a weekly meal plan and compares the resulting complete grocery basket between a small number of supermarkets.

Before any production use, I want to confirm the correct permission/data route rather than relying on technical accessibility of public webpages.

For a limited pilot, we would like to know whether we may use:
- product name and pack size/unit;
- current price and promotion information;
- store or regional availability where applicable;
- source URL/store and observation timestamp for reproducibility.

The pilot would cover only a small controlled recipe/product set and would not present inferred or stale prices as current.

Could you please tell me:
1. whether this use is permitted for a limited pilot;
2. whether you offer or recommend an official feed, API, licensed provider or partner route;
3. whether product-content rights and price/promotion rights are handled separately;
4. which team/person should handle a production-permission discussion?

Thank you.

## Acceptance criteria for AUD-005 progress

AUD-005 should **not** be closed by this desk research alone.

Meaningful progress requires:
- at least one response or interview from PLUS/its designated data partner;
- at least one response or interview from DekaMarkt/its designated owner;
- documented consequences for data architecture, source permissions, product scope or operating cost.

Possible outcomes are all valid:
- permission granted;
- licensed feed required;
- manual/research-only allowed;
- automated use denied;
- no suitable route.

A denial is useful evidence and may require redesign before production.

## Immediate project consequence

- Keep M3 on manual genuine observations.
- Keep production source reuse disabled.
- Do not expand to more retailers before PLUS + DekaMarkt permission economics are understood.
- If either retailer requires a licensed feed, estimate cost/coverage before M4/M5 expansion.
