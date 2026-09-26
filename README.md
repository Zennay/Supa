# SUPA

Mobile-first grocery planning and savings product for students.

This repository now contains the first durable implementation baseline recovered from the recent Astra/Work direction: keep the validated planner-first product flow, use a modern mobile-first web foundation, and separate UI from domain/data concerns so real supermarket data can replace mock data without rewriting the app.

## Current product phase

Validated concept → technical/outcome proof.

The UI in this repository is a **foundation/prototype shell**, not proof that live prices, matching or savings are correct. The current proof gate remains supermarket data feasibility and normalization.

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

Do not treat mock prices or mock savings in the current UI as real product claims. Every future real price must carry source + observed-at metadata and every savings number needs an explicit baseline.
