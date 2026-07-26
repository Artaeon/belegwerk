# Testbericht

**Stand: 26. Juli 2026 · Version 0.11.0 · 88 Tests, 228 Assertions, 0 Fehler.**
Dieser Bericht ist ein datierter Schnappschuss — die lebende Wahrheit ist
`bun test`; drift dieser Bericht, gewinnt die Suite.

## Läufe dieses Stands

| Lauf | Ergebnis |
|---|---|
| `bun test` | 88 / 88 grün, 228 Assertions, ~35 s |
| `bun test --coverage` | Bibliotheken 97,2 % Zeilen; nummern/register/stil 100 % |
| `bun run beispiel` | Muster-PDF gesetzt, kein Registereintrag |
| `bun scripts/schaukasten.mjs` | vollständiger Demo-Mandant, Register „Kette geschlossen, Nummernkreis dicht" |

## Was die Suite abdeckt

**Fachlich (§ 11 UStG & Co.):** alle Pflichtangaben einzeln erzwungen
(gesammelt gemeldet, nicht eine pro Lauf) · 10.000-€-UID-Regel auch beim
negativen Storno · Steuersätze 20/13/10/0 getrennt · Reverse Charge und
ig Lieferung mit Pflicht-UIDs und Hinweistexten, unbekannte Regeln
abgelehnt · Kleinunternehmer ohne USt mit § 6-Hinweis · Muster nie im
Register.

**Register:** Hash-Kette über die volle Zeile · manipulierte Spalte,
gelöschte Zeile, doppelte Nummer erkannt · Lücken im Nummernkreis
gemeldet · `nummern.start` · atomare Sperre gegen parallele Läufe,
verwaiste Sperren übernommen · CRLF ist kein Fehlalarm, echte Änderung
weiterhin einer.

**Lebenszyklus:** Rechnung → bezahlt → offen-Liste · Storno mit
Gegenrechnung, Original unangetastet, Doppel-Storno verweigert ·
Mahnung Stufe 1/2, nie vor Fälligkeit, nie für Bezahltes ·
wiederkehrend idempotent, Vorlagen können den Nummernkreis nicht
unterlaufen · Import (Altbestand) idempotent und konfliktgeprüft ·
Export mit Netto/USt/Status/Summen.

**Ausfall:** verpasste Monate nachholen bei dichtem Nummernkreis ·
Absturz zwischen PDF und Registereintrag heilt beim nächsten Lauf ·
Wiederherstellung aus dem `sichern`-Archiv bis zum grünen `pruefen` ·
kaputte firma.json und kaputte Rechnungs-JSONs klar abgelehnt.

**Sicherheit:** HTML-Injection (inkl. Attribut-Ausbruch über
Anführungszeichen) · Excel-Formel-Injection im Export ·
Pfad-Traversal bei Import-Nummern und bei Logo/Schrift-Pfaden ·
CSS-Injection über firma.json-Farben · Feldtrenner in Registerwerten ·
NaN-Beträge · Sicherungsziel im Mandanten · keine Escape-Sequenzen
ohne TTY.

**Onboarding:** `einrichten` legt aus einem leeren Ordner alles an —
Konfiguration aus Antworten, Standardvorlage, Git-Repo, Muster-PDF ohne
Registereintrag · zweiter Lauf verweigert · ohne IBAN Abbruch ·
server-einrichten.sh syntaxgeprüft.

**Branding:** Tokens-Farben und Plex in der Standardvorlage ·
vorlage/-Überschreibungen (CSS, Kopf, Fuß, Platzhalter) bis ins
Dokument · kein belegwerk-Logo auf Mandanten-Dokumenten · Generator
deterministisch.

## Ehrliche Grenzen

- Die Prozentzahlen messen die Bibliotheken. `src/belegwerk.mjs` läuft
  in den End-to-End-Tests als Subprozess — funktional abgedeckt (jeder
  Befehl, jeder bekannte Fehlerweg), statistisch nicht erfasst.
- Ungedeckt in rechnung.mjs: der Puppeteer-Aufruf selbst und ein
  Formatierungszweig — beide laufen in den E2E-Tests mit.
- „Getestet" heißt: jeder bekannte Fall hat einen Testfall. Es heißt
  nicht, dass es keine unbekannten Fehler gibt — wer das verspricht,
  verstößt gegen den eigenen Markenguide („unhackbar" ist verboten).
- Fünf Mal in der Entwicklung schlug ein Test fehl, und fünf Mal lag
  der Test falsch, nicht das Werkzeug — zweimal fand die Suite dabei
  echte Fehler im Werkzeug (verlorener Empfängername im Export,
  ungeschützte Brutto-Spalte in der Kette). Beides steht in der
  Git-Historie.
