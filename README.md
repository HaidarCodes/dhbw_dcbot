# DHBW Discord Bot

Der Bot gleicht Discord-Fachkategorien mit dem Rapla-Stundenplan ab. Als aktive Fächer zählen
nur zukünftige Einträge mit `entityType: "LECTURE"`. `EVENT`- und `BLOCKER`-Einträge erzeugen
keine Kategorien.

## Befehle

| Befehl | Funktion |
| --- | --- |
| `/archive kategorie` | Archiviert eine ausgewählte Kategorie |
| `/archiveall` | Archiviert alle Kategorien, deren Fach nicht mehr in der API vorkommt |
| `/archivepreview` | Zeigt erwartete Fächer, Ausnahmen, gespeicherte und geplante Archivierungen |
| `/archiveexception add kategorie` | Schützt eine Kategorie vor `/archiveall` |
| `/archiveexception remove kategorie` | Entfernt den Schutz |
| `/archiveexception list` | Zeigt alle geschützten Kategorien |
| `/createcourses` | Erstellt fehlende Fachkategorien mit `general` und `bilder` |

Archivieren bedeutet:

- Die Kategorie erhält das Präfix `archived-`.
- Die Kategorie wird unter die aktiven Kategorien verschoben.
- `@everyone` kann die Kategorie und synchronisierte Unterkanäle weiterhin sehen und lesen,
  aber nicht schreiben oder Threads erstellen.
- Unterkanäle werden weder umbenannt noch einzeln verschoben.

Ausnahmen und archivierte Kategorien werden minimal in `data/archive-state.json` gespeichert.
Die Datei wird automatisch erstellt und nicht versioniert.

## Einrichtung

Node.js 18 oder neuer wird benötigt.

```powershell
npm install
Copy-Item .env.sample .env
```

Danach die Werte in `.env` eintragen:

```dotenv
APP_ID=<APPLICATION_ID>
DISCORD_TOKEN=<BOT_TOKEN>
PUBLIC_KEY=<PUBLIC_KEY>
PORT=3000
DISCORD_GUILD_ID=<SERVER_ID>
LECTURES_API_URL=https://api.dhbw.app/rapla/lectures/STG-TINF25F-CS/events
ARCHIVED_PREFIX=archived-
ARCHIVE_STATE_FILE=data/archive-state.json
```

Im Discord Developer Portal unter **Installation**:

- **Guild Install** aktivieren
- Scopes `applications.commands` und `bot` auswählen
- Bot-Rechte **Kanäle verwalten** und **Rollen verwalten** vergeben

Die Verwaltungsbefehle sind absichtlich nur als Server-Installation und nur für Mitglieder
mit **Administrator** verfügbar. Das wird sowohl bei der Command-Registrierung als auch bei
jeder Anfrage geprüft. Eine reine Benutzerinstallation kann keine Server-Kategorien verwalten.

## Start

```powershell
npm run register
npm start
```

`npm run register` veröffentlicht den Bot nicht. Es registriert die Befehle ausschließlich
für den Server aus `DISCORD_GUILD_ID`; der Bot muss dort bereits installiert sein.

Vor `/archiveall` zuerst `/archivepreview` ausführen und allgemeine Kategorien mit
`/archiveexception add` schützen.

## Entwicklung

```powershell
npm run check
npm test
```

Der Workflow `.github/workflows/ci.yml` führt beide Prüfungen bei Pushes und Pull Requests aus.
