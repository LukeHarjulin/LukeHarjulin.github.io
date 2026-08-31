# API Reference and Privacy

Back to [[Spotify Stats]]. Architecture is described in [[Overview and Architecture]].

## Configuration

The frontend reads the Worker origin from `PUBLIC_SPOTIFY_API_BASE_URL`. Production uses the approved public origin `https://spotify-api.lukeharjulin.com`; GitHub Actions receives it through the repository variable rather than hard-coded frontend code.

All endpoints are read-only. The API base is represented below as `<SPOTIFY_STATS_API_BASE_URL>`.

## Response Envelope

Successful responses include the endpoint payload and response metadata:

```json
{
	"data": "<ENDPOINT_PAYLOAD>",
	"meta": {
		"generatedAt": "<ISO_TIMESTAMP>",
		"period": "<PERIOD_WHEN_APPLICABLE>"
	}
}
```

`generatedAt` is always present. `period` is included only for period-scoped endpoints.

Errors use a structured error member with a stable machine-readable code and a safe human-readable message:

```json
{
	"error": {
		"code": "<MACHINE_READABLE_CODE>",
		"message": "<SAFE_MESSAGE>"
	}
}
```

The error envelope never contains stack traces, SQL text, binding details, credentials, tokens, or raw Spotify error bodies. Whether it later includes a request identifier remains an open question.

The stable initial error codes are:

| Code | Meaning |
| --- | --- |
| `INVALID_PERIOD` | The requested reporting period is unsupported. |
| `INVALID_LIMIT` | A result limit is malformed or outside the allowed range. |
| `INVALID_QUERY` | An archive query does not satisfy the public input rules. |
| `CORS_ORIGIN_DENIED` | A browser origin does not match the configured portfolio origin. |
| `METHOD_NOT_ALLOWED` | The HTTP method is not supported. |
| `NOT_FOUND` | The public route does not exist. |
| `UPSTREAM_RATE_LIMITED` | Spotify has rate-limited the Worker request. |
| `SERVICE_UNAVAILABLE` | The service cannot safely complete the request, including internal configuration failures. |

## Reporting Conventions

- Calendar periods and daily buckets use the IANA timezone `Europe/London`, including daylight-saving transitions.
- Listening-time fields are estimates. Each persisted play contributes the full Spotify track duration because recently-played data does not include actual milliseconds listened.
- All durations use milliseconds in the API and should be presented as approximate listening time in the frontend.

## Public Endpoints

### `GET /api/spotify/now-playing`

Returns the current track when Spotify reports active playback. The website needs track, artists, album, artwork, playback state, and progress when practical. If nothing is playing, the response falls back to the most recent stored play and identifies it as a fallback rather than live playback. When neither exists, `data` is `null` and the normal `meta` object remains present.

### `GET /api/spotify/summary?period=<PERIOD>`

Returns play count, estimated listening time, unique artists, and unique tracks for an allowed summary period. Initial periods are `today`, `month`, `year`, and `all`; the website initially highlights today and month. Calendar boundaries use `Europe/London`.

### `GET /api/spotify/top-artists?period=<PERIOD>`

Returns ranked artist aggregates for `7d`, `30d`, `year`, or `all`.

### `GET /api/spotify/top-tracks?period=<PERIOD>`

Returns ranked track aggregates for `7d`, `30d`, `year`, or `all`.

### `GET /api/spotify/activity`

Returns aggregate daily activity for a trailing-one-year heatmap. Days are bucketed in `Europe/London`; no raw play rows are returned.

### `GET /api/spotify/archive/search?q=<QUERY>`

Returns track-level aggregate results using case-insensitive substring matching against track names only. A result may include track, artists, album, artwork, first played, last played, total plays, plays this year, plays this month, and estimated total listening time. It does not search artist or album names and does not return every matching play event.

### `GET /api/spotify/recent`

Returns recent plays containing only the display fields required by the website. The default is 20 results and the server-enforced maximum is 50.

### `GET /api/spotify/lifetime`

Returns lifetime aggregate totals without exposing the underlying raw play rows.

## Input Rules

- Reject unsupported period values rather than silently converting them.
- Normalize and length-limit archive queries before running database searches.
- Default recent results to 20 and reject limits outside 1-50.
- Use parameterized D1 queries for all user-controlled values.
- Return the approved success and error envelopes without stack traces, SQL text, tokens, or internal binding details.

Archive pagination and request identifiers remain open decisions. Changes to the approved stable error codes require an API compatibility review and a new entry in [[Decision Log]].

## Public Data Boundary

The public API may expose:

- Current playback display data and practical progress.
- A bounded most-recent-play fallback.
- Aggregate counts, durations, rankings, and activity buckets.
- Track-specific aggregate archive search results.
- A capped recent-play list.

The public API must not expose:

- Spotify client secrets, access tokens, refresh tokens, authorization codes, or authorization headers.
- Cloudflare account credentials, API tokens, D1 database IDs, or internal bindings.
- The complete raw timestamped `plays` table or an unbounded equivalent.
- Ingestion cursors, internal state records, SQL errors, stack traces, or secret-bearing logs.
- Private administrative, OAuth bootstrap, mutation, or arbitrary-query endpoints.

## Privacy Controls

- Keep Spotify calls and token refresh entirely inside the Worker.
- Select explicit response fields instead of serializing database rows or upstream Spotify responses directly.
- Cap recent data and archive result sizes at the server.
- Aggregate the trailing-one-year heatmap by `Europe/London` calendar day before returning it.
- Restrict archive search to track-name substring matches and track-level summaries.
- Review response fixtures and browser network output for accidental fields.
- Treat listening history as personal data even though the selected aggregates are intentionally public.

## Caching Guidance

Use these public cache windows:

| Response | `Cache-Control` |
| --- | --- |
| Live now playing | `public, max-age=15` |
| Most-recent-play fallback from now-playing | `public, max-age=15` |
| Recent plays | `public, max-age=30` |
| Summary, rankings, activity, archive search, and lifetime totals | `public, max-age=60` |
| Errors | `no-store` |

Cache policy must never cause private upstream headers or token responses to be stored publicly.

## CORS

Browser access is restricted to the exact operator-supplied `PUBLIC_SITE_ORIGIN`. Production must not fall back to `*`. Preflight responses permit only the read-only API methods and headers required by the frontend, and non-matching origins do not receive an allow-origin grant.

## Future API Changes

New public fields or endpoints require a privacy review. Any endpoint that increases timestamp precision, expands history depth, or combines dimensions in a way that reconstructs raw listening behavior must be approved and added to [[Decision Log]] before implementation.
