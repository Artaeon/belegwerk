/**
 * DAS REGISTER — fortlaufend, verkettet, manipulationsevident.
 *
 * Eine CSV-Zeile je Rechnung: nummer;datum;brutto;datenhash;kettenhash.
 * Der Kettenhash läuft über die GANZE Zeile plus den vorigen Kettenhash —
 * nicht nur über den Datenhash. Das ist eine Lehre aus dem ersten
 * Manipulationstest: Deckt die Kette nur den Datenhash, lässt sich die
 * Brutto-Spalte ändern, ohne dass es auffällt.
 *
 * Eine nachträglich geänderte oder entfernte Zeile bricht die Kette
 * aller folgenden. Zusammen mit der Git-Historie des Mandanten-Ordners
 * ergibt das zwei unabhängige Prüfpfade.
 */
import { readFileSync, writeFileSync, existsSync, appendFileSync, unlinkSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';

const SEED = 'belegwerk-register-v1';
export const sha = (s) => createHash('sha256').update(s).digest('hex');

const zeilen = (pfad) => readFileSync(pfad, 'utf8').trim().split('\n').slice(1);

/** Wirft, wenn die Nummer mit anderen Daten schon vergeben ist. Läuft
 *  VOR dem Setzen des PDFs — sonst läge die geänderte Fassung schon auf
 *  der Platte, während das Register sie ablehnt. */
export function vertraeglich(pfad, nummer, datenhash) {
  if (!existsSync(pfad)) return;
  const vorhanden = zeilen(pfad).find((z) => z.split(';')[0] === nummer);
  if (vorhanden && vorhanden.split(';')[3] !== datenhash) {
    throw new Error(`${nummer} steht mit ANDEREN Daten im Register. Ausgestellte Rechnungen werden nicht geändert — stornieren und neu ausstellen.`);
  }
}

/** Die Sperre gegen überlappende Läufe: Zwei gleichzeitige Prozesse —
 *  etwa ein doppelt angestoßener Timer neben einem Hand-Aufruf — dürfen
 *  ihre Registerzeilen nicht verschränken, sonst hängen beide Ketten am
 *  selben Vorgänger. `wx` legt die Sperrdatei atomar an; eine Sperre,
 *  die älter ist als 60 s, stammt aus einem abgestürzten Lauf und wird
 *  übernommen — ein Absturz darf das Register nicht für immer sperren. */
function sperren(pfad) {
  const lock = `${pfad}.lock`;
  try {
    writeFileSync(lock, String(process.pid), { flag: 'wx' });
    return () => { try { unlinkSync(lock); } catch {} };
  } catch {
    let alterMs = 0;
    try { alterMs = Date.now() - statSync(lock).mtimeMs; } catch { return sperren(pfad); }
    if (alterMs > 60_000) {
      try { unlinkSync(lock); } catch {}
      return sperren(pfad);
    }
    throw new Error('Register ist gesperrt (register.csv.lock) — läuft gerade ein zweiter belegwerk-Prozess? Sperren über 60 s gelten als verwaist und werden automatisch übernommen.');
  }
}

/** Trägt eine Rechnung ein: 'neu' | 'unveraendert'. */
export function eintragen(pfad, { nummer, datum, brutto, datenhash }) {
  const freigeben = sperren(pfad);
  try {
    vertraeglich(pfad, nummer, datenhash);
    if (!existsSync(pfad)) writeFileSync(pfad, 'nummer;datum;brutto;datenhash;kettenhash\n');
    const alle = zeilen(pfad);
    const vorhanden = alle.find((z) => z.split(';')[0] === nummer);
    if (vorhanden) return 'unveraendert';
    const letzte = alle.at(-1)?.split(';')[4] ?? '';
    const inhalt = `${nummer};${datum};${brutto};${datenhash}`;
    appendFileSync(pfad, `${inhalt};${sha((letzte || SEED) + inhalt)}\n`);
    return 'neu';
  } finally {
    freigeben();
  }
}

/** Prüft die Kette. Gibt eine Liste von Fehlern zurück — leer heißt in Ordnung. */
export function pruefen(pfad) {
  if (!existsSync(pfad)) return { anzahl: 0, fehler: [] };
  const alle = zeilen(pfad);
  const fehler = [];
  const nummern = new Set();
  let kette = '';
  for (const [i, z] of alle.entries()) {
    const [nummer, datum, brutto, datenhash, kettenhash] = z.split(';');
    const soll = sha((kette || SEED) + `${nummer};${datum};${brutto};${datenhash}`);
    if (soll !== kettenhash) fehler.push(`Zeile ${i + 2} (${nummer}): Kette gebrochen — Register wurde nachträglich verändert.`);
    if (nummern.has(nummer)) fehler.push(`Zeile ${i + 2}: Rechnungsnummer ${nummer} doppelt.`);
    nummern.add(nummer);
    kette = kettenhash;
  }
  return { anzahl: alle.length, fehler };
}
