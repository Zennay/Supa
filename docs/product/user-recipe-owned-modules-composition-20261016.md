# Eigen recepten: vier onafhankelijke eigen productmodules samen gevalideerd

16 oktober 2026 · Feature [#3263](https://github.com/Zennay/Supa/issues/3263) · **M3 ACTIVE/HOLD**

## Samenstelling

Eén owner-only Git-tree gebaseerd op canonical immutable `main cac55435ddb772288bddcd3aac5ede094d8ca49c`. Deze branch hergebruikt **13 oorspronkelijke bron-, test- en documentatie-Git blobs byte-identiek** uit vier eigen, apart beoordeelbare takken; geen cherry-pick van peer-owned werk.

- Portieschaling [#3268](https://github.com/Zennay/Supa/pull/3268), originele immutable `082b68105f3424e72547e4c86726a0633cfafa17`.
- HTTPS-receptbronlink-voorcontrole [#3270](https://github.com/Zennay/Supa/pull/3270), originele nieuwste `244b5d9647b27e5c880bf510a2cfa8fbe524f8c6`.
- Toegankelijk handmatig reviewformulier [#3274](https://github.com/Zennay/Supa/pull/3274), originele nieuwste `75e79241c7ccc4b7d966b1f9394f32286d5575b9`.
- Opt-in lokale onversleutelde conceptopslag [#3280](https://github.com/Zennay/Supa/pull/3280), originele nieuwste `fc06caffe6d2fb211ec9e3db5680b92567b5b47a`.

De nieuwe productfunctie `src/features/user-recipes/recipeDraftFlow.ts` voert portievoorstel, onveilige bronlinkmelding, expliciete gebruikersinstemming voor lokale conceptbewaring en herstel met nieuwe UI-rijidentiteiten samen. `tests/user-recipe-owned-module-integration-20261016.test.mjs` oefent deze koppeling werkelijk uit inclusief unknown/fractional ingrediënten, 2→4-porties, bronlink met credentials, privacy-redactie, revisieconflict, geen-netwerk- en geen-cloudclaims.

## Eigen recepten → ongeprijsd boodschappenlijstvoorstel

Een additionele productmodule `src/features/user-recipes/userRecipeShoppingNeeds.ts` zet alleen de gekozen porties van één privérecept om in een **ongeprijsde** lijst met duidelijk onbekende hoeveelheden. Ze hergebruikt de bestaande gecontroleerde `sumDecimalAmounts` uit de M3 decimal-engine, telt alleen exact dezelfde label + query + eenheid samen, en houdt gram en milliliter bewust gescheiden. Bij ontbreken oorspronkelijke porties, afronding of halve stuks blijft de rij zichtbaar onder `review_required`; een `null` wordt nooit €0 of een gratis winkelproduct. Geen retailer/productmatching, geen verzonnen besparingen, geen wijziging aan het echte M3 mandje of Planner. De bijbehorende acht nieuwe tests dekken 2→4-porties, 0.1+0.2 exact, onbekende cups, eenheden, halve stuks, grenswaarden en bronwaarschuwingen.

## Expliciete grenzen

- De actieve peer [JSON-LD-intakeparser #3264](https://github.com/Zennay/Supa/pull/3264) is **niet** ingekopieerd of veranderd. Dit bewijs toont compatibiliteit tussen **eigen** bouwstenen, niet al werkende bron-HTML download.
- Geen centrale App/Planner/[#3088](https://github.com/Zennay/Supa/pull/3088), geen navigatietab, authenticated API of echte gebruiker-DB, geen persist na reinstall, geen transacties tussen browsertabs, geen SSRF-proof DNS/redirect/connected-IP fetch, geen echte PLUS/Deka observaties.
- **Niet dubbel mergen**: deze samengestelde branch bevat dezelfde 13 bestanden als vier aparte eigen voorlopers. Kies bij formele review precies één coherent integratiepad en hou autoritatieve scoped zCloud SQLite write lease en actuele main/CI in het oog. Voorlopers en compositie blijven DRAFT/NONMERGE zolang governance/review ontbreekt.
- M3 menselijke veldrun #78, retailerbronrechten #74, veldcode-SHA #205, trusted permanent VPS #2833 en officiële reviewer blijven echte vrijgavepoorten; geen M4 beta-exit, prijs/savings claim of productie-dispatch.

**Check:** `node --experimental-strip-types --test tests/user-recipe-owned-module-integration-20261016.test.mjs`; plus exact-head GitHub-hosted full Node, audit-high, M1 source rights/matching en TS/Vite build.
