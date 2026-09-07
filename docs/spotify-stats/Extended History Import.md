# Extended History Import

Back to [[Spotify Stats]]. Approved choices are recorded in [[Decision Log]] and deployment prerequisites are in [[Cloudflare Setup]].

## Scope And Privacy

The importer runs only on the operator's computer. It does not add an upload route, admin route, or raw-history API to the Worker. The Spotify export, metadata cache, reports, and generated SQL are written below the ignored `.spotify-history/` directory. ZIP files are extracted under `.spotify-history/sources/`; use `-CleanupExtractedSource` to remove that additional raw copy after a successful operation. Git ignore rules do not encrypt or exclude these files from backups. Authoritative plan and chunk progress is stored in D1 without storing raw history.

Only music records with a valid `spotify:track:` URI and positive `ms_played` value are eligible. The importer excludes episodes and other unsupported media, local or URI-less tracks, private/incognito sessions, invalid records, duplicate export events, and records at or after the earliest live-ingested D1 play. It never writes IP address, user-agent, platform, country, offline, shuffle, skip-reason, or other raw export fields.

Imported plays use Spotify's stream-end timestamp and actual `ms_played`. Live recently-played records continue to use the catalog track duration as an estimate. Public API routes remain aggregate and presentation-specific; no route exposes the raw timestamped archive.

## Request The Export

1. Open [Spotify's account privacy page](https://www.spotify.com/account/privacy/).
2. Request **Extended streaming history**, not only the ordinary account-data package.
3. Wait for Spotify to prepare the archive and download the ZIP locally.
4. Keep the ZIP outside the repository. Do not extract or copy it into a tracked directory.

[Spotify's data guide](https://support.spotify.com/us/article/understanding-my-data/) describes Extended Streaming History as account-lifetime streaming data and documents the sensitive fields present in it. Availability and preparation time are controlled by Spotify.

## Dry Run

Prerequisites:

- PowerShell 7, Node.js, pnpm dependencies, and Wrangler are installed.
- `.dev.vars` contains the three Spotify values created by `pnpm spotify:oauth`.
- `wrangler.toml` contains the production D1 binding.
- The current live Worker has ingested at least one play, which establishes the automatic overlap cutoff.

Run the private report directly from the ZIP:

```powershell
pnpm spotify:history -InputPath "C:\private\my_spotify_data.zip" -Mode Report -ExpectedAccountId "<CLOUDFLARE_ACCOUNT_ID>" -ExpectedDatabaseId "<D1_DATABASE_ID>" -CleanupExtractedSource
```

The command verifies the expected Cloudflare account and D1 database, hashes and extracts the ZIP below `.spotify-history/sources/`, discovers history JSON by structure rather than filename, and queries the earliest remote live play. It uses catalog records already present in `.spotify-history/cache/tracks.json` and falls back to the export's track, primary-artist, and album names without making Spotify metadata requests. `-CleanupExtractedSource` removes the extracted copy after success; the original ZIP and private report remain.

Use `-MetadataMode Refresh` only as a deliberate, resumable metadata-maintenance operation. It calls Spotify's supported single-track endpoint and caches each result, but development-mode rate limits can impose day-long waits for a large lifetime library. The normal report, generation, and import workflow should remain `CacheOnly`.

Review total, candidate, importable, skipped, catalog-backed, fallback, and unresolved counts; every exclusion counter; the time range; chunk count; and estimated D1 row writes in `report.json`. The write figure is a rough planning estimate, not a guaranteed upper bound or Cloudflare billing telemetry. Keep the report private because it describes the personal archive even though sensitive raw fields are omitted.

Generate deterministic SQL only after reviewing the report:

```powershell
pnpm spotify:history -InputPath "C:\private\my_spotify_data.zip" -Mode Generate -ChunkSize 250 -ExpectedAccountId "<CLOUDFLARE_ACCOUNT_ID>" -ExpectedDatabaseId "<D1_DATABASE_ID>"
```

The plan directory contains `report.json`, `initialize.sql`, numbered chunk files, and `audit.sql`. The source checksum, cutoff, importable events, and chunk size identify the plan. Each chunk's final statement records its checksum and expected record count in D1. The SQL files intentionally omit explicit transaction statements for compatibility with Cloudflare's [D1 import requirements](https://developers.cloudflare.com/d1/best-practices/import-export-data/). Do not edit a generated plan between dry run and apply.

## Local Verification

Apply migrations and every generated chunk to local D1:

```powershell
pnpm spotify:history -InputPath "C:\private\my_spotify_data.zip" -Mode ApplyLocal -ChunkSize 250
```

Repeat the command and verify that aggregate play counts do not increase. The unique `(source, source_event_key)` index and the existing track/timestamp constraint make the import idempotent. Check that imported listening time reflects `ms_played`, while live records with `listened_ms IS NULL` still use catalog duration.

## Remote Import

[Cloudflare's current D1 pricing limits](https://developers.cloudflare.com/workers/platform/pricing/#d1) allow 100,000 rows written per day on Workers Free. Index maintenance also counts as row writes, so do not equate one play with one row written. The planner includes known table and index maintenance but remains an estimate. The importer records Cloudflare's authoritative `meta.rows_written` after each remote chunk and uses twice the highest observed per-record rate for subsequent admission checks. Always derive `-RemainingWriteBudget` from current UTC-day usage with substantial headroom. When a Free account reaches its daily D1 limit, queries fail until the limit resets at midnight UTC.

Before the first remote chunk:

1. Remove the production Cron Trigger without deploying schema-dependent Worker code, and confirm the trigger is absent. Omitting the `crons` key does not remove an existing trigger.
2. Record the current [D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/) bookmark: `pnpm exec wrangler d1 time-travel info DB --config wrangler.toml`. Capturing it after Cron is paused prevents a later restore from discarding scheduled writes made between the bookmark and trigger removal.
3. Apply migrations `0002_history_import.sql`, `0003_history_import_progress.sql`, and `0004_history_metadata_fallback.sql` separately with `pnpm d1:migrate:remote`. Review migration D1 write usage before importing data; the importer intentionally refuses to combine remote migrations and chunks.
4. Deploy the updated Worker only after all three migrations exist, because its aggregate queries read the imported duration and fallback metadata fields and view.
5. Keep the Cron paused for the entire historical import.

Read the expected account ID from `pnpm exec wrangler whoami` and the D1 UUID from `pnpm exec wrangler d1 info DB --config wrangler.toml --json`. Supply both on every remote run. The importer pins `CLOUDFLARE_ACCOUNT_ID` for its child process and stops unless Wrangler resolves `DB` to the expected UUID. Do not commit either operator value to this knowledge base.

The first remote application is a calibration run limited to one chunk of at most 250 plays. `-CronPaused`, `-MaxChunks`, and `-RemainingWriteBudget` are mandatory safety inputs:

```powershell
pnpm spotify:history -InputPath "C:\private\my_spotify_data.zip" -Mode ApplyRemote -CronPaused -StartChunk 1 -MaxChunks 1 -RemainingWriteBudget 50000 -ChunkSize 250 -Cutoff "2026-08-30T20:11:42Z" -ExpectedAccountId "<CLOUDFLARE_ACCOUNT_ID>" -ExpectedDatabaseId "<D1_DATABASE_ID>"
```

On the next allowed write window, advance `-StartChunk`, keep an explicit `-MaxChunks`, and supply the newly verified remaining budget. D1 chunk markers are authoritative: matching chunks are skipped, missing chunks are retried idempotently, and a checksum mismatch stops the import. Each successful remote chunk stores its reported row writes and final bookmark when Wrangler supplies one. The audit is marked completed only after D1 contains every expected marker. Time Travel restoration rolls markers back with their data, so resume naturally starts from the earliest missing chunk.

After all chunks:

1. Query remote counts, earliest/latest historical timestamps, `SUM(listened_ms)`, and the completed `history_imports` row.
2. Repeat the final chunk and verify counts are unchanged.
3. Test lifetime totals, archive search, top tracks/artists, activity, and recent plays through the public API.
4. Restore `crons = ["*/5 * * * *"]`, deploy, and verify a new scheduled live play is ingested without overlap.

If verification fails, keep Cron paused, retain the private plan and report, and restore D1 to the pre-import recovery point before retrying. Never attempt recovery by deleting rows from an ad hoc list of raw timestamps.

## Explicit Cutoff

The command normally reads the earliest `spotify_api` play from local or remote D1, excluding prior `spotify_export` imports so the boundary remains stable across chunked runs. Before migration `0002` exists, every play is necessarily a live API play and the command uses the table-wide minimum. If no live play exists, it stops rather than guessing. After reviewing the boundary, supply an explicit UTC cutoff:

```powershell
pnpm spotify:history -InputPath "C:\private\my_spotify_data.zip" -Mode Report -Cutoff "2026-08-30T20:11:42.269Z"
```

Only records strictly before the cutoff are eligible. Changing the cutoff creates a different plan and requires a fresh review. Supplying the reviewed cutoff also avoids a remote D1 query, so expected Cloudflare IDs are not required.
