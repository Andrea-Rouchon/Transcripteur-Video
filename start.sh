#!/usr/bin/env bash
# Démarrage simplifié du transcripteur.
# Tue les anciens serveurs, lance Next.js (webpack, port libre) et ouvre le navigateur.

set -u
cd "$(dirname "$0")"

PORT="${PORT:-3000}"

echo "==> Nettoyage des anciens processus Next.js…"
pkill -f "next dev" 2>/dev/null
pkill -f "next/dist/server/lib/start-server" 2>/dev/null
pkill -f "next-server" 2>/dev/null
pkill -f "node_modules/next/dist/bin/next" 2>/dev/null
sleep 2

# Si le port demandé est occupé, on en cherche un libre.
while lsof -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; do
  echo "    Port $PORT occupé, essai du suivant…"
  PORT=$((PORT + 1))
done

LOG="/tmp/transcripteur-next.log"
: > "$LOG"

echo "==> Démarrage de Next.js sur le port $PORT (webpack)…"
NEXT_TELEMETRY_DISABLED=1 node node_modules/next/dist/bin/next dev --port "$PORT" --webpack > "$LOG" 2>&1 &
SERVER_PID=$!

# Nettoyage automatique si on Ctrl-C
trap 'echo; echo "==> Arrêt du serveur (PID $SERVER_PID)"; kill $SERVER_PID 2>/dev/null; exit 0' INT TERM

echo "==> En attente du démarrage (peut prendre quelques minutes la première fois)…"
READY=0
for i in {1..600}; do
  if grep -q "Ready in" "$LOG" 2>/dev/null; then
    READY=1
    break
  fi
  if ! kill -0 $SERVER_PID 2>/dev/null; then
    echo "✗ Le serveur s'est arrêté. Logs :"
    cat "$LOG"
    exit 1
  fi
  sleep 1
done

if [ "$READY" -ne 1 ]; then
  echo "✗ Timeout : le serveur n'est pas devenu prêt en 10 min."
  kill $SERVER_PID 2>/dev/null
  exit 1
fi

URL="http://localhost:$PORT"
echo "✓ Serveur démarré sur $URL"
echo "==> Pré-compilation de la page d'accueil (peut prendre 1-2 min)…"
# Première requête pour déclencher la compilation webpack (qui peut être lente).
# On le fait nous-mêmes pour ne pas que le navigateur de l'utilisateur affiche un timeout.
curl -s --max-time 300 "$URL/" > /dev/null 2>&1 &
CURL_PID=$!
while kill -0 $CURL_PID 2>/dev/null; do
  printf "."
  sleep 2
done
echo
echo "✓ Page prête."
echo "    Logs : $LOG"
echo "    Ctrl-C pour arrêter."

# Ouvre le navigateur (macOS).
open "$URL" 2>/dev/null || true

# Affiche les logs en continu jusqu'à Ctrl-C.
tail -f "$LOG"
