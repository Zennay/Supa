# SUPA M3 — één commando voor een lege, versievaste veldmeetbundel

Status: **alleen voorbereiding voor menselijke 11×11 veldmeting**. Deze bundel is geen prijswaarneming, marktoestemming of besparingsbewijs. Supa blijft M3 ACTIVE / PRIVATE RELEASE HOLD. Zie [echte veldrun #78](https://github.com/Zennay/Supa/issues/78), [bronrechten #74](https://github.com/Zennay/Supa/issues/74) en [nog open bewijsrevisie #205](https://github.com/Zennay/Supa/issues/205).

## Gebruik

Werk op een **schone, actuele `main`**: `git switch main && git pull --ff-only`. Verifieer eerst dat je de bedoelde laatste main checkout gebruikt. Maak de bundel uitsluitend in een **nieuwe, niet-bestaande privémap** (geen repo-map die later wordt gecommit):

```sh
node --experimental-strip-types scripts/m3-prepare-field-kit.mjs --output-dir /private/path/naar/m3-veldbezoek
```

Gebruik bewust de rechtstreeks uitvoerbare Node-opdracht; het bestaande canonieke npm-evidencecommando-register wordt niet uitgebreid of verzwakt. Het commando leest de **daadwerkelijke** Git-branch + exacte HEAD-SHA en vereist dat die gelijk is aan de lokaal bijgewerkte `origin/main`-verwijzing. Het weigert een featurebranch, detached HEAD, ongeldige SHA, achterlopende lokale main of gewijzigde gevolgde repositorybestanden. Er wordt **niet automatisch `git fetch`** uitgevoerd: `git pull --ff-only` voor het bezoek blijft verplicht. Er is geen door de gebruiker invoerbare `--sha` die zich als goedgekeurde code kan voordoen. Een opgegeven bestemming die al bestaat wordt nooit overschreven. De uitvoermap moet **buiten iedere bestaande Git-checkout** staan, niet alleen buiten Supa: ook mappen van andere projecten, losse Git-worktrees met een `.git`-bestand, en de eigen `artifacts/`, `tests/` en `.git/` zijn verboden. Dit voorkomt dat later ingevulde gevoelige waarnemingen via `git add -A` per ongeluk gepubliceerd worden. Nieuwe privémap: mode 0700, vier bestanden mode 0600. Oudere symlinked output-ouderpaden worden geweigerd. De lokale bestanden blijven op het systeem, niet in de Git-repository.

Vier bestanden:

1. `collection-sheet.json`: exact het nog lege officiële **11 PLUS + 11 DekaMarkt** observatiecontract uit `buildObservationSheet`, geen producten of prijzen ingevuld.
2. `field-form.html`: twee direct printbare A4-landscape-invulbladen, automatisch uit dezelfde canonieke vraag opgebouwd. Ook dit is nog geen bewijs.
3. `source-revision.json`: aanvullende bewijs-pin met de **werkelijke** schone `main` Git SHA, canonieke demand-SHA-256 en expliciete `not-evidence` flags. De generator legt de SHA één keer als eigen datawaarde vast en gebruikt diezelfde waarde in de begeleidende tekst; variabele getters/Proxy-waarden kunnen niet ongemerkt een andere revisie invullen.
4. `START-HERE.txt`: Nederlandse stappen inclusief exact 24-uurvenster, dezelfde prijscontext, expliciete onbekenden en veilige opvolgcommando's.

Kies hetzelfde kanaal (beide fysieke winkels óf beide online), leg echte datum en tijdzone bij beide vast, verifieer voor elk van de 22 regels werkelijk product, voorraad, inhoud/eenheid, verpakkingsaantal, prijs per verpakking, herkomst en verplichte toestemming. Vul nooit een fictieve prijs in; `niet beschikbaar` blijft onbekend in een besparingsberekening.

Na een **echte** individuele handmatige veldmeting:

```sh
npm run m3:build-observed-study -- /private/path/naar/m3-veldbezoek/collection-sheet.json --output /private/path/naar/m3-veldbezoek/converted-study.json
npm run m3:assess-observed-week -- /private/path/naar/m3-veldbezoek/converted-study.json --output /private/path/naar/m3-veldbezoek/assessment.json
```

**Let op de resterende echte bewijsblokker #205:** de code-pin zit momenteel in het begeleidende `source-revision.json`, **niet** in het `WeeklyBasketStudy`- of rapport-JSON. Bewaar alle originele meetbestanden en de begeleidende revision-file bij elkaar voor onafhankelijke controle. De pin alleen sluit issue #205 niet af. Geen automatisch live ophalen, bronrechten omzeilen, public euro savings, M4-promotie of deploy.

## Grenzen

De generator slaat geen echte waarnemingen op en doet geen webverzoeken. Door de gegevensloze bundel als strikt nieuwe private directory te maken worden bestaande privébestanden niet geopend of veranderd. De standaard Node-API voorkomt geen tegenstander die directory-inodes vlak na preflight actief omwisselt; gebruik een vertrouwde, niet gedeelde lokale bestandsomgeving. Dit is nadrukkelijk geen hostile-filesystem sandbox.

## Testen

```sh
node --experimental-strip-types --test tests/product-m3-private-field-kit-20261015.test.mjs
```

De productregressies beschermen vraagpariteit, echte leegheid, read-only revision manifest, branch/SHA-weigering, deterministische output, geen bestaande bestanden overschrijven, permissies en symlinked parents. Onafhankelijke QA en exacte hosted volledige CI zijn nodig voor integratie.
