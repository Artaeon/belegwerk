# kontor

**Rechnung und Register für kleine Unternehmen.** Ein Ordner ist ein
Unternehmen, eine JSON-Datei ist eine Rechnung, ein Befehl setzt das PDF
und führt das Register. Kein Server, keine Datenbank, kein Konto, kein
Abo — Dateien, die man versteht, und Git als Prüfpfad.

> Arbeitstitel. Vor einem öffentlichen Rollout gilt dasselbe wie beim
> Stoicera-Zeichen: Ähnlichkeits- und Markensuche zuerst.

```
bun install
bun src/kontor.mjs init                      # Mandanten-Ordner anlegen
bun src/kontor.mjs rechnung <datei.json>     # Rechnung setzen + eintragen
bun src/kontor.mjs storno <nummer>           # Stornorechnung (Original bleibt)
bun src/kontor.mjs wiederkehrend [JJJJ-MM]   # Monatsrechnungen aus wiederkehrend/
bun src/kontor.mjs pruefen                   # Registerkette + Nummernkreis prüfen
```

Beispiel ansehen: `bun run beispiel` — setzt `beispiel/rechnungen/RE-2026-000.pdf`
aus dem Beispiel-Mandanten (als Muster gekennzeichnet, ohne Registereintrag).

## Warum es das gibt

Für ein kleines Unternehmen mit einer Handvoll Rechnungen im Monat ist
ein Buchhaltungsprogramm ein Werkzeugkasten, von dem man einen
Schraubenzieher benutzt — dafür zahlt man monatlich, pflegt ein Konto
und gibt seine Belege in eine fremde Datenbank. kontor ist der
Schraubenzieher: Rechnungen ausstellen, korrekt und nachweisbar.

## Wie es arbeitet

**Ein Ordner ist ein Mandant.** `firma.json` hält Name, Adresse, UID,
IBAN, optional Logo und Farben. Daneben `register.csv`, darunter die
Rechnungen — auch in Unterordnern je Jahr; kontor sucht die firma.json
vom Rechnungsordner aufwärts.

**Pflichtangaben sind Felder, keine Konvention.** § 11 UStG verlangt
fortlaufende Nummer, Ausstellungsdatum, Leistungszeitraum, UID des
Ausstellers, ab 10.000 € brutto die UID des Empfängers. Fehlt etwas,
bricht kontor mit der vollständigen Liste — statt still eine
unvollständige Rechnung auszustellen. Steuersätze je Position
(20/13/10 %), Kleinunternehmerregelung (§ 6 Abs 1 Z 27 UStG),
Reverse Charge (§ 19) und die steuerfreie innergemeinschaftliche
Lieferung — jeweils mit dem vorgeschriebenen Hinweis auf der Rechnung.
Unbekannte Steuerregeln lehnt kontor ab, statt den Hinweis wegzulassen.

**Storniert wird, nie geändert.** `kontor storno` stellt eine
Gegenrechnung mit eigener Nummer und negierten Beträgen aus; das
Original bleibt unangetastet in Register und Ablage. Ein zweiter Storno
derselben Rechnung wird verweigert.

**Wiederkehrendes stellt der Server aus.** Vorlagen in `wiederkehrend/`
(ohne Nummer und Datum — die vergibt der Nummernkreis), ein Timer ruft
monatlich `kontor wiederkehrend`. Der Lauf ist idempotent: Was schon
ausgestellt ist, wird übersprungen. Siehe `deploy/SERVER.md`.

**Das Register ist manipulationsevident.** Jede Rechnung steht mit
SHA-256-Prüfsumme im Register; jede Zeile ist mit der vorigen verkettet.
Eine nachträglich geänderte oder gelöschte Zeile bricht die Kette aller
folgenden — `pruefen` findet das. Die Prüfsumme steht auch auf der
Rechnung selbst: PDF und Register belegen einander. Ausgestellte
Rechnungen werden nie geändert; dieselbe Nummer mit anderen Daten wird
verweigert, **bevor** ein PDF entsteht — stornieren und neu ausstellen.

**Aufbewahrung erledigt Git.** Die BAO verlangt sieben Jahre — ein
Mandanten-Ordner unter Git-Versionierung hat die Historie nebenbei, als
zweiten, unabhängigen Prüfpfad neben der Hash-Kette.

## Was es bewusst nicht ist

- **Keine Registrierkasse.** Die RKSV betrifft Barumsätze; kontor stellt
  Rechnungen auf Überweisung aus. Wer bar kassiert, braucht eine
  signaturpflichtige Kasse — das ist ein anderes Produkt.
- **Keine Doppik, kein Jahresabschluss, kein FinanzOnline.** Der
  Steuerberater bekommt lesbare Dateien, keine Schnittstelle — noch.
- **Keine Steuerberatung.** kontor erzwingt die Form, nicht die
  steuerliche Richtigkeit des Inhalts.

## Woher es kommt

Entstanden aus dem Rechnungs-Skript des Stoicera-Branding-Kits;
verallgemeinert: Branding und Firmendaten kommen aus der Konfiguration,
nicht aus dem Code. Erster Mandant ist die Stoicera Group selbst —
das Werkzeug wird zuerst am eigenen Unternehmen bewiesen, wie fleetdeck
und nerve auch.

## Mögliche nächste Schritte

- `kontor einnahmen` — Einnahmenliste aus dem Register je Zeitraum (E/A-Rechnung als Vorstufe)
- Zahlungsstatus (offen/bezahlt) und Zahlungserinnerung
- Belege der Ausgabenseite (`belege/` mit demselben Kettenprinzip)
- Export für die Steuerberatung (CSV nach BMD-Konvention)
- ebInterface/Peppol-Ausgabe (EN 16931) — Pflicht heute nur gegenüber dem
  Bund, ab 2030 innergemeinschaftlich (ViDA); siehe ANFORDERUNGEN.md

## Lizenz

MIT — siehe LICENSE. Open Source, weil das Register nur so viel wert
ist, wie man dem Werkzeug glauben kann, das es führt: Wer prüfen will,
liest den Code.
