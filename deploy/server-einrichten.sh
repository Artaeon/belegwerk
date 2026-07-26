#!/bin/sh
# belegwerk auf einem frischen Server einrichten — einmal, als root.
#
#   ./server-einrichten.sh <werkzeug-git-url> <mandant-git-url>
#
# Danach läuft: der Monats-Timer (wiederkehrende Rechnungen + Push),
# die Wochenprüfung ist als Cron-Zeile ausgegeben. Voraussetzungen:
# bun und git am Server, SSH-Zugriff auf beide (privaten!) Repos.
set -eu

WERKZEUG_URL="${1:?Aufruf: server-einrichten.sh <werkzeug-git-url> <mandant-git-url>}"
MANDANT_URL="${2:?Aufruf: server-einrichten.sh <werkzeug-git-url> <mandant-git-url>}"
BASIS=/srv/belegwerk
MANDANT_NAME="$(basename "$MANDANT_URL" .git)"

command -v bun >/dev/null || { echo "✗ bun fehlt — https://bun.sh"; exit 1; }
command -v git >/dev/null || { echo "✗ git fehlt"; exit 1; }

mkdir -p "$BASIS"
[ -d "$BASIS/belegwerk" ]        || git clone "$WERKZEUG_URL" "$BASIS/belegwerk"
[ -d "$BASIS/$MANDANT_NAME" ]    || git clone "$MANDANT_URL"  "$BASIS/$MANDANT_NAME"
( cd "$BASIS/belegwerk" && bun install )

# Probelauf VOR dem Timer: Ein Timer auf einem kaputten Mandanten ist
# ein nächtlicher Fehler, den niemand sieht.
( cd "$BASIS/$MANDANT_NAME" && bun "$BASIS/belegwerk/src/belegwerk.mjs" pruefen )

cat > /etc/systemd/system/belegwerk-monatlich.service <<EOF
[Unit]
Description=belegwerk: wiederkehrende Rechnungen des Monats ausstellen

[Service]
Type=oneshot
WorkingDirectory=$BASIS/$MANDANT_NAME
ExecStart=/bin/sh -c 'bun $BASIS/belegwerk/src/belegwerk.mjs wiederkehrend && \\
  git add -A && \\
  (git diff --cached --quiet || git commit -m "Monatsrechnungen \$(date +%%Y-%%m)") && \\
  git push'
EOF

cat > /etc/systemd/system/belegwerk-monatlich.timer <<EOF
[Unit]
Description=belegwerk: am Monatsersten ausstellen

[Timer]
OnCalendar=*-*-01 06:00
Persistent=true

[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
systemctl enable --now belegwerk-monatlich.timer

echo "✓ Timer aktiv:"
systemctl list-timers belegwerk-monatlich.timer --no-pager || true
echo ""
echo "Noch von Hand in die Crontab (Wochenprüfung + Forderungsbericht per Mail):"
echo "  0 7 * * 1  cd $BASIS/$MANDANT_NAME && bun $BASIS/belegwerk/src/belegwerk.mjs pruefen || echo belegwerk-Warnung | mail -s belegwerk office@…"
echo "  5 7 * * 1  cd $BASIS/$MANDANT_NAME && bun $BASIS/belegwerk/src/belegwerk.mjs offen | mail -s 'offene Forderungen' office@…"
