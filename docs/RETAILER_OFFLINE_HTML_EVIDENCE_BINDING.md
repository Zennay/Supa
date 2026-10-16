# SUPA P1 — brongebonden offline HTML → PLUS/Deka-adapterbewijs

**Privé technische integratie; GEEN live scraper, nieuw datagebruiksrecht, actuele prijs of publiek besparingsbewijs.**

## Doel

De bestaande adapters kunnen reeds beoordeelde JSON-bronrecords normaliseren. De afzonderlijke gecontroleerde capture-engine kan HTML met tijdstip en SHA-256 opleveren. Een hash in een JSON-record alleen bewijst niet dat de daarin gestelde product- of aanbiedingsgegevens werkelijk in die HTML stonden.

De nieuwe productfunctie in scripts/retailer-offline-html-evidence-binding.mjs koppelt de twee kanalen. Zij weigert gettermutaties, Proxy-objecten, sparse arrays, onbegrensde structuren, te grote HTML, gewijzigde SHA/bytes, andere bron/winkel/type/tijdstip, dubbelzinnige dubbele JSON-sleutels en een andersluidende gestructureerde payload. De bestaande ingestReviewedEvidence-adapter voert daarna pas de versie-, winkel-, verpakking-, EUR-cent-, aanbod- en productidentiteitscontrole uit.

Ondersteunde exacte HTML-inhoud (vier van de zes bestaande bronsoorten):
- PLUS/product: feitelijke Schema.org Product JSON-LD uit één script.
- DekaMarkt/product: Nuxt JSON plus exact aansluitende Product JSON-LD.
- DekaMarkt/catalogus: exact Nuxt JSON.
- DekaMarkt/aanbiedingen: exact Nuxt JSON.

PLUS catalogus-/aanbiedingskaarten zijn expliciet NIET ondersteund in deze HTML-binding. Die vierkantskaarten komen uit een gerenderde browser-DOM en kunnen niet betrouwbaar uit een gevonden CSS-klasse worden verzonnen. De reeds gecontroleerde oude JSON-replay voor alle zes bronsoorten blijft afzonderlijk mogelijk.

## Geen externe functionaliteit

De functie is zuiver in-memory. Zij kan niet zelf een supermarkt bezoeken, een privé-API aanspreken, sessies/cookies hergebruiken, proxies inzetten, bestanden overschrijven of een proces plannen. Een caller moet expliciet een **rechtmatig eerder verkregen** HTML-captureobject en een **apart door mensen beoordeeld** adapterrecord aanleveren. Een gecontroleerde HTML-hash is een integriteitscheck, geen bewijs van rechten, oorspronkelijke browserrun of menselijke beoordeling. Output bevat uitsluitend privé interne normalisaties; rechten- en publicatievlaggen blijven false.

Test:

    node --experimental-strip-types --test tests/product-retailer-offline-html-evidence-binding-20261016.test.mjs

De test benut vier originele historische M1 gestructureerde adapterfixtures, maar verpakt deze nadrukkelijk in **nieuw synthetisch gemaakte HTML**. De geteste SHA en scriptinhoud zijn dus niet de authentieke historische HTML van PLUS of DekaMarkt. Positieve technische tests zijn NOOIT bewijs dat er nu live productprijzen verkrijgbaar of herbruikbaar zijn.

## Releasebeslissing

M3 blijft ACTIVE/HOLD voor schriftelijke PLUS/Deka rechten (issue #74), identieke menselijke 11×2 productenvergelijking binnen 24 uur (#78), exact veldcode-SHA (#205), vertrouwde permanente VPS-check (#2833), scoped zCloud schrijflease en onafhankelijke review. Zonder deze externe bewijzen géén scheduler, live capture, publieke supermarktprijzen, M4-promotie of claim van eurobesparing.
