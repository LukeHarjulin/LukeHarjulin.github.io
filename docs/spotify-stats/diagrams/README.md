# Spotify Listening Stats Architecture Diagrams

These editable Mermaid sources document the approved architecture only. They do not introduce new product, API, schema, security, hosting, or deployment decisions.

## Diagram Index

### 01 - System Context

[`01-system-context.mmd`](01-system-context.mmd) shows the public GitHub Pages frontend, Cloudflare custom domain and Worker ingress, server-side D1 and Spotify credential boundary, Spotify services, Cron Trigger, and GitHub Actions deployment path.

Grounded in:

- [`../Overview and Architecture.md`](../Overview%20and%20Architecture.md)
- [`../../../wrangler.example.toml`](../../../wrangler.example.toml)
- [`../../../workers/spotify-stats/src/index.ts`](../../../workers/spotify-stats/src/index.ts)
- [`../../../.github/workflows/deploy.yml`](../../../.github/workflows/deploy.yml)

### 02 - Scheduled Ingestion

[`02-scheduled-ingestion.mmd`](02-scheduled-ingestion.mmd) follows the five-minute scheduled handler through cursor lookup, access-token refresh, recently-played retrieval, normalization, deduplication, D1 batch writes, database uniqueness, cursor advancement, and failure behavior.

Grounded in:

- [`../../../workers/spotify-stats/src/index.ts`](../../../workers/spotify-stats/src/index.ts)
- [`../../../workers/spotify-stats/src/spotify.ts`](../../../workers/spotify-stats/src/spotify.ts)
- [`../../../workers/spotify-stats/src/ingest.ts`](../../../workers/spotify-stats/src/ingest.ts)
- [`../../../workers/spotify-stats/migrations/0001_initial.sql`](../../../workers/spotify-stats/migrations/0001_initial.sql)

### 03 - Public Read Paths

[`03-public-read-paths.mmd`](03-public-read-paths.mmd) separates live now-playing behavior from D1-only aggregate, recent, and archive reads. It records the latest-play fallback, exact-origin CORS, cache policy, response envelopes, and absence of a raw-history endpoint.

Grounded in:

- [`../../../workers/spotify-stats/src/router.ts`](../../../workers/spotify-stats/src/router.ts)
- [`../../../workers/spotify-stats/src/http.ts`](../../../workers/spotify-stats/src/http.ts)
- [`../API Reference and Privacy.md`](../API%20Reference%20and%20Privacy.md)

### 04 - D1 Data Model

[`04-d1-data-model.mmd`](04-d1-data-model.mmd) represents the exact six-table D1 schema, including primary keys, foreign keys, composite uniqueness, ordered track-artist credits, and entity cardinalities.

Grounded in:

- [`../../../workers/spotify-stats/migrations/0001_initial.sql`](../../../workers/spotify-stats/migrations/0001_initial.sql)

### 05 - Operator Deployment

[`05-operator-deployment.mmd`](05-operator-deployment.mmd) maps the manual-first release process from Spotify app authorization and ignored local configuration through D1 migration, validated Worker deployment, custom-domain and Cron activation, GitHub Actions configuration, Astro build, and GitHub Pages deployment.

Grounded in:

- [`../Spotify Setup.md`](../Spotify%20Setup.md)
- [`../Cloudflare Setup.md`](../Cloudflare%20Setup.md)
- [`../../../tools/spotify_oauth_bootstrap.ps1`](../../../tools/spotify_oauth_bootstrap.ps1)
- [`../../../tools/deploy_spotify_worker.ps1`](../../../tools/deploy_spotify_worker.ps1)
- [`../../../.github/workflows/deploy.yml`](../../../.github/workflows/deploy.yml)

## Open in draw.io

For each `.mmd` file:

1. Open the source in a text editor and copy all content.
2. Open [draw.io](https://app.diagrams.net/).
3. Choose **Arrange > Insert > Advanced > Mermaid**.
4. Paste the source, choose the editable diagram option, and select **Insert**.
5. Save as `.drawio` only when a native working copy is needed; keep the `.mmd` file as the reviewed source of truth.

The same sources can be opened through Codex with the Draw.io MCP `open_drawio_mermaid` tool.
