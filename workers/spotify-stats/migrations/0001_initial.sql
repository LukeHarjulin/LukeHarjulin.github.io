PRAGMA foreign_keys = ON;

CREATE TABLE artists (
	spotify_artist_id TEXT PRIMARY KEY,
	name TEXT NOT NULL,
	spotify_url TEXT,
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE albums (
	spotify_album_id TEXT PRIMARY KEY,
	name TEXT NOT NULL,
	album_type TEXT,
	release_date TEXT,
	artwork_url TEXT,
	spotify_url TEXT,
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE tracks (
	spotify_track_id TEXT PRIMARY KEY,
	spotify_album_id TEXT REFERENCES albums (spotify_album_id),
	name TEXT NOT NULL,
	duration_ms INTEGER NOT NULL CHECK (duration_ms >= 0),
	explicit INTEGER NOT NULL DEFAULT 0 CHECK (explicit IN (0, 1)),
	spotify_url TEXT,
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE track_artists (
	spotify_track_id TEXT NOT NULL REFERENCES tracks (spotify_track_id) ON DELETE CASCADE,
	spotify_artist_id TEXT NOT NULL REFERENCES artists (spotify_artist_id),
	artist_order INTEGER NOT NULL CHECK (artist_order >= 0),
	PRIMARY KEY (spotify_track_id, spotify_artist_id),
	UNIQUE (spotify_track_id, artist_order)
);

CREATE TABLE plays (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	spotify_track_id TEXT NOT NULL REFERENCES tracks (spotify_track_id),
	played_at TEXT NOT NULL,
	played_at_unix_ms INTEGER NOT NULL,
	context_type TEXT,
	context_uri TEXT,
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	UNIQUE (spotify_track_id, played_at)
);

CREATE TABLE ingestion_state (
	key TEXT PRIMARY KEY,
	value TEXT NOT NULL,
	updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_plays_played_at ON plays (played_at);
CREATE INDEX idx_plays_track_played_at ON plays (spotify_track_id, played_at);
CREATE INDEX idx_track_artists_artist ON track_artists (spotify_artist_id, spotify_track_id);
