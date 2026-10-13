# Listening Trends

## Delivery slices

1. Calendar API foundation: implemented locally. Verified with 66 relevant tests across eight suites, including local D1 aggregation, existing response contracts, query regressions, authentication, and cache behaviour; Worker type checking passes. Not deployed.
2. Separate `/listening/trends/` dashboard: implemented locally, linked from `/listening/`, sharing its passphrase session. Starts with the whole year; month buttons update rankings with a Whole year reset. Selection survives refresh and Back/Forward in `?year=YYYY&month=M`. All nine browser tests pass (including the existing listening-page regression checks); strengthened pending-response tests also pass. Desktop/mobile screenshots inspected, with no horizontal overflow at 390px or 320px. Site type checking and the Astro production build pass. Not deployed.
3. Genre breakdowns and monthly leading-artist/genre highlights: implemented locally. Migration `0006_artist_genres.sql` adds cached classifications, a bounded priority queue, and shared Spotify catalogue budget state. Enrichment is opt-in and runs after ingestion/recommendations; rankings are read-only. Verified with 69 backend tests, nine browser tests, Worker/site type checking, and the production build. Known genre allocations also verified in local Cloudflare D1; desktop/mobile screenshots inspected. Not deployed.

## Slice 1 contract

`GET /api/spotify/trends?year=2025` returns the normal `{ data, meta }` envelope. Omitting year selects the current London year. Adding `&month=3` requests only March's details. `meta.period` is `2025` or `2025-03`.

`data` includes `year`, nullable `month`, `timeZone`, `availableYears`, `totals`, `isToDate`, `isUpcoming`, `artists`, and `tracks`. Annual responses also include `months`: twelve ordered buckets containing month number, plays, listening time, recorded time, estimated time, and to-date/upcoming flags. Monthly responses omit `months`; the dashboard retains the annual series when fetching detail.

Totals contain `plays`, `listeningTimeMs`, `uniqueArtists`, `uniqueTracks`, `recordedTimeMs`, and `estimatedTimeMs`. Recorded time uses imported `listened_ms`, including zero; estimated time uses catalog duration only when `listened_ms` is null. Artist and track lists contain at most ten entries ordered by listening time, then plays, name, and identifier. Each credited artist receives full credit, matching existing artist aggregates; artist totals are not additive.

Calendar intervals use inclusive start and exclusive end in Europe/London, including DST. Monthly/annual plays and durations reconcile; annual unique counts are queried independently. Database-side aggregation returns no raw play events. Available years span the earliest recorded year through the current year, descending, including intervening years without recorded plays. With no history, only the current year is offered. Years from 2006 through the current year are accepted; years without recorded data return empty aggregates. Invalid inputs return `INVALID_YEAR` or `INVALID_MONTH` before querying D1. Future months in the current year are allowed and marked upcoming.

The production handler requires the existing session before querying or consulting the internal cache. Client responses remain `private, no-store`. Normalized internal cache keys separate year/month selections and roll over at London midnight. Current-year entries expire after one hour; historical entries after six hours so imports are eventually reflected. The genre slice must account for these cache windows when adding enrichment.

## Limits and remaining work

Empty buckets mean no recorded plays; they do not certify that the historical import is complete. The dashboard uses a general coverage note; an explicit “Import incomplete” label still requires import audit state from the backend. Recorded and estimated time are shown separately. The trends page loads only its own data after session verification; Lock/expiry aborts requests and clears its rendered content.

## Slice 3 contract and enrichment

Trends now include `genres`, `topGenre`, and `genreCoverage`. Genre buckets contain `kind` (`genre`, `other`, or `unknown`), display `name`, `listeningTimeMs`, and `sharePercent`. Top ten known genres are followed by Other (remaining known genres) and Unknown (unclassified primary artists), when non-zero. Each play's time is divided evenly across its primary artist's distinct normalized tags. Percentages include Unknown in their denominator. Fractions remain unrounded in the API so allocated time reconciles with totals. The top identified genre excludes Unknown and Other. Coverage exposes identified time, total time, and the identified percentage; empty periods report zero coverage with no winner.

Annual month buckets also include nullable `topArtist` and `topGenre`. Artist winners credit every artist on collaborative tracks, matching the main rankings. A fallback artist name can lead a month even when its genre is Unknown. These aggregates are computed in D1 without returning play rows. The dashboard displays the monthly winners in selectable cards beneath the chart and a genre panel for the selected period.

Enable enrichment with `GENRE_ENRICHMENT_ENABLED = "true"` only after applying migration 0006. The example defaults to false. An hourly atomic lease permits at most one artist request per hour, capped at twelve per UTC day. Once per UTC day, a D1 query ranks the top 100 pending canonical primary artists by listening time; further runs consult this queue rather than rescanning the archive. Artists without canonical IDs remain Unknown. Successful missing/empty tags or a 404 are marked checked; malformed responses, network failures, and other HTTP failures retry after a delay. Tags are normalized/deduplicated while retaining a display label. Checked artists are not automatically refreshed, keeping initial request cost bounded; classifications describe cached catalogue labels, not historical genre assignments.

Spotify recommendations and genres share an atomic ceiling of 40 catalogue attempts per UTC day. Recommendations retain their existing per-run limit and execute first. Token refresh, playback/recent-history requests, Last.fm requests, and operator import tooling are outside this catalogue budget. This is an application safeguard, not Spotify's published quota. A Spotify 429 stores a shared cooldown honouring Retry-After (including HTTP dates), with a one-day fallback if absent; authentication/permission failures also pause metadata work. This state survives Cron runs and midnight. Failed genre maintenance never reverses ingested plays or advances the listening cursor independently.

## Rollout

1. Apply migration 0006 to local D1 and production D1 before deploying this Worker. The new trends queries and recommendation budget both require its tables, even with enrichment disabled.
2. Deploy the Worker with enrichment disabled, verify authenticated trends, then deploy the frontend.
3. Enable enrichment when ready and verify coverage rises progressively. Historical cache entries refresh within six hours; current-year entries within one hour. A new trends cache-key version prevents reuse of pre-genre responses.

All implementation and verification in these slices is local; no production migrations, catalogue requests, or deployment have been performed.
