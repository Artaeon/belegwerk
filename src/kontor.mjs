#!/usr/bin/env bun
/**
 * kontor — Rechnung und Register für kleine Unternehmen.
 *
 * Ein Ordner ist ein Unternehmen (Mandant): firma.json, daneben das
 * Register, darunter die Rechnungen. Kein Server, keine Datenbank,
 * kein Konto — Dateien, die man versteht, und Git als Prüfpfad.
 * Auf einem Server heißt Betrieb: Cron ruft `wiederkehrend`, Git sichert.
 *
 *   kontor init                     Mandanten-Ordner anlegen
 *   kontor rechnung <datei.json>    Rechnung setzen + eintragen
 *   kontor storno <nummer>          Stornorechnung zur Nummer ausstellen
 *   kontor wiederkehrend [JJJJ-MM]  Monatsrechnungen aus wiederkehrend/
 *   kontor pruefen                  Registerkette + Nummernkreis prüfen
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { eintragen, pruefen, vertraeglich } from './lib/register.mjs';
import { lesen, setzen } from './lib/rechnung.mjs';
import { naechste, luecken } from './lib/nummern.mjs';

const eur = new Intl.NumberFormat('de-AT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const datumLang = (d) => new Intl.DateTimeFormat('de-AT', { day: 'numeric', month: 'long', year: 'numeric' }).format(d);
const [, , befehl, arg] = process.argv;

/* firma.json wird vom Startpunkt aufwärts gesucht — so funktionieren
   Unterordner je Jahr, ohne dass man den Mandanten benennen muss. */
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

function mandant(von = '.') {
  const fund = firmaFinden(von);
  if (!fund) {
    console.error('✗ Keine firma.json gefunden — bin ich im Mandanten-Ordner? Zuerst: kontor init');
    process.exit(1);
  }
  return { ...fund, register: join(fund.wurzel, 'register.csv') };
}

/** Der eine Weg, auf dem eine Rechnung entsteht: prüfen, gegen das
 *  Register abgleichen, setzen, eintragen. rechnung, storno und
 *  wiederkehrend laufen alle hier durch. */
async function ausstellen(datei, m) {
  const r = lesen(datei, m.firma);
  if (!r.muster) vertraeglich(m.register, r.nummer, r.datenhash);
  const pdf = datei.replace(/\.json$/, '.pdf');
  await setzen(r, m.firma, pdf);
  console.log(`✓ ${pdf} — ${eur.format(r.brutto)} €${r.saetze.size ? ' brutto' : ''}`);
  if (r.muster) {
    console.log('○ Muster — nicht ins Register eingetragen.');
    return r;
  }
  const was = eintragen(m.register, { nummer: r.nummer, datum: r.datum, brutto: eur.format(r.brutto), datenhash: r.datenhash });
  console.log(was === 'neu' ? `✓ Register: ${r.nummer} eingetragen.` : `○ ${r.nummer} steht bereits unverändert im Register — nur PDF neu gesetzt.`);
  return r;
}

/** Alle Rechnungs-JSONs unter einem Ordner (rekursiv, ohne node_modules). */
function alleRechnungen(wurzel) {
  const funde = [];
  const gehe = (d) => {
    for (const name of readdirSync(d)) {
      if (name === 'node_modules' || name.startsWith('.')) continue;
      const p = join(d, name);
      if (statSync(p).isDirectory()) gehe(p);
      else if (name.endsWith('.json') && name !== 'firma.json') funde.push(p);
    }
  };
  gehe(wurzel);
  return funde;
}

try {
  if (befehl === 'init') {
    if (existsSync('firma.json')) throw new Error('Hier liegt schon eine firma.json — init legt nichts doppelt an.');
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
      stil: { primaer: '#111827', akzent: '#111827' },
      nummern: { muster: 'RE-{jahr}-{nr}', breite: 3 }
    }, null, 2) + '\n');
    mkdirSync('rechnungen', { recursive: true });
    mkdirSync('wiederkehrend', { recursive: true });
    console.log('✓ firma.json, rechnungen/ und wiederkehrend/ angelegt.\n  Firmendaten eintragen, dann: kontor rechnung rechnungen/RE-….json');

  } else if (befehl === 'pruefen') {
    const m = mandant();
    const { anzahl, fehler } = pruefen(m.register);
    if (anzahl === 0 && !fehler.length) {
      console.log('Kein Register vorhanden — noch keine Rechnung eingetragen.');
    } else {
      fehler.forEach((f) => console.log(`✗ ${f}`));
      const warnungen = luecken(m.register);
      warnungen.forEach((w) => console.log(`⚠ ${w}`));
      console.log(fehler.length
        ? `✗ ${fehler.length} Fehler in ${anzahl} Einträgen.`
        : `✓ Register in Ordnung — ${anzahl} Rechnungen, Kette geschlossen${warnungen.length ? `, aber ${warnungen.length} Nummernlücke(n)` : ', Nummernkreis dicht'}.`);
      if (fehler.length) process.exit(1);
    }

  } else if (befehl === 'rechnung' && arg) {
    await ausstellen(arg, mandant(dirname(arg)));

  } else if (befehl === 'storno' && arg) {
    const m = mandant();
    const treffer = alleRechnungen(m.wurzel)
      .map((p) => ({ p, r: JSON.parse(readFileSync(p, 'utf8')) }))
      .filter(({ r }) => r.nummer === arg);
    if (!treffer.length) throw new Error(`Keine Rechnung ${arg} gefunden.`);
    const original = treffer.find(({ r }) => !r.storniert);
    if (!original) throw new Error(`${arg} ist bereits storniert (durch ${treffer[0].r.storniert}) — ein zweiter Storno wäre eine doppelte Gegenbuchung.`);
    if (original.r.muster) throw new Error('Ein Muster storniert man nicht — Datei einfach löschen.');

    const heute = new Date();
    const nummer = naechste(m.firma, m.register, heute.getFullYear());
    const storno = {
      nummer,
      datum: datumLang(heute),
      empfaenger: original.r.empfaenger,
      leistungszeitraum: original.r.leistungszeitraum,
      referenz: `Stornorechnung zu ${original.r.nummer} vom ${original.r.datum}`,
      steuerregel: original.r.steuerregel,
      positionen: original.r.positionen.map((p) => ({ ...p, preis: -p.preis })),
      zahlung: original.r.zahlung ?? {},
      hinweis: `Diese Stornorechnung hebt die Rechnung ${original.r.nummer} zur Gänze auf. Bereits geleistete Zahlungen werden rücküberwiesen.`,
    };
    const datei = join(dirname(original.p), `${nummer}.json`);
    writeFileSync(datei, JSON.stringify(storno, null, 2) + '\n');
    await ausstellen(datei, m);
    /* Das Original bleibt unangetastet im Register — der Storno steht als
       eigene, negative Rechnung daneben. Die JSON bekommt nur die
       Querverbindung, damit ein zweiter Storno auffällt. */
    writeFileSync(original.p, JSON.stringify({ ...original.r, storniert: nummer }, null, 2) + '\n');
    console.log(`✓ ${original.r.nummer} storniert durch ${nummer}.`);

  } else if (befehl === 'wiederkehrend') {
    const m = mandant();
    const heute = new Date();
    const monat = arg ?? `${heute.getFullYear()}-${String(heute.getMonth() + 1).padStart(2, '0')}`;
    if (!/^\d{4}-\d{2}$/.test(monat)) throw new Error(`„${monat}" ist kein Monat — erwartet JJJJ-MM.`);
    const [jahr, mm] = monat.split('-').map(Number);
    const monatsname = new Intl.DateTimeFormat('de-AT', { month: 'long', year: 'numeric' }).format(new Date(jahr, mm - 1, 1));

    const ordner = join(m.wurzel, 'wiederkehrend');
    const vorlagen = existsSync(ordner) ? readdirSync(ordner).filter((f) => f.endsWith('.json')) : [];
    if (!vorlagen.length) { console.log('Keine Vorlagen in wiederkehrend/ — nichts zu tun.'); process.exit(0); }

    const ziel = join(m.wurzel, 'rechnungen', String(jahr));
    mkdirSync(ziel, { recursive: true });
    let erzeugt = 0;
    for (const v of vorlagen) {
      const slug = v.replace(/\.json$/, '');
      const datei = join(ziel, `${monat}-${slug}.json`);
      if (existsSync(datei)) { console.log(`○ ${slug} für ${monat} existiert schon — übersprungen.`); continue; }
      const vorlage = JSON.parse(readFileSync(join(ordner, v), 'utf8'));
      /* Die erzeugten Werte gewinnen: Eine Vorlage, die eine eigene
         Nummer mitbringt, würde den Nummernkreis unterlaufen. */
      const r = {
        ...vorlage,
        nummer: naechste(m.firma, m.register, jahr),
        datum: datumLang(heute),
        leistungszeitraum: monatsname,
      };
      writeFileSync(datei, JSON.stringify(r, null, 2) + '\n');
      await ausstellen(datei, m);
      erzeugt++;
    }
    console.log(`✓ ${erzeugt} von ${vorlagen.length} Vorlagen für ${monatsname} ausgestellt.`);

  } else {
    console.log(`kontor — Rechnung und Register für kleine Unternehmen

  kontor init                     Mandanten-Ordner anlegen (firma.json)
  kontor rechnung <datei.json>    Rechnung setzen + ins Register eintragen
  kontor storno <nummer>          Stornorechnung ausstellen (Original bleibt)
  kontor wiederkehrend [JJJJ-MM]  Monatsrechnungen aus wiederkehrend/ erzeugen
  kontor pruefen                  Registerkette + Nummernkreis verifizieren

Ein Ordner ist ein Unternehmen. Dateien statt Datenbank, Git als Prüfpfad.`);
  }
} catch (e) {
  console.error(`✗ ${e.message}`);
  process.exit(1);
}
