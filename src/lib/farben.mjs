/**
 * TERMINALFARBEN — die Marke, soweit ein Terminal sie trägt.
 *
 * Registergrün für gültige Zustände, Werkorange für Fehler und Akzent,
 * Graphit für Nebensächliches — dieselbe Semantik wie im Dokument.
 * Farben nur, wenn ein Mensch zusieht: In Pipes, Cron-Mails und bei
 * gesetztem NO_COLOR bleibt die Ausgabe reiner Text — eine Log-Datei
 * voller Escape-Sequenzen ist keine Marke, sondern Lärm.
 */
const an = process.stdout.isTTY && !process.env.NO_COLOR;
const mit = (code) => (s) => (an ? `\x1b[${code}m${s}\x1b[0m` : String(s));

export const gruen = mit('38;2;53;91;74');    /* Registergrün #355B4A */
export const orange = mit('38;2;184;75;37');  /* Werkorange  #B84B25 */
export const grau = mit('38;2;108;110;104');  /* Graphit     #6C6E68 */
export const fett = mit('1');

export const OK = gruen('✓');
export const FEHLT = orange('✗');
export const HINWEIS = grau('○');
export const WARNUNG = orange('⚠');
