/**
 * GELD UND DATUM — Parsen und Formatieren, an einem Ort.
 *
 * Beträge stehen im Register deutsch formatiert („5.088,00"), Daten auf
 * Rechnungen als Langform („29. Juli 2026"), in den CSVs als ISO. Wer
 * rechnen will, muss beides zurücklesen können — und zwar überall
 * gleich, nicht mit drei verschiedenen Parsern.
 */
/* BEWUSST NICHT Intl: Was ins Register geschrieben wird, muss auf jeder
   Maschine Byte für Byte gleich aussehen. Intl hängt an der ICU/CLDR-
   Version der Umgebung — neuere CLDR gruppiert de-AT-Tausender mit
   schmalem geschütztem Leerzeichen („1 200,00") statt Punkt. Genau so
   sind in CI neun Tests gefallen, die lokal grün waren: Der Runner
   schrieb andere Beträge ins Register als der Mac. Ein Register, dessen
   Inhalt von der ICU-Version abhängt, ist keines. */
export const eur = {
  format(n) {
    if (!Number.isFinite(n)) throw new Error(`eur.format: „${n}" ist keine Zahl.`);
    const negativ = n < 0;
    const [ganz, dezimal] = Math.abs(n).toFixed(2).split('.');
    return `${negativ ? '-' : ''}${ganz.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${dezimal}`;
  },
};

export const MONATSNAMEN = ['Jänner', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

export const datumLang = (d) => `${d.getDate()}. ${MONATSNAMEN[d.getMonth()]} ${d.getFullYear()}`;

export const monatLang = (jahr, monat1bis12) => `${MONATSNAMEN[monat1bis12 - 1]} ${jahr}`;

export const iso = (d) => d.toISOString().slice(0, 10);

/** „5.088,00" → 5088 · „129,90" → 129.9 · „42" → 42 · auch "-48,00".
 *  Nimmt auch Leerzeichen-Gruppierungen an (inkl. schmalem geschütztem
 *  Leerzeichen) — falls je ein Register von einem älteren, Intl-basierten
 *  Stand gelesen wird. */
export function parseBetrag(s) {
  const n = Number(String(s).trim().replace(/[.\s  ]/g, '').replace(',', '.'));
  if (!Number.isFinite(n)) throw new Error(`„${s}" ist kein Betrag.`);
  return n;
}

const MONATE = ['jänner', 'februar', 'märz', 'april', 'mai', 'juni', 'juli', 'august', 'september', 'oktober', 'november', 'dezember'];

/** Liest „29. Juli 2026", „2026-07-29" oder „29.07.2026". */
export function parseDatum(s) {
  const t = String(s).trim();
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  m = t.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (m) return new Date(+m[3], +m[2] - 1, +m[1]);
  m = t.match(/^(\d{1,2})\.\s*([A-Za-zäöüÄÖÜ]+)\s+(\d{4})$/);
  if (m) {
    const monat = MONATE.indexOf(m[2].toLowerCase().replace('januar', 'jänner'));
    if (monat >= 0) return new Date(+m[3], monat, +m[1]);
  }
  throw new Error(`„${s}" ist kein Datum (erwartet JJJJ-MM-TT, TT.MM.JJJJ oder „29. Juli 2026").`);
}

/** Zahlungsziel in Tagen aus „14 Tagen ab Rechnungsdatum" — die Zahl zählt. */
export const zielTage = (ziel) => parseInt(String(ziel ?? '14').match(/\d+/)?.[0] ?? '14', 10);

export const tageZwischen = (a, b) => Math.floor((b - a) / 86400000);
