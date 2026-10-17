# SUPA M3 — onafhankelijke QA-preflight voor lege winkelobservatie-CSV

Deze QA-only controle werkt **los van de product-exporter** en is uitsluitend bedoeld
om te controleren of een *nog niet ingevuld* PLUS/DekaMarkt-observatieformulier
veilig kan worden doorgestuurd voor menselijke metingen. De bestaande
verkennende 11×2 vergelijking en de feitelijke veldobservatie zijn andere stappen.

## Offline gebruiken

Genereer eerst een privé-template met de bestaande productfunctie of de
afgescheiden product-CLI, en voer daarna de QA-preflight uit:

```bash
node --experimental-strip-types scripts/retailer-private-selected-week-observation.mjs --days Ma,Do > private-unobserved-template.csv
node scripts/qa-m3-private-worksheet-preflight.mjs < private-unobserved-template.csv
```

De QA-tool leest **alleen standaardinvoer**, doet geen netwerkverzoeken,
schrijft geen bestanden en geeft alleen een geaggregeerde JSON-samenvatting:

```json
{"mode":"m3-blank-worksheet-qa-only","rows":10,"ingredientNeeds":5,"pairedRetailers":2,"verifiedActualObservations":0,"sourceRightsVerified":false,"productionReady":false,"publicSavingsClaimEligible":false}
```

Bij afwijzing is de exitcode **2** en verschijnt geen rij-inhoud, productnaam,
winkelprijs, privézoekvraag of deels gevulde JSON op stdout.

## Wat het controleert

- Strikt en begrensd UTF-8 (maximaal 1 MiB), met 18 exact benoemde, correct
  gequote CSV-kolommen en maximaal 100 verschillende ingrediënten.
- Per ingrediënt **één PLUS- en één DekaMarkt-rij**, geen duplicaten;
  dezelfde naam, gevraagde hoeveelheid en eenheid aan beide kanten.
- Alle twaalf velden voor waarneming, winkel, prijs, beschikbaarheid en
  documentatie blijven **precies leeg**.
- Status is uitsluitend `UNOBSERVED_TEMPLATE_NOT_EVIDENCE`.
- Identiteit/hoeveelheden blijven leesbaar: geen exponentnotatie, bedragen,
  niet-numerieke waarden of negatieve/lege hoeveelheden. De QA-tool gebruikt
  voorlopig een **conservatieve bovengrens 1.000.000 per eenheid** en
  hoogstens zes decimalen. Dit is **geen definitieve, eenheidspecifieke
  productregel**. P2 #3720 blijft open totdat de product-owner de juiste
  grenzen vastlegt.
- Geen Unicode-tekstrichtingsmanipulatie, onzichtbare formatteringsmarkeringen,
  gevaarlijke begintekens of onbeschermde spreadsheetformules. Echte meertalige
  namen en contextueel geldige joins in bijvoorbeeld emoji/Hindi/Perzisch
  blijven ondersteund. P2 #3722 blijft open totdat ook de **product-exporter**
  deze gevallen correct opvangt.

Test het met:

```bash
node --experimental-strip-types --test tests/qa-m3-private-worksheet-preflight-20261016.test.mjs
node --experimental-strip-types --test tests/qa-m3-worksheet-private-query-noninterference-20261016.test.mjs
```

## Grenzen en overdracht

Een positieve QA-preflight betekent **uitsluitend** dat de structuur van een
lege template voldoet aan deze aanvullende QA-contracten. Het betekent nooit
dat daadwerkelijk winkelprijzen zijn gezien, dat de betreffende artikelen
verkrijgbaar zijn, dat bronrechten voor hergebruik bestaan of dat de
prijsvergelijking live gepubliceerd mag worden. De tool ondertekent geen
velddata en valideert geen menselijke observaties.

De resterende formele M3-gates blijven **HOLD**:
- #74: schriftelijke bronrechten voor geautomatiseerd hergebruik.
- #78: echte, vergelijkbare **11×2** observaties binnen dezelfde maximaal
  24-uurs prijscontext. De eerdere 11×2-verkenning is wel afgerond.
- #205: vastgelegde en gecontroleerde SHA van de gebruikte veld-code.
- #2833: vereiste runner-/release-acceptatie.

Deze QA-code is geïsoleerd op een aparte branch. Integratie/merge vraagt
onafhankelijke review en de correcte zCloud source- en mergerleases;
geen productcode of beschermde `main` wordt hierbij gewijzigd.
