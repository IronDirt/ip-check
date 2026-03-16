# IP Check

Web app per:

- rilevare IP pubblico
- ping verso IP
- lookup DNS
- geolocalizzazione IP con mappa

## Installazione VPS Linux (veloce)

### Opzione consigliata: script automatico

Da dentro la cartella progetto:

```bash
chmod +x setup-vps.sh
sudo bash setup-vps.sh
```

Se vuoi installare clonando direttamente da repository:

```bash
sudo REPO_URL="https://github.com/ORG/REPO.git" APP_DIR="/opt/ip-check" APP_USER="www-data" PORT="3000" bash setup-vps.sh
```

Lo script:

- installa dipendenze (`nodejs`, `npm`, `iputils-ping`, `git`, `curl`)
- installa dipendenze Node del progetto
- configura/aggiorna `systemd`
- avvia il servizio
- esegue health check `/api/health`

### 1) Requisiti

- Node.js 18+ (consigliato 20 LTS)
- npm
- `ping` (`iputils-ping` su Debian/Ubuntu)

Debian/Ubuntu:

```bash
sudo apt update
sudo apt install -y nodejs npm iputils-ping git
```

### 2) Scarica progetto e avvia

```bash
cd /opt
sudo git clone <URL_REPO> ip-check
sudo chown -R $USER:$USER /opt/ip-check
cd /opt/ip-check
npm install
PORT=3000 npm start
```

Apri: `http://SERVER_IP:3000`

### 3) Health check immediato

```bash
curl -s http://127.0.0.1:3000/api/health
```

Se risponde JSON con `"status":"ok"`, backend attivo.

## Avvio automatico con systemd (consigliato)

Nel repo c'è un template: `ip-check.service.example`.

```bash
cd /opt/ip-check
sudo cp ip-check.service.example /etc/systemd/system/ip-check.service
sudo nano /etc/systemd/system/ip-check.service
```

Controlla questi campi nel service:

- `User`
- `WorkingDirectory`
- `ExecStart` (path reale di `node`, verifica con `which node`)

Poi abilita il servizio:

```bash
sudo systemctl daemon-reload
sudo systemctl enable ip-check
sudo systemctl restart ip-check
sudo systemctl status ip-check --no-pager
```

Log live:

```bash
sudo journalctl -u ip-check -f
```

## Nginx reverse proxy (opzionale)

```nginx
server {
  listen 80;
  server_name tuo-dominio.it;

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

## FAIL comuni e fix rapidi

### 1) `node: command not found` o `npm: command not found`

```bash
sudo apt update
sudo apt install -y nodejs npm
node -v
npm -v
```

### 2) Pagina si apre ma Ping/DNS/Map non funzionano

Causa tipica: sito servito come statico (senza backend Node).

Verifica:

```bash
curl -s http://127.0.0.1:3000/api/health
```

Se non risponde, avvia backend con `npm start` o `systemd`.

### 3) `502 Bad Gateway` con Nginx

Backend non raggiungibile su `127.0.0.1:3000`.

```bash
sudo systemctl status ip-check --no-pager
sudo journalctl -u ip-check -n 80 --no-pager
curl -s http://127.0.0.1:3000/api/health
```

### 4) Ping fallisce sempre

```bash
which ping
getcap "$(which ping)"
ping -c 1 8.8.8.8
```

Se `ping` non c'è:

```bash
sudo apt install -y iputils-ping
```

Nota: alcuni VPS/firewall bloccano ICMP in uscita.

### 5) DNS lookup non restituisce record

Controlla risoluzione lato server:

```bash
dig google.com A +short
```

Se `dig` manca:

```bash
sudo apt install -y dnsutils
```

### 6) Mappa IP vuota

Possibili cause:

- server senza accesso Internet verso servizi geo
- blocchi DNS/egress
- egress HTTP (porta 80) bloccato dal provider/firewall

Test rapido:

```bash
curl -s http://127.0.0.1:3000/api/geoip/me
curl -I http://ip-api.com
curl -I https://ipapi.co
```

Se `ip-api.com` fallisce ma `ipapi.co` risponde, le versioni recenti del backend usano fallback HTTPS automatico.

## Note importanti

- Le feature complete usano endpoint backend `/api/*`: non pubblicare solo `index.html` come sito statico.
- In frontend ci sono fallback per geo/DNS quando backend non raggiungibile, ma il Ping resta server-side.
