# M3: één beoordeeld product per offline supermarktproductpagina

Status: **ontwikkelhulpmiddel**, niet geautoriseerd voor een live gegevensverzameling of een publieke besparingsclaim.

## Waarom deze stap bestaat

Op één PLUS- of DekaMarkt-productpagina kunnen meerdere losse Schema.org-JSON-LD-scripts staan: de hoofd-SKU, aanbevelingen en andere metagegevens. Als ieder script zelfstandig een prijswaarneming oplevert, kan Supa het winkelmandje baseren op een aanbevolen product of een dubbele prijs. Eén pagina is geen toestemming voor meerdere aankopen of meerdere productwaarnemingen.

`parseM3OfflineProductHtml({ source, html, capturedAt })` verzamelt daarom **alle actieve JSON-LD-scripts van dezelfde reeds toegestane HTML-capture** en geeft maximaal één aan de pagina-URL gebonden `observation` terug. De onderliggende, op `main` geteste `parseSchemaOrgProductForPage`-parser bepaalt de juiste `Product.url`, prijs, beschikbaarheid en fysieke verpakking. Bij twijfel krijgt de caller `{type:'abstain'}`; onbekende of onvolledige productgegevens mogen niet als besparing worden gepresenteerd.

## Integratie in de private 11 + 11-capture (door de eigenaar van PR #2813)

```js
import { parseM3OfflineProductHtml } from './m3-offline-html-product.mjs'

// 'capture' is uitsluitend een reeds legaal verkregen en integrity-gecontroleerd
// lokaal object. Deze helper voert zelf GEEN netwerkrequest uit.
const result = parseM3OfflineProductHtml({
  source: capture.source,
  html: capture.html,
  capturedAt: capture.capturedAt,
})

if (result.type === 'observation') {
  observations.push(result.observation)
} else {
  // Behandel dit product als ontbrekend/onvergelijkbaar.
  // Probeer geen alternatieve/goedkopere Product node op dezelfde pagina.
  rejected += 1
}
```

De bestaande 22-producten-planningscontrole, dubbele-URL-deduplicatie, dezelfde 11 eisen voor beide winkels, rechtencheck en volledige fysieke mandcalculator blijven afzonderlijk verplicht. Deze helper vervangt **niet** de autorisatie- of 24-uurs-/stockcontroles en wordt **niet** ongemerkt in de actieve branch #2813 geschreven.

## Grenzen en gedrag

- Alleen reeds opgeslagen, door de operator aangeleverde PLUS- of DekaMarkt-product-HTML. Geen HTTP, geen cookies, geen proxy, geen scrape, geen toestemmingstruc.
- Vaste maximale HTML-grootte **2 MiB**, maximaal **100** JSON-LD-scripts en **256 KiB** per script. Onmogelijke datums, verkeerde supermarkt-URL's, ongeldige of incomplete JSON-LD en dubbele/ongeïdentificeerde productnodes worden geweigerd.
- HTML-commentaar en scripts in `template`/`noscript`/`textarea` tellen niet als actieve productinformatie; onbekende voorraad blijft onbekend.
- Het resultaat bevat de **SHA-256 van exact het aangeleverde HTML-document**, maar een hash bewijst *niet* dat de pagina authentiek, toegestaan of actueel is.
- Iedere geslaagde uitvoer blijft `evidenceStatus: 'offline-preview-not-retailer-verification'` en `publicSavingsClaimEligible: false`.

## Echt benodigde blokkade-opheffing

De private scraper [#2813](https://github.com/Zennay/Supa/pull/2813) moet de veilige HTML-verwerker expliciet integreren, de bestaande datumgevoelige QA-testcorrectie vanaf het huidige `main` meekrijgen en op zijn nieuwe exacte SHA opnieuw groen draaien. **Echt live ophalen** vereist daarnaast aantoonbare retailerrechten [#74](https://github.com/Zennay/Supa/issues/74). **Een besparingsclaim** vereist een daadwerkelijk geobserveerd 11+11-mandje binnen hetzelfde venster/context [#78](https://github.com/Zennay/Supa/issues/78). Geen van die laatste twee voorwaarden is met synthetische tests opgeheven.
