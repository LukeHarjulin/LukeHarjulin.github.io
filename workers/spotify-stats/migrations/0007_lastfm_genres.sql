CREATE TABLE genre_provider_state (
	artist_id TEXT NOT NULL,
	provider TEXT NOT NULL CHECK (provider IN ('spotify', 'lastfm')),
	status TEXT NOT NULL CHECK (status IN ('success', 'empty', 'ambiguous', 'error', 'pending')),
	attempted_at TEXT,
	classified_at TEXT,
	retry_after_ms INTEGER NOT NULL DEFAULT 0,
	failures INTEGER NOT NULL DEFAULT 0,
	taxonomy_version INTEGER,
	PRIMARY KEY (artist_id, provider)
);
INSERT INTO genre_provider_state(artist_id, provider, status, attempted_at, classified_at, retry_after_ms)
SELECT a.spotify_artist_id, 'spotify',
	CASE WHEN EXISTS (SELECT 1 FROM artist_genres g WHERE g.spotify_artist_id = a.spotify_artist_id) THEN 'success' ELSE 'empty' END,
	a.genres_checked_at,
	CASE WHEN EXISTS (SELECT 1 FROM artist_genres g WHERE g.spotify_artist_id = a.spotify_artist_id) THEN a.genres_checked_at END,
	a.genres_retry_after_ms
FROM artists a WHERE a.genres_checked_at IS NOT NULL OR EXISTS (SELECT 1 FROM artist_genres g WHERE g.spotify_artist_id = a.spotify_artist_id);

-- Reporting IDs include history-only identities; deliberately no Spotify artist FK.
CREATE TABLE lastfm_artist_genres (
	artist_id TEXT NOT NULL,
	genre_key TEXT NOT NULL,
	name TEXT NOT NULL,
	PRIMARY KEY (artist_id, genre_key)
);
CREATE TABLE lastfm_genre_state (
	id INTEGER PRIMARY KEY CHECK (id = 1),
	day TEXT NOT NULL DEFAULT '',
	requests INTEGER NOT NULL DEFAULT 0,
	retry_after_ms INTEGER NOT NULL DEFAULT 0,
	lease_until_ms INTEGER NOT NULL DEFAULT 0,
	priority_date TEXT NOT NULL DEFAULT ''
);
INSERT INTO lastfm_genre_state(id) VALUES (1);
CREATE TABLE lastfm_genre_priority (
	artist_id TEXT PRIMARY KEY,
	name TEXT NOT NULL,
	listening_time_ms INTEGER NOT NULL,
	ambiguous INTEGER NOT NULL DEFAULT 0
);
