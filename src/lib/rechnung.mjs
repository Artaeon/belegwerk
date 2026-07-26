/**
 * DIE RECHNUNG — prüfen, setzen, eintragen.
 *
 * Pflichtangaben nach § 11 UStG sind Felder, keine Konvention: Fehlt
 * eines, bricht das Werkzeug, statt still Unvollständiges auszustellen.
 * Unterstützt die österreichischen Steuersätze (20/13/10 %) je Position
 * und die Kleinunternehmerregelung (§ 6 Abs 1 Z 27 UStG) — dann ohne
 * Umsatzsteuer, mit dem vorgeschriebenen Hinweis auf der Rechnung.
 */
import puppeteer from 'puppeteer';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { esc, seite } from './stil.mjs';
import { sha } from './register.mjs';

const eur = new Intl.NumberFormat('de-AT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const rund = (n) => Math.round(n * 100) / 100;

/** Liest und validiert eine Rechnungs-JSON. Wirft mit einer Liste
 *  fehlender Pflichtangaben — alles auf einmal, nicht eines je Lauf. */
export function lesen(datei, firma) {
  const r = JSON.parse(readFileSync(datei, 'utf8'));
  r.muster = r.muster === true || basename(datei).includes('beispiel');

  const fehlt = [];
  if (!r.nummer) fehlt.push('nummer — fortlaufend, z. B. RE-2026-001');
  if (!r.datum) fehlt.push('datum — Ausstellungsdatum');
  if (!r.empfaenger?.name || !r.empfaenger?.adresse) fehlt.push('empfaenger.name und empfaenger.adresse');
  if (!r.leistungszeitraum) fehlt.push('leistungszeitraum — Tag oder Zeitraum der Leistung');
  if (!r.positionen?.length) fehlt.push('positionen');
  if (!firma.kleinunternehmer && !firma.uid) fehlt.push('uid in firma.json — § 11 UStG verlangt die UID des Ausstellers');
  if (!firma.iban && !r.zahlung?.iban) fehlt.push('iban — in firma.json oder zahlung.iban');

  /* Steuerregel. „normal" ist der Regelfall; die beiden Sonderfälle mit
     Hinweispflicht nach § 11 UStG sind ausdrücklich benannt — alles
     andere lehnt das Werkzeug ab, statt eine Rechnung ohne den
     vorgeschriebenen Hinweis auszustellen. */
  r.steuerregel = r.steuerregel ?? 'normal';
  if (!['normal', 'reverse-charge', 'igl'].includes(r.steuerregel)) {
    fehlt.push(`steuerregel „${r.steuerregel}" — zulässig sind normal, reverse-charge (§ 19: Übergang der Steuerschuld) oder igl (steuerfreie innergemeinschaftliche Lieferung)`);
  }
  const ohneUst = firma.kleinunternehmer || r.steuerregel !== 'normal';
  if (r.steuerregel === 'reverse-charge' && !r.empfaenger?.uid) {
    fehlt.push('empfaenger.uid — Reverse Charge verlangt die UID des Leistungsempfängers');
  }
  if (r.steuerregel === 'igl' && (!r.empfaenger?.uid || !firma.uid)) {
    fehlt.push('empfaenger.uid und firma.uid — die ig Lieferung verlangt beide UIDs');
  }
  if (firma.kleinunternehmer && r.steuerregel !== 'normal') {
    fehlt.push('steuerregel — Kleinunternehmer stellen weder Reverse-Charge- noch igl-Rechnungen in diesem Werkzeug aus; das gehört zur Steuerberatung');
  }

  const netto = (r.positionen ?? []).reduce((s, p) => s + p.preis * (p.menge ?? 1), 0);

  /* USt je Satz gruppieren — entfällt bei Kleinunternehmer und Sonderregeln. */
  const saetze = new Map();
  if (!ohneUst) {
    for (const p of r.positionen ?? []) {
      const satz = p.ustSatz ?? 20;
      if (![20, 13, 10, 0].includes(satz)) fehlt.push(`ustSatz ${satz} — zulässig sind 20, 13, 10 oder 0`);
      saetze.set(satz, (saetze.get(satz) ?? 0) + p.preis * (p.menge ?? 1));
    }
  }
  const ust = rund([...saetze.entries()].reduce((s, [satz, basis]) => s + basis * (satz / 100), 0));
  const brutto = rund(netto + ust);

  /* Absolutbetrag: Auch die Stornorechnung über -12.000 € braucht die UID. */
  if (Math.abs(brutto) > 10000 && !r.empfaenger?.uid) {
    fehlt.push('empfaenger.uid — über 10.000 € brutto verlangt § 11 UStG die UID des Empfängers');
  }
  if (fehlt.length) throw new Error('Rechnung unvollständig, nichts erzeugt:\n  · ' + fehlt.join('\n  · '));

  /* Der Datenhash läuft über die fachlichen Daten, nicht über das PDF —
     so steht er auf der Rechnung selbst und im Register: beide belegen
     einander. */
  const datenhash = sha(JSON.stringify({ nummer: r.nummer, datum: r.datum, empfaenger: r.empfaenger, leistungszeitraum: r.leistungszeitraum, positionen: r.positionen, netto, ust, brutto }));

  return { ...r, netto, ust, brutto, saetze, datenhash };
}

export async function setzen(r, firma, pdfPfad) {
  const iban = r.zahlung?.iban ?? firma.iban;
  const bic = r.zahlung?.bic ?? firma.bic;

  const positionen = r.positionen.map((p, i) => `<tr>
  <td>${i + 1}</td>
  <td><strong>${esc(p.text)}</strong>${p.beschreibung ? `<br><span style="color:#5b6472">${esc(p.beschreibung)}</span>` : ''}</td>
  <td class="r">${esc(String(p.menge ?? 1))} ${esc(p.einheit ?? 'pauschal')}</td>
  <td class="r">${eur.format(p.preis)} €</td>
  <td class="r">${eur.format(p.preis * (p.menge ?? 1))} €</td>
</tr>`).join('\n');

  const ustZeilen = [...r.saetze.entries()].map(([satz, basis]) => `<tr><td></td><td colspan="3">Umsatzsteuer ${satz} %</td><td class="r">${eur.format(rund(basis * satz / 100))} €</td></tr>`).join('\n');

  /* Die vorgeschriebenen Hinweise der Sonderfälle — sie stehen auf der
     Rechnung, nicht in einer Doku. */
  const steuerHinweis = firma.kleinunternehmer
    ? 'Umsatzsteuerfrei gemäß § 6 Abs 1 Z 27 UStG (Kleinunternehmerregelung).'
    : r.steuerregel === 'reverse-charge'
      ? 'Übergang der Steuerschuld auf den Leistungsempfänger (Reverse Charge, § 19 UStG bzw. Art. 196 MwStSyst-RL).'
      : r.steuerregel === 'igl'
        ? 'Steuerfreie innergemeinschaftliche Lieferung (Art. 6 Abs 1 UStG).'
        : '';

  const html = seite(firma, `Rechnung ${r.nummer}`, `Rechnung ${esc(r.nummer)} · ${esc(r.datum)}${r.muster ? ' · MUSTER' : ''}`, `
<h1>Rechnung ${esc(r.nummer)}${r.muster ? ' — Muster, ohne Rechtswirkung' : ''}</h1>

<table>
<tr><th>Empfänger</th><td><strong>${esc(r.empfaenger.name)}</strong><br>${esc(r.empfaenger.adresse)}${r.empfaenger.uid ? `<br>UID ${esc(r.empfaenger.uid)}` : ''}</td></tr>
<tr><th>Aussteller</th><td>${esc(firma.name)}, ${esc(firma.adresse)}${firma.uid ? ` · UID ${esc(firma.uid)}` : ''}</td></tr>
<tr><th>Rechnungsdatum</th><td>${esc(r.datum)}</td></tr>
<tr><th>Leistungszeitraum</th><td>${esc(r.leistungszeitraum)}</td></tr>
${r.referenz ? `<tr><th>Referenz</th><td>${esc(r.referenz)}</td></tr>` : ''}
</table>

<h2>Leistungen</h2>
<table class="pos">
<tr><th>Pos.</th><th>Leistung</th><th class="r">Menge</th><th class="r">Einzelpreis</th><th class="r">Betrag</th></tr>
${positionen}
<tr><td></td><td colspan="3">Summe${r.saetze.size ? ' netto' : ''}</td><td class="r">${eur.format(r.netto)} €</td></tr>
${ustZeilen}
<tr class="summe"><td></td><td colspan="3">Rechnungsbetrag</td><td class="r">${eur.format(r.brutto)} €</td></tr>
</table>
${steuerHinweis ? `<p>${steuerHinweis}</p>` : ''}

<h2>Zahlung</h2>
<p>Zahlbar ohne Abzug binnen <strong>${esc(r.zahlung?.ziel ?? '14 Tagen ab Rechnungsdatum')}</strong>
auf IBAN <strong>${esc(iban)}</strong>${bic ? ` · BIC ${esc(bic)}` : ''}, lautend auf ${esc(firma.name)}.
Verwendungszweck: <strong>${esc(r.nummer)}</strong>.</p>
${r.hinweis ? `<p>${esc(r.hinweis)}</p>` : ''}

<div class="note">Prüfsumme dieser Rechnung (SHA-256 über die Rechnungsdaten):<br>
<span class="mono">${r.datenhash}</span><br>
Sie ist im Rechnungsregister des Ausstellers hinterlegt — Rechnung und Register belegen einander.</div>
`);

  await pdf(html, pdfPfad);
}

/** HTML → A4-PDF. Auch Mahnungen und künftige Dokumente laufen hier durch. */
export async function pdf(html, pfad) {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  await page.emulateMediaType('print');
  await page.setContent(html, { waitUntil: 'networkidle0' });
  await page.pdf({ path: pfad, format: 'A4', printBackground: true, margin: { top: '16mm', right: '15mm', bottom: '14mm', left: '15mm' } });
  await browser.close();
}
