# Daily album recommendations

The listening page shows one shared daily recommendation and browser-local alternatives. The intended mix is 80% rediscovery, 10% deeper exploration and 10% new artists. No visitor login or write API is involved. A skip does not change anyone else's pick or count as negative feedback.

## Selection

- Aggregate the stored history, including imported artist/album fallback metadata. Count plays of at least 30 seconds; API plays without listened duration use track duration. Use every play, including short skips, when determining an album's last play.
- Merge remastered/deluxe editions and track names. Rediscoveries need at least three different tracks and six qualifying plays, and no play within two calendar months (London dates, inclusive cutoff, clamped month ends).
- Rank rediscoveries by log play count, breadth of tracks explored and time away; reduce the score of headline picks from the previous 14 daily snapshots. Use at most one album per artist per day.
- Request up to eight rediscoveries, one exploration and one discovery. Rotate the headline category across a ten-day cycle (eight/one/one). If a category lacks verified candidates, use available picks; never invent results to fill a quota.
- Exploration uses Last.fm popular albums from rotating long-term favourite artists, at most two familiar tracks/25% coverage, and Spotify release years within ten years of that artist's most-played album. Reissue dates can make the era approximation conservative.
- Discovery uses Last.fm similarity scores weighted by long-term seed plays. Exclude artists already present in any stored history. Explicit negative feedback from the original trial is recorded in the selection module; merely knowing an album is not a rejection.
- Verify artist/title identity against Spotify, require album type (excluding singles/compilations), complete track lists and playable tracks in the account market (GB requested; Spotify account country takes precedence). Display direct album links and Spotify artwork. Reject obvious live/compilation titles, live track markers and Last.fm live/compilation tags. This favours studio recordings but cannot prove recording type when upstream metadata is incomplete.

## Background generation and API

The existing five-minute cron checks for a daily snapshot using London dates. An atomic D1 lease allows one published snapshot per day. It checks Spotify's catalogue before scanning the listening history; failed preflight requests may retry after two hours without that scan. Once a history scan begins, the lease prevents another full scan that London day, including on failure or an empty result. Each attempt caps catalogue requests at 38 and uses one Spotify access token. Verified partial results survive later catalogue failures; no empty snapshot replaces a usable snapshot. Retain daily snapshots for 30 days for rotation, serve a clearly labelled fallback up to three days old, then return an empty state.

The D1 Free plan currently allows 5 million rows read and 100,000 rows written per UTC day. Expensive statistics are cached for longer periods: six hours for activity and yearly/all-time rankings, and a day for lifetime totals. Avoid repeated production history queries and split bulk history imports across UTC days when they would exceed the write allowance. The dashboard's D1 Row Metrics show actual read/write usage; query results alone do not reveal how many rows SQLite scanned.

`GET /api/spotify/recommendations` uses the existing `{ data, meta }` envelope. Data contains `date`, `generatedAt`, `stale`, and `items`; each item has `id`, `name`, `artist`, `artworkUrl`, `spotifyUrl`, `kind`, and `reason`. The endpoint reads D1 only and caches for 60 seconds. It exposes selected album explanations, not the raw listening history or credentials.

The card loads independently of other statistics. Browser storage remembers the chosen album for that snapshot. Refreshing on a different London date resets to the daily recommendation; unavailable storage falls back to an in-memory choice. Exhausting alternatives disables skipping and offers a return to the daily pick.

## Rollout

1. Apply D1 migration `0005_album_recommendations.sql` using the existing local/remote migration commands before enabling the feature.
2. Set `LASTFM_API_KEY` in `.dev.vars` for local use and as a Worker secret for deployment. Existing secret upload/deploy helpers accept it and Spotify reauthorization preserves it. No Last.fm shared secret or login callback is needed.
3. Set `RECOMMENDATIONS_ENABLED = "true"` in the actual Wrangler config; leaving it unset disables generation and returns an empty response without querying the new table. Keep the five-minute ingestion cron.
4. Deploy the Worker, allow its next cron to prepare a snapshot, check the recommendations endpoint, then deploy the Astro site through the existing GitHub Pages workflow.

Watch structured `album_recommendations_ready`, `album_recommendations_partial`, and `album_recommendations_failed` events. Disable generation by removing the flag; existing listening statistics continue independently. No production migration or deployment is performed by a local code change.

## Validation

Run `pnpm worker:typecheck`, `pnpm worker:test`, `pnpm spotify:oauth:test`, and `pnpm build`. Inspect the card at mobile/desktop widths and test skip persistence, day rollover, missing artwork, empty/error/stale results and exhausted alternatives. Live Spotify verification depends on catalogue access for this app and the user's account market.
