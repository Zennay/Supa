# Planner · lokaal weekmenu downloaden en agenda vullen

De bestaande productimplementatie van [PR #3917](https://github.com/Zennay/Supa/pull/3917)
is in de huidige Supa productintegratie opgenomen zonder de originele
ownerbranch te herschrijven. Het gaat uitsluitend om bestaande broncode
van de WeekShareManualCopy, downloadWeekMenuText, selectWeekMenuText,
downloadWeekMenuCalendar, weekPlanShare en plannerStorageGuard, plus
de benodigde mobiele agendastijl.

Onder **Planner → weekmenu delen** blijft kopiëren een handmatige actie.
De gebruiker kan vanaf een werkelijk op het scherm getoonde en
onveranderde weekmenu-preview nu een privé-UTF-8 .txt downloaden.
Voor een .ics-agenda-export moet de gebruiker zelf expliciet de
juiste maandag in de kalender kiezen; dat zijn hele-dag-afspraken
die niet naar een kalenderdienst worden geüpload. Dit ondersteunt
de normale Nederlandse weekdagen (Ma tot en met Zo). Afwijkende
Planner-dagnamen, foutieve datum, verouderde preview, onzichtbare
tekststuring of browserweigering leiden tot een eerlijke weigering.

Het weekmenu wordt nu maandag→zondag gepresenteerd ongeacht de
opslag-/invoer-volgorde, met bestaande originele recepttitels.
Een vorige andere browsertab die een geldig weekmenu expliciet
heeft gewist kan geen oud menu meer stil opnieuw aanmaken; een
expliciet verwijderde onleesbare/toekomstige record blijft wel
langs de bestaande bewuste herstelroute te corrigeren. Weekbudget
is uitsluitend een eigen voorkeur; geen retailerprijs of winstclaim.
De bestaande gebruikersactie en veilige bronprivacy blijven intact.
