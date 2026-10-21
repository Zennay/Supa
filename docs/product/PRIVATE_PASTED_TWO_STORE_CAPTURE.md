# Direct twee supermarktbronbladen plakken — offline voorinzage

Op **Vergelijk → Eigen ingevuld prijsblad eerst controleren** kan de gebruiker nu ook
één of twee originele negenkoloms Supa-bladen rechtstreeks in de twee tekstvakken
plakken. Zowel echte CSV met komma's/puntkomma's als gekopieerde
tab-gescheiden Excel/Calc-kolommen zijn toegestaan zolang het al bestaande
CSV-formaat exact klopt.

**Functioneel verloop:** plak eerst één bron en bekijk die, of plak twee afzonderlijke
PLUS/Deka-bronnen en kies **Controleer beide winkels samen**. De bestaande
`previewFilledCsv`-route voert de echte CSV-converter uit, weigert twee
identieke winkelidentiteiten, onbekende/verlopen/onvolledige invoer, vergelijkt
beide originele opnamemomenten en geeft uitsluitend vrijblijvende conservatieve
SKU-matching voorstellen. Pas het bestaande aparte *bron overnemen*-proces
kan resultaten opnemen; persoonlijke product- en prijsreviews blijven vereist.

**Bronintegriteit:** de volgorde van de twee tekstvakken geeft geen
supermarkt-identiteit; het bronrecord zelf bepaalt die. Er wordt geen bronmoment,
retailervergunning, artikelcode, eenheidsprijs, heel-pak prijs of menselijke
M3-waarneming gegokt. Beide bladen moeten los en volledig geldig zijn voordat
de voorinzage een tweetal toont. Ongeldige invoer behoudt de bestaande actieve
bronopname, afvinkingen en reviewstatus. 256 kB maximaal per bron. De inhoud
blijft lokaal in de browsertab en gaat niet naar de server.

Deze UI is een aanvullende productroute naast bestaande **Bestand kiezen**,
**Sleep bestanden**, handmatige broninvoer en de aparte JSON/CSV-import; er
is geen nieuwe scraper, netwerkverzoek of parser gebouwd.

Geen publieke besparingsclaim zonder geldige bronrechten en werkelijk
waargenomen vergelijkbare manden. Een branch-commit is nog geen release op main.
