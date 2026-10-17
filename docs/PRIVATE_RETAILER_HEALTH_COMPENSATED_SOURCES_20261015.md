# M3 private retailer health trend — compensated source admission (15 oktober 2026)

## Aanleiding

Bij de zes historische, vooraf beoordeelde PLUS/DekaMarkt-adaptervormen waren er al signalen voor afnemende frisheid en onbekende waarden **per bronvorm**. Geaccepteerde en geweigerde bronbestanden werden alleen op **het totaal over alle zes vormen** vergeleken. Daardoor bleef een verslechtering binnen één bronvorm onzichtbaar wanneer een andere bronvorm exact omgekeerd verbeterde. De onafhankelijke QA-worker heeft dit met de twee verwachte rode tests in [issue #2999](https://github.com/Zennay/Supa/issues/2999) en [QA #2998](https://github.com/Zennay/Supa/pull/2998) op de actuele `main` gedemonstreerd.

## Productoplossing

De private, read-only `comparePrivateAdapterHealth(before, after)` controleert nu óók of binnen een afzonderlijk supermarkt/brontype:

- `accepted` terugloopt → generiek `fewer-accepted-sources-in-source-shape`;
- `rejected` stijgt → generiek `more-rejected-sources-in-source-shape`.

Een signaal wordt maar één keer genoemd; er staat **geen retailer, SKU, prijs, tijd, bronlocatie of bestands-SHA** in. Een bron die stabiel blijft veroorzaakt geen melding. Afwijkende gegevens of ontbrekende privérechten blijven via de bestaande validator verboden. Het rapport blijft uitdrukkelijk `offline-reviewed-dataset-differences-only` en zet geen live pricing, productie of publieke besparingsclaims aan.

## Testprocedure

```bash
node --experimental-strip-types --test tests/product-retailer-health-compensated-admission-20261015.test.mjs
npm test
npm audit --audit-level=high
npm run m1:matching-benchmark
npm run m1:source-permission-gate
npm run build
```

Daarna moet de **letterlijk ongewijzigde originele** QA-test van #2998 op de **gefixte product-SHA** worden uitgevoerd met een aparte, niet te mergen verificatiebranch, en de oorspronkelijke 2 RED→GREEN positief bevestigen. Niet de QA-worker-branch aanpassen.

## Grenzen

Dit is uitsluitend een diagnostische verbetering van de historische offline bronkwaliteit. Het bewijst **geen** echte huidige PLUS/DekaMarkt-productbeschikbaarheid, prijs, besparing, webtoestemming of legitimiteit van automatische scraping. De menselijke 11+11 vergelijking [#78](https://github.com/Zennay/Supa/issues/78), schriftelijke rechten [#74](https://github.com/Zennay/Supa/issues/74), echte field codepin [#205](https://github.com/Zennay/Supa/issues/205) en permanente zelfgehoste gate [#2833](https://github.com/Zennay/Supa/issues/2833) blijven M3-releasevoorwaarden.

**DRAFT / NO MERGE / NO DEPLOY** totdat product- en onafhankelijke QA-review, geldige zCloud scoped SQLite lease, meest recente main en passende trusted VPS gates aantoonbaar zijn gecontroleerd.
