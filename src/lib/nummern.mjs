/**
 * NUMMERNKREIS — fortlaufend, lückenlos, aus dem Register abgeleitet.
 *
 * firma.json bestimmt das Muster: { "nummern": { "muster": "RE-{jahr}-{nr}",
 * "breite": 3 } }. Die nächste Nummer ergibt sich aus dem Register —
 * es gibt keinen zweiten Zähler, der auseinanderlaufen könnte.
 */
import { readFileSync, existsSync } from 'node:fs';

const MUSTER_STANDARD = { muster: 'RE-{jahr}-{nr}', breite: 3, start: 1 };

const registerNummern = (pfad) =>
  existsSync(pfad)
    ? readFileSync(pfad, 'utf8').replace(/\r/g, '').trim().split('\n').slice(1).map((z) => z.split(';')[0])
    : [];

/** Die nächste freie Nummer für ein Jahr. `start` verschiebt den
 *  Beginn des Kreises — wer bei 100 anfangen will (etwa damit die
 *  erste Rechnung nicht als erste erkennbar ist, oder um einen
 *  Altbestand unterhalb freizuhalten), setzt nummern.start: 100.
 *  Sobald Nummern vergeben sind, zählt wieder allein das Register. */
export function naechste(firma, registerPfad, jahr) {
  const { muster, breite, start } = { ...MUSTER_STANDARD, ...firma.nummern };
  const prefix = muster.replace('{jahr}', jahr).split('{nr}')[0];
  const hoechste = registerNummern(registerPfad)
    .filter((n) => n.startsWith(prefix))
    .map((n) => parseInt(n.slice(prefix.length), 10))
    .filter(Number.isFinite)
    .reduce((a, b) => Math.max(a, b), start - 1);
  return muster.replace('{jahr}', jahr).replace('{nr}', String(hoechste + 1).padStart(breite, '0'));
}

/** Lückenprüfung: je Präfix müssen die laufenden Nummern dicht sein.
 *  Gibt Warnungen zurück — eine Lücke ist bei einer Betriebsprüfung eine
 *  Frage, die man beantworten können muss. */
export function luecken(registerPfad) {
  const gruppen = new Map();
  for (const n of registerNummern(registerPfad)) {
    const m = n.match(/^(.*?)(\d+)$/);
    if (!m) continue;
    if (!gruppen.has(m[1])) gruppen.set(m[1], []);
    gruppen.get(m[1]).push(parseInt(m[2], 10));
  }
  const warnungen = [];
  for (const [prefix, nrn] of gruppen) {
    const sortiert = [...nrn].sort((a, b) => a - b);
    for (let i = 1; i < sortiert.length; i++) {
      for (let f = sortiert[i - 1] + 1; f < sortiert[i]; f++) {
        warnungen.push(`Lücke im Nummernkreis: ${prefix}${f} fehlt zwischen ${prefix}${sortiert[i - 1]} und ${prefix}${sortiert[i]}.`);
      }
    }
  }
  return warnungen;
}
