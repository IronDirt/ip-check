#!/usr/bin/env bash
set -euo pipefail

APP_NAME="ip-check"
APP_DIR_DEFAULT="/opt/ip-check"
PORT_DEFAULT="3000"

APP_DIR="${APP_DIR:-$APP_DIR_DEFAULT}"
APP_USER="${APP_USER:-${SUDO_USER:-$USER}}"
PORT="${PORT:-$PORT_DEFAULT}"
REPO_URL="${REPO_URL:-}"

if [[ "${EUID}" -ne 0 ]]; then
  echo "[ERRORE] Esegui come root: sudo bash setup-vps.sh"
  exit 1
fi

if ! command -v apt >/dev/null 2>&1; then
  echo "[ERRORE] Script pensato per Debian/Ubuntu (apt)."
  exit 1
fi

echo "[1/7] Installo pacchetti base..."
apt update
apt install -y nodejs npm iputils-ping git curl

echo "[2/7] Preparo directory applicazione..."
if [[ -n "$REPO_URL" ]]; then
  if [[ -d "$APP_DIR/.git" ]]; then
    echo "Repo già presente in $APP_DIR, aggiorno..."
    git -C "$APP_DIR" pull --ff-only
  else
    rm -rf "$APP_DIR"
    git clone "$REPO_URL" "$APP_DIR"
  fi
else
  if [[ -f "./package.json" && -f "./server.js" ]]; then
    APP_DIR="$(pwd)"
    echo "Uso progetto corrente: $APP_DIR"
  else
    echo "[ERRORE] REPO_URL non impostata e cartella corrente non valida."
    echo "Soluzione 1: entra nella cartella del progetto e rilancia."
    echo "Soluzione 2: sudo REPO_URL='https://...git' bash setup-vps.sh"
    exit 1
  fi
fi

chown -R "$APP_USER":"$APP_USER" "$APP_DIR"

echo "[3/7] Installo dipendenze Node..."
sudo -u "$APP_USER" bash -lc "cd '$APP_DIR' && npm install --omit=dev"

NODE_BIN="$(command -v node || true)"
if [[ -z "$NODE_BIN" ]]; then
  echo "[ERRORE] Node non trovato dopo installazione."
  exit 1
fi

echo "[4/7] Configuro systemd service..."
SERVICE_PATH="/etc/systemd/system/${APP_NAME}.service"
TEMPLATE_PATH="$APP_DIR/ip-check.service.example"

if [[ -f "$TEMPLATE_PATH" ]]; then
  cp "$TEMPLATE_PATH" "$SERVICE_PATH"
else
  cat > "$SERVICE_PATH" <<EOF
[Unit]
Description=IP Check Node Service
After=network.target

[Service]
Type=simple
User=$APP_USER
WorkingDirectory=$APP_DIR
Environment=NODE_ENV=production
Environment=PORT=$PORT
ExecStart=$NODE_BIN $APP_DIR/server.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
fi

sed -i "s|^User=.*|User=$APP_USER|" "$SERVICE_PATH"
sed -i "s|^WorkingDirectory=.*|WorkingDirectory=$APP_DIR|" "$SERVICE_PATH"
sed -i "s|^Environment=PORT=.*|Environment=PORT=$PORT|" "$SERVICE_PATH"

if grep -q '^ExecStart=' "$SERVICE_PATH"; then
  sed -i "s|^ExecStart=.*|ExecStart=$NODE_BIN $APP_DIR/server.js|" "$SERVICE_PATH"
else
  printf '\nExecStart=%s %s/server.js\n' "$NODE_BIN" "$APP_DIR" >> "$SERVICE_PATH"
fi

echo "[5/7] Avvio e abilito servizio..."
systemctl daemon-reload
systemctl enable "$APP_NAME"
systemctl restart "$APP_NAME"

echo "[6/7] Verifico stato servizio..."
systemctl --no-pager --full status "$APP_NAME" || true

echo "[7/7] Test backend..."
HEALTH_URL="http://127.0.0.1:${PORT}/api/health"
if curl -fsS "$HEALTH_URL" >/dev/null; then
  echo "[OK] Backend operativo: $HEALTH_URL"
  curl -s "$HEALTH_URL"
  echo
else
  echo "[WARN] Health check fallito: $HEALTH_URL"
  echo "Controlla log: sudo journalctl -u $APP_NAME -n 100 --no-pager"
fi

echo "\nComandi utili:"
echo "- Stato: sudo systemctl status $APP_NAME --no-pager"
echo "- Log:   sudo journalctl -u $APP_NAME -f"
echo "- Test:  curl -s $HEALTH_URL"
