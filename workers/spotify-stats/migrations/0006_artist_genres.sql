ALTER TABLE artists ADD COLUMN genres_checked_at TEXT;
ALTER TABLE artists ADD COLUMN genres_retry_after_ms INTEGER NOT NULL DEFAULT 0;

CREATE TABLE artist_genres (
	spotify_artist_id TEXT NOT NULL REFERENCES artists(spotify_artist_id) ON DELETE CASCADE,
	genre_key TEXT NOT NULL,
	name TEXT NOT NULL,
	PRIMARY KEY (spotify_artist_id, genre_key)
);

CREATE TABLE artist_genre_priority (
	spotify_artist_id TEXT PRIMARY KEY REFERENCES artists(spotify_artist_id) ON DELETE CASCADE,
	listening_time_ms INTEGER NOT NULL
);

CREATE TABLE spotify_catalogue_state (
	id INTEGER PRIMARY KEY CHECK (id = 1),
	day TEXT NOT NULL DEFAULT '',
	requests INTEGER NOT NULL DEFAULT 0,
	genre_requests INTEGER NOT NULL DEFAULT 0,
	retry_after_ms INTEGER NOT NULL DEFAULT 0,
	genre_lease_until_ms INTEGER NOT NULL DEFAULT 0,
	genre_priority_date TEXT NOT NULL DEFAULT ''
);
INSERT INTO spotify_catalogue_state(id) VALUES (1);
