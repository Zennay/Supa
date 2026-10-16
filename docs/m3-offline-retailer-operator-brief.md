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

- Voor **PLUS** en **DekaMarkt**: drie bronvormen (producten, catalogus, aanbiedingen), hoeveel historische bronopnamen de adapter aanvaard of afgekeurd heeft en of ze buiten het beoordelingsvenster vallen.
- Per keten: de huidige licentiestatus en concrete acties voor brontoestemming, ontbrekende/afgekeurde bestanden, ouderdom en afzonderlijke nieuwe capture-beoordeling.
- Een onmiskenbare waarschuwing dat **geen** live scraping, automatische refresh, actuele retailerprijs, publieke publicatie of bewezen besparing beschikbaar is.

Een geslaagde technische test betekent alleen dat het historische offline pad reproduceerbaar is. De controle activeert nooit productie. Bij een intern onjuist rapport, ontbrekende zes-bronnenstructuur of tegenstrijdige rechten-/publicatievlag wordt de uitvoer geweigerd.

## Wat nog nodig is voor M3

De [Supa-projectfase](https://app.notion.com/p/3e79e19ac955810f903be62439eef2b3) blijft **M3**. De echte uitgevoerde veldproef (#78; identieke PLUS/DekaMarkt 11×2 binnen 24 uur), schriftelijke hergebruikrechten (#74), herleidbare field-run bronversie (#205), permanent betrouwbare M3-runner (#2833) en relevante zCloud-hoofdbranchlease zijn losstaande voorwaarden. Deze tool vervangt geen ervan.

Zie de [product-PR](https://github.com/Zennay/Supa/pull/3213) voor de broncode en de volledige CI-acceptatie. Gebruik resultaten uitsluitend voor interne menselijke review.
