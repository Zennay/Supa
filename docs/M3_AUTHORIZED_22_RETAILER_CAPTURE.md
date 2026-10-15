# M3: automatisch 11+11 productpagina's innemen en twee winkels vergelijken

Deze ontwikkelfunctie vervangt **niet** de bronrechtentoets. Ze lost een technische beperking op: de oude toestemming-gebonden pipeline kende maar één vaste productpagina per winkel. Nu kan een operator exact **11 canonieke ingrediënten × 2 winkels** koppelen aan echte toegestane productpagina's, elk HTML-document één keer innemen, de bestaande Schema.org-adapter gebruiken en daarna een **volledige boodschappenmandvergelijking** laten berekenen.

## 1. Maak een privéplan

```sh
node --experimental-strip-types scripts/retailer-m3-authorized-22-capture.mjs --template /private/supa-m3-urls.json
```

Vul voor alle 22 rijen de `url` in, zonder de `ingredientId` te veranderen. PLUS vereist `https://www.plus.nl/product/...`, DekaMarkt `https://www.dekamarkt.nl/producten/...`. Dezelfde fysieke SKU mag voor verschillende ingrediënten worden gekoppeld; het hulpmiddel vraagt die pagina maar één keer op en de bestaande mandcalculator telt een gedeelde verpakking niet dubbel.

```json
{
  "version": 1,
  "products": [
    { "supermarket": "plus", "ingredientId": "chicken-thigh", "query": "kippendij", "url": "https://www.plus.nl/product/authorized-example" }
  ]
}
```

Dit JSON-blok is **slechts één illustratieve rij**, geen compleet plan en geen bestaand geverifieerd PLUS-product. De generator maakt alle 22 echte ingrediëntcodes automatisch.

## 2. Alleen na gecontroleerde bronrechten: haal prijzen op

```sh
SUPA_LIVE_RETAILER_CAPTURE=1 node --experimental-strip-types scripts/retailer-m3-authorized-22-capture.mjs --live /private/supa-m3-urls.json
```

De live route leest steeds zelf `evidence/m1/source-permission-gate.v1.json`. Met de huidige status **PLUS permission_required, DekaMarkt unresolved** weigert ze *voordat er een netwerkverzoek gebeurt*. Verander die statuses nooit op basis van fictieve of niet-geautoriseerde bewijsstukken. Leg eerst een echte schriftelijke toestemming of licentie vast. Ook bij toestemming: respecteer voorwaarden, robots, robots-specifieke gebruiksbeperkingen en verzoeklimieten.

## Wat de keten werkelijk doet

1. Valideert eerst 11 unieke ingredient-ID's per winkel, alleen het canonieke M3-maalplan, 22 hele HTTPS-productpaden en twee bekende hosts.
2. Weigert live werking zonder expliciete opt-in en controleerbare toestemming voor **beide** retailers.
3. Doet maximaal 22 **seriële**, anonieme verzoeken, zonder redirect, login, proxy, CAPTCHA-bypass of herpogingen. 403/429 stopt direct. Elke HTML-respons is maximaal 2 MiB.
4. Decodeert UTF-8 strikt; controleert de ruwe SHA-256 tegen de JSON-LD parserbron; weigert dubbele prijsbronreplays.
5. Normaliseert echte prijs, hoeveelheid, beschikbaarheid en tijd uit Schema.org (waar volledig aanwezig).
6. Vergelijkt beide manden met de bestaande `compareReviewedCatalogs`: echte aantal verpakkingen, gedeeld ingekochte producten, prijsverschillen en expliciet `unknown` zodra relevante prijzen/voorraad niet controleerbaar zijn.

Een parser-resultaat is nog geen kassabon of deelnemerbewijs. Zelfs als een hele mand vergelijkbaar is, heeft uitvoer `claimable:false`: **geen publieke besparingsclaim**, geen M4-release en geen automatische productiebronrechten. De ontwikkeling is offline met fictieve 11+11 HTML-responses geautomatiseerd te testen; de tests doen geen werkelijke supermarkt-HTTP.

## Technische grenzen

- JSON-LD is geen garantie dat een winkel zijn checkoutprijzen op productpagina's publiceert. Ontbrekende, ambigue, verouderde of zonder stockbewijs aangetroffen offers leveren terecht geen winnaar op.
- Er wordt niet willekeurig door catalogi gecrawld: een operator geeft voor de canonieke 11 ingrediënten een vooraf gereviewde product-URL op. Ook geen scanning naar eindeloze productlinks.
- Deze feature staat voorlopig op een **afzonderlijke productbranch** als vervolg op de privé-M3-integrator. Original-owner en QA-branchen worden niet overschreven. Review en actuele CI moeten groen zijn voordat deze code verder geïntegreerd kan worden.
