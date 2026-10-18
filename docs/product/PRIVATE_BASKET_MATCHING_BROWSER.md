# Supa · Eigen winkelproducten koppelen in de browser

## Eigen bronnen, zonder winkelprijzen op te halen

Open in de Supa-site of lokale Vite-app: **/private-basket-mapping.html**. Deze statische route staat los van de huidige React-PRs #3904/#3916 en de HTML-rapportage-PR #3918. De route is pas publiek beschikbaar na een geautoriseerde merge/deploy.

1. Selecteer één gecombineerd PLUS/Deka CSV, een lokaal geconverteerde supa-offline-prices-v1 JSON of twee afzonderlijke winkel-CSV-bestanden. Alle CSV-opnames hebben de bestaande kop met negen kolommen: retailer, observedAt, id, name, packAmount, packUnit, packCount, priceCents, available. De bestaande gedeelde CSV-converter valideert de volledige gecombineerde invoer. Geen retailer-fetch.
2. Vul het echte aantal geselecteerde maaltijden en ingrediënten in, met metrische fysieke hoeveelheid of expliciet onbekend (leeg).
3. Kies per ingrediënt een daadwerkelijk herkenbaar winkelproduct uit de eigen bron. Elke dropdown blijft binnen dezelfde maateenheidsdimensie (gewicht, volume, stuks). Dit is geen automatische semantische productmatch: de gebruiker controleert zelf SKU en inhoud. Niet gekoppeld blijft null, nooit nul euro.
4. Download supa-private-mand-vraag.json. Het is exact het supa-private-basket-demand-v1 contract: selectedMealCount, ingredients, amount/unit en expliciete productIds voor PLUS en DekaMarkt. Er staan geen prijzen in het vraagbestand, er is geen upload of localStorage.
5. Als zelfstandige PR #3918 is geïntegreerd kan hetzelfde vraagbestand met de bestaande HTML-vergelijker worden gebruikt. Voor losse winkelbestanden: node --experimental-strip-types scripts/offline-local-basket-comparison.mjs --pair plus.csv deka.csv supa-private-mand-vraag.json mand.html. Voor gecombineerde CSV: node --experimental-strip-types scripts/offline-local-basket-comparison.mjs bronnen.csv supa-private-mand-vraag.json mand.html.

## Bronwaarheid en vrijgave

- Geen fictieve prijzen, automatische winkelscraper, verborgen productmapping of openbare besparingsclaim.
- Dezelfde fysieke ingrediëntbehoefte is voor beide winkels vastgelegd. Een gelijke eenheidsdimensie is geen bewijs van productequivalentie. De gebruiker bevestigt de afzonderlijke retailer-ID's handmatig.
- Browser-CSP sluit externe scripts, netwerkverbindingen en afbeeldingen uit; productnamen worden als tekstnodes in de DOM weergegeven.
- De gedeelde converter blijft verantwoordelijk voor strikte CSV-structuur, winkelopnamen, dubbele product-ID's en centen. Samengevoegde bron maximaal 256 KB. Het scherm laat oude, toekomstige en >24 uur gescheiden observaties zien, maar de echte tijdsprecisie- en volledige-mand-gates zijn uitsluitend in de rapportagecode.
- De statische route is geen bewijs van retailerrechten of veldonderzoek. Schriftelijke #74 rechten, echte menselijke 11×2 PLUS/Deka-bronobservaties #78, veldcode-SHA #205 en runner #2833 blijven afzonderlijke gates voor onderzoeks- en publicatieclaims.
- De twee bestanden onder public/ vormen geen nieuwe backend, nemen geen React-App.tsx of bestaande live PR-branch over en schrijven geen QA-/regressietests.

## Implementatie

Nieuwe bestanden: public/private-basket-mapping.html en public/private-basket-mapping.mjs; hergebruikt public/offline-two-store-csv.mjs. Vite neemt het statische HTML/JS-bestand bij de normale productiebuild op. Voor daadwerkelijke prijzen en hele-verpakkingbedragen wordt de bestaande lokale rapportageroute uit #3918 hergebruikt zodra die is gemerged.
