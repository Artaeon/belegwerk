#!/usr/bin/env bun
/**
 * kontor — Rechnung und Register für kleine Unternehmen.
 *
 * Ein Ordner ist ein Unternehmen (Mandant): firma.json daneben das
 * Register, darunter die Rechnungen. Kein Server, keine Datenbank,
 * kein Konto — Dateien, die man versteht, und Git als Prüfpfad.
 *
 *   kontor init                     Mandanten-Ordner anlegen
 *   kontor rechnung <datei.json>    Rechnung setzen + eintragen
 *   kontor pruefen                  Registerkette verifizieren
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { eintragen, pruefen, vertraeglich } from './lib/register.mjs';
import { lesen, setzen } from './lib/rechnung.mjs';

const eur = new Intl.NumberFormat('de-AT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const [, , befehl, arg] = process.argv;

/* firma.json wird vom Rechnungs-Ordner aufwärts gesucht — so funktionieren
   Unterordner je Jahr (rechnungen/2026/…), ohne dass man den Mandanten
   benennen muss. */
function firmaFinden(von) {
  let d = resolve(von);
  while (true) {
    const f = join(d, 'firma.json');
    if (existsSync(f)) return { firma: JSON.parse(readFileSync(f, 'utf8')), wurzel: d };
    const oben = dirname(d);
    if (oben === d) return null;
    d = oben;
  }
}

if (befehl === 'init') {
  if (existsSync('firma.json')) {
    console.error('✗ Hier liegt schon eine firma.json — init legt nichts doppelt an.');
    process.exit(1);
  }
  writeFileSync('firma.json', JSON.stringify({
    name: 'Firmenname laut Firmenbuch/GISA',
    adresse: 'Straße Hausnummer, PLZ Ort',
    uid: 'ATU00000000',
    iban: 'AT00 0000 0000 0000 0000',
    bic: '',
    email: '',
    web: '',
    kleinunternehmer: false,
    logoPfad: '',
    stil: { primaer: '#111827', akzent: '#111827' }
  }, null, 2) + '\n');
  mkdirSync('rechnungen', { recursive: true });
  console.log('✓ firma.json und rechnungen/ angelegt.\n  Firmendaten eintragen, dann: kontor rechnung rechnungen/RE-….json');
  process.exit(0);
}

if (befehl === 'pruefen') {
  const fund = firmaFinden('.');
  if (!fund) { console.error('✗ Keine firma.json gefunden — bin ich im Mandanten-Ordner?'); process.exit(1); }
  const { anzahl, fehler } = pruefen(join(fund.wurzel, 'register.csv'));
  if (anzahl === 0 && !fehler.length) { console.log('Kein Register vorhanden — noch keine Rechnung eingetragen.'); process.exit(0); }
  fehler.forEach((f) => console.log(`✗ ${f}`));
  console.log(fehler.length ? `✗ ${fehler.length} Fehler in ${anzahl} Einträgen.` : `✓ Register in Ordnung — ${anzahl} Rechnungen, Kette geschlossen.`);
  process.exit(fehler.length ? 1 : 0);
}

if (befehl === 'rechnung' && arg) {
  const fund = firmaFinden(dirname(arg));
  if (!fund) { console.error('✗ Keine firma.json gefunden — vom Rechnungsordner aufwärts gesucht. Zuerst: kontor init'); process.exit(1); }
  try {
    const r = lesen(arg, fund.firma);
    if (!r.muster) vertraeglich(join(fund.wurzel, 'register.csv'), r.nummer, r.datenhash);
    const pdf = arg.replace(/\.json$/, '.pdf');
    await setzen(r, fund.firma, pdf);
    console.log(`✓ ${pdf} — ${eur.format(r.brutto)} € ${fund.firma.kleinunternehmer ? '' : 'brutto'}`);
    if (r.muster) {
      console.log('○ Muster — nicht ins Register eingetragen.');
    } else {
      const was = eintragen(join(fund.wurzel, 'register.csv'), { nummer: r.nummer, datum: r.datum, brutto: eur.format(r.brutto), datenhash: r.datenhash });
      console.log(was === 'neu' ? `✓ Register: ${r.nummer} eingetragen.` : `○ ${r.nummer} steht bereits unverändert im Register — nur PDF neu gesetzt.`);
    }
  } catch (e) {
    console.error(`✗ ${e.message}`);
    process.exit(1);
  }
  process.exit(0);
}

console.log(`kontor — Rechnung und Register für kleine Unternehmen

  kontor init                     Mandanten-Ordner anlegen (firma.json)
  kontor rechnung <datei.json>    Rechnung setzen + ins Register eintragen
  kontor pruefen                  Registerkette verifizieren

Ein Ordner ist ein Unternehmen. Dateien statt Datenbank, Git als Prüfpfad.`);
