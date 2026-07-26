# Datenschutz — was belegwerk mit Daten macht (und was nicht)

Stand 30. Juli 2026. Sorgfältige fachliche Einordnung, keine
Rechtsberatung.

## Das Grundprinzip

belegwerk verarbeitet Rechnungsdaten **ausschließlich lokal**, im
Mandanten-Ordner. Es gibt:

- **keine Telemetrie** — belegwerk funkt nicht nach Hause
- **keine Cloud** — kein Konto, kein fremder Server, keine fremde Datenbank
- **keine Netzanfragen beim Setzen** — das PDF entsteht aus lokalem HTML
  mit eingebetteten Schriften und Logos; der headless-Browser lädt nichts
  von außen
- **keinen automatischen Versand** — Rechnungen und Mahnungen verschickt
  ein Mensch

Wer Daten wohin gibt, entscheidet allein der Mandant: Ein `git push`
geht dorthin, wohin der Mandant sein Remote gelegt hat — nirgendwohin
sonst.

## Rollen nach DSGVO

Empfängerdaten auf Rechnungen (Name, Adresse, UID) sind personenbezogene
Daten, soweit natürliche Personen betroffen sind. **Verantwortlicher ist
das Unternehmen, das belegwerk einsetzt** — belegwerk ist ein lokales
Werkzeug wie ein Textprogramm, kein Auftragsverarbeiter. Ein AVV mit
„belegwerk" ist daher weder möglich noch nötig. Betreibt ein Dritter den
Server für den Mandanten, ist DER der Auftragsverarbeiter — dann braucht
es den AVV mit dem Serverbetreiber.

## Speicherdauer und Löschung

Rechnungen unterliegen der 7-jährigen Aufbewahrung (§ 132 BAO). Das ist
zugleich die DSGVO-Antwort auf Löschbegehren für Rechnungsdaten:
Art. 17 Abs 3 lit b DSGVO nimmt Daten aus, deren Speicherung eine
rechtliche Pflicht verlangt. **Nach Ablauf der Frist ist Löschen
Handarbeit und Verantwortung des Mandanten** — belegwerk löscht nie von
selbst. Vorsicht bei Git: Ein `rm` löscht nicht die Historie; wer nach
Fristablauf wirklich löschen will, muss das Repo bereinigen oder je
Aufbewahrungszeitraum ein eigenes Repo führen.

## Empfehlungen für den Serverbetrieb

- **Privates Repo, Zugriff minimal** — das Remote enthält Kundendaten
- **Transport verschlüsselt** — SSH für Git, sonst nichts offen
- **Platte verschlüsselt** (LUKS/FileVault) — Rechnungsdaten „at rest"
- **Sicherungen wie Originale behandeln**: `belegwerk sichern` erzeugt
  ein unverschlüsseltes Archiv — auf verschlüsselte Medien legen oder
  mit `age`/GPG nachverschlüsseln
- **Kein Webdienst, kein offener Port** — die Architektur ist die
  Schutzmaßnahme; siehe deploy/SERVER.md
