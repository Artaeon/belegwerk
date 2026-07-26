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
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { parseBetrag, parseDatum, zielTage } from '../src/lib/geld.mjs';
import { naechste, luecken } from '../src/lib/nummern.mjs';
import { eintragen, pruefen, vertraeglich } from '../src/lib/register.mjs';
import { lesen, htmlRechnung } from '../src/lib/rechnung.mjs';

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'belegwerk.mjs');

/* ══ geld.mjs — Parser ═══════════════════════════════════════════════ */

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
  });

  test('rechnung: unverändert erneut = idempotent', () => {
    const r = lauf('rechnung', 'rechnungen/RE-2026-901.json');
    expect(r.code).toBe(0);
    expect(r.out).toContain('unverändert');
  });

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
  });

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
  });

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
  });

  test('mahnung: Stufe 1, dann Stufe 2 mit Verzugsfolgen', () => {
    let r = lauf('mahnung', 'RE-2026-905');
    expect(r.code).toBe(0);
    expect(r.out).toContain('Zahlungserinnerung');
    expect(existsSync(join(M, 'rechnungen/RE-2026-905-mahnung-1.pdf'))).toBe(true);
    r = lauf('mahnung', 'RE-2026-905');
    expect(r.out).toContain('2. Mahnung');
    expect(existsSync(join(M, 'rechnungen/RE-2026-905-mahnung-2.pdf'))).toBe(true);
  });

  test('mahnung: vor Fälligkeit verweigert', () => {
    const morgen = new Date(); morgen.setDate(morgen.getDate() - 1);
    lauf('rechnung', rechnungJson('RE-2026-904.json', { nummer: 'RE-2026-904', datum: morgen.toISOString().slice(0, 10) }));
    const r = lauf('mahnung', 'RE-2026-904');
    expect(r.code).toBe(1);
    expect(r.out).toContain('vor Fälligkeit');
  });

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
  });

  test('hilfe: unbekannter Befehl zeigt die Übersicht', () => {
    const r = lauf('unfug');
    expect(r.code).toBe(0);
    expect(r.out).toContain('belegwerk — Rechnung und Register');
  });
});
