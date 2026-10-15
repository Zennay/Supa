# Supa — één onveranderd bronbestand moet exact dezelfde catalogusproducten opleveren

De historisch gecontroleerde PLUS/DekaMarkt-productvergelijker groepeert een volledige HTML-bronopname (supermarkt + bronsoort + URL + SHA-256), niet alleen een paar product-ID's die toevallig in twee snapshots voorkomen.

## Waarom dit nodig is

Eén PLUS-cataloguspagina kan vier artikelen bevatten. Als een latere, intern doorgerekende historische snapshot **dezelfde ruwe HTML-SHA-256 en dezelfde bron-URL** draagt, moet hij alle vier dezelfde bronartikelidentiteiten en exacte genormaliseerde feiten bevatten, ook wanneer de opnameklok later is. Een parser die één product verliest of hernoemt, mag niet als winkelassortimentswijziging worden uitgelegd.

De nieuwe controle verzamelt eerst alle producten per fysieke opname (nauwkeurigheid tot negen fractiecijfers, tijdzone-offsets omgezet naar één fysieke tijd), daarna de volledige gesorteerde ID-en-inhoudset per identieke (winkel, soort, URL, SHA). Alle historische en huidige events met dezelfde broninhoud moeten dezelfde set geven. Elke tegenstrijdigheid blokkeert de **hele** vergelijking met een algemene fout, vóór het tellen van toegevoegd/verdwenen product of gewijzigde prijs.

## Regels en bewijs

- Bij **dezelfde ruwe URL én SHA**: toegevoegde, verwijderde en hernoemde bronproducten worden geweigerd; dezelfde fysieke HTML-inhoud kan niet van productset wisselen.
- Bij **verschillende echte HTML-SHA**: bronwijzigingen kunnen alleen als **privé geaggregeerde review-aantallen** worden geteld. Een ontbrekend product is geen gratis of niet-verkrijgbaar product.
- Andere, onafhankelijk gecapteerde bron-URL's, bronsoorten en winkels blijven strikt gescheiden.
- Het artikel zelf is nooit het publicatiebewijs: geen artikel-ID, naam, feitelijke centprijs, URL, hash of ruwe HTML wordt in de uitvoer gezet.

De zeven product-owned regressies in `tests/product-retailer-source-set-sha-continuity-20261015.test.mjs` gebruiken bestaande historische PLUS multi-product catalogusbewijsdata en uitsluitend fictieve in-memory mutaties. Onafhankelijke [QA #3069](https://github.com/Zennay/Supa/pull/3069) detecteerde het probleem eerst met originele 2 HOSTED RED. Deze nieuwe bronfix verandert de QA-bron en externe rechten niet.

M3-rechten #74, echte menselijke PLUS+DekaMartk 11+11 binnen 24h #78, authentieke veldcode SHA #205 en vertrouwde permanente runner #2833 blijven noodzakelijk. Geen HTTP of publieke besparingsclaim.
