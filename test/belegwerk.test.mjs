/**
 * DIE SUITE — Unit-Tests der Bibliotheken plus End-to-End über die CLI.
 *
 *     bun test
 *
 * Die End-to-End-Tests laufen in einem Wegwerf-Mandanten und decken
 * bewusst auch die Fehlerwege ab: Ein Werkzeug, das Rechnungen führt,
 * wird an dem gemessen, was es VERWEIGERT.
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync, utimesSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { parseBetrag, parseDatum, zielTage, eur, datumLang, monatLang } from '../src/lib/geld.mjs';
import { naechste, luecken } from '../src/lib/nummern.mjs';
import { eintragen, pruefen, vertraeglich } from '../src/lib/register.mjs';
import { lesen, htmlRechnung } from '../src/lib/rechnung.mjs';

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'belegwerk.mjs');

/* ══ geld.mjs — Parser ═══════════════════════════════════════════════ */

describe('geld: deterministische Formatierung — auf jeder Maschine gleich', () => {
  /* Der CI-Vorfall dahinter: Intl formatierte de-AT auf dem Linux-Runner
     mit schmalem geschütztem Leerzeichen statt Punkt — neun Tests fielen,
     die lokal grün waren. Ein Register darf nicht von der ICU-Version
     abhängen; diese Kanarien halten das fest. */
  test('Tausenderpunkt, Komma, zwei Dezimalen', () => {
    expect(eur.format(1234567.891)).toBe('1.234.567,89');
    expect(eur.format(1200)).toBe('1.200,00');
    expect(eur.format(-48)).toBe('-48,00');
    expect(eur.format(0)).toBe('0,00');
  });
  test('kein NaN durch die Hintertür', () => expect(() => eur.format(NaN)).toThrow('keine Zahl'));
  test('deutsche Datums-Langform ohne Intl', () => {
    expect(datumLang(new Date(2026, 0, 1))).toBe('1. Jänner 2026');
    expect(datumLang(new Date(2026, 6, 27))).toBe('27. Juli 2026');
    expect(monatLang(2026, 8)).toBe('August 2026');
  });
  test('parseBetrag liest auch Leerzeichen-Gruppierung (alte Intl-Register)', () => {
    expect(parseBetrag('1 200,00')).toBe(1200);
    expect(parseBetrag('1 200,00')).toBe(1200);
  });
});

describe('geld: parseBetrag', () => {
  test('deutsches Format mit Tausenderpunkt', () => expect(parseBetrag('5.088,00')).toBe(5088));
  test('Komma-Dezimale', () => expect(parseBetrag('129,90')).toBe(129.9));
  test('ganze Zahl', () => expect(parseBetrag('42')).toBe(42));
  test('negativ (Storno)', () => expect(parseBetrag('-48,00')).toBe(-48));
  test('Unsinn wirft', () => expect(() => parseBetrag('viel')).toThrow('kein Betrag'));
});

describe('geld: parseDatum', () => {
  test('ISO', () => expect(parseDatum('2026-07-29').getMonth()).toBe(6));
  test('TT.MM.JJJJ', () => expect(parseDatum('29.07.2026').getDate()).toBe(29));
  test('deutsche Langform', () => expect(parseDatum('29. Juli 2026').getFullYear()).toBe(2026));
  test('Jänner wie Januar', () => {
    expect(parseDatum('1. Jänner 2026').getMonth()).toBe(0);
    expect(parseDatum('1. Januar 2026').getMonth()).toBe(0);
  });
  test('Unsinn wirft', () => expect(() => parseDatum('irgendwann')).toThrow('kein Datum'));
});

describe('geld: zielTage', () => {
  test('Standard 14', () => expect(zielTage(undefined)).toBe(14));
  test('liest die Zahl aus dem Text', () => expect(zielTage('30 Tage netto')).toBe(30));
});

/* ══ nummern.mjs — Nummernkreis ══════════════════════════════════════ */

describe('nummern', () => {
  const dir = mkdtempSync(join(tmpdir(), 'belegwerk-nr-'));
  const reg = join(dir, 'register.csv');
  const firma = { nummern: { muster: 'RE-{jahr}-{nr}', breite: 3 } };
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  test('erste Nummer ohne Register', () => expect(naechste(firma, reg, 2026)).toBe('RE-2026-001'));

  test('zählt vom Register weiter, je Jahr', () => {
    writeFileSync(reg, 'nummer;datum;brutto;datenhash;kettenhash\nRE-2026-007;x;x;h;k\nRE-2025-099;x;x;h;k\n');
    expect(naechste(firma, reg, 2026)).toBe('RE-2026-008');
    expect(naechste(firma, reg, 2027)).toBe('RE-2027-001');
  });

  test('nummern.start verschiebt den Beginn — bis das Register übernimmt', () => {
    const reg3 = join(dir, 'register3.csv');
    const mitStart = { nummern: { muster: 'RE-{jahr}-{nr}', breite: 3, start: 100 } };
    expect(naechste(mitStart, reg3, 2026)).toBe('RE-2026-100');
    writeFileSync(reg3, 'nummer;datum;brutto;datenhash;kettenhash\nRE-2026-100;x;x;h;k\n');
    expect(naechste(mitStart, reg3, 2026)).toBe('RE-2026-101');
  });

  test('findet Lücken, meldet dichte Kreise nicht', () => {
    writeFileSync(reg, 'nummer;datum;brutto;datenhash;kettenhash\nRE-2026-001;x;x;h;k\nRE-2026-002;x;x;h;k\nRE-2026-004;x;x;h;k\n');
    const w = luecken(reg);
    expect(w.length).toBe(1);
    expect(w[0]).toContain('RE-2026-3');
  });
});

/* ══ register.mjs — die Kette ════════════════════════════════════════ */

describe('register', () => {
  const dir = mkdtempSync(join(tmpdir(), 'belegwerk-reg-'));
  const reg = join(dir, 'register.csv');
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  test('eintragen und prüfen', () => {
    expect(eintragen(reg, { nummer: 'RE-1', datum: '2026-07-01', brutto: '100,00', datenhash: 'aaa' })).toBe('neu');
    expect(eintragen(reg, { nummer: 'RE-2', datum: '2026-07-02', brutto: '200,00', datenhash: 'bbb' })).toBe('neu');
    expect(pruefen(reg).fehler).toEqual([]);
  });

  test('gleiche Nummer, gleicher Hash: unverändert', () => {
    expect(eintragen(reg, { nummer: 'RE-1', datum: '2026-07-01', brutto: '100,00', datenhash: 'aaa' })).toBe('unveraendert');
  });

  test('gleiche Nummer, anderer Hash: verweigert', () => {
    expect(() => vertraeglich(reg, 'RE-1', 'GEAENDERT')).toThrow('nicht geändert');
  });

  test('manipulierte Brutto-Spalte bricht die Kette', () => {
    const orig = readFileSync(reg, 'utf8');
    writeFileSync(reg, orig.replace('100,00', '999,99'));
    expect(pruefen(reg).fehler.length).toBeGreaterThan(0);
    writeFileSync(reg, orig);
  });

  test('gelöschte Zeile bricht die Kette', () => {
    const zeilen = readFileSync(reg, 'utf8').trim().split('\n');
    writeFileSync(reg, [zeilen[0], zeilen[2]].join('\n') + '\n');
    expect(pruefen(reg).fehler.length).toBeGreaterThan(0);
  });

  test('frische Sperre blockiert einen zweiten Lauf', () => {
    writeFileSync(`${reg}.lock`, '99999');
    expect(() => eintragen(reg, { nummer: 'RE-9', datum: 'x', brutto: '1,00', datenhash: 'zzz' })).toThrow('gesperrt');
    rmSync(`${reg}.lock`);
  });

  test('verwaiste Sperre (Absturz) wird übernommen, danach ist sie weg', () => {
    writeFileSync(`${reg}.lock`, '99999');
    const alt = new Date(Date.now() - 120_000);
    utimesSync(`${reg}.lock`, alt, alt);
    const reg2 = join(dir, 'register2.csv');
    writeFileSync(`${reg2}.lock`, '99999');
    utimesSync(`${reg2}.lock`, alt, alt);
    expect(eintragen(reg2, { nummer: 'RE-9', datum: 'x', brutto: '1,00', datenhash: 'zzz' })).toBe('neu');
    expect(existsSync(`${reg2}.lock`)).toBe(false);
  });
});

/* ══ rechnung.mjs — Validierung (§ 11 UStG) ══════════════════════════ */

describe('rechnung: lesen validiert', () => {
  const dir = mkdtempSync(join(tmpdir(), 'belegwerk-val-'));
  const firma = { name: 'Test OG', adresse: 'Weg 1, 4020 Linz', uid: 'ATU11111111', iban: 'AT00', kleinunternehmer: false };
  const basis = {
    nummer: 'RE-1', datum: '2026-07-01',
    empfaenger: { name: 'Kunde', adresse: 'Gasse 2, Wien' },
    leistungszeitraum: 'Juli 2026',
    positionen: [{ text: 'Arbeit', preis: 100 }],
  };
  const schreib = (name, inhalt) => {
    const p = join(dir, name);
    writeFileSync(p, JSON.stringify(inhalt));
    return p;
  };
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  test('vollständige Rechnung rechnet richtig', () => {
    const r = lesen(schreib('ok.json', basis), firma);
    expect(r.netto).toBe(100);
    expect(r.ust).toBe(20);
    expect(r.brutto).toBe(120);
  });

  test('gemischte Steuersätze getrennt', () => {
    const r = lesen(schreib('mix.json', { ...basis, positionen: [{ text: 'A', preis: 100 }, { text: 'B', preis: 100, ustSatz: 10 }] }), firma);
    expect(r.ust).toBe(30);
    expect([...r.saetze.keys()].sort()).toEqual([10, 20]);
  });

  test('jede fehlende Pflichtangabe wird benannt — alle auf einmal', () => {
    try {
      lesen(schreib('leer.json', {}), { ...firma, uid: '', iban: '' });
      expect.unreachable();
    } catch (e) {
      for (const wort of ['nummer', 'datum', 'empfaenger', 'leistungszeitraum', 'positionen', 'uid', 'iban']) {
        expect(e.message).toContain(wort);
      }
    }
  });

  test('über 10.000 € brutto ohne Empfänger-UID: verweigert', () => {
    expect(() => lesen(schreib('gross.json', { ...basis, positionen: [{ text: 'X', preis: 9000 }] }), firma)).toThrow('UID des Empfängers');
  });

  test('auch der große Storno braucht die UID (Absolutbetrag)', () => {
    expect(() => lesen(schreib('minus.json', { ...basis, positionen: [{ text: 'X', preis: -9000 }] }), firma)).toThrow('UID des Empfängers');
  });

  test('Reverse Charge: ohne Empfänger-UID verweigert, mit UID ohne USt plus Regel', () => {
    expect(() => lesen(schreib('rc0.json', { ...basis, steuerregel: 'reverse-charge' }), firma)).toThrow('UID des Leistungsempfängers');
    const r = lesen(schreib('rc1.json', { ...basis, steuerregel: 'reverse-charge', empfaenger: { ...basis.empfaenger, uid: 'DE123' } }), firma);
    expect(r.ust).toBe(0);
    expect(r.brutto).toBe(100);
  });

  test('igl: braucht beide UIDs', () => {
    expect(() => lesen(schreib('igl0.json', { ...basis, steuerregel: 'igl' }), firma)).toThrow('beide UIDs');
    const r = lesen(schreib('igl1.json', { ...basis, steuerregel: 'igl', empfaenger: { ...basis.empfaenger, uid: 'CZ123' } }), firma);
    expect(r.ust).toBe(0);
  });

  test('unbekannte Steuerregel: verweigert', () => {
    expect(() => lesen(schreib('sr.json', { ...basis, steuerregel: 'dreieck' }), firma)).toThrow('steuerregel');
  });

  test('unzulässiger Steuersatz: verweigert', () => {
    expect(() => lesen(schreib('satz.json', { ...basis, positionen: [{ text: 'X', preis: 10, ustSatz: 19 }] }), firma)).toThrow('zulässig sind 20, 13, 10');
  });

  test('Kleinunternehmer: keine USt — aber keine Sonderregeln', () => {
    const klein = { ...firma, kleinunternehmer: true };
    const r = lesen(schreib('ku.json', basis), klein);
    expect(r.ust).toBe(0);
    expect(r.brutto).toBe(100);
    expect(() => lesen(schreib('kurc.json', { ...basis, steuerregel: 'reverse-charge', empfaenger: { ...basis.empfaenger, uid: 'DE1' } }), klein)).toThrow('Steuerberatung');
  });

  test('Muster: per Feld und per Dateiname', () => {
    expect(lesen(schreib('m1.json', { ...basis, muster: true }), firma).muster).toBe(true);
    expect(lesen(schreib('beispiel-x.json', basis), firma).muster).toBe(true);
    expect(lesen(schreib('echt.json', basis), firma).muster).toBe(false);
  });
});

/* ══ stil.mjs — Branding und Vorlagen-Überschreibung ═════════════════ */

describe('stil: Branding je Mandant', () => {
  const dir = mkdtempSync(join(tmpdir(), 'belegwerk-stil-'));
  const firma = {
    name: 'Marken OG', adresse: 'Weg 1, 4020 Linz', uid: 'ATU22222222', iban: 'AT11',
    wurzel: dir, stil: { primaer: '#0B1F3A', akzent: '#2558E8' },
  };
  const basis = {
    nummer: 'RE-1', datum: '2026-07-01',
    empfaenger: { name: 'Kunde', adresse: 'Gasse 2, Wien' },
    leistungszeitraum: 'Juli 2026',
    positionen: [{ text: 'Arbeit', preis: 100 }],
  };
  const rechnungLaden = () => {
    const p = join(dir, 'r.json');
    writeFileSync(p, JSON.stringify(basis));
    return lesen(p, firma);
  };
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  test('ohne Vorlagen: Firmenname als Marke, Farben aus firma.json', () => {
    const html = htmlRechnung(rechnungLaden(), firma);
    expect(html).toContain('class="firmenname"');
    expect(html).toContain('#0B1F3A');
    expect(html).toContain('#2558E8');
  });

  test('vorlage/stil.css wird angehängt und gewinnt die Kaskade', () => {
    mkdirSync(join(dir, 'vorlage'), { recursive: true });
    writeFileSync(join(dir, 'vorlage/stil.css'), 'h1{letter-spacing:.2em} /* eigenes-kit */');
    const html = htmlRechnung(rechnungLaden(), firma);
    expect(html).toContain('eigenes-kit');
    expect(html.indexOf('eigenes-kit')).toBeGreaterThan(html.indexOf('.kopf{'));
  });

  test('vorlage/kopf.html ersetzt den Kopf, Platzhalter werden gefüllt', () => {
    writeFileSync(join(dir, 'vorlage/kopf.html'), '<header id="kit-kopf">{{name}} · {{meta}}</header>');
    const html = htmlRechnung(rechnungLaden(), firma);
    expect(html).toContain('id="kit-kopf"');
    expect(html).toContain('Marken OG ·');
    expect(html).not.toContain('class="kopf"');
  });

  test('vorlage/fuss.html ersetzt den Fuß samt UID und IBAN', () => {
    writeFileSync(join(dir, 'vorlage/fuss.html'), '<footer id="kit-fuss">{{uid}} — {{iban}}</footer>');
    const html = htmlRechnung(rechnungLaden(), firma);
    expect(html).toContain('id="kit-fuss"');
    expect(html).toContain('ATU22222222 — AT11');
  });

  test('Logo und Schrift lösen relativ zum Mandanten auf und werden eingebettet', () => {
    writeFileSync(join(dir, 'vorlage/logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
    writeFileSync(join(dir, 'vorlage/schrift.woff2'), 'FONTBYTES');
    /* Der eigene Kopf muss {{logo}} auch verwenden — ein Kit, das den
       Platzhalter weglässt, bekommt bewusst kein Logo untergeschoben. */
    writeFileSync(join(dir, 'vorlage/kopf.html'), '<header id="kit-kopf">{{logo}} {{meta}}</header>');
    const mitMarke = { ...firma, logoPfad: 'vorlage/logo.svg', schriftPfad: 'vorlage/schrift.woff2' };
    const html = htmlRechnung(rechnungLaden(), mitMarke);
    expect(html).toContain('data:image/svg+xml;base64');
    expect(html).toContain('EigeneSchrift');
    expect(html).toContain(Buffer.from('FONTBYTES').toString('base64'));
  });
});

/* ══ Standardvorlage — die belegwerk-Designsprache ═══════════════════ */

describe('vorlagen/standard', () => {
  const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
  const dir = mkdtempSync(join(tmpdir(), 'belegwerk-std-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  test('stil.css ist erzeugt, trägt Tokens-Farben und Plex', () => {
    const css = readFileSync(join(REPO, 'vorlagen/standard/stil.css'), 'utf8');
    for (const farbe of ['#161713', '#B84B25', '#355B4A', '#6C6E68', '#D8D5CC']) {
      expect(css).toContain(farbe);
    }
    expect(css).toContain('IBM Plex Sans');
    expect(css).toContain('IBM Plex Mono');
    expect(css).toContain('data:font/woff;base64,');
  });

  test('als Mandanten-Vorlage eingesetzt landet sie im Dokument', () => {
    mkdirSync(join(dir, 'vorlage'), { recursive: true });
    writeFileSync(join(dir, 'vorlage/stil.css'), readFileSync(join(REPO, 'vorlagen/standard/stil.css')));
    const firma = { name: 'Standard OG', adresse: 'Weg 1, Linz', uid: 'ATU3', iban: 'AT3', wurzel: dir };
    const p = join(dir, 'r.json');
    writeFileSync(p, JSON.stringify({
      nummer: 'RE-1', datum: '2026-07-01',
      empfaenger: { name: 'K', adresse: 'W' }, leistungszeitraum: 'Juli 2026',
      positionen: [{ text: 'A', preis: 10 }],
    }));
    const html = htmlRechnung(lesen(p, firma), firma);
    expect(html).toContain('#B84B25');
    expect(html).toContain('#355B4A');
    expect(html).toContain('IBM Plex Sans');
    /* Kein belegwerk-Logo in Mandanten-Dokumenten — nur der Firmenname. */
    expect(html).toContain('Standard OG');
    expect(html).not.toContain('belegwerk-logo');
  });

  test('der Generator ist deterministisch', () => {
    const vorher = readFileSync(join(REPO, 'vorlagen/standard/stil.css'), 'utf8');
    const p = Bun.spawnSync(['bun', join(REPO, 'scripts/standard-vorlage.mjs')]);
    expect(p.exitCode).toBe(0);
    expect(readFileSync(join(REPO, 'vorlagen/standard/stil.css'), 'utf8')).toBe(vorher);
  });
});

/* ══ End-to-End — die CLI im Wegwerf-Mandanten ═══════════════════════ */

describe('CLI End-to-End', () => {
  let M;
  const lauf = (...args) => {
    const p = Bun.spawnSync(['bun', CLI, ...args], { cwd: M });
    return { code: p.exitCode, out: p.stdout.toString() + p.stderr.toString() };
  };
  const rechnungJson = (name, extra = {}) => {
    const pfad = join(M, 'rechnungen', name);
    writeFileSync(pfad, JSON.stringify({
      nummer: 'RE-2026-901', datum: '2026-06-01',
      empfaenger: { name: 'Kunde GmbH', adresse: 'Gasse 2, 1010 Wien' },
      leistungszeitraum: 'Mai 2026',
      positionen: [{ text: 'Beratung', preis: 1000 }],
      ...extra,
    }, null, 2));
    return `rechnungen/${name}`;
  };

  beforeAll(() => {
    M = mkdtempSync(join(tmpdir(), 'belegwerk-e2e-'));
    const r = lauf('init');
    expect(r.code).toBe(0);
    const firma = JSON.parse(readFileSync(join(M, 'firma.json'), 'utf8'));
    firma.name = 'E2E Test OG';
    firma.uid = 'ATU99999999';
    writeFileSync(join(M, 'firma.json'), JSON.stringify(firma, null, 2));
  });
  afterAll(() => rmSync(M, { recursive: true, force: true }));

  test('init: doppelt verweigert', () => {
    const r = lauf('init');
    expect(r.code).toBe(1);
    expect(r.out).toContain('doppelt');
  });

  test('rechnung: PDF + Registereintrag', () => {
    const r = lauf('rechnung', rechnungJson('RE-2026-901.json'));
    expect(r.code).toBe(0);
    expect(r.out).toContain('1.200,00');
    expect(existsSync(join(M, 'rechnungen/RE-2026-901.pdf'))).toBe(true);
    expect(readFileSync(join(M, 'register.csv'), 'utf8')).toContain('RE-2026-901');
  }, 30_000);

  test('rechnung: unverändert erneut = idempotent', () => {
    const r = lauf('rechnung', 'rechnungen/RE-2026-901.json');
    expect(r.code).toBe(0);
    expect(r.out).toContain('unverändert');
  }, 30_000);

  test('rechnung: geänderte Daten unter vergebener Nummer verweigert, PDF unangetastet', () => {
    const vorher = readFileSync(join(M, 'rechnungen/RE-2026-901.pdf')).length;
    rechnungJson('RE-2026-901.json', { positionen: [{ text: 'Beratung', preis: 2000 }] });
    const r = lauf('rechnung', 'rechnungen/RE-2026-901.json');
    rechnungJson('RE-2026-901.json'); // zurück auf den ausgestellten Stand — VOR den Asserts
    expect(r.code).toBe(1);
    expect(r.out).toContain('stornieren');
    expect(readFileSync(join(M, 'rechnungen/RE-2026-901.pdf')).length).toBe(vorher);
  });

  test('muster: kein Registereintrag', () => {
    const vorher = readFileSync(join(M, 'register.csv'), 'utf8');
    const r = lauf('rechnung', rechnungJson('beispiel-demo.json', { nummer: 'RE-2026-999' }));
    expect(r.code).toBe(0);
    expect(r.out).toContain('Muster');
    expect(readFileSync(join(M, 'register.csv'), 'utf8')).toBe(vorher);
  }, 30_000);

  test('wiederkehrend: erzeugt, nummeriert, idempotent', () => {
    writeFileSync(join(M, 'wiederkehrend/betrieb.json'), JSON.stringify({
      empfaenger: { name: 'Gemeinde X', adresse: 'Platz 1, 4210 Ort' },
      positionen: [{ text: 'Betrieb', preis: 40 }],
    }));
    let r = lauf('wiederkehrend', '2026-08');
    expect(r.code).toBe(0);
    expect(r.out).toContain('1 von 1');
    r = lauf('wiederkehrend', '2026-08');
    expect(r.out).toContain('übersprungen');
    expect(r.out).toContain('0 von 1');
    /* Die Vorlage darf den Nummernkreis nicht unterlaufen — das Register
       steht bei 901, also ist die nächste Nummer 902. */
    const erzeugt = JSON.parse(readFileSync(join(M, 'rechnungen/2026/2026-08-betrieb.json'), 'utf8'));
    expect(erzeugt.nummer).toBe('RE-2026-902');
    expect(erzeugt.leistungszeitraum).toContain('August 2026');
  });

  test('storno: Gegenrechnung, Original bleibt, zweiter Storno verweigert', () => {
    let r = lauf('storno', 'RE-2026-901');
    expect(r.code).toBe(0);
    expect(r.out).toContain('-1.200,00');
    const original = JSON.parse(readFileSync(join(M, 'rechnungen/RE-2026-901.json'), 'utf8'));
    expect(original.storniert).toBeTruthy();
    expect(original.positionen[0].preis).toBe(1000); // unangetastet
    r = lauf('storno', 'RE-2026-901');
    expect(r.code).toBe(1);
    expect(r.out).toContain('bereits storniert');
  }, 30_000);

  test('storno: unbekannte Nummer verweigert', () => {
    const r = lauf('storno', 'RE-0000-000');
    expect(r.code).toBe(1);
    expect(r.out).toContain('Keine Rechnung');
  });

  test('offen: listet Unbezahltes, Storniertes nicht', () => {
    lauf('rechnung', rechnungJson('RE-2026-905.json', { nummer: 'RE-2026-905', positionen: [{ text: 'Wartung', preis: 500 }] }));
    const r = lauf('offen');
    expect(r.code).toBe(0);
    expect(r.out).toContain('RE-2026-905');
    expect(r.out).not.toContain('RE-2026-901'); // storniert
    expect(r.out).toContain('überfällig'); // datum 2026-06-01 + 14 Tage liegt zurück
  }, 30_000);

  test('mahnung: Stufe 1, dann Stufe 2 mit Verzugsfolgen', () => {
    let r = lauf('mahnung', 'RE-2026-905');
    expect(r.code).toBe(0);
    expect(r.out).toContain('Zahlungserinnerung');
    expect(existsSync(join(M, 'rechnungen/RE-2026-905-mahnung-1.pdf'))).toBe(true);
    r = lauf('mahnung', 'RE-2026-905');
    expect(r.out).toContain('2. Mahnung');
    expect(existsSync(join(M, 'rechnungen/RE-2026-905-mahnung-2.pdf'))).toBe(true);
  }, 30_000);

  test('mahnung: vor Fälligkeit verweigert', () => {
    const morgen = new Date(); morgen.setDate(morgen.getDate() - 1);
    lauf('rechnung', rechnungJson('RE-2026-904.json', { nummer: 'RE-2026-904', datum: morgen.toISOString().slice(0, 10) }));
    const r = lauf('mahnung', 'RE-2026-904');
    expect(r.code).toBe(1);
    expect(r.out).toContain('vor Fälligkeit');
  }, 30_000);

  test('bezahlt: vermerkt, doppelt verweigert, verschwindet aus offen', () => {
    let r = lauf('bezahlt', 'RE-2026-905', '2026-07-20');
    expect(r.code).toBe(0);
    r = lauf('bezahlt', 'RE-2026-905');
    expect(r.code).toBe(1);
    expect(r.out).toContain('schon als bezahlt');
    expect(lauf('offen').out).not.toContain('RE-2026-905');
  });

  test('konto, ausgabe, ziele, stand', () => {
    expect(lauf('konto', '10.000,00').code).toBe(0);
    expect(lauf('ausgabe', '250,00', 'Notebook', 'hardware').code).toBe(0);
    writeFileSync(join(M, 'ziele.json'), JSON.stringify([{ text: 'Rücklage', betrag: 20000 }]));
    const r = lauf('stand');
    expect(r.code).toBe(0);
    expect(r.out).toContain('10.000,00');
    expect(r.out).toContain('250,00');
    expect(r.out).toContain('Rücklage');
    expect(r.out).toContain('50 %');
    expect(r.out).toContain('Arbeitshilfe');
  });

  test('pruefen: Kette in Ordnung — und Manipulation fällt auf', () => {
    let r = lauf('pruefen');
    expect(r.code).toBe(0);
    expect(r.out).toContain('Kette geschlossen');
    const orig = readFileSync(join(M, 'register.csv'), 'utf8');
    writeFileSync(join(M, 'register.csv'), orig.replace('1.200,00', '9.999,99'));
    r = lauf('pruefen');
    expect(r.code).toBe(1);
    expect(r.out).toContain('Kette gebrochen');
    writeFileSync(join(M, 'register.csv'), orig);
  });

  test('sichern: datiertes Archiv, geprüft, ohne node_modules', () => {
    mkdirSync(join(M, 'node_modules', 'dummy'), { recursive: true });
    writeFileSync(join(M, 'node_modules/dummy/x.js'), 'x');
    const ziel = join(M, '..', 'belegwerk-test-sicherung');
    const r = lauf('sichern', ziel);
    expect(r.code).toBe(0);
    expect(r.out).toContain('geprüft');
    const archiv = r.out.match(/\S+\.tar\.gz/)[0];
    expect(existsSync(archiv)).toBe(true);
    const inhalt = Bun.spawnSync(['tar', '-tzf', archiv]).stdout.toString();
    expect(inhalt).toContain('firma.json');
    expect(inhalt).toContain('register.csv');
    expect(inhalt).not.toContain('node_modules');
    rmSync(ziel, { recursive: true, force: true });
  });

  test('rechnung mit Mandanten-Branding: vorlage/ wirkt bis ins PDF', () => {
    mkdirSync(join(M, 'vorlage'), { recursive: true });
    writeFileSync(join(M, 'vorlage/stil.css'), 'h1{color:#0B1F3A}');
    writeFileSync(join(M, 'vorlage/kopf.html'), '<header>{{name}} — {{meta}}</header>');
    const r = lauf('rechnung', rechnungJson('RE-2026-910.json', { nummer: 'RE-2026-910' }));
    expect(r.code).toBe(0);
    expect(existsSync(join(M, 'rechnungen/RE-2026-910.pdf'))).toBe(true);
  }, 30_000);

  test('hilfe: unbekannter Befehl zeigt die Übersicht', () => {
    const r = lauf('unfug');
    expect(r.code).toBe(0);
    expect(r.out).toContain('Dateien. Belege. Nachweis.');
  });
});

/* ══ Sicherheit — die Angriffsflächen, einzeln zugenagelt ════════════ */

describe('Sicherheit', () => {
  const dir = mkdtempSync(join(tmpdir(), 'belegwerk-sec-'));
  const firma = { name: 'Sicher OG', adresse: 'Weg 1, Linz', uid: 'ATU1', iban: 'AT1', wurzel: dir };
  const schreib = (inhalt) => {
    const p = join(dir, 's.json');
    writeFileSync(p, JSON.stringify(inhalt));
    return p;
  };
  const basis = {
    nummer: 'RE-1', datum: '2026-07-01',
    empfaenger: { name: 'K', adresse: 'W' }, leistungszeitraum: 'Juli 2026',
    positionen: [{ text: 'A', preis: 10 }],
  };
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  test('HTML-Injection: Anführungszeichen und Markup werden entschärft', () => {
    const boese = { ...basis, empfaenger: { name: '"><script>alert(1)</script>', adresse: `' onload='x` } };
    const html = htmlRechnung(lesen(schreib(boese), firma), firma);
    expect(html).not.toContain('<script>alert');
    expect(html).not.toContain(`' onload='`);
    expect(html).toContain('&quot;&gt;&lt;script&gt;');
  });

  test('Rechnung über NaN: kein Zahlen-Preis, keine Rechnung', () => {
    expect(() => lesen(schreib({ ...basis, positionen: [{ text: 'A', preis: '10' }] }), firma)).toThrow('muss eine Zahl sein');
    expect(() => lesen(schreib({ ...basis, positionen: [{ text: 'A', preis: 10, menge: 0 }] }), firma)).toThrow('über 0');
    expect(() => lesen(schreib({ ...basis, positionen: [{ preis: 10 }] }), firma)).toThrow('text');
  });

  test('Register: Feldtrenner in Werten werden abgelehnt', () => {
    const reg = join(dir, 'register.csv');
    expect(() => eintragen(reg, { nummer: 'RE;9', datum: 'x', brutto: '1,00', datenhash: 'h' })).toThrow('unzulässig');
    expect(() => eintragen(reg, { nummer: 'RE-9', datum: 'x\ny', brutto: '1,00', datenhash: 'h' })).toThrow('unzulässig');
  });

  test('CSS-Injection: Farben aus firma.json müssen Hex sein', () => {
    const boese = { ...firma, stil: { primaer: 'red} body{display:none' } };
    expect(() => htmlRechnung(lesen(schreib(basis), boese), boese)).toThrow('Hex-Farbe');
  });

  test('Pfad-Ausbruch: Logo und Schrift außerhalb des Mandanten abgelehnt', () => {
    writeFileSync(join(dir, '..', 'fremd.svg'), '<svg/>');
    const boese = { ...firma, logoPfad: '../fremd.svg' };
    expect(() => htmlRechnung(lesen(schreib(basis), boese), boese)).toThrow('außerhalb des Mandanten');
    const absolut = { ...firma, schriftPfad: '/etc/hosts' };
    expect(() => htmlRechnung(lesen(schreib(basis), absolut), absolut)).toThrow('außerhalb des Mandanten');
  });

  test('CRLF im Register (Windows-Editor) ist kein Manipulationsalarm', () => {
    const reg = join(dir, 'crlf.csv');
    eintragen(reg, { nummer: 'RE-1', datum: '2026-07-01', brutto: '100,00', datenhash: 'aaa' });
    eintragen(reg, { nummer: 'RE-2', datum: '2026-07-02', brutto: '200,00', datenhash: 'bbb' });
    writeFileSync(reg, readFileSync(reg, 'utf8').replaceAll('\n', '\r\n'));
    expect(pruefen(reg).fehler).toEqual([]);
    /* Aber eine ECHTE Änderung fällt weiterhin auf. */
    writeFileSync(reg, readFileSync(reg, 'utf8').replace('100,00', '999,99'));
    expect(pruefen(reg).fehler.length).toBeGreaterThan(0);
  });

  test('kaputte Rechnungs-JSON: Dateiname in der Fehlermeldung', () => {
    const p = join(dir, 'defekt.json');
    writeFileSync(p, '{ "nummer": ');
    expect(() => lesen(p, firma)).toThrow('keine gültige JSON-Datei');
  });
});

/* ══ Import, Export, Nummernstart — der Umstieg vom alten System ═════ */

describe('Import, Export und Nummernstart', () => {
  let M;
  const lauf = (...args) => {
    const p = Bun.spawnSync(['bun', CLI, ...args], { cwd: M });
    return { code: p.exitCode, out: p.stdout.toString() + p.stderr.toString() };
  };

  beforeAll(() => {
    M = mkdtempSync(join(tmpdir(), 'belegwerk-umstieg-'));
    lauf('init');
    const firma = JSON.parse(readFileSync(join(M, 'firma.json'), 'utf8'));
    firma.name = 'Umstieg OG';
    firma.uid = 'ATU77777777';
    firma.nummern = { muster: 'RE-{jahr}-{nr}', breite: 3, start: 100 };
    writeFileSync(join(M, 'firma.json'), JSON.stringify(firma, null, 2));
    writeFileSync(join(M, 'altbestand.csv'),
      'nummer;datum;empfaenger;brutto\n' +
      'RE-2026-098;2026-03-01;Alt-Kunde A;1.200,00\n' +
      'RE-2026-099;2026-04-01;Alt-Kunde B;480,00\n');
  });
  afterAll(() => rmSync(M, { recursive: true, force: true }));

  test('import: Altbestand landet im Register, idempotent', () => {
    let r = lauf('import', 'altbestand.csv');
    expect(r.code).toBe(0);
    expect(r.out).toContain('2 neu');
    r = lauf('import', 'altbestand.csv');
    expect(r.out).toContain('2 bereits vorhanden');
    expect(lauf('pruefen').code).toBe(0);
  });

  test('Altbestand ist kein offener Posten und nicht hier stornierbar', () => {
    expect(lauf('offen').out).not.toContain('RE-2026-098');
    const r = lauf('storno', 'RE-2026-098');
    expect(r.code).toBe(1);
    expect(r.out).toContain('Altbestand');
  });

  test('import: falsche Kopfzeile verweigert, geänderte Altdaten verweigert', () => {
    writeFileSync(join(M, 'kaputt.csv'), 'rechnung,datum\nx,y\n');
    expect(lauf('import', 'kaputt.csv').code).toBe(1);
    writeFileSync(join(M, 'konflikt.csv'),
      'nummer;datum;empfaenger;brutto\nRE-2026-098;2026-03-01;Alt-Kunde A;9.999,00\n');
    const r = lauf('import', 'konflikt.csv');
    expect(r.code).toBe(1);
    expect(r.out).toContain('stornieren');
  });

  test('import: Strichpunkt im Namen wird klar benannt', () => {
    writeFileSync(join(M, 'spalten.csv'),
      'nummer;datum;empfaenger;brutto\nRE-2026-090;2026-01-01;Meier; Huber & Co;100,00\n');
    const r = lauf('import', 'spalten.csv');
    expect(r.code).toBe(1);
    expect(r.out).toContain('5 Spalten statt 4');
  });

  test('import: Pfad-Traversal in der Nummer wird abgelehnt', () => {
    writeFileSync(join(M, 'boese.csv'),
      'nummer;datum;empfaenger;brutto\n../../evil;2026-03-01;X;1,00\n');
    const r = lauf('import', 'boese.csv');
    expect(r.code).toBe(1);
    expect(r.out).toContain('zulässig sind');
    expect(existsSync(join(M, '..', 'evil.json'))).toBe(false);
  });

  test('export: Excel-Formel im Empfängernamen wird entschärft', () => {
    writeFileSync(join(M, 'formel.csv'),
      'nummer;datum;empfaenger;brutto\nRE-2026-097;2026-02-01;=SUMME(A1:A9);100,00\n');
    expect(lauf('import', 'formel.csv').code).toBe(0);
    lauf('export', '2026');
    const csv = readFileSync(join(M, 'export', 'belegwerk-2026.csv'), 'utf8');
    expect(csv).toContain(";'=SUMME(A1:A9);");
  });

  test('sichern: Ziel im Mandanten wird abgelehnt (wachsende Sicherung)', () => {
    const r = lauf('sichern', 'rechnungen');
    expect(r.code).toBe(1);
    expect(r.out).toContain('IM Mandanten');
  });

  test('wiederkehrend ohne Argument: der Timer-Aufruf läuft (aktueller Monat)', () => {
    const r = lauf('wiederkehrend');
    expect(r.code).toBe(0);
  }, 30_000);

  test('nummern.start: die erste neue Rechnung schließt an den Altbestand an', () => {
    const pfad = join(M, 'rechnungen', 'neu.json');
    writeFileSync(join(M, 'wiederkehrend/betrieb.json'), JSON.stringify({
      empfaenger: { name: 'Gemeinde Z', adresse: 'Platz 3, 4020 Ort' },
      positionen: [{ text: 'Betrieb', preis: 40 }],
    }));
    const r = lauf('wiederkehrend', '2026-07');
    expect(r.code).toBe(0);
    expect(readFileSync(join(M, 'register.csv'), 'utf8')).toContain('RE-2026-100');
    expect(lauf('pruefen').out).toContain('Nummernkreis dicht');
  }, 30_000);

  test('export: Jahres-CSV mit Netto, USt, Status und Summenzeile', () => {
    const r = lauf('export', '2026');
    expect(r.code).toBe(0);
    const csv = readFileSync(join(M, 'export', 'belegwerk-2026.csv'), 'utf8');
    expect(csv).toContain('RE-2026-098;2026-03-01;Alt-Kunde A;;;1.200,00;altbestand');
    expect(csv).toContain('RE-2026-100');
    expect(csv).toContain(';offen');
    expect(csv).toContain('SUMME;;;40,00;8,00;1.828,00;4 Rechnungen');
  });

  test('export: leeres Jahr verweigert', () => {
    expect(lauf('export', '1999').code).toBe(1);
  });

  test('ohne TTY keine Escape-Sequenzen — Cron-Mails bleiben Text', () => {
    const r = lauf('pruefen');
    expect(r.out).not.toContain('\x1b[');
  });
});

/* ══ Onboarding — einrichten muss out of the box tragen ══════════════ */

describe('einrichten', () => {
  const M = mkdtempSync(join(tmpdir(), 'belegwerk-onboarding-'));
  afterAll(() => rmSync(M, { recursive: true, force: true }));

  test('ein Befehl: Konfiguration, Vorlage, Git, Muster-PDF', () => {
    const antworten = 'Probe OG\nProbeweg 1, 4020 Linz\nn\nATU55555555\nAT55 5500 0000 5555 5555\n\n\n\nj\n';
    const p = Bun.spawnSync(['bun', CLI, 'einrichten'], { cwd: M, stdin: Buffer.from(antworten) });
    expect(p.exitCode).toBe(0);
    const firma = JSON.parse(readFileSync(join(M, 'firma.json'), 'utf8'));
    expect(firma.name).toBe('Probe OG');
    expect(firma.uid).toBe('ATU55555555');
    expect(firma.nummern.start).toBe(1);
    expect(existsSync(join(M, 'vorlage/stil.css'))).toBe(true);
    expect(existsSync(join(M, '.git'))).toBe(true);
    expect(existsSync(join(M, 'rechnungen/beispiel-erste-rechnung.pdf'))).toBe(true);
    /* Das Muster darf NICHT im Register stehen. */
    expect(existsSync(join(M, 'register.csv'))).toBe(false);
  }, 30_000);

  test('zweiter Lauf im selben Ordner: verweigert', () => {
    const p = Bun.spawnSync(['bun', CLI, 'einrichten'], { cwd: M, stdin: Buffer.from('x\n') });
    expect(p.exitCode).toBe(1);
    expect(p.stderr.toString()).toContain('schon eine firma.json');
  });

  test('ohne IBAN: bricht ab, nichts angelegt', () => {
    const leer = mkdtempSync(join(tmpdir(), 'belegwerk-onboarding2-'));
    const p = Bun.spawnSync(['bun', CLI, 'einrichten'], { cwd: leer, stdin: Buffer.from('Probe OG\nWeg 1\nn\nATU1\n\n') });
    expect(p.exitCode).toBe(1);
    expect(p.stdout.toString() + p.stderr.toString()).toContain('Ohne IBAN');
    rmSync(leer, { recursive: true, force: true });
  });

  test('server-einrichten.sh ist syntaktisch gültiges Shell', () => {
    const p = Bun.spawnSync(['sh', '-n', join(dirname(fileURLToPath(import.meta.url)), '..', 'deploy', 'server-einrichten.sh')]);
    expect(p.exitCode).toBe(0);
  });
});

/* ══ Ausfall und Wiederanlauf — die Szenarien, die nachts passieren ══ */

describe('Ausfall und Wiederanlauf', () => {
  let M;
  const lauf = (...args) => {
    const p = Bun.spawnSync(['bun', CLI, ...args], { cwd: M });
    return { code: p.exitCode, out: p.stdout.toString() + p.stderr.toString() };
  };

  beforeAll(() => {
    M = mkdtempSync(join(tmpdir(), 'belegwerk-ausfall-'));
    lauf('init');
    const firma = JSON.parse(readFileSync(join(M, 'firma.json'), 'utf8'));
    firma.name = 'Ausfall OG';
    firma.uid = 'ATU88888888';
    writeFileSync(join(M, 'firma.json'), JSON.stringify(firma, null, 2));
    writeFileSync(join(M, 'wiederkehrend/betrieb.json'), JSON.stringify({
      empfaenger: { name: 'Gemeinde Y', adresse: 'Platz 2, 4020 Ort' },
      positionen: [{ text: 'Betrieb', preis: 40 }],
    }));
  });
  afterAll(() => rmSync(M, { recursive: true, force: true }));

  test('Server war am Monatsersten aus: verpasste Monate werden nachgeholt, Nummern bleiben dicht', () => {
    expect(lauf('wiederkehrend', '2026-05').code).toBe(0);
    expect(lauf('wiederkehrend', '2026-06').code).toBe(0);
    expect(lauf('wiederkehrend', '2026-07').code).toBe(0);
    const register = readFileSync(join(M, 'register.csv'), 'utf8');
    expect(register).toContain('RE-2026-001');
    expect(register).toContain('RE-2026-002');
    expect(register).toContain('RE-2026-003');
    const r = lauf('pruefen');
    expect(r.code).toBe(0);
    expect(r.out).toContain('Nummernkreis dicht');
  }, 30_000);

  test('Absturz zwischen PDF und Registereintrag: der nächste Lauf heilt', () => {
    /* Simulation: Rechnung ausgestellt, aber der Registereintrag ging
       verloren (Absturz, Stromausfall). Das PDF liegt schon da. */
    const pfad = join(M, 'rechnungen', 'RE-2026-500.json');
    writeFileSync(pfad, JSON.stringify({
      nummer: 'RE-2026-500', datum: '2026-07-01',
      empfaenger: { name: 'K', adresse: 'W' }, leistungszeitraum: 'Juni 2026',
      positionen: [{ text: 'Arbeit', preis: 100 }],
    }));
    expect(lauf('rechnung', 'rechnungen/RE-2026-500.json').code).toBe(0);
    const mitEintrag = readFileSync(join(M, 'register.csv'), 'utf8');
    writeFileSync(join(M, 'register.csv'), mitEintrag.split('\n').filter((z) => !z.includes('RE-2026-500')).join('\n'));
    const r = lauf('rechnung', 'rechnungen/RE-2026-500.json');
    expect(r.code).toBe(0);
    expect(r.out).toContain('eingetragen');
    expect(lauf('pruefen').code).toBe(0);
  }, 30_000);

  test('Wiederherstellung: aus dem sichern-Archiv entsteht ein prüfbarer Mandant', () => {
    const ziel = mkdtempSync(join(tmpdir(), 'belegwerk-restore-'));
    const s = lauf('sichern', ziel);
    expect(s.code).toBe(0);
    const archiv = s.out.match(/\S+\.tar\.gz/)[0];
    const wieder = mkdtempSync(join(tmpdir(), 'belegwerk-wieder-'));
    expect(Bun.spawnSync(['tar', '-xzf', archiv, '-C', wieder, '--strip-components', '1']).exitCode).toBe(0);
    const p = Bun.spawnSync(['bun', CLI, 'pruefen'], { cwd: wieder });
    expect(p.exitCode).toBe(0);
    expect(p.stdout.toString()).toContain('Kette geschlossen');
    rmSync(ziel, { recursive: true, force: true });
    rmSync(wieder, { recursive: true, force: true });
  }, 30_000);

  test('kaputte firma.json: klare Ablehnung statt stillem Weiterlaufen', () => {
    const kaputt = mkdtempSync(join(tmpdir(), 'belegwerk-kaputt-'));
    writeFileSync(join(kaputt, 'firma.json'), '{ "name": "kaputt", ');
    const p = Bun.spawnSync(['bun', CLI, 'pruefen'], { cwd: kaputt });
    expect(p.exitCode).toBe(1);
    rmSync(kaputt, { recursive: true, force: true });
  });

  test('unsinniger Monat bei wiederkehrend: Fehler, keine Rechnung', () => {
    const r = lauf('wiederkehrend', 'August');
    expect(r.code).toBe(1);
    expect(r.out).toContain('kein Monat');
  });

  test('mahnung für Bezahltes: verweigert', () => {
    lauf('bezahlt', 'RE-2026-500');
    const r = lauf('mahnung', 'RE-2026-500');
    expect(r.code).toBe(1);
    expect(r.out).toContain('nicht offen');
  });
});
