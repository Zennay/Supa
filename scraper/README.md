# SUPA supermarkt-scrapers

Eén scraper-engine met per supermarkt een eigen adapter, die alle producten met prijs, actie, verpakking en EAN in één SQLite-database zet en daarna dezelfde producten over ketens heen aan elkaar koppelt.

```bash
npm run scrape                       # alle actieve ketens, volledig
npm run scrape -- --retailer dirk,spar --limit 200
npm run scrape -- --skip-fresh 20    # hervatten: sla producten over die <20 uur geleden gezien zijn
npm run scrape:stats                 # dekking per keten + matching-overzicht
npm run scrape:compare -- pindakaas  # prijsvergelijking van gematchte producten
npm run scrape:match                 # matching opnieuw berekenen
node scraper/cli.mjs retailers       # status en bron per keten
node scraper/cli.mjs parse dirk pagina.html   # adapter offline op opgeslagen HTML draaien
```

De database staat standaard in `artifacts/scraper/supa-products.sqlite` (niet in Git). Met `--db <pad>` kies je een ander pad, met `--save-html <map>` bewaar je alle opgehaalde HTML (gzip) voor offline analyse of nieuwe fixtures.

## Dekking (onderzocht op 15-10-2026)

| Keten | Bron in de pagina | Ontdekking | EAN | Status |
|---|---|---|---|---|
| PLUS | JSON-screenservices van de site zelf (details + actie), geen browser | productsitemap (~17.400) | ja | actief, ~0,5 s per product (4 verzoeken/s) |
| Dirk | Nuxt 3-payload `data["product-<id>"]` (+ JSON-LD) | productsitemap (~7.400) | nee | actief |
| DekaMarkt | zelfde Detailresult-platform, `product-information-<id>` | productsitemap (~9.900, URL herschreven naar `/producten/…`) | nee | actief |
| SPAR | JSON-LD (`gtin13`, prijs) + `.c-offer__subtitle` voor inhoud | productsitemap (~8.800) | ja | actief |
| Hoogvliet | JSON-LD (prijs) + Next.js `metadata` (EAN, merk, inhoud) | catalogussitemap (~9.800) | ja | actief |
| ALDI | Next.js `apiData` → `PRODUCT_DETAIL_GET` | productsitemap (~3.800) | nee | actief |
| Lidl | Nuxt 3-payload `&erp<id>` | productsitemap (~13.400) | nee | actief, food meestal zonder online prijs |
| Poiesz | Nuxt 3 listingpagina's (volledige productobjecten) | categorieboom uit de payload (472 subsubcategorieën, gepagineerd) | ja | actief |
| Vomar | Nuxt 2 `window.__NUXT__` listingpagina's | afdeling → groep | ja (+ extra EAN's) | actief |
| Albert Heijn | (JSON-LD) | — | — | **geblokkeerd**: Akamai geeft 403 op alles, ook robots.txt |
| Jumbo | (JSON-LD) | — | — | **geblokkeerd**: verbinding hangt (bot-tarpit) |
| Jan Linders | (JSON-LD) | — | — | **geblokkeerd**: 403 op alles |
| Picnic, Boni, Nettorama, Coop | — | — | — | geen webcatalogus met prijzen (Coop is opgegaan in PLUS) |

AH, Jumbo en Jan Linders hebben een generieke JSON-LD-adapter: vanaf een netwerk waar ze wél bereikbaar zijn draait `--retailer ah --include-blocked` gewoon. Vanaf hier stopt de fetcher bij de eerste 403 of time-out. We omzeilen geen botbescherming.

## Hoe het werkt

```text
adapter.discover()  sitemap / categorieboom → URL's
PoliteFetcher       robots.txt + Crawl-delay, 1 verzoek/s per host, eerlijke User-Agent,
                    retry met backoff op 5xx, stopt definitief op 401/403/herhaalde 429
(adapter.fetch)     PLUS: twee anonieme JSON-calls per product (versietokens automatisch
                    uit het OutSystems-manifest); BrowserRenderer blijft als fallback
adapter.parse()     gestructureerde data uit JSON-LD / __NEXT_DATA__ / __NUXT_DATA__ /
                    Nuxt 2-IIFE (geparsed, nooit uitgevoerd) → genormaliseerd record
ScrapeStore         SQLite: products + prices (historie, alleen nieuwe rij bij wijziging)
rebuildMatches()    canonical_products + product_matches
```

**Waarom geen CSS-selectors?** Elke keten zet zijn productdata al als gestructureerde JSON in de pagina. Dat is stabieler dan klassenamen en geeft exacte waarden (prijs in centen, EAN, inhoud). Waar een veld alleen in de HTML staat (inhoud bij SPAR, "niet meer leverbaar"), wordt één gerichte selector gebruikt.

**Fail-closed:** als meer dan 50% van de pagina's (na 40 pagina's) fouten of nul producten oplevert, stopt de run met status `failed` ("possible layout drift"). Dan moet de adapter en fixture worden bijgewerkt. Elke run staat in `scrape_runs`.

## Datamodel (`scraper/schema.sql`)

- `products`: één rij per keten + bron-ID: naam, merk, EAN, categorie, verpakking (`pack_amount` in g/ml/stuk × `pack_count`), URL.
- `product_gtins`: alle EAN's per product (Vomar geeft er soms meerdere).
- `prices`: prijs in centen, actieprijs, actielabel, geldigheid, beschikbaarheid. Een nieuwe rij komt er alleen bij als iets verandert; anders schuift `last_seen_at` op. Daarmee blijft de volledige prijshistorie bewaard.
- `canonical_products` + `product_matches`: koppeling over ketens heen.
- Views `latest_prices` (laatste prijs per product, `effective_price_cents` = actieprijs als die er is) en `price_comparison`.

Prijzen zijn altijd de online/webwinkelprijs op het observatiemoment. Ontbreekt die (Lidl-food, SPAR "niet meer leverbaar"), dan is de prijs `NULL`. We vullen niets in met een gok.

## Matching

1. **EAN (exact):** producten met dezelfde globale EAN zijn hetzelfde artikel, ook via secundaire EAN's. Winkelinterne codes (prefix 02/20–29, gewichtsartikelen) worden nooit gebruikt.
2. **Merk + inhoud + naam (conservatief):** voor ketens zonder EAN (Dirk, DekaMarkt, ALDI, Lidl). Een product sluit alleen aan bij een cluster als het merk exact gelijk is, de totale inhoud gelijk is (±1%), de naam-tokens voldoende overeenkomen (Dice ≥ 0,75, minstens twee gedeelde woorden tenzij beide namen uit één woord bestaan, en geen afwijkende getallen in de naam zoals 8-13 vs 8-15) en er een duidelijke winnaar is (marge ≥ 0,1). Ook mag die keten nog niet in het cluster zitten.
3. Anders blijft het product `single`. Een gemiste match is goedkoper dan een verkeerde prijsvergelijking.

Huismerken (PLUS, Dirk "1 de Beste", AH, …) worden dus níet aan elkaar gekoppeld als "vergelijkbaar". Dat is een aparte, latere stap (equivalentie i.p.v. identiteit). Dirk en DekaMarkt delen wel het huismerk "1 de Beste" en worden via merk + inhoud + naam gekoppeld.

## Tests

`tests/scraper-*.test.mjs` draaien mee in `npm test`:

- contracttests per adapter op echte, ingekorte pagina's in `fixtures/scraper/*.html.gz` (15-10-2026)
- robots.txt, pacing, 403/429/5xx-gedrag van de fetcher (met nep-fetch, zonder netwerk)
- devalue- en Nuxt 2-parser, prijs-/verpakkings-/EAN-normalisatie
- prijshistorie, EAN- en fuzzy matching (incl. weigeren bij twijfel), runner (blocked, drift-abort)

Fixture verversen: `npm run scrape -- --retailer spar --limit 3 --save-html /tmp/html`, daarna `node scraper/make-fixture.mjs /tmp/html/spar/<hash>.html.gz <url> fixtures/scraper/spar-product.html.gz`.

## Periodiek draaien

Een volledige run kost bij 1 verzoek/s per host enkele uren per keten (parallel over ketens). PLUS doet ~2 producten/s (eigen tempo van 4 verzoeken/s), een volledige run ≈ 2,5 uur. Voorbeeld voor een dagelijkse run op een server:

```cron
15 4 * * *  cd /srv/supa && npm run scrape -- --skip-fresh 20 >> artifacts/scraper/cron.log 2>&1
```

## Grenzen

- Dit is een technische dataverzameling van publieke productpagina's. Hergebruik of publicatie van retailerdata (#74, licentie/toestemming) is een aparte beslissing. Deze tooling verandert `evidence/m1/source-permission-gate.v1.json` niet.
- Online prijzen kunnen afwijken van de prijs in een specifieke winkel. Voor M3-bewijs blijft de veldobservatie (#78) leidend.
