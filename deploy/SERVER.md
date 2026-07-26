# kontor auf einem Server betreiben

Der Server-Betrieb ist bewusst **kein Webdienst**: kein Port, keine
Anmeldung, keine Oberfläche — damit auch keine Angriffs- und
DSGVO-Fläche. Auf dem Server heißt kontor: ein privates Git-Repo je
Mandant, ein Timer, der monatlich die wiederkehrenden Rechnungen
ausstellt, und Git als Sicherung. Genau das, was ein nerve-server schon
kann.

## Einrichtung

```bash
# 1) Werkzeug und Mandant auf den Server
git clone <kontor-repo>          /srv/kontor/kontor
git clone <mandanten-repo>       /srv/kontor/stoicera     # firma.json, wiederkehrend/, register.csv
cd /srv/kontor/kontor && bun install

# 2) Probelauf
cd /srv/kontor/stoicera
bun /srv/kontor/kontor/src/kontor.mjs pruefen
```

## Monatlicher Lauf (systemd)

`deploy/kontor-monatlich.service` und `.timer` nach
`/etc/systemd/system/` kopieren, Pfade anpassen, dann:

```bash
systemctl daemon-reload
systemctl enable --now kontor-monatlich.timer
systemctl list-timers kontor-monatlich.timer   # nächster Lauf
```

Der Lauf ist **idempotent**: Eine bereits ausgestellte Monatsrechnung
wird übersprungen — ein doppelt angestoßener Timer erzeugt keine
doppelte Rechnung. Alternativ als Cron:

```
0 6 1 * *  cd /srv/kontor/stoicera && bun /srv/kontor/kontor/src/kontor.mjs wiederkehrend && git add -A && git commit -m "Monatsrechnungen $(date +\%Y-\%m)" && git push
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
0 7 * * 1  cd /srv/kontor/stoicera && bun /srv/kontor/kontor/src/kontor.mjs pruefen || echo "kontor: Registerprüfung fehlgeschlagen" | mail -s "kontor-Warnung" office@…
5 7 * * 1  cd /srv/kontor/stoicera && bun /srv/kontor/kontor/src/kontor.mjs offen | mail -s "kontor: offene Forderungen" office@…
```

Der Bericht kommt per Mail — **gemahnt wird trotzdem von Hand**
(`kontor mahnung <nummer>`): Der Server erinnert den Menschen, nicht
den Kunden.
