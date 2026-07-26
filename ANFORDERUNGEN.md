# Anforderungsregister — was belegwerk erfüllt und was nicht

Geprüft am 29. Juli 2026 gegen den Stand der österreichischen Rechtslage
(Quellen am Ende). **Dieses Register ist eine sorgfältige fachliche
Einordnung, keine Rechtsberatung** — vor einem Umstieg vom bisherigen Rechnungsprogramm
gehört es einmal mit der Steuerberatung durchgegangen; deren Freigabe
ist der Stichtag, nicht dieses Dokument.

Status: ✓ erfüllt und erzwungen · ● teilweise · ✗ offen · — keine Pflicht

## 1. Rechnungsmerkmale (§ 11 UStG)

| Merkmal | Status | Anmerkung |
|---|---|---|
| Name/Anschrift Aussteller und Empfänger | ✓ | Pflichtfelder, sonst bricht das Werkzeug |
| Fortlaufende Nummer | ✓ | Nummernkreis aus firma.json, vergeben aus dem Register (kein zweiter Zähler); `pruefen` findet Doppel UND Lücken |
| Ausstellungsdatum | ✓ | Pflichtfeld |
| Menge und Bezeichnung der Leistung | ✓ | Positionen mit Text, Menge, Einheit |
| Tag/Zeitraum der Leistung | ✓ | Pflichtfeld `leistungszeitraum` |
| Entgelt nach Steuersätzen aufgeschlüsselt | ✓ | 20/13/10/0 % je Position, getrennte USt-Zeilen |
| Steuerbetrag | ✓ | je Satz berechnet und ausgewiesen |
| UID des Ausstellers | ✓ | erzwungen (außer Kleinunternehmer) |
| UID des Empfängers ab 10.000 € brutto | ✓ | erzwungen |
| Kleinunternehmer-Hinweis (§ 6 Abs 1 Z 27) | ✓ | gesetzt, USt entfällt; Umsatzgrenze (55.000 € seit 2025 — **beim Steuerberater bestätigen**) überwacht belegwerk **nicht** |
| Kleinbetragsrechnung ≤ 400 € | — | Erleichterung, keine Pflicht; belegwerk stellt immer vollständig aus |

**● Sonderfälle mit Hinweispflicht:** Reverse Charge (§ 19) und die
steuerfreie innergemeinschaftliche Lieferung sind abgedeckt —
`steuerregel` auf der Rechnung, Pflicht-UIDs erzwungen, der
vorgeschriebene Hinweis steht auf der Rechnung. Alles Weitere
(Differenzbesteuerung, Dreiecksgeschäft, …) **lehnt belegwerk ausdrücklich
ab**, statt eine Rechnung ohne den nötigen Hinweis auszustellen.
**Storno** ist abgedeckt: eigene Nummer, negierte Beträge, Original
bleibt unangetastet, doppelter Storno wird verweigert.

## 2. Echtheit und Unversehrtheit (§ 11 Abs 2 UStG)

✓ **Übererfüllt.** Das Gesetz verlangt für elektronische Rechnungen
Echtheit der Herkunft und Unversehrtheit des Inhalts; ein
„innerbetriebliches Steuerungsverfahren" genügt, eine Signatur ist NICHT
vorgeschrieben. PDF per E-Mail ist zulässig, die Zustimmung des
Empfängers kann formlos erfolgen. Die SHA-256-Kette im Register plus
Prüfsumme auf der Rechnung geht darüber hinaus.

## 3. E-Rechnung (strukturiert)

| Fall | Pflicht? | belegwerk |
|---|---|---|
| **Bund** (Bundesdienststellen) | Ja, seit 2014: ebInterface oder Peppol BIS über USP / e-rechnung.gv.at | ✗ kein strukturiertes Format. Übergangsweg: die **manuelle Web-Erfassung auf e-rechnung.gv.at** — für gelegentliche Bundesaufträge zulässig und ausreichend |
| **Länder und Gemeinden** | Nein — freiwillig, viele akzeptieren Peppol | — PDF genügt; unsere Gemeinden betrifft keine Pflicht |
| **B2B Inland** | Nein (Stand Juli 2026, anders als Deutschland). Eine nationale Einführung ab ~2027 wird diskutiert, ist aber **nicht beschlossen** — beobachten | — PDF genügt |
| **B2C** (Privatkunden) | Nein — nirgends, auch ViDA betrifft B2C nicht | — Papier oder PDF genügt |
| **Innergemeinschaftlich (ViDA)** | Ab **1. Juli 2030**: strukturierte E-Rechnung (EN 16931) + digitale Meldung | ✗ Roadmap — ebInterface/UBL-Ausgabe ist das wichtigste künftige Feature, wenn EU-Kunden kommen oder Österreich national nachzieht |

## 4. Aufzeichnungen und Aufbewahrung (BAO)

| Anforderung | Status | Anmerkung |
|---|---|---|
| 7 Jahre Aufbewahrung (§ 132) | ● | JSONs, PDFs und Register sind Dateien im Git — die Dauer erledigt Versionierung, aber **nur mit externem Backup** (Remote-Repo). Ein lokaler Ordner allein ist keine Aufbewahrung |
| Ordnungsmäßigkeit (§ 131): chronologisch, vollständig, Änderungen nachvollziehbar | ✓ | „Nie ändern, nur stornieren" + Hash-Kette + Git-Historie entsprechen genau dem Prinzip |
| Einnahmen-Ausgaben-Rechnung (§ 4 Abs 3 EStG) | ✗ | belegwerk führt nur die **Ausgangsseite**. Ausgaben/Belege, Anlagenverzeichnis, E/A-Zusammenstellung fehlen — das bleibt vorerst bei Steuerberatung bzw. bisherigem Weg |

## 5. Registrierkasse (§ 131b BAO, RKSV)

— **Keine Pflicht für belegwerk-Rechnungen**, solange ausschließlich auf
Überweisung fakturiert wird. Aber die Grenze ist schmal und wird oft
falsch verstanden: Als **Barumsatz zählt auch Bankomat-, Kreditkarten-,
Gutschein- und Handy-Zahlung vor Ort**. Schwellen: über 15.000 €
Jahresumsatz UND davon über 7.500 € bar. Sollte belegwerk je „Zahlung vor
Ort" abbilden, ist das ein RKSV-Projekt (signierte Belege,
Manipulationsschutz per Zertifikat) — bewusst außerhalb des Produkts.

## 6. Was klassische Rechnungsprogramme können und belegwerk (noch) nicht

Keine Rechtspflichten, aber der ehrliche Produktvergleich:

- ~~Storno/Gutschrift~~ → `belegwerk storno`, seit v0.2
- ~~Wiederkehrende Rechnungen~~ → `belegwerk wiederkehrend` + Server-Timer, seit v0.2
- ~~Zahlungsstatus und Mahnwesen~~ → `bezahlt` / `offen` / `mahnung`, seit v0.3
  (Mahnstufen mit § 456/458 UGB; Versand bewusst von Hand)
- ~~Export für die Steuerberatung~~ → `belegwerk export` (Jahres-CSV mit Netto/USt/Status), seit v0.8; BMD-Konvention weiterhin offen
- UVA-Zuarbeit (Kennzahlen je Quartal)
- Kundenportal, Online-Zahlung

**Empfehlung deshalb: Parallelbetrieb.** Das bisherige Programm bleibt führend,
belegwerk stellt zunächst einzelne echte Rechnungen parallel aus (gleiche
Nummernlogik, eigenes Register). Umgestellt wird zu einem Stichtag —
Jahreswechsel bietet sich an — und erst, wenn die Steuerberatung die
belegwerk-Ausgabe geprüft und freigegeben hat.

## Fazit

Für den typischen Anwendungsfall — Inlandsrechnungen per Überweisung
an Unternehmen und Gemeinden, Regelbesteuerung — erfüllt
belegwerk die **rechtlichen** Anforderungen an die Rechnungsausstellung;
E-Rechnungspflicht besteht nur gegenüber dem Bund und ist per
Portal-Handeingabe abdeckbar. Was fehlt, ist kein Rechtsproblem, sondern
Produktumfang (Storno, Wiederkehrend, Ausgabenseite, Exporte) — und die
Sonderfall-Hinweise aus Abschnitt 1, sobald der Kundenkreis über den
heutigen hinauswächst.

## Quellen

- USP: E-Rechnung — usp.gv.at/themen/steuern-finanzen/…/e-rechnung.html
- e-rechnung.gv.at, Leitfaden Rechnungsstellung und -einbringung
- WKO: Registrierkassenpflicht für Unternehmen — wko.at
- Brandauer Rechtsanwälte: E-Rechnung Pflicht Österreich 2026
- finanzinfo.at: E-Rechnung Österreich — Pflicht & Formate
- ViDA: Richtlinie (EU) 2025/516, Pflicht ab 1.7.2030 (innergemeinschaftlich)
