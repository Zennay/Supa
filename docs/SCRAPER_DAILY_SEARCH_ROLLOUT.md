# Supa: gratis dagelijkse supermarktprijzen en zoeken

Dit vervolg bouwt voort op bestaande branch feat/retailer-scrapers met negen actieve ketenadapters: PLUS, DekaMarkt, Dirk, SPAR, Hoogvliet, Aldi, Lidl, Poiesz en Vomar. AH, Jumbo en Jan Linders hebben adapters maar verkeer is volgens brononderzoek geblokkeerd. Aanwezigheid van een adapter bewijst geen actuele data.

## Implementatie

- scraper/daily-source-policy.mjs vereist een per-retailer gedocumenteerde basis en expliciete publicatiescope. Het voorbeeld scraper/daily-source-policy.example.json laat alle twaalf bronnen uit.
- scraper/daily-refresh.mjs roept de bestaande eigen CLI aan voor toegestane retailers; schrijft waarnemingen in persistente SQLite en hergebruikt de bestaande prijs-, actie- en EAN-matching.
- PLUS en Deka blijven extra geblokkeerd door evidence/m1/source-permission-gate.v1.json zolang dit project niet apart goedgekeurd is.
- scraper/retailer-search-api.mjs biedt op 127.0.0.1:4317 een databasezoekendpoint. Alleen beschikbare prijzen van maximaal 24 uur oud, bron-URL geverifieerd, verlopen aanbiedingen genegeerd, maximaal 40 resultaten.
- src/features/search/RetailerSearchView.tsx en de tab Zoeken bevatten een normaal formulier zonder fetch of iframe. De eigen server-rendered resultaatpagina toont supermarkt, product, verpakking, prijs, URL en tijd; zonder bruikbare bron staat er expliciet geen actuele prijs.

## Juridisch: niet iedere scraper vereist schriftelijke toestemming

De Databankenwet (https://wetten.overheid.nl/BWBR0010591) beschermt onder voorwaarden tegen substantiële databankextractie en bepaalde herhaalde/systematische niet-substantiële extracties. Losse openbare feiten zijn niet automatisch verboden. Websitevoorwaarden en commerciële publicatie moeten per bron worden onderzocht. PLUS/Deka staan conservatief uit door de bestaande Supa-projectgate; dat is geen wettelijke algemene verplichting tot schriftelijke toestemming. Een toepasselijke publieke licentie of gedocumenteerd rechtmatig gebruik kan een andere bronbasis zijn. De voorbeeldpolicy geeft niets vrij.

## VPS-deploy na bron- en release-go

1. Installeer repository en Node 22+ in /opt/supa.
2. Maak een privéconfiguratie /etc/supa/retailer-policy.json vanuit de voorbeeldpolicy. Keur een bron alleen goed met concrete scope, reviewedAt, evidenceUrl, basis en publicationApproved. Vermijd publicatie als rechten niet zijn opgehelderd.
3. Zet de volgende variabelen in /etc/supa/scraper.env (toegang alleen voor beheerder):
   SUPA_SCRAPER_POLICY=/etc/supa/retailer-policy.json
   SUPA_SCRAPER_DB=/opt/supa/artifacts/scraper/supa-products.sqlite
   SUPA_SOURCE_PERMISSION_GATE=/opt/supa/evidence/m1/source-permission-gate.v1.json
4. Pas de User= en WorkingDirectory= in de drie deploy/supa-retailer-* systemd units aan, kopieer ze naar /etc/systemd/system/ en voer systemctl daemon-reload uit.
5. Na geverifieerde bron- en projectgoedkeuring: systemctl enable --now supa-retailer-search.service supa-retailer-refresh.timer
6. De timer draait elke dag rond 04:15 Amsterdam. Journalctl voor voortgang: journalctl -u supa-retailer-refresh.service -n 100 --no-pager
7. Maak een HTTPS reverse-proxyroute van /api/retailer-products naar http://127.0.0.1:4317. Vite dev/preview heeft die proxy al.
8. Valideer met curl 'http://127.0.0.1:4317/api/retailer-products?q=melk'.

## Echte status

Deze PR implementeert de onderdelen en systemd-sjablonen maar heeft zelf GEEN live retailerrequest, VPS-serviceinstallatie, geactiveerde timer, bronrechten of prodprijsfeed uitgevoerd. Alle twaalf bronnen staan in de voorbeeldpolicy uit. Geen actuele prijzen tonen zolang geen rechtmatig toegestane en recente waarnemingen zijn opgehaald. PR #3351 is een afzonderlijke offline capture-koppeling die niet is overschreven.
