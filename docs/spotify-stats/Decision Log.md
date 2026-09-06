# Decision Log

Back to [[Spotify Stats]]. Unresolved matters are tracked in [[Open Questions]].

## 2026-08-27

### D-001: Preserve the Existing Frontend Host

**Status:** Approved

GitHub Pages remains the frontend host. The existing Astro build and [GitHub Pages deployment workflow](../../.github/workflows/deploy.yml) remain in place.

### D-002: Use a Cloudflare Worker Sidecar

**Status:** Approved

Add the Spotify backend as a sidecar Worker within the repository. The Worker owns Spotify OAuth token refresh, scheduled ingestion, D1 access, aggregate queries, and public API routing. It does not serve the frontend.

### D-003: Use the Initial Public API Surface

**Status:** Approved

Use the endpoint families recorded in [[API Reference and Privacy]] for now playing, summary statistics, top artists, top tracks, activity, archive search, recent plays, and lifetime totals. Payload details may be refined during implementation without exposing additional private data.

### D-004: Use a Normalized D1 Schema

**Status:** Approved

Use `artists`, `albums`, `tracks`, `track_artists`, and `plays` as the minimum normalized data model. An `ingestion_state` table may be added for reliable cursor management. See [[Overview and Architecture]].

### D-005: Deduplicate Plays by Track and Timestamp

**Status:** Approved

Enforce a unique key on `spotify_track_id` plus `played_at`. Overlapping scheduled ingestion can then ignore an already-recorded play without losing legitimate repeat plays at different timestamps.

### D-006: Publish Aggregates and Bounded Recent Data Only

**Status:** Approved

Do not publish the complete raw timestamped listening-history table. Public responses are limited to the aggregates needed by the website, track-specific aggregate search results, current playback state, and a capped recent-play list.

### D-007: Deploy the Worker Manually First

**Status:** Approved

Start with manual Worker deployment while D1, secrets, OAuth, and the Cron Trigger are being validated. Do not add Worker deployment to GitHub Actions yet. Automation can be considered after the production configuration is stable.

### D-008: Keep External Configuration Out of Source

**Status:** Approved

Do not invent or commit account IDs, generated database IDs, credentials, or tokens. Use documented environment variables, Wrangler secrets, and clearly marked placeholders for values Cloudflare generates. Approved non-secret deployment identifiers and origins may be recorded in configuration. The Cron schedule is no longer a placeholder because D-017 approves it explicitly.

### D-009: Use Consistent JSON Response Envelopes

**Status:** Approved

Successful API responses use `{ "data": <endpoint payload>, "meta": { "generatedAt": "<ISO_TIMESTAMP>", "period": "<PERIOD_WHEN_APPLICABLE>" } }`. Error responses use `{ "error": { "code": "<MACHINE_READABLE_CODE>", "message": "<SAFE_MESSAGE>" } }`. Empty now-playing state keeps the metadata envelope and sets `data` to `null`. Do not expose stack traces, SQL details, upstream response bodies, or secrets in either envelope.

### D-010: Report Calendar Periods in Europe/London

**Status:** Approved

Use the IANA timezone `Europe/London` for today, month, year, archive period counts, and heatmap calendar buckets. Implement daylight-saving transitions through timezone-aware calculations rather than a fixed UTC offset.

### D-011: Approximate Listening Duration from Track Duration

**Status:** Approved

Approximate listening time by adding the Spotify track duration once for each persisted play. Spotify recently-played events do not provide actual milliseconds listened, so duration statistics must be described as estimates and must not imply exact completion time.

### D-012: Return 20 Recent Plays by Default, Capped at 50

**Status:** Approved

`GET /api/spotify/recent` defaults to 20 results. A caller may request a smaller or larger positive `limit`, but the server-enforced maximum is 50.

### D-013: Use a One-Year Listening Heatmap

**Status:** Approved

The default activity heatmap covers the trailing year and groups plays into `Europe/London` calendar days. It returns aggregate daily activity, not raw play rows.

### D-014: Search the Archive by Track-Name Substring

**Status:** Approved

Archive search performs case-insensitive substring matching against track names only. Artist and album matching are outside the initial contract.

### D-015: Restrict CORS to the Configured Frontend Origin

**Status:** Approved

Set the allowed browser origin through the operator-supplied `PUBLIC_SITE_ORIGIN` Worker variable. Do not use a wildcard fallback in production. Requests from other browser origins must not receive an allow-origin grant.

### D-016: Use 15, 30, and 60 Second Public Cache Windows

**Status:** Approved

Use a 15-second public cache window for the now-playing endpoint, including its most-recent-play fallback; 30 seconds for the recent-play feed; and 60 seconds for summary, ranking, activity, archive-search, and lifetime responses. Errors are `no-store`.

### D-017: Ingest Every Five Minutes

**Status:** Approved

Run the scheduled recently-played ingestion every five minutes using the Cloudflare Cron expression `*/5 * * * *`. Keep ingestion idempotent because scheduled windows can overlap.

### D-018: Keep Listening Stats on a Quiet Dedicated Page

**Status:** Approved

Host the listening experience at `/listening/` rather than as a section of the portfolio homepage. Do not include it in primary navigation. Expose only a subdued `Listening` link in the homepage footer, and give the listening page a simple return link to the portfolio.

### D-019: Use Granular Public Validation Error Codes

**Status:** Approved

Keep `INVALID_PERIOD`, `INVALID_LIMIT`, and `INVALID_QUERY` so clients can distinguish invalid inputs. Use `CORS_ORIGIN_DENIED`, `METHOD_NOT_ALLOWED`, `NOT_FOUND`, `UPSTREAM_RATE_LIMITED`, and `SERVICE_UNAVAILABLE` for the corresponding public failures. Missing or malformed server-side CORS configuration maps to `SERVICE_UNAVAILABLE`; do not expose a configuration-specific public code.

## 2026-08-31

### D-020: Use the Approved Production Identifiers and Origins

**Status:** Approved

Use `spotify-listening-stats` as the Worker name, `spotify-listening` as the D1 database name, and `spotify-api.lukeharjulin.com` as the Worker custom domain. Set `PUBLIC_SITE_ORIGIN` to `https://www.lukeharjulin.com`, set the GitHub Pages build's `PUBLIC_SPOTIFY_API_BASE_URL` to `https://spotify-api.lukeharjulin.com`, and register `http://127.0.0.1:8888/callback` as the exact Spotify OAuth redirect URI. The Cloudflare-generated D1 database ID remains an operator-supplied value and must not be guessed or committed.

### D-021: Initialize the Account Workers Subdomain Without Exposing This Worker

**Status:** Approved

Use `l-harjulin.workers.dev` as the Cloudflare account-wide Workers subdomain required for Cron Trigger provisioning. Keep the Spotify Worker configured with `workers_dev = false`; its public ingress remains the approved custom domain.

### D-022: Enable Persisted Worker Logs for Cron Verification

**Status:** Approved

Enable Workers Logs with 100% head sampling while the initial Cron deployment is being verified. Do not enable Workers Traces or an external log export. At the expected traffic volume this remains within Cloudflare's included Workers Logs allowance; review the sampling rate and invocation-log retention after release if traffic or privacy requirements change.

## 2026-09-01

### D-023: Import Extended History Through Local Operator Tooling

**Status:** Approved

Process Spotify Extended Streaming History only on the operator's computer. Do not add a public or administrative upload route to the Worker, and never commit or deploy the raw export. Store temporary extraction, metadata caches, reports, and generated SQL only under the ignored `.spotify-history/` directory.

### D-024: Limit the Initial Import to Public Music History

**Status:** Approved

Import Spotify music-track records with a positive `ms_played` value. Exclude podcasts, audiobooks, video, local files, URI-less records, and private-session records. Report exclusions without storing the sensitive source fields that caused them.

### D-025: Use Actual Historical Listening Duration

**Status:** Approved

Persist the export's `ms_played` for imported records and use it in listening-time aggregates. Continue using Spotify track duration as the estimate for live recently-played records, which do not include actual listening duration.

### D-026: Add Import Provenance and Audit State to D1

**Status:** Approved

Add play source, deterministic source-event key, actual listened milliseconds, and the source stream-end timestamp to `plays`. Add a `history_imports` audit table with the source checksum, status, counts, and date range. Keep reimports idempotent with a unique source-event index.

### D-027: Keep Imported History Before the Live-Ingestion Boundary

**Status:** Approved

Use the export's exact UTC stream-end timestamp as the imported play timestamp and retain it as source provenance. Import only records ending strictly before the earliest existing live API play so the export cannot overlap the already-collected recent history. Do not modify the live recently-played cursor.

### D-028: Enrich Tracks Through Supported Individual API Requests

**Status:** Approved

Extract canonical track IDs from Spotify URIs and enrich each unique track through the supported `GET /tracks/{id}` endpoint. Do not use the batch track endpoint removed for Development Mode apps. Cache results locally, bound concurrency, and honor `429 Retry-After` responses.

### D-029: Skip Unavailable Metadata Without Inventing Identities

**Status:** Approved

Skip tracks that no longer resolve through Spotify or lack a canonical track URI. Include their counts and source descriptions in the private dry-run report, but do not invent track, artist, or album IDs.

### D-030: Apply Historical Imports in Verified Chunks

**Status:** Approved

Generate a dry-run report and deterministic, chunked SQL artifacts. Apply and rerun the import against local D1 first. Before remote application, confirm a recovery point, pause Cron explicitly, apply the migration and chunks within the account's D1 write allowance, verify counts and idempotency, and then restore Cron.

## 2026-09-05

### D-031: Persist Plan And Chunk Progress In D1

**Status:** Approved

Identify each generated historical import with a deterministic plan fingerprint and persist each completed chunk by plan fingerprint, chunk number, and chunk checksum. Treat D1 chunk markers as authoritative resume state and local files only as cached artifacts. Store the expected record count, applied timestamp, and reported remote write metadata when available. Because chunk data and its final marker are imported together, a failed import can be retried idempotently; Time Travel restoration rolls both data and progress back together.

## 2026-09-06

### D-032: Use Export Metadata As The Historical Fallback

**Status:** Approved

Default historical planning to cache-only metadata resolution. Use cached Spotify catalog metadata when available; otherwise retain the latest non-empty track, primary-artist, and album names supplied by the Extended Streaming History export. Do not create synthetic Spotify artist or album IDs. Preserve exact imported listening time and include fallback artist names in aggregate statistics. Tracks without either a catalog name or an export track name remain unresolved and are reported rather than assigned invented metadata. Optional catalog refresh remains an explicit operator action because the development-mode single-track API returned a roughly 24-hour retry interval after 602 requests for an export containing 15,305 unique candidate tracks.

### D-033: Verify Read Targets And Make Extraction Disposable

**Status:** Approved

Require the operator's expected Cloudflare account ID and D1 database UUID before Report or Generate mode automatically reads the remote overlap cutoff, using the same target verification required by ApplyRemote. Allow an explicit reviewed cutoff to run without a remote query. Keep extracted ZIP contents under the ignored private workspace and provide an explicit cleanup switch that removes the extracted copy after a successful operation while retaining the original ZIP and generated report or plan.

### D-034: Resolve Same-Track Timestamp Collisions By Greatest Duration

**Status:** Approved

Treat Extended Streaming History rows with the same Spotify track ID and exact stream-end timestamp as one play, matching the existing D1 uniqueness constraint. Retain the row with the greatest `ms_played` value and report every discarded variant as `duplicate_track_timestamp`; do not sum durations that claim the same ending instant. Permit a historical-import rerun to raise an existing `spotify_export` row to the retained duration and event key, but never overwrite a live-ingested row through this conflict path.
