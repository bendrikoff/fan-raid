# Fan Raid Docker

## Start

```powershell
docker compose up --build
```

Open:

- Frontend: http://localhost:5173
- Backend health: http://localhost:8080/api/health

`docker-compose.yml` reads the local `.env` file. If you want to run without TxODDS, keep:

```env
FEED_SOURCE=sim
DEV_MODE=true
TXODDS_API_KEY=
```

For TxODDS, keep your existing `TXODDS_*` values in `.env`; compose passes them to the backend container.

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
docker compose down
```

To delete all local Docker runtime data:

```powershell
docker compose down -v
```
