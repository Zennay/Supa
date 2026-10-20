# Eigen recepten: porties omrekenen (geïsoleerd productonderdeel)

16 oktober 2026 · [Issue #3263](https://github.com/Zennay/Supa/issues/3263)

`src/domain/userRecipePortions.ts` levert de pure `scaleMetricRecipeDraft` die op de nog afzonderlijk te reviewen `UserRecipeDraft` uit PR #3264 aansluit. De inputvorm vereist alleen `servings`, `ingredients[].amount`, `ingredients[].unit`, en `ingredients[].reviewReason`; overige invoervelden en bronverwijzingen blijven behouden. De originele input wordt nooit gemuteerd.

- Alleen `g`, `ml` en `piece`; portiedoel 1–1000 gehele porties. Geen cups of ongekende eenheden omrekenen.
- Exact bekende hoeveelheden herschalen en tonen met maximaal drie decimalen. Afronding wordt als waarschuwing gemarkeerd, een half stuk blijft 1,5 stuks met expliciete handmatige controle.
- Onbekende oorspronkelijke porties => **helemaal niet herschalen** en niet doen alsof het gelukt is. Onbekende/onzin-/grensoverschrijdende hoeveelheden => `null` en gebruikersreview; geen kunstmatige nul, productmatch, prijs of opslag.
- `status:needs_review` bij onzekerheid; dit is niet het finale save- of planningscontract. Inkomende reviewreden blijft intact. De latere UX kan `warnings` per rij tonen en de gebruiker origineel en aangepast laten vergelijken vóór opslaan.

**Test:** `node --experimental-strip-types --test tests/user-recipe-portions-20261016.test.mjs` (tien pure scenario's). Hierna exact-head full GitHub Actions CI en onafhankelijke QA nodig. Geen wijziging in M3-retailer-, kassabon-, meet-, planner-, autorisatie- of rechtenfuncties. Geen merge/deploy zonder scoped afstemming. M3 blijft HOLD voor daadwerkelijke #74/#78/#205 en overige gates.
