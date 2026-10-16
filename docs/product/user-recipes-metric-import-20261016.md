# SUPA eigen recepten: incrementele invoergrens — 16 oktober 2026

[Feature #3263](https://github.com/Zennay/Supa/issues/3263). Deze branch introduceert **alleen** een geïsoleerde PURE parser met tests. Dit is geen voltooide Mijn-recepten UI, werkende URL-server of cloud-database. M3 blijft ACTIVE/HOLD; #78/#74/#205 en scoped writer/VPS blijven ongewijzigd.

## Domeincontract

`src/domain/userRecipeImport.ts` levert `UserRecipeDraft`: bron manual/url, originele HTTPS-link (indien van toepassing), titel, bereidingstijd, porties, stappen, ingrediënten met `original,label,query,amount,unit,reviewReason`, waarschuwingen en `status:'needs_review'`. Eenheden die downstream mogen komen: uitsluitend `g`, `ml`, `piece`. De parser converteert kg→g, l→ml, oz/lb→g (3 decimalen). `cup`, `tbsp`, `tsp`, overige volume/gewichtconversies zonder productdichtheid en onduidelijke no-quantity regels worden `amount:null` met reviewreden. Geen verborgen gok of nieuw financieel bewijs.

Het pakket geeft bewust **geen** `estimatedCost`, user-ID of DB-row terug. Daarmee kan de gebruiker het nog niet per ongeluk als echte catalogusrecipe met gratis ingrediënten of echte winkelprijzen behandelen. De latere review/persist-laag moet expliciet veldvalidatie en bewijs-/matchingregels passeren en veilige IDs uitgeven.

## URL route

Een losstaande, door de gebruiker geïnitieerde importflow haalt toegestane HTML via een **nog te bouwen** strikt begrensde serverprovider, die DNS/IP+redirect SSRF checks, publieke HTTPS-only, timeout, content-type, responsegrootte, auth, rate-limit en prive data afdwingt. **Nooit rechtstreeks blind user-URL fetch op VPS of browser.** Daarna `importRecipeFromHtml(sanitizedHtml,originalUrl)` gebruiken, die alleen `application/ld+json` van `schema.org/Recipe` uitleest (array / @graph / HowToStep) en nooit een script uitvoert. Ontbrekende schema/bron -> handmatig formulier; geen false-positive ingest.

## Volgende echte product-stappen (andere owner / reviewed scope)

1. Beveiligde URL-loader API en gecontroleerde HTML fallback. Receptimport mag niet automatisch retailercatalogi crawlen.
2. UI Mijn recepten + bewerkbare preview, eigen recept CRUD, validatie en opt-in bewaren; server-side authenticated user storage/schema/migration met versieconflictbescherming, offline-concepten.
3. Correcte ingredient IDs en heldere ingredient-query matcher; expliciete gebruikerstoestemming; vermenigvuldiging met porties en samengestelde `RecipeWithIngredients`.
4. Integreer alleen bevestigde recepten in bestaande planner, mand en lijst; volgende onafhankelijke werkcheck bevat behoud vaste M3 11×2 bewijsroute.
5. Onafhankelijke QA, exact HEAD full GitHub-hosted CI, geldige project/scope claims, zo nodig self-hosted/mobile/eigenaarreview. Geen M4 beta/production release alleen op deze parserbranch.

`node --experimental-strip-types --test tests/user-recipe-metric-import-20261016.test.mjs`
