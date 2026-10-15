# SUPA — toestemming → één HTML-opname → private selectorreview

De bestaande `retailer-approved-snapshot-capture.mjs` heeft een strikte bronrechten- en URL-scopecheck. De bestaande `retailer-offline-selector-discovery.mjs` controleert reeds ontvangen HTML en stelt hooguit CSS-selectors voor. De product-core brug `scripts/retailer-approved-capture-selector-bridge.mjs` zet deze twee stappen nu **veilig na elkaar** in één herbruikbare functie: `captureToPrivateSelectorReview({ source, permissionGate, grant, fetchFn, capturedAt })`.

## Waarom dit echte productcapaciteit is

Een operator die later over geldige schriftelijke rechten én een beperkte, expliciet beoordeelde pagina-scope beschikt, kan via één gecontroleerde call de capture aan dezelfde SHA-256-beveiligde offline selectorvoorstellen koppelen. Het resultaat bevat supermarkt, bronsoort, exacte capturetijd, hash, aantal tags en onbesliste selectorvoorstellen. Er is geen handmatig kopiëren van niet-gecontroleerde HTML naar een parser of schijnzekerheid over een CSS-selector. Geen bronprijs of winkelproduct wordt uit HTML gepromoveerd.

De interface **bevat bewust geen CLI, standaard fetch, store scheduler of automatische output op schijf**. `fetchFn` moet expliciet door een geautoriseerde caller worden geïnjecteerd. De bestaande capturelaag eist daarnaast geldige `evaluateSourcePermissionGate`-uitkomst, geschreven rechten, exact HTTPS-domein en toegestane route, één URL-specifieke grant, beoordeelde robots/voorwaarden en geen anti-bot-omzeiling. Geen redirects, cookies, credentials, proxyrotatie, retries of bulkfetch. Is één voorwaarde onwaar, dan wordt de transportfunctie niet aangeroepen.

De offline analyzer herberekent de SHA op de werkelijk ontvangen UTF-8 HTML en de brug controleert de SHA, bytegrootte, tijd, supermarkt en de fail-closed velden opnieuw. Een ongesloten comment, gebrekkige HTML, geweigerde response, 403 of 429 stopt volledig. Resultaat: `humanSelectorApprovalRequired:true`, `approvedSelectors:0`, `productionEnabled:false`, `readyForIngestion:false`, `currentPricesExtracted:false`, `scheduledFetchEnabled:false`, `publicSavingsClaimEligible:false`.

## Reproduceerbare veilige controle

```bash
node --experimental-strip-types --test tests/product-retailer-approved-capture-selector-bridge-20261015.test.mjs
```

Alle positieve voorbeelden gebruiken **synthetische rechten uitsluitend in de test en in-memory `Response`**, dus **geen echte retailerrequest**. Een aparte regressie laadt het werkelijke `evidence/m1/source-permission-gate.v1.json`: PLUS staat op `permission_required`, DekaMarkt op `unresolved`; alle echte PLUS/Deka-retailercaptures stoppen vóór de geïnjecteerde transportfunctie. De mock-keten oefent PLUS-productcatalogus, Deka-aanbiedingen/Nuxt-signalen, SHA-consistentie, redactie, ontbreken van rechten, route/robotsscope, rate limits en onbetrouwbare markup.

**Geen vrijgave:** bevestigde hergebruiksrechten #74, menselijke identieke PLUS/DekaMarkt 11×2 in 24 uur #78, fysieke main-codepin #205 en trusted runner #2833 ontbreken. Deze brug is standaard uit en verkrijgt zelf nooit source-grants, nieuwe brondata of publieke besparingsclaims. M3 blijft ACTIVE/HOLD.
