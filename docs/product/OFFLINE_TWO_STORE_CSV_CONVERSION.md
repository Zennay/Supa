# Twee echte winkelopnames: CSV → Supa-import

Supa kan bestaande, **zelf rechtmatig verkregen** productwaarnemingen van PLUS en DekaMarkt lokaal vergelijken. Als die in een spreadsheet staan, zet deze offline converter ze om naar het bestaande `supa-offline-prices-v1` JSON-contract dat **Vergelijk** in [product-PR #3899](https://github.com/Zennay/Supa/pull/3899) leest.

## Zonder terminal: browserconverter

Open op een Supa-deployment **[/offline-two-store-import.html](/offline-two-store-import.html)**. Deze zelfstandige pagina is onderdeel van dezelfde Vite-static-site: selecteer een UTF-8 CSV of plak CSV-tekst, kies **Controleer en maak JSON**, en gebruik **Download JSON voor Supa**. De conversie en controle gebeuren volledig lokaal in het tabblad. De pagina uploadt niets, bewaart geen waarden en geeft alleen na een geslaagde conversie een downloadknop vrij. Als invoer verandert wordt een eerder gemaakt downloadresultaat ongeldig.

Deze browserpagina werkt zelfstandig en kan worden uitgerold voordat de vernieuwde **Vergelijk**-interface uit [#3899](https://github.com/Zennay/Supa/pull/3899) klaar is. Het gegenereerde bestand kan daarna in die interface worden ingelezen; totdat #3899 is geïntegreerd betekent conversie nog **geen live mandjesvergelijking**.

## Gebruik

1. Maak een UTF-8 CSV met **exact deze negen kolommen, in deze volgorde**:

```csv
retailer,observedAt,id,name,packAmount,packUnit,packCount,priceCents,available
```

2. Voeg minstens één bestaande, daadwerkelijk waargenomen productregel voor elke winkel toe. Gebruik per winkel één *werkelijke* ISO-8601-waarnemingstijd inclusief expliciete offset, bijvoorbeeld de werkelijke lokale offset `+01:00` of `+02:00` op de dag van de opname. Neem geen tijden over van een voorbeeld: de converter verzint geen waarnemingen of prijzen. Een product dat niet geprijsd/waargenomen is, mag je uitsluitend als `available=false` opnemen met lege `packAmount`, `packCount` en `priceCents`. Bij een echt beschikbaar product moeten deze drie velden uit de daadwerkelijke observatie ingevuld zijn.

3. Converteer:

```bash
node scripts/offline-two-store-csv-to-json.mjs eigen-waarnemingen.csv mijn-twee-winkels.json
```

4. Open **Supa → Planner**, kies maaltijden en ga naar **Vergelijk → Vergelijk twee winkels met eigen prijsdata**. Importeer de gegenereerde JSON, controleer matches, hele verpakkingen, eenheidsprijzen en ontbrekende producten. Het bestaande import- en matchingpad besluit of een privésom getoond mag worden.

Het programma doet **geen HTTP-verzoek**, logt geen productnamen of prijzen, en overschrijft nooit een bestaand JSON-uitvoerbestand. Onjuist CSV-formaat of ontbreken van een van beide winkels betekent een fout zonder stilzwijgende prijsaanvulling.

## Eén echte winkelopname, zonder tweede winkel te verzinnen

Voor een afzonderlijke, rechtmatig verkregen **PLUS óf DekaMarkt** CSV-opname kun je exact dezelfde strikte product- en prijscontrole gebruiken en rechtstreeks het bestaande Supa-eenwinkel-JSON-formaat aanmaken:

```bash
node scripts/offline-two-store-csv-to-json.mjs --single eigen-winkel.csv mijn-eerste-winkel.json
```

Dit geeft `supa-private-single-store-prices-v1` met uitsluitend die ene echte winkel. Importeer het via **Supa → Vergelijk**; productreview, Planner en boodschappenlijst blijven bruikbaar. Een winnaar of financieel prijsverschil is pas mogelijk na een apart aangeleverde, werkelijk waargenomen tweede winkel binnen dezelfde tijdcontext. Bestaande tweewinkelconversie zonder `--single` blijft verplicht twee winkels vereisen.

## Betekenis van de kolommen

| Kolom | Verplichte waarde |
| --- | --- |
| `retailer` | Exact `PLUS` of `DekaMarkt`. |
| `observedAt` | De werkelijk genoteerde datum/tijd; `YYYY-MM-DDTHH:mm:ss+HH:MM` of expliciete `-HH:MM`. Herhaal exact per winkel. |
| `id` | Zelf gekozen unieke stabiele artikel-ID, **per winkel** uniek. |
| `name` | Werkelijke productnaam; bij komma's het CSV-veld omsluiten met dubbele aanhalingstekens, en `"` escapen als `""`. |
| `packAmount` | Gemeten inhoud per individuele verpakking als positief getal met puntdecimaal, of leeg indien onbekend. |
| `packUnit` | `g`, `kg`, `ml`, `l`, of `piece`. Ook bij een onbekende verpakking kies je de betreffende ingrediënt-eenheid, **geen gegokte hoeveelheid**. |
| `packCount` | Werkelijk aantal eenheden per te kopen multipack; bij beschikbaar product expliciet invullen, anders mag dit leeg. |
| `priceCents` | Werkelijk waargenomen **hele eurocenten**, géén decimale europrijs. Nul is alleen toegestaan als een werkelijk gratis artikel zo geprijsd was; anders leeg. |
| `available` | Alleen letterlijk `true` voor geobserveerd beschikbaar mét meetbare verpakking en prijs; anders `false`. |

Een ontbrekend artikel blijft onbekend in de app en maakt een volledig mandje onmogelijk. De converter maakt bewust **geen** artikelmatch, berekening of verouderingsclaim: daarvoor gebruikt Supa de bestaande eenheidsprijs-, ingredientmatching- en volledigheidsregels. De applicatie laat een onderlinge privésom alleen toe wanneer alle regels matchen en beide opnames jonger dan zeven dagen en maximaal 24 uur uiteen liggen. Deze CSV is **geen M3-veldonderzoeksbewijs** en verleent geen retailerlicentie.

### Ontbrekend product blijft écht ontbrekend

Een rij uit het lege planner-invulblad mag **helemaal onbekend blijven**: laat `name`, `packAmount`, `packCount`, `priceCents` en desgewenst `observedAt` leeg en laat `available=false`. De converter **slaat uitsluitend deze volledig lege, onbewezen rij over**. Supa's daadwerkelijke ingredientmatching ziet daarna geen bronproduct en toont de benodigde maaltijdregel als **niet gekoppeld**, zonder nulprijs of compleet mandtotaal. Een deels ingevulde productregel wordt nooit stilzwijgend overgeslagen; die vereist een geldige echte productnaam/tijd/verpakking volgens de bronstatus. Je moet wel minstens één echt opgenomen product van **beide** winkels hebben om de twee-opname-JSON te maken. Lege regels hebben geen fake tijdstempel nodig.

## Grenzen en bronintegriteit

- Per winkel 1–1.000 records; maximaal 256 kB voor CSV en JSON.
- Eén fysieke opnametijd per winkel. Geen ontbrekende tijden, geen verzonnen defaults, geen dubbele artikel-ID's, geen onbekende winkels of velden.
- CSV met RFC-4180-gequote namen, komma's en regeleinden wordt ondersteund; bestanden uit Excel als **UTF-8 CSV met komma's** exporteren. CSV met komma, puntkomma of tab als kolomscheiding wordt geaccepteerd als exact dezelfde negen kolomkoppen aanwezig zijn. Voor `packAmount` zijn punt- of komma-decimalen toegestaan; `priceCents` blijft altijd een geheel aantal centen.
- Ongeldige datums, future jaar-/offsetcombinaties, controltekens, misvormde getallen en ongeldige statuswaarden worden afgewezen. Uitvoer wordt uitsluitend nieuw aangemaakt, met bestandsrechten voor de lokale eigenaar.
- Import blijft privé/lokaal. De bestaande echte bronrechten [#74](https://github.com/Zennay/Supa/issues/74), onafhankelijke fysieke 11×2 PLUS/DekaMarkt-waarneming [#78](https://github.com/Zennay/Supa/issues/78), codepin [#205](https://github.com/Zennay/Supa/issues/205) en runner [#2833](https://github.com/Zennay/Supa/issues/2833) zijn aparte releasegates. Geen publieke prijs- of besparingsclaim.
