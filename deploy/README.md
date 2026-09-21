# Roam area catalog deployment

This Compose stack runs a private PostGIS catalog, the authenticated Roam area
API, Caddy for HTTPS, and a manual single-process OSM importer. Postgres is not
published to the host; only Caddy exposes ports 80 and 443.

## First deployment

1. Point an `A` record for `areas.your-domain.example` to the server IPv4 and,
   if used, an `AAAA` record to its IPv6. Confirm both records have propagated.
2. Copy `.env.areas.production.example` to `.env.areas.production` and replace
   every placeholder. `AREA_ALLOWED_ORIGIN` must exactly match the frontend's
   public origin. Do not use a Supabase service-role key here.
3. Start the catalog:

   ```bash
   docker compose --env-file .env.areas.production up -d --build
   docker compose --env-file .env.areas.production ps
   ```

4. Check that the database migration and API are healthy:

   ```bash
   docker compose --env-file .env.areas.production logs --tail=100 postgres area-api caddy
   ```

## Import a regional OSM extract

Download a `.osm.pbf` extract into the ignored `data/` directory. Begin with a
small extract. The `importer` profile is intentionally manual so two imports
cannot accidentally run at once.

```bash
mkdir -p data
# Place a PBF at data/stockholm.osm.pbf, then:
docker compose --env-file .env.areas.production --profile import run --rm importer stockholm SE /data/stockholm.osm.pbf
```

For a larger extract, temporarily rescale or create a short-lived importer
server with more memory. Do not run a country-sized `osm2pgsql` import on the
CPX22.

## Update the app

Build the frontend with:

```dotenv
VITE_AREA_CATALOG=true
VITE_AREA_API_URL=https://areas.your-domain.example/api/areas
```

The app's existing Supabase session supplies the access token to the area API.

Do not expose the API over plain HTTP: every authenticated request includes a
Supabase access token. While waiting for DNS, set `CADDY_SITE_ADDRESS=:80` plus
`CADDY_HTTP_BIND=127.0.0.1:80` and `CADDY_HTTPS_BIND=127.0.0.1:443` in the
server environment file. Remove those two bind settings and set the hostname
only after DNS is live; Caddy will then obtain and renew HTTPS certificates.
