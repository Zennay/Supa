# SUPA P1 — download snapshots → AI/human selector review → één datamodel

**Werkende, afzonderlijke QA/toolingfase**: `scripts/retailer-snapshot-selector-proposals.mjs`.

## 1. Bewaar de bron, niet alleen de selector

SUPA heeft al een begrensde M1-capturetool (`scripts/m1-capture-sources.mjs`) voor exact zes bekende PLUS- en DekaMarkt-URL's. Die maakt per HTML-pagina een bronbestand en `manifest.json` met URL, tijdstip, SHA-256 en resultaat. Gebruik **alleen een reeds rechtmatig verkregen, goedgekeurde snapshot**. In de huidige `evidence/m1/source-permission-gate.v1.json` is PLUS nog `permission_required` en DekaMarkt `unresolved`; productie-HTTP, schedulers, een complete site downloaden, proxies of scraping van extra URL's blijven uit.

Per gecontroleerde capture kun je zonder netwerkverkeer de selectors analyseren:

```bash
node --experimental-strip-types scripts/retailer-snapshot-selector-proposals.mjs \
  --out private-review/selector-proposals.json \
  artifacts/m1-captures/EXISTING_APPROVED_RUN
```

Het programma controleert bronidentiteit, exacte toegestane retailerhost, status, bounded HTML, SHA-256 en lokale bestanden. Het schrijft een **nieuw privébestand (0600, geen overschrijving)**. Het haalt niets op, klikt niet door en verwerkt geen cookies, API-tokens of persoonsgegevens.

## 2. Website verschilt per keten, database niet

De offline verkenner haalt **voorstel-selectors** (`tag.class`) en structuurindicatoren (`Product`/ `Offer` JSON-LD, Nuxt script, herkenbare naam-/prijs-/verpakkingklassen) uit de reeds opgeslagen pagina. De output bevat géén naam, individuele productprijs of ruwe pagina-inhoud. Extra `possibleFieldSelectors`-groepen koppelen geschikte **structuurnaam-hints** aan `name`, `price`, `package`, `offer` en `availability`, zodat een AI/reviewer gericht kan controleren. Ook deze suggesties zijn nadrukkelijk `UNVERIFIED_FIELD_HINT` en mogen nooit automatisch de productieparser activeren. Een mislukte M1-response zonder HTML/SHA wordt in een gedeeltelijk manifest voortaan eerlijk `CAPTURE_UNAVAILABLE`, niet stilzwijgend genegeerd en niet als selector geaccepteerd. Een voorstel is expliciet `UNVERIFIED_PROPOSAL`; geen automatische promoteroute en geen bewijs dat een selector live werkt.

Per keten blijft een aparte bronadapter nodig (PLUS: rendered DOM; DekaMarkt: SSR/Nuxt). Een reviewer — eventueel AI met toegang tot de snapshots — vergelijkt de **echte captured HTML**, controleert de betreffende velden op meerdere producten, legt de versie/bronhash vast en voegt pas daarna passende adaptertests/fixtures toe.

De gedeelde bronobservatie is nu al `RawProductObservation` in `src/data/ingestion.ts`. De bestaande adapters voeren onder andere deze uniforme velden aan:

| Universeel gegeven | Herkomst per keten |
| --- | --- |
| supermarkt-ID + lokaal product-ID | geverifieerde winkel-URL/JSON/DOM |
| naam en verpakking | onderbouwde HTML-/payload-velden |
| huidige prijs in hele eurocenten + EUR | geld-normalisatie |
| aanbieding (normaal/actie, geldigheid) | alleen expliciet betrouwbare bronvelden |
| voorraadstatus | bekend/onbekend, nooit gegokt |
| source URL, capture timestamp, SHA-256 | manifest + HTML-controle |

De parallelle productworker bouwt de gezamenlijke uitvoerbare zes-adapterengine in [PR #2895](https://github.com/Zennay/Supa/pull/2895). Deze extra QA-tool wijzigt geen van diens bronbestanden en vormt de voorbereidende selector-discovery-lus bij toekomstige toegestane websites. De volgende stap is een centrale opslag met één retailer/productidentiteit plus **afzonderlijke** prijswaarnemingen per snapshot, zodat historische acties niet stilletjes als de actuele normale prijs gelden.

## 3. Veilig gedrag bij wijzigingen

- Capture faalt of SHA verschilt → weigeren, geen nieuwe selector publiceren.
- Nieuwe HTML/CSS-naam → alleen voorstel; drift + test + handmatige acceptatie.
- JSON-LD zegt iets anders dan getoonde kaart → uitkomst `unknown`, geen lagere prijs verzinnen.
- Selectors bestaan maar zijn niet via bronbewijs geverifieerd → geen live datatrust.
- Zonder schriftelijke toestemming of officiële feed → alleen offline, geen live scrape, geen prijsredistributie.
- Zonder verse, consistente volledige boodschappenmand → geen publieke eurobesparing.

**M3 en issue #78/#74/#205 blijven open; dit is P1 technische scraperinfrastructuur, niet een release- of rechtengoedkeuring.**
