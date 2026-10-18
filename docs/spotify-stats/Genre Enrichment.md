# Genre enrichment and trends API

Backend implementation; no frontend presentation changes. Apply `0007_lastfm_genres.sql` before deploying this Worker. The migration preserves `artist_genres`, backfills Spotify provenance, and creates independent Last.fm state and reporting-identity tables.

## Classification

Existing Spotify genres always take precedence. Artists with no Spotify genres, including previously checked empty results and history-only reporting IDs, can use Last.fm. Synthetic `history:` IDs remain reporting identities; no Spotify IDs or artist records are invented.

Last.fm uses the existing server-side `LASTFM_API_KEY` and `GENRE_ENRICHMENT_ENABLED` switch. `artist.getInfo` gates `artist.getTopTags`: autocorrect is disabled, returned names must match after Unicode NFC, case and whitespace normalization, and the identity must have a UUID-shaped MusicBrainz ID and a nonempty biography. Local name collisions, numbered biographies and explicit multiple-artist notices are rejected. These conservative checks cannot guarantee detection of every undocumented same-name collision; missing identity evidence remains unclassified.

The versioned exact allowlist/alias map in `genre-taxonomy.ts` rejects arbitrary community tags, including moods, decades, nationality and personal labels. Known music genres such as southern rock and bossa nova remain valid. Retain up to three genres with Last.fm popularity strength at least 10, highest first; merge aliases using their maximum strength and resolve ties by genre name. Strength is not a listener count or confidence percentage. Spotify genres are not truncated or remapped.

Live read-only validation on 18 October 2026 sampled Cher, Black Sabbath, Ghost and a nonexistent artist. Responses contained numeric strengths, `toptags.@attr.artist`, non-genre tags, and API error 6 for the missing artist. Ghost's identity biography began with `1)`, demonstrating why an exact returned name alone is insufficient. Identity summaries for Cher and Black Sabbath had names, MBIDs and biographies. Keys and request URLs were not logged or saved. Documentation: [artist.getTopTags](https://www.last.fm/api/show/artist.getTopTags), [artist.getInfo](https://www.last.fm/api/show/artist.getInfo).

## Scheduling and failure behavior

- Last.fm has an independent persisted five-minute lease, UTC daily request counter and cooldown. Spotify budget exhaustion or cooldown does not block it.
- Cap genre enrichment at five Last.fm requests per run and 100 per UTC day, including failed requests and identity checks. Normally two artists (four requests) fit per run; leave a spare slot rather than start an incomplete identity/tag pair. These caps exclude existing album-recommendation Last.fm traffic.
- Scan history at most once per UTC day and retain up to 100 due primary-artist candidates, prioritized by all-time listening time. Newly imported candidates enter on the next daily scan.
- Cache successful classifications for 90 days. Valid empty, missing and ambiguous results retry after 30 days. Transient failures back off from one hour to one day; prior successful genres survive failures and become stale. A confirmed empty or ambiguous refresh removes old fallback classifications.
- HTTP 429 honors `Retry-After`; API error 29 pauses for one hour; authentication/key errors pause for one day. Provider state includes status, attempt time, successful classification time, retry time, failure count and taxonomy version. Missing configuration makes no Last.fm requests.
- Taxonomy changes must increment `GENRE_TAXONOMY_VERSION`. Older retained classifications report stale until their scheduled refresh (within the existing 90-day window).
- Logs contain sanitized events only, never upstream error bodies, URLs or API keys.

## Additive API contract

`GET /api/spotify/trends` retains existing fields and adds `genreMetadata` at the period root and on each entry in annual `months`:

```ts
interface GenreMetadata {
	taxonomyVersion: number;
	sources: { source: "spotify" | "lastfm"; listeningTimeMs: number }[];
	staleTimeMs: number;
	oldestClassifiedAt: string | null;
}
```

Both source entries are present, including zeros. They sum to `genreCoverage.identifiedTimeMs` within floating-point tolerance and include genres folded into Other. Unknown time is excluded. `staleTimeMs` is the identified Last.fm contribution whose classification is at least 90 days old, has an old taxonomy version, or whose refresh failed. Spotify has no new expiration policy. `oldestClassifiedAt` is the oldest known successful timestamp actually contributing to the selection, not the latest attempt, response generation time, or a statement that every contributing artist has a known timestamp. Legacy Spotify timestamps can be unknown.

**Consumer fallback:** treat absent metadata as unavailable. Omit source/freshness details and continue using existing `genres`, `topGenre` and `genreCoverage`. Never infer Spotify provenance or freshness from absence. Metadata version describes Last.fm normalization; preserved Spotify labels are not part of that taxonomy. Attribute a nonzero Last.fm contribution as Last.fm community tags, linking to [Last.fm](https://www.last.fm/).

Time allocation is unchanged: use the primary reporting artist and split that artist's listening time equally across its effective genres. Last.fm popularity selects labels but never weights listening time. Annual/monthly totals use existing London calendar boundaries; all source, genre and coverage calculations must reconcile within floating-point tolerance. Monthly metadata is for that month only. No provider status, artist biographies or API keys are exposed.

The internal trends cache discriminator is `_taste=3`. Responses with listening time but zero identified genre time expire after 60 seconds so initial enrichment becomes visible promptly. Responses with identified genres retain the existing TTLs (one hour for the current year, six hours for historical years); further enrichment can take up to that TTL to appear. A read-only production query on 18 October 2026 confirmed 701 stored artists and zero genre rows before release. This confirms the absence of classifications, but does not fully establish the original production cause; an earlier query had failed with Cloudflare 7403.
