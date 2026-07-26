/**
 * DER SATZ — ein sauberes A4-Dokument, ohne fremde Abhängigkeiten.
 *
 * Systemschrift statt eingebetteter Fonts: Das Dokument gehört dem
 * Unternehmen, nicht uns — es soll in dessen Umgebung selbstverständlich
 * aussehen. Farben und Logo kommen aus firma.json; ohne Angaben bleibt
 * das Dokument bewusst unbunt. Ein Rechnungswerkzeug hat keine eigene
 * Marke auf fremden Rechnungen.
 */
import { readFileSync, existsSync } from 'node:fs';
import { extname, join, isAbsolute } from 'node:path';

export const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const MIME = { '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' };

/* Pfade in firma.json sind relativ zum Mandanten-Ordner — nicht zum
   Arbeitsverzeichnis. Sonst findet derselbe Befehl das Logo aus
   rechnungen/2026/ heraus nicht mehr. */
const aufloesen = (firma, pfad) =>
  isAbsolute(pfad) || !firma.wurzel ? pfad : join(firma.wurzel, pfad);

/** Vorlagen-Überschreibung: Der Mandant kann unter vorlage/ eigene
 *  Bausteine ablegen — ein Branding-Kit legt sie dort ab, belegwerk
 *  setzt sie ein. Platzhalter: {{name}}, {{adresse}}, {{uid}}, {{iban}},
 *  {{email}}, {{web}}, {{logo}}, {{meta}}. */
const vorlage = (firma, name) => {
  if (!firma.wurzel) return null;
  const p = join(firma.wurzel, 'vorlage', name);
  return existsSync(p) ? readFileSync(p, 'utf8') : null;
};

const ersetzen = (tpl, werte) =>
  tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => werte[k] ?? '');

export function seite(firma, titel, meta, inhalt) {
  const primaer = firma.stil?.primaer ?? '#111827';
  const akzent = firma.stil?.akzent ?? primaer;
  const logo = firma.logoPfad
    ? `<img src="data:${MIME[extname(firma.logoPfad).toLowerCase()]};base64,${readFileSync(aufloesen(firma, firma.logoPfad)).toString('base64')}" alt="${esc(firma.name)}">`
    : `<span class="firmenname">${esc(firma.name)}</span>`;

  /* Eigene Schrift: eine woff2 je Mandant, eingebettet — das Dokument
     bleibt eigenständig und sieht überall gleich aus. */
  const schrift = firma.schriftPfad
    ? `@font-face{font-family:EigeneSchrift;src:url(data:font/woff2;base64,${readFileSync(aufloesen(firma, firma.schriftPfad)).toString('base64')}) format('woff2');font-weight:100 900}`
    : '';
  const familie = firma.schriftPfad
    ? 'EigeneSchrift,-apple-system,"Segoe UI",Roboto,Arial,sans-serif'
    : '-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif';

  const werte = {
    name: esc(firma.name), adresse: esc(firma.adresse), uid: esc(firma.uid ?? ''),
    iban: esc(firma.iban ?? ''), email: esc(firma.email ?? ''), web: esc(firma.web ?? ''),
    logo, meta,
  };
  const eigenerKopf = vorlage(firma, 'kopf.html');
  const eigenerFuss = vorlage(firma, 'fuss.html');
  const eigenesCss = vorlage(firma, 'stil.css') ?? '';

  return `<!doctype html><html lang="de-AT"><head><meta charset="utf-8">
<title>${esc(titel)}</title>
<style>
${schrift}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:${familie};
  color:#111827;font-size:9.2pt;line-height:1.5;font-variant-numeric:tabular-nums}
@media screen{html{background:#f2f3f5}body{max-width:210mm;margin:2rem auto;padding:16mm 15mm;
  background:#fff;box-shadow:0 1px 14px rgba(0,0,0,.12)}}
.kopf{display:flex;justify-content:space-between;align-items:flex-end;
  border-bottom:2.5px solid ${primaer};padding-bottom:.55rem;position:relative;margin-bottom:1.1rem}
.kopf::after{content:"";position:absolute;left:0;right:0;bottom:-5.5px;height:1.5px;background:${akzent}}
.kopf img{height:34px;width:auto}
.firmenname{font-size:13pt;font-weight:700;letter-spacing:-.015em;color:${primaer}}
.meta{font-size:6.6pt;letter-spacing:.1em;text-transform:uppercase;color:${akzent};font-weight:600}
h1{font-size:22pt;letter-spacing:-.025em;font-weight:600;line-height:1.05;margin:.5rem 0 .35rem;color:${primaer}}
h2{font-size:8pt;letter-spacing:.1em;text-transform:uppercase;color:${akzent};font-weight:600;
  padding-bottom:.35rem;border-bottom:1px solid #e5e7eb;margin:1.5rem 0 .6rem}
p{margin:.55rem 0;max-width:60em}
table{width:100%;border-collapse:collapse}
th{text-align:left;font-weight:400;color:#5b6472;width:12.5em;vertical-align:top;
  padding:.3rem .8rem .3rem 0;border-top:1px solid #e5e7eb;font-size:8.6pt}
td{padding:.3rem 0;border-top:1px solid #e5e7eb;vertical-align:top}
tr:first-child th,tr:first-child td{border-top:none}
.pos{font-size:8.6pt}
.pos th{width:auto;border-top:none;border-bottom:1px solid ${primaer};padding-bottom:.3rem;
  font-size:6.6pt;letter-spacing:.09em;text-transform:uppercase;color:#5b6472}
.pos td{border-top:1px solid #e5e7eb;padding:.35rem .8rem .35rem 0}
.pos .r{text-align:right;white-space:nowrap;padding-right:0}
.pos tr.summe td{border-top:1.5px solid ${primaer};font-weight:600}
.note{border-left:2px solid ${akzent};padding:.15rem 0 .15rem .8rem;color:#374151;margin-top:.7rem}
.mono{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:.92em;word-break:break-all}
footer{margin-top:1.6rem;padding-top:.5rem;border-top:1px solid ${primaer};color:#5b6472;font-size:7.4pt;
  display:flex;flex-wrap:wrap;justify-content:space-between;gap:.3rem 1.6rem}
/* ── vorlage/stil.css des Mandanten — gewinnt durch Reihenfolge ── */
${eigenesCss}
</style></head><body>
${eigenerKopf ? ersetzen(eigenerKopf, werte) : `<div class="kopf">${logo}<span class="meta">${meta}</span></div>`}
${inhalt}
${eigenerFuss ? ersetzen(eigenerFuss, werte) : `<footer>
  <span>${esc(firma.name)} · ${esc(firma.adresse)}</span>
  <span>${firma.uid ? `UID ${esc(firma.uid)}` : ''}</span>
  <span>${esc(firma.email ?? '')}${firma.web ? ` · ${esc(firma.web)}` : ''}</span>
</footer>`}
</body></html>`;
}
