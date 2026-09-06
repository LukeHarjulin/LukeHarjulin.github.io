# Cloudflare Setup

Back to [[Spotify Stats]]. Spotify-specific prerequisites are in [[Spotify Setup]].

## Configuration Values

The committed example contains the approved non-secret production values. Only the Cloudflare-generated D1 ID remains a placeholder:

```toml
name = "spotify-listening-stats"
main = "workers/spotify-stats/src/index.ts"
compatibility_date = "2026-08-27"
workers_dev = false

[[routes]]
pattern = "spotify-api.lukeharjulin.com"
custom_domain = true

[triggers]
crons = ["*/5 * * * *"]

[observability]
enabled = true
head_sampling_rate = 1

[vars]
PUBLIC_SITE_ORIGIN = "https://www.lukeharjulin.com"

[secrets]
required = [
  "SPOTIFY_CLIENT_ID",
  "SPOTIFY_CLIENT_SECRET",
  "SPOTIFY_REFRESH_TOKEN",
]

[[d1_databases]]
binding = "DB"
database_name = "spotify-listening"
database_id = "<D1_DATABASE_ID>"
migrations_dir = "workers/spotify-stats/migrations"
```

The custom domain is intentionally host-only in Wrangler's route configuration. The public API origin supplied to the frontend includes the scheme: `https://spotify-api.lukeharjulin.com`. The required-secrets declaration limits local dotenv loading to the three Spotify keys and makes Wrangler reject a deployment when any of those Worker secrets is absent.

Workers Logs are enabled at 100% head sampling for initial Cron verification. Workers Traces and external log export remain disabled. The pinned Wrangler version does not expose Cloudflare's API-level `redact_query_string` setting, so avoid production archive searches during diagnosis and resolve the invocation-log privacy question before broad release. Reassess the sampling rate if request volume grows beyond the included allowance or longer retention becomes necessary.

## Manual Cloudflare Provisioning

1. Authenticate Wrangler with the intended Cloudflare account.
2. Open the Cloudflare Workers & Pages account overview once and initialize the approved account subdomain `l-harjulin.workers.dev`. This account prerequisite does not expose the Spotify Worker because its configuration keeps `workers_dev = false`.
3. Create the approved D1 database in Western Europe: `pnpm exec wrangler d1 create spotify-listening --location=weur`.
4. Copy `wrangler.example.toml` to the ignored `wrangler.toml` and replace only `<D1_DATABASE_ID>` with the generated ID.
5. Confirm the `lukeharjulin.com` zone is active in the same Cloudflare account and that the approved custom hostname has no conflicting DNS record, Worker route, or custom domain.
6. Complete the one-time authorization in [[Spotify Setup]].
7. Apply D1 migrations locally first, then to the remote database.
8. Deploy the Worker manually with `pnpm worker:deploy`. This validates `.dev.vars` and sends only the three declared Spotify secrets alongside the code. For the first controlled deployment, set `crons = []` in the `[triggers]` block of the ignored `wrangler.toml`; restore the approved schedule only after ingestion is verified. Omitting or commenting out the key does not remove an existing deployed trigger.
9. Test the public endpoints and a controlled scheduled invocation.
10. Restore the approved five-minute Cron Trigger and deploy the configuration again.

The generated D1 ID must not be copied into this knowledge base or committed configuration.

## Local Development

Copy the committed example to the ignored deployable configuration and replace the D1 placeholder with a local test value or the Cloudflare-provided ID:

```powershell
Copy-Item wrangler.example.toml wrangler.toml
pnpm d1:migrate:local
pnpm worker:dev
```

Wrangler local state is stored under the ignored `.wrangler/` directory. Generate local Spotify values with `pnpm spotify:oauth`, which writes the ignored `.dev.vars` file. For local browser testing, change `PUBLIC_SITE_ORIGIN` only in the ignored `wrangler.toml` to Astro's exact local origin; do not use `*`.

In a separate shell, point Astro at the Worker origin printed by Wrangler:

```powershell
$env:PUBLIC_SPOTIFY_API_BASE_URL = "http://localhost:8787"
pnpm dev
```

For a long-running localhost preview while keeping `wrangler.toml` production-ready, copy it to the ignored `wrangler.local.toml`, change only `PUBLIC_SITE_ORIGIN` there, and start Wrangler with `pnpm exec wrangler dev --config wrangler.local.toml --test-scheduled`. The local file retains the production Worker name so local binding behavior matches; never pass it to `wrangler deploy`. The repository deploy script always uses `wrangler.toml`.

Run verification with:

```powershell
pnpm spotify:oauth:test
pnpm spotify:history:test
pnpm worker:test
pnpm worker:typecheck
pnpm build
```

Do not commit `wrangler.toml`, `.dev.vars`, `.wrangler/`, or environment-specific origins.

## D1 Migration Flow

1. Create a numbered migration under `workers/spotify-stats/migrations/`.
2. Apply it to the local D1 database.
3. Run ingestion and query tests against local data.
4. Review the SQL and resulting schema.
5. Apply it to the remote D1 database using the production Wrangler configuration.
6. Record the applied migration and deployment outcome in [[Task List]].

Migrations should be additive and reviewable. Destructive schema changes require a backup and a separate approved decision.

Migration `0002_history_import.sql` adds imported-play provenance and duration, `0003_history_import_progress.sql` adds authoritative plan and chunk progress, and `0004_history_metadata_fallback.sql` adds export-provided fallback metadata and the reporting artist view. Apply all three migrations before deploying the corresponding Worker code; reversing that order can make production queries reference columns or views that do not exist yet. Apply remote migrations separately from historical chunks so their index-building writes can be reviewed against the daily allowance. The historical data workflow, write guardrails, Cron pause, and recovery procedure are in [[Extended History Import]].

## Manual-First Deployment

Worker deployment is manual for the initial release. The existing [GitHub Pages workflow](../../.github/workflows/deploy.yml) continues to deploy only the frontend and should not receive Cloudflare credentials during this phase.

The release order is:

1. Provision D1 and Worker configuration.
2. Generate the local Spotify secrets file.
3. Apply remote migrations.
4. Deploy the Worker and its validated secrets together with `pnpm worker:deploy`.
5. Verify health and public API responses.
6. Run controlled ingestion.
7. Enable the five-minute Cron Trigger (`*/5 * * * *`).
8. Create the GitHub Actions repository variable `PUBLIC_SPOTIFY_API_BASE_URL` with `https://spotify-api.lukeharjulin.com`, then deploy the frontend.

GitHub Actions deployment for the Worker may be proposed later, after manual deployment and secret rotation procedures are stable.

## Production Checks

- Verify the D1 binding name is `DB` in both configuration and Worker types.
- Verify only the configured `PUBLIC_SITE_ORIGIN` receives the CORS allow-origin header and there is no production wildcard fallback.
- Verify the Cron Trigger runs every five minutes and overlapping ingestion remains idempotent.
- Verify calendar aggregates and heatmap buckets use `Europe/London`, including a daylight-saving boundary.
- Verify live, fallback/recent, aggregate, and error responses use the approved 15/30/60/`no-store` cache policy.
- Verify scheduled failures and token failures are visible without secret leakage.
- Verify repeat ingestion does not increase play counts for the same track and played-at timestamp.
- Verify the API does not offer a route that dumps raw plays.
- Verify GitHub Pages remains the frontend host.

## Cron Troubleshooting

Cloudflare may take up to 15 minutes to propagate a new or changed Cron Trigger. Do not treat a successful Wrangler deployment as proof that scheduled ingestion has run. Confirm all three signals:

1. The schedules API or Worker dashboard reports `*/5 * * * *`.
2. Worker tail or invocation analytics records a scheduled event at a five-minute UTC boundary.
3. Remote D1 contains an ingestion cursor and expected deduplicated plays.

Cloudflare API error `10063` means the account-wide `workers.dev` subdomain has not been initialized. Open the Workers & Pages account overview and complete that one-time setup, then redeploy the trigger. Keep `workers_dev = false` for this Worker.

As of 2026-08-31, the production trigger remains an external blocker: it was explicitly deleted with `crons = []`, recreated at 20:09:33Z, and confirmed by the schedules API, but a working live tail captured normal HTTP invocations and no scheduled event through the first boundary after Cloudflare's 15-minute propagation window. Before another deployment, inspect **Settings > Trigger Events > View events** in the Cloudflare dashboard and retain the current Worker version and schedule timestamps for a Cloudflare support report.

For a controlled remote D1 verification without adding an ingestion HTTP route, temporarily add `remote = true` to the ignored `DB` binding in `wrangler.toml`, run `pnpm worker:dev`, and invoke Wrangler's local test-scheduled endpoint. Confirm the remote counts, repeat the invocation to prove deduplication, stop the development process, and remove `remote = true`. This writes production data and must be used deliberately.
