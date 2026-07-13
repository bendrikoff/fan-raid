# Fan Raid Docker

## Start

```powershell
docker compose up --build
```

Open:

- Frontend: http://localhost
- Backend health through web proxy: http://localhost/api/health

`docker-compose.yml` reads the local `.env` file. If you want to run without TxODDS, keep:

```env
FEED_SOURCE=sim
DEV_MODE=true
TXODDS_API_KEY=
```

For TxODDS, keep your existing `TXODDS_*` values in `.env`; compose passes them to the backend container.

## HTTPS

The stack uses Caddy as the public reverse proxy. The `web` and `server` containers stay internal.

For a production VPS:

1. Point a domain A record to the VPS IP.
2. Open ports `80/tcp` and `443/tcp` on the VPS firewall.
3. Set the domain in `/opt/fan-raids/.env`:

```env
APP_DOMAIN=fanraid.example.com
```

4. Deploy normally. Caddy will issue and renew the HTTPS certificate automatically.

Wallet login must be opened through `https://APP_DOMAIN`. Browser wallet extensions usually do not inject a wallet provider on plain HTTP non-localhost pages.

## Runtime Data

The backend stores persistent runtime data in the named Docker volume `fan-raids_fan_raid_server_data`:

- `/data/fan-raid.sqlite` - SQLite database
- `/data/recordings` - match recordings
- `/data/uploads/avatars` - uploaded avatars
- `/data/solana-keypair.json` - Solana keypair path used by the container

## Useful Commands

```powershell
docker compose up --build -d
docker compose logs -f server
docker compose logs -f web
docker compose logs -f caddy
docker compose down
```

To delete all local Docker runtime data:

```powershell
docker compose down -v
```
