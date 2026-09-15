# D1 read reduction

Implemented on `codex/reduce-d1-row-reads` in commit `6ba636d` and deployed to production on September 15, 2026, verified at 18:25 UTC (19:25 BST).

## Production deployment

- Migration `0005_artist_lookup_index.sql` applied successfully; Wrangler confirms no pending migrations.
- Worker version: `c8d20e7a-3b5f-4768-ab70-f4a657eaf803`.
- Custom domain: `spotify-api.lukeharjulin.com`; ingestion schedule remains every five minutes.
- Recent plays, summary, top tracks, top artists, lifetime totals, activity, and now-playing all returned HTTP 200 and `X-Spotify-Cache: HIT` on repeated requests with identical response bodies. CORS headers matched the public site origin on the five statistics endpoints checked for CORS.
- Pre-migration D1 recovery bookmark: `00000d4d-00000000-000050e7-227a582e4cc11f5d6a9d3c29c8a74dab`. Restoring it would also roll back subsequent ingestion, so it is a recovery reference, not a routine rollback step.
- Actual full-day production reads remain to be measured; the deployment and cache checks do not prove the account stays below its daily allowance.

## Changes

- Migration `0005_artist_lookup_index.sql` indexes normalized artist names and replaces the grouped historical artist-name lookup with an indexed lookup. Unambiguous names still merge with authoritative artists; ambiguous names retain their historical identity. Artist changes are reflected by the view without a refresh job.
- Recent-play queries materialize the limited set of plays before loading metadata. Track artist JSON now uses indexed, per-track lookups instead of scanning the union view.
- Top-track queries aggregate and limit results before enriching those tracks with album and artist metadata.
- The Worker caches successful public statistics responses in `spotify-public-v1`: summaries/rankings/activity for 10 minutes, lifetime totals for one hour, recent plays for 30 seconds, and now-playing for 15 seconds. Browser freshness remains at the existing 15–60 seconds. `meta.generatedAt` identifies when cached statistics were computed.
- Cache keys normalize default periods and limits, discard unused query parameters, separate CORS response variants, and change at Europe/London midnight. Invalid requests, errors, archive searches, and requests with credentials bypass caching. Cache failures fall back to the API. `X-Spotify-Cache` reports `HIT` or `MISS` for eligible successful responses.

The Cache API is local to each Cloudflare data centre and does not collapse simultaneous misses. It reduces repeated reads but is not a hard account-wide read cap. Expensive uncached requests and increased traffic can still exceed the allowance.

## Local measurements

The local D1 regression test seeds 24,000 plays, 1,200 tracks, and 1,201 artists. It compares the previous SQL/schema with the new implementation, checks identical results, and verifies actual bundled Worker cache hits. Fixtures cover imported/live durations, zero listening duration, missing metadata, ambiguous names, authoritative metadata, multiple artists, filtered rankings, and empty results.

| Query | Before: rows read | After: rows read | Reduction |
| --- | ---: | ---: | ---: |
| Latest play | 7,415 | 6 | 99.9% |
| Recent 20 plays | 7,508 | 106 | 98.6% |
| All-time top 10 tracks | 156,899 | 27,651 | 82.4% |
| Filtered top 10 tracks | 117,914 | 34,375 | 70.8% |
| Lifetime totals | 124,670 | 73,878 | 40.7% |
| Filtered summary | 61,354 | 57,479 | 6.3% |
| All-time top artists | 123,013 | 119,138 | 3.2% |
| Archive search | 75,543 | 3,416 | 95.5% |

These measurements exclude cache savings and are not production forecasts. Empty top-track results read 5 rows instead of 3 because of the materialized query structure.

Validation: all 74 Worker tests passed; TypeScript checking passed. The expanded local D1 benchmark passed separately after adding full metadata equivalence and actual Worker cache checks. Commands using the already installed tools:

```powershell
node node_modules/typescript/bin/tsc --project workers/spotify-stats/tsconfig.json
node node_modules/vitest/vitest.mjs run --config workers/spotify-stats/vitest.config.ts
```

## Deployment and verification

1. Check the production migration list and today's remaining read/write allowance. Apply the new migration before deploying the Worker. Creating the index performs one-time database work; measure its usage separately from ongoing traffic. Follow the existing deployment procedure and retain a recovery point.
2. Deploy the Worker after migration `0005` succeeds. Deploying the code without the index leaves historical-name lookups expensive. No frontend deployment or new service binding is required.
3. Request recent plays, lifetime totals, and rankings twice. Check `X-Spotify-Cache` changes from `MISS` to `HIT`, CORS still works, and results match the expected listening history. A hit should issue no D1 queries. Expect expiry and separate regional caches to cause subsequent misses.
4. Compare production D1 query-insight rows read per execution for the rewritten SQL against the previous queries. Avoid repeatedly running the old expensive queries against production just for measurement.
5. Inspect a complete post-deployment UTC day. The Free allowance is 5 million reads/day, resetting at 00:00 UTC; target below 3 million to allow traffic variation. Include cache misses, ingestion, search, administrative queries, and any other databases in the account total.

If more reduction is needed, prioritize incremental lifetime totals and daily/per-track/per-artist summaries. Avoid repeatedly rebuilding full-history summaries on a timer. Track distinct identities and idempotent imports carefully when maintaining aggregates.

For response contract changes or immediate invalidation, bump the cache namespace in `cache.ts`. Rolling back to the previous Worker is compatible with the replacement view and index, though it restores the old query costs. Cached statistics can lag new ingestion by their configured TTL.

Sources: [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/), [Workers Cache API](https://developers.cloudflare.com/workers/runtime-apis/cache/).
