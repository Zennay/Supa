# Supa — twee echte offline supermarktarchieven vergelijken

`scripts/retailer-private-reviewed-directory-diff.mjs` verbindt de bestaande betrouwbare **SHA-gebonden review van lokale bronarchieven** met de nieuwe historische **veranderingen-aggregator**. Hiermee kan een operator twee afzonderlijke, vooraf handmatig goedgekeurde en lokaal opgeslagen zes-bronsoorten PLUS/DekaMarkt archieven vergelijken. Dit is geen webscraper of publieke prijsvergelijking.

## Gebruik op gecontroleerde bronbestanden

Gebruik twee **verschillende fysieke privémappen**, elk eerder opgebouwd via `scripts/retailer-private-reviewed-manifest-builder.mjs` of volgens de [private manifest contracten](./RETAILER_PRIVATE_REVIEWED_MANIFEST_REPLAY.md). Elk archief bevat `manifest.json`, zes of meer strikt gevalideerde adapterbewijzen en private bestandsrechten `0600` binnen een eigenaarsspecifieke map `0700`.

```bash
umask 077
node --experimental-strip-types scripts/retailer-private-reviewed-directory-diff.mjs \
  --before-dir /secure/operator/previous-review \
  --after-dir /secure/operator/current-review \
  --at 2026-10-15T21:00:00.000Z
node --experimental-strip-types --test tests/product-retailer-private-reviewed-directory-diff-20261015.test.mjs
```

`--at` is optioneel (anders de huidige systeemklok), bepaalt alleen de **controle-referentietijd** voor historische opnames en is géén prijsverversing. De commandoregel weigert extra parameters, `--publish`, URL-captures of identieke padnamen. Het bestaande replayproces controleert elk bronmanifest (ongewijzigde SHA-256, UTF-8, unieke JSON-sleutels, bronsoort, toegangsmode, bestanden en identiteiten) volledig vóór vergelijking. Een gebroken opname weigert de hele vergelijking; er is **geen partial-price fallback**.

De uitkomst bevat voor elk van de zes bronsoorten uitsluitend de **aantallen** nieuwe, verdwenen en veranderde producten plus aantallen verschillen in centen, aanbieding, verpakking, voorraad, naam en bronvermelding. Een artikel dat in een later archief ontbreekt wordt niet stilzwijgend als gratis beschouwd. Producten worden alleen op *dezelfde winkel, bronsoort en bronartikelidentiteit* vergeleken; geen winkeloverschrijdende matching of besparingsclaims. In het uitvoerbestand staan geen prijzen, productnamen, artikel-ID's, bron-URL's, bestandsnamen of digests.

## Veiligheids- en productgrenzen

- **Twee apart gecontroleerde private datasets**, uitsluitend offline. Geen HTTP, inloggen, CAPTCHA, private API, selectie van een willekeurige live bron, scheduler of automatische publicatie.
- De in-process functie `loadPrivateReviewedCaptureBatch` geeft aan de expliciete operatorcaller wel interne genormaliseerde productfeiten terug. **Nooit loggen of naar een gebruikersscherm sturen**; de CLI gebruikt uitsluitend `comparePrivateRetailerFactChanges` en print alleen geaggregeerde output.
- De rechten blijven onverminderd **PLUS `permission_required` / DekaMarkt `unresolved`**, productie en publicatie `false`. Zelfs twee perfecte SHA-bestanden bewijzen noch bronlicentie noch huidige prijzen.
- M3 is pas extern afgerond met schriftelijke rechten #74, echte menselijke 11+11 PLUS/Deka winkelmandobservaties binnen 24 uur #78, authentieke broncode-SHA #205 en betrouwbare permanente runner #2833. Deze tool verandert die gates niet.

Deze integratie heeft een eigen testbestand en raakt geen parallel actieve QA- of externe brondata-branches.