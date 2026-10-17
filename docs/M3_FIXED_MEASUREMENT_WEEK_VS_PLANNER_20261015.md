# Supa M3 — duidelijk onderscheid tussen Planner en de vaste meetweek

15 oktober 2026 · Product-core, geïsoleerde UI-verbetering (geen veldbewijs).

## Gevonden gebruikersrisico
De zichtbare SUPA Planner kan vier M2-recepten wisselen en dagen aan/uit zetten. Het tabblad **Meten** genereert echter altijd het vaste, gecontroleerde M3-onderzoeksblad met **4 maaltijden, 11 fysieke ingrediënten en 22 PLUS/DekaMarkt-observatieregels**. Die vaste vraagset is een bewuste voorwaarde voor een vergelijkbaar onderzoek, maar zonder uitleg kan de gebruiker denken dat de winkelmetingen automatisch zijn persoonlijke Plannerkeuzes volgen.

## Werkelijk doorgevoerde oplossing
- `src/features/observation/m3PlannerMeasurementWeek.ts` vergelijkt de **huidige geselecteerde Planner-dagen en recepten** met de bevroren onderzoeksvraag (`m2InitialPlan`/`m2DefaultActiveDays`), onafhankelijk van sorteervolgorde. Ongeldige, onleesbare, dubbele of onbekende dagen worden nooit als gelijke vraagset behandeld. Weekbudget verandert de fysieke vraagset niet.
- `src/App.tsx` geeft **alleen een boolean** door aan het meetformulier, geen winkelprijzen of persoonlijke meetgegevens.
- `src/features/observation/ObservationView.tsx` toont altijd dat het formulier de vaste onderzoeksweek gebruikt. Bij afwijkende Plannerkeuzes verschijnt daarnaast een toegankelijk, duidelijk veiligheidsbericht. De UI **verandert geen metingen**, werkt geen winkelmand bij, slaat niets extra op en suggereert nooit actuele prijsrechten of besparing.
- Eigen test draait de echte React-SSR-weergave met gelijkende, afwijkende én ontbrekende Plannercontext, plus negatieve varianten voor ieder van de vier dagen/recepten. In alle gevallen blijven 22 meetregels staan, blijft de evidenceStatus een sjabloon en blijft de prijs onbekend.

## Reproduceerbaar
```bash
node --experimental-strip-types --test tests/product-m3-planner-measurement-week-truth-20261015.test.mjs
npm test
npm audit --audit-level=high
npm run m1:matching-benchmark
npm run m1:source-permission-gate
npm run build
```

De bestaande onafhankelijke kwaliteitsworker mag zijn PR's niet verliezen. Geen actief CI/workflow-, veldconverter-, retailer-, rechten- of bewijsbestand is aangeraakt. `src/App.tsx` en `ObservationView.tsx` zijn zichtbare product-UI, dus controleer ook de permanente `vps-mobile-foundation.yml` en `m3-observed-week-report.yml` PR gate: beide vereisen echte self-hosted VPS als integraal bewijs; GitHub-hosted tests alleen zijn daarvoor geen vervanging.

## M3 release blijft geblokkeerd
Dit is **een presentatiewaarschuwing, geen nieuwe meetgenerator**. Er is nog steeds geen schriftelijke toestemming PLUS/DekaMarkt (#74), geen echte identieke menselijke 11+11 binnen maximaal 24 uur (#78), geen authentieke field-run codepin (#205) en geen betrouwbare permanente triggerdekking voor alle M3 workflows (#2833). Geen geautomatiseerde retailerrequests, actuele prijzen, publieke besparingsclaim, M4 of productieactivering. Main-merge alleen na onafhankelijke review, autoriserende zCloud SQLite scoped lease, exact-head integratie en relevante vaste VPS-gates.
