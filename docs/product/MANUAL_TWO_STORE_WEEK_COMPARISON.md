# Supa: vergelijk hetzelfde geplande mandje met zelf ingevoerde PLUS- en DekaMarkt-prijzen

De tab **Vergelijk** bevat nu een echt werkend lokaal mandje voor de maaltijden en recepten die je in **Planner** selecteert. De eerdere berekening met voorbeeldproducten blijft alleen onder een gesloten, expliciet als voorbeeld gemarkeerd onderdeel beschikbaar.

## Hoe je het gebruikt

1. Kies je dagen en maaltijden in **Planner**. Zelf toegevoegde recepten tellen ook mee wanneer ze geldige ingrediënten/hoeveelheden hebben.
2. Open de nieuwe hoofdtab **Vergelijk**. Supa voegt dezelfde ingrediënten uit de gekozen week samen en maakt voor ieder ingrediënt een regel voor PLUS én DekaMarkt.
3. Voer per winkel de **daadwerkelijk door jou gekozen productnaam**, **inhoud per verpakking** (bijvoorbeeld 500 g, 1 kg, 750 ml, 1 l) en de **door jou vastgelegde prijs per verpakking** in. De rekentool kiest niet zelf een actuele supermarktprijs of alternatieve SKU.
4. Bij iedere ingevulde regel zie je het benodigde *hele aantal verpakkingen* en de prijs per kilogram/liter indien fysiek vergelijkbaar. De formule gebruikt de bestaande `calculateDecimalPackCount` met exacte decimale hoeveelheden.
5. Een volledig mandbedrag en winkelverschil verschijnen **pas als alle ingrediënten bij beide winkels correct ingevuld zijn**. Bij ontbrekende/onbruikbare producten blijft het financiële totaal verborgen. `0,00` is een bewust ingevulde nulprijs; een leeg veld wordt nooit als gratis behandeld.
6. Gebruik **Tabel kopiëren of importeren** om alle PLUS/Deka-regels als tabgescheiden tekst in Excel/Sheets te plakken, daar aan te vullen en vervolgens in Supa terug te plakken. De import controleert de **hele actieve ingrediëntlijst**, twee winkelregels per ingrediënt, geldige eenheden en unieke combinatie van winkel + ingrediënt. Ook deels ingevulde werkbladen blijven deels ingevuld. Het formulier stuurt geen data naar een server.
7. **Wis prijzen** verwijdert uitsluitend de handmatig ingevulde gegevens. Wijzigingen in het daadwerkelijke weekplan of de recept-ingrediënten starten een nieuwe lokale vergelijking, zodat prijzen van een ander mandje niet stilzwijgend gebruikt worden.

## Betrouwbaarheid en privacy

Dit is een **privé, door de gebruiker ingevoerde rekenkundige vergelijking**. Het is **geen extern geverifieerde winkelwaarneming**, bronlicentie, actuele voorraad/aanbieding, geauthenticeerde productgelijkheid of bewezen besparing. De daadwerkelijke PLUS/Deka-bewijzen voor M3 blijven onafhankelijk vereist: [bronrechten #74](https://github.com/Zennay/Supa/issues/74), [identieke menselijke 11×2 veldwaarnemingen #78](https://github.com/Zennay/Supa/issues/78), [veld-codepin #205](https://github.com/Zennay/Supa/issues/205), [permanente VPS-runner #2833](https://github.com/Zennay/Supa/issues/2833). Geen van die gates wordt door deze functie kunstmatig vrijgegeven.

De ingevoerde productgegevens en prijzen staan alleen in de huidige browserstatus; de app bewaart ze niet automatisch in `localStorage`, een server of GitHub. Een zichtbare kopieerbare tabel is de expliciete route om een eigen backup te maken. Door een nieuw weekplan te kiezen wordt een oude vergelijking ongeldig. Er worden **geen retailer-scrapers, externe API's of productreclame** aangeroepen.

## Technische integratie

- `src/domain/manualStoreComparison.ts`: geldige winkelquotes, compatibele fysieke eenheden, exact aantal verpakkingen en beide winkelbedragen; partial results nooit als totale prijs presenteren.
- `src/features/comparison/ManualStoreComparison.tsx`: zelfstandige toegankelijke mobiele invoer, prijs/eenheid, Excel-tab import/export en duidelijke financiële status.
- `src/features/comparison/manualStoreComparison.css`: responsieve kaarten en formulieren.
- `src/App.tsx`: tab **Vergelijk** in hoofdnavigatie; geselecteerde recepten en planner-day selectie als werkelijke bron; oude fictieve vergelijkingsmand alleen in inklapbare demo.

Verifieer de integratie met de bestaande TypeScript/Vite productiebuild en de volledige verplicht gestelde CI op de exacte PR-commit. Een groene CI is geen bewijs van recente externe winkelprijzen.

## Neem per supermarkt een bruikbare lijst mee

Op **Vergelijk** staan onder de invoertabel twee knoppen: **Toon lijst PLUS** en **Toon lijst DekaMarkt**. Zodra alle benodigde producten en de prijs/verpakkingsgrootte voor **één** supermarkt correct zijn ingevuld, wordt de knop voor die winkel actief. De andere supermarkt mag nog onvolledig zijn.

De tekst bevat voor jouw actuele weekkeuzes de daadwerkelijk benodigde **hele verpakkingen**, de door jou gekozen productnamen en de door jou ingevoerde totaalprijs **voor die ene winkel**. Klik in het alleen-lezen tekstvak om de inhoud te selecteren en gebruik de kopieerfunctie van je apparaat. Niets wordt automatisch naar je klembord, cloud of server gestuurd.

Aanpassingen in de huidige invoer werken onmiddellijk door in de lijst. Een wijziging van het weekplan maakt een eerder geopende lijst ongeldig en start een nieuwe lokale berekening. Dit is **geen door de winkel uitgegeven kassabon**, geauthenticeerd bewijs of bevestiging dat het product op voorraad is. Controleer producten en bedragen in de winkel. De algemene winkelprijsvergelijking blijft strengere voorwaarden hanteren: pas wanneer **beide** winkels compleet zijn, toont Supa een onderling rekenkundig prijsverschil.
