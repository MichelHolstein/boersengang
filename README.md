# Börsenradar

Private Website mit einem Marktüberblick zum Aktienmarkt und Long-, Short- oder Neutral-Einschätzungen zu einzelnen Aktien. Ein neuer Bericht erscheint etwa alle drei Tage.

**Keine Anlageberatung.** Die Seite ordnet öffentliche Nachrichten nach einem festen Punkteraster ein. Sie ist passwortgeschützt und nur für den privaten Gebrauch bestimmt.

## Wie der Passwortschutz funktioniert

- Die Berichte liegen nur verschlüsselt im Repository (`data/reports/*.json.enc`).
- Jeder Bericht wird mit einem eigenen AES-256-GCM-Schlüssel verschlüsselt, der wiederum mit dem öffentlichen RSA-Schlüssel aus `data/keyring.json` verschlüsselt ist.
- Der private RSA-Schlüssel liegt ebenfalls in `data/keyring.json`, aber mit dem Passwort verschlüsselt (PBKDF2 mit 600.000 Runden, dann AES-GCM).
- Die Seite entschlüsselt alles im Browser. Das Passwort verlässt den Browser nie.
- Die automatische Aktualisierung braucht nur den öffentlichen Schlüssel und kennt das Passwort nicht.

Wie sicher das ist, hängt vom Passwort ab: Ein kurzes oder leicht zu erratendes Passwort lässt sich mit genug Rechenzeit knacken, weil die verschlüsselten Daten öffentlich auf GitHub liegen.

## Neuen Bericht hinzufügen

```bash
# Klartext-Bericht außerhalb des Repositorys ablegen, z. B. /tmp/2026-11-24.json
node tools/encrypt-report.mjs /tmp/2026-11-24.json
git add data && git commit -m "Bericht 2026-11-24" && git push
```

Das Skript prüft den Bericht (Datumsformat, Punkte von -2 bis +2, Signal passend zur Summe, https-Quellen) und bricht bei Fehlern ab. Es behält höchstens 60 Berichte.

## Passwort ändern

```bash
BOERSENRADAR_PASSWORD='neues Passwort' node tools/setup-keyring.mjs
```

Achtung: Das erzeugt ein neues Schlüsselpaar. Alte Berichte sind danach nicht mehr lesbar und müssen aus den Klartextdateien neu verschlüsselt werden.

## Punkteraster

Sechs Kategorien mit je -2 bis +2 Punkten: Ereignisse (doppelt gewichtet), Analysten, Trend und Momentum, Positionierung, Qualität und Bilanz, Bewertung. Long ab +4, Short-Kandidat ab -4, sonst Neutral. Bei roter Marktampel gilt Long erst ab +5, bei grüner Short erst ab -5.

## Vorlage

`tools/report-template.json` zeigt alle Felder eines Berichts. Die echten Berichte liegen nur verschlüsselt in `data/reports/`.
