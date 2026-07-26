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
import { eintragen, pruefen, vertraeglich, sha } from './lib/register.mjs';
import { lesen, setzen, pdf } from './lib/rechnung.mjs';
import { seite, esc } from './lib/stil.mjs';
import { naechste, luecken } from './lib/nummern.mjs';
import { eur, datumLang, iso, parseBetrag, parseDatum, zielTage, tageZwischen } from './lib/geld.mjs';
import { OK, FEHLT, HINWEIS, WARNUNG, gruen, orange, grau, fett } from './lib/farben.mjs';

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
    console.error(`${FEHLT} Keine firma.json gefunden — bin ich im Mandanten-Ordner? Zuerst: belegwerk init`);
    process.exit(1);
  }
  /* wurzel wandert in die firma: Logo-, Schrift- und Vorlagenpfade lösen
     relativ zum Mandanten auf, egal von wo der Befehl läuft. */
  fund.firma.wurzel = fund.wurzel;
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
  console.log(`${OK} ${pdf} — ${eur.format(r.brutto)} €${r.saetze.size ? ' brutto' : ''}`);
  if (r.muster) {
    console.log(`${HINWEIS} Muster — nicht ins Register eingetragen.`);
    return r;
  }
  const was = eintragen(m.register, { nummer: r.nummer, datum: r.datum, brutto: eur.format(r.brutto), datenhash: r.datenhash });
  console.log(was === 'neu' ? `${OK} Register: ${r.nummer} eingetragen.` : `${HINWEIS} ${r.nummer} steht bereits unverändert im Register — nur PDF neu gesetzt.`);
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
    ? readFileSync(m.register, 'utf8').replace(/\r/g, '').trim().split('\n').slice(1).map((z) => {
        const [nummer, datum, brutto] = z.split(';');
        return { nummer, datum, brutto: parseBetrag(brutto) };
      })
    : [];

/** Offene Forderungen: ausgestellt, positiv, nicht bezahlt, nicht storniert. */
function offene(m) {
  const eingetragen = new Set(registerZeilen(m).map((z) => z.nummer));
  return alleRechnungen(m.wurzel)
    .map((p) => ({ p, r: JSON.parse(readFileSync(p, 'utf8')) }))
    .filter(({ r }) => eingetragen.has(r.nummer) && !r.muster && !r.storniert && !r.bezahltAm && !r.altbestand)
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
  existsSync(pfad) ? readFileSync(pfad, 'utf8').replace(/\r/g, '').trim().split('\n').slice(1).map((z) => z.split(';')) : [];

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
    console.log(`${OK} firma.json, rechnungen/ und wiederkehrend/ angelegt.\n  Firmendaten eintragen, dann: belegwerk rechnung rechnungen/RE-….json`);

  } else if (befehl === 'pruefen') {
    const m = mandant();
    const { anzahl, fehler } = pruefen(m.register);
    if (anzahl === 0 && !fehler.length) {
      console.log('Kein Register vorhanden — noch keine Rechnung eingetragen.');
    } else {
      fehler.forEach((f) => console.log(`${FEHLT} ${f}`));
      const warnungen = luecken(m.register);
      warnungen.forEach((w) => console.log(`${WARNUNG} ${w}`));
      console.log(fehler.length
        ? `${FEHLT} ${fehler.length} Fehler in ${anzahl} Einträgen.`
        : `${OK} Register in Ordnung — ${anzahl} Rechnungen, Kette geschlossen${warnungen.length ? `, aber ${warnungen.length} Nummernlücke(n)` : ', Nummernkreis dicht'}.`);
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
    if (original.r.altbestand) throw new Error(`${arg} ist Altbestand — stornieren im System, das die Rechnung ausgestellt hat.`);

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
    console.log(`${OK} ${original.r.nummer} storniert durch ${nummer}.`);

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
      if (existsSync(datei)) { console.log(`${HINWEIS} ${slug} für ${monat} existiert schon — übersprungen.`); continue; }
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
    console.log(`${OK} ${erzeugt} von ${vorlagen.length} Vorlagen für ${monatsname} ausgestellt.`);

  } else if (befehl === 'export') {
    /* Der Jahresexport für die Steuerberatung: eine CSV mit allem, was
       das Register weiß, angereichert um Netto/USt/Status aus den
       Rechnungs-JSONs. Altbestand (importiert, ohne JSON) steht mit
       seinem Registerstand drin — lieber eine Zeile mit weniger Spalten
       als eine unvollständige Liste. */
    const m = mandant();
    const jahr = arg ?? String(new Date().getFullYear());
    const dateien = new Map(alleRechnungen(m.wurzel)
      .map((p) => JSON.parse(readFileSync(p, 'utf8')))
      .filter((r) => r.nummer)
      .map((r) => [r.nummer, r]));
    const zeilen = registerZeilen(m).filter((z) => {
      try { return String(parseDatum(z.datum).getFullYear()) === String(jahr); } catch { return false; }
    });
    if (!zeilen.length) throw new Error(`Kein Registereintrag für ${jahr}.`);
    let netto = 0, ust = 0, brutto = 0;
    const inhalt = ['nummer;datum;empfaenger;netto;ust;brutto;status'];
    for (const z of zeilen) {
      const r = dateien.get(z.nummer);
      const status = !r || r.altbestand ? 'altbestand' : r.storniert ? `storniert durch ${r.storniert}` : z.brutto < 0 ? 'storno' : r.bezahltAm ? `bezahlt ${r.bezahltAm}` : 'offen';
      let n = '', u = '';
      if (r?.positionen) {
        const nettoWert = r.positionen.reduce((s, p) => s + p.preis * (p.menge ?? 1), 0);
        n = eur.format(nettoWert);
        u = eur.format(z.brutto - nettoWert);
        netto += nettoWert;
        ust += z.brutto - nettoWert;
      }
      brutto += z.brutto;
      /* Altbestand trägt den Empfänger als Text, ausgestellte Rechnungen
         als Objekt — der Export muss beide kennen. Und die CSV landet in
         Excel bei der Steuerberatung: Ein Name, der mit =, +, - oder @
         beginnt, würde dort als FORMEL laufen — der Apostroph davor
         macht ihn wieder zu Text. */
      let empfName = (typeof r?.empfaenger === 'string' ? r.empfaenger : r?.empfaenger?.name ?? '')
        .replaceAll(';', ',').replace(/[\r\n]+/g, ' ');
      if (/^[=+\-@]/.test(empfName)) empfName = `'${empfName}`;
      inhalt.push(`${z.nummer};${z.datum};${empfName};${n};${u};${eur.format(z.brutto)};${status}`);
    }
    inhalt.push(`SUMME;;;${eur.format(netto)};${eur.format(ust)};${eur.format(brutto)};${zeilen.length} Rechnungen`);
    mkdirSync(join(m.wurzel, 'export'), { recursive: true });
    const ziel = join(m.wurzel, 'export', `belegwerk-${jahr}.csv`);
    writeFileSync(ziel, inhalt.join('\n') + '\n');
    console.log(`${OK} ${ziel} — ${zeilen.length} Rechnungen, ${eur.format(brutto)} € brutto.`);

  } else if (befehl === 'import' && arg) {
    /* Altbestand übernehmen — der Umstieg von InvoiceNinja & Co. Die
       alten Rechnungen bleiben im alten System archiviert; das Register
       übernimmt Nummer, Datum, Empfänger und Brutto, damit Nummernkreis
       und Vollständigkeit über den Werkzeugwechsel hinweg stimmen.
       Erwartet CSV mit Kopfzeile: nummer;datum;empfaenger;brutto */
    const m = mandant();
    const zeilen = readFileSync(arg, 'utf8').trim().split('\n');
    if (!/^nummer;datum;empfaenger;brutto$/i.test(zeilen[0]?.trim())) {
      throw new Error('Erwartete Kopfzeile: nummer;datum;empfaenger;brutto — die erste Zeile muss sie wörtlich tragen.');
    }
    let neu = 0, unveraendert = 0;
    mkdirSync(join(m.wurzel, 'rechnungen', 'altbestand'), { recursive: true });
    for (const [i, z] of zeilen.slice(1).entries()) {
      const teile = z.split(';').map((s) => s?.trim());
      if (teile.length !== 4) {
        throw new Error(`Zeile ${i + 2}: ${teile.length} Spalten statt 4 — Strichpunkte im Namen durch Beistriche ersetzen.`);
      }
      const [nummer, datum, empfaenger, bruttoRoh] = teile;
      if (!nummer || !datum || !bruttoRoh) throw new Error(`Zeile ${i + 2} unvollständig: „${z}"`);
      /* Die Nummer wird ein Dateiname — nur Zeichen, die keiner Deutung
         bedürfen. „../" wäre sonst ein Schreibzugriff außerhalb des
         Mandanten. */
      if (!/^[A-Za-z0-9._-]+$/.test(nummer) || nummer.includes('..')) {
        throw new Error(`Zeile ${i + 2}: Nummer „${nummer}" — zulässig sind Buchstaben, Ziffern, Punkt, Bindestrich, Unterstrich.`);
      }
      const brutto = eur.format(parseBetrag(bruttoRoh));
      parseDatum(datum); /* laut scheitern statt still falsch übernehmen */
      /* Der Posten bekommt eine eigene kleine JSON: Ohne sie wüsste der
         Export den Empfänger nicht mehr — der Hash allein liest sich
         nicht zurück. Der erste Export-Test hat genau das gezeigt. */
      const posten = { altbestand: true, nummer, datum, empfaenger, brutto };
      const datenhash = sha(JSON.stringify(posten));
      const was = eintragen(m.register, { nummer, datum, brutto, datenhash });
      writeFileSync(join(m.wurzel, 'rechnungen', 'altbestand', `${nummer}.json`), JSON.stringify(posten, null, 2) + '\n');
      was === 'neu' ? neu++ : unveraendert++;
    }
    console.log(`${OK} Altbestand übernommen: ${neu} neu, ${unveraendert} bereits vorhanden.`);
    console.log(`${HINWEIS} Die Originalbelege bleiben im alten System archiviert (BAO: 7 Jahre) — das Register kennt jetzt ihre Nummern.`);

  } else if (befehl === 'sichern') {
    /* Für Mandanten ohne Git: ein datiertes, vollständiges Archiv an
       einen Ort AUSSERHALB des Mandanten — ein Backup im selben Ordner
       ist keines. Wer Git nutzt, sichert per push; dieses Archiv ist
       der Weg für den USB-Stick und die externe Platte. */
    const m = mandant();
    const ziel = arg ?? join(m.wurzel, '..', 'belegwerk-sicherungen');
    if (resolve(ziel).startsWith(resolve(m.wurzel) + '/')) {
      throw new Error('Das Sicherungsziel liegt IM Mandanten — jede Sicherung würde die vorigen mit einpacken und wachsen. Ziel außerhalb wählen.');
    }
    mkdirSync(ziel, { recursive: true });
    const name = `belegwerk-${m.firma.name.replace(/[^\wäöüÄÖÜß-]+/g, '-').toLowerCase()}-${iso(new Date())}.tar.gz`;
    const archiv = join(ziel, name);
    const p = Bun.spawnSync(['tar', '-czf', archiv, '--exclude', 'node_modules', '--exclude', '.git', '-C', dirname(m.wurzel), m.wurzel.split('/').at(-1)]);
    if (p.exitCode !== 0) throw new Error(`tar fehlgeschlagen: ${p.stderr.toString().trim()}`);
    const probe = Bun.spawnSync(['tar', '-tzf', archiv]);
    const dateien = probe.stdout.toString().trim().split('\n');
    if (!dateien.some((d) => d.endsWith('firma.json'))) throw new Error('Archiv unvollständig — firma.json fehlt. Sicherung gelöscht wäre besser als eine falsche.');
    console.log(`${OK} ${archiv} — ${dateien.length} Dateien, geprüft (firma.json enthalten).`);
    console.log('  Eine Sicherung auf derselben Platte ist keine: Archiv auf ein zweites Medium oder ins Remote.');

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
    console.log(`${OK} ${arg} als bezahlt vermerkt (${wann}).`);

  } else if (befehl === 'offen') {
    const m = mandant();
    const liste = offene(m);
    if (!liste.length) { console.log(`${OK} Keine offenen Forderungen.`); process.exit(0); }
    let summe = 0;
    for (const o of liste) {
      summe += o.brutto;
      const stufe = o.r.mahnungen?.length ? ` · ${o.r.mahnungen.length}. Mahnung am ${o.r.mahnungen.at(-1)}` : '';
      const frist = o.verzug > 0 ? `überfällig seit ${o.verzug} Tagen` : `fällig in ${-o.verzug} Tagen`;
      console.log(`${o.verzug > 0 ? FEHLT : grau('·')} ${o.r.nummer}  ${eur.format(o.brutto).padStart(12)} €  ${o.r.empfaenger.name} — ${frist}${stufe}`);
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
    console.log(`${OK} ${pfad} — ${titel} über ${eur.format(o.brutto)} €, zahlbar bis ${datumLang(frist)}.`);
    console.log('  Versand bleibt Handarbeit — ein Automat mahnt nicht unbeaufsichtigt.');

  } else if (befehl === 'konto' && arg) {
    const m = mandant();
    const betrag = parseBetrag(arg);
    const wann = arg2 ? iso(parseDatum(arg2)) : iso(new Date());
    csvAnhaengen(join(m.wurzel, 'konto.csv'), 'datum;stand', `${wann};${eur.format(betrag)}`);
    console.log(`${OK} Kontostand ${eur.format(betrag)} € zum ${wann} festgehalten.`);

  } else if (befehl === 'ausgabe' && arg && arg2) {
    const m = mandant();
    const betrag = parseBetrag(arg);
    csvAnhaengen(join(m.wurzel, 'ausgaben.csv'), 'datum;betrag;text;kategorie',
      `${iso(new Date())};${eur.format(betrag)};${arg2.replaceAll(';', ',')};${(arg3 ?? '').replaceAll(';', ',')}`);
    console.log(`${OK} Ausgabe ${eur.format(betrag)} € — ${arg2}${arg3 ? ` (${arg3})` : ''}.`);

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
    console.log(`${fett('belegwerk')} — ${orange('Dateien. Belege. Nachweis.')}
Rechnung und Register für kleine Unternehmen.

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
  belegwerk export [jahr]            Jahres-CSV für die Steuerberatung
  belegwerk import <datei.csv>       Altbestand ins Register übernehmen
  belegwerk sichern [zielordner]     Datiertes Archiv des Mandanten (tar.gz)
  belegwerk pruefen                  Registerkette + Nummernkreis verifizieren

Ein Ordner ist ein Unternehmen. Dateien statt Datenbank, Git als Prüfpfad.
Ziele: ziele.json — [{ "text": "Rücklage", "betrag": 10000 }]
Branding: vorlage/stil.css, vorlage/kopf.html, vorlage/fuss.html — dazu
logoPfad, schriftPfad und stil in firma.json. Siehe README.`);
  }
} catch (e) {
  console.error(`${FEHLT} ${e.message}`);
  process.exit(1);
}
