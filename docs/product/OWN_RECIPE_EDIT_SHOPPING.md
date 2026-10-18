# Eigen recepten bewerken en direct een boodschappenlijst maken

Dit is een **lokale privéfunctie** van de Supa-tab **Recepten**. Er is geen supermarktprijs, product-ID, winkeltoestemming of actuele voorraad nodig.

## Recept bewaren, corrigeren of als variant opslaan

1. Ga naar **Recepten** en voeg handmatig een eigen recept toe, importeer de oorspronkelijke bron via link of plak lokaal rechtmatig verkregen Recipe JSON-LD/HTML.
2. Controleer ingrediënten, porties en bereidingsstappen. Onbekende metrische hoeveelheden worden niet als geldige prijs- of inkoophoeveelheid behandeld.
3. Open daarna je eigen recept. Via **Bewerk mijn recept** kun je meetfouten, titel, porties en bereiding herstellen; **Maak een variant** bewaart een onafhankelijke kopie.
4. Opslaan vereist expliciete gebruikersactie en het normale `saveRecipeLibrary`-revision-contract. Als een ander tabblad intussen de recepten wijzigde, wordt de wijziging geweigerd zonder die ander te overschrijven. Bewerken behoudt de oorspronkelijke recept-ID, zodat bestaande Planner-verwijzingen niet verschuiven; een variant krijgt juist een nieuwe ID. De bijbehorende `supa-recipes-changed`-notificatie werkt de lijst voor Planner bij.

## Echte, ongeprijsde vraag voor dit ene recept

1. Open je eigen recept en vul bij **Mijn boodschappen voor dit recept** tussen 1 en 100 hele porties in.
2. Supa gebruikt uitsluitend de opgeslagen, door de gebruiker bevestigde `g`, `ml` en `stuks` en schaalt de hoeveelheden op basis van oorspronkelijke porties. Identieke ingredienten en eenheden worden samengevoegd.
3. Onbekende/conversie-onzekere ingrediënten en niet-gehele stuks staan als **handmatig controleren** vermeld. Het systeem rondt geen half ei of onzekere verpakking automatisch af.
4. Kies **Boodschappenlijst selecteren** om de tekst handmatig te kopiëren, of **Download ongeprijsde lijst (TXT)** om het lokale tekstbestand te bewaren. Er is geen clipboard-permissie, upload, automatisch fetch-verzoek of cloud-opslag nodig.

Receptvarianten en handmatige hoeveelheden zijn geen bewijs van supermarktvoorraad of besparing. Gebruik voor een echte winkeltotaalvergelijking daarnaast uitsluitend eigen werkelijk waargenomen en toegestane brongegevens in de bestaande `/private-basket-mapping.html` of de Supa-tab Vergelijk. Ontbrekende/verlopen peer-winkelprijzen blijven onbekend, nooit `€0`. Externe PLUS/Deka-rechten, de echte 11×2-opname en veldcodepin blijven onafhankelijk van deze lokale receptenfunctie.
