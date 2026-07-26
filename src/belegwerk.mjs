#!/usr/bin/env bun
/**
 * belegwerk — Rechnung und Register für kleine Unternehmen.
 *
 * Ein Ordner ist ein Unternehmen (Mandant): firma.json, daneben das
 * Register, darunter die Rechnungen. Kein Server, keine Datenbank,
 * kein Konto — Dateien, die man versteht, und Git als Prüfpfad.
 * Auf einem Server heißt Betrieb: Cron ruft `wiederkehrend`, Git sichert.
 *
 *   belegwerk init                     Mandanten-Ordner anlegen
 *   belegwerk rechnung <datei.json>    Rechnung setzen + eintragen
 *   belegwerk storno <nummer>          Stornorechnung zur Nummer ausstellen
 *   belegwerk wiederkehrend [JJJJ-MM]  Monatsrechnungen aus wiederkehrend/
 *   belegwerk pruefen                  Registerkette + Nummernkreis prüfen
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { eintragen, pruefen, vertraeglich } from './lib/register.mjs';
import { lesen, setzen, pdf } from './lib/rechnung.mjs';
import { seite, esc } from './lib/stil.mjs';
import { naechste, luecken } from './lib/nummern.mjs';
import { eur, datumLang, iso, parseBetrag, parseDatum, zielTage, tageZwischen } from './lib/geld.mjs';

const [, , befehl, arg, arg2, arg3] = process.argv;

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
    console.error('✗ Keine firma.json gefunden — bin ich im Mandanten-Ordner? Zuerst: belegwerk init');
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
      else if (name.endsWith('.json') && name !== 'firma.json' && name !== 'ziele.json') funde.push(p);
    }
  };
  gehe(wurzel);
  return funde;
}

/** Registerzeilen, geparst — die Quelle für alles Summierte. */
const registerZeilen = (m) =>
  existsSync(m.register)
    ? readFileSync(m.register, 'utf8').trim().split('\n').slice(1).map((z) => {
        const [nummer, datum, brutto] = z.split(';');
        return { nummer, datum, brutto: parseBetrag(brutto) };
      })
    : [];

/** Offene Forderungen: ausgestellt, positiv, nicht bezahlt, nicht storniert. */
function offene(m) {
  const eingetragen = new Set(registerZeilen(m).map((z) => z.nummer));
  return alleRechnungen(m.wurzel)
    .map((p) => ({ p, r: JSON.parse(readFileSync(p, 'utf8')) }))
    .filter(({ r }) => eingetragen.has(r.nummer) && !r.muster && !r.storniert && !r.bezahltAm)
    .map(({ p, r }) => {
      const brutto = registerZeilen(m).find((z) => z.nummer === r.nummer).brutto;
      return { p, r, brutto };
    })
    .filter(({ brutto }) => brutto > 0)
    .map(({ p, r, brutto }) => {
      const faellig = parseDatum(r.datum);
      faellig.setDate(faellig.getDate() + zielTage(r.zahlung?.ziel));
      return { p, r, brutto, faellig, verzug: tageZwischen(faellig, new Date()) };
    })
    .sort((a, b) => b.verzug - a.verzug);
}

/** Eine CSV-Zeile anhängen, Kopf beim ersten Mal. */
function csvAnhaengen(pfad, kopf, zeile) {
  if (!existsSync(pfad)) writeFileSync(pfad, kopf + '\n');
  writeFileSync(pfad, readFileSync(pfad, 'utf8') + zeile + '\n');
}

const csvLesen = (pfad) =>
  existsSync(pfad) ? readFileSync(pfad, 'utf8').trim().split('\n').slice(1).map((z) => z.split(';')) : [];

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
    console.log('✓ firma.json, rechnungen/ und wiederkehrend/ angelegt.\n  Firmendaten eintragen, dann: belegwerk rechnung rechnungen/RE-….json');

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

  } else if (befehl === 'bezahlt' && arg) {
    const m = mandant();
    const fund = alleRechnungen(m.wurzel)
      .map((p) => ({ p, r: JSON.parse(readFileSync(p, 'utf8')) }))
      .find(({ r }) => r.nummer === arg && !r.storniert);
    if (!fund) throw new Error(`Keine (nicht stornierte) Rechnung ${arg} gefunden.`);
    if (fund.r.bezahltAm) throw new Error(`${arg} ist schon als bezahlt vermerkt (${fund.r.bezahltAm}).`);
    const wann = arg2 ? iso(parseDatum(arg2)) : iso(new Date());
    /* bezahltAm liegt außerhalb des Datenhashs — der Zahlungsvermerk
       ändert die ausgestellte Rechnung nicht, nur ihren Zustand. */
    writeFileSync(fund.p, JSON.stringify({ ...fund.r, bezahltAm: wann }, null, 2) + '\n');
    console.log(`✓ ${arg} als bezahlt vermerkt (${wann}).`);

  } else if (befehl === 'offen') {
    const m = mandant();
    const liste = offene(m);
    if (!liste.length) { console.log('✓ Keine offenen Forderungen.'); process.exit(0); }
    let summe = 0;
    for (const o of liste) {
      summe += o.brutto;
      const stufe = o.r.mahnungen?.length ? ` · ${o.r.mahnungen.length}. Mahnung am ${o.r.mahnungen.at(-1)}` : '';
      const frist = o.verzug > 0 ? `überfällig seit ${o.verzug} Tagen` : `fällig in ${-o.verzug} Tagen`;
      console.log(`${o.verzug > 0 ? '✗' : '·'} ${o.r.nummer}  ${eur.format(o.brutto).padStart(12)} €  ${o.r.empfaenger.name} — ${frist}${stufe}`);
    }
    console.log(`\n${liste.length} offen, zusammen ${eur.format(summe)} €. Vermerken mit: belegwerk bezahlt <nummer> [datum]`);

  } else if (befehl === 'mahnung' && arg) {
    const m = mandant();
    const o = offene(m).find((o) => o.r.nummer === arg);
    if (!o) throw new Error(`${arg} ist nicht offen — bezahlt, storniert oder nie ausgestellt.`);
    if (o.verzug <= 0) throw new Error(`${arg} ist erst am ${datumLang(o.faellig)} fällig — eine Mahnung vor Fälligkeit ist keine.`);
    const stufe = (o.r.mahnungen?.length ?? 0) + 1;
    const heute = new Date();
    const frist = new Date(heute); frist.setDate(frist.getDate() + (m.firma.mahnfrist ?? 7));
    const titel = stufe === 1 ? 'Zahlungserinnerung' : `${stufe}. Mahnung`;

    const html = seite(m.firma, `${titel} zu ${o.r.nummer}`, `${titel} · ${datumLang(heute)}`, `
<p style="margin:1.4rem 0 1.6rem"><strong>${esc(o.r.empfaenger.name)}</strong><br>${esc(o.r.empfaenger.adresse)}</p>
<h1>${titel}</h1>
<table>
<tr><th>Rechnung</th><td>${esc(o.r.nummer)} vom ${esc(o.r.datum)}</td></tr>
<tr><th>Offener Betrag</th><td><strong>${eur.format(o.brutto)} €</strong></td></tr>
<tr><th>Fällig seit</th><td>${datumLang(o.faellig)} — ${o.verzug} Tage</td></tr>
</table>
<p style="margin-top:1rem">Sehr geehrte Damen und Herren,</p>
<p>${stufe === 1
  ? 'vermutlich ist die Rechnung nur untergegangen — das passiert. Wir ersuchen um Überweisung des offenen Betrags bis zum unten genannten Termin. Sollte die Zahlung bereits unterwegs sein, betrachten Sie dieses Schreiben als gegenstandslos.'
  : 'trotz Erinnerung ist der Betrag weiterhin offen. Wir ersuchen um Überweisung bis zum unten genannten Termin. Ab Verzug gebühren Verzugszinsen von 9,2 Prozentpunkten über dem Basiszinssatz (§ 456 UGB) sowie ein pauschaler Betreibungskostenersatz von 40 € (§ 458 UGB).'}</p>
<table>
<tr><th>Zahlbar bis</th><td><strong>${datumLang(frist)}</strong></td></tr>
<tr><th>IBAN</th><td>${esc(o.r.zahlung?.iban ?? m.firma.iban)} · Verwendungszweck ${esc(o.r.nummer)}</td></tr>
</table>
`);
    const pfad = o.p.replace(/\.json$/, `-mahnung-${stufe}.pdf`);
    await pdf(html, pfad);
    writeFileSync(o.p, JSON.stringify({ ...o.r, mahnungen: [...(o.r.mahnungen ?? []), iso(heute)] }, null, 2) + '\n');
    console.log(`✓ ${pfad} — ${titel} über ${eur.format(o.brutto)} €, zahlbar bis ${datumLang(frist)}.`);
    console.log('  Versand bleibt Handarbeit — ein Automat mahnt nicht unbeaufsichtigt.');

  } else if (befehl === 'konto' && arg) {
    const m = mandant();
    const betrag = parseBetrag(arg);
    const wann = arg2 ? iso(parseDatum(arg2)) : iso(new Date());
    csvAnhaengen(join(m.wurzel, 'konto.csv'), 'datum;stand', `${wann};${eur.format(betrag)}`);
    console.log(`✓ Kontostand ${eur.format(betrag)} € zum ${wann} festgehalten.`);

  } else if (befehl === 'ausgabe' && arg && arg2) {
    const m = mandant();
    const betrag = parseBetrag(arg);
    csvAnhaengen(join(m.wurzel, 'ausgaben.csv'), 'datum;betrag;text;kategorie',
      `${iso(new Date())};${eur.format(betrag)};${arg2.replaceAll(';', ',')};${(arg3 ?? '').replaceAll(';', ',')}`);
    console.log(`✓ Ausgabe ${eur.format(betrag)} € — ${arg2}${arg3 ? ` (${arg3})` : ''}.`);

  } else if (befehl === 'stand') {
    const m = mandant();
    const jahr = String(new Date().getFullYear());
    const konto = csvLesen(join(m.wurzel, 'konto.csv')).at(-1);
    const ausgaben = csvLesen(join(m.wurzel, 'ausgaben.csv')).filter(([d]) => d.startsWith(jahr));
    const ausgabenSumme = ausgaben.reduce((s, z) => s + parseBetrag(z[1]), 0);
    const ausgestellt = registerZeilen(m)
      .filter((z) => { try { return parseDatum(z.datum).getFullYear() === +jahr; } catch { return false; } })
      .reduce((s, z) => s + z.brutto, 0);
    const off = offene(m);
    const offenSumme = off.reduce((s, o) => s + o.brutto, 0);

    console.log(`── ${m.firma.name} · Stand ${iso(new Date())} ${'─'.repeat(20)}`);
    console.log(`Kontostand           ${konto ? `${konto[1].padStart(12)} €  (${konto[0]}, manuell)` : '— nie festgehalten (belegwerk konto <betrag>)'}`);
    console.log(`Offene Forderungen   ${eur.format(offenSumme).padStart(12)} €  (${off.length} Rechnungen${off.filter((o) => o.verzug > 0).length ? `, davon ${off.filter((o) => o.verzug > 0).length} überfällig` : ''})`);
    console.log(`Ausgestellt ${jahr}     ${eur.format(ausgestellt).padStart(12)} €  (Register, inkl. Storni)`);
    console.log(`Ausgaben ${jahr}        ${eur.format(ausgabenSumme).padStart(12)} €  (${ausgaben.length} ${ausgaben.length === 1 ? 'Eintrag' : 'Einträge'}, manuell)`);
    const zielePfad = join(m.wurzel, 'ziele.json');
    if (existsSync(zielePfad) && konto) {
      console.log('── Ziele ' + '─'.repeat(52));
      for (const z of JSON.parse(readFileSync(zielePfad, 'utf8'))) {
        const stand = parseBetrag(konto[1]);
        const anteil = Math.min(100, Math.round((stand / z.betrag) * 100));
        console.log(`${z.text.padEnd(30)} ${eur.format(z.betrag).padStart(12)} €  ${String(anteil).padStart(3)} %`);
      }
    }
    console.log('\nDie Übersicht ist eine Arbeitshilfe, keine Buchhaltung — was zählt, sind Register und Belege.');

  } else {
    console.log(`belegwerk — Rechnung und Register für kleine Unternehmen

  belegwerk init                     Mandanten-Ordner anlegen (firma.json)
  belegwerk rechnung <datei.json>    Rechnung setzen + ins Register eintragen
  belegwerk storno <nummer>          Stornorechnung ausstellen (Original bleibt)
  belegwerk wiederkehrend [JJJJ-MM]  Monatsrechnungen aus wiederkehrend/ erzeugen
  belegwerk bezahlt <nummer> [datum] Zahlungseingang vermerken
  belegwerk offen                    Offene Forderungen mit Fälligkeit
  belegwerk mahnung <nummer>         Zahlungserinnerung/Mahnung als PDF
  belegwerk konto <betrag> [datum]   Kontostand manuell festhalten
  belegwerk ausgabe <betrag> <text> [kategorie]   Ausgabe notieren
  belegwerk stand                    Überblick: Konto, offen, Jahr, Ziele
  belegwerk pruefen                  Registerkette + Nummernkreis verifizieren

Ein Ordner ist ein Unternehmen. Dateien statt Datenbank, Git als Prüfpfad.
Ziele: ziele.json im Mandanten-Ordner — [{ "text": "Rücklage", "betrag": 10000 }]`);
  }
} catch (e) {
  console.error(`✗ ${e.message}`);
  process.exit(1);
}
