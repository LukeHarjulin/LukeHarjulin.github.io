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
