# SUPA: expliciet lokaal receptconcept herstellen (geen gebruikersdatabase)

Geïsoleerde sub-feature van [#3263](https://github.com/Zennay/Supa/issues/3263), zonder aanpassingen aan de actieve intakeparser #3264, editor #3274, portieschaal #3268, URL-admission #3270, M3 App/retailers of QA-eigenaars.

`src/features/user-recipes/recipeDraftDeviceStorage.ts` heeft een optionele, pure lokale opslaginterface die de **toekomstige editor** alleen na uitdrukkelijke gebruikersactie mag gebruiken:

- `createDeviceDraftId()` genereert een willekeurige UUIDv4 met de ingebouwde `crypto.randomUUID()`.
- `saveRecipeDeviceDraft(storage, id, draft, expectedRevision)` bewaart alleen toegestane conceptvelden in een begrensde v1-jsonrepresentatie van maximaal 64 KiB; slaat **geen bron-URL**, UI-ID, wachtwoordveld, klant- of retailerprijs, claim of geheime variabele op. Het originele in-memory formulier blijft ongemoeid.
- `readRecipeDeviceDraft(storage, id)` geeft een concept terug als `needs_review`, nooit een geaccordeerd of geprijsd recept.
- `deleteRecipeDeviceDraft(storage,id,expectedRevision)` vereist de actuele versie. Verkeerde/oude versie, beschadigde JSON, onbekende schemaversie en storage-rechtenfout worden zichtbaar geblokkeerd; nooit bestaande concepten blind overschrijven. Bij verwijderen verdwijnt de receptinhoud; alleen een numerieke revisie-high-watermark blijft achter, zodat een nieuw concept met dezelfde UUID nooit dezelfde revisie krijgt als een oud tabblad.
- Geen automatisch bewaren, geen gedeelde browseraccount en geen sync. **Lokale browseropslag is onversleutelde opslag op dit apparaat.** Niet geschikt voor vertrouwelijke recepten op gedeelde apparaten. De gebruiker moet expliciet instemmen voordat een UI deze functies aanroept. Wissen/browser reset/reinstall betekent dat dit lokale concept verloren kan gaan.
- Versiecontrole bewaart een revisie-high-watermark over verwijderen/hermaken heen en doet een recheck, maar **localStorage heeft geen atomaire compare-and-swap tussen tabs**. De high-watermark voorkomt het delete/recreate-ABA-conflict; de recheck is nog steeds geen multi-tab transactiebewijs. Echte consistente accountgebonden opslag vereist aparte authenticatie, database-transacties, migraties, privacycontrole, serverversies en synchronisatie.
- Dit is **geen** M4 beta/vrijgave, en vormt geen oplossing voor M3 field #78, source rights #74, codepin #205, trusted VPS of scoped writer lease.

**Validatie:** `node --experimental-strip-types --test tests/user-recipe-device-draft-recovery-20261016.test.mjs`, plus native exacte HEAD CI, onafhankelijke QA en toekomstige gebruikerstests voor herstel/conflicten.
