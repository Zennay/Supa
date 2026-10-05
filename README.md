# SUPA

Mobile-first grocery planning and savings product for students.

This repository now contains the first durable implementation baseline recovered from the recent Astra/Work direction: keep the validated planner-first product flow, use a modern mobile-first web foundation, and separate UI from domain/data concerns so real supermarket data can replace mock data without rewriting the app.

## Current product phase

**M3 — Full-basket comparison & savings proof.**

M1 Data Feasibility and M2 Core Planner Vertical Slice are technically closed. The current proof gate is no longer missing comparator or collector code: SUPA now needs one genuine, same-demand **PLUS + DekaMarkt** basket observation pair, captured within 24 hours in one shared price context, and accepted by the existing converter + assessment path.

The canonical exit action is tracked in [issue #78](https://github.com/Zennay/Supa/issues/78). Until that field run exposes a concrete failure, do not add more M3 collector features.

The repository already contains the manual field-run entrypoint:

```bash
npm run m3:create-observation-sheet
npm run m3:build-observed-study -- <collector.json> --output evidence/m3/<study>.json
npm run m3:assess-observed-week -- evidence/m3/<study>.json --output artifacts/m3/<study>-assessment.json
```

Better, same, worse and unknown are all valid M3 outcomes. One observed week must not be generalized into a public savings claim.

## Stack

- React 19
- TypeScript
- Vite
- CSS design tokens, no heavy UI framework
- Feature-first frontend structure
- Mock repository boundary ready to be replaced by API/data adapters

## Run locally

```bash
npm install
npm run dev
```

Build:

```bash
npm run build
```

## Structure

```text
src/
  app/            app shell / navigation
  components/     reusable UI primitives
  data/           repository boundary + mock data
  domain/         core product types and pure logic
  features/
    planner/
    basket/
    shopping-list/
docs/
  ARCHITECTURE.md
```

## Product flow

Preferences → weekly planner → smart reuse/combinations → complete basket → shopping list → compare/choose.

## Important

Do not treat mock prices, mock savings or generated collection templates as real product claims or real-world evidence. Every future real price must carry source + observed-at metadata and every savings number needs an explicit baseline.

Production automated retailer-data reuse remains separately permission-gated; a successful M3 field observation does not grant production scraping or licensing rights.
