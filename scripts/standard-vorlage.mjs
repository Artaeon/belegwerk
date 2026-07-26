/**
 * STANDARDVORLAGE — die belegwerk-Designsprache für Mandanten ohne
 * eigenes Branding.
 *
 *     bun scripts/standard-vorlage.mjs
 *
 * Erzeugt vorlagen/standard/stil.css aus brand/brand-tokens.json und
 * den Plex-Schriften — Farben und Typo haben genau eine Quelle, die
 * Vorlage wird daraus gebaut statt daneben gepflegt. Die Schriften
 * werden als base64 eingebettet, damit die Vorlage eine einzige Datei
 * bleibt, die man in jeden Mandanten kopieren kann.
 *
 * Bewusst OHNE belegwerk-Logo: Auf der Rechnung eines Mandanten steht
 * dessen Name oder Logo — unsere Marke gehört aufs Werkzeug, nicht auf
 * fremde Dokumente.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const tokens = JSON.parse(readFileSync(join(REPO, 'brand/brand-tokens.json'), 'utf8'));
const f = (name) => readFileSync(join(REPO, 'brand/fonts', name)).toString('base64');

const c = Object.fromEntries(Object.entries(tokens.colors).map(([k, v]) => [k, v.hex]));

const css = `/* belegwerk-Standardvorlage — erzeugt aus brand/brand-tokens.json
   (Version ${tokens.version}) durch scripts/standard-vorlage.mjs.
   Nicht von Hand ändern: Wer Farben will, ändert die Tokens und
   erzeugt neu. In den Mandanten-Ordner kopieren als vorlage/stil.css. */

@font-face{font-family:"IBM Plex Sans";font-weight:400;
  src:url(data:font/woff;base64,${f('IBMPlexSans-Regular.woff')}) format('woff')}
@font-face{font-family:"IBM Plex Sans";font-weight:600;
  src:url(data:font/woff;base64,${f('IBMPlexSans-SemiBold.woff')}) format('woff')}
@font-face{font-family:"IBM Plex Mono";font-weight:400;
  src:url(data:font/woff;base64,${f('IBMPlexMono-Regular.woff')}) format('woff')}

/* ── Grundstimmung: Tinte auf Papier ── */
body{font-family:"IBM Plex Sans",-apple-system,sans-serif;color:${c.belegtinte}}
@media screen{html{background:${c.archivpapier}}}

/* ── Kopf: Belegtinte trägt, Werkorange markiert die Herkunft ── */
.kopf{border-bottom-color:${c.belegtinte}}
.kopf::after{background:${c.werkorange}}
.firmenname{color:${c.belegtinte};font-weight:600}
.meta{font-family:"IBM Plex Mono",ui-monospace,monospace;color:${c.werkorange};font-weight:400}

/* ── Titel und Labels ── */
h1{color:${c.belegtinte};font-weight:600}
h2{font-family:"IBM Plex Mono",ui-monospace,monospace;color:${c.werkorange};
  font-weight:400;border-bottom-color:${c.stahl}}

/* ── Tabellen: Stahl-Linien, Graphit-Nebentext, Mono-Ziffern ── */
th{color:${c.graphit};border-top-color:${c.stahl}}
td{border-top-color:${c.stahl}}
.pos th{color:${c.graphit};border-bottom-color:${c.belegtinte}}
.pos td{border-top-color:${c.stahl}}
.pos .r{font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:.95em}
.pos tr.summe td{border-top-color:${c.belegtinte}}

/* ── Die Prüfsumme ist der Registerzustand: Registergrün ── */
.note{border-left-color:${c.registergruen};background:${c.archivpapier};
  padding-top:.45rem;padding-bottom:.45rem;padding-right:.8rem}
.mono{font-family:"IBM Plex Mono",ui-monospace,monospace}

/* ── Fuß ── */
footer{border-top-color:${c.belegtinte};color:${c.graphit}}
`;

mkdirSync(join(REPO, 'vorlagen/standard'), { recursive: true });
writeFileSync(join(REPO, 'vorlagen/standard/stil.css'), css);
console.log(`✓ vorlagen/standard/stil.css — ${Math.round(css.length / 1024)} KB (drei Plex-Schnitte eingebettet)`);
