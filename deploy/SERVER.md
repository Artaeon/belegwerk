# belegwerk auf einem Server betreiben

Der Server-Betrieb ist bewusst **kein Webdienst**: kein Port, keine
Anmeldung, keine Oberfläche — damit auch keine Angriffs- und
DSGVO-Fläche. Auf dem Server heißt belegwerk: ein privates Git-Repo je
Mandant, ein Timer, der monatlich die wiederkehrenden Rechnungen
ausstellt, und Git als Sicherung. Genau das, was ein nerve-server schon
kann.

## Einrichtung

```bash
# 1) Werkzeug und Mandant auf den Server
git clone <belegwerk-repo>          /srv/belegwerk/belegwerk
git clone <mandanten-repo>       /srv/belegwerk/stoicera     # firma.json, wiederkehrend/, register.csv
cd /srv/belegwerk/belegwerk && bun install

# 2) Probelauf
cd /srv/belegwerk/stoicera
bun /srv/belegwerk/belegwerk/src/belegwerk.mjs pruefen
```

## Monatlicher Lauf (systemd)

`deploy/belegwerk-monatlich.service` und `.timer` nach
`/etc/systemd/system/` kopieren, Pfade anpassen, dann:

```bash
systemctl daemon-reload
systemctl enable --now belegwerk-monatlich.timer
systemctl list-timers belegwerk-monatlich.timer   # nächster Lauf
```

Der Lauf ist **idempotent**: Eine bereits ausgestellte Monatsrechnung
wird übersprungen — ein doppelt angestoßener Timer erzeugt keine
doppelte Rechnung. Alternativ als Cron:

```
0 6 1 * *  cd /srv/belegwerk/stoicera && bun /srv/belegwerk/belegwerk/src/belegwerk.mjs wiederkehrend && git add -A && git commit -m "Monatsrechnungen $(date +\%Y-\%m)" && git push
```

## Sicherung — zwei Wege, mindestens einer Pflicht

1. **Git-Remote (empfohlen):** Der Push im Timer ist die laufende
   Sicherung — privates Remote, SSH, fertig. 7 Jahre Aufbewahrung (BAO)
   erledigt die Historie nebenbei.
2. **`belegwerk sichern [ziel]`:** datiertes tar.gz des ganzen Mandanten,
   selbstprüfend (bricht, wenn firma.json fehlt). Für alle ohne Git und
   für das zweite Medium — eine Sicherung auf derselben Platte ist keine.

```
30 6 * * 0  cd /srv/belegwerk/stoicera && bun /srv/belegwerk/belegwerk/src/belegwerk.mjs sichern /mnt/backup/belegwerk
```

Datenschutz dazu (verschlüsselte Ablage, Rollen nach DSGVO,
Löschfristen): [`../DATENSCHUTZ.md`](../DATENSCHUTZ.md).

## Jahreswechsel

```
0 8 2 1 *  cd /srv/belegwerk/stoicera && bun /srv/belegwerk/belegwerk/src/belegwerk.mjs export $(date -d "last year" +\%Y 2>/dev/null || date -v-1y +\%Y) && git add -A && git commit -m "Jahresexport" && git push
```

Der Export des Vorjahres liegt dann unter `export/` — die CSV, die die
Steuerberatung bekommt.

## Ausfall und Wiederanlauf — durchgespielt, nicht behauptet

Jedes Szenario hier ist ein Testfall in der Suite (`bun test`,
Abschnitt „Ausfall und Wiederanlauf"):

| Szenario | Verhalten |
|---|---|
| Server am Monatsersten aus | `Persistent=true` holt den Timer-Lauf nach; verpasste Monate lassen sich einzeln nachholen (`wiederkehrend 2026-05` …) — Nummern bleiben dicht, `pruefen` bestätigt es |
| Absturz zwischen PDF und Registereintrag | Der nächste Lauf derselben Rechnung heilt: gleiche Daten → Eintrag wird nachgetragen, Kette bleibt geschlossen |
| Zwei Läufe gleichzeitig (Timer + Hand) | `register.csv.lock` sperrt atomar; der zweite Lauf bricht mit klarer Meldung ab. Verwaiste Sperren (> 60 s, Absturz) werden automatisch übernommen |
| Platte weg | Wiederherstellung aus `sichern`-Archiv oder Git-Clone: entpacken, `pruefen` — die Kette beweist, dass der Stand vollständig ist |
| firma.json beschädigt | Klare Ablehnung mit Exit 1, kein stilles Weiterlaufen |

Der Wiederanlauf nach Totalausfall in drei Zeilen:

```bash
tar -xzf belegwerk-firma-JJJJ-MM-TT.tar.gz -C /srv/belegwerk/   # oder: git clone
cd /srv/belegwerk/<mandant>
bun /srv/belegwerk/belegwerk/src/belegwerk.mjs pruefen           # Kette geschlossen? Dann weiter wie vorher.
```

## Was der Server NICHT übernimmt

- **Versand.** Rechnungen verschickt ein Mensch (oder ein bewusst
  gebautes Skript) — ein Automat, der unbeaufsichtigt Rechnungen an
  Kunden mailt, braucht seine eigene Prüfung an der Quelle, bevor es
  ihn gibt.
- **Aufbewahrung allein.** Der Push ins Remote-Repo IST die Sicherung
  (BAO: 7 Jahre). Ein Server ohne Remote ist ein einzelner Ort — und
  ein einzelner Ort ist keine Aufbewahrung.

## Wöchentliche Prüfung und Forderungsbericht (empfohlen)

```
0 7 * * 1  cd /srv/belegwerk/stoicera && bun /srv/belegwerk/belegwerk/src/belegwerk.mjs pruefen || echo "belegwerk: Registerprüfung fehlgeschlagen" | mail -s "belegwerk-Warnung" office@…
5 7 * * 1  cd /srv/belegwerk/stoicera && bun /srv/belegwerk/belegwerk/src/belegwerk.mjs offen | mail -s "belegwerk: offene Forderungen" office@…
```

Der Bericht kommt per Mail — **gemahnt wird trotzdem von Hand**
(`belegwerk mahnung <nummer>`): Der Server erinnert den Menschen, nicht
den Kunden.
