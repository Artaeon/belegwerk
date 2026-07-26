/**
 * DER SCHAUKASTEN — jede Funktion einmal, zum Ansehen.
 *
 *     bun scripts/schaukasten.mjs
 *
 * Baut schaukasten/ neu auf: ein vollständiger Demo-Mandant mit allen
 * Rechnungstypen (normal, gemischte Steuersätze, Reverse Charge,
 * ig Lieferung, Kleinunternehmer), Storno, zwei Mahnstufen,
 * Altbestand-Import, Jahresexport, Überblick und geprüftem Register —
 * in der Standardvorlage. Alles erzeugt, nichts von Hand: Wer sehen
 * will, was belegwerk tut, öffnet diesen Ordner.
 */
import { rmSync, mkdirSync, writeFileSync, readFileSync, cpSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const KASTEN = join(REPO, 'schaukasten');
const CLI = join(REPO, 'src', 'belegwerk.mjs');

const lauf = (cwd, ...args) => {
  const p = Bun.spawnSync(['bun', CLI, ...args], { cwd });
  const out = p.stdout.toString() + p.stderr.toString();
  if (p.exitCode !== 0 && !args.includes('ERWARTET-FEHLER')) {
    console.error(`✗ belegwerk ${args.join(' ')}\n${out}`);
    process.exit(1);
  }
  return out;
};

rmSync(KASTEN, { recursive: true, force: true });
mkdirSync(KASTEN, { recursive: true });

/* ── Der Mandant: fiktive Firma, Standardvorlage, Nummernstart 100 ── */
const M = join(KASTEN, 'mandant');
mkdirSync(M);
writeFileSync(join(M, 'firma.json'), JSON.stringify({
  name: 'Schauwerk & Partner OG',
  adresse: 'Musterallee 12, 4020 Linz',
  uid: 'ATU12345678',
  iban: 'AT12 3456 7890 1234 5678',
  email: 'office@schauwerk.example',
  web: 'schauwerk.example',
  kleinunternehmer: false,
  nummern: { muster: 'RE-{jahr}-{nr}', breite: 3, start: 100 },
  stil: { primaer: '#161713', akzent: '#B84B25' },
}, null, 2));
mkdirSync(join(M, 'rechnungen'));
mkdirSync(join(M, 'wiederkehrend'));
mkdirSync(join(M, 'vorlage'));
cpSync(join(REPO, 'vorlagen/standard/stil.css'), join(M, 'vorlage/stil.css'));

const rechnung = (name, inhalt) => {
  writeFileSync(join(M, 'rechnungen', name), JSON.stringify(inhalt, null, 2) + '\n');
  console.log(lauf(M, 'rechnung', `rechnungen/${name}`).trim().split('\n')[0]);
};

/* ── 0) Altbestand: der Umstieg vom Vorsystem ── */
writeFileSync(join(M, 'altbestand.csv'),
  'nummer;datum;empfaenger;brutto\n' +
  'RE-2026-098;2026-02-10;Bäckerei Ofner GmbH;2.640,00\n' +
  'RE-2026-099;2026-03-05;Gemeinde Musterhausen;1.188,00\n');
console.log(lauf(M, 'import', 'altbestand.csv').trim().split('\n')[0]);

/* ── 1) Die normale Rechnung ── */
rechnung('RE-2026-100.json', {
  nummer: 'RE-2026-100', datum: '2026-04-14',
  empfaenger: { name: 'Gemeinde Musterhausen', adresse: 'Hauptplatz 1, 4321 Musterhausen' },
  leistungszeitraum: 'März 2026',
  referenz: 'Werkvertrag vom 2. Februar 2026 · Angebot A-2026-007',
  positionen: [
    { text: 'Gemeinde-Website — Schlussrechnung nach Abnahme', beschreibung: '50 % laut Werkvertrag; Abnahmeprotokoll vom 10. April 2026', preis: 6400 },
  ],
});

/* ── 2) Gemischte Steuersätze ── */
rechnung('RE-2026-101.json', {
  nummer: 'RE-2026-101', datum: '2026-05-02',
  empfaenger: { name: 'Buchhandlung Seitenweise e.U.', adresse: 'Lesegasse 3, 1070 Wien' },
  leistungszeitraum: 'April 2026',
  positionen: [
    { text: 'Webshop-Wartung April', preis: 480 },
    { text: 'Fachbücher zur Einschulung', beschreibung: 'ermäßigter Steuersatz', menge: 3, einheit: 'Stück', preis: 29, ustSatz: 10 },
  ],
});

/* ── 3) Reverse Charge (B2B Deutschland) ── */
rechnung('RE-2026-102.json', {
  nummer: 'RE-2026-102', datum: '2026-05-20',
  empfaenger: { name: 'Beispielwerk GmbH', adresse: 'Maximilianstraße 8, 80539 München, Deutschland', uid: 'DE129273398' },
  leistungszeitraum: 'Mai 2026',
  steuerregel: 'reverse-charge',
  positionen: [{ text: 'Softwareentwicklung Schnittstellenmodul', preis: 5200 }],
});

/* ── 4) Steuerfreie ig Lieferung (CZ) ── */
rechnung('RE-2026-103.json', {
  nummer: 'RE-2026-103', datum: '2026-06-03',
  empfaenger: { name: 'Vzorek s.r.o.', adresse: 'Lannova 2, 370 01 České Budějovice, Tschechien', uid: 'CZ25166115' },
  leistungszeitraum: '3. Juni 2026',
  steuerregel: 'igl',
  positionen: [{ text: 'Hardware-Lieferung Terminals', menge: 4, einheit: 'Stück', preis: 390 }],
});

/* ── 5) Wiederkehrend: der monatliche Betrieb (zwei Monate) ── */
writeFileSync(join(M, 'wiederkehrend', 'betrieb-musterhausen.json'), JSON.stringify({
  empfaenger: { name: 'Gemeinde Musterhausen', adresse: 'Hauptplatz 1, 4321 Musterhausen' },
  referenz: 'Betriebs- und Wartungsvereinbarung vom 10. April 2026',
  positionen: [{ text: 'Betrieb und Wartung Gemeinde-Website', beschreibung: 'monatlich im Voraus laut Vereinbarung', preis: 60 }],
}, null, 2));
console.log(lauf(M, 'wiederkehrend', '2026-06').trim().split('\n').at(-1));
console.log(lauf(M, 'wiederkehrend', '2026-07').trim().split('\n').at(-1));

/* ── 6) Storno: die gemischte Rechnung wird aufgehoben ── */
console.log(lauf(M, 'storno', 'RE-2026-101').trim().split('\n').at(-1));

/* ── 7) Zahlungen und Mahnwesen ── */
console.log(lauf(M, 'bezahlt', 'RE-2026-100', '2026-04-25').trim());
console.log(lauf(M, 'mahnung', 'RE-2026-102').trim().split('\n')[0]);
console.log(lauf(M, 'mahnung', 'RE-2026-102').trim().split('\n')[0]);

/* ── 8) Überblick: Konto, Ausgaben, Ziele ── */
lauf(M, 'konto', '24.180,50');
lauf(M, 'ausgabe', '238,80', 'Server und Domains Q2', 'infrastruktur');
lauf(M, 'ausgabe', '890,00', 'Notebook Ersatz', 'hardware');
writeFileSync(join(M, 'ziele.json'), JSON.stringify([
  { text: 'Rücklage Betriebsjahr', betrag: 30000 },
  { text: 'Neues Arbeitsgerät', betrag: 2500 },
], null, 2));

/* ── 9) Export, Prüfung, Ausgaben festhalten ── */
console.log(lauf(M, 'export', '2026').trim());
writeFileSync(join(KASTEN, 'stand.txt'), lauf(M, 'stand'));
writeFileSync(join(KASTEN, 'offene-forderungen.txt'), lauf(M, 'offen'));
writeFileSync(join(KASTEN, 'pruefung.txt'), lauf(M, 'pruefen'));
console.log(lauf(M, 'sichern', join(KASTEN, 'sicherung')).trim().split('\n')[0]);

/* ── 10) Der Kleinunternehmer — eigener Mini-Mandant ── */
const K = join(KASTEN, 'mandant-kleinunternehmer');
mkdirSync(join(K, 'rechnungen'), { recursive: true });
writeFileSync(join(K, 'firma.json'), JSON.stringify({
  name: 'Einzelunternehmen Klein', adresse: 'Dorfstraße 4, 8010 Graz',
  iban: 'AT98 7654 3210 9876 5432', kleinunternehmer: true,
}, null, 2));
writeFileSync(join(K, 'rechnungen', 'RE-2026-001.json'), JSON.stringify({
  nummer: 'RE-2026-001', datum: '2026-07-01',
  empfaenger: { name: 'Nachbarschaftsverein Graz', adresse: 'Vereinsweg 9, 8010 Graz' },
  leistungszeitraum: 'Juni 2026',
  positionen: [{ text: 'Vereinswebsite Einrichtung', preis: 900 }],
}, null, 2));
console.log(lauf(K, 'rechnung', 'rechnungen/RE-2026-001.json').trim().split('\n')[0]);

console.log(`\n✓ Schaukasten steht: ${KASTEN}`);
console.log('  mandant/rechnungen/       alle Rechnungstypen als PDF');
console.log('  mandant/export/           Jahres-CSV für die Steuerberatung');
console.log('  stand.txt · offene-forderungen.txt · pruefung.txt');
console.log('  sicherung/                das geprüfte tar.gz');
