# M3 privé CSV — onafhankelijke financiële consistentiecheck (QA)

Deze optionele controle werkt **volledig offline**, op een eerder lokaal geëxporteerde M3-winkelvergelijking. Er worden geen websites bezocht, geen retailerrechten aangevraagd en geen prijzen geüpload.

## Gebruik

Maak eerst het privé CSV-bestand volgens het bestaande [M3 veldformulier](../product/m3-one-command-human-field-kit.md). Voer daarna lokaal uit:

```sh
node scripts/qa-m3-private-csv-ledger-check.mjs < /pad/naar/prive-vergelijking.csv
```

Bij geldige structuur en rekenkundige consistentie retourneert de CLI exitcode `0` en **alleen metadata** zoals `ledgerConsistent: true`, `comparableRows` en `fullBasketComparable`. Er verschijnen geen producten, prijzen, namen of privébronverwijzingen in stdout. Bij ongeldige invoer is de exitcode niet-nul, stdout leeg en stderr uitsluitend `M3 private CSV financial consistency failed`.

De invoer komt uitsluitend via stdin, maximaal 1 MiB UTF-8. Bewaar de CSV privé: de uitvoer is geen verwijdering of opschoning van het bronbestand.

## Onafhankelijke controles

De checker roept **eerst** de bestaande formule-/spreadsheet-injectiepreflight aan en accepteert uitsluitend de exacte 11-regelige privé-M3-export met de originele 19 kolomkoppen, disclaimers en vaste tekstlabels. Vervolgens controleert hij bedragen als gehele eurocenten (zonder floats):

- Voor iedere bekende PLUS- en DekaMarkt-regel: aantal benodigde verpakkingen × prijs per verpakking = regeltotaal.
- Voor iedere aan beide kanten gemeten regel: DekaMarkt-regeltotaal − PLUS-regeltotaal = voorlopig regelverschil.
- Voor een complete mand: som van de elf PLUS-regels, som van de elf DekaMarkt-regels en hun onderlinge verschil = de drie bedragen in de laatste rij.
- Voor een incomplete mand: géén geldige voorlopige winnaar of volledig mandbedrag, ook niet wanneer iemand de footer handmatig heeft aangepast.
- Onbekende producten blijven onbekend, nooit automatisch `€0,00`. Negatieve prijzen, negatieve aantallen, onveilige integers en ongeldige euro-opmaak worden geweigerd.

De optionele financiële controle verandert **niet** de bestaande (bewust syntactische) functie `auditPrivateM3ComparisonCsv`. De productexporter, retailerrechten en overige workflows worden evenmin aangepast.

## Wat een groen resultaat niet betekent

`ledgerConsistent: true` bewijst **uitsluitend interne rekenkundige overeenstemming van het ontvangen lokale CSV-bestand**. Een volledig verzonnen maar onderling consistente tabel kan dus nog steeds door deze check komen. De checker bewijst **niet** dat prijzen werkelijk zijn waargenomen, producten juist zijn gematcht, bronnen actueel of gelicentieerd zijn, of besparingen publiek mogen worden geclaimd. Het resultaat bevat daarom altijd `verifiedRetailerObservations: false` en `publicSavingsClaimEligible: false`.

M3 externe voorwaarden blijven afzonderlijk op HOLD: schriftelijke PLUS/DekaMarkt-rechten [#74](https://github.com/Zennay/Supa/issues/74), echte gelijkwaardige 11×2-veldobservaties [#78](https://github.com/Zennay/Supa/issues/78), broncodepin [#205](https://github.com/Zennay/Supa/issues/205) en een permanente self-hosted M3 runner [#2833](https://github.com/Zennay/Supa/issues/2833).

## Zelf testen

```sh
node --experimental-strip-types --test tests/qa-m3-private-csv-ledger-check-20261017.test.mjs
```

De tests gebruiken uitsluitend synthetische bedragen en gecontroleerde mutaties; ze doen geen netwerkverzoeken en hebben geen persoonlijke data nodig.
