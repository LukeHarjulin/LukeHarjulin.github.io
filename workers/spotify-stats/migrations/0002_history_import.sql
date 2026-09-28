ALTER TABLE plays ADD COLUMN source TEXT NOT NULL DEFAULT 'spotify_api';
ALTER TABLE plays ADD COLUMN source_event_key TEXT;
ALTER TABLE plays ADD COLUMN listened_ms INTEGER CHECK (listened_ms >= 0);
ALTER TABLE plays ADD COLUMN source_ended_at TEXT;

CREATE UNIQUE INDEX idx_plays_source_event_key
	ON plays (source, source_event_key)
	WHERE source_event_key IS NOT NULL;

CREATE TABLE history_imports (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	source TEXT NOT NULL CHECK (length(trim(source)) > 0),
	source_checksum TEXT NOT NULL CHECK (length(trim(source_checksum)) > 0),
	status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'failed')),
	total_records INTEGER NOT NULL DEFAULT 0 CHECK (total_records >= 0),
	imported_records INTEGER NOT NULL DEFAULT 0 CHECK (imported_records >= 0),
	skipped_records INTEGER NOT NULL DEFAULT 0 CHECK (skipped_records >= 0),
	earliest_ended_at TEXT,
	latest_ended_at TEXT,
	started_at TEXT,
	completed_at TEXT,
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	UNIQUE (source, source_checksum),
	CHECK (imported_records + skipped_records <= total_records),
	CHECK ((earliest_ended_at IS NULL) = (latest_ended_at IS NULL)),
	CHECK (earliest_ended_at IS NULL OR earliest_ended_at <= latest_ended_at),
	CHECK (completed_at IS NULL OR started_at IS NOT NULL)
);

CREATE INDEX idx_history_imports_status_created_at
	ON history_imports (status, created_at);
