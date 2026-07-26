# belegwerk — Marke

Der kuratierte Kern des Brand Kits 2026, versioniert im Repo, damit die
Marke nicht in einem Downloads-Ordner lebt. Das vollständige Kit (alle
PNG-Größen, Marketing-Formate, Story/Cover, editierbare SVG-Quellen,
Desktop-Fonts) liegt separat: `belegwerk-brand-kit/`.

```
logo/       9 SVGs: horizontal/gestapelt/Symbol/Wortmarke, je Farbe/
            monochrom/negativ. Schrift in Pfade umgewandelt — portabel.
github/     README-Banner und Social Preview (Repo-Einstellungen).
produkt/    Rechnungs-Footer-Lockup und Register-Status-Badge — optional.
fonts/      IBM Plex Sans (400/600) und Mono (400) als woff, mit
            OFL-Lizenztext. Quelle für die Standardvorlage.
brand-tokens.json / .css   Farben, Typo, Radius — die eine Quelle.
BELEGWERK-BRAND-GUIDE.md   Das Regelwerk in Langform.
```

## Die Kurzregeln

| | |
|---|---|
| Farben | Belegtinte `#161713` · Archivpapier `#F3F0E8` · Werkorange `#B84B25` (Akzent, nie Fließtext) · Registergrün `#355B4A` (gültiger Zustand) · Graphit `#6C6E68` · Stahl `#D8D5CC` |
| Schrift | IBM Plex Sans (600 Display, 400 Text) · Plex Mono für Befehle, Nummern, Hashes · Plex Serif fürs Editorial |
| Logo | Schutzraum = innere Fuge; Symbol ab 16 px, Horizontal ab 120 px digital; keine Schatten, Verläufe, Rotationen |
| Claim | **Dateien. Belege. Nachweis.** · Kampagne: „Der Schraubenzieher für Rechnungen." |
| Ton | Ruhig, konkret, fachlich ehrlich. Nie: „100 % rechtssicher", „unhackbar", Hype |

## Wichtig: Marke des Werkzeugs, nicht der Rechnungen

Kundendokumente tragen das Branding des **Mandanten** (`vorlage/` im
Mandanten-Ordner), nicht das von belegwerk. Die belegwerk-Marke gehört
auf Repo, Website, CLI und Marketing. Die Standardvorlage
(`vorlagen/standard/`) nutzt die belegwerk-**Designsprache** — Farben,
Plex, Linienführung — aber bewusst ohne belegwerk-Logo: Auf der Rechnung
eines Mandanten hat unser Zeichen nichts verloren.
