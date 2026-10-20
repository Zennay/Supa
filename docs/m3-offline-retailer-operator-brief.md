# M3 offline winkelbron-startcontrole (PLUS en DekaMarkt)

Deze operatorfunctie maakt de bestaande **historische** zes-bronnenproef leesbaar voor het team. Zij haalt niets op bij een supermarkt en mag nooit als toestemming voor een live prijscatalogus worden uitgelegd.

## Uitvoeren

In een gecontroleerde kopie van Supa, met Node.js dat `--experimental-strip-types` ondersteunt:

```sh
npm ci
node --experimental-strip-types scripts/retailer-private-operator-brief.mjs
node --experimental-strip-types --test tests/product-private-retailer-operator-brief-20261016.test.mjs
npm run m1:source-permission-gate
```

De CLI accepteert **geen argumenten**. Geen URL, proxy, winkelaccount, bestandsroute of toegangstoken invoeren. De command leest uitsluitend de zes gecontroleerde historische M1-fixtures uit de repository, voert de bestaande strikte adapters uit en controleert de versiebeheerste M1-bronrechten. De uitvoer bevat geen producten, prijzen, URL's, hashes, opnametijdstippen of wachtwoorden.

## Wat de controle uitlegt

- Voor **PLUS** en **DekaMarkt**: drie bronvormen (producten, catalogus, aanbiedingen), hoeveel historische bronopnamen de adapter aanvaard of afgekeurd heeft, of ze buiten het beoordelingsvenster vallen en hoeveel historische prijswaarnemingen **onbekend** zijn. Bij ontbrekende prijzen is expliciete handmatige broncontrole nodig; onbekend wordt nooit als €0 of als actuele prijs geïnterpreteerd.
- Per keten: de huidige licentiestatus en concrete acties voor brontoestemming, ontbrekende/afgekeurde bestanden, ouderdom en afzonderlijke nieuwe capture-beoordeling.
- Een onmiskenbare waarschuwing dat **geen** live scraping, automatische refresh, actuele retailerprijs, publieke publicatie of bewezen besparing beschikbaar is.

Een geslaagde technische test betekent alleen dat het historische offline pad reproduceerbaar is. De controle activeert nooit productie. Bij een intern onjuist rapport, ontbrekende zes-bronnenstructuur of tegenstrijdige rechten-/publicatievlag wordt de uitvoer geweigerd. Ook een bron die als *geaccepteerd* telt maar geen historische productwaarneming bevat, wordt geweigerd. De fysieke timestamp van de **nieuwste** geaccepteerde opname wordt gecontroleerd tegen het beoordelingsvenster: als zelfs die te oud is, mag het overzicht niet claimen dat alle opnamen binnen de termijn vallen; als de nieuwste nog binnen de termijn valt, mogen niet alle bronnen als verouderd zijn aangemerkt. De bronherkomst blijft privé en er wordt nooit automatisch een actuele prijs uit afgeleid.

## Nieuw: concrete historische voorraad- en verpakkingsdekking

Dezelfde nul-argumenten CLI toont nu aanvullend per winkel **uitsluitend uit gevalideerde historische M1-fixtures** hoeveel productwaarnemingen de adapters verwerkten, bij hoeveel de beschikbaarheid onbekend bleef, bij hoeveel verpakking/inhoud niet vaststond en hoeveel historische aanbiedingswaarnemingen zijn herkend. Een aparte actie vraagt handmatige controle vóór een winkelmandvergelijking zodra verpakkings- of voorraadinformatie ontbreekt.

De nieuwe diagnostiek gebruikt de bestaande offline adapter-health evaluator en exact dezelfde referentietijd én beoordelingsduur als de bronmatrix. De twee aggregaten worden wederzijds gecontroleerd op zes bronvormen, geaccepteerd/afgekeurd, historische waarnemingen, onbekende prijzen en veroudering. Ook de samenvattende claims (*alle zes bronvormen compleet*, *alle archieven binnen venster*), de exacte lijst ontbrekende bronnen en alle verplichte vervolgacties worden opnieuw afgeleid en afgewezen bij tegenspraak. De geschreven-bronrechten-actie mag niet worden weggelaten zolang er geen zelfstandige vrijgave is. Bij een inconsistent of actief JavaScript-callerobject (getters/Proxy), een ontbrekende bronvorm, bronrechten-publicatieclaim of onmogelijk aantal wordt de hele uitvoer geweigerd.

**Belangrijk:** *historische aanbiedingswaarnemingen* betekent nooit aanbiedingen die vandaag gelden. *Beschikbaarheid onbekend* is niet hetzelfde als uitverkocht. Verpakking onbekend wordt niet automatisch als eenheidsprijs of besparing geïnterpreteerd. Er worden geen producten, bedragen, bron-URL's, tokens, fingerprints of opnameklokken geprint. Deze cijfers vormen triage voor een medewerker, geen actuele voorraad- of besparingsindicator.

## Wat nog nodig is voor M3

De [Supa-projectfase](https://app.notion.com/p/3e79e19ac955810f903be62439eef2b3) blijft **M3**. De echte uitgevoerde veldproef (#78; identieke PLUS/DekaMarkt 11×2 binnen 24 uur), schriftelijke hergebruikrechten (#74), herleidbare field-run bronversie (#205), permanent betrouwbare M3-runner (#2833) en relevante zCloud-hoofdbranchlease zijn losstaande voorwaarden. Deze tool vervangt geen ervan.

Zie de [product-PR](https://github.com/Zennay/Supa/pull/3213) voor de broncode en de volledige CI-acceptatie. Gebruik resultaten uitsluitend voor interne menselijke review.
