# Standardvorlage

Die belegwerk-Designsprache für Mandanten ohne eigenes Branding:
IBM Plex, Belegtinte auf Papier, Werkorange als Akzent, Registergrün
für die Prüfsumme. **Ohne belegwerk-Logo** — im Kopf steht der Name
oder das Logo des Mandanten.

## Verwenden

```bash
cp vorlagen/standard/stil.css  <mandant>/vorlage/stil.css
```

Optional dazu in der firma.json des Mandanten:

```json
"stil": { "primaer": "#161713", "akzent": "#B84B25" }
```

## Woher sie kommt

`stil.css` ist erzeugt — aus `brand/brand-tokens.json` und den
Plex-Schriften, durch `bun scripts/standard-vorlage.mjs`. Farben ändern
heißt: Tokens ändern, neu erzeugen. Nicht die CSS von Hand anfassen.

Die drei eingebetteten Schriftschnitte (Sans 400/600, Mono 400) machen
die Datei ~330 KB groß und jedes PDF entsprechend schwerer. Das ist der
Preis dafür, dass die Vorlage eine einzige, überall gleiche Datei ist —
wem das zu viel ist, der streicht die @font-face-Blöcke und bekommt
die Systemschrift.
