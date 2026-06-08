# dashterm homehub

The self-hostable DashTerm backend, packaged as a single `docker compose up`.

Intended for operators who'd rather run DashTerm on their own infrastructure
than depend on a hosted product. There is no hosted tier: you run this; the
paid mobile app connects to it.

## What's in the box

| Service | Image | What it does |
|---|---|---|
| `postgres` | `supabase/postgres` | Database + WAL replication for Realtime |
| `auth` | `supabase/gotrue` | Email/password + OAuth providers |
| `rest` | `postgrest/postgrest` | REST CRUD over Postgres |
| `realtime` | `supabase/realtime` | Websocket fanout of `postgres_changes` |
| `storage` | `supabase/storage-api` | RLS-aware object store (optional but kept) |
| `kong` | `kong:2.8.1` | Single public port for the above |
| `studio` | `supabase/studio` | Admin UI (dev profile only) |
| `compile` | dashterm | Compiles vibe-coded TSX → JS |
| `web` | dashterm | Caddy serving the web bundle |

**Schema bootstrap (two phases):**

- `postgres-init/00_service_roles.sh` runs once during first Postgres
  initialisation. It creates the Supabase service roles
  (`supabase_admin`, `supabase_auth_admin`, `supabase_storage_admin`,
  `supabase_realtime_admin`, `authenticator` + `anon`/`authenticated`/
  `service_role`) and pre-creates the `auth` and `storage` schemas owned
  by their service users. Without this, GoTrue can't bootstrap.
- `migrations/*.sql` are applied AFTER the stack is up via
  `dashterm homehub migrate`. They reference `auth.users`, so they have
  to wait until GoTrue has run its own first-boot migrations. The
  `dashterm homehub up` command runs `migrate` automatically once
  `auth.users` is visible (typically ~10s after first `up`).

Requires Docker Compose v2.6+ (top-level `name:` plus `--wait`); on
older Compose the CLI falls back to a hand-rolled poll loop, so it
still works on v2.2+.

## Install

```
cd services/homehub
cp .env.example .env
# fill in passwords / Google OAuth client id if you want it
docker compose up -d
dashterm homehub migrate     # apply the schema once auth is up
```

Or use the CLI for everything (which generates the secrets and
applies the schema automatically):

```
dashterm homehub init     # writes .env + checks Docker is available
dashterm homehub up       # docker compose up -d, waits for healthchecks
dashterm homehub logs     # tail logs
dashterm homehub down     # stop everything (data persists in volumes)
dashterm homehub migrate  # rerun pending migrations against the running DB
```

Once up, the UI is at `http://localhost:8082`, the API at `http://localhost:8000`,
and Supabase Studio (admin) at `http://localhost:3001` if you ran with
`docker compose --profile dev up -d`.

## Auth

GoTrue ships with email/password enabled and auto-confirm on. For Google
sign-in: create OAuth client credentials in Google Cloud Console, set
`GOOGLE_OAUTH_ENABLED=true` plus the client ID + secret, restart `auth`.

This bundle does **not** run a SMTP server. Email confirmation works in
auto-confirm mode (no email is sent). To enable real email delivery, add the
`GOTRUE_SMTP_*` env vars; see the GoTrue docs.

## Upgrades

```
git pull
docker compose pull
docker compose up -d --no-deps --build web compile
docker compose exec postgres psql -U postgres -d dashterm -f /migrations/00X_*.sql
```

The `migrate` CLI command does the SQL step automatically.

## Backups

Postgres data lives in the `postgres-data` Docker volume. The simplest
backup is `pg_dump`:

```
docker compose exec postgres pg_dump -U postgres dashterm > backup.sql
```

Storage objects live in the `storage-data` volume. `docker run --rm -v
dashterm-homehub_storage-data:/data alpine tar czf - /data > storage.tgz`.

## What's NOT in here (intentionally)

- A reverse proxy with TLS. Run Caddy or Traefik in front; this bundle
  speaks plain HTTP so you can put it behind your existing setup.
- A SMTP server. Use an external provider if you need email.
- Email/SMS providers for auth flows other than Google.
- Backups. Use `pg_dump` + your favourite cron.

## Troubleshooting

- **`pg_isready` keeps failing**: usually a `POSTGRES_PASSWORD` mismatch
  between `.env` and an existing `postgres-data` volume. Either match the
  password or wipe the volume (`docker compose down -v`).
- **Realtime won't subscribe**: the migration `001_init.sql` tries to add
  tables to the `supabase_realtime` publication. If Realtime came up first
  and didn't create the publication, restart `realtime` after Postgres is
  healthy.
- **`401` on every API call**: the `anon` key in `.env` and the `anon` key
  baked into the web container don't match. Rebuild the web container after
  changing the key: `docker compose up -d --no-deps --build web`.
