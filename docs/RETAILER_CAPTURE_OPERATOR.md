# SUPA — website-snapshots veilig opslaan en selectors analyseren (P1)

Dit zijn nu **uitvoerbare programma's** voor de door jou gewenste route: eerst beperkte HTML-pagina opslaan, dan de site-specifieke selectors onderzoeken en daarna feiten in één universeel SUPA-schema normaliseren.

## Belangrijke toegangspoort

**De huidige canonical bronrechtenregistratie staat live scraping nog NIET toe:** PLUS = `permission_required`, DekaMarkt = `unresolved`. De downloader leest die registratie zelf en zal daarom **voor enig netwerkverzoek weigeren**. Pas wanneer er feitelijke bronrechtautorisatie per keten, de benodigde voorwaarden-/robotsreview en een passende productieafspraak zijn, kan een operator een scoped snapshot ophalen. Een gebruiker die zegt dat scraping belangrijk is, verleent op zichzelf geen rechten van de supermarkt.

Maak daarna in een privé-bestand, niet in Git, een specifieke reviewed capture grant aan:

```json
{
  "supermarket": "plus",
  "kind": "catalog",
  "sourceUrl": "https://www.plus.nl/producten",
  "reviewed": true,
  "termsReviewed": true,
  "robotsReviewed": true,
  "noAntiBotBypass": true
}
```

**Alle waarden zijn voorbeeldvelden, niet daadwerkelijk verleende toestemming.** Zonder overeenkomende expliciete schriftelijke autorisatie in `evidence/m1/source-permission-gate.v1.json` blijft deze technische grant machteloos.

## Eén toegestaan HTML-snapshot downloaden

```sh
node --experimental-strip-types scripts/retailer-download-reviewed-source.mjs \
  private-approved-source-grant.json \
  artifacts/private-retailer-ingest/plus-catalog.html
```

De CLI maakt twee `0600` privébestanden aan: `plus-catalog.html` (de daadwerkelijke broninhoud) en `plus-catalog.html.manifest.json` (exacte URL, retailer, bronsoort, tijdstip, SHA-256, bytes, status). Beide moeten aanwezig zijn en de SHA moet overeenkomen; geen bestaand bestand wordt overschreven. De CLI voert geen batchdownload uit, volgt geen redirects, gebruikt geen cookies of proxy en stopt onmiddellijk op HTTP 403/429.

Deze file-path checks zijn statisch en zijn **geen volledige bescherming tegen gelijktijdige kwaadaardige directoryvervanging**. Gebruik een vertrouwde lokale operatoromgeving en deel de HTML/manifesten niet publiek.

## HTML analyseren zonder opnieuw te scrapen

Verifieer uit het manifest eerst het echte `sha256` en `capturedAt`. Voer dan lokaal uit:

```sh
node --experimental-strip-types scripts/retailer-inspect-snapshot-cli.mjs \
  plus https://www.plus.nl/producten \
  <capturedAt-uit-manifest> <sha256-uit-manifest> \
  artifacts/private-retailer-ingest/plus-catalog.html
```

Deze analyser print alleen veilige kandidaat-CSS-selectoren en geaggregeerde structuurkenmerken. Het is **geen volwaardige DOM/browser/AI-selectorverificatie**. Realistische selectors kunnen afkomstig zijn uit dynamisch gerenderde pagina's, JavaScript of externe CSS en vragen een echte herhaalbare beoordeelde test op die winkel. Niet-bevestigde selectors mogen nooit nieuwe publieke productprijzen publiceren.

## Eén universeel productformaat

De bestaande PLUS en DekaMarkt product-/catalogus-/aanbiedingsadapters leveren `RawProductObservation` met retailer, eigen product-ID, prijs in gehele EUR-centen, fysieke verpakking, aanbod en voorraadstatus. De nieuwe batch en `retailer-universal-catalog.mjs` bewaren ieder feit met bron-URL, snapshot SHA en capturetijd, gegroepeerd onder `retailerId:retailerProductId`. Tegenstrijdige feiten blijven `review-required`, dus er komt geen schijnprijs of automatisch samengestelde aanbieding in het overzicht.

Een private offline JSON-database-export van de zes bestaande gecontroleerde fixturetypes:

```sh
node --experimental-strip-types scripts/retailer-private-catalog-store.mjs --output \
  artifacts/private-retailer-ingest/catalog.json
```

Deze stappen bereiden nieuwe supermarktadapters en uiteindelijk een echte database/scheduler voor. Voor 17 kandidaatketens bestaan nog geen 17 werkende en gelicentieerde productieparsers; eerst hun eigen goedgekeurde bronstructuur en regressietests vastleggen. De echte M3-mandvergelijking en bronrechten blijven afzonderlijke bewijs- en vrijgavevoorwaarden.
