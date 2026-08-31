# Overview and Architecture

Back to [[Spotify Stats]]. See also [[Decision Log]], [[Task List]], and [[API Reference and Privacy]].

## Scope

Add a public listening-stats page alongside the existing portfolio while preserving its current frontend hosting model:

- GitHub Pages continues to host the statically generated frontend.
- A Cloudflare Worker owns Spotify authentication, ingestion, stats queries, and the public read-only API.
- Cloudflare D1 stores normalized Spotify metadata and listening events.
- A Cloudflare Cron Trigger invokes recently-played ingestion every five minutes.
- Spotify client credentials, access tokens, and refresh tokens remain server-side.

## Current Repository

The source site is an Astro static build, configured in [astro.config.mjs](../../astro.config.mjs) and [package.json](../../package.json). The portfolio is [src/pages/index.astro](../../src/pages/index.astro), listening stats are served by [src/pages/listening.astro](../../src/pages/listening.astro), the listening UI is [src/components/ListeningStats.astro](../../src/components/ListeningStats.astro), shared styles are in [src/styles/global.css](../../src/styles/global.css), and browser behavior is in [src/scripts/site.ts](../../src/scripts/site.ts).

The existing [GitHub Pages workflow](../../.github/workflows/deploy.yml) builds the Astro project and deploys `dist`. It remains the frontend deployment path.

## Target Architecture

```text
Spotify Web API
        |
        v
Cloudflare Worker
  - OAuth access-token refresh
  - scheduled recent-play ingestion
  - aggregate/statistics queries
  - public read-only API
        |
        v
Cloudflare D1

GitHub Pages frontend
        |
        v
Cloudflare Worker public API
```

The Worker is a sidecar service in this repository. It does not replace GitHub Pages and does not serve either static page. The portfolio links to `/listening/` only through a subdued footer entry and does not include listening stats in primary navigation.

## Planned Repository Layout

```text
workers/
	spotify-stats/
		src/
		migrations/
wrangler.example.toml
```

The final Wrangler configuration will be created from the example using operator-provided Cloudflare values. Secrets will be stored with Wrangler or an equivalent Cloudflare secret-management path, never in committed files.

## Initial Website Capabilities

- Now playing, with a most-recently-played fallback.
- Today and current-month summary statistics.
- Top artists and tracks for 7 days, 30 days, current year, and all time.
- A trailing-one-year listening activity heatmap using `Europe/London` calendar days.
- Searchable track archive with aggregate play information.
- Recent plays.
- Lifetime totals.

## Data Flow

1. The Cron Trigger invokes the Worker's scheduled handler.
2. The Worker refreshes the Spotify access token using backend-only credentials.
3. The Worker requests recently played tracks and upserts artist, album, track, and track-artist metadata.
4. The Worker inserts each play using the approved unique identity of Spotify track ID plus played-at timestamp.
5. Public API handlers query only the aggregates and bounded records required by the frontend.
6. The GitHub Pages frontend requests those public responses using a configured API base URL.

Now-playing data may be read live from Spotify by the Worker. When nothing is currently playing, the Worker returns the most recent stored play. Progress is included only when Spotify supplies practical, current progress data.

Calendar reporting uses `Europe/London`, including daylight-saving transitions. Listening time is an approximation calculated by adding each played track's Spotify duration; recently-played events do not report the amount of the track actually heard.

## Normalized Data Model

| Table | Responsibility |
| --- | --- |
| `artists` | One row per Spotify artist. |
| `albums` | One row per Spotify album. |
| `tracks` | One row per Spotify track, linked to its album. |
| `track_artists` | Ordered many-to-many relationship between tracks and artists. |
| `plays` | One row per listening event, linked to a track. |
| `ingestion_state` | Optional ingestion cursor or last-success state used by the scheduled job. |

The `plays` table must enforce uniqueness across `spotify_track_id` and `played_at`. This makes repeated or overlapping Cron runs idempotent while still allowing the same track to be played repeatedly at different times.

## Boundaries

- The frontend receives no Spotify OAuth material.
- The public API does not expose the complete timestamped `plays` table.
- Database bindings and secrets exist only in the Worker environment.
- Changes outside this feature should remain narrowly scoped and follow the current Astro and styling conventions.
